const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const DB = require('../../database/db');
const analytics = require('../../database/analytics');
const { requireAuth } = require('../middleware/sessionAuth');
const { getTradeWhisperPrompt } = require('../services/ai/tradePrompts');
const { loadSafetyBasics, loadPersonContext, loadSafetyContext, detectTrade, loadTradeKnowledge } = require('../services/ai/contextLoader');
const { buildSafetyBlock, buildContextPackage, buildStructurePrompt, buildConversePrompt } = require('../services/ai/promptBuilder');
const { buildRefinePrompt } = require('../services/ai/refinePrompts');
const { loadRefineKnowledge } = require('../services/ai/refineKnowledgeLoader');
const { transcribe, textToSpeech, textToSpeechBase64 } = require('../services/ai/openaiClient');
const { callClaude, callClaudeJSON, cleanupFieldText } = require('../services/ai/anthropicClient');
const { runAgent } = require('../services/ai/agentRuntime');
const voiceStructure = require('../services/ai/agents/voiceStructure');
const voiceConverse = require('../services/ai/agents/voiceConverse');
const voiceRefine = require('../services/ai/agents/voiceRefine');
const { detectSafety } = require('../services/ai/safetyDetector');

const router = Router();

// SECURITY: Resolve person_id — use session identity, allow override only for supervisor+
function resolvePersonId(req) {
  const clientId = req.body && req.body.person_id || req.query && req.query.person_id;
  const sessionId = req.auth && req.auth.person_id;
  if (!clientId || clientId === sessionId) return sessionId;
  if (req.auth && (req.auth.is_admin || req.auth.role_level >= 3 || req.auth.sparks_role)) return clientId;
  return sessionId;
}
const PORT = process.env.PORT || 3000;

// Audio file storage
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../audio'),
  filename: (req, file, cb) => {
    const id = 'audio_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const ext = file.originalname.split('.').pop() || 'webm';
    cb(null, `${id}.${ext}`);
  }
});
const audioFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('audio/')) cb(null, true);
  else cb(new Error('Only audio files allowed'), false);
};
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 }, fileFilter: audioFilter });

