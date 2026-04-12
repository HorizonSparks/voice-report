/**
 * Project Intelligence Agent (loopfolders.projectIntelligence.v1)
 *
 * The "Master" agent. Claude Opus with bird's-eye project view AND tool-use
 * drill-down into loop folders, P&IDs, and Excel data.
 *
 * STEP 1 — buildProjectSummary() loads compact project stats into the system prompt
 * STEP 2 — Opus reasons and decides where to investigate
 * STEP 3 — Opus uses 4 tools to drill down into specific data
 * STEP 4 — Opus reports findings in natural language like a senior engineer
 */

const { defineAgent } = require('../agentRuntime');
const DB = require('../../../../database/db');

// ── Tool Definitions ────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_folder_details',
    description:
      'Get full details for a single loop folder: folder_values (Excel matches, per-box ' +
      'mappings), associated files, status, and lock state. Use this to drill down into ' +
      'one specific loop when you see something in the summary that needs investigation.',
    input_schema: {
      type: 'object',
      properties: {
        loop_number: {
          type: 'string',
          description: 'The loop number to look up (e.g. "221A-PI-2221-03")',
        },
        project_id: {
          type: 'string',
          description: 'The project UUID',
        },
      },
      required: ['loop_number', 'project_id'],
    },
  },
  {
    name: 'get_pid_tags',
    description:
      'Get all extracted instrument tags from a specific P&ID file. Returns the parsed ' +
      'extraction result: tag names, loop numbers, instrument types, and coordinates. ' +
      'Use this to see exactly what YOLO+OCR found on a drawing.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: {
          type: 'string',
          description: 'The file UUID of the P&ID',
        },
      },
      required: ['file_id'],
    },
  },
  {
    name: 'compare_excel_vs_pid',
    description:
      'Cross-reference what Excel files say about a loop vs what P&ID extraction found. ' +
      'This is the KEY tool for finding mismatches: instruments in Excel but missing from ' +
      'P&ID, or instruments on the drawing not documented in any Excel. Also shows which ' +
      'boxes (Cable Schedule, I/O List, etc.) have data for each instrument.',
    input_schema: {
      type: 'object',
      properties: {
        loop_number: {
          type: 'string',
          description: 'The loop number to cross-reference (e.g. "221A-PI-2221-03")',
        },
        project_id: {
          type: 'string',
          description: 'The project UUID',
        },
      },
      required: ['loop_number', 'project_id'],
    },
  },
  {
    name: 'get_missing_documents',
    description:
      'Find all loop folders in a project where expected boxes are empty or incomplete. ' +
      'Optionally filter by a specific box name (e.g. "Cable_Schedule"). Returns a list ' +
      'of loops and which boxes they are missing.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'The project UUID',
        },
        box_name: {
          type: 'string',
          description: 'Optional: filter to a specific box (e.g. "Cable_Schedule", "I/O_List")',
        },
      },
      required: ['project_id'],
    },
  },
];

// ── Tool Executor ───────────────────────────────────────────────

