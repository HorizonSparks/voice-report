/**
 * AI Agent API — powers the Agent sidebar panel with TOOL USE.
 * Admin/support get Opus (full power). Workers get Sonnet.
 * Tools: lookup people, companies, reports, analytics, knowledge.
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

// ---- TOOL DEFINITIONS ----
const AGENT_TOOLS = [
  {
    name: 'lookup_person',
    description: 'Look up a person by name or ID. Returns their role, trade, company, status, and recent activity.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Person name to search for (partial match)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'lookup_company',
    description: 'Look up a company by name. Returns status, tier, people count, report count, products, trades.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Company name to search for' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_company_analytics',
    description: 'Get AI usage analytics for a company. Returns API calls, costs, top users, provider breakdown.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Company ID' },
      },
      required: ['company_id'],
    },
  },
  {
    name: 'get_recent_reports',
    description: 'Get recent reports for a person or company. Returns report dates, trades, and summaries.',
    input_schema: {
      type: 'object',
      properties: {
        person_name: { type: 'string', description: 'Person name to filter by (optional)' },
        company_id: { type: 'string', description: 'Company ID to filter by (optional)' },
        limit: { type: 'number', description: 'Number of reports to return (default 10)' },
      },
    },
  },
  {
    name: 'search_knowledge',
    description: 'Search the trade knowledge base (electrical codes, instrumentation, safety, millwright, pipe fitting). Returns relevant technical information.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for (e.g. "NEC conduit fill", "Rosemount 3051 calibration")' },
        trade: { type: 'string', description: 'Optional trade filter: electrical, instrumentation, millwright, safety' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_system_status',
    description: 'Get current system status: uptime, errors, online users, total people/companies.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_loopfolders_projects',
    description: 'Get commissioning projects from LoopFolders. Returns project names, companies, priorities, deadlines.',
    input_schema: {
      type: 'object',
      properties: {
        company: { type: 'string', description: 'Filter by company name (optional)' },
      },
    },
  },
  {
    name: 'get_loopfolders_status',
    description: 'Get loop folder commissioning status for a project. Returns total folders, completion count, file count, folder details.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project UUID to get loop folders for' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_loopfolders_summary',
    description: 'Get overall commissioning summary across all projects. Total projects, folders, files, completion rates.',
    input_schema: { type: 'object', properties: {} },
  },
];

// ---- TOOL EXECUTORS ----
async function executeTool(toolName, toolInput) {
  try {
    switch (toolName) {
      case 'lookup_person': {
        const { rows } = await DB.db.query(
          `SELECT p.id, p.name, p.role_title, p.role_level, p.trade, p.status, p.company_id, c.name as company_name,
            (SELECT COUNT(*)::int FROM reports r WHERE r.person_id = p.id) as report_count
           FROM people p LEFT JOIN companies c ON c.id = p.company_id
           WHERE p.name ILIKE $1 ORDER BY p.role_level DESC LIMIT 5`,
          [`%${toolInput.name}%`]
        );
        return rows.length > 0 ? JSON.stringify(rows) : `No person found matching "${toolInput.name}"`;
      }
      case 'lookup_company': {
        const { rows } = await DB.db.query(
          `SELECT c.*,
            (SELECT COUNT(*)::int FROM people p WHERE p.company_id = c.id AND p.status = 'active') as people_count,
            (SELECT COUNT(*)::int FROM reports r WHERE r.company_id = c.id) as report_count
           FROM companies c WHERE c.name ILIKE $1 LIMIT 3`,
          [`%${toolInput.name}%`]
        );
        if (rows.length === 0) return `No company found matching "${toolInput.name}"`;
        // Also get products and trades
        for (const co of rows) {
          const { rows: products } = await DB.db.query("SELECT product, status FROM company_products WHERE company_id = $1", [co.id]);
          const { rows: trades } = await DB.db.query("SELECT trade, status FROM company_trades WHERE company_id = $1", [co.id]);
          co.products = products;
          co.trades = trades;
        }
        return JSON.stringify(rows);
      }
      case 'get_company_analytics': {
        const { rows: summary } = await DB.db.query(
          `SELECT COUNT(*)::int as total_calls, SUM(estimated_cost_cents)::int as total_cost_cents,
            COUNT(DISTINCT person_id)::int as unique_users
           FROM ai_usage_log WHERE company_id = $1`,
          [toolInput.company_id]
        );
        const { rows: topUsers } = await DB.db.query(
          `SELECT p.name, SUM(a.estimated_cost_cents)::int as cost, COUNT(*)::int as calls
           FROM ai_usage_log a JOIN people p ON p.id = a.person_id
           WHERE a.company_id = $1 GROUP BY p.name ORDER BY cost DESC LIMIT 5`,
          [toolInput.company_id]
        );
        return JSON.stringify({ summary: summary[0], top_users: topUsers });
      }
      case 'get_recent_reports': {
        let sql = `SELECT r.id, r.report_date, r.created_at, p.name as person_name, p.trade, r.company_id
                    FROM reports r JOIN people p ON p.id = r.person_id WHERE 1=1`;
        const params = [];
        if (toolInput.person_name) {
          params.push(`%${toolInput.person_name}%`);
          sql += ` AND p.name ILIKE $${params.length}`;
        }
        if (toolInput.company_id) {
          params.push(toolInput.company_id);
          sql += ` AND r.company_id = $${params.length}`;
        }
        sql += ` ORDER BY r.created_at DESC LIMIT ${toolInput.limit || 10}`;
        const { rows } = await DB.db.query(sql, params);
        return rows.length > 0 ? JSON.stringify(rows) : 'No reports found';
      }
      case 'search_knowledge': {
        const knowledgeDir = path.join(ROOT, 'knowledge');
        if (!fs.existsSync(knowledgeDir)) return 'Knowledge base not available';
        const q = toolInput.query.toLowerCase();
        const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.json'));
        const results = [];
        for (const file of files) {
          if (toolInput.trade && !file.includes(toolInput.trade)) continue;
          try {
            const data = fs.readFileSync(path.join(knowledgeDir, file), 'utf-8');
            if (data.toLowerCase().includes(q) || q.split(' ').some(w => data.toLowerCase().includes(w))) {
              const parsed = JSON.parse(data);
              results.push({ file: file.replace('.json', ''), content: JSON.stringify(parsed).substring(0, 3000) });
              if (results.length >= 2) break;
            }
          } catch(e) {}
        }
        return results.length > 0 ? JSON.stringify(results) : `No knowledge found for "${toolInput.query}"`;
      }
      case 'get_system_status': {
        const { rows: [dashboard] } = await DB.db.query(`
          SELECT
            (SELECT COUNT(*)::int FROM companies WHERE status = 'active') as active_companies,
            (SELECT COUNT(*)::int FROM people WHERE status = 'active') as total_people,
            (SELECT COUNT(*)::int FROM reports) as total_reports
        `);
        return JSON.stringify({ ...dashboard, uptime: process.uptime(), node_version: process.version });
      }
      // ---- LOOPFOLDERS TOOLS (cross-schema read from horizonsparks) ----
      case 'get_loopfolders_projects': {
        let sql = `SELECT p.id, p.name, p.company, p.description, p.deadline, pr.name as priority,
                    (SELECT COUNT(*)::int FROM horizonsparks.loopfolder lf WHERE lf.project_id = p.id) as folder_count,
                    (SELECT COUNT(*)::int FROM horizonsparks.files f WHERE f.project_id = p.id) as file_count
                   FROM horizonsparks.projects p LEFT JOIN horizonsparks.priority pr ON pr.id = p.priority_id`;
        const params = [];
        if (toolInput.company) { params.push(`%${toolInput.company}%`); sql += ` WHERE p.company ILIKE $1`; }
        sql += ' ORDER BY p.created_at DESC LIMIT 20';
        const { rows } = await DB.db.query(sql, params);
        return rows.length > 0 ? JSON.stringify(rows) : 'No projects found';
      }
      case 'get_loopfolders_status': {
        const { rows: folders } = await DB.db.query(`
          SELECT lf.id, lf.name, lf.tag_number, lf.status, lf.created_at,
            (SELECT COUNT(*)::int FROM horizonsparks.loopfolder_associate_files laf WHERE laf.loop_folder_id = lf.id) as associated_files
          FROM horizonsparks.loopfolder lf
          WHERE lf.project_id = $1
          ORDER BY lf.name
        `, [toolInput.project_id]);
        const { rows: [summary] } = await DB.db.query(`
          SELECT COUNT(*)::int as total,
            COUNT(CASE WHEN status = 'completed' OR status = 'done' THEN 1 END)::int as completed,
            COUNT(CASE WHEN status = 'in_progress' OR status = 'active' THEN 1 END)::int as in_progress
          FROM horizonsparks.loopfolder WHERE project_id = $1
        `, [toolInput.project_id]);
        return JSON.stringify({ summary, folders: folders.slice(0, 20) });
      }
      case 'get_loopfolders_summary': {
        const { rows: [summary] } = await DB.db.query(`
          SELECT
            (SELECT COUNT(*)::int FROM horizonsparks.projects) as total_projects,
            (SELECT COUNT(*)::int FROM horizonsparks.loopfolder) as total_folders,
            (SELECT COUNT(*)::int FROM horizonsparks.files) as total_files,
            (SELECT COUNT(*)::int FROM horizonsparks.users) as total_users
        `);
        const { rows: projects } = await DB.db.query(`
          SELECT p.name, p.company, p.deadline, pr.name as priority,
            (SELECT COUNT(*)::int FROM horizonsparks.loopfolder lf WHERE lf.project_id = p.id) as folders
          FROM horizonsparks.projects p LEFT JOIN horizonsparks.priority pr ON pr.id = p.priority_id
          ORDER BY p.created_at DESC LIMIT 10
        `);
        return JSON.stringify({ summary, projects });
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    return `Tool error: ${err.message}`;
  }
}

// Load knowledge for system prompt context
function loadRelevantKnowledge(query) {
  const knowledgeDir = path.join(ROOT, 'knowledge');
  if (!fs.existsSync(knowledgeDir)) return '';
  const q = query.toLowerCase();
  const keywordMap = {
    'electrical': ['electrical_codes'], 'instrument': ['instrumentation_codes_standards'],
    'pipe': ['pipefitting_codes'], 'millwright': ['millwright_codes_standards'],
    'safety': ['electrical_safety'], 'nec': ['electrical_codes'],
    'calibrat': ['instrumentation_procedures'],
  };
  const matched = new Set();
  for (const [kw, files] of Object.entries(keywordMap)) {
    if (q.includes(kw)) files.forEach(f => matched.add(f));
  }
  const results = [];
  for (const baseName of matched) {
    const fp = path.join(knowledgeDir, `${baseName}.json`);
    if (fs.existsSync(fp)) {
      try { results.push(JSON.stringify(JSON.parse(fs.readFileSync(fp, 'utf-8'))).substring(0, 2000)); } catch(e) {}
    }
    if (results.length >= 2) break;
  }
  return results.join('\n');
}

// POST /api/agent/chat — main agent endpoint with tool use loop
router.post('/chat', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const { message, conversationContext, contactName, contactRole, companyName } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    const isAdmin = actor.is_admin || actor.role_level >= 5;
    const model = isAdmin ? 'claude-opus-4-20250514' : 'claude-sonnet-4-20250514';

    let personId = actor.person_id;
    if (personId === '__admin__') {
      const { rows } = await DB.db.query("SELECT id FROM people WHERE sparks_role = 'admin' LIMIT 1");
      if (rows[0]) personId = rows[0].id;
    }

    const knowledge = loadRelevantKnowledge(message);
    const systemPrompt = `You are the Horizon Sparks AI Agent — an expert assistant for construction trades.

You have TOOLS to look up real data: people, companies, reports, analytics, trade knowledge, system status.
USE TOOLS when the user asks about specific people, companies, or data. Don't guess — look it up.

CONTEXT:
${contactName ? `- Currently viewing: ${contactName} (${contactRole || ''})` : ''}
${companyName ? `- Company: ${companyName}` : ''}
${conversationContext ? `- Recent chat:\n${conversationContext}` : ''}
${knowledge ? `\nKNOWLEDGE:\n${knowledge}` : ''}

RULES:
- Be concise. Construction workers need quick answers.
- Use tools to get real data before answering data questions.
- Give specific code references (NEC, OSHA, ISA) when applicable.
- Don't guess on safety-critical information.`;

    // Tool use loop — Claude may call tools, we execute and send results back
    let messages = [{ role: 'user', content: message }];
    let finalText = '';
    let totalUsage = { input_tokens: 0, output_tokens: 0 };
    let loops = 0;

    while (loops < 5) {
      loops++;
      const result = await callClaude({
        systemPrompt,
        messages,
        maxTokens: 2000,
        model,
        tools: AGENT_TOOLS,
        tracking: {
          requestId: `agent_${Date.now()}_${loops}`,
          personId,
          service: 'agent',
        },
      });

      totalUsage.input_tokens += result.usage?.input_tokens || 0;
      totalUsage.output_tokens += result.usage?.output_tokens || 0;

      // Check if Claude wants to use a tool
      if (result.stop_reason === 'tool_use') {
        const toolUseBlock = result.content.find(b => b.type === 'tool_use');
        if (toolUseBlock) {
          // Execute the tool
          const toolResult = await executeTool(toolUseBlock.name, toolUseBlock.input);
          // Add assistant response + tool result to messages for next round
          messages.push({ role: 'assistant', content: result.content });
          messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: toolResult }] });
          continue;
        }
      }

      // No more tool calls — extract final text
      finalText = result.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || result.text || '';
      break;
    }

    res.json({
      response: finalText,
      model: model.includes('opus') ? 'Opus' : 'Sonnet',
      usage: totalUsage,
      tool_calls: loops - 1,
    });
  } catch (err) {
    console.error('Agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