router.post('/save-audio', requireAuth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
    res.json({ audio_file: req.file.filename });
  } catch (err) {
    console.error('Save audio error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/transcribe — Audio → Whisper
// ============================================================
router.post('/transcribe', requireAuth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

    const audioBuffer = fs.readFileSync(req.file.path);
    const ext = req.file.originalname.split('.').pop() || 'webm';
    const person_id = resolvePersonId(req);
    const whisperPrompt = await getTradeWhisperPrompt(person_id, req.db);

    const result = await transcribe(audioBuffer, ext, whisperPrompt, {
      requestId: req.analyticsId,
      personId: person_id,
    });

    res.json({ transcript: result.text, audio_file: req.file.filename });
  } catch (err) {
    console.error('Transcribe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/structure — Role-aware Claude structuring
// ============================================================
router.post('/structure', requireAuth, async (req, res) => {
  try {
    const { transcript, field_cleanup, custom_prompt } = req.body;
    const person_id = resolvePersonId(req);
    if (!transcript) return res.status(400).json({ error: 'No transcript provided' });

    // Field cleanup mode — just clean up spoken text for a form field.
    // Pass projectId/companyId so the underlying runAgent(fieldCleanup) call
    // attributes Stripe billing correctly (Codex audit fix).
    if (field_cleanup) {
      try {
        const cleaned = await cleanupFieldText(transcript, custom_prompt, {
          requestId: req.analyticsId,
          personId: person_id,
          projectId: req.body.project_id || 'default',
          companyId: req.companyId,
        });
        return res.json({ cleaned, structured_report: cleaned, report: cleaned });
      } catch {
        return res.json({ cleaned: transcript, structured_report: transcript, report: transcript });
      }
    }

    // Build context using extracted modules
    const safetyBasics = loadSafetyBasics();
    const safetyBlock = buildSafetyBlock(safetyBasics);

    let contextPackage = null;
    if (person_id) {
      const person = await (req.db || DB).people.getById(person_id);
      const template = person ? await DB.templates.getById(person.template_id) : null;
      contextPackage = await buildContextPackage(person, template, req.db);
    }

    // Milestone C: use runAgent(voiceStructure). voiceStructure.systemPrompt
    // internally calls buildStructurePrompt(contextPackage, safetyBlock) and
    // the agent has jsonMode: true so the result is auto-parsed.
    const result = await runAgent(voiceStructure, {
      context: { contextPackage, safetyBlock },
      messages: [{ role: 'user', content: `Here is the voice transcript to structure:\n\n<transcript>\n${transcript}\n</transcript>` }],
      tracking: {
        requestId: req.analyticsId,
        personId: person_id,
        projectId: req.body.project_id || 'default',
        companyId: req.companyId,
        service: 'structure',
      },
    });

    if (!result.parsed) {
      return res.status(502).json({ error: 'Failed to parse output', raw: result.text });
    }

    res.json({
      verbatim: result.parsed.verbatim,
      structured: result.parsed.structured,
      context_package: contextPackage,
    });
  } catch (err) {
    console.error('Structure error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/tts — Text to Speech via OpenAI
// ============================================================
router.post('/tts', requireAuth, async (req, res) => {
  try {
    const { text, speed } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });

    const ttsRes = await textToSpeech(text, {
      speed,
      requestId: req.analyticsId,
    });

    // Stream the response directly to the client
    res.set('Content-Type', 'audio/mpeg');
    res.set('Transfer-Encoding', 'chunked');
    const reader = ttsRes.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        res.write(Buffer.from(value));
      }
    };
    await pump();
  } catch (err) {
    console.error('TTS error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/converse — Conversational follow-up with Claude
// ============================================================
router.post('/converse', requireAuth, async (req, res) => {
  try {
    const { transcript_so_far, conversation, messages_for_person } = req.body;
    const person_id = resolvePersonId(req);
    if (!transcript_so_far && (!conversation || conversation.length === 0)) return res.status(400).json({ error: 'No transcript provided' });

    // Load person and template context
    let personName = 'the worker';
    let roleTitle = '';
    let roleDescription = '';
    let reportFocus = '';
    let outputSections = [];
    let trade = '';

    if (person_id) {
      const person = await (req.db || DB).people.getById(person_id);
      const template = person ? await DB.templates.getById(person.template_id) : null;
      if (person) { personName = person.name; trade = person.trade || ''; }
      if (template) {
        roleTitle = template.role_level_title + ' ' + template.template_name;
        roleDescription = template.role_description;
        reportFocus = template.report_focus;
        outputSections = template.output_sections || [];
      }
    }

    // Milestone C: use runAgent(voiceConverse). voiceConverse.systemPrompt
    // internally calls buildConversePrompt which handles Sparks routing.
    const result = await runAgent(voiceConverse, {
      context: {
        personName, roleTitle, roleDescription, reportFocus, outputSections,
        messagesForPerson: messages_for_person,
        trade,
      },
      messages: conversation && conversation.length > 0
        ? conversation
        : [{ role: 'user', content: `Here's what ${personName} has reported so far:\n\n${transcript_so_far}` }],
      tracking: {
        requestId: req.analyticsId,
        personId: person_id,
        projectId: req.body.project_id || 'default',
        companyId: req.companyId,
        service: 'converse',
      },
    });

    res.json({ response: result.text });
  } catch (err) {
    console.error('Converse error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/refine — AI voice refinement conversation
// ============================================================
router.post('/refine', requireAuth, async (req, res) => {
  try {
    const { context_type, raw_transcript, conversation, round, team_context, phase, task_context, existing_fields, image_data } = req.body;
    const person_id = resolvePersonId(req);
    const currentPhase = phase || 'dialogue';

    // Load person context using extracted module
    const personContext = await loadPersonContext(person_id, req.db);
    const safetyContext = loadSafetyContext();

    // Determine trade: use person's actual trade from DB first, fall back to text detection
    let trade;
    if (person_id) {
      try {
        const person = await (req.db || DB).people.getById(person_id);
        if (person && person.trade) {
          trade = person.trade.toLowerCase().replace(/\s+/g, '');
          // Normalize to match knowledge folder names
          if (trade === 'pipefitting') trade = 'pipefitting';
          else if (trade === 'industrialerection') trade = 'erection';
          else if (trade === 'instrumentation') trade = 'instrumentation';
          else if (trade === 'safety') trade = 'safety';
          else trade = 'electrical';
        }
      } catch { /* fall through to text detection */ }
    }
    if (!trade) trade = detectTrade(personContext);
    const allText = (conversation || []).map(m => m.content).join(' ') + ' ' + (raw_transcript || '');
    const tradeKnowledge = loadRefineKnowledge(trade, allText);

    // Pre-Claude safety detection (rule-based keyword scan)
    const safetyDetection = detectSafety(allText);

    // Cross-session memory: load last 3 finalized reports for this person
    let recentReports = [];
    if (person_id && currentPhase === 'dialogue') {
      try {
        const reports = await (req.db || DB).reports.getByPerson(person_id);
        recentReports = (reports || [])
          .slice(0, 3)
          .map(r => ({
            date: r.created_at ? new Date(r.created_at).toLocaleDateString() : 'unknown',
            summary: (r.structured_report || r.final_report || '').substring(0, 150),
          }))
          .filter(r => r.summary.length > 0);
      } catch { /* reports table may not exist for all setups */ }
    }

    // Build refine context package (passed to voiceRefine.systemPrompt function).
    // The agent internally calls buildRefinePrompt(phase, contextType, opts).
    const refineCtx = {
      phase: currentPhase,
      contextType: context_type,
      opts: {
        round, personContext, safetyContext, tradeKnowledge,
        teamContext: team_context, taskContext: task_context,
        safetyDetection, recentReports,
      },
    };

    // Build messages array
    const messages = [];
    if (conversation && conversation.length > 0) {
      conversation.forEach(msg => {
        const role = (msg.role === 'assistant') ? 'assistant' : 'user';
        messages.push({ role, content: String(msg.content || '') });
      });
    }

    // Build user message content — supports multimodal (text + image) for photo attachments
    const buildUserContent = (text) => {
      if (!image_data) return text;
      // Parse base64 data URL: data:image/jpeg;base64,/9j/4AAQ...
      const match = image_data.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!match) return text + '\n\n[Worker attached a photo but format was not recognized]';
      const [, mediaType, base64] = match;
      return [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: text || 'The worker attached this photo.' },
      ];
    };

    if (currentPhase === 'edit' && existing_fields) {
      // Incremental edit mode: provide existing fields + correction
      messages.push({ role: 'user', content: `Here is the current finalized data:\n\n${JSON.stringify(existing_fields, null, 2)}\n\nPlease apply this change: "${raw_transcript}"` });
    } else if (round === 0) {
      messages.push({ role: 'user', content: buildUserContent(`Here's what I said:\n\n"${raw_transcript}"`) });
    } else if (currentPhase === 'finalize') {
      messages.push({ role: 'user', content: 'Please finalize the task based on our conversation.' });
    } else {
      messages.push({ role: 'user', content: buildUserContent(raw_transcript) });
    }

    // Milestone C: use runAgent(voiceRefine, ...). Agent has jsonMode: true so
    // the structured output is auto-parsed. Max tokens varies by phase and is
    // passed via overrides (clamped by the agent's maxTokens guardrail of 2048).
    const result = await runAgent(voiceRefine, {
      context: refineCtx,
      messages,
      overrides: { maxTokens: currentPhase === 'edit' ? 500 : 1500 },
      tracking: {
        requestId: req.analyticsId,
        personId: person_id,
        projectId: req.body.project_id || 'default',
        companyId: req.companyId,
        service: 'refine',
        extra: {
          context_type: context_type || null,
          knowledge_modules: tradeKnowledge ? tradeKnowledge.substring(0, 200) : null,
          conversation_round: round || 0,
          phase: currentPhase,
          safety_detected: safetyDetection.detected,
          safety_terms: safetyDetection.terms.slice(0, 5),
        },
      },
    });

    const parsed = result.parsed || {
      spoken_response: "I got your message but had a little trouble. Could you try saying that again?",
      ready_to_finalize: false,
      key_points: [],
    };

    // Inject safety flag from pre-scan if Claude missed it
    if (safetyDetection.detected && !parsed.safety_flag) {
      parsed.safety_flag = true;
    }

    res.json(parsed);
  } catch (err) {
    console.error('Refine error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/refine-speak — Combined refine + TTS in one round-trip
// ============================================================
router.post('/refine-speak', requireAuth, async (req, res) => {
  try {
    // Call /api/refine internally
    const refineRes = await fetch(`http://localhost:${PORT}/api/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: req.headers.cookie || '' },
      body: JSON.stringify(req.body),
    });
    const refineData = await refineRes.json();

    if (!refineRes.ok || refineData.error) {
      return res.status(refineRes.status || 500).json(refineData);
    }

    const spokenText = refineData.spoken_response || '';
    if (!spokenText || !process.env.OPENAI_API_KEY) {
      return res.json(refineData);
    }

    // Generate TTS using extracted client
    try {
      const audio = await textToSpeechBase64(spokenText, {
        requestId: req.analyticsId,
        personId: req.body.person_id,
      });
      res.json({ ...refineData, ...audio });
    } catch {
      // TTS failed — return JSON without audio
      res.json(refineData);
    }
  } catch (err) {
    console.error('Refine-speak error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