async function executeTool(toolName, toolInput) {
  const db = DB.db;

  switch (toolName) {
    case 'get_folder_details': {
      const { loop_number, project_id } = toolInput;

      const [folderResult, assocResult, boxResult] = await Promise.all([
        db.query(
          `SELECT lf.id, lf.loop_number, lf.status, lf.folder_values,
                  lf.is_locked, lf.locked_at, lf.is_flagged, lf.flag_comment,
                  lf.billing_status, lf.created_at,
                  f.name as source_file, f.folder as source_folder
           FROM horizonsparks.loopfolder lf
           LEFT JOIN horizonsparks.files f ON f.id = lf.file_id
           WHERE LOWER(lf.loop_number) = LOWER($1) AND lf.project_id = $2`,
          [loop_number, project_id]
        ),
        db.query(
          `SELECT laf.folder_id, laf.file_id, laf.loop_full_tag,
                  f.name as file_name, f.folder as file_folder, f.status as file_status
           FROM horizonsparks.loopfolder_associate_files laf
           JOIN horizonsparks.files f ON f.id = laf.file_id
           WHERE LOWER(laf.loop_number) = LOWER($1) AND laf.project_id = $2`,
          [loop_number, project_id]
        ),
        db.query(
          `SELECT id, name FROM horizonsparks.file_folders WHERE active = true ORDER BY position`
        ),
      ]);

      const folder = folderResult.rows[0];
      if (!folder) return JSON.stringify({ error: 'No loop folder found for ' + loop_number });

      const assocFiles = assocResult.rows;
      const boxMap = {};
      boxResult.rows.forEach(b => { boxMap[b.id] = b.name; });

      // Parse folder_values to extract per-box data (defensive: handle malformed JSONB)
      const fv = (typeof folder.folder_values === 'object' && folder.folder_values) ? folder.folder_values : {};
      const excelMatches = fv._excelMatches || { count: 0, files: [] };

      const boxCoverage = {};
      for (const [key, val] of Object.entries(fv)) {
        if (key.startsWith('_')) continue;
        if (typeof val !== 'object' || val === null) continue;
        const boxName = boxMap[key] || key;
        const mappings = Array.isArray(val.mappings) ? val.mappings : [];
        const files = Array.isArray(val.files) ? val.files : [];
        boxCoverage[boxName] = {
          has_data: mappings.length > 0 || files.length > 0,
          mapping_count: mappings.length,
          file_count: files.length,
          mappings: mappings.map(m => ({ key: m.key, value: m.value })),
        };
      }

      return JSON.stringify({
        loop_number: folder.loop_number,
        status: folder.status,
        is_locked: folder.is_locked,
        is_flagged: folder.is_flagged,
        flag_comment: folder.flag_comment,
        source_file: folder.source_file,
        source_folder: folder.source_folder,
        excel_matches: {
          count: excelMatches.count,
          files: (excelMatches.files || []).map(f => ({
            fileName: f.fileName,
            tagCount: f.tagCount,
            fileFolder: f.fileFolder,
          })),
        },
        box_coverage: boxCoverage,
        associated_files: assocFiles.map(af => ({
          file_name: af.file_name,
          folder: af.file_folder,
          status: af.file_status,
          full_tag: af.loop_full_tag,
        })),
      });
    }

    case 'get_pid_tags': {
      const { file_id } = toolInput;

      // Latest successful extraction only (Codex review: avoid stale results)
      const { rows } = await db.query(
        `SELECT fcl.result, fcl.status, fcl.checked_at, m.name as model_name
         FROM horizonsparks.file_check_logs_result_ia fcl
         JOIN horizonsparks.model m ON m.id = fcl.model_id
         WHERE fcl.file_id = $1 AND fcl.status = 'success'
         ORDER BY fcl.checked_at DESC LIMIT 1`,
        [file_id]
      );

      if (rows.length === 0) {
        return JSON.stringify({ error: 'No successful extraction found for this file' });
      }

      const row = rows[0];
      let parsed;
      try {
        parsed = typeof row.result === 'string' ? JSON.parse(row.result) : row.result;
      } catch (e) {
        return JSON.stringify({
          error: 'Failed to parse extraction result',
          raw_preview: String(row.result).substring(0, 500),
        });
      }

      const instruments = (parsed.data || []).map(d => ({
        tag: d.tag || d.fullTag,
        loop_number: d.loopNumber,
        type: d.box_type,
        coordinates: d.coordinates,
      }));

      // Group by loop number
      const byLoop = {};
      instruments.forEach(inst => {
        const ln = inst.loop_number || 'unknown';
        if (!byLoop[ln]) byLoop[ln] = [];
        byLoop[ln].push(inst);
      });

      return JSON.stringify({
        filename: parsed.filename || parsed.pdf_name,
        model: row.model_name,
        extracted_at: row.checked_at,
        total_instruments: instruments.length,
        loops_detected: Object.keys(byLoop).length,
        by_loop: byLoop,
      });
    }

    case 'compare_excel_vs_pid': {
      const { loop_number, project_id } = toolInput;
      const loopLower = loop_number.toLowerCase();

      // 1. Get folder_values for this loop
      const { rows: [folder] } = await db.query(
        `SELECT lf.folder_values FROM horizonsparks.loopfolder lf
         WHERE LOWER(lf.loop_number) = LOWER($1) AND lf.project_id = $2`,
        [loop_number, project_id]
      );

      if (!folder) {
        return JSON.stringify({ error: 'No loop folder found for ' + loop_number });
      }

      const fv = (typeof folder.folder_values === 'object' && folder.folder_values) ? folder.folder_values : {};
      const excelMatches = fv._excelMatches || { count: 0, files: [] };

      // Get box names
      const { rows: boxes } = await db.query(
        `SELECT id, name FROM horizonsparks.file_folders WHERE active = true ORDER BY position`
      );
      const boxMap = {};
      boxes.forEach(b => { boxMap[b.id] = b.name; });

      // 2. Collect all tags/data from Excel matches per box (defensive: handle malformed)
      const excelData = {};
      for (const [key, val] of Object.entries(fv)) {
        if (key.startsWith('_')) continue;
        if (typeof val !== 'object' || val === null) continue;
        const boxName = boxMap[key] || key;
        const mappings = Array.isArray(val.mappings) ? val.mappings : [];
        if (mappings.length > 0) {
          excelData[boxName] = mappings.map(m => ({
            key: m.key,
            value: m.value,
            matchedTagName: m.matchedTagName,
          }));
        }
      }

      // Collect unique tag names from Excel
      const excelTags = new Set();
      (excelMatches.files || []).forEach(f => {
        (f.tags || []).forEach(t => {
          if (t.matchedTagName) excelTags.add(t.matchedTagName.toLowerCase());
        });
      });

      // 3. Get P&ID extraction results — latest successful only per file (Codex review)
      const { rows: pidFiles } = await db.query(
        `SELECT DISTINCT ON (f.id)
                f.id as file_id, f.name as file_name, fcl.result
         FROM horizonsparks.files f
         JOIN horizonsparks.file_check_logs_result_ia fcl ON fcl.file_id = f.id
         WHERE f.project_id = $1
           AND f.folder = 'P&ID'
           AND fcl.status = 'success'
         ORDER BY f.id, fcl.checked_at DESC`,
        [project_id]
      );

      // 4. Find tags from P&ID that match this loop number (exact match, case-insensitive)
      const pidTags = new Set();
      const pidTagDetails = [];
      for (const pf of pidFiles) {
        let parsed;
        try {
          parsed = typeof pf.result === 'string' ? JSON.parse(pf.result) : pf.result;
        } catch (e) { continue; }
        for (const d of (parsed.data || [])) {
          const tagLower = (d.tag || d.fullTag || '').toLowerCase();
          const loopNum = (d.loopNumber || '').toLowerCase();
          // Exact loop match — not substring (Codex review: avoid 2131 matching 12131)
          if (loopNum === loopLower) {
            pidTags.add(tagLower);
            pidTagDetails.push({
              tag: d.tag || d.fullTag,
              loop_number: d.loopNumber,
              type: d.box_type,
              source_file: pf.file_name,
            });
          }
        }
      }

      // 5. Compare
      const matched = [];
      const inExcelNotPid = [];
      const inPidNotExcel = [];

      for (const tag of excelTags) {
        if (pidTags.has(tag)) matched.push(tag);
        else inExcelNotPid.push(tag);
      }
      for (const tag of pidTags) {
        if (!excelTags.has(tag)) inPidNotExcel.push(tag);
      }

      // 6. Check which boxes have data
      const boxCoverage = {};
      for (const [boxName, mappings] of Object.entries(excelData)) {
        boxCoverage[boxName] = { has_data: true, fields: mappings.map(m => m.key) };
      }
      const expectedBoxes = ['Cable_Schedule', 'I/O_List', 'Schematics', 'Location_Drawings'];
      for (const box of expectedBoxes) {
        if (!boxCoverage[box]) boxCoverage[box] = { has_data: false, fields: [] };
      }

      return JSON.stringify({
        loop_number,
        excel_tag_count: excelTags.size,
        pid_tag_count: pidTags.size,
        matched,
        in_excel_not_pid: inExcelNotPid,
        in_pid_not_excel: inPidNotExcel,
        pid_instruments: pidTagDetails,
        excel_box_coverage: boxCoverage,
        excel_files: (excelMatches.files || []).map(f => ({
          fileName: f.fileName,
          tagCount: f.tagCount,
          fileFolder: f.fileFolder,
        })),
      });
    }

    case 'get_missing_documents': {
      const { project_id, box_name } = toolInput;

      const [foldersResult, boxesResult] = await Promise.all([
        db.query(
          `SELECT lf.loop_number, lf.folder_values, lf.status
           FROM horizonsparks.loopfolder lf
           WHERE lf.project_id = $1
           ORDER BY lf.loop_number`,
          [project_id]
        ),
        db.query(
          `SELECT id, name FROM horizonsparks.file_folders
           WHERE active = true AND tag_loop_folder = true
           ORDER BY position`
        ),
      ]);

      const folders = foldersResult.rows;
      if (folders.length === 0) {
        return JSON.stringify({ error: 'No loop folders found in this project' });
      }

      const boxMap = {};
      boxesResult.rows.forEach(b => { boxMap[b.id] = b.name; });
      const activeBoxes = boxesResult.rows;
      const boxNames = activeBoxes.map(b => b.name);

      const missing = [];
      let fullyComplete = 0;

      for (const folder of folders) {
        const fv = (typeof folder.folder_values === 'object' && folder.folder_values) ? folder.folder_values : {};
        const missingBoxes = [];

        for (const box of activeBoxes) {
          if (box_name && box.name !== box_name) continue;

          const boxData = fv[box.id];
          const hasMappings = boxData && typeof boxData === 'object' && Array.isArray(boxData.mappings) && boxData.mappings.length > 0;
          const hasFiles = boxData && typeof boxData === 'object' && Array.isArray(boxData.files) && boxData.files.length > 0;

          if (!hasMappings && !hasFiles) {
            missingBoxes.push(box.name);
          }
        }

        if (missingBoxes.length > 0) {
          missing.push({
            loop_number: folder.loop_number,
            status: folder.status,
            missing_boxes: missingBoxes,
          });
        } else {
          fullyComplete++;
        }
      }

      // Sort by most missing first
      missing.sort((a, b) => b.missing_boxes.length - a.missing_boxes.length);

      return JSON.stringify({
        summary: {
          total_loops: folders.length,
          fully_complete: fullyComplete,
          with_gaps: missing.length,
        },
        box_types_checked: box_name ? [box_name] : boxNames,
        missing: missing.slice(0, 50), // Cap at 50 for token budget
      });
    }

    default:
      return JSON.stringify({ error: 'Unknown tool: ' + toolName });
  }
}

