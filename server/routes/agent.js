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
  {
    name: 'navigate_to',
    description: 'Navigate the user to a specific screen in the app. Use this when the user asks to "show me", "take me to", "open", or "go to" something. This controls the actual UI.',
    input_schema: {
      type: 'object',
      properties: {
        screen: { type: 'string', description: 'Target screen: dashboard, team, messages, companies, analytics, audit, folders' },
        company_id: { type: 'string', description: 'Company ID to select (for messages/company-detail screens)' },
        company_name: { type: 'string', description: 'Company name (will be resolved to ID if needed)' },
        person_id: { type: 'string', description: 'Person ID to select for chat' },
        person_name: { type: 'string', description: 'Person name (will be resolved to ID if needed)' },
        tab: { type: 'string', description: 'Sidebar tab to open: chats, info, analytics, folders' },
      },
      required: ['screen'],
    },
  },
  {
    name: 'query_pid_results',
    description: 'Query P&ID processing results. Search by filename, project, loop number, tag number, or instrument type. All filters are optional and support partial matching.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'P&ID filename to search for (partial match, e.g. "GI-10-082")' },
        project_id: { type: 'string', description: 'Project UUID to filter by' },
        loop_number: { type: 'string', description: 'Loop number to search for (partial match, e.g. "201A-PI")' },
        tag_number: { type: 'string', description: 'Tag number to search for (partial match, e.g. "PSV-2131")' },
        instrument_type: { type: 'string', description: 'Instrument type filter (e.g. "circle_only", "diamond")' },
        limit: { type: 'number', description: 'Max results to return (default 10)' },
      },
    },
  },
  {
    name: 'get_instrument_details',
    description: 'Get details about a specific instrument tag from loop folders. Returns the loop folder data, cross-referenced Excel matches, associated files, and P&ID source.',
    input_schema: {
      type: 'object',
      properties: {
        tag_number: { type: 'string', description: 'Instrument tag number to search for (e.g. 201A-PI-2246-01, partial match supported)' },
      },
      required: ['tag_number'],
    },
  },
  {
    name: 'get_cropped_instruments',
    description: 'Get cropped instrument images from P&ID drawings. Returns image metadata and count for a file or project.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'File UUID to get cropped images for' },
        project_id: { type: 'string', description: 'Project UUID to get all cropped images for' },
      },
    },
  },
  {
    name: 'list_project_files',
    description: 'List all files in a LoopFolders project. Returns filenames, folders (P&ID, EXCELs, Schematics, etc.), and file paths.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project UUID' },
        folder: { type: 'string', description: 'Filter by folder type: P&ID, EXCELs, Schematics, Location_Drawings, Tests_Reports' },
        filename: { type: 'string', description: 'Search by filename (partial match)' },
      },
    },
  },
  {
    name: 'read_shared_file',
    description: 'Read a file from shared folders. Returns file metadata and content (for text files) or confirms existence (for binary files like PDFs/images).',
    input_schema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'Shared file ID from the shared_files table' },
        folder_id: { type: 'string', description: 'Shared folder ID to list files from' },
      },
    },
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
      // ---- P&ID & INSTRUMENT TOOLS ----
      case 'query_pid_results': {
        // Codex-recommended pattern: all filters optional, wildcard matching, structured output
        const limit = Math.min(toolInput.limit || 10, 20);
        const { rows } = await DB.db.query(`
          SELECT f.id, f.status, f.result::text, m.name as model_name, f.checked_at
          FROM horizonsparks.file_check_logs_result_ia f
          JOIN horizonsparks.model m ON m.id = f.model_id
          WHERE f.status = 'success'
            AND ($1::text IS NULL OR f.result::text ILIKE $1)
            AND ($2::text IS NULL OR f.file_id::text = $2)
          ORDER BY f.checked_at DESC LIMIT $3
        `, [
          toolInput.filename || toolInput.loop_number || toolInput.tag_number ? `%${toolInput.filename || toolInput.loop_number || toolInput.tag_number}%` : null,
          toolInput.project_id || null,
          limit,
        ]);
        if (rows.length === 0) return 'No P&ID processing results found matching your query.';
        // Parse and structure results
        const parsed = rows.map(r => {
          try {
            const data = JSON.parse(r.result);
            let instruments = (data.data || []);
            // Apply additional filters on parsed data
            if (toolInput.loop_number) instruments = instruments.filter(d => (d.loopNumber || '').toLowerCase().includes(toolInput.loop_number.toLowerCase()));
            if (toolInput.tag_number) instruments = instruments.filter(d => (d.tag || d.fullTag || '').toLowerCase().includes(toolInput.tag_number.toLowerCase()));
            if (toolInput.instrument_type) instruments = instruments.filter(d => (d.box_type || '').toLowerCase().includes(toolInput.instrument_type.toLowerCase()));
            return {
              filename: data.filename || data.pdf_name,
              loops_detected: data.loops_detected,
              total_instruments: (data.data || []).length,
              filtered_count: instruments.length,
              instruments: instruments.slice(0, 15).map(d => ({
                tag: d.tag || d.fullTag,
                loop_number: d.loopNumber,
                type: d.box_type,
                coordinates: d.coordinates,
              })),
            };
          } catch(e) { return { parse_error: true, raw_preview: r.result?.substring(0, 300) }; }
        });
        return JSON.stringify({ total_files: rows.length, results: parsed });
      }
      case 'get_instrument_details': {
        const { rows } = await DB.db.query(`
          SELECT lf.loop_number, lf.status, lf.folder_values, p.name as project_name,
            (SELECT COUNT(*)::int FROM horizonsparks.loopfolder_associate_files laf WHERE laf.loop_folder_id = lf.id) as associated_files
          FROM horizonsparks.loopfolder lf
          JOIN horizonsparks.projects p ON p.id = lf.project_id
          WHERE lf.loop_number ILIKE $1
          LIMIT 10
        `, [`%${toolInput.tag_number}%`]);
        if (rows.length === 0) return `No instrument found matching "${toolInput.tag_number}"`;
        const results = rows.map(r => {
          let excelMatches = null;
          try {
            const vals = typeof r.folder_values === 'string' ? JSON.parse(r.folder_values) : r.folder_values;
            excelMatches = vals?._excelMatches;
          } catch(e) {}
          return {
            loop_number: r.loop_number,
            status: r.status,
            project: r.project_name,
            associated_files: r.associated_files,
            excel_matches: excelMatches ? { count: excelMatches.count, files: (excelMatches.files || []).map(f => f.fileName) } : null,
          };
        });
        return JSON.stringify(results);
      }
      case 'get_cropped_instruments': {
        let sql = `SELECT COUNT(*)::int as total_crops FROM horizonsparks.box_crop_images WHERE 1=1`;
        const params = [];
        if (toolInput.file_id) { params.push(toolInput.file_id); sql += ` AND file_id = $${params.length}`; }
        const { rows: [count] } = await DB.db.query(sql, params);
        // Also get a sample
        let sampleSql = `SELECT id, file_id, created_at FROM horizonsparks.box_crop_images`;
        if (toolInput.file_id) { sampleSql += ` WHERE file_id = '${toolInput.file_id}'`; }
        sampleSql += ' ORDER BY created_at DESC LIMIT 5';
        const { rows: samples } = await DB.db.query(sampleSql);
        return JSON.stringify({ total_cropped_images: count.total_crops, samples });
      }
      case 'list_project_files': {
        let sql = `SELECT f.id, f.name, f.folder, f.file_path, f.status, f.created_at
                   FROM horizonsparks.files f WHERE 1=1`;
        const params = [];
        if (toolInput.project_id) { params.push(toolInput.project_id); sql += ` AND f.project_id = $${params.length}`; }
        if (toolInput.folder) { params.push(toolInput.folder); sql += ` AND f.folder = $${params.length}`; }
        if (toolInput.filename) { params.push(`%${toolInput.filename}%`); sql += ` AND f.name ILIKE $${params.length}`; }
        sql += ' ORDER BY f.folder, f.name LIMIT 30';
        const { rows } = await DB.db.query(sql, params);
        return rows.length > 0 ? JSON.stringify(rows) : 'No files found';
      }
      case 'read_shared_file': {
        if (toolInput.folder_id) {
          // List files in a shared folder
          const { rows } = await DB.db.query(
            `SELECT sf.id, sf.name, sf.type, sf.filename, sf.original_name, sf.url, sf.size_bytes, sf.mime_type, p.name as uploaded_by
             FROM shared_files sf LEFT JOIN people p ON p.id = sf.uploaded_by
             WHERE sf.folder_id = $1 ORDER BY sf.created_at DESC`,
            [toolInput.folder_id]
          );
          return rows.length > 0 ? JSON.stringify(rows) : 'No files in this folder';
        }
        if (toolInput.file_id) {
          const { rows } = await DB.db.query(
            `SELECT sf.*, p.name as uploaded_by_name, shf.name as folder_name
             FROM shared_files sf LEFT JOIN people p ON p.id = sf.uploaded_by
             LEFT JOIN shared_folders shf ON shf.id = sf.folder_id
             WHERE sf.id = $1`,
            [toolInput.file_id]
          );
          if (rows.length === 0) return 'File not found';
          const file = rows[0];
          if (file.type === 'link') return JSON.stringify({ ...file, access_url: file.url });
          // For actual files, check if readable
          const filePath = path.join(ROOT, 'shared-files', file.filename);
          const exists = fs.existsSync(filePath);
          return JSON.stringify({ ...file, exists, download_url: `/api/folders/download/${file.filename}` });
        }
        return 'Provide either folder_id or file_id';
      }
      case 'navigate_to': {
        // Navigation is handled client-side — just return the instruction
        return JSON.stringify({ action: 'navigate', ...toolInput, message: `Navigating to ${toolInput.screen}${toolInput.company_name ? ' → ' + toolInput.company_name : ''}${toolInput.person_name ? ' → ' + toolInput.person_name : ''}` });
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
    const systemPrompt = `You are the Horizon Sparks AI Agent — an expert assistant for construction trades (electrical, instrumentation, pipe fitting, millwright, safety).

You have 13 TOOLS to access real platform data. ALWAYS use tools — never guess about data.

COMMISSIONING INTELLIGENCE — THE LOOP FOLDER IS THE BOSS:
The Loop Folder is the central organized product that RELATES all data together.
When asked about any instrument, tag, or commissioning question:
1. FIRST: Use get_instrument_details to find the Loop Folder (this is the source of truth)
2. The Loop Folder tells you: which P&ID the instrument is on, which Excel files reference it, its status, its project
3. THEN: Use query_pid_results if you need the P&ID drawing details (coordinates, all instruments on that drawing)
4. You can trace instruments ACROSS loop folders — from one folder to another, one P&ID to another
5. You can tell the user exactly WHERE an instrument is: which project, which P&ID, which position on the drawing

TOOLS AVAILABLE:
- lookup_person / lookup_company: find people and companies
- get_company_analytics: AI usage and costs per company
- get_recent_reports: voice reports by person or company
- search_knowledge: 40-file trade knowledge base (NEC, ISA, OSHA codes)
- get_system_status: platform health
- get_loopfolders_projects / status / summary: commissioning project data
- query_pid_results: search P&ID processed data (loops, tags, instruments, coordinates)
- get_instrument_details: THE MAIN TOOL — loop folder lookup with Excel cross-references
- get_cropped_instruments: cropped instrument images from P&IDs
- navigate_to: control the app UI (open screens, select companies/people)

CONTEXT:
${contactName ? `- Currently viewing: ${contactName} (${contactRole || ''})` : ''}
${companyName ? `- Company: ${companyName}` : ''}
${conversationContext ? `- Recent chat:\n${conversationContext}` : ''}
${knowledge ? `\nTRADE KNOWLEDGE:\n${knowledge}` : ''}

RULES:
- Be concise. Construction workers need quick answers.
- ALWAYS use tools for data questions — never guess.
- For instrument questions: Loop Folder FIRST, then P&ID details.
- Give specific code references (NEC, OSHA, ISA) when applicable.
- Don't guess on safety-critical information.
- You can guide users across folders — "This instrument is also referenced in folder X"
- Provide P&ID drawing references: "Found on P&ID GI-10-068 at coordinates (x, y)"`;

    // Tool use loop — Claude may call tools, we execute and send results back
    let messages = [{ role: 'user', content: message }];
    let finalText = '';
    let totalUsage = { input_tokens: 0, output_tokens: 0 };
    let loops = 0;
    let navigation = null; // Track navigation instructions

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
          // Capture navigation instructions
          if (toolUseBlock.name === 'navigate_to') {
            navigation = toolUseBlock.input;
          }
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

    const response = {
      response: finalText,
      model: model.includes('opus') ? 'Opus' : 'Sonnet',
      usage: totalUsage,
      tool_calls: loops - 1,
    };
    if (navigation) response.navigation = navigation;
    res.json(response);
  } catch (err) {
    console.error('Agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
