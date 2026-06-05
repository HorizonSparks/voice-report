// One-off backfill: migrate legacy disk-JSON safety observations (forms/*.json with
// form_type === 'safety_observation') into the queryable, tenant-scoped
// safety_observations table. Idempotent — re-runs skip ids already present.
//
//   Dry run (default, no writes):  node database/backfill-safety-observations.js
//   Commit:                        node database/backfill-safety-observations.js --commit
//
// Each legacy file carries person_id, person_name, company_id, form_data, created_at, so
// the migrated rows are correctly tenant-stamped from the original record.
const fs = require('fs');
const path = require('path');
const DB = require('./db');

const COMMIT = process.argv.includes('--commit');
const formsDir = path.join(__dirname, '..', 'forms');

function composeDescription(fd = {}) {
  const parts = [];
  const add = (label, v) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') parts.push(`${label}: ${v}`);
  };
  add('Category', fd.category);
  add('Observation type', fd.observation_type);
  add('Location', fd.location);
  add('Safe behaviors', fd.safe_behaviors);
  add('At-risk behaviors', fd.at_risk_behaviors);
  add('Corrective action', fd.corrective_action);
  add('Persons observed (craft)', fd.persons_observed_craft);
  add('Follow-up required', fd.follow_up_required);
  add('Supervisor notified', fd.supervisor_notified);
  add('Additional notes', fd.additional_notes);
  return parts.join('\n');
}

async function main() {
  await DB.safetyObservations.ensureSchema();
  if (!fs.existsSync(formsDir)) {
    console.log(`No legacy forms dir at ${formsDir}; nothing to backfill.`);
    return;
  }
  const files = fs.readdirSync(formsDir).filter((f) => f.endsWith('.json'));
  let candidates = 0;
  let migrated = 0;
  let skipped = 0;
  for (const f of files) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(formsDir, f), 'utf-8')); } catch { continue; }
    if (data.form_type !== 'safety_observation') continue;
    candidates++;
    const id = 'safety_legacy_' + path.basename(f, '.json');
    const exists = await DB.db.query('SELECT 1 FROM safety_observations WHERE id = $1', [id]);
    if (exists.rows.length) { skipped++; continue; }
    if (!COMMIT) { migrated++; continue; }
    const fd = data.form_data || {};
    await DB.safetyObservations.create({
      id,
      person_id: data.person_id,
      person_name: data.person_name || '',
      company_id: data.company_id || null,
      type: fd.observation_type || 'observation',
      severity: fd.severity || 'low',
      location: fd.location || null,
      description: composeDescription(fd),
      form_data: JSON.stringify(fd),
      created_at: data.created_at || null,
    });
    migrated++;
  }
  console.log(`${COMMIT ? 'COMMIT' : 'DRY-RUN'}: ${candidates} safety-observation file(s); ${migrated} ${COMMIT ? 'migrated' : 'would migrate'}, ${skipped} already present.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