// ── Build Project Summary (Step 1 — auto-loaded) ────────────────

async function buildProjectSummary(projectId) {
  const db = DB.db;

  const [projectResult, folderStats, fileStats, boxStats] = await Promise.all([
    db.query(
      `SELECT p.name, p.company, p.deadline, pr.name as priority
       FROM horizonsparks.projects p
       LEFT JOIN horizonsparks.priority pr ON pr.id = p.priority_id
       WHERE p.id = $1`,
      [projectId]
    ),
    db.query(
      `SELECT
         COUNT(*)::int as total,
         COUNT(CASE WHEN status = 'saved' THEN 1 END)::int as saved,
         COUNT(CASE WHEN is_locked = true THEN 1 END)::int as locked,
         COUNT(CASE WHEN is_flagged = true THEN 1 END)::int as flagged,
         COUNT(CASE WHEN folder_values::text != '{}' AND folder_values IS NOT NULL THEN 1 END)::int as with_data
       FROM horizonsparks.loopfolder WHERE project_id = $1`,
      [projectId]
    ),
    db.query(
      `SELECT folder, status, COUNT(*)::int as count
       FROM horizonsparks.files WHERE project_id = $1
       GROUP BY folder, status ORDER BY folder`,
      [projectId]
    ),
    db.query(
      `SELECT
         COUNT(*)::int as total,
         COUNT(CASE WHEN folder_values->'_excelMatches' IS NOT NULL
           AND (folder_values->'_excelMatches'->>'count')::int > 0
           THEN 1 END)::int as with_excel_matches
       FROM horizonsparks.loopfolder WHERE project_id = $1`,
      [projectId]
    ),
  ]);

  const project = projectResult.rows[0];
  if (!project) return 'Project not found.';

  const fs = folderStats.rows[0];
  const bs = boxStats.rows[0];

  // File breakdown by folder type
  const fileBreakdown = {};
  fileStats.rows.forEach(r => {
    if (!fileBreakdown[r.folder]) fileBreakdown[r.folder] = { total: 0, processed: 0 };
    fileBreakdown[r.folder].total += r.count;
    if (r.status === 'processed' || r.status === 'enhanced') {
      fileBreakdown[r.folder].processed += r.count;
    }
  });

  // Area/prefix distribution
  const { rows: prefixes } = await db.query(
    `SELECT
       SPLIT_PART(loop_number, '-', 1) as prefix,
       COUNT(*)::int as count
     FROM horizonsparks.loopfolder WHERE project_id = $1
     GROUP BY prefix ORDER BY count DESC LIMIT 10`,
    [projectId]
  );

  let summary = 'PROJECT: ' + project.name;
  if (project.company) summary += ' | Company: ' + project.company;
  if (project.deadline) summary += ' | Deadline: ' + project.deadline;
  if (project.priority) summary += ' | Priority: ' + project.priority;

  summary += '\n\nLOOP FOLDERS: ' + fs.total + ' total';
  summary += ' | ' + fs.with_data + ' with data | ' + fs.locked + ' locked (QC) | ' + fs.flagged + ' flagged';
  summary += '\nEXCEL COVERAGE: ' + bs.with_excel_matches + '/' + bs.total + ' folders have Excel matches';

  summary += '\n\nFILES BY TYPE:';
  for (const [folder, stats] of Object.entries(fileBreakdown)) {
    summary += '\n  ' + folder + ': ' + stats.total + ' files (' + stats.processed + ' processed)';
  }

  if (prefixes.length > 0) {
    summary += '\n\nAREA DISTRIBUTION:';
    prefixes.forEach(p => { summary += '\n  ' + p.prefix + ': ' + p.count + ' loops'; });
  }

  return summary;
}

