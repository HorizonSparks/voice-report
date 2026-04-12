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
          description: 'The project UUID (auto-injected, you do not need to provide this)',
        },
      },
      required: ['loop_number'],
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
          description: 'The project UUID (auto-injected, you do not need to provide this)',
        },
      },
      required: ['loop_number'],
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
          description: 'The project UUID (auto-injected, you do not need to provide this)',
        },
        box_name: {
          type: 'string',
          description: 'Optional: filter to a specific box (e.g. "Cable_Schedule", "I/O_List")',
        },
      },
      required: [],
    },
  },
];

// ── Tool Executor ───────────────────────────────────────────────

async function executeTool(toolName, toolInput, context) {
  const db = DB.db;

  // Auto-inject projectId from context — AI doesn't need to know the UUID
  if (context && context.projectId) {
    if (toolInput.project_id && toolInput.project_id !== context.projectId) {
      toolInput.project_id = context.projectId;
    }
    if (!toolInput.project_id) {
      toolInput.project_id = context.projectId;
    }
  }

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

// ── Knowledge Loader ────────────────────────────────────────────

/**
 * Load targeted instrumentation knowledge for the intelligence agent.
 * Not all 356KB — just the pieces needed for project-level analysis.
 */
function loadIntelligenceKnowledge() {
  let knowledge = '';

  try {
    const knowledgeCache = require('../knowledgeCache');
    if (!knowledgeCache.stats().initialized) knowledgeCache.initialize();

    // 1. Tag rules — loop composition templates (what a complete loop looks like)
    try {
      const fs = require('fs');
      const tagRulesPath = require('path').resolve(__dirname, '../../../../knowledge/instrumentation_tag_rules.json');
      if (fs.existsSync(tagRulesPath)) {
        const tagRules = JSON.parse(fs.readFileSync(tagRulesPath, 'utf8'));
        if (tagRules.loop_composition_templates) {
          knowledge += '\n\nLOOP COMPOSITION TEMPLATES (what a complete loop requires):\n';
          const templates = tagRules.loop_composition_templates.templates || {};
          for (const [name, tmpl] of Object.entries(templates)) {
            knowledge += '\n' + name.toUpperCase() + ': ' + tmpl.description;
            knowledge += '\n  Instruments: ' + (tmpl.typical_instruments || []).join(', ');
            if (tmpl.critical_rule) knowledge += '\n  CRITICAL: ' + tmpl.critical_rule;
            if (tmpl.note) knowledge += '\n  Note: ' + tmpl.note;
          }
        }
        if (tagRules.isa_first_letters && tagRules.isa_first_letters.letters) {
          knowledge += '\n\nISA FIRST LETTERS (measured variable):\n';
          for (const [letter, info] of Object.entries(tagRules.isa_first_letters.letters)) {
            knowledge += letter + '=' + info.variable;
            if (info.examples && info.examples.length > 0) knowledge += ' (' + info.examples.slice(0, 3).join(', ') + ')';
            knowledge += '\n';
          }
        }
        if (tagRules.ocr_confusion_in_context) {
          knowledge += '\nCOMMON OCR ERRORS IN TAG EXTRACTION:\n';
          knowledge += JSON.stringify(tagRules.ocr_confusion_in_context).substring(0, 1500) + '\n';
        }
        if (tagRules.tags_that_look_wrong_but_are_correct) {
          knowledge += '\nTAGS THAT LOOK WRONG BUT ARE CORRECT:\n';
          knowledge += JSON.stringify(tagRules.tags_that_look_wrong_but_are_correct).substring(0, 1000) + '\n';
        }
      }
    } catch (e) { /* tag rules not available — continue without */ }

    // 2. Commissioning sequence — what phases a project goes through
    const commData = knowledgeCache.get('commissioning');
    if (commData) {
      const comm = typeof commData === 'string' ? JSON.parse(commData) : commData;
      if (comm.instrument_commissioning_sequence) {
        knowledge += '\n\nCOMMISSIONING PHASES (instrument):\n';
        for (const [phase, steps] of Object.entries(comm.instrument_commissioning_sequence)) {
          knowledge += phase.replace(/_/g, ' ').toUpperCase() + ':\n';
          (steps || []).forEach(s => { knowledge += '  - ' + s + '\n'; });
        }
      }
      if (comm.common_commissioning_mistakes) {
        knowledge += '\nCOMMON COMMISSIONING MISTAKES TO FLAG:\n';
        (comm.common_commissioning_mistakes || []).forEach(m => { knowledge += '  - ' + m + '\n'; });
      }
    }

    // 3. Quality inspection — what defines a complete turnover package
    const qualData = knowledgeCache.get('instrumentation_quality_inspection');
    if (qualData) {
      const qual = typeof qualData === 'string' ? JSON.parse(qualData) : qualData;
      if (qual.turnover_package_contents) {
        knowledge += '\n\nTURNOVER PACKAGE (what a loop folder SHOULD contain):\n';
        knowledge += JSON.stringify(qual.turnover_package_contents).substring(0, 1500) + '\n';
      }
      if (qual.common_punch_list_items) {
        knowledge += '\nCOMMON PUNCH LIST ITEMS:\n';
        knowledge += JSON.stringify(qual.common_punch_list_items).substring(0, 1000) + '\n';
      }
    }

    // 4. Connection rules — which instruments need cables and which never do
    try {
      const fs = require('fs');
      const connRulesPath = require('path').resolve(__dirname, '../../../../knowledge/instrumentation_connection_rules.json');
      if (fs.existsSync(connRulesPath)) {
        const connRules = JSON.parse(fs.readFileSync(connRulesPath, 'utf8'));
        const quick = connRules.quick_lookup || {};

        knowledge += '\n\nCONNECTION CLASSIFICATION (critical for gap analysis):\n';
        knowledge += '\nNEVER HAS CABLE (mechanical — no Cable Schedule, no I/O):\n';
        knowledge += (quick.never_has_cable_tags || []).join(', ') + '\n';
        const neverCat = connRules.categories?.never_has_cable?.instruments || {};
        for (const [tag, info] of Object.entries(neverCat)) {
          knowledge += '  ' + tag + ': ' + info.name + ' — ' + info.reason.substring(0, 100) + '\n';
        }

        knowledge += '\nALWAYS HAS CABLE (electronic — MUST be in Cable Schedule + I/O):\n';
        const alwaysCat = connRules.categories?.always_has_cable?.instruments || {};
        for (const [group, info] of Object.entries(alwaysCat)) {
          knowledge += '  ' + (info.tags || []).join(', ') + ' — ' + (info.description || '').substring(0, 120) + '\n';
        }

        knowledge += '\nCONTEXT-DEPENDENT (local=no cable, remote=has cable):\n';
        const ctxCat = connRules.categories?.depends_on_context?.instruments || {};
        for (const [tag, info] of Object.entries(ctxCat)) {
          knowledge += '  ' + tag + ': ' + (info.rule || info.local || '') + '\n';
        }

        knowledge += '\nONE_LINE ELEMENTS (power, NOT instrumentation — different cable schedule):\n';
        knowledge += (quick.one_line_only_tags || []).join(', ') + '\n';
        knowledge += 'Rule: These should NEVER appear in an instrument Cable Schedule.\n';
      }
    } catch (e) { /* connection rules not available — continue */ }

    // 5. Loop hierarchy — folder name IS a tag, field vs DCS instruments
    try {
      const fs = require('fs');
      const loopHierarchyPath = require('path').resolve(__dirname, '../../../../knowledge/instrumentation_loop_hierarchy.json');
      if (fs.existsSync(loopHierarchyPath)) {
        const loopRules = JSON.parse(fs.readFileSync(loopHierarchyPath, 'utf8'));

        knowledge += '\n\nLOOP FOLDER NAMING — THE FOLDER NAME IS AN INSTRUMENT TAG:\n';
        const fnRules = loopRules.loop_hierarchy?.folder_name_rules || {};
        for (const [, rule] of Object.entries(fnRules)) {
          knowledge += '- ' + rule + '\n';
        }

        knowledge += '\nHOW TO REASON ABOUT A LOOP FOLDER:\n';
        const reasoning = loopRules.loop_hierarchy?.how_to_reason || {};
        for (const [, step] of Object.entries(reasoning)) {
          knowledge += '- ' + step + '\n';
        }

        // Add examples for all loop types (universal, not just flow)
        knowledge += '\nLOOP TYPES (the pattern is UNIVERSAL — first letter changes, hierarchy stays):\n';
        const examples = loopRules.loop_hierarchy?.examples_by_variable || {};
        for (const [name, ex] of Object.entries(examples)) {
          if (typeof ex !== 'object' || !ex.meaning) continue; // skip description string
          knowledge += '\n' + name.toUpperCase().replace(/_/g, ' ') + ': ' + ex.meaning;
          knowledge += '\n  Controller: ' + ex.controller;
          knowledge += '\n  Field instruments: ' + (ex.expected_field_instruments || []).join(', ');
          if (ex.note) knowledge += '\n  Note: ' + ex.note;
        }

        // P&ID symbol shapes
        knowledge += '\n\nP&ID SYMBOL SHAPES (why some tags are not in extraction):\n';
        const shapes = loopRules.pid_symbol_shapes?.shapes || {};
        for (const [, shape] of Object.entries(shapes)) {
          knowledge += shape.symbol + ' = ' + shape.location + ' | Physical: ' + shape.is_physical + ' | In YOLO extraction: ' + shape.in_yolo_extraction + '\n';
        }
        knowledge += (loopRules.pid_symbol_shapes?.extraction_implication || '') + '\n';

        // Common mistakes
        knowledge += '\nNEVER FLAG AS MISSING:\n';
        const neverFlag = loopRules.ai_reasoning_rules?.never_flag_as_missing || [];
        neverFlag.forEach(r => { knowledge += '- ' + r + '\n'; });

        knowledge += '\nCOMMON MISTAKES TO AVOID:\n';
        const mistakes = loopRules.ai_reasoning_rules?.common_mistakes_to_avoid || [];
        mistakes.forEach(m => { knowledge += '- ' + m + '\n'; });
      }
    } catch (e) { /* loop hierarchy not available — continue */ }

  } catch (e) {
    // Knowledge loading is best-effort — agent works without it, just less informed
    knowledge += '\n(Knowledge library not available: ' + e.message + ')\n';
  }

  return knowledge;
}

// ── System Prompt Builder ───────────────────────────────────────

async function buildSystemPrompt(context) {
  const summary = await buildProjectSummary(context.projectId);
  const knowledge = loadIntelligenceKnowledge();

  // MANDATORY REASONING PROTOCOL — not a knowledge dump
  // AI must follow explicit steps before answering.
  // Knowledge is reference material, not the main prompt.

  return `You are a senior instrumentation engineer working inside Horizon Sparks, a commissioning management platform. You speak like an experienced field engineer — direct, specific, practical. You never waffle.

MANDATORY REASONING PROTOCOL
When analyzing loop folders, follow these steps. For project-level or general questions, adapt as needed — use tools to get real data rather than guessing.

STEP 1: PARSE FOLDER NAMES AS INSTRUMENT TAGS
Every loop folder name IS an instrument tag (ISA 5.1). Parse it:
  Example: "221A-FV-2221-03" = Area 221A, Flow (F), Valve (V), Loop 2221, Suffix 03
The folder name tells you what the PRIMARY instrument is. This determines everything else.

STEP 2: CLASSIFY — WIRED OR MECHANICAL?
Based on the instrument type letters from Step 1:
  MECHANICAL (never has cable): FE, LG, PG, TG, TW, PSV, PRV, BD, RO, HV
  ALWAYS WIRED (must have cable): FIT, FT, PT, TT, LT, FV, TV, XV, XY, PSH, ZSC, ZSO
  CONTEXT-DEPENDENT (local=no cable, remote=cable): PI, TI, LI, FI
Then determine what other instruments belong in this loop and what documents are needed.

STEP 3: CHECK WHAT IS ACTUALLY THERE
Look at the folder contents. What tags are inside? What boxes have data?
If the LOOP FOLDERS VISIBLE ON SCREEN section shows you real data, analyze THAT first.
If you need more detail, USE YOUR TOOLS — do not guess.

STEP 4: EVALUATE AND REPORT
Separate REAL gaps from EXPECTED gaps. A local gauge (LG) without Cable Schedule is NORMAL.
Prioritize: (1) Safety instruments, (2) Control valves, (3) Transmitters, (4) Indicators.
Be specific: "Loop 2131-FV has no Cable Schedule — this valve has a positioner requiring wiring" NOT "some loops have gaps."
Numbers must be exact: "8 of 76 loops" not "several loops."

YOUR 4 TOOLS — use them when you need real data, do not guess:
- get_folder_details: See everything inside ONE loop folder (box coverage, Excel matches, status)
- get_pid_tags: See what YOLO+OCR extracted from a specific P&ID drawing
- compare_excel_vs_pid: Cross-reference Excel data vs P&ID extraction for one loop
- get_missing_documents: Find ALL loops in the project missing specific box types

WHEN TO USE TOOLS:
- User asks about a specific loop -> get_folder_details first
- User asks about data quality -> compare_excel_vs_pid
- User asks about project completeness -> get_missing_documents
- User asks about what is on a drawing -> get_pid_tags
- When LOOP FOLDERS VISIBLE ON SCREEN gives you folder names and tags, START by analyzing those

CRITICAL RULES:
- PSV = Pressure Safety VALVE (mechanical, spring relief) = NO cable
- PSH = Pressure Safety HIGH switch (electronic) = NEEDS cable
- ONE_LINE elements (motors, VFDs, MCCs) use POWER cables, NOT instrument cables
- YOLO+OCR has ~85% accuracy. Common OCR confusions: 5/S, 0/O, 1/I, Z/2, B/8
- If a tag appears in P&ID but not Excel, consider OCR errors before flagging
- folder_values._excelMatches.count = 0 means no Excel matched this loop

PROJECT SUMMARY:
${summary}

REFERENCE KNOWLEDGE (consult when reasoning about specific instrument types):
${knowledge}`;
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
