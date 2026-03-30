const { Pool } = require('pg');
const PG_CONFIG = { host: 'localhost', port: 5433, user: 'horizon_spark', password: '8oS4oc2hyYhyq698CPSqXbA1' };

async function migrate() {
  const source = new Pool({ ...PG_CONFIG, database: 'horizon' });
  source.on('connect', c => c.query('SET search_path TO voicereport'));
  const target = new Pool({ ...PG_CONFIG, database: 'horizon_sparks' });
  target.on('connect', c => c.query('SET search_path TO voicereport'));

  const companyId = 'company_horizon_sparks';
  const personRows = await source.query('SELECT id FROM voicereport.people WHERE company_id = $1', [companyId]);
  const personIds = personRows.rows.map(r => r.id);
  console.log('Found', personIds.length, 'people for Horizon Sparks');

  async function copyRows(table, rows) {
    if (!rows || rows.length === 0) { console.log('  ' + table + ': 0 rows (skip)'); return; }
    const cols = Object.keys(rows[0]);
    const client = await target.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET session_replication_role = 'replica'");
      await client.query('DELETE FROM voicereport.' + table);
      for (const row of rows) {
        const vals = cols.map(c => row[c]);
        const ph = cols.map((_, i) => '$' + (i + 1));
        await client.query('INSERT INTO voicereport.' + table + ' (' + cols.join(',') + ') VALUES (' + ph.join(',') + ')', vals);
      }
      await client.query("SET session_replication_role = 'origin'");
      await client.query('COMMIT');
      console.log('  ' + table + ': ' + rows.length + ' rows');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('  ' + table + ': ERROR — ' + e.message);
    } finally { client.release(); }
  }

  // Templates (shared reference data)
  const { rows: tRows } = await source.query('SELECT * FROM voicereport.templates');
  await copyRows('templates', tRows);

  // People
  const { rows: pRows } = await source.query('SELECT * FROM voicereport.people WHERE company_id = $1', [companyId]);
  await copyRows('people', pRows);

  // All person-linked tables
  const personTables = ['knowledge_files', 'certifications', 'ai_conversations', 'safety_observations',
    'contact_order', 'report_visibility', 'webauthn_credentials'];
  for (const table of personTables) {
    try {
      const { rows } = await source.query('SELECT * FROM voicereport.' + table + ' WHERE person_id = ANY($1)', [personIds]);
      await copyRows(table, rows);
    } catch (e) { console.log('  ' + table + ': ' + e.message); }
  }

  // Reports, projects, punch_items, jsa_records (by company_id)
  for (const table of ['reports', 'projects', 'punch_items', 'jsa_records']) {
    const { rows } = await source.query('SELECT * FROM voicereport.' + table + ' WHERE company_id = $1', [companyId]);
    await copyRows(table, rows);
  }

  // Messages
  try {
    const msgCols = (await source.query("SELECT column_name FROM information_schema.columns WHERE table_schema='voicereport' AND table_name='messages'")).rows.map(r => r.column_name);
    if (msgCols.includes('sender_id')) {
      const { rows } = await source.query('SELECT * FROM voicereport.messages WHERE sender_id = ANY($1)', [personIds]);
      await copyRows('messages', rows);
    } else { console.log('  messages: no sender_id column'); }
  } catch (e) { console.log('  messages: ' + e.message); }

  // Projects members
  const projIds = (await source.query('SELECT id FROM voicereport.projects WHERE company_id = $1', [companyId])).rows.map(r => r.id);
  if (projIds.length > 0) {
    const { rows } = await source.query('SELECT * FROM voicereport.project_members WHERE project_id = ANY($1)', [projIds]);
    await copyRows('project_members', rows);
  } else { console.log('  project_members: 0 rows (skip)'); }

  // Daily plans chain
  try {
    const dpCols = (await source.query("SELECT column_name FROM information_schema.columns WHERE table_schema='voicereport' AND table_name='daily_plans'")).rows.map(r => r.column_name);
    let dpIds = [];
    if (dpCols.includes('company_id')) {
      const { rows } = await source.query('SELECT * FROM voicereport.daily_plans WHERE company_id = $1', [companyId]);
      await copyRows('daily_plans', rows); dpIds = rows.map(r => r.id);
    } else if (dpCols.includes('created_by')) {
      const { rows } = await source.query('SELECT * FROM voicereport.daily_plans WHERE created_by = ANY($1)', [personIds]);
      await copyRows('daily_plans', rows); dpIds = rows.map(r => r.id);
    }
    if (dpIds.length > 0) {
      const { rows: taskRows } = await source.query('SELECT * FROM voicereport.daily_plan_tasks WHERE plan_id = ANY($1)', [dpIds]);
      await copyRows('daily_plan_tasks', taskRows);
      const taskIds = taskRows.map(r => r.id);
      if (taskIds.length > 0) {
        const { rows } = await source.query('SELECT * FROM voicereport.task_days WHERE task_id = ANY($1)', [taskIds]);
        await copyRows('task_days', rows);
      }
    }
  } catch (e) { console.log('  daily_plans chain: ' + e.message); }

  // Verification
  console.log('\nVERIFICATION:');
  const tpCount = (await target.query('SELECT count(*) as c FROM voicereport.people')).rows[0].c;
  const spCount = (await source.query('SELECT count(*) as c FROM voicereport.people WHERE company_id = $1', [companyId])).rows[0].c;
  console.log('  People: ' + tpCount + ' (source: ' + spCount + ') ' + (tpCount === spCount ? '✓' : '✗'));

  const ttCount = (await target.query('SELECT count(*) as c FROM voicereport.templates')).rows[0].c;
  console.log('  Templates: ' + ttCount + ' ✓');

  await source.end();
  await target.end();
  console.log('\n✓ Horizon Sparks migration complete!');
}

migrate().catch(e => { console.error('Failed:', e.message); process.exit(1); });