// ── System Prompt Builder ───────────────────────────────────────

async function buildSystemPrompt(context) {
  const summary = await buildProjectSummary(context.projectId);

  return 'You are the Project Intelligence Agent for Horizon Sparks.\n\n' +
    'You see the ENTIRE commissioning project at a glance. Your job is to find\n' +
    'mismatches, gaps, orphaned instruments, missing documents, and incomplete loops.\n\n' +
    'You have 4 tools to drill down into specifics. ALWAYS start by analyzing the\n' +
    'summary below, then use tools to investigate anything suspicious.\n\n' +
    'CURRENT PROJECT SUMMARY:\n' + summary + '\n\n' +
    'ISA TAG CONVENTIONS:\n' +
    '- Tags follow the pattern: AREA-TYPE-NUMBER (e.g. 221A-FIT-2221-03)\n' +
    '- Common types: FE (element), FIT (transmitter), FIC (controller), FV (valve),\n' +
    '  PI (pressure indicator), TI (temperature indicator), PSV (safety valve),\n' +
    '  LIT (level transmitter), AIT (analyzer transmitter)\n' +
    '- A complete loop typically has: element + transmitter + controller + final element\n' +
    '- Safety-critical: ESD, PSV, relief valves — flag these as high priority\n\n' +
    'ANALYSIS RULES:\n' +
    '- Report like a senior engineer briefing a PM\n' +
    '- Be specific: "Loop 2131 is missing FE and FV cables" not "some loops have gaps"\n' +
    '- When you find a mismatch, explain WHY it matters\n' +
    '- Prioritize: safety-critical instruments first (ESD, PSV, relief valves)\n' +
    '- Group findings by area/prefix when presenting multiple issues\n' +
    '- If you find no issues, say so clearly — don\'t invent problems\n' +
    '- Keep tool calls focused — don\'t scan every loop if the user asked about one area';
}

// ── Agent Definition ────────────────────────────────────────────

module.exports = {
  agent: defineAgent({
    name: 'loopfolders.projectIntelligence.v1',
    model: 'claude-opus-4-20250514',
    systemPrompt: buildSystemPrompt,
    tools: TOOLS,
    guardrails: {
      enabled: true,
      maxTokens: 8000,
      timeoutMs: 120000,
      costLimitPerCallCents: 5000,
      blockPII: false,
    },
  }),
  executeTool,
  buildProjectSummary,
};
