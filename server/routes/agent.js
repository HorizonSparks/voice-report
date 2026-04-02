/**
 * AI Agent API — powers the Agent sidebar panel.
 * Admin/support get Opus (full power). Workers get Sonnet (cheaper).
 * Loads knowledge base, conversation context, and company data.
 */
const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');
const { callClaude } = require('../services/ai/anthropicClient');
const DB = require('../../database/db');

const router = Router();
const ROOT = path.join(__dirname, '../..');

// Load knowledge files relevant to a query
function loadRelevantKnowledge(query) {
  const knowledgeDir = path.join(ROOT, 'knowledge');
  if (!fs.existsSync(knowledgeDir)) return '';

  const q = query.toLowerCase();
  const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.json'));
  const relevant = [];

  // Match knowledge files based on query keywords
  const keywordMap = {
    'electrical': ['electrical_codes', 'electrical_procedures', 'electrical_safety'],
    'instrument': ['instrumentation_codes_standards', 'instrumentation_procedures', 'instrumentation_safety', 'instrumentation_troubleshooting', 'instrumentation_materials', 'instrumentation_specialty'],
    'pipe': ['pipefitting_codes', 'pipefitting_procedures', 'pipefitting_safety'],
    'millwright': ['millwright_codes_standards', 'millwright_procedures', 'millwright_safety', 'millwright_materials', 'millwright_troubleshooting'],
    'safety': ['electrical_safety', 'instrumentation_safety', 'jsa_form_structure'],
    'jsa': ['jsa_form_structure'],
    'code': ['electrical_codes', 'instrumentation_codes_standards', 'millwright_codes_standards'],
    'nec': ['electrical_codes'],
    'cable': ['electrical_procedures', 'materials_specs'],
    'conduit': ['electrical_procedures', 'electrical_codes'],
    'calibrat': ['instrumentation_procedures', 'instrumentation_troubleshooting'],
    'commission': ['commissioning'],
    'material': ['materials_specs', 'instrumentation_materials', 'millwright_materials'],
    'crew': ['crew_productivity'],
    'document': ['documentation_paperwork'],
  };

  const matchedFiles = new Set();
  for (const [keyword, fileNames] of Object.entries(keywordMap)) {
    if (q.includes(keyword)) {
      fileNames.forEach(f => matchedFiles.add(f));
    }
  }

  // If no specific match, load general files
  if (matchedFiles.size === 0) {
    matchedFiles.add('electrical_codes');
    matchedFiles.add('instrumentation_codes_standards');
  }

  // Load matched files (limit to 3 to keep context manageable)
  let loaded = 0;
  for (const baseName of matchedFiles) {
    if (loaded >= 3) break;
    const filePath = path.join(knowledgeDir, `${baseName}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const summary = JSON.stringify(data).substring(0, 4000);
        relevant.push(`[${baseName}]: ${summary}`);
        loaded++;
      } catch(e) {}
    }
  }

  return relevant.join('\n\n');
}

// POST /api/agent/chat — main agent endpoint
router.post('/chat', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const { message, conversationContext, contactName, contactRole, companyName } = req.body;

    if (!message) return res.status(400).json({ error: 'message required' });

    // Determine model based on role
    const isAdmin = actor.is_admin || actor.role_level >= 5;
    const model = isAdmin ? 'claude-opus-4-20250514' : 'claude-sonnet-4-20250514';

    // Resolve person ID for tracking
    let personId = actor.person_id;
    if (personId === '__admin__') {
      const { rows } = await DB.db.query("SELECT id FROM people WHERE sparks_role = 'admin' LIMIT 1");
      if (rows[0]) personId = rows[0].id;
    }

    // Build system prompt
    const knowledge = loadRelevantKnowledge(message);
    const systemPrompt = `You are the Horizon Sparks AI Agent — an expert assistant for construction trades (electrical, instrumentation, pipe fitting, millwright, safety).

You help Sparks team members with:
- Technical questions about codes, standards, and procedures (NEC, OSHA, ISA)
- Troubleshooting equipment and installation issues
- Understanding reports, analytics, and company data
- Customer support — analyzing issues and suggesting solutions

CURRENT CONTEXT:
${contactName ? `- Chatting about: ${contactName} (${contactRole || 'team member'})` : ''}
${companyName ? `- Company: ${companyName}` : ''}
${conversationContext ? `- Recent chat messages:\n${conversationContext}` : ''}

${knowledge ? `TRADE KNOWLEDGE BASE:\n${knowledge}` : ''}

RULES:
- Be concise and direct. Construction workers don't have time for long explanations.
- Give specific answers with code references when applicable.
- If asked about a person or company, use the context provided.
- If you don't know something, say so — don't guess on safety-critical information.
- Use trade terminology naturally.`;

    // Build messages
    const messages = [{ role: 'user', content: message }];

    const result = await callClaude({
      systemPrompt,
      messages,
      maxTokens: 1500,
      model,
      tracking: {
        requestId: 'agent_' + Date.now(),
        personId,
        service: 'agent',
      },
    });

    res.json({
      response: result.text,
      model: model.includes('opus') ? 'Opus' : 'Sonnet',
      usage: result.usage,
    });
  } catch (err) {
    console.error('Agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
