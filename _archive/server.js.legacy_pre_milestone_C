require('dotenv').config({ override: true });
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const DB = require('./database/db');
const analytics = require('./database/analytics');

const app = express();
const PORT = 3000;

// Mount refactored route modules
const formsV2Router = require('./server/routes/formsV2');
app.use('/api/forms', formsV2Router);

const jsaRouter = require('./server/routes/jsa')(DB.db);
app.use('/api/jsa', jsaRouter);

// Ensure directories exist (still needed for audio, photos, certs, forms files)
['audio', 'photos', 'forms', 'certs', '.challenges'].forEach(dir => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use('/api', analytics.middleware);
app.use(express.static(path.join(__dirname, 'dist')));

// Audio file storage
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'audio'),
  filename: (req, file, cb) => {
    const id = req.body.report_id || new Date().toISOString().replace(/[:.]/g, '-');
    const ext = file.originalname.split('.').pop() || 'webm';
    cb(null, `${id}.${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ============================================================
// Helpers
// ============================================================
function readJsonDir(dirName) {
  const dirPath = path.join(__dirname, dirName);
  return fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(dirPath, f), 'utf-8')));
}

function readJson(dirName, id) {
  const filePath = path.join(__dirname, dirName, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(dirName, id, data) {
  const filePath = path.join(__dirname, dirName, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function seedDefaultTemplate() {
  const templatesDir = path.join(__dirname, 'templates');
  const existing = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json'));
  if (existing.length > 0) return;

  const template = {
    id: "template_journeyman_electrician",
    template_name: "Journeyman Electrician",
    role_level: 1,
    role_level_title: "Journeyman",
    trade: "Electrical",
    role_description: "Journeyman electrician working on industrial construction or refinery projects. Responsible for installing, terminating, testing, and troubleshooting electrical systems including power distribution, motor control centers, lighting, grounding, cable tray, conduit runs, and field instrumentation wiring.",
    report_focus: "When structuring this person's reports, look for: work completed today, equipment or material issues, safety observations, quality concerns, cable and conduit progress, motor terminations, panel work, testing results, issues that need foreman attention, and planned work for tomorrow.",
    output_sections: [
      "Work Completed",
      "Equipment / Material Issues",
      "Safety Observations",
      "Quality Notes",
      "Needs Foreman Attention",
      "Plan for Tomorrow"
    ],
    vocabulary: {
      description: "Common terms this role uses.",
      terms: [
        "conduit","rigid conduit","EMT","flex conduit","liquidtight",
        "pull box","junction box","J-box","cable tray","ladder tray",
        "wire","conductor","cable","MC cable","THHN","XHHW",
        "wire gauge","AWG","kcmil","breaker","circuit breaker","GFCI","AFCI",
        "panel","panelboard","distribution panel","load center",
        "MCC","motor control center","VFD","variable frequency drive",
        "transformer","xfmr","step-down","step-up",
        "bus","bus bar","bus duct","disconnect","safety switch",
        "starter","motor starter","soft starter",
        "relay","contactor","overload","terminal block","terminal strip","landing",
        "lug","compression lug","crimp",
        "megger","megohmmeter","insulation resistance",
        "hipot","high potential test","continuity","continuity test",
        "ground","grounding","ground rod","ground bus","bonding",
        "NEC","National Electrical Code",
        "one-line","one-line diagram","single-line diagram","SLD",
        "P&ID","loop","loop number","loop diagram",
        "tag","tag number","instrument tag",
        "area","unit","area classification",
        "Class I Div 1","Class I Div 2","hazardous area","classified area",
        "explosion proof","XP","intrinsically safe","IS","IS barrier",
        "raceway","wireway","fire stop","fire seal","penetration seal",
        "torque","torque spec","torque wrench",
        "termination","terminate","land","landing",
        "label","wire marker","cable tag",
        "as-built","redline","markup","punch list","punch","deficiency",
        "energize","de-energize","LOTO","lockout tagout",
        "hot work","hot work permit",
        "PPE","hard hat","safety glasses","FR clothing","arc flash",
        "JSA","job safety analysis","JHA",
        "toolbox talk","safety meeting",
        "scaffold","lift","man lift","scissor lift","boom lift",
        "permit","work permit","confined space"
      ]
    },
    language_notes: "Workers may mix English and Spanish. Preserve both languages as spoken. Technical terms are usually said in English even in Spanish-language reports. Common Spanish field terms: 'tubo' (conduit), 'caja' (box), 'cable', 'tablero' (panel), 'breaker', 'tierra' (ground), 'motor', 'prueba' (test).",
    created_at: new Date().toISOString()
  };

  writeJson('templates', template.id, template);
  console.log('  Seeded default template: Journeyman Electrician');
}

// ============================================================
// POST /api/login — PIN authentication
// ============================================================
app.post('/api/login', (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN required' });

    // Check admin PIN
    const adminPin = process.env.ADMIN_PIN || '12345678';
    if (pin === adminPin) {
      return res.json({ is_admin: true, name: 'Admin', role_title: 'Administrator' });
    }

    // Check people PINs via database
    const person = DB.people.getByPin(pin);
    if (person) {
      return res.json({
        is_admin: false,
        person_id: person.id,
        name: person.name,
        role_title: person.role_title,
        role_level: person.role_level || 1,
        template_id: person.template_id,
        trade: person.trade || '',
        photo: person.photo || null,
      });
    }

    res.status(401).json({ error: 'PIN not recognized' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// TEMPLATES
// ============================================================
app.get('/api/templates', (req, res) => {
  try {
    const templates = DB.templates.getAll().map(t => ({
      id: t.id, template_name: t.template_name, role_level_title: t.role_level_title, trade: t.trade, is_system: t.is_system || 0
    }));
    res.json(templates);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/templates/:id', (req, res) => {
  const t = DB.templates.getById(req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json(t);
});

app.post('/api/templates', (req, res) => {
  try {
    const t = req.body;
    if (!t.id) t.id = 'template_' + t.template_name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    t.is_system = 0;  // Client-created templates are never system
    t.created_by = req.body.created_by || 'admin';
    DB.templates.create(t);
    res.json({ success: true, id: t.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/templates/:id', (req, res) => {
  try {
    const result = DB.templates.update(req.params.id, req.body);
    if (!result) return res.status(404).json({ error: 'Template not found' });
    if (result.error) return res.status(403).json(result);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/templates/:id', (req, res) => {
  try {
    const result = DB.templates.deleteTemplate(req.params.id);
    if (result.error) return res.status(403).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// SAFETY BASICS — universal safety knowledge for all templates
// ============================================================
app.get('/api/safety-basics', (req, res) => {
  try {
    const filePath = path.join(__dirname, 'safety_basics.json');
    if (!fs.existsSync(filePath)) return res.json({ safety_rules: [], safety_vocabulary: [], tools_and_equipment: [] });
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/safety-basics', (req, res) => {
  try {
    const data = { ...req.body, updated_at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'safety_basics.json'), JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// PEOPLE
// ============================================================
app.get('/api/people', (req, res) => {
  try {
    res.json(DB.people.getAll());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/people/:id', (req, res) => {
  const p = DB.people.getById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Person not found' });
  res.json(p);
});

app.post('/api/people', (req, res) => {
  try {
    const result = DB.people.create(req.body);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/people/:id', (req, res) => {
  try {
    const result = DB.people.update(req.params.id, req.body);
    if (!result) return res.status(404).json({ error: 'Person not found' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/people/:id', (req, res) => {
  try {
    // Soft-delete by default (deactivate). Photos/certs stay in case of reactivation.
    const result = DB.people.delete(req.params.id);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// POST /api/save-audio
// ============================================================
app.post('/api/save-audio', upload.single('audio'), (req, res) => {
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
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured.' });
    }

    // Read file and create blob for native FormData
    const audioBuffer = fs.readFileSync(req.file.path);
    const ext = req.file.originalname.split('.').pop() || 'webm';
    const mimeMap = { m4a: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav' };
    const mime = mimeMap[ext] || 'audio/webm';

    const blob = new Blob([audioBuffer], { type: mime });
    const form = new FormData();
    form.append('file', blob, `recording.${ext}`);
    form.append('model', 'whisper-1');
    form.append('response_format', 'json');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.text();
      console.error('Whisper error:', err);
      return res.status(502).json({ error: 'Transcription failed', details: err });
    }

    const data = await whisperRes.json();

    // Track Whisper cost (~$0.006/min, estimate from file size: ~16KB/sec for webm)
    const fileSizeKB = req.file.size / 1024;
    const estDurationSec = Math.max(1, Math.round(fileSizeKB / 16));
    analytics.trackAiCost({
      request_id: req.analyticsId, person_id: req.body?.person_id || null,
      provider: 'openai', service: 'transcribe', model: 'whisper-1',
      audio_duration_seconds: estDurationSec,
      estimated_cost_cents: Math.max(1, Math.round(estDurationSec / 60 * 0.6)),
      success: 1,
    });

    res.json({ transcript: data.text, audio_file: req.file.filename });
  } catch (err) {
    console.error('Transcribe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/structure — Role-aware Claude structuring
// ============================================================
app.post('/api/structure', async (req, res) => {
  try {
    const { transcript, person_id, field_cleanup, custom_prompt } = req.body;
    if (!transcript) return res.status(400).json({ error: 'No transcript provided' });
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured.' });
    }

    // Field cleanup mode — just clean up spoken text for a form field
    if (field_cleanup) {
      const userPrompt = custom_prompt
        ? `${custom_prompt}\n\nSpoken text: "${transcript}"`
        : `Clean up this spoken text for a professional construction safety/work form. Fix grammar, make it clear and concise, but keep the original meaning and all specific details (names, numbers, locations, equipment). Do NOT add information that wasn't said. Return ONLY the cleaned text, nothing else.\n\nSpoken text: "${transcript}"`;
      const cleanupRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      if (cleanupRes.ok) {
        const data = await cleanupRes.json();
        const text = data.content[0].text;
        return res.json({ cleaned: text, structured_report: text, report: text });
      }
      return res.json({ cleaned: transcript, structured_report: transcript, report: transcript });
    }

    // Load universal safety basics
    let safetyBasics = null;
    const safetyPath = path.join(__dirname, 'safety_basics.json');
    if (fs.existsSync(safetyPath)) {
      safetyBasics = JSON.parse(fs.readFileSync(safetyPath, 'utf-8'));
    }

    const safetyBlock = safetyBasics ? `

INDUSTRIAL SAFETY KNOWLEDGE (applies to all trades — use this to identify and flag safety concerns in the report):
Safety Rules:
${(safetyBasics.safety_rules || []).map(r => '- ' + r).join('\n')}

Tools & Equipment Safety:
${(safetyBasics.tools_and_equipment || []).map(r => '- ' + r).join('\n')}

Safety Vocabulary: ${(safetyBasics.safety_vocabulary || []).join(', ')}

IMPORTANT: If the worker mentions ANY safety concern, near-miss, PPE issue, or unsafe condition — even casually — flag it prominently in the structured report. Safety observations should never be buried or minimized.` : '';

    // Build context package
    let contextPackage = null;
    let systemPrompt;

    if (person_id) {
      const person = DB.people.getById(person_id);
      const template = person ? DB.templates.getById(person.template_id) : null;

      if (person && template) {
        const pc = person.personal_context || {};
        // Person-level overrides take priority over template defaults
        contextPackage = {
          person_name: person.name,
          role_title: person.role_title,
          role_description: pc.role_description || template.role_description,
          report_focus: pc.report_focus || template.report_focus,
          output_sections: (pc.output_sections && pc.output_sections.length > 0) ? pc.output_sections : template.output_sections,
          vocabulary_terms: template.vocabulary ? template.vocabulary.terms.join(', ') : '',
          language_notes: pc.language_preference || template.language_notes || '',
          personal_experience: pc.experience || '',
          personal_specialties: pc.specialties || '',
          personal_notes: pc.notes || '',
          personal_certifications: pc.certifications || '',
          safety_rules: (pc.safety_rules && pc.safety_rules.length > 0) ? pc.safety_rules : (template.safety_rules || []),
          safety_vocabulary: (pc.safety_vocabulary && pc.safety_vocabulary.length > 0) ? pc.safety_vocabulary : (template.safety_vocabulary || []),
          tools_and_equipment: (pc.tools_and_equipment && pc.tools_and_equipment.length > 0) ? pc.tools_and_equipment : (template.tools_and_equipment || []),
          safety_notes: pc.safety_notes || '',
        };

        const sectionsText = contextPackage.output_sections.map((s, i) => `${i + 1}. ${s}`).join('\n');

        systemPrompt = `You are a report structuring assistant for a construction/refinery project run by Horizon Sparks.

A field worker has recorded a voice report. Use the context below to produce a well-structured report appropriate to their role and experience level.

PERSON: ${contextPackage.person_name}
ROLE: ${contextPackage.role_title}
ROLE DESCRIPTION: ${contextPackage.role_description}
EXPERIENCE: ${contextPackage.personal_experience}
SPECIALTIES: ${contextPackage.personal_specialties}
CERTIFICATIONS: ${contextPackage.personal_certifications}

REPORT FOCUS: ${contextPackage.report_focus}

LANGUAGE NOTES: ${contextPackage.language_notes}

VOCABULARY REFERENCE (preserve these terms exactly as spoken):
${contextPackage.vocabulary_terms}

PERSONAL NOTES: ${contextPackage.personal_notes}

SAFETY KNOWLEDGE:
${contextPackage.safety_rules.length > 0 ? 'Safety Rules:\n' + contextPackage.safety_rules.map(r => '- ' + r).join('\n') : ''}
${contextPackage.tools_and_equipment.length > 0 ? '\nTools & Equipment Safety:\n' + contextPackage.tools_and_equipment.map(r => '- ' + r).join('\n') : ''}
${contextPackage.safety_vocabulary.length > 0 ? '\nSafety Vocabulary: ' + contextPackage.safety_vocabulary.join(', ') : ''}
${contextPackage.safety_notes ? '\nPersonal Safety Notes: ' + contextPackage.safety_notes : ''}
${safetyBlock}

IMPORTANT: If the worker mentions ANY safety concern, near-miss, PPE issue, or unsafe condition — even casually — flag it prominently in the structured report.

SECTIONS TO PRODUCE:
${sectionsText}

INSTRUCTIONS:
Produce TWO outputs as valid JSON with keys "verbatim" and "structured":

1. "verbatim" — The raw transcript formatted as clean markdown. Preserve every word exactly as spoken, including any Spanish or mixed-language content. Add paragraph breaks where natural pauses occur. Add a header with the person's name, role, date, and time.

2. "structured" — The transcript reorganized into the sections listed above. Skip any section that has no relevant content. Preserve technical terms, tag numbers, loop numbers, and equipment identifiers exactly as spoken. If the person reported in mixed languages, the structured version should be in English but preserve any technical terms or direct quotes in the original language. Keep language direct and professional. Do not invent information not present in the transcript. Pay special attention to any safety-related content.`;
      }
    }

    // Fallback: generic prompt (Phase 0 style)
    if (!systemPrompt) {
      systemPrompt = `You are a report structuring assistant for an industrial software company called Horizon Sparks. The founder has recorded a voice note. Your job is to produce TWO markdown documents from the transcript.

OUTPUT FORMAT — return valid JSON with two keys:
{ "verbatim": "...", "structured": "..." }

DOCUMENT 1 — "verbatim": Take the raw transcript and format it as clean markdown. Preserve every word. Add paragraph breaks and a date header.

DOCUMENT 2 — "structured": Reorganize into sections:
## Summary
## Key Points
## Action Items
## Open Questions
## Raw Context

Keep language direct and professional. Do not invent information.`;
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Here is the voice transcript to structure:\n\n${transcript}` }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      console.error('Claude error:', err);
      return res.status(502).json({ error: 'Claude API failed', details: err });
    }

    const claudeData = await claudeRes.json();

    // Track Claude cost for /api/structure
    analytics.trackAiCost({
      request_id: req.analyticsId, person_id: person_id || null,
      provider: 'anthropic', service: 'structure', model: 'claude-sonnet-4-20250514',
      input_tokens: claudeData.usage?.input_tokens || 0,
      output_tokens: claudeData.usage?.output_tokens || 0,
      estimated_cost_cents: Math.round(((claudeData.usage?.input_tokens || 0) * 3 + (claudeData.usage?.output_tokens || 0) * 15) / 10000),
      success: 1,
    });

    const content = claudeData.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (parseErr) {
      console.error('Parse error:', content);
      return res.status(502).json({ error: 'Failed to parse output', raw: content });
    }

    res.json({
      verbatim: parsed.verbatim,
      structured: parsed.structured,
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
app.post('/api/tts', async (req, res) => {
  try {
    const { text, speed } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: 'nova', // warm, professional female voice
        response_format: 'mp3',
        speed: speed || 1.0,
      }),
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.text();
      console.error('TTS error:', err);
      return res.status(502).json({ error: 'TTS failed', details: err });
    }

    // Track TTS cost ($15/1M chars)
    analytics.trackAiCost({
      request_id: req.analyticsId, person_id: null,
      provider: 'openai', service: 'tts', model: 'tts-1',
      tts_characters: text.length,
      estimated_cost_cents: Math.max(1, Math.round(text.length * 15 / 10000)),
      success: 1,
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
app.post('/api/converse', async (req, res) => {
  try {
    const { person_id, transcript_so_far, conversation, messages_for_person } = req.body;
    if (!transcript_so_far && (!conversation || conversation.length === 0)) return res.status(400).json({ error: 'No transcript provided' });
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    // Load person and template context
    let personName = 'the worker';
    let roleTitle = '';
    let roleDescription = '';
    let reportFocus = '';
    let outputSections = [];

    if (person_id) {
      const person = DB.people.getById(person_id);
      const template = person ? DB.templates.getById(person.template_id) : null;
      if (person) personName = person.name;
      if (template) {
        roleTitle = template.role_level_title + ' ' + template.template_name;
        roleDescription = template.role_description;
        reportFocus = template.report_focus;
        outputSections = template.output_sections || [];
      }
    }

    // Build messages context
    let messagesBlock = '';
    if (messages_for_person && messages_for_person.length > 0) {
      messagesBlock = `\n\nIMPORTANT MESSAGES FOR ${personName.toUpperCase()}:\nThe following messages were left by supervisors or safety officers. You MUST mention each one naturally during the conversation:\n${messages_for_person.map((m, i) => `${i + 1}. From ${m.from}: "${m.text}"`).join('\n')}`;
    }

    const systemPrompt = `You are a friendly, professional AI assistant helping a field worker complete their daily voice report. You are having a SPOKEN CONVERSATION — keep your responses short, natural, and conversational (2-4 sentences max).

WORKER: ${personName} (${roleTitle})
ROLE: ${roleDescription}
REPORT SECTIONS NEEDED: ${outputSections.join(', ')}
${reportFocus ? `FOCUS AREAS: ${reportFocus}` : ''}
${messagesBlock}

YOUR JOB:
1. Review what ${personName} has said so far
2. Acknowledge what they reported (briefly)
3. If there are supervisor/safety messages, deliver them naturally (e.g. "Oh, by the way, your safety officer left you a note about...")
4. Ask ONE or TWO follow-up questions about missing information — things a good report should include but weren't mentioned
5. Keep it conversational — like talking to a coworker, not reading a form

RULES:
- Be brief. This is spoken aloud. No long paragraphs.
- Use the worker's first name
- Ask about specifics: crew size, exact counts, equipment models, tag numbers
- If they mentioned a problem, ask what they need to fix it
- If safety was mentioned, acknowledge it positively
- If nothing is missing, just say "Sounds good, [name]. Ready to wrap up?"
- Respond in the same language the worker used (English or Spanish or mixed)
- Never say "as an AI" or break character
- When you think the report is mostly complete, remind ${personName} to take a photo of their work if they haven't mentioned it. Say something like "Hey ${personName.split(' ')[0]}, don't forget to snap a photo of the work area before you wrap up — hit the camera button."
- Only remind about photos ONCE, and only when the report feels close to done`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: systemPrompt,
        messages: conversation && conversation.length > 0
          ? conversation
          : [{ role: 'user', content: `Here's what ${personName} has reported so far:\n\n${transcript_so_far}` }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      console.error('Converse error:', err);
      return res.status(502).json({ error: 'Claude API failed', details: err });
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content[0].text;

    // Track Claude cost for /api/converse
    analytics.trackAiCost({
      request_id: req.analyticsId, person_id: req.body?.person_id || null,
      provider: 'anthropic', service: 'converse', model: 'claude-sonnet-4-20250514',
      input_tokens: claudeData.usage?.input_tokens || 0,
      output_tokens: claudeData.usage?.output_tokens || 0,
      estimated_cost_cents: Math.round(((claudeData.usage?.input_tokens || 0) * 3 + (claudeData.usage?.output_tokens || 0) * 15) / 10000),
      success: 1,
    });

    res.json({ response: responseText });
  } catch (err) {
    console.error('Converse error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/refine — AI voice refinement conversation
// ============================================================
app.post('/api/refine', async (req, res) => {
  try {
    const { context_type, raw_transcript, conversation, round, team_context, phase, person_id } = req.body;
    // phase: "dialogue" (asking follow-ups, gathering info) or "finalize" (produce final structured output)
    const currentPhase = phase || (round === 0 ? 'dialogue' : 'dialogue');

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured.' });
    }

    // Load person/template context if available
    let personContext = '';
    if (person_id) {
      try {
        const person = DB.people.getById(person_id);
        if (person && person.template_id) {
          const tplPath = path.join(__dirname, 'templates', `${person.template_id}.json`);
          if (fs.existsSync(tplPath)) {
            const template = JSON.parse(fs.readFileSync(tplPath, 'utf8'));
            personContext = `\nWorker context: ${person.name}, ${template.template_name} (${template.trade}). ${template.role_description || ''}`;
            if (template.vocabulary && template.vocabulary.terms) {
              personContext += `\nIndustry vocabulary they may use: ${template.vocabulary.terms.slice(0, 40).join(', ')}`;
            }
          }
        }
      } catch(e) {}
    }

    // Load safety basics for smart follow-ups
    let safetyContext = '';
    try {
      const safetyPath = path.join(__dirname, 'safety_basics.json');
      if (fs.existsSync(safetyPath)) {
        const safety = JSON.parse(fs.readFileSync(safetyPath, 'utf8'));
        if (safety.rules) safetyContext = `\nKey safety rules to consider: ${safety.rules.slice(0, 8).map(r => r.rule || r).join('; ')}`;
      }
    } catch(e) {}

    // Load trade-specific knowledge (smart context — only load relevant pieces)
    let tradeKnowledge = '';
    try {
      const knowledgeDir = path.join(__dirname, 'knowledge');
      if (fs.existsSync(knowledgeDir)) {
        // Determine trade from person context
        const trade = personContext.includes('Instrumentation') ? 'instrumentation'
          : personContext.includes('Pipe Fitting') ? 'pipefitting'
          : personContext.includes('Industrial Erection') ? 'erection'
          : personContext.includes('Safety') ? 'safety'
          : 'electrical';
        const transcript = raw_transcript || '';
        const allText = (conversation || []).map(m => m.content).join(' ') + ' ' + transcript;
        const textLower = allText.toLowerCase();

        // Load safety knowledge for the trade
        const safetyFile = path.join(knowledgeDir, `${trade}_safety.json`);
        if (fs.existsSync(safetyFile)) {
          const safetyData = JSON.parse(fs.readFileSync(safetyFile, 'utf8'));
          // Smart matching: find which task types are being discussed
          const taskMatches = [];
          const taskKeywordsByTrade = {
            instrumentation: {
              instrument_installation: ['instrument', 'transmitter', 'pressure', 'temperature', 'level', 'flow', 'install', 'mount', 'thermowell', 'rtd', 'thermocouple'],
              tubing_runs: ['tubing', 'tube', 'impulse', 'air supply', 'swagelok', 'fitting', 'compression'],
              control_valve_installation: ['valve', 'control valve', 'actuator', 'positioner', 'globe', 'butterfly'],
              calibration: ['calibrate', 'calibration', 'hart', 'range', 'span', 'zero', 'trim', '4-20'],
              loop_testing: ['loop', 'loop test', 'loop check', 'checkout', 'dcs', 'plc', 'signal'],
              hazardous_areas: ['classified', 'div 1', 'div 2', 'explosion', 'intrinsically safe', 'barrier'],
              pneumatic_systems: ['air', 'pneumatic', 'air header', 'regulator', 'filter'],
              working_near_process_piping: ['process', 'piping', 'hot pipe', 'steam', 'cryogenic']
            },
            electrical: {
              cable_pulling: ['cable', 'pull', 'wire', 'conductor', 'reel'],
              conduit_installation: ['conduit', 'emt', 'rigid', 'raceway', 'bend'],
              terminations: ['terminate', 'termination', 'land', 'landing', 'lug', 'connect', 'breaker', 'panel'],
              testing_megger: ['megger', 'test', 'insulation', 'resistance', 'meg'],
              testing_hipot: ['hipot', 'high pot', 'high potential'],
              panel_mcc_work: ['panel', 'mcc', 'motor control', 'switchgear', 'breaker'],
              cable_tray: ['tray', 'cable tray', 'ladder tray'],
              confined_space: ['confined', 'vault', 'manhole', 'tank'],
              hot_work_near_electrical: ['weld', 'grind', 'cut', 'hot work', 'spark']
            },
            pipefitting: {
              welding: ['weld', 'welding', 'stick', 'tig', 'gtaw', 'smaw', 'fcaw', '6010', '7018', 'root pass', 'fill pass', 'cap'],
              fitup: ['fit-up', 'fitup', 'fit up', 'alignment', 'hi-lo', 'mismatch', 'tack', 'bevel', 'root gap'],
              flange_boltup: ['flange', 'bolt', 'bolt-up', 'torque', 'gasket', 'spiral wound', 'rtj', 'ring joint', 'stud'],
              hydro_testing: ['hydro', 'hydrostatic', 'pressure test', 'test pack', 'test boundary', 'leak test'],
              valve_installation: ['valve', 'gate valve', 'globe valve', 'ball valve', 'check valve', 'butterfly', 'relief valve', 'psv'],
              pipe_support: ['support', 'hanger', 'spring hanger', 'shoe', 'guide', 'anchor', 'trunnion', 'u-bolt'],
              pipe_fabrication: ['spool', 'prefab', 'fabrication', 'iso', 'isometric', 'pipe rack'],
              cutting_grinding: ['grind', 'cut', 'torch', 'oxy-fuel', 'bevel machine', 'coping'],
              preheat_pwht: ['preheat', 'pwht', 'post weld', 'stress relief', 'heat treatment', 'interpass'],
              nde_inspection: ['nde', 'x-ray', 'radiography', 'rt', 'ut', 'pt', 'mt', 'dye pen', 'mag particle', 'pmi']
            },
            erection: {
              rigging: ['rig', 'rigging', 'sling', 'shackle', 'choker', 'basket', 'spreader bar', 'pad eye', 'lifting lug'],
              crane_operations: ['crane', 'crawler', 'hydraulic crane', 'boom', 'load chart', 'radius', 'capacity', 'outrigger'],
              steel_erection: ['steel', 'beam', 'column', 'brace', 'gusset', 'wide flange', 'erection', 'bolt-up', 'a325', 'a490'],
              equipment_setting: ['vessel', 'column', 'tower', 'exchanger', 'reactor', 'compressor', 'pump', 'module', 'skid'],
              platforms_grating: ['platform', 'grating', 'handrail', 'toe plate', 'ladder', 'stairway', 'cage'],
              fall_protection: ['fall', 'harness', 'lanyard', 'retractable', 'tie-off', 'leading edge', 'rescue'],
              heavy_lifts: ['heavy lift', 'critical lift', 'tandem lift', 'lift plan', 'engineered lift', 'center of gravity']
            },
            safety: {
              permits: ['permit', 'hot work', 'confined space', 'excavation', 'line break', 'energized work', 'loto'],
              inspections: ['inspection', 'walkdown', 'audit', 'observation', 'finding', 'violation', 'citation'],
              incidents: ['incident', 'near miss', 'first aid', 'recordable', 'lost time', 'fatality', 'investigation'],
              training: ['training', 'osha 10', 'osha 30', 'competent person', 'qualified', 'certification'],
              emergency: ['emergency', 'evacuation', 'muster', 'fire', 'spill', 'rescue', 'ems'],
              environmental: ['swppp', 'spcc', 'spill', 'containment', 'hazmat', 'waste', 'erosion'],
              fall_protection: ['fall', 'harness', 'scaffold', 'guardrail', 'hole cover', 'leading edge'],
              ppe: ['ppe', 'hard hat', 'glasses', 'gloves', 'fr', 'steel toe', 'hearing protection', 'respirator']
            }
          };
          const taskKeywords = taskKeywordsByTrade[trade] || taskKeywordsByTrade.electrical;
          for (const [task, keywords] of Object.entries(taskKeywords)) {
            if (keywords.some(kw => textLower.includes(kw)) && safetyData.tasks && safetyData.tasks[task]) {
              const taskData = safetyData.tasks[task];
              const summary = [];
              if (taskData.ppe) summary.push(`PPE: ${taskData.ppe.join(', ')}`);
              if (taskData.jsa_items) summary.push(`JSA items: ${taskData.jsa_items.slice(0, 4).join('; ')}`);
              if (taskData.permits) summary.push(`Permits needed: ${taskData.permits.join(', ')}`);
              if (taskData.hazards) summary.push(`Key hazards: ${taskData.hazards.slice(0, 3).join('; ')}`);
              if (taskData.safety) summary.push(`Safety: ${taskData.safety.slice(0, 3).join('; ')}`);
              if (taskData.requirements) summary.push(`Requirements: ${(Array.isArray(taskData.requirements) ? taskData.requirements : []).slice(0, 3).join('; ')}`);
              taskMatches.push(`[${task.replace(/_/g, ' ')}] ${summary.join('. ')}`);
            }
          }
          if (taskMatches.length > 0) {
            tradeKnowledge += `\nRelevant safety knowledge for this work:\n${taskMatches.join('\n')}`;
          }
        }

        // Load procedures if relevant
        const procFile = path.join(knowledgeDir, `${trade}_procedures.json`);
        if (fs.existsSync(procFile)) {
          const procData = JSON.parse(fs.readFileSync(procFile, 'utf8'));
          if (textLower.includes('punch') && procData.quality_common_punch_items) {
            tradeKnowledge += `\nCommon punch list items to watch for: ${procData.quality_common_punch_items.slice(0, 6).join('; ')}`;
          }
        }

        // Load materials knowledge if discussing materials/cable/conduit/tubing
        const matKeywords = ['cable', 'wire', 'conduit', 'emt', 'rigid', 'pvc', 'tubing', 'material', 'fitting', 'seal', 'gasket', 'thhn', 'xhhw', 'mc cable'];
        if (matKeywords.some(kw => textLower.includes(kw))) {
          const matFile = path.join(knowledgeDir, 'materials_specs.json');
          if (fs.existsSync(matFile)) {
            const matData = JSON.parse(fs.readFileSync(matFile, 'utf8'));
            if (textLower.includes('cable') || textLower.includes('wire')) {
              const cableTypes = Object.entries(matData.cable_types || {}).slice(0, 3).map(([k, v]) => `${k}: ${v.use || v.rating || ''}`).join('; ');
              tradeKnowledge += `\nCable type knowledge: ${cableTypes}`;
            }
            if (matData.common_material_mistakes) {
              tradeKnowledge += `\nCommon material mistakes: ${matData.common_material_mistakes.slice(0, 3).join('; ')}`;
            }
          }
        }

        // Load commissioning knowledge if discussing startup/energize/commission
        const commKeywords = ['energize', 'startup', 'commission', 'pre-energization', 'bump test', 'checkout'];
        if (commKeywords.some(kw => textLower.includes(kw))) {
          const commFile = path.join(knowledgeDir, 'commissioning.json');
          if (fs.existsSync(commFile)) {
            const commData = JSON.parse(fs.readFileSync(commFile, 'utf8'));
            if (commData.common_commissioning_mistakes) {
              tradeKnowledge += `\nCommon commissioning mistakes to avoid: ${commData.common_commissioning_mistakes.slice(0, 4).join('; ')}`;
            }
          }
        }

        // Load lessons learned if discussing quality/rework/mistakes
        const lessonsKeywords = ['rework', 'mistake', 'problem', 'wrong', 'issue', 'deficiency', 'quality'];
        if (lessonsKeywords.some(kw => textLower.includes(kw))) {
          const lessonsFile = path.join(knowledgeDir, 'lessons_learned.json');
          if (fs.existsSync(lessonsFile)) {
            const lessonsData = JSON.parse(fs.readFileSync(lessonsFile, 'utf8'));
            const reworkKey = trade === 'instrumentation' ? 'top_rework_causes_instrumentation'
              : trade === 'pipefitting' ? 'top_rework_causes_pipefitting'
              : trade === 'erection' ? 'top_rework_causes_erection'
              : 'top_rework_causes_electrical';
            if (lessonsData[reworkKey]) {
              tradeKnowledge += `\nTop rework causes: ${lessonsData[reworkKey].slice(0, 3).map(r => r.cause).join('; ')}`;
            }
          }
        }

        // Load crew/productivity if discussing crew/manpower/schedule/how many
        const crewKeywords = ['crew', 'manpower', 'how many', 'how long', 'productivity', 'schedule', 'coordinate'];
        if (crewKeywords.some(kw => textLower.includes(kw))) {
          const crewFile = path.join(knowledgeDir, 'crew_productivity.json');
          if (fs.existsSync(crewFile)) {
            const crewData = JSON.parse(fs.readFileSync(crewFile, 'utf8'));
            if (crewData.crew_sizes) {
              tradeKnowledge += `\nCrew size reference available for task planning`;
            }
          }
        }

        // Load weather/environmental if discussing weather/cold/heat/rain/wind
        const weatherKeywords = ['weather', 'cold', 'heat', 'rain', 'wind', 'humidity', 'freeze', 'hot'];
        if (weatherKeywords.some(kw => textLower.includes(kw))) {
          const weatherFile = path.join(knowledgeDir, 'weather_environmental.json');
          if (fs.existsSync(weatherFile)) {
            const weatherData = JSON.parse(fs.readFileSync(weatherFile, 'utf8'));
            if (textLower.includes('cold') || textLower.includes('freeze')) {
              tradeKnowledge += `\nCold weather limits: Cable pulling min temp varies by type (PVC: 14F, XLPE: -40F). Concrete min 50F.`;
            }
            if (textLower.includes('heat') || textLower.includes('hot')) {
              tradeKnowledge += `\nHeat stress: Water every 30 min above 80F WBGT. 15 min rest/hr above 85F. Consider stopping above 90F.`;
            }
          }
        }

        // Load pipe fitting materials if discussing pipe/flange/gasket/bolt/valve
        const pipeMatKeywords = ['pipe', 'flange', 'gasket', 'bolt', 'stud', 'valve', 'elbow', 'tee', 'reducer', 'spool', 'schedule', 'carbon steel', 'stainless', 'chrome', 'alloy', 'weld neck', 'slip-on'];
        if ((trade === 'pipefitting' || trade === 'erection') && pipeMatKeywords.some(kw => textLower.includes(kw))) {
          const pipeMatFile = path.join(knowledgeDir, 'pipefitting_materials.json');
          if (fs.existsSync(pipeMatFile)) {
            try {
              const pipeMatData = JSON.parse(fs.readFileSync(pipeMatFile, 'utf8'));
              if (textLower.includes('flange') || textLower.includes('gasket') || textLower.includes('bolt')) {
                tradeKnowledge += `\nPipe fitting material knowledge available for flanges, gaskets, and bolt specifications.`;
              }
              if (textLower.includes('torque')) {
                tradeKnowledge += `\nBolt torque knowledge available — ask about specific flange size and class.`;
              }
            } catch(e) {}
          }
        }

        // Load rigging/crane knowledge if discussing lifts/rigging/crane
        const riggingKeywords = ['rig', 'rigging', 'crane', 'lift', 'sling', 'shackle', 'spreader', 'vessel', 'column', 'exchanger', 'module', 'steel', 'erection', 'iron'];
        if ((trade === 'erection' || riggingKeywords.some(kw => textLower.includes(kw)))) {
          const riggingFile = path.join(knowledgeDir, 'rigging_crane_operations.json');
          if (fs.existsSync(riggingFile)) {
            try {
              const riggingData = JSON.parse(fs.readFileSync(riggingFile, 'utf8'));
              if (riggingData.sling_capacities || riggingData.crane_signals) {
                tradeKnowledge += `\nRigging and crane operations knowledge available — sling capacities, crane signals, lift planning.`;
              }
            } catch(e) {}
          }
        }

        // Load safety department knowledge for safety trade
        if (trade === 'safety') {
          const safetyDeptFile = path.join(knowledgeDir, 'safety_department.json');
          if (fs.existsSync(safetyDeptFile)) {
            try {
              const safetyDeptData = JSON.parse(fs.readFileSync(safetyDeptFile, 'utf8'));
              // Load quick reference for voice assistant
              if (safetyDeptData.voice_assistant_quick_reference) {
                const qr = safetyDeptData.voice_assistant_quick_reference;
                const refs = Object.entries(qr).slice(0, 10).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('; ');
                tradeKnowledge += `\nSafety quick reference: ${refs}`;
              }
              // Load relevant section based on keywords
              if (textLower.includes('permit')) tradeKnowledge += `\nPermit system knowledge available — hot work, confined space, excavation, line break, LOTO.`;
              if (textLower.includes('incident') || textLower.includes('investigation')) tradeKnowledge += `\nIncident investigation knowledge: 5 Whys, fishbone, OSHA recordability criteria, reporting deadlines.`;
              if (textLower.includes('trir') || textLower.includes('metric') || textLower.includes('rate')) tradeKnowledge += `\nSafety metrics: TRIR formula (recordables x 200,000 / hours worked). Excellent <0.5, world class <0.3.`;
              if (textLower.includes('training') || textLower.includes('osha')) tradeKnowledge += `\nTraining requirements knowledge available — OSHA 10/30, fall protection, confined space, crane, forklift, first aid.`;
              if (textLower.includes('jsa') || textLower.includes('jha') || textLower.includes('hazard')) tradeKnowledge += `\nJSA/JHA creation knowledge: hazard categories, risk matrix, hierarchy of controls, task-specific templates.`;
            } catch(e) {}
          }
        }

        // Load pipe fitting codes/standards if discussing code/asme/welding qualification
        const codeKeywords = ['asme', 'b31', 'code', 'wps', 'pqr', 'welder qualification', 'section ix', 'aws'];
        if (codeKeywords.some(kw => textLower.includes(kw))) {
          const codesFile = path.join(knowledgeDir, 'pipefitting_codes_standards.json');
          if (fs.existsSync(codesFile)) {
            try {
              const codesData = JSON.parse(fs.readFileSync(codesFile, 'utf8'));
              tradeKnowledge += `\nPiping codes and standards knowledge available — ASME B31.3, B31.1, Section IX, welding qualifications.`;
            } catch(e) {}
          }
        }
      }
    } catch(e) { console.error('Knowledge load error:', e.message); }

    let systemPrompt;

    if (currentPhase === 'finalize') {
      // FINALIZE PHASE — produce the final structured fields from the full conversation
      if (context_type === 'daily_task') {
        systemPrompt = `You are finalizing a task assignment based on a conversation with a construction worker. Review the full conversation and produce the final structured task.

${team_context ? `Team members: ${team_context}` : ''}
${personContext}

Return a JSON object with EXACTLY these keys:
- "fields": { "title": string (max 10 words, clear action), "description": string (detailed, professional, include all relevant details from the conversation — safety requirements, materials, crew coordination, JSA/PPE notes), "assigned_to": string (person ID if mentioned), "priority": string ("low"|"normal"|"high"|"critical") }
- "spoken_response": string (1-2 sentences, read the task back naturally. End with "If this looks good, go ahead and approve it, or tell me what to change.")
- "what_changed": []
- "ready": true

Return ONLY valid JSON.`;
      } else {
        systemPrompt = `You are finalizing a punch list item based on a conversation with a construction worker. Review the full conversation and produce the final structured item.
${personContext}

Return a JSON object with EXACTLY these keys:
- "fields": { "title": string (max 10 words, clear issue), "description": string (detailed, professional, include all details from conversation), "location": string (area, equipment tag), "priority": string ("low"|"normal"|"high"|"critical") }
- "spoken_response": string (1-2 sentences, read the item back naturally. End with "If this looks good, go ahead and approve it, or tell me what to change.")
- "what_changed": []
- "ready": true

Return ONLY valid JSON.`;
      }
    } else {
      // DIALOGUE PHASE — have a natural conversation, ask smart follow-ups
      if (context_type === 'daily_task') {
        systemPrompt = `You are a smart, friendly construction assistant — like a sharp foreman's right hand who knows everything about safety, materials, and crew coordination. You speak naturally, warmly, like a helpful coworker.

Your job is to have a CONVERSATION with the worker to build a complete task assignment. Don't just accept what they say — think about what's missing and ask smart follow-up questions.

${round === 0 ? `The worker just described a task. Acknowledge what they said, then ask 1-2 smart follow-up questions about things they might have missed. Think about:
- Has the crew done their JSA (Job Safety Analysis) for this work?
- Do they have the right PPE for this type of task?
- Are materials staged and ready?
- Is there a permit needed (hot work, confined space, elevated work)?
- Who specifically should be assigned?
- Any coordination needed with other trades?
- Is there a deadline or urgency?

Pick the 1-2 most relevant questions based on what they described. Don't ask about everything — just what matters most for THIS specific task.` : `Continue the conversation naturally. If the worker answered your questions, acknowledge their answers. If there's still something important missing, ask ONE more follow-up. If you have enough information, set "ready_to_finalize" to true.`}

${team_context ? `Team members available: ${team_context}` : ''}
${personContext}
${safetyContext}
${tradeKnowledge}

Return a JSON object with EXACTLY these keys:
- "spoken_response": string (2-4 sentences, conversational and warm. Acknowledge what they said, ask follow-ups if needed. Sound like a real coworker, not a robot.)
- "ready_to_finalize": boolean (true if you have enough info to create the task — at minimum a clear description of what needs to be done. Don't drag the conversation on unnecessarily.)
- "key_points": array of strings (bullet points of what you've gathered so far from the conversation)

Return ONLY valid JSON.`;
      } else {
        systemPrompt = `You are a smart, friendly construction assistant helping log a punch list item (deficiency/issue on a job site). You speak naturally, like a helpful coworker.

Your job is to have a CONVERSATION to get complete details about the issue. Don't just accept what they say — think about what details are needed for a proper punch list item.

${round === 0 ? `The worker just described an issue. Acknowledge it, then ask 1-2 smart follow-up questions:
- Exact location (area, equipment tag, room)?
- How severe is it? Does it need immediate attention?
- Is it a safety hazard?
- What trade needs to fix it?
- Was it documented with a photo?
- Any code or spec violation?

Pick the 1-2 most relevant questions for THIS specific issue.` : `Continue the conversation. If they answered your questions, acknowledge it. If something important is still missing, ask ONE more question. If you have enough info, set "ready_to_finalize" to true.`}

${personContext}
${safetyContext}
${tradeKnowledge}

Return a JSON object with EXACTLY these keys:
- "spoken_response": string (2-4 sentences, conversational. Acknowledge what they said, ask follow-ups if needed.)
- "ready_to_finalize": boolean (true if you have enough info — at minimum a clear description of the issue and rough location)
- "key_points": array of strings (what you've gathered so far)

Return ONLY valid JSON.`;
      }
    }

    // Build messages array
    const messages = [];
    if (conversation && conversation.length > 0) {
      conversation.forEach(msg => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }
    if (round === 0) {
      messages.push({ role: 'user', content: `Here's what I said:\n\n"${raw_transcript}"` });
    } else if (currentPhase === 'finalize') {
      messages.push({ role: 'user', content: 'Please finalize the task based on our conversation.' });
    } else {
      messages.push({ role: 'user', content: raw_transcript });
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages,
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Refine API error:', errText);
      return res.status(500).json({ error: 'AI processing failed' });
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content[0].text;

    // Track Claude cost for /api/refine
    analytics.trackAiCost({
      request_id: req.analyticsId, person_id: person_id || null,
      provider: 'anthropic', service: 'refine', model: 'claude-sonnet-4-20250514',
      input_tokens: claudeData.usage?.input_tokens || 0,
      output_tokens: claudeData.usage?.output_tokens || 0,
      estimated_cost_cents: Math.round(((claudeData.usage?.input_tokens || 0) * 3 + (claudeData.usage?.output_tokens || 0) * 15) / 10000),
      context_type: context_type || null,
      knowledge_modules: tradeKnowledge ? tradeKnowledge.substring(0, 200) : null,
      conversation_round: round || 0,
      phase: currentPhase,
      success: 1,
    });

    let parsed;
    try {
      const jsonStr = responseText.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('Failed to parse refine response:', responseText);
      parsed = {
        spoken_response: "I got your message but had a little trouble. Could you try saying that again?",
        ready_to_finalize: false,
        key_points: [],
      };
    }

    res.json(parsed);
  } catch (err) {
    console.error('Refine error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/refine-speak — Combined refine + TTS in one round-trip
// Saves ~2-3 seconds by eliminating the client-side TTS fetch
// ============================================================
app.post('/api/refine-speak', async (req, res) => {
  try {
    // Call /api/refine internally via HTTP (same Express app, guaranteed to work)
    const refineRes = await fetch(`http://localhost:${PORT}/api/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const refineData = await refineRes.json();

    if (!refineRes.ok || refineData.error) {
      return res.status(refineRes.status || 500).json(refineData);
    }

    const spokenText = refineData.spoken_response || '';

    if (!spokenText || !process.env.OPENAI_API_KEY) {
      // No text to speak or no OpenAI key — return JSON only
      return res.json(refineData);
    }

    // Now generate TTS for the spoken_response
    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: spokenText,
        voice: 'nova',
        response_format: 'mp3',
        speed: 1.0,
      }),
    });

    if (!ttsRes.ok) {
      // TTS failed — return JSON data without audio
      console.error('TTS error in refine-speak:', await ttsRes.text());
      return res.json(refineData);
    }

    // Track TTS cost
    analytics.trackAiCost({
      request_id: req.analyticsId, person_id: req.body.person_id || null,
      provider: 'openai', service: 'tts', model: 'tts-1',
      tts_characters: spokenText.length,
      estimated_cost_cents: Math.max(1, Math.round(spokenText.length * 15 / 10000)),
      success: 1,
    });

    // Return combined response: JSON metadata + audio
    // Use multipart or a custom format: JSON header + audio body
    const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());

    // Send as JSON with base64 audio embedded
    res.json({
      ...refineData,
      audio_base64: audioBuffer.toString('base64'),
      audio_mime: 'audio/mpeg',
    });

  } catch (err) {
    console.error('Refine-speak error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MESSAGES — supervisor/safety notes per person
// ============================================================
app.get('/api/messages/:person_id', (req, res) => {
  try {
    // Legacy message support — still reads from JSON files for backward compatibility
    const msgs = DB.legacyMessages.getForPerson(req.params.person_id);
    res.json(msgs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/messages/:person_id', (req, res) => {
  try {
    // Legacy message support
    let msgs = DB.legacyMessages.getForPerson(req.params.person_id);
    const msg = {
      id: 'msg_' + Date.now(),
      from: req.body.from || 'Admin',
      from_role: req.body.from_role || 'Administrator',
      text: req.body.text,
      created_at: new Date().toISOString(),
      addressed_in_report: null,
    };
    msgs.push(msg);
    DB.legacyMessages.save(req.params.person_id, msgs);
    res.json({ success: true, message: msg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/messages/:person_id/mark-addressed', (req, res) => {
  try {
    let msgs = DB.legacyMessages.getForPerson(req.params.person_id);
    const { message_ids, report_id } = req.body;
    msgs = msgs.map(m => {
      if (message_ids.includes(m.id)) return { ...m, addressed_in_report: report_id };
      return m;
    });
    DB.legacyMessages.save(req.params.person_id, msgs);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// NEW MESSAGING — chain of command messaging
// ============================================================

// Get contacts (who can this person message)
app.get('/api/v2/contacts/:person_id', (req, res) => {
  try {
    const contacts = DB.contacts.getForPerson(req.params.person_id);
    res.json(contacts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get conversation list (all active conversations with unread counts)
app.get('/api/v2/conversations/:person_id', (req, res) => {
  try {
    const conversations = DB.contacts.getConversationList(req.params.person_id);
    res.json(conversations);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get messages between two people
app.get('/api/v2/messages/:person_id/:contact_id', (req, res) => {
  try {
    // Verify they're allowed to see this conversation
    if (!DB.contacts.canMessage(req.params.person_id, req.params.contact_id)) {
      return res.status(403).json({ error: 'Not authorized to view this conversation' });
    }
    const msgs = DB.messages.getConversation(req.params.person_id, req.params.contact_id);
    // Mark messages as read
    DB.db.prepare(`
      UPDATE messages SET read_at = ? WHERE to_id = ? AND from_id = ? AND read_at IS NULL
    `).run(new Date().toISOString(), req.params.person_id, req.params.contact_id);
    res.json(msgs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send a message
app.post('/api/v2/messages', (req, res) => {
  try {
    const { from_id, to_id, content, type } = req.body;
    if (!from_id || !to_id || !content) {
      return res.status(400).json({ error: 'from_id, to_id, and content required' });
    }

    // Enforce chain of command rules (safety_alert bypasses)
    if (type !== 'safety_alert' && !DB.contacts.canMessage(from_id, to_id)) {
      return res.status(403).json({ error: 'Not authorized to message this person. You can only message your direct supervisor, your team, or your crew.' });
    }

    // Get names for denormalization
    const fromPerson = DB.db.prepare('SELECT name FROM people WHERE id = ?').get(from_id);
    const toPerson = DB.db.prepare('SELECT name FROM people WHERE id = ?').get(to_id);

    const result = DB.messages.create({
      from_id,
      to_id,
      from_name: fromPerson ? fromPerson.name : '',
      to_name: toPerson ? toPerson.name : '',
      content,
      type: type || 'text',
      audio_file: req.body.audio_file || null,
      photo: req.body.photo || null,
      metadata: req.body.metadata || {},
    });

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send group message (to all direct reports)
app.post('/api/v2/messages/group', (req, res) => {
  try {
    const { from_id, content, type } = req.body;
    if (!from_id || !content) {
      return res.status(400).json({ error: 'from_id and content required' });
    }

    const fromPerson = DB.db.prepare('SELECT name, role_level FROM people WHERE id = ?').get(from_id);
    if (!fromPerson || fromPerson.role_level < 2) {
      return res.status(403).json({ error: 'Only supervisors can send group messages' });
    }

    // Get all direct reports
    const team = DB.people.getTeam(from_id);
    const results = [];

    for (const member of team) {
      const result = DB.messages.create({
        from_id,
        to_id: member.id,
        from_name: fromPerson.name,
        to_name: member.name,
        content,
        type: type || 'text',
        metadata: { group: true },
      });
      results.push(result);
    }

    res.json({ success: true, sent_to: team.length, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send a photo message
const msgPhotoDir = path.join(__dirname, 'message-photos');
if (!fs.existsSync(msgPhotoDir)) fs.mkdirSync(msgPhotoDir);
const msgPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, msgPhotoDir),
  filename: (req, file, cb) => cb(null, `msg_${Date.now()}_${file.originalname}`),
});
const msgPhotoUpload = multer({ storage: msgPhotoStorage, limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/v2/messages/photo', msgPhotoUpload.single('photo'), (req, res) => {
  try {
    const { from_id, to_id } = req.body;
    if (!from_id || !to_id || !req.file) {
      return res.status(400).json({ error: 'from_id, to_id, and photo required' });
    }
    const fromPerson = DB.db.prepare('SELECT name FROM people WHERE id = ?').get(from_id);
    const toPerson = DB.db.prepare('SELECT name FROM people WHERE id = ?').get(to_id);
    const result = DB.messages.create({
      from_id, to_id,
      from_name: fromPerson ? fromPerson.name : '',
      to_name: toPerson ? toPerson.name : '',
      content: '📷 Photo',
      type: 'photo',
      photo: req.file.filename,
      metadata: {},
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Serve message photos
app.get('/api/message-photos/:filename', (req, res) => {
  const filePath = path.join(msgPhotoDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Photo not found' });
  res.sendFile(filePath);
});

// Voice message storage
const msgAudioDir = path.join(__dirname, 'message-audio');
if (!fs.existsSync(msgAudioDir)) fs.mkdirSync(msgAudioDir);
const msgAudioStorage = multer.diskStorage({
  destination: msgAudioDir,
  filename: (req, file, cb) => {
    const ext = file.originalname.split('.').pop() || 'webm';
    cb(null, `msg_${Date.now()}_audio.${ext}`);
  }
});
const msgAudioUpload = multer({ storage: msgAudioStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Send voice message — records audio, transcribes via Whisper (hidden), stores both
app.post('/api/v2/messages/voice', msgAudioUpload.single('audio'), async (req, res) => {
  try {
    const { from_id, to_id } = req.body;
    if (!from_id || !to_id || !req.file) {
      return res.status(400).json({ error: 'from_id, to_id, and audio required' });
    }

    // Transcribe via Whisper (hidden from user, stored for AI)
    let transcript = '';
    try {
      const audioBuffer = fs.readFileSync(req.file.path);
      const ext = req.file.originalname.split('.').pop() || 'webm';
      const mimeMap = { m4a: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav' };
      const mime = mimeMap[ext] || 'audio/webm';
      const blob = new Blob([audioBuffer], { type: mime });
      const form = new FormData();
      form.append('file', blob, `voice_msg.${ext}`);
      form.append('model', 'whisper-1');
      form.append('response_format', 'json');
      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });
      if (whisperRes.ok) {
        const data = await whisperRes.json();
        transcript = data.text || '';
      }
    } catch (e) { console.error('Voice msg transcription error:', e); }

    const fromPerson = DB.db.prepare('SELECT name FROM people WHERE id = ?').get(from_id);
    const toPerson = DB.db.prepare('SELECT name FROM people WHERE id = ?').get(to_id);

    const result = DB.messages.create({
      from_id, to_id,
      from_name: fromPerson ? fromPerson.name : '',
      to_name: toPerson ? toPerson.name : '',
      content: '🎤 Voice message',
      type: 'voice',
      audio_file: req.file.filename,
      metadata: { transcript },  // Hidden transcript for AI only
    });

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Serve message audio files
app.get('/api/message-audio/:filename', (req, res) => {
  const filePath = path.join(msgAudioDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Audio not found' });
  res.sendFile(filePath);
});

// Get unread count for a person
app.get('/api/v2/unread/:person_id', (req, res) => {
  try {
    const unread = DB.messages.getUnread(req.params.person_id);
    res.json({ count: unread.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Toggle lead man status
app.put('/api/people/:id/lead-man', (req, res) => {
  try {
    const person = DB.db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id);
    if (!person) return res.status(404).json({ error: 'Person not found' });

    // If setting as lead man, clear any existing lead man under the same supervisor
    if (req.body.is_lead_man) {
      DB.db.prepare('UPDATE people SET is_lead_man = 0 WHERE supervisor_id = ? AND id != ?')
        .run(person.supervisor_id, req.params.id);
    }

    DB.db.prepare('UPDATE people SET is_lead_man = ? WHERE id = ?')
      .run(req.body.is_lead_man ? 1 : 0, req.params.id);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Save contact order for a person
app.put('/api/people/:id/contact-order', (req, res) => {
  try {
    const { order } = req.body; // array of contact_ids in desired order
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });

    const deleteStmt = DB.db.prepare('DELETE FROM contact_order WHERE person_id = ?');
    const insertStmt = DB.db.prepare('INSERT INTO contact_order (person_id, contact_id, sort_order) VALUES (?, ?, ?)');

    DB.db.transaction(() => {
      deleteStmt.run(req.params.id);
      order.forEach((contactId, i) => {
        insertStmt.run(req.params.id, contactId, i);
      });
    })();

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get contact order for a person
app.get('/api/people/:id/contact-order', (req, res) => {
  try {
    const rows = DB.db.prepare('SELECT contact_id, sort_order FROM contact_order WHERE person_id = ? ORDER BY sort_order')
      .all(req.params.id);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// ============================================================
// DAILY PLANS
// ============================================================

// Get today's plan for a supervisor
app.get('/api/daily-plans/:person_id', (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const plan = DB.dailyPlans.getByDate(date, req.params.person_id);
    if (!plan) return res.json({ plan: null, tasks: [] });
    const tasks = DB.dailyPlans.getTasks(plan.id);
    // Enrich tasks with assignee names
    const enriched = tasks.map(t => {
      const person = t.assigned_to ? DB.db.prepare('SELECT name, role_title FROM people WHERE id = ?').get(t.assigned_to) : null;
      return { ...t, assigned_to_name: person ? person.name : null, assigned_to_role: person ? person.role_title : null };
    });
    res.json({ plan, tasks: enriched });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get tasks assigned to a specific person for a date
app.get('/api/daily-plans/my-tasks/:person_id', (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const tasks = DB.dailyPlans.getTasksForPerson(req.params.person_id, date);
    // Enrich with supervisor name
    const enriched = tasks.map(t => {
      const supervisor = DB.db.prepare('SELECT name FROM people WHERE id = ?').get(t.created_by);
      return { ...t, created_by_name: supervisor ? supervisor.name : null };
    });
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create or get plan for a date, then add a task
app.post('/api/daily-plans/:person_id/tasks', (req, res) => {
  try {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    const plan = DB.dailyPlans.getOrCreate(date, req.params.person_id, req.body.trade);
    const task = DB.dailyPlans.addTask({ ...req.body, plan_id: plan.id });
    res.json(task);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update a task
app.put('/api/daily-plans/tasks/:task_id', (req, res) => {
  try {
    const result = DB.dailyPlans.updateTask(req.params.task_id, req.body);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete a task
app.delete('/api/daily-plans/tasks/:task_id', (req, res) => {
  try {
    const result = DB.dailyPlans.deleteTask(req.params.task_id);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// PUNCH LIST
// ============================================================

// Get punch items (with optional filters)
app.get('/api/punch-list', (req, res) => {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.trade) filters.trade = req.query.trade;
    if (req.query.assigned_to) filters.assigned_to = req.query.assigned_to;
    if (req.query.created_by) filters.created_by = req.query.created_by;
    res.json(DB.punchList.getAll(filters));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get punch items for a person (created by or assigned to)
app.get('/api/punch-list/person/:person_id', (req, res) => {
  try {
    res.json(DB.punchList.getForPerson(req.params.person_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get punch list stats
app.get('/api/punch-list/stats', (req, res) => {
  try {
    const filters = {};
    if (req.query.trade) filters.trade = req.query.trade;
    res.json(DB.punchList.getStats(filters));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create punch item
app.post('/api/punch-list', (req, res) => {
  try {
    const result = DB.punchList.create(req.body);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update punch item
app.put('/api/punch-list/:id', (req, res) => {
  try {
    const result = DB.punchList.update(req.params.id, req.body);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete punch item
app.delete('/api/punch-list/:id', (req, res) => {
  try {
    const result = DB.punchList.delete(req.params.id);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// PHOTOS — profile photos for people
// ============================================================
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'photos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = file.originalname.split('.').pop() || 'jpg';
    cb(null, `${req.params.person_id}.${ext}`);
  }
});
const photoUpload = multer({ storage: photoStorage, limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/people/:person_id/photo', photoUpload.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo' });
    DB.people.update(req.params.person_id, { photo: req.file.filename });
    res.json({ success: true, photo: req.file.filename });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/photos/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'photos', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Photo not found' });
  res.sendFile(filePath);
});

// ============================================================
// CERTIFICATIONS — file uploads (images, PDFs) for people
// ============================================================
const certStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'certs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const ts = Date.now();
    cb(null, `${req.params.person_id}_${base}_${ts}${ext}`);
  }
});
const certUpload = multer({ storage: certStorage, limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/people/:person_id/certs', certUpload.single('cert'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const person = DB.people.getById(req.params.person_id);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const entry = {
      filename: req.file.filename,
      original_name: req.file.originalname,
      size: req.file.size,
      type: req.file.mimetype,
      uploaded_at: new Date().toISOString()
    };
    // Store in certifications table
    DB.db.prepare('INSERT INTO certifications (person_id, cert_name, file_path, uploaded_at) VALUES (?, ?, ?, ?)').run(
      req.params.person_id, req.file.originalname, req.file.filename, new Date().toISOString()
    );
    res.json({ success: true, file: entry });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/people/:person_id/certs/:filename', (req, res) => {
  try {
    DB.db.prepare('DELETE FROM certifications WHERE person_id = ? AND file_path = ?').run(req.params.person_id, req.params.filename);
    // Delete actual file
    const filePath = path.join(__dirname, 'certs', req.params.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/certs/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'certs', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

// ============================================================
// WEBAUTHN — Face ID / Touch ID registration
// ============================================================
app.post('/api/webauthn/register-options', (req, res) => {
  try {
    const { person_id } = req.body;
    const person = DB.people.getById(person_id);
    if (!person) return res.status(404).json({ error: 'Person not found' });

    const challenge = require('crypto').randomBytes(32).toString('base64url');
    const challengesDir = path.join(__dirname, '.challenges');
    if (!fs.existsSync(challengesDir)) fs.mkdirSync(challengesDir, { recursive: true });
    fs.writeFileSync(path.join(challengesDir, person_id), challenge);

    res.json({
      challenge,
      rp: { name: 'Voice Report - Horizon Sparks', id: req.hostname === 'localhost' ? 'localhost' : req.hostname },
      user: { id: Buffer.from(person_id).toString('base64url'), name: person.name, displayName: person.name },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/webauthn/register', (req, res) => {
  try {
    const { person_id, credential } = req.body;
    DB.people.update(person_id, {
      webauthn_credential_id: credential.id,
      webauthn_raw_id: credential.rawId,
    });

    const challengePath = path.join(__dirname, '.challenges', person_id);
    if (fs.existsSync(challengePath)) fs.unlinkSync(challengePath);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/webauthn/login-options', (req, res) => {
  try {
    const people = DB.db.prepare("SELECT id, webauthn_credential_id FROM people WHERE webauthn_credential_id IS NOT NULL AND status = 'active'").all();
    if (people.length === 0) return res.json({ available: false });

    const challenge = require('crypto').randomBytes(32).toString('base64url');
    fs.writeFileSync(path.join(__dirname, '.challenges', '_login'), challenge);

    res.json({
      available: true,
      challenge,
      rpId: req.hostname === 'localhost' ? 'localhost' : req.hostname,
      allowCredentials: people.map(p => ({ id: p.webauthn_credential_id, type: 'public-key' })),
      userVerification: 'required',
      timeout: 60000,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/webauthn/login', (req, res) => {
  try {
    const { credential_id } = req.body;
    const person = DB.people.getByWebAuthn(credential_id);
    if (!person) return res.status(401).json({ error: 'Credential not recognized' });

    const challengePath = path.join(__dirname, '.challenges', '_login');
    if (fs.existsSync(challengePath)) fs.unlinkSync(challengePath);

    res.json({
      is_admin: false,
      person_id: person.id,
      name: person.name,
      role_title: person.role_title,
      role_level: person.role_level || 1,
      template_id: person.template_id,
      trade: person.trade || '',
      photo: person.photo || null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// REPORTS
// ============================================================
app.post('/api/reports', (req, res) => {
  try {
    const report = req.body;
    if (!report.id) return res.status(400).json({ error: 'Report must have an id' });
    DB.reports.create(report);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/reports', (req, res) => {
  try {
    const filters = {};
    if (req.query.person_id) filters.person_id = req.query.person_id;
    if (req.query.trade) filters.trade = req.query.trade;
    if (req.query.viewer_id) filters.viewer_id = req.query.viewer_id;

    const reports = DB.reports.getAll(filters).map(r => ({
      id: r.id,
      person_id: r.person_id,
      person_name: r.person_name,
      role_title: r.role_title,
      created_at: r.created_at,
      duration_seconds: r.duration_seconds,
      transcript_raw: r.transcript_raw,
      preview: r.transcript_raw ? r.transcript_raw.substring(0, 100) : '',
      status: r.status,
    }));

    res.json(reports);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/reports/:id', (req, res) => {
  const r = DB.reports.getById(req.params.id);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  res.json(r);
});

// Full-text search on reports
app.get('/api/reports/search/:query', (req, res) => {
  try {
    const results = DB.reports.search(req.params.query, req.query.viewer_id);
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// FORMS (manual fillable forms)
// ============================================================
app.post('/api/forms', (req, res) => {
  try {
    const form = req.body;
    const id = `form_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    form.id = id;
    if (!form.created_at) form.created_at = new Date().toISOString();
    writeJson('forms', id, form);
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/forms', (req, res) => {
  try {
    let forms = readJsonDir('forms').map(f => ({
      id: f.id,
      person_id: f.person_id,
      person_name: f.person_name,
      form_type: f.form_type,
      form_title: f.form_title,
      created_at: f.created_at,
    }));
    if (req.query.person_id) {
      forms = forms.filter(f => f.person_id === req.query.person_id);
    }
    forms.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(forms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/forms/:id', (req, res) => {
  const f = readJson('forms', req.params.id);
  if (!f) return res.status(404).json({ error: 'Form not found' });
  res.json(f);
});

// ============================================================
// AUDIO
// ============================================================
app.get('/api/audio/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'audio', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Audio not found' });
  res.sendFile(filePath);
});

// ============================================================
// ANALYTICS ENDPOINTS
// ============================================================
app.post('/api/analytics/events', (req, res) => {
  try {
    const { session_id, person_id, events } = req.body;
    if (!session_id || !events || !Array.isArray(events)) return res.status(400).json({ error: 'Invalid payload' });
    analytics.trackClientEvents(session_id, person_id, events);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/analytics/dashboard', (req, res) => {
  try {
    const { from, to, person_id } = req.query;
    const data = analytics.getDashboard({ from, to, person_id });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/analytics/ai-costs', (req, res) => {
  try {
    const { from, to } = req.query;
    const data = analytics.exportData('analytics_ai_costs', { from, to, limit: 500 });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/analytics/export', (req, res) => {
  try {
    const { table, from, to, limit } = req.query;
    if (!table) return res.status(400).json({ error: 'table parameter required' });
    const data = analytics.exportData(table, { from, to, limit: parseInt(limit) || 1000 });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// SPA fallback (MUST be after all API routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ============================================================
// Start servers
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('===========================================');
  console.log('  Voice Report — Phase 1');
  console.log('===========================================');
  console.log(`  Computer:  http://localhost:${PORT}`);
  console.log(`  Admin PIN: ${process.env.ADMIN_PIN || '12345678'}`);
  console.log(`  Anthropic: ${process.env.ANTHROPIC_API_KEY ? 'OK' : 'MISSING'}`);
  console.log(`  OpenAI:    ${process.env.OPENAI_API_KEY ? 'OK' : 'MISSING'}`);
  console.log('===========================================');
});

const HTTPS_PORT = 3443;
const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
    .listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`  Phone/iPad: https://192.168.1.137:${HTTPS_PORT}`);
      console.log('===========================================');
    });
}
