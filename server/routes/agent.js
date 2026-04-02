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
const { agentToolCallsTotal, agentSessionsTotal, agentToolLoopsExhausted } = require('../services/metrics');
const { captureError } = require('../services/errorTracking');
const { agentLogger } = require('../services/logger');
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
  // ---- OBSERVABILITY TOOLS ----
  {
    name: 'query_system_metrics',
    description: 'Query real-time system metrics from Prometheus. Get CPU, memory, disk, error rates, request latency, AI costs, database health, and service status. Use this when asked about system health, performance, or monitoring.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', description: 'Specific metric to query: cpu, memory, disk, error_rate, request_rate, latency, ai_cost, db_pool, targets, all (default: all)' },
        time_range: { type: 'string', description: 'Time range: 5m, 15m, 1h, 6h, 24h (default: 5m)' },
      },
    },
  },
  {
    name: 'search_logs',
    description: 'Search application logs via Loki. Find errors, trace requests by correlationId, filter by service/level/container. Use this when asked about errors, failures, what happened, or to investigate issues.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text (e.g. "error", "timeout", a correlationId, a person name)' },
        level: { type: 'string', description: 'Log level filter: info, warn, error (default: all)' },
        container: { type: 'string', description: 'Container filter: voice-report-app-1, pids-web, hasura_horizonsparks, keycloak (default: all)' },
        time_range: { type: 'string', description: 'Time range: 5m, 15m, 1h, 6h, 24h (default: 1h)' },
        limit: { type: 'number', description: 'Max log entries to return (default: 20)' },
      },
    },
  },
  {
    name: 'get_error_issues',
    description: 'Get error tracking issues from GlitchTip (Sentry-compatible). Shows recent crashes, unresolved errors, error counts by project. Use this when asked about bugs, crashes, or what broke.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Filter by project: voice-report-backend, voice-report-frontend, loopfolders-web, pid-ai-model (default: all)' },
        status: { type: 'string', description: 'Issue status: unresolved, resolved (default: unresolved)' },
      },
    },
  },
  {
    name: 'recall_conversation',
    description: 'Recall previous conversations with this user. Shows what you discussed before, what questions they asked, what insights you gave. Use this to build on past context.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term to find in past conversations (optional)' },
        limit: { type: 'number', description: 'Number of recent messages to recall (default: 20)' },
      },
    },
  },
  // ---- RD2: RELATION DATA INTELLIGENCE TOOLS ----
  {
    name: 'trace_company_everything',
    description: 'Get EVERYTHING about a company across both platforms. Voice Report: people, reports, projects, JSAs, punch items. LoopFolders: commissioning projects, loop folders, instruments, P&IDs. Use this when asked about a company overview or "show me everything about X".',
    input_schema: {
      type: 'object',
      properties: {
        company_name: { type: 'string', description: 'Company name to search for (partial match)' },
      },
      required: ['company_name'],
    },
  },
  {
    name: 'trace_instrument_history',
    description: 'Trace the full history of an instrument across both platforms. LoopFolders: loop folder, P&ID, project, status, Excel matches. Voice Report: reports mentioning this tag, form submissions, calibration data. Use for "tell me about instrument X" or "what happened with tag X".',
    input_schema: {
      type: 'object',
      properties: {
        tag_number: { type: 'string', description: 'Instrument tag number (e.g. PI-2246, 201A-PI-2246-01, partial match)' },
      },
      required: ['tag_number'],
    },
  },
  {
    name: 'get_person_work_summary',
    description: 'Get a complete picture of what a person has been working on across both platforms. Reports, tasks, JSAs, form submissions, and any instruments they worked on (traced to LoopFolders). Use for "what has Tommy been doing?" or "show me person X work".',
    input_schema: {
      type: 'object',
      properties: {
        person_name: { type: 'string', description: 'Person name to search for (partial match)' },
        days: { type: 'number', description: 'Number of days to look back (default: 30)' },
      },
      required: ['person_name'],
    },
  },
  {
    name: 'relate_data',
    description: 'Trace how any two entities relate across Voice Report and LoopFolders. Use for questions like "how does Tommy relate to Summit Electrical" or "how does PI-2246 connect to Summit".',
    input_schema: {
      type: 'object',
      properties: {
        entity_a: { type: 'string', description: 'First entity reference: person, company, project, instrument tag, or report subject' },
        entity_b: { type: 'string', description: 'Second entity reference: person, company, project, instrument tag, or report subject' },
      },
      required: ['entity_a', 'entity_b'],
    },
  },
  {
    name: 'analyze_extraction_quality',
    description: 'Analyze P&ID extraction quality across projects. Compare accuracy, find common mistakes, track which projects perform better. Use when asked about extraction quality, model accuracy, software performance, or data quality.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Project name to analyze (optional — analyzes all if not specified)' },
      },
    },
  },
  {
    name: 'get_pipeline_status',
    description: 'Get the full extraction pipeline status: files uploaded → queued → processed → loop folders created. Shows the funnel per project. Use when asked about processing progress, backlog, or pipeline status.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Filter by project name (optional)' },
      },
    },
  },
  {
    name: 'get_box_completeness',
    description: 'Get the completeness matrix for project folder boxes (P&ID, EXCELs, Schematics, I/O_List, Cable_Schedule, ONE_LINE, Location_Drawings, Tests_Reports, Index_Drawing, OTHER). Shows which boxes have files and which are empty. Use when asked about project completeness, missing documents, or box status.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Filter by project name (optional — shows all if not specified)' },
      },
    },
  },
  {
    name: 'get_loop_folder_funnel',
    description: 'Get loop folder status distribution across projects. Shows how many instruments are at each stage: saved, linked, verified, commissioned. Identifies bottlenecks. Use when asked about commissioning progress or loop folder status.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Filter by project name (optional)' },
      },
    },
  },
  {
    name: 'get_extraction_performance',
    description: 'Get extraction performance metrics: processing time per file, instrument counts, auto-detected vs manual tags, box type distribution, prefix patterns. Use when asked about extraction speed, accuracy, how many instruments per P&ID, or performance trends.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Filter by project name (optional)' },
      },
    },
  },
  {
    name: 'compare_extraction_models',
    description: 'Compare CV/OCR extraction (YOLO + EasyOCR) vs AutoCAD PDF annotation extraction for a P&ID file. Shows matched instruments, CV-only detections, PDF-only detections, and accuracy. Use when asked about extraction comparison, model accuracy, CV vs PDF, or dual model validation.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'P&ID filename to analyze (partial match)' },
        project_name: { type: 'string', description: 'Project name to filter by (optional)' },
      },
    },
  },
  {
    name: 'get_tag_quality_report',
    description: 'Analyze tag quality per file — checks for missing prefixes, types, loop numbers, and detects potential OCR errors. Flags files with low quality scores. Use when asked about data quality, tag completeness, or extraction errors.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Filter by project name (optional)' },
        min_instruments: { type: 'number', description: 'Minimum instruments per file to include (default: 5)' },
      },
    },
  },
  // ---- VOICE REPORT DEEP ACCESS TOOLS ----
  {
    name: 'get_jsa_details',
    description: 'Get JSA (Job Safety Analysis) records with hazards, PPE, task descriptions, status, and crew acknowledgments. Use when asked about safety, JSAs, hazards, or safety compliance.',
    input_schema: {
      type: 'object',
      properties: {
        person_name: { type: 'string', description: 'Filter by person name (optional)' },
        company_id: { type: 'string', description: 'Filter by company ID (optional)' },
        status: { type: 'string', description: 'Filter by status: active, completed, all (default: all)' },
        days: { type: 'number', description: 'Look back N days (default: 30)' },
      },
    },
  },
  {
    name: 'get_daily_plans',
    description: 'Get daily plans with tasks, crew assignments, hours worked, and progress. Use when asked about daily plans, task assignments, crew schedules, or work progress.',
    input_schema: {
      type: 'object',
      properties: {
        person_name: { type: 'string', description: 'Filter by person who created the plan (optional)' },
        trade: { type: 'string', description: 'Filter by trade (optional)' },
        date: { type: 'string', description: 'Filter by date YYYY-MM-DD (optional)' },
        days: { type: 'number', description: 'Look back N days (default: 14)' },
      },
    },
  },
  {
    name: 'get_punch_items',
    description: 'Get punch list items — open deficiencies, assigned corrections, priorities, and resolution status. Use when asked about punch items, deficiencies, open issues, or corrections needed.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Filter by company (optional)' },
        status: { type: 'string', description: 'Filter: open, closed, all (default: open)' },
        assigned_to: { type: 'string', description: 'Filter by person name assigned (optional)' },
      },
    },
  },
  {
    name: 'search_reports',
    description: 'Deep search inside voice report transcripts. Full-text search across all reports. Use when asked to find reports mentioning specific instruments, topics, issues, or keywords.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text to find in report transcripts' },
        person_name: { type: 'string', description: 'Filter by person name (optional)' },
        company_id: { type: 'string', description: 'Filter by company (optional)' },
        trade: { type: 'string', description: 'Filter by trade (optional)' },
        days: { type: 'number', description: 'Look back N days (default: 30)' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_team_messages',
    description: 'Get recent team messages and conversations. Use when asked about team communication, what was discussed, or message history.',
    input_schema: {
      type: 'object',
      properties: {
        person_name: { type: 'string', description: 'Filter by person involved (optional)' },
        limit: { type: 'number', description: 'Max messages (default: 20)' },
      },
    },
  },
  {
    name: 'read_insights',
    description: 'Read back saved insights and patterns from your memory. Use when asked about what you learned, patterns noticed, or to recall previous observations.',
    input_schema: {
      type: 'object',
      properties: {
        insight_type: { type: 'string', description: 'Filter by type: preference, pattern, connection, alert (optional)' },
        search: { type: 'string', description: 'Search text in insights (optional)' },
        limit: { type: 'number', description: 'Max insights to return (default: 20)' },
      },
    },
  },
  {
    name: 'get_form_templates',
    description: 'Get available form templates — calibration forms, test reports, inspection checklists. Shows what forms exist, which trades they apply to, and their fields. Use when asked about forms, what forms are available, or how to fill out a form.',
    input_schema: {
      type: 'object',
      properties: {
        trade: { type: 'string', description: 'Filter by trade (optional)' },
        category: { type: 'string', description: 'Filter by category (optional)' },
      },
    },
  },
  {
    name: 'save_insight',
    description: 'Save an insight or pattern you noticed about a user, company, instrument, or system behavior. This builds your long-term memory. Use when you notice something worth remembering for future conversations.',
    input_schema: {
      type: 'object',
      properties: {
        insight_type: { type: 'string', description: 'Type: preference, pattern, connection, alert' },
        content: { type: 'string', description: 'The insight to remember' },
        context: { type: 'string', description: 'What triggered this insight (optional)' },
      },
      required: ['insight_type', 'content'],
    },
  },
];
// ---- OBSERVABILITY CONFIG ----
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://prometheus:9090';
const LOKI_URL = process.env.LOKI_URL || 'http://loki:3100';
const GLITCHTIP_URL = process.env.GLITCHTIP_URL || 'http://glitchtip-web:8080';
function safeParseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
function summarizeExcelMatches(folderValues) {
  const parsed = safeParseJson(folderValues);
  const excelMatches = parsed?._excelMatches;
  if (!excelMatches) return null;
  return {
    count: excelMatches.count || 0,
    files: (excelMatches.files || []).map(file => file.fileName).filter(Boolean),
  };
}
async function findLoopfoldersByTag(tag, limit = 10) {
  const { rows } = await DB.db.query(
    `SELECT lf.id, lf.loop_number, lf.status, lf.folder_values, lf.created_at,
      p.id as project_id, p.name as project_name, p.company as project_company,
      f.id as file_id, f.name as file_name, f.folder as file_folder,
      (SELECT COUNT(*)::int FROM horizonsparks.loopfolder_associate_files laf WHERE laf.project_id = lf.project_id AND laf.loop_number = lf.loop_number) as associated_files
     FROM horizonsparks.loopfolder lf
     JOIN horizonsparks.projects p ON p.id = lf.project_id
     LEFT JOIN horizonsparks.files f ON f.id = lf.file_id
     WHERE lf.loop_number ILIKE $1 OR lf.folder_values::text ILIKE $1
     ORDER BY lf.updated_at DESC NULLS LAST, lf.created_at DESC
     LIMIT $2`,
    [`%${tag}%`, limit]
  );
  return rows.map(row => ({
    id: row.id,
    loop_number: row.loop_number,
    status: row.status,
    project_id: row.project_id,
    project_name: row.project_name,
    project_company: row.project_company,
    file_id: row.file_id,
    file_name: row.file_name,
    file_folder: row.file_folder,
    associated_files: row.associated_files,
    excel_matches: summarizeExcelMatches(row.folder_values),
  }));
}
async function resolveEntity(reference) {
  const value = (reference || '').trim();
  if (!value) return null;
  const { rows: companyRows } = await DB.db.query(
    `SELECT c.id, c.name, c.status, c.tier
     FROM companies c
     WHERE c.name ILIKE $1
     ORDER BY CASE WHEN lower(c.name) = lower($2) THEN 0 ELSE 1 END, c.name
     LIMIT 1`,
    [`%${value}%`, value]
  );
  if (companyRows[0]) {
    return { type: 'company', reference: value, ...companyRows[0] };
  }
  const { rows: personRows } = await DB.db.query(
    `SELECT p.id, p.name, p.role_title, p.trade, p.company_id, c.name as company_name
     FROM people p
     LEFT JOIN companies c ON c.id = p.company_id
     WHERE p.name ILIKE $1
     ORDER BY CASE WHEN lower(p.name) = lower($2) THEN 0 ELSE 1 END, p.role_level DESC, p.name
     LIMIT 1`,
    [`%${value}%`, value]
  );
  if (personRows[0]) {
    return { type: 'person', reference: value, ...personRows[0] };
  }
  const instrumentRows = await findLoopfoldersByTag(value, 3);
  if (instrumentRows[0]) {
    return { type: 'instrument', reference: value, instrument: instrumentRows[0] };
  }
  const { rows: projectRows } = await DB.db.query(
    `SELECT p.id, p.name, p.company, p.company_id
     FROM horizonsparks.projects p
     WHERE p.name ILIKE $1 OR p.company ILIKE $1
     ORDER BY CASE WHEN lower(p.name) = lower($2) THEN 0 ELSE 1 END, p.created_at DESC
     LIMIT 1`,
    [`%${value}%`, value]
  );
  if (projectRows[0]) {
    return { type: 'project', reference: value, ...projectRows[0] };
  }
  return { type: 'unknown', reference: value };
}
function normalizeRelValue(value) {
  return (value || '').toString().trim().toLowerCase();
}
function namesMatch(a, b) {
  const left = normalizeRelValue(a);
  const right = normalizeRelValue(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}
function companiesMatch(entityA, entityB) {
  const companyIdA = entityA?.company_id || (entityA?.type === 'company' ? entityA.id : null);
  const companyIdB = entityB?.company_id || (entityB?.type === 'company' ? entityB.id : null);
  if (companyIdA && companyIdB && companyIdA === companyIdB) return true;
  const companyNameA = entityA?.company_name || entityA?.company || (entityA?.type === 'company' ? entityA.name : null) || entityA?.instrument?.project_company;
  const companyNameB = entityB?.company_name || entityB?.company || (entityB?.type === 'company' ? entityB.name : null) || entityB?.instrument?.project_company;
  return namesMatch(companyNameA, companyNameB);
}
function buildRelationshipPath(entityA, entityB) {
  if (!entityA || !entityB) return [];
  if (entityA.type === 'person' && entityB.type === 'company' && companiesMatch(entityA, entityB)) {
    return [`${entityA.name} -> works for -> ${entityB.name}`];
  }
  if (entityA.type === 'company' && entityB.type === 'person' && companiesMatch(entityA, entityB)) {
    return [`${entityA.name} -> employs -> ${entityB.name}`];
  }
  if (entityA.type === 'project' && entityB.type === 'company' && companiesMatch(entityA, entityB)) {
    return [`${entityA.name} -> project company -> ${entityB.name}`];
  }
  if (entityA.type === 'company' && entityB.type === 'project' && companiesMatch(entityA, entityB)) {
    return [`${entityA.name} -> has LoopFolders project -> ${entityB.name}`];
  }
  if (entityA.type === 'project' && entityB.type === 'instrument') {
    const instrument = entityB.instrument;
    if (instrument && (instrument.project_id === entityA.id || namesMatch(instrument.project_name, entityA.name))) {
      return [
        `${entityA.name} -> contains loop folder -> ${instrument.loop_number}`,
        `${instrument.loop_number} -> relates to instrument -> ${entityB.reference}`,
      ];
    }
  }
  if (entityA.type === 'instrument' && entityB.type === 'project') {
    const instrument = entityA.instrument;
    if (instrument && (instrument.project_id === entityB.id || namesMatch(instrument.project_name, entityB.name))) {
      return [
        `${entityA.reference} -> tracked in loop folder -> ${instrument.loop_number}`,
        `${instrument.loop_number} -> belongs to LoopFolders project -> ${entityB.name}`,
      ];
    }
  }
  if (entityA.type === 'instrument' && entityB.type === 'company') {
    const instrument = entityA.instrument;
    if (instrument.project_company && namesMatch(instrument.project_company, entityB.name)) {
      return [
        `${entityA.reference} -> tracked in loop folder -> ${instrument.loop_number}`,
        `${instrument.loop_number} -> belongs to LoopFolders project -> ${instrument.project_name}`,
        `${instrument.project_name} -> company match -> ${entityB.name}`,
      ];
    }
  }
  if (entityA.type === 'company' && entityB.type === 'instrument') {
    const instrument = entityB.instrument;
    if (instrument.project_company && namesMatch(instrument.project_company, entityA.name)) {
      return [
        `${entityA.name} -> has LoopFolders project -> ${instrument.project_name}`,
        `${instrument.project_name} -> contains loop folder -> ${instrument.loop_number}`,
        `${instrument.loop_number} -> relates to instrument -> ${entityB.reference}`,
      ];
    }
  }
  if (entityA.type === 'person' && entityB.type === 'project' && companiesMatch(entityA, entityB)) {
    return [
      `${entityA.name} -> works for -> ${entityA.company_name}`,
      `${entityA.company_name} -> is tied to project -> ${entityB.name}`,
    ];
  }
  if (entityA.type === 'project' && entityB.type === 'person' && companiesMatch(entityA, entityB)) {
    return [
      `${entityA.name} -> project company -> ${entityA.company || entityB.company_name}`,
      `${entityA.company || entityB.company_name} -> employs -> ${entityB.name}`,
    ];
  }
  if (entityA.type === 'person' && entityB.type === 'instrument') {
    const instrument = entityB.instrument;
    if (entityA.company_name && instrument.project_company && namesMatch(instrument.project_company, entityA.company_name)) {
      return [
        `${entityA.name} -> works for -> ${entityA.company_name}`,
        `${entityA.company_name} -> has LoopFolders project -> ${instrument.project_name}`,
        `${instrument.project_name} -> contains loop folder -> ${instrument.loop_number}`,
        `${instrument.loop_number} -> relates to instrument -> ${entityB.reference}`,
      ];
    }
  }
  if (entityA.type === 'instrument' && entityB.type === 'person') {
    const instrument = entityA.instrument;
    if (entityB.company_name && instrument.project_company && namesMatch(instrument.project_company, entityB.company_name)) {
      return [
        `${entityA.reference} -> tracked in loop folder -> ${instrument.loop_number}`,
        `${instrument.loop_number} -> belongs to LoopFolders project -> ${instrument.project_name}`,
        `${instrument.project_name} -> company match -> ${entityB.company_name}`,
        `${entityB.company_name} -> employs -> ${entityB.name}`,
      ];
    }
  }
  if (entityA.type === 'person' && entityB.type === 'person' && companiesMatch(entityA, entityB)) {
    return [
      `${entityA.name} -> works for -> ${entityA.company_name}`,
      `${entityA.company_name} -> also employs -> ${entityB.name}`,
    ];
  }
  if (entityA.type === 'project' && entityB.type === 'project' && companiesMatch(entityA, entityB)) {
    return [
      `${entityA.name} -> project company -> ${entityA.company || entityA.company_name}`,
      `${entityA.company || entityA.company_name} -> also has project -> ${entityB.name}`,
    ];
  }
  return [];
}
function buildToolFallbackText(toolName, toolResult, prompt) {
  const parsed = safeParseJson(toolResult);
  if (!parsed) return toolResult || `RD2 completed tool work for "${prompt}" but did not receive a final model summary.`;
  switch (toolName) {
    case 'trace_company_everything': {
      const company = parsed.voice_report?.company?.name || prompt;
      const peopleCount = parsed.voice_report?.people?.count ?? 0;
      const reportTotal = parsed.voice_report?.reports?.total ?? 0;
      const projectCount = parsed.voice_report?.projects?.length ?? 0;
      const loopProjectCount = parsed.loopfolders?.projects?.length ?? 0;
      const instruments = parsed.loopfolders?.summary?.total_instruments ?? 0;
      return `${company}: ${peopleCount} people, ${reportTotal} reports, ${projectCount} Voice Report projects, ${loopProjectCount} LoopFolders projects, ${instruments} commissioning instruments tracked.`;
    }
    case 'get_person_work_summary': {
      const person = parsed.person?.name || prompt;
      return `${person}: ${parsed.reports?.length || 0} recent reports, ${parsed.tasks?.length || 0} active tasks, ${parsed.jsas?.length || 0} JSAs, ${parsed.forms?.length || 0} forms, ${parsed.instruments_mentioned?.length || 0} linked commissioning instruments.`;
    }
    case 'trace_instrument_history':
      return parsed.summary || `${prompt}: ${parsed.loopfolders?.folders?.length || 0} LoopFolders matches, ${parsed.voice_report?.report_mentions?.length || 0} report mentions, ${parsed.voice_report?.form_submissions?.length || 0} form submissions.`;
    case 'relate_data':
      return parsed.summary || `RD2 found relationship data for "${prompt}".`;
    case 'query_system_metrics': {
      const m = parsed.metrics || parsed || {};
      return `System health: CPU ${m.cpu ?? 'n/a'}, memory ${m.memory ?? 'n/a'}, disk ${m.disk ?? 'n/a'}, targets ${m.targets_up ?? 'n/a'}/${m.targets_total ?? 'n/a'}, error rate ${m.error_rate ?? 'n/a'}.`;
    }
    default:
      return typeof parsed === 'object' ? JSON.stringify(parsed, null, 2).slice(0, 2500) : String(parsed);
  }
}
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
        let sql = `SELECT r.id, r.created_at::date as report_date, r.created_at, p.name as person_name, p.trade, r.company_id
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
          SELECT lf.id, lf.loop_number, lf.status, lf.created_at,
            f.name as file_name,
            (SELECT COUNT(*)::int FROM horizonsparks.loopfolder_associate_files laf WHERE laf.project_id = lf.project_id AND laf.loop_number = lf.loop_number) as associated_files
          FROM horizonsparks.loopfolder lf
          LEFT JOIN horizonsparks.files f ON f.id = lf.file_id
          WHERE lf.project_id = $1
          ORDER BY lf.loop_number
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
        const matches = await findLoopfoldersByTag(toolInput.tag_number, 10);
        if (matches.length === 0) return `No instrument found matching "${toolInput.tag_number}"`;
        return JSON.stringify(matches.map(match => ({
          loop_number: match.loop_number,
          status: match.status,
          project: match.project_name,
          company: match.project_company,
          file_name: match.file_name,
          associated_files: match.associated_files,
          excel_matches: match.excel_matches,
        })));
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
        return JSON.stringify({ action: 'navigate', ...toolInput, message: `Navigating to ${toolInput.screen}${toolInput.company_name ? ' → ' + toolInput.company_name : ''}${toolInput.person_name ? ' → ' + toolInput.person_name : ''}` });
      }
      // ---- OBSERVABILITY TOOLS ----
      case 'query_system_metrics': {
        const range = toolInput.time_range || '5m';
        const queries = {
          cpu: `1 - avg(rate(node_cpu_seconds_total{mode="idle"}[${range}]))`,
          memory: '1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)',
          disk: '1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})',
          request_rate: `sum(rate(horizon_http_requests_total[${range}]))`,
          error_rate: `sum(rate(horizon_http_requests_total{status_code=~"5.."}[${range}])) / sum(rate(horizon_http_requests_total[${range}])) or vector(0)`,
          latency_p95: `histogram_quantile(0.95, sum(rate(horizon_http_request_duration_seconds_bucket[${range}])) by (le)) or vector(0)`,
          ai_cost_24h: 'sum(increase(horizon_anthropic_cost_usd_total[24h])) or vector(0)',
          ai_calls_24h: 'sum(increase(horizon_anthropic_requests_total[24h])) or vector(0)',
          agent_sessions_24h: 'sum(increase(horizon_agent_sessions_total[24h])) or vector(0)',
          db_pool_total: 'horizon_db_pool_size{state="total"}',
          db_pool_idle: 'horizon_db_pool_size{state="idle"}',
          db_pool_waiting: 'horizon_db_pool_size{state="waiting"}',
          db_size_bytes: 'pg_database_size_bytes{datname="horizon"}',
          targets_up: 'count(up == 1)',
          targets_total: 'count(up)',
        };
        const selected = toolInput.metric && toolInput.metric !== 'all'
          ? Object.fromEntries(Object.entries(queries).filter(([k]) => k.includes(toolInput.metric)))
          : queries;
        const results = {};
        await Promise.all(Object.entries(selected).map(async ([key, query]) => {
          try {
            const r = await fetch(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`);
            if (r.ok) { const d = await r.json(); results[key] = d?.data?.result?.[0]?.value?.[1] ?? null; }
          } catch { results[key] = null; }
        }));
        // Also get target health
        try {
          const r = await fetch(`${PROMETHEUS_URL}/api/v1/targets`);
          if (r.ok) {
            const d = await r.json();
            results.services = (d?.data?.activeTargets || []).map(t => ({ job: t.labels?.job, health: t.health }));
          }
        } catch {}
        return JSON.stringify(results);
      }
      case 'search_logs': {
        const range = toolInput.time_range || '1h';
        const limit = Math.min(toolInput.limit || 20, 50);
        // Build Loki query
        let logQuery = '{container=~".+"}';
        if (toolInput.container) logQuery = `{container="${toolInput.container}"}`;
        if (toolInput.level) logQuery += ` | json | level = "${toolInput.level}"`;
        else logQuery += ' | json';
        if (toolInput.query) logQuery += ` |= "${toolInput.query}"`;
        try {
          const url = `${LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(logQuery)}&limit=${limit}&start=${new Date(Date.now() - parseRange(range)).toISOString()}&end=${new Date().toISOString()}`;
          const r = await fetch(url);
          if (!r.ok) return `Loki query failed: ${r.status}`;
          const d = await r.json();
          const entries = [];
          for (const stream of (d?.data?.result || [])) {
            for (const [ts, line] of (stream.values || [])) {
              try { const parsed = JSON.parse(line); entries.push({ time: parsed.time || new Date(Number(ts) / 1e6).toISOString(), level: parsed.level, msg: parsed.msg, path: parsed.path, status: parsed.status, error: parsed.error, correlationId: parsed.correlationId, container: stream.stream?.container }); }
              catch { entries.push({ time: new Date(Number(ts) / 1e6).toISOString(), line: line.substring(0, 300), container: stream.stream?.container }); }
            }
          }
          entries.sort((a, b) => b.time?.localeCompare(a.time));
          return entries.length > 0 ? JSON.stringify({ total: entries.length, logs: entries.slice(0, limit) }) : 'No logs found matching your query.';
        } catch (e) { return `Log search error: ${e.message}`; }
      }
      case 'get_error_issues': {
        try {
          // Query GlitchTip API for issues
          const status = toolInput.status || 'unresolved';
          const url = `${GLITCHTIP_URL}/api/0/organizations/horizon-sparks/issues/?query=is:${status}&limit=20`;
          const r = await fetch(url);
          if (!r.ok) {
            // Fallback: query the database directly for error events
            const { rows } = await DB.db.query(`
              SELECT service, COUNT(*)::int as error_count, MAX(created_at) as last_error,
                substring(error_message, 1, 200) as last_message
              FROM analytics_api_calls WHERE status_code >= 500
              AND created_at > NOW() - INTERVAL '24 hours'
              GROUP BY service, substring(error_message, 1, 200)
              ORDER BY error_count DESC LIMIT 20
            `).catch(() => ({ rows: [] }));
            if (rows.length > 0) return JSON.stringify({ source: 'analytics_db', errors: rows });
            return 'No recent errors found.';
          }
          const issues = await r.json();
          return JSON.stringify({ source: 'glitchtip', count: issues.length, issues: (issues || []).slice(0, 15).map(i => ({ title: i.title, level: i.level, count: i.count, first_seen: i.firstSeen, last_seen: i.lastSeen, project: i.project?.name })) });
        } catch (e) { return `Error tracking query failed: ${e.message}`; }
      }
      case 'recall_conversation': {
        const limit = Math.min(toolInput.limit || 20, 50);
        let sql = `SELECT role, content, created_at FROM ai_conversations WHERE person_id = $1`;
        const params = [toolInput._personId || 'unknown'];
        if (toolInput.search) { params.push(`%${toolInput.search}%`); sql += ` AND content ILIKE $${params.length}`; }
        sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
        const { rows } = await DB.db.query(sql, params);
        if (rows.length === 0) return 'No previous conversations found with this user.';
        return JSON.stringify({ total: rows.length, messages: rows.reverse().map(r => ({ role: r.role, content: r.content.substring(0, 500), time: r.created_at })) });
      }
      // ---- RD2: RELATION DATA INTELLIGENCE EXECUTORS ----
      case 'trace_company_everything': {
        const name = toolInput.company_name;
        const result = { voice_report: {}, loopfolders: {} };
        // Voice Report: find company
        const { rows: [company] } = await DB.db.query(
          "SELECT * FROM companies WHERE name ILIKE $1 LIMIT 1", [`%${name}%`]
        );
        if (!company) return `No company found matching "${name}" in Voice Report.`;
        result.voice_report.company = { id: company.id, name: company.name, status: company.status, tier: company.tier };
        // Voice Report: people, reports, projects
        const [people, reports, projects, jsas, punchItems] = await Promise.all([
          DB.db.query("SELECT id, name, role_title, trade, status FROM people WHERE company_id = $1 AND status = 'active' ORDER BY role_level DESC", [company.id]),
          DB.db.query("SELECT COUNT(*)::int as total, MAX(created_at) as latest FROM reports WHERE company_id = $1", [company.id]),
          DB.db.query("SELECT id, name, trade, status FROM projects WHERE company_id = $1", [company.id]),
          DB.db.query("SELECT COUNT(*)::int as total, MAX(date) as latest FROM jsa_records WHERE company_id = $1", [company.id]),
          DB.db.query("SELECT COUNT(*)::int as total, COUNT(CASE WHEN status = 'open' THEN 1 END)::int as open FROM punch_items WHERE company_id = $1", [company.id]),
        ]);
        result.voice_report.people = { count: people.rows.length, members: people.rows.slice(0, 10) };
        result.voice_report.reports = reports.rows[0];
        result.voice_report.projects = projects.rows;
        result.voice_report.jsa_records = jsas.rows[0];
        result.voice_report.punch_items = punchItems.rows[0];
        // LoopFolders: find projects by company_id (solid link) or name match (fallback)
        const { rows: lfProjects } = await DB.db.query(
          `SELECT p.id, p.name, p.company, p.company_id, p.deadline, pr.name as priority,
            (SELECT COUNT(*)::int FROM horizonsparks.loopfolder lf WHERE lf.project_id = p.id) as folder_count,
            (SELECT COUNT(*)::int FROM horizonsparks.files f WHERE f.project_id = p.id) as file_count,
            (SELECT COUNT(CASE WHEN lf.status IN ('completed','done') THEN 1 END)::int FROM horizonsparks.loopfolder lf WHERE lf.project_id = p.id) as completed_folders
           FROM horizonsparks.projects p LEFT JOIN horizonsparks.priority pr ON pr.id = p.priority_id
           WHERE p.company_id = $1 OR p.company ILIKE $2`, [company.id, `%${name}%`]
        );
        result.loopfolders.projects = lfProjects;
        // LoopFolders: total instruments and P&IDs
        if (lfProjects.length > 0) {
          const projectIds = lfProjects.map(p => p.id);
          const { rows: [lfSummary] } = await DB.db.query(`
            SELECT COUNT(DISTINCT lf.id)::int as total_instruments,
              COUNT(DISTINCT f.id)::int as total_files
            FROM horizonsparks.loopfolder lf
            LEFT JOIN horizonsparks.files f ON f.project_id = lf.project_id
            WHERE lf.project_id = ANY($1)`, [projectIds]
          );
          result.loopfolders.summary = lfSummary;
        }
        return JSON.stringify(result);
      }
      case 'trace_instrument_history': {
        const tag = toolInput.tag_number;
        const result = { loopfolders: {}, voice_report: {} };
        const folders = await findLoopfoldersByTag(tag, 10);
        result.loopfolders.folders = folders.map(folder => ({
          loop_number: folder.loop_number,
          status: folder.status,
          project: folder.project_name,
          company: folder.project_company,
          file_name: folder.file_name,
          associated_files: folder.associated_files,
          excel_matches: folder.excel_matches,
        }));
        const { rows: reportMentions } = await DB.db.query(
          `SELECT r.id, r.created_at, p.name as person_name, p.trade,
            substring(COALESCE(r.transcript_raw, r.markdown_structured, ''), 1, 240) as transcript_preview
           FROM reports r
           JOIN people p ON p.id = r.person_id
           WHERE r.transcript_raw ILIKE $1 OR r.markdown_structured ILIKE $1
           ORDER BY r.created_at DESC LIMIT 10`,
          [`%${tag}%`]
        );
        result.voice_report.report_mentions = reportMentions;
        const { rows: formMentions } = await DB.db.query(
          `SELECT fs.id, fs.submitted_at, p.name as person_name, ft.name as form_name,
            COALESCE(fs.tag_number, fl.tag_number) as tag_number, fl.loop_type, fl.service
           FROM form_submissions fs
           LEFT JOIN form_loops fl ON fl.id = fs.loop_id
           LEFT JOIN people p ON p.id = fs.person_id
           LEFT JOIN form_templates_v2 ft ON ft.id = fs.template_id
           WHERE fs.tag_number ILIKE $1 OR fl.tag_number ILIKE $1
           ORDER BY fs.submitted_at DESC LIMIT 10`,
          [`%${tag}%`]
        ).catch(() => ({ rows: [] }));
        result.voice_report.form_submissions = formMentions;
        result.summary = `Found ${folders.length} loop folder match(es), ${reportMentions.length} report mention(s), ${formMentions.length} form submission(s) for "${tag}".`;
        return JSON.stringify(result);
      }
      case 'get_person_work_summary': {
        const days = toolInput.days || 30;
        const result = { person: null, reports: [], tasks: [], jsas: [], forms: [], instruments_mentioned: [] };
        // Find person
        const { rows: [person] } = await DB.db.query(
          `SELECT p.id, p.name, p.role_title, p.trade, p.status, c.name as company_name
           FROM people p LEFT JOIN companies c ON c.id = p.company_id
           WHERE p.name ILIKE $1 LIMIT 1`, [`%${toolInput.person_name}%`]
        );
        if (!person) return `No person found matching "${toolInput.person_name}".`;
        result.person = person;
        // Recent reports
        const { rows: reports } = await DB.db.query(
          `SELECT id, created_at, trade, substring(transcript_raw, 1, 200) as preview
           FROM reports WHERE person_id = $1 AND created_at > NOW() - INTERVAL '${days} days'
           ORDER BY created_at DESC LIMIT 15`, [person.id]
        );
        result.reports = reports;
        // Active tasks
        const { rows: tasks } = await DB.db.query(
          `SELECT dpt.id, dpt.title, dpt.description, dpt.trade, dpt.status, dpt.location, dpt.start_date, dpt.target_end_date
           FROM daily_plan_tasks dpt WHERE dpt.assigned_to = $1 AND dpt.status != 'completed'
           ORDER BY dpt.start_date DESC LIMIT 10`, [person.id]
        );
        result.tasks = tasks;
        // Recent JSAs
        const { rows: jsas } = await DB.db.query(
          `SELECT id, date, trade, form_data
           FROM jsa_records WHERE person_id = $1 AND NULLIF(date, '')::date > CURRENT_DATE - INTERVAL '${days} days'
           ORDER BY date DESC LIMIT 5`, [person.id]
        );
        result.jsas = jsas;
        // Form submissions
        const { rows: forms } = await DB.db.query(
          `SELECT fs.id, fs.submitted_at, ft.name as form_name, fl.tag_number, fl.loop_type
           FROM form_submissions fs
           LEFT JOIN form_templates_v2 ft ON ft.id = fs.template_id
           LEFT JOIN form_loops fl ON fl.id = fs.loop_id
           WHERE fs.person_id = $1 AND fs.submitted_at > NOW() - INTERVAL '${days} days'
           ORDER BY fs.submitted_at DESC LIMIT 10`, [person.id]
        ).catch(() => ({ rows: [] }));
        result.forms = forms;
        // Extract instrument tags from reports and match to LoopFolders
        const tagPattern = /\b\d{3}[A-Z]?-[A-Z]{2,4}-\d{3,5}/g;
        const mentionedTags = new Set();
        for (const r of reports) {
          const matches = (r.preview || '').match(tagPattern);
          if (matches) matches.forEach(m => mentionedTags.add(m));
        }
        for (const f of forms) {
          if (f.tag_number) mentionedTags.add(f.tag_number);
        }
        if (mentionedTags.size > 0) {
          const tags = [...mentionedTags];
          const conditions = tags.map((_, i) => `lf.loop_number ILIKE $${i + 1}`).join(' OR ');
          const { rows: instruments } = await DB.db.query(
            `SELECT lf.loop_number, lf.status, p.name as project_name
             FROM horizonsparks.loopfolder lf
             JOIN horizonsparks.projects p ON p.id = lf.project_id
             WHERE ${conditions} LIMIT 20`,
            tags.map(t => `%${t}%`)
          ).catch(() => ({ rows: [] }));
          result.instruments_mentioned = instruments;
        }
        result.summary = `${person.name}: ${reports.length} reports, ${tasks.length} active tasks, ${jsas.length} JSAs, ${forms.length} forms in last ${days} days. ${mentionedTags.size} instrument tags found.`;
        return JSON.stringify(result);
      }
      case 'relate_data': {
        let entityA = await resolveEntity(toolInput.entity_a);
        let entityB = await resolveEntity(toolInput.entity_b);

        if ((entityA?.type === 'unknown' || (entityA?.type === 'person' && entityB?.type === 'company' && !companiesMatch(entityA, entityB))) && entityB?.type === 'company') {
          const { rows: companyPeople } = await DB.db.query(
            `SELECT p.id, p.name, p.role_title, p.trade, p.company_id, c.name as company_name
             FROM people p
             JOIN companies c ON c.id = p.company_id
             WHERE (p.name ILIKE $1 OR split_part(lower(p.name), ' ', 1) LIKE lower($4)) AND c.name ILIKE $2
             ORDER BY CASE WHEN lower(p.name) = lower($3) THEN 0 ELSE 1 END, p.role_level DESC
             LIMIT 1`,
            [`%${toolInput.entity_a}%`, `%${entityB.name}%`, toolInput.entity_a, `${toolInput.entity_a.slice(0,3)}%`]
          );
          if (companyPeople[0]) entityA = { type: 'person', reference: toolInput.entity_a, ...companyPeople[0] };
        }

        if ((entityB?.type === 'unknown' || (entityB?.type === 'person' && entityA?.type === 'company' && !companiesMatch(entityA, entityB))) && entityA?.type === 'company') {
          const { rows: companyPeople } = await DB.db.query(
            `SELECT p.id, p.name, p.role_title, p.trade, p.company_id, c.name as company_name
             FROM people p
             JOIN companies c ON c.id = p.company_id
             WHERE (p.name ILIKE $1 OR split_part(lower(p.name), ' ', 1) LIKE lower($4)) AND c.name ILIKE $2
             ORDER BY CASE WHEN lower(p.name) = lower($3) THEN 0 ELSE 1 END, p.role_level DESC
             LIMIT 1`,
            [`%${toolInput.entity_b}%`, `%${entityA.name}%`, toolInput.entity_b, `${toolInput.entity_b.slice(0,3)}%`]
          );
          if (companyPeople[0]) entityB = { type: 'person', reference: toolInput.entity_b, ...companyPeople[0] };
        }

        const path = buildRelationshipPath(entityA, entityB);
        const direct_matches = [];
        if (entityA?.type === 'person' && entityB?.type === 'company' && entityA.company_id === entityB.id) {
          const { rows: personReports } = await DB.db.query(
            `SELECT COUNT(*)::int as report_count FROM reports WHERE person_id = $1`,
            [entityA.id]
          );
          direct_matches.push({ kind: 'voice_report_person_company', report_count: personReports[0]?.report_count || 0 });
        }
        if (entityA?.type === 'company' && entityB?.type === 'instrument') {
          const instrument = entityB.instrument;
          if (instrument?.project_company?.toLowerCase().includes(entityA.name.toLowerCase())) {
            direct_matches.push({ kind: 'loopfolders_company_instrument', project: instrument.project_name, loop_number: instrument.loop_number });
          }
        }
        if (entityA?.type === 'person' && entityB?.type === 'instrument') {
          const { rows: reportMentions } = await DB.db.query(
            `SELECT COUNT(*)::int as mention_count
             FROM reports
             WHERE person_id = $1 AND (transcript_raw ILIKE $2 OR markdown_structured ILIKE $2)`,
            [entityA.id, `%${toolInput.entity_b}%`]
          );
          if ((reportMentions[0]?.mention_count || 0) > 0) {
            direct_matches.push({ kind: 'voice_report_report_mentions', mention_count: reportMentions[0].mention_count });
          }
        }
        return JSON.stringify({
          entity_a: entityA,
          entity_b: entityB,
          shortest_path: path,
          direct_matches,
          summary: path.length > 0 ? path.join(' | ') : `No direct relationship path found yet between "${toolInput.entity_a}" and "${toolInput.entity_b}".`,
        });
      }
      case 'analyze_extraction_quality': {
        const result = { projects: [], summary: {} };

        // Build project filter
        let projectFilter = '';
        const params = [];
        if (toolInput.project_name) {
          params.push('%' + toolInput.project_name + '%');
          projectFilter = ' WHERE p.name ILIKE $1';
        }

        // Get per-project stats
        const { rows: projects } = await DB.db.query(`
          SELECT p.name, p.company, p.company_id,
            (SELECT COUNT(*)::int FROM horizonsparks.files f WHERE f.project_id = p.id) as total_files,
            (SELECT COUNT(*)::int FROM horizonsparks.files f WHERE f.project_id = p.id AND f.status = 'processed') as processed_files,
            (SELECT COUNT(*)::int FROM horizonsparks.loopfolder lf WHERE lf.project_id = p.id) as loop_folders,
            (SELECT COUNT(*)::int FROM horizonsparks.file_check_logs_result_ia fcl
              JOIN horizonsparks.files f ON f.id = fcl.file_id
              WHERE f.project_id = p.id AND fcl.status = 'success') as successful_extractions,
            (SELECT COUNT(*)::int FROM horizonsparks.box_crop_images bci
              JOIN horizonsparks.files f ON f.id = bci.file_id
              WHERE f.project_id = p.id) as cropped_images
          FROM horizonsparks.projects p${projectFilter}
          ORDER BY p.name
        `, params);

        for (const proj of projects) {
          const processRate = proj.total_files > 0 ? Math.round((proj.processed_files / proj.total_files) * 100) : 0;
          result.projects.push({
            name: proj.name,
            company: proj.company,
            total_files: proj.total_files,
            processed_files: proj.processed_files,
            process_rate: processRate + '%',
            loop_folders: proj.loop_folders,
            successful_extractions: proj.successful_extractions,
            cropped_images: proj.cropped_images,
          });
        }

        // Get extraction result details (instrument counts from successful extractions)
        const { rows: extractionStats } = await DB.db.query(`
          SELECT COUNT(*)::int as total_extractions,
            SUM(CASE WHEN fcl.status = 'success' THEN 1 ELSE 0 END)::int as successful,
            SUM(CASE WHEN fcl.status != 'success' THEN 1 ELSE 0 END)::int as failed
          FROM horizonsparks.file_check_logs_result_ia fcl
        `);

        // Get total instruments detected across all extractions
        const { rows: instrumentStats } = await DB.db.query(`
          SELECT COUNT(*)::int as total_extractions,
            (SELECT COUNT(*)::int FROM horizonsparks.loopfolder) as total_loop_folders,
            (SELECT COUNT(*)::int FROM horizonsparks.box_crop_images) as total_cropped_images,
            (SELECT COUNT(*)::int FROM horizonsparks.files WHERE status = 'processed') as total_processed_files,
            (SELECT COUNT(*)::int FROM horizonsparks.files) as total_files
          FROM horizonsparks.file_check_logs_result_ia
          WHERE status = 'success'
        `);

        result.summary = {
          total_projects: projects.length,
          extraction_stats: extractionStats[0] || {},
          instrument_stats: instrumentStats[0] || {},
          overall_process_rate: instrumentStats[0]?.total_files > 0
            ? Math.round((instrumentStats[0].total_processed_files / instrumentStats[0].total_files) * 100) + '%'
            : '0%',
        };

        return JSON.stringify(result);
      }
      case 'get_pipeline_status': {
        const params = [];
        let filter = '';
        if (toolInput.project_name) { params.push('%' + toolInput.project_name + '%'); filter = ' WHERE p.name ILIKE $1'; }
        const { rows } = await DB.db.query(`
          SELECT p.name, p.company, p.company_id,
            COUNT(DISTINCT f.id)::int as total_files,
            COUNT(DISTINCT CASE WHEN f.status = 'processed' THEN f.id END)::int as processed,
            COUNT(DISTINCT CASE WHEN f.status = 'unprocessed' THEN f.id END)::int as queued,
            COUNT(DISTINCT CASE WHEN f.status = 'error' THEN f.id END)::int as errors,
            COUNT(DISTINCT CASE WHEN f.status = 'in_progress' THEN f.id END)::int as in_progress,
            COUNT(DISTINCT fcl.id)::int as extractions,
            COUNT(DISTINCT lf.id)::int as loop_folders,
            COUNT(DISTINCT bci.id)::int as cropped_images
          FROM horizonsparks.projects p
          LEFT JOIN horizonsparks.files f ON f.project_id = p.id
          LEFT JOIN horizonsparks.file_check_logs_result_ia fcl ON fcl.file_id = f.id AND fcl.status = 'success'
          LEFT JOIN horizonsparks.loopfolder lf ON lf.project_id = p.id
          LEFT JOIN horizonsparks.box_crop_images bci ON bci.file_id = f.id
          ${filter}
          GROUP BY p.name, p.company, p.company_id ORDER BY total_files DESC
        `, params);
        const pipeline = rows.map(r => ({
          ...r,
          process_rate: r.total_files > 0 ? Math.round((r.processed / r.total_files) * 100) + '%' : '0%',
          funnel: r.total_files + ' uploaded → ' + r.queued + ' queued → ' + r.processed + ' processed → ' + r.loop_folders + ' loop folders',
        }));
        const totals = { files: 0, processed: 0, queued: 0, errors: 0, loop_folders: 0, crops: 0 };
        rows.forEach(r => { totals.files += r.total_files; totals.processed += r.processed; totals.queued += r.queued; totals.errors += r.errors; totals.loop_folders += r.loop_folders; totals.crops += r.cropped_images; });
        return JSON.stringify({ projects: pipeline, totals: { ...totals, overall_rate: totals.files > 0 ? Math.round((totals.processed / totals.files) * 100) + '%' : '0%' } });
      }
      case 'get_box_completeness': {
        const params = [];
        let filter = '';
        if (toolInput.project_name) { params.push('%' + toolInput.project_name + '%'); filter = ' AND p.name ILIKE $1'; }
        const { rows } = await DB.db.query(`
          SELECT p.name as project, f.folder, COUNT(f.id)::int as file_count,
            COUNT(CASE WHEN f.status = 'processed' THEN 1 END)::int as processed
          FROM horizonsparks.projects p
          JOIN horizonsparks.files f ON f.project_id = p.id
          WHERE 1=1 ${filter}
          GROUP BY p.name, f.folder ORDER BY p.name, file_count DESC
        `, params);
        // Organize into matrix
        const matrix = {};
        const allBoxes = ['P&ID', 'EXCELs', 'ONE_LINE', 'I/O_List', 'Location_Drawings', 'Tests_Reports', 'Cable_Schedule', 'Schematics', 'Index_Drawing', 'OTHER'];
        rows.forEach(r => {
          if (!matrix[r.project]) matrix[r.project] = {};
          matrix[r.project][r.folder] = { files: r.file_count, processed: r.processed };
        });
        // Fill empty boxes with 0
        Object.keys(matrix).forEach(proj => {
          allBoxes.forEach(box => { if (!matrix[proj][box]) matrix[proj][box] = { files: 0, processed: 0 }; });
        });
        return JSON.stringify({ matrix, box_types: allBoxes });
      }
      case 'get_loop_folder_funnel': {
        const params = [];
        let filter = '';
        if (toolInput.project_name) { params.push('%' + toolInput.project_name + '%'); filter = ' AND p.name ILIKE $1'; }
        const { rows: statusDist } = await DB.db.query(`
          SELECT p.name as project, lf.status, COUNT(lf.id)::int as count
          FROM horizonsparks.loopfolder lf
          JOIN horizonsparks.projects p ON p.id = lf.project_id
          WHERE 1=1 ${filter}
          GROUP BY p.name, lf.status ORDER BY p.name, count DESC
        `, params);
        const { rows: totals } = await DB.db.query(`
          SELECT
            COUNT(*)::int as total_loop_folders,
            COUNT(CASE WHEN status = 'saved' THEN 1 END)::int as saved,
            COUNT(CASE WHEN status IN ('linked', 'associated') THEN 1 END)::int as linked,
            COUNT(CASE WHEN status IN ('verified', 'reviewed') THEN 1 END)::int as verified,
            COUNT(CASE WHEN status IN ('completed', 'done', 'commissioned') THEN 1 END)::int as commissioned
          FROM horizonsparks.loopfolder
        `);
        return JSON.stringify({ by_project: statusDist, totals: totals[0], funnel: 'saved → linked → verified → commissioned' });
      }
      case 'get_extraction_performance': {
        // Aggregates timing, instrument counts, and quality from extraction results
        const params = [];
        let filter = 'WHERE fcl.status = \'success\'';
        if (toolInput.project_name) { params.push('%' + toolInput.project_name + '%'); filter += ' AND p.name ILIKE $' + params.length; }
        const { rows } = await DB.db.query(`
          SELECT f.name as filename, p.name as project, fcl.result::text as result_text, fcl.checked_at
          FROM horizonsparks.file_check_logs_result_ia fcl
          JOIN horizonsparks.files f ON f.id = fcl.file_id
          JOIN horizonsparks.projects p ON p.id = f.project_id
          ${filter}
          ORDER BY fcl.checked_at DESC LIMIT 30
        `, params);
        const stats = { files: 0, total_instruments: 0, total_loops: 0, times: [], manual_count: 0, auto_count: 0, box_types: {}, prefixes: {}, avg_per_file: 0 };
        const fileStats = [];
        for (const row of rows) {
          try {
            const data = JSON.parse(row.result_text);
            const instruments = data.data || [];
            const time = data.processing_time || 0;
            stats.files++;
            stats.total_instruments += instruments.length;
            stats.total_loops += data.loops_detected || 0;
            if (time > 0) stats.times.push(time);
            let manual = 0, auto = 0;
            instruments.forEach(inst => {
              if (inst.isManual) { manual++; stats.manual_count++; } else { auto++; stats.auto_count++; }
              const bt = inst.box_type || 'unknown';
              stats.box_types[bt] = (stats.box_types[bt] || 0) + 1;
              const pf = inst.prefix || 'none';
              stats.prefixes[pf] = (stats.prefixes[pf] || 0) + 1;
            });
            fileStats.push({ filename: data.filename || row.filename, project: row.project, instruments: instruments.length, loops: data.loops_detected || 0, time_sec: time, manual, auto, models: data.models_used || [] });
          } catch (e) { /* skip */ }
        }
        const avgTime = stats.times.length > 0 ? (stats.times.reduce((a, b) => a + b, 0) / stats.times.length).toFixed(2) : 0;
        const maxTime = stats.times.length > 0 ? Math.max(...stats.times).toFixed(2) : 0;
        const minTime = stats.times.length > 0 ? Math.min(...stats.times).toFixed(2) : 0;
        stats.avg_per_file = stats.files > 0 ? Math.round(stats.total_instruments / stats.files) : 0;
        return JSON.stringify({
          summary: { files_analyzed: stats.files, total_instruments: stats.total_instruments, total_loops: stats.total_loops, manual_tags: stats.manual_count, auto_detected: stats.auto_count, accuracy_indicator: stats.auto_count > 0 ? Math.round((stats.auto_count / (stats.auto_count + stats.manual_count)) * 100) + '% auto-detected' : 'no data', avg_instruments_per_file: stats.avg_per_file },
          timing: { avg_seconds: avgTime, min_seconds: minTime, max_seconds: maxTime, total_analyzed: stats.times.length },
          box_types: stats.box_types,
          prefixes: stats.prefixes,
          recent_files: fileStats.slice(0, 10),
        });
      }
      case 'compare_extraction_models': {
        const params = [];
        let filter = 'WHERE fcl.status = \'success\'';
        if (toolInput.filename) { params.push('%' + toolInput.filename + '%'); filter += ' AND f.name ILIKE $' + params.length; }
        if (toolInput.project_name) { params.push('%' + toolInput.project_name + '%'); filter += ' AND p.name ILIKE $' + params.length; }
        const { rows } = await DB.db.query(`
          SELECT f.name as filename, p.name as project, fcl.result::text as result_text, fcl.checked_at
          FROM horizonsparks.file_check_logs_result_ia fcl
          JOIN horizonsparks.files f ON f.id = fcl.file_id
          JOIN horizonsparks.projects p ON p.id = f.project_id
          ${filter}
          ORDER BY fcl.checked_at DESC LIMIT 10
        `, params);
        const comparisons = [];
        for (const row of rows) {
          try {
            const data = JSON.parse(row.result_text);
            const cvInstruments = (data.data || []).length;
            const cvLoops = data.loops_detected || 0;
            const pdfAnnotations = data.pdf_annotations || {};
            const crossRef = data.cross_reference || {};
            comparisons.push({
              filename: data.filename || row.filename,
              project: row.project,
              date: row.checked_at,
              cv_model: {
                loops_detected: cvLoops,
                instruments: cvInstruments,
              },
              pdf_annotations: {
                total_found: pdfAnnotations.total_found || 0,
                instrument_tags: pdfAnnotations.categories?.instrument_tags || 0,
                loop_numbers: pdfAnnotations.categories?.loop_numbers || 0,
                pipe_specs: pdfAnnotations.categories?.pipe_specs || 0,
                notes: pdfAnnotations.categories?.notes || 0,
                drawing_refs: pdfAnnotations.categories?.drawing_refs || 0,
              },
              cross_reference: {
                matched_both: crossRef.matched_both || 0,
                verified: crossRef.verified || 0,
                cv_only: crossRef.ocr_only || 0,
                pdf_only: crossRef.pdf_only_count || 0,
                pdf_only_tags: (crossRef.pdf_only || []).slice(0, 10),
              },
              has_pdf_data: (pdfAnnotations.total_found || 0) > 0,
              agreement: crossRef.matched_both > 0 ? Math.round((crossRef.matched_both / (crossRef.matched_both + (crossRef.ocr_only || 0) + (crossRef.pdf_only_count || 0))) * 100) + '%' : 'no matches yet',
            });
          } catch (e) { /* skip */ }
        }
        if (comparisons.length === 0) return 'No extraction results found matching your criteria.';
        return JSON.stringify({ files_compared: comparisons.length, comparisons });
      }
      case 'get_tag_quality_report': {
        const minInstruments = toolInput.min_instruments || 5;
        const params = [];
        let filter = '';
        if (toolInput.project_name) { params.push('%' + toolInput.project_name + '%'); filter = ' AND p.name ILIKE $1'; }
        const { rows } = await DB.db.query(`
          SELECT f.name as filename, p.name as project, fcl.result::text as result_text,
            length(fcl.result::text) as result_size, fcl.checked_at
          FROM horizonsparks.file_check_logs_result_ia fcl
          JOIN horizonsparks.files f ON f.id = fcl.file_id
          JOIN horizonsparks.projects p ON p.id = f.project_id
          WHERE fcl.status = 'success' ${filter}
          ORDER BY fcl.checked_at DESC LIMIT 20
        `, params);
        const report = [];
        for (const row of rows) {
          try {
            const data = JSON.parse(row.result_text);
            const instruments = data.data || [];
            if (instruments.length < minInstruments) continue;
            let complete = 0, missingPrefix = 0, missingType = 0, missingLoop = 0;
            instruments.forEach(inst => {
              const tag = inst.fullTag || inst.tag || '';
              const parts = tag.split('-');
              if (parts.length >= 3) complete++;
              if (!parts[0] || parts[0].length < 2) missingPrefix++;
              if (!parts[1]) missingType++;
              if (!parts[2]) missingLoop++;
            });
            const quality = instruments.length > 0 ? Math.round((complete / instruments.length) * 100) : 0;
            report.push({
              filename: data.filename || row.filename,
              project: row.project,
              total_instruments: instruments.length,
              loops_detected: data.loops_detected || 0,
              quality_score: quality + '%',
              missing_prefix: missingPrefix,
              missing_type: missingType,
              missing_loop: missingLoop,
              flag: quality < 80 ? 'NEEDS REVIEW' : 'OK',
            });
          } catch (e) { /* skip unparseable */ }
        }
        report.sort((a, b) => parseInt(a.quality_score) - parseInt(b.quality_score));
        return JSON.stringify({ files_analyzed: report.length, report });
      }
      // ---- VOICE REPORT DEEP ACCESS EXECUTORS ----
      case 'get_jsa_details': {
        const days = toolInput.days || 30;
        let sql = `SELECT j.id, j.date, j.trade, j.task_description, j.hazards, j.ppe_required,
          j.weather_conditions, j.emergency_plan, j.status,
          p.name as person_name, p.role_title,
          c.name as company_name,
          (SELECT COUNT(*)::int FROM jsa_acknowledgments ja WHERE ja.jsa_id = j.id) as acknowledgments
          FROM jsa_records j
          JOIN people p ON p.id = j.person_id
          LEFT JOIN companies c ON c.id = j.company_id
          WHERE j.date > NOW() - INTERVAL '${days} days'`;
        const params = [];
        if (toolInput.person_name) { params.push('%' + toolInput.person_name + '%'); sql += ` AND p.name ILIKE $${params.length}`; }
        if (toolInput.company_id) { params.push(toolInput.company_id); sql += ` AND j.company_id = $${params.length}`; }
        sql += ' ORDER BY j.date DESC LIMIT 15';
        const { rows } = await DB.db.query(sql, params);
        if (rows.length === 0) return 'No JSA records found for the specified criteria.';
        return JSON.stringify({ total: rows.length, jsa_records: rows });
      }
      case 'get_daily_plans': {
        const days = toolInput.days || 14;
        let sql = `SELECT dp.id, dp.date, dp.trade, dp.notes, p.name as created_by,
          (SELECT COUNT(*)::int FROM daily_plan_tasks dpt WHERE dpt.plan_id = dp.id) as task_count,
          (SELECT COUNT(*)::int FROM daily_plan_tasks dpt WHERE dpt.plan_id = dp.id AND dpt.status = 'completed') as completed_tasks
          FROM daily_plans dp
          JOIN people p ON p.id = dp.created_by
          WHERE dp.date > NOW() - INTERVAL '${days} days'`;
        const params = [];
        if (toolInput.person_name) { params.push('%' + toolInput.person_name + '%'); sql += ` AND p.name ILIKE $${params.length}`; }
        if (toolInput.trade) { params.push(toolInput.trade); sql += ` AND dp.trade = $${params.length}`; }
        if (toolInput.date) { params.push(toolInput.date); sql += ` AND dp.date::date = $${params.length}::date`; }
        sql += ' ORDER BY dp.date DESC LIMIT 10';
        const { rows: plans } = await DB.db.query(sql, params);
        // Get tasks for each plan
        for (const plan of plans) {
          const { rows: tasks } = await DB.db.query(
            `SELECT dpt.id, dpt.description, dpt.trade, dpt.status, dpt.location, dpt.start_date, dpt.target_end_date,
              pa.name as assigned_to_name
             FROM daily_plan_tasks dpt LEFT JOIN people pa ON pa.id = dpt.assigned_to
             WHERE dpt.plan_id = $1 ORDER BY dpt.start_date`, [plan.id]
          );
          plan.tasks = tasks;
        }
        return JSON.stringify({ total_plans: plans.length, plans });
      }
      case 'get_punch_items': {
        const status = toolInput.status || 'open';
        let sql = `SELECT pi.id, pi.description, pi.status, pi.priority, pi.trade, pi.location, pi.created_at, pi.resolved_at,
          pc.name as created_by_name, pa.name as assigned_to_name, c.name as company_name
          FROM punch_items pi
          LEFT JOIN people pc ON pc.id = pi.created_by
          LEFT JOIN people pa ON pa.id = pi.assigned_to
          LEFT JOIN companies c ON c.id = pi.company_id
          WHERE 1=1`;
        const params = [];
        if (status !== 'all') { params.push(status); sql += ` AND pi.status = $${params.length}`; }
        if (toolInput.company_id) { params.push(toolInput.company_id); sql += ` AND pi.company_id = $${params.length}`; }
        if (toolInput.assigned_to) { params.push('%' + toolInput.assigned_to + '%'); sql += ` AND pa.name ILIKE $${params.length}`; }
        sql += ' ORDER BY pi.created_at DESC LIMIT 20';
        const { rows } = await DB.db.query(sql, params);
        const summary = { total: rows.length, open: rows.filter(r => r.status === 'open').length, closed: rows.filter(r => r.status !== 'open').length };
        return JSON.stringify({ summary, punch_items: rows });
      }
      case 'search_reports': {
        const days = toolInput.days || 30;
        const limit = Math.min(toolInput.limit || 10, 20);
        let sql = `SELECT r.id, r.created_at, r.trade, p.name as person_name, c.name as company_name,
          substring(r.transcript_raw, 1, 300) as transcript_preview,
          ts_rank(r.search_vector, plainto_tsquery($1)) as relevance
          FROM reports r
          JOIN people p ON p.id = r.person_id
          LEFT JOIN companies c ON c.id = r.company_id
          WHERE r.transcript_raw ILIKE $2
          AND r.created_at > NOW() - INTERVAL '${days} days'`;
        const params = [toolInput.query, '%' + toolInput.query + '%'];
        if (toolInput.person_name) { params.push('%' + toolInput.person_name + '%'); sql += ` AND p.name ILIKE $${params.length}`; }
        if (toolInput.company_id) { params.push(toolInput.company_id); sql += ` AND r.company_id = $${params.length}`; }
        if (toolInput.trade) { params.push(toolInput.trade); sql += ` AND r.trade = $${params.length}`; }
        sql += ` ORDER BY r.created_at DESC LIMIT ${limit}`;
        const { rows } = await DB.db.query(sql, params);
        if (rows.length === 0) return `No reports found mentioning "${toolInput.query}" in the last ${days} days.`;
        return JSON.stringify({ total: rows.length, query: toolInput.query, reports: rows });
      }
      case 'get_team_messages': {
        const limit = Math.min(toolInput.limit || 20, 50);
        let sql = `SELECT m.id, m.content, m.created_at, m.message_type,
          pf.name as from_name, pt.name as to_name
          FROM messages m
          LEFT JOIN people pf ON pf.id = m.from_id
          LEFT JOIN people pt ON pt.id = m.to_id
          WHERE 1=1`;
        const params = [];
        if (toolInput.person_name) {
          params.push('%' + toolInput.person_name + '%');
          sql += ` AND (pf.name ILIKE $${params.length} OR pt.name ILIKE $${params.length})`;
        }
        sql += ` ORDER BY m.created_at DESC LIMIT ${limit}`;
        const { rows } = await DB.db.query(sql, params);
        if (rows.length === 0) return 'No team messages found.';
        return JSON.stringify({ total: rows.length, messages: rows.reverse() });
      }
      case 'read_insights': {
        const limit = Math.min(toolInput.limit || 20, 50);
        let sql = `SELECT id, person_id, insight_type, content, context, created_at FROM agent_insights WHERE 1=1`;
        const params = [];
        if (toolInput.insight_type) { params.push(toolInput.insight_type); sql += ` AND insight_type = $${params.length}`; }
        if (toolInput.search) { params.push('%' + toolInput.search + '%'); sql += ` AND content ILIKE $${params.length}`; }
        sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
        const { rows } = await DB.db.query(sql, params);
        if (rows.length === 0) return 'No saved insights found.';
        return JSON.stringify({ total: rows.length, insights: rows });
      }
      case 'get_form_templates': {
        let sql = `SELECT id, name, trade, category, description,
          (SELECT COUNT(*)::int FROM form_fields_v2 ff WHERE ff.template_id = ft.id) as field_count,
          (SELECT COUNT(*)::int FROM form_submissions fs WHERE fs.template_id = ft.id) as submission_count
          FROM form_templates_v2 ft WHERE 1=1`;
        const params = [];
        if (toolInput.trade) { params.push(toolInput.trade); sql += ` AND ft.trade = $${params.length}`; }
        if (toolInput.category) { params.push(toolInput.category); sql += ` AND ft.category = $${params.length}`; }
        sql += ' ORDER BY ft.trade, ft.name';
        const { rows } = await DB.db.query(sql, params);
        return JSON.stringify({ total: rows.length, templates: rows });
      }
      case 'save_insight': {
        const personId = toolInput._personId || null;
        await DB.db.query(
          `INSERT INTO agent_insights (person_id, insight_type, content, context) VALUES ($1, $2, $3, $4)`,
          [personId, toolInput.insight_type, toolInput.content, toolInput.context || null]
        );
        return `Insight saved: [${toolInput.insight_type}] ${toolInput.content}`;
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    return `Tool error: ${err.message}`;
  }
}
// Parse time range string to milliseconds
function parseRange(range) {
  const match = range.match(/^(\d+)(m|h|d)$/);
  if (!match) return 3600000;
  const val = parseInt(match[1]);
  if (match[2] === 'm') return val * 60000;
  if (match[2] === 'h') return val * 3600000;
  if (match[2] === 'd') return val * 86400000;
  return 3600000;
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
    const { message, conversationContext, contactName, contactRole, companyName, currentScreen, currentWorld: clientWorld } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const isAdmin = actor.is_admin || actor.role_level >= 5;
    const model = isAdmin ? 'claude-opus-4-20250514' : 'claude-sonnet-4-20250514';
    // Prometheus: track agent session
    agentSessionsTotal.inc({ model_tier: isAdmin ? 'opus' : 'sonnet' });
    let personId = actor.person_id;
    if (personId === '__admin__') {
      const { rows } = await DB.db.query("SELECT id FROM people WHERE sparks_role = 'admin' LIMIT 1");
      if (rows[0]) personId = rows[0].id;
    }
    const knowledge = loadRelevantKnowledge(message);

    const trimmedMessage = String(message || '').trim();
    const directPromptMatchers = [
      { regex: /^show me everything about\s+(.+?)\??$/i, tool: 'trace_company_everything', map: m => ({ company_name: m[1].trim() }) },
      { regex: /^what has\s+(.+?)\s+been working on\??$/i, tool: 'get_person_work_summary', map: m => ({ person_name: m[1].trim(), days: 30 }) },
      { regex: /^(?:tell me about|what(?:'s| is) the history of)\s+instrument\s+(.+?)\??$/i, tool: 'trace_instrument_history', map: m => ({ tag_number: m[1].trim() }) },
      { regex: /^how is the system doing\??$/i, tool: 'query_system_metrics', map: () => ({ metric: 'all', time_range: '5m' }) },
      { regex: /^how does\s+(.+?)\s+relate to\s+(.+?)\??$/i, tool: 'relate_data', map: m => ({ entity_a: m[1].trim(), entity_b: m[2].trim() }) },
    ];

    for (const matcher of directPromptMatchers) {
      const match = trimmedMessage.match(matcher.regex);
      if (!match) continue;
      const directToolResult = await executeTool(matcher.tool, matcher.map(match));
      const directResponse = buildToolFallbackText(matcher.tool, directToolResult, trimmedMessage);
      const response = {
        response: directResponse,
        model: 'Direct',
        usage: { input_tokens: 0, output_tokens: 0 },
        tool_calls: 1,
      };

      try {
        const sessionId = req.auth?.sessionId || `agent_${Date.now()}`;
        await DB.db.query(
          'INSERT INTO ai_conversations (person_id, session_id, role, content) VALUES ($1, $2, $3, $4)',
          [personId, sessionId, 'user', message.substring(0, 5000)]
        );
        await DB.db.query(
          'INSERT INTO ai_conversations (person_id, session_id, role, content) VALUES ($1, $2, $3, $4)',
          [personId, sessionId, 'assistant', directResponse.substring(0, 5000)]
        );
      } catch (e) {}

      return res.json(response);
    }
    // ---- MEMORY: Load previous conversation context ----
    let memoryContext = '';
    try {
      const { rows: history } = await DB.db.query(
        `SELECT role, content, created_at FROM ai_conversations
         WHERE person_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [personId]
      );
      if (history.length > 0) {
        memoryContext = history.reverse().map(h =>
          `[${new Date(h.created_at).toLocaleString()}] ${h.role}: ${h.content.substring(0, 300)}`
        ).join('\n');
      }
    } catch (e) { /* memory table may not exist for all users */ }
    // Get user's name and role for personalized engagement
    let userName = 'there';
    let userRole = '';
    let userTrade = '';
    try {
      const { rows: [person] } = await DB.db.query(
        'SELECT name, role_title, trade FROM people WHERE id = $1', [personId]
      );
      if (person) { userName = person.name?.split(' ')[0] || 'there'; userRole = person.role_title || ''; userTrade = person.trade || ''; }
    } catch {}
    const systemPrompt = `You are RD2 — Relation Data Intelligence — the AI brain of Horizon Sparks.
You are talking to ${userName}${userRole ? ` (${userRole})` : ''}${userTrade ? `, ${userTrade} trade` : ''}.
You have ${AGENT_TOOLS.length} TOOLS. ALWAYS use tools — never guess about data.
YOU ARE RD2 — RELATION DATA INTELLIGENCE:
You don't just answer questions — you TRACE RELATIONSHIPS across both platforms.
When someone asks about ANYTHING, think about what it CONNECTS to:
- A person → their reports, tasks, instruments, company, projects
- An instrument → its loop folder, P&ID, project, who worked on it, form submissions
- A company → its people, reports, Voice Report projects, LoopFolders projects, commissioning status
- A report → who wrote it, what instruments it mentions, what project it's for
RELATION DATA TOOLS (your most powerful tools):
- trace_company_everything: Full cross-platform company view (Voice Report + LoopFolders)
- trace_instrument_history: Everything about an instrument across both systems
- get_person_work_summary: Complete picture of someone's work (reports, tasks, instruments, forms)
- relate_data: Find the shortest relationship path between two entities
- save_insight: Remember patterns and connections you discover
COMMISSIONING — THE LOOP FOLDER IS THE BOSS:
1. FIRST: get_instrument_details to find the Loop Folder (source of truth)
2. Loop Folder tells you: P&ID, Excel files, status, project
3. THEN: query_pid_results for P&ID drawing details
4. Trace instruments ACROSS folders and drawings
OBSERVABILITY — YOU SEE THE SYSTEM:
- query_system_metrics: CPU, memory, disk, error rates, AI costs, DB health
- search_logs: Find errors, trace requests, investigate issues
- get_error_issues: Crashes, unresolved bugs, error trends
MEMORY — YOU REMEMBER AND LEARN:
- recall_conversation: What you discussed before with this user
- save_insight: Save patterns you notice for future conversations
- Build on previous context — don't make them repeat themselves
ALL TOOLS (37):
Platform: lookup_person, lookup_company, get_company_analytics, get_recent_reports, search_knowledge, get_system_status, navigate_to
LoopFolders: get_loopfolders_projects, get_loopfolders_status, get_loopfolders_summary, query_pid_results, get_instrument_details, get_cropped_instruments, list_project_files, read_shared_file
Analytics: analyze_extraction_quality, get_pipeline_status, get_box_completeness, get_loop_folder_funnel, get_tag_quality_report, compare_extraction_models, get_extraction_performance
Observability: query_system_metrics, search_logs, get_error_issues
Relation Data: trace_company_everything, trace_instrument_history, get_person_work_summary, relate_data
Voice Report Deep: get_jsa_details, get_daily_plans, get_punch_items, search_reports, get_team_messages, get_form_templates
Memory: recall_conversation, save_insight, read_insights
${memoryContext ? `\nPREVIOUS CONVERSATION WITH ${userName.toUpperCase()}:\n${memoryContext}\n` : ''}
REAL-TIME CONTEXT — YOU KNOW WHAT THE USER IS DOING RIGHT NOW:
${clientWorld ? `- Platform: ${clientWorld === 'control-center' ? 'Control Center (admin view)' : 'Voice Report (field operations)'}` : ''}
${currentScreen ? `- Current screen: ${currentScreen}` : ''}
${contactName ? `- Currently viewing: ${contactName} (${contactRole || ''})` : ''}
${companyName ? `- Company: ${companyName}` : ''}
${conversationContext ? `- Recent chat context:\n${conversationContext}` : ''}
Use this context to give relevant answers. If they are messaging someone, you know who. If they are in a company view, you know which company. Tailor your responses to what they are doing RIGHT NOW.
${knowledge ? `\nTRADE KNOWLEDGE:\n${knowledge}` : ''}
P&ID VIEWER KNOWLEDGE — YOU KNOW EVERY BUTTON:
When users ask about the P&ID viewer, how to do things, or what buttons do, use this:

TOOLBAR BUTTONS (left to right):
- Save (green): Saves all changes to the current drawing
- Zoom -/+/%: Zoom in/out the P&ID drawing, shows current zoom level
- Fit Width: Fits the drawing to the viewport width
- Fit Page: Fits the entire drawing in the viewport
- Model Menu (...): Select which AI model to use for extraction (v3, vnv, bubbles)
- Viewer tab: Shows the P&ID drawing with instrument boxes overlaid — this is where you see and click instruments
- Table tab: Shows all detected instruments in a spreadsheet format — sortable columns for tag, prefix, type, loop, suffix
- Loop Folder tab: Shows loop folder associations — which instruments are linked to which loop folders
- Comments: Open/close the comments panel to discuss the drawing with team members
- History: View version history — see previous extractions and changes, restore older versions
- Create Element: Click on the drawing to manually create a new instrument box where the AI missed one
- Bulk Edit Tags: Select multiple tags and change their prefix at once (e.g., change all "201A" to "201B")
- Bulk Edit P&ID: Change the P&ID reference for multiple tags at once
- Select Boxes: Enter selection mode to select multiple instrument boxes for bulk operations
- Copy Tag to Loop: Copy the full tag number to the loop number field for selected instruments
- Lock/Unlock: Lock the file to prevent other users from making changes — locked files show a padlock icon
- Flag: Flag the drawing for review — flagged files show a flag icon in the project file list
- Download Excel: Export all detected instruments to an Excel spreadsheet with columns for tag, prefix, type, loop, suffix, P&ID
- Show Labels: Toggle visibility of instrument label text on the drawing — useful for clean screenshots
- Save to Loop Folder: Save the current tag data to loop folders in the commissioning system
- Browse Folders: Open the project folder browser to navigate between EXCELs, P&IDs, Schematics, etc.
- Sparks AI: Open the AI assistant panel (that is you!)
- Close (X): Close the P&ID viewer and return to the project

ON-CANVAS BUTTONS (appear when you click an instrument):
- Delete (trash): Delete the selected instrument box from the drawing
- Edit (pencil): Open the Edit Tag panel on the right to modify tag details
- Associate Files (folder): Link files from other boxes (Excel, Schematics) to this instrument
- Confirm (check): Mark the tag as verified/confirmed
- Refresh (sync): Re-extract or update the tag data from the AI model
- Color/Label: Categorize the tag with a color label

PROJECT FOLDER BOXES (each box holds different document types):
- EXCELs: Instrument index spreadsheets, calibration data, specifications
- P&ID: Process & Instrumentation Diagrams — the main drawings
- ONE_LINE: Single-line electrical diagrams
- I/O_List: Input/Output lists for DCS/PLC control systems
- Location_Drawings: Physical location drawings showing where instruments are installed
- Tests/Reports: Commissioning test results, calibration certificates
- Cable_Schedule: Cable routing and termination data
- Schematics: Wiring diagrams and control circuit diagrams
- Index_Drawing: Drawing index/register listing all drawings
- OTHER: Miscellaneous documents

DUAL EXTRACTION MODELS — YOUR DEEPEST KNOWLEDGE:
P&IDs are extracted using TWO independent methods:
1. CV/OCR Model (Rabia): YOLO v3 detects instrument shapes on the image + EasyOCR reads the text. This is visual — it sees what a human sees.
2. PDF Annotation Model (Ender): PyMuPDF extracts AutoCAD annotations embedded in the PDF file. This is metadata — it reads what the engineer put into the CAD drawing.

When BOTH methods agree on a tag at the same coordinates = HIGH CONFIDENCE.
When they disagree = needs human review.
CV is better for visual position and hand-drawn additions.
PDF annotations are better for exact tag text (no OCR errors).

Use compare_extraction_models to show the comparison for any P&ID file.
The cross_reference field in extraction results shows: matched_both, ocr_only, pdf_only.

HOW TO GUIDE USERS:
- "How do I export?" → "Click the Excel button in the toolbar — it downloads all tags as a spreadsheet"
- "How do I lock this?" → "Click the Lock icon to prevent others from editing. Click again to unlock"
- "How do I create a tag the AI missed?" → "Click Create Element, then click on the drawing where the instrument is"
- "How do I see older versions?" → "Click History to see all previous extractions and restore any version"
- "How do I link an Excel file to this tag?" → "Click the instrument, then click Associate Files (folder icon) to link files from other boxes"

ENGAGEMENT RULES:
- You MULTIPLY this person's potential. You are their partner, not a chatbot.
- Be concise but warm. Construction workers need quick, clear answers.
- ALWAYS use tools for data questions — never guess.
- Give specific numbers, code references (NEC, OSHA, ISA), and actionable advice.
- Anticipate what they need next based on context and memory.
- When you see a problem in the metrics or logs, proactively mention it.
- When you notice a pattern or connection, use save_insight to remember it.
- Think in RELATIONSHIPS — everything connects to something else. That's your superpower.`;
    // Tool use loop — Claude may call tools, we execute and send results back
    let messages = [{ role: 'user', content: message }];
    let finalText = '';
    let totalUsage = { input_tokens: 0, output_tokens: 0 };
    let loops = 0;
    let navigation = null; // Track navigation instructions
    let lastToolName = null;
    let lastToolResult = '';
    let activeModel = model;
    while (loops < 5) {
      loops++;
      let result;
      try {
        result = await callClaude({
          systemPrompt,
          messages,
          maxTokens: 2000,
          model: activeModel,
          tools: AGENT_TOOLS,
          tracking: {
            requestId: `agent_${Date.now()}_${loops}`,
            personId,
            service: 'agent',
          },
        });
      } catch (err) {
        if (activeModel.includes('opus') && err.message.includes('429')) {
          activeModel = 'claude-sonnet-4-20250514';
          result = await callClaude({
            systemPrompt,
            messages,
            maxTokens: 2000,
            model: activeModel,
            tools: AGENT_TOOLS,
            tracking: {
              requestId: `agent_${Date.now()}_${loops}_fallback`,
              personId,
              service: 'agent',
            },
          });
        } else {
          throw err;
        }
      }
      totalUsage.input_tokens += result.usage?.input_tokens || 0;
      totalUsage.output_tokens += result.usage?.output_tokens || 0;
      if (result.stop_reason === 'tool_use') {
        const toolUseBlock = result.content.find(b => b.type === 'tool_use');
        if (toolUseBlock) {
          if (toolUseBlock.name === 'navigate_to') {
            navigation = toolUseBlock.input;
          }
          if (['recall_conversation', 'save_insight'].includes(toolUseBlock.name)) toolUseBlock.input._personId = personId;
          const toolResult = await executeTool(toolUseBlock.name, toolUseBlock.input);
          lastToolName = toolUseBlock.name;
          lastToolResult = toolResult;
          const toolSuccess = !toolResult.startsWith('Tool error:') && !toolResult.startsWith('Unknown tool:');
          agentToolCallsTotal.inc({ tool_name: toolUseBlock.name, success: toolSuccess ? 'true' : 'false' });
          messages.push({ role: 'assistant', content: result.content });
          messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: toolResult }] });
          continue;
        }
      }
      finalText = result.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || result.text || '';
      break;
    }
    if (!finalText && lastToolResult) {
      finalText = buildToolFallbackText(lastToolName, lastToolResult, message);
    }
    if (loops >= 5 && !finalText) {
      agentToolLoopsExhausted.inc();
    }
    const response = {
      response: finalText,
      model: activeModel.includes('opus') ? 'Opus' : 'Sonnet',
      usage: totalUsage,
      tool_calls: loops - 1,
    };
    if (navigation) response.navigation = navigation;
    // ---- MEMORY: Save conversation to database ----
    try {
      const sessionId = req.auth?.sessionId || `agent_${Date.now()}`;
      await DB.db.query(
        'INSERT INTO ai_conversations (person_id, session_id, role, content) VALUES ($1, $2, $3, $4)',
        [personId, sessionId, 'user', message.substring(0, 5000)]
      );
      if (finalText) {
        await DB.db.query(
          'INSERT INTO ai_conversations (person_id, session_id, role, content) VALUES ($1, $2, $3, $4)',
          [personId, sessionId, 'assistant', finalText.substring(0, 5000)]
        );
      }
    } catch (e) { /* memory save failure is non-fatal */ }
    res.json(response);
  } catch (err) {
    agentLogger.error({ msg: 'agent_chat_error', error: err.message, correlationId: req.correlationId, personId: req.auth?.person_id });
    captureError(err, { route: '/api/agent/chat', personId: req.auth?.person_id, correlationId: req.correlationId });
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;
