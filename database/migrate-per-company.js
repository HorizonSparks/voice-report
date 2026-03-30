/**
 * Database-Per-Company Migration Script v2
 * Copies company-specific data from shared 'horizon' DB to individual company databases.
 * Uses session_replication_role = 'replica' to skip FK checks during bulk copy.
 */

const { Pool } = require('pg');

const PG_CONFIG = {
  host: 'localhost',
  port: 5433,
  user: 'horizon_spark',
  password: '8oS4oc2hyYhyq698CPSqXbA1',
};

const COMPANIES = [
  { id: 'company_pacific_mechanical', db: 'horizon_pacific_mechanical' },
  { id: 'company_summit_electrical', db: 'horizon_summit_electrical' },
];

async function migrate() {
  const source = new Pool({ ...PG_CONFIG, database: 'horizon' });
  source.on('connect', c => c.query('SET search_path TO voicereport'));

  for (const company of COMPANIES) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Migrating: ${company.id} → ${company.db}`);
    console.log('='.repeat(60));

    const target = new Pool({ ...PG_CONFIG, database: company.db });
    target.on('connect', c => c.query('SET search_path TO voicereport'));

    // Get this company's person IDs
    const personRows = await source.query(
      'SELECT id FROM voicereport.people WHERE company_id = $1', [company.id]
    );
    const personIds = personRows.rows.map(r => r.id);
    console.log(`Found ${personIds.length} people`);

    if (personIds.length === 0) {
      console.log('No people — skipping');
      await target.end();
      continue;
    }

    // Helper: copy rows with FK constraints disabled
    async function copyRows(table, rows) {
      if (!rows || rows.length === 0) {
        console.log(`  ${table}: 0 rows (skip)`);
        return 0;
      }
      const cols = Object.keys(rows[0]);
      const client = await target.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET session_replication_role = 'replica'"); // Disable FK checks
        await client.query(`DELETE FROM voicereport.${table}`);

        for (const row of rows) {
          const vals = cols.map(c => row[c]);
          const placeholders = cols.map((_, i) => '$' + (i + 1));
          await client.query(
            `INSERT INTO voicereport.${table} (${cols.join(',')}) VALUES (${placeholders.join(',')})`,
            vals
          );
        }
        await client.query("SET session_replication_role = 'origin'"); // Re-enable
        await client.query('COMMIT');
        console.log(`  ${table}: ${rows.length} rows`);
        return rows.length;
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`  ${table}: ERROR — ${e.message}`);
        return -1;
      } finally {
        client.release();
      }
    }

    // Helper: query source and copy
    async function copyFiltered(table, where, params) {
      try {
        const { rows } = await source.query(`SELECT * FROM voicereport.${table} WHERE ${where}`, params);
        return await copyRows(table, rows);
      } catch (e) {
        console.error(`  ${table}: QUERY ERROR — ${e.message}`);
        return -1;
      }
    }

    async function copyAll(table) {
      try {
        const { rows } = await source.query(`SELECT * FROM voicereport.${table}`);
        return await copyRows(table, rows);
      } catch (e) {
        console.error(`  ${table}: QUERY ERROR — ${e.message}`);
        return -1;
      }
    }

    // ============================================================
    // COPY DATA IN DEPENDENCY ORDER
    // ============================================================

    // Shared/reference data first (templates needed for FK refs)
    await copyAll('templates');

    // Direct company_id tables
    await copyFiltered('people', 'company_id = $1', [company.id]);
    await copyFiltered('reports', 'company_id = $1', [company.id]);
    await copyFiltered('projects', 'company_id = $1', [company.id]);
    await copyFiltered('punch_items', 'company_id = $1', [company.id]);
    await copyFiltered('jsa_records', 'company_id = $1', [company.id]);

    // Project members (chain through projects)
    const projIds = (await source.query(
      'SELECT id FROM voicereport.projects WHERE company_id = $1', [company.id]
    )).rows.map(r => r.id);
    if (projIds.length > 0) {
      await copyFiltered('project_members', 'project_id = ANY($1)', [projIds]);
    } else { console.log('  project_members: 0 rows (skip)'); }

    // Person-linked tables
    await copyFiltered('knowledge_files', 'person_id = ANY($1)', [personIds]);
    await copyFiltered('certifications', 'person_id = ANY($1)', [personIds]);
    await copyFiltered('ai_conversations', 'person_id = ANY($1)', [personIds]);
    await copyFiltered('safety_observations', 'person_id = ANY($1)', [personIds]);
    await copyFiltered('contact_order', 'person_id = ANY($1)', [personIds]);
    await copyFiltered('report_visibility', 'person_id = ANY($1)', [personIds]);
    await copyFiltered('webauthn_credentials', 'person_id = ANY($1)', [personIds]);

    // Messages — check column structure first
    try {
      const msgCols = await source.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='voicereport' AND table_name='messages' ORDER BY ordinal_position"
      );
      const colNames = msgCols.rows.map(r => r.column_name);
      if (colNames.includes('from_id')) {
        await copyFiltered('messages', 'from_id = ANY($1) OR to_id = ANY($1)', [personIds]);
      } else if (colNames.includes('person_id')) {
        await copyFiltered('messages', 'person_id = ANY($1)', [personIds]);
      } else {
        // V2 messages might use sender_id
        console.log('  messages: columns = ' + colNames.join(', ') + ' — checking sender_id');
        if (colNames.includes('sender_id')) {
          await copyFiltered('messages', 'sender_id = ANY($1)', [personIds]);
        } else {
          await copyAll('messages'); // fallback: copy all
        }
      }
    } catch (e) { console.log(`  messages: ${e.message}`); }

    // PPE requests
    try {
      const ppeCols = await source.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='voicereport' AND table_name='ppe_requests'"
      );
      const colNames = ppeCols.rows.map(r => r.column_name);
      if (colNames.includes('person_id')) {
        await copyFiltered('ppe_requests', 'person_id = ANY($1)', [personIds]);
      } else if (colNames.includes('requester_id')) {
        await copyFiltered('ppe_requests', 'requester_id = ANY($1)', [personIds]);
      } else {
        console.log('  ppe_requests: 0 rows (skip)');
      }
    } catch (e) { console.log(`  ppe_requests: ${e.message}`); }

    // Daily plans chain
    try {
      const dpCols = await source.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='voicereport' AND table_name='daily_plans'"
      );
      const colNames = dpCols.rows.map(r => r.column_name);
      let dailyPlanIds = [];

      if (colNames.includes('company_id')) {
        const { rows } = await source.query('SELECT * FROM voicereport.daily_plans WHERE company_id = $1', [company.id]);
        await copyRows('daily_plans', rows);
        dailyPlanIds = rows.map(r => r.id);
      } else if (colNames.includes('created_by')) {
        const { rows } = await source.query('SELECT * FROM voicereport.daily_plans WHERE created_by = ANY($1)', [personIds]);
        await copyRows('daily_plans', rows);
        dailyPlanIds = rows.map(r => r.id);
      } else {
        console.log('  daily_plans: no suitable filter column');
      }

      if (dailyPlanIds.length > 0) {
        const { rows: taskRows } = await source.query(
          'SELECT * FROM voicereport.daily_plan_tasks WHERE plan_id = ANY($1)', [dailyPlanIds]
        );
        await copyRows('daily_plan_tasks', taskRows);
        const taskIds = taskRows.map(r => r.id);

        if (taskIds.length > 0) {
          await copyFiltered('task_days', 'task_id = ANY($1)', [taskIds]);
        } else { console.log('  task_days: 0 rows (skip)'); }
      } else {
        console.log('  daily_plan_tasks: 0 rows (skip)');
        console.log('  task_days: 0 rows (skip)');
      }
    } catch (e) { console.log(`  daily_plans chain: ${e.message}`); }

    // JSA acknowledgments
    const jsaIds = (await source.query(
      'SELECT id FROM voicereport.jsa_records WHERE company_id = $1', [company.id]
    )).rows.map(r => r.id);
    if (jsaIds.length > 0) {
      await copyFiltered('jsa_acknowledgments', 'jsa_id = ANY($1)', [jsaIds]);
    } else { console.log('  jsa_acknowledgments: 0 rows (skip)'); }

    // JSA sequence
    await copyAll('jsa_sequence');

    // Form submissions chain
    try {
      const { rows: formSubRows } = await source.query(
        'SELECT * FROM voicereport.form_submissions WHERE person_id = ANY($1)', [personIds]
      );
      await copyRows('form_submissions', formSubRows);
      const subIds = formSubRows.map(r => r.id);
      if (subIds.length > 0) {
        await copyFiltered('form_submission_values', 'submission_id = ANY($1)', [subIds]);
        try {
          await copyFiltered('form_calibration_points', 'submission_id = ANY($1)', [subIds]);
        } catch (e) { console.log(`  form_calibration_points: ${e.message}`); }
      } else {
        console.log('  form_submission_values: 0 rows (skip)');
      }
    } catch (e) { console.log(`  form_submissions: ${e.message}`); }

    // Daily instructions
    try {
      await copyFiltered('daily_instructions', 'from_id = ANY($1) OR to_id = ANY($1)', [personIds]);
    } catch (e) { console.log(`  daily_instructions: ${e.message}`); }

    // Form loops (might be company-specific or shared)
    try {
      const loopCount = (await source.query('SELECT count(*) as c FROM voicereport.form_loops')).rows[0].c;
      if (parseInt(loopCount) > 0) {
        await copyAll('form_loops');
      } else { console.log('  form_loops: 0 rows (skip)'); }
    } catch (e) { console.log(`  form_loops: ${e.message}`); }

    await target.end();
    console.log(`\n✓ ${company.id} migration complete`);
  }

  // ============================================================
  // VERIFICATION
  // ============================================================
  console.log(`\n${'='.repeat(60)}`);
  console.log('VERIFICATION');
  console.log('='.repeat(60));

  const keyTables = ['people', 'reports', 'projects', 'punch_items', 'templates', 'daily_plan_tasks'];

  for (const company of COMPANIES) {
    console.log(`\n${company.db}:`);
    const target = new Pool({ ...PG_CONFIG, database: company.db });
    target.on('connect', c => c.query('SET search_path TO voicereport'));

    for (const table of keyTables) {
      const targetCount = (await target.query(`SELECT count(*) as c FROM voicereport.${table}`)).rows[0].c;

      let sourceCount;
      if (['people', 'reports', 'projects', 'punch_items'].includes(table)) {
        sourceCount = (await source.query(`SELECT count(*) as c FROM voicereport.${table} WHERE company_id = $1`, [company.id])).rows[0].c;
      } else if (table === 'templates') {
        sourceCount = (await source.query(`SELECT count(*) as c FROM voicereport.${table}`)).rows[0].c;
      } else if (table === 'daily_plan_tasks') {
        sourceCount = (await source.query(`SELECT count(*) as c FROM voicereport.${table} WHERE company_id = $1`, [company.id])).rows[0].c;
      }

      const match = targetCount === sourceCount ? '✓' : '✗ MISMATCH';
      console.log(`  ${table}: ${targetCount} (source: ${sourceCount}) ${match}`);
    }

    await target.end();
  }

  await source.end();
  console.log('\n✓ Migration verification complete!');
}

migrate().catch(e => {
  console.error('\nMigration failed:', e.message);
  process.exit(1);
});
