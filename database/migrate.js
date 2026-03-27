#!/usr/bin/env node
/**
 * Migration script: JSON files → SQLite database
 * Migrates templates, people, reports, and builds report_visibility chain
 *
 * Usage: node database/migrate.js
 * Creates: database/voice_report.db
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(__dirname, 'voice_report.db');

// Remove old DB if exists (fresh migration)
if (fs.existsSync(DB_PATH)) {
  console.log('Removing existing database...');
  fs.unlinkSync(DB_PATH);
}

const db = new Database(DB_PATH);

// Run schema as one block
console.log('Creating schema...');
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// ============================================
// MIGRATE TEMPLATES
// ============================================
console.log('\nMigrating templates...');
const templatesDir = path.join(ROOT, 'templates');
const templateFiles = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json'));

const insertTemplate = db.prepare(`
  INSERT OR REPLACE INTO templates (id, template_name, role_level, role_level_title, trade,
    role_description, report_focus, output_sections, vocabulary, language_notes,
    safety_rules, safety_vocabulary, tools_and_equipment, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let templateCount = 0;
for (const file of templateFiles) {
  const t = JSON.parse(fs.readFileSync(path.join(templatesDir, file), 'utf8'));
  insertTemplate.run(
    t.id,
    t.template_name,
    t.role_level || 1,
    t.role_level_title || '',
    t.trade || 'Electrical',
    t.role_description || '',
    t.report_focus || '',
    JSON.stringify(t.output_sections || []),
    JSON.stringify(t.vocabulary || {}),
    t.language_notes || t.language_preference || '',
    JSON.stringify(t.safety_rules || []),
    JSON.stringify(t.safety_vocabulary || []),
    JSON.stringify(t.tools_and_equipment || []),
    t.created_at || new Date().toISOString()
  );
  templateCount++;
}
console.log(`  ✓ ${templateCount} templates migrated`);

// ============================================
// MIGRATE PEOPLE
// ============================================
console.log('\nMigrating people...');
const peopleDir = path.join(ROOT, 'people');
const peopleFiles = fs.readdirSync(peopleDir).filter(f => f.endsWith('.json'));

const insertPerson = db.prepare(`
  INSERT OR REPLACE INTO people (id, name, pin, template_id, role_title, role_level, trade,
    supervisor_id, status, project_id, photo, is_admin,
    experience, specialties, certifications, language_preference, notes,
    custom_role_description, custom_report_focus, custom_output_sections, custom_safety_rules,
    webauthn_credential_id, webauthn_raw_id, webauthn_public_key,
    created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const peopleData = []; // Keep for visibility computation
let peopleCount = 0;

for (const file of peopleFiles) {
  const p = JSON.parse(fs.readFileSync(path.join(peopleDir, file), 'utf8'));
  const pc = p.personal_context || {};

  // Figure out trade from template
  let trade = null;
  const tmplFile = templateFiles.find(f => f.includes(p.template_id));
  if (tmplFile) {
    const tmpl = JSON.parse(fs.readFileSync(path.join(templatesDir, tmplFile), 'utf8'));
    trade = tmpl.trade;
  }

  insertPerson.run(
    p.id,
    p.name,
    p.pin,
    p.template_id || null,
    p.role_title || '',
    p.role_level || 1,
    trade,
    p.supervisor_id || null,
    p.status || 'active',
    p.project_id || 'default',
    p.photo || null,
    p.is_admin ? 1 : 0,
    pc.experience || null,
    pc.specialties || null,
    pc.certifications || null,
    pc.language_preference || pc.notes || null,
    pc.notes || null,
    pc.role_description || null,
    pc.report_focus || null,
    pc.output_sections ? JSON.stringify(pc.output_sections) : null,
    pc.safety_rules ? JSON.stringify(pc.safety_rules) : null,
    p.webauthn_credential_id || null,
    p.webauthn_raw_id || null,
    p.webauthn_public_key || null,
    p.created_at || new Date().toISOString()
  );

  peopleData.push({ id: p.id, supervisor_id: p.supervisor_id || null });
  peopleCount++;
}
console.log(`  ✓ ${peopleCount} people migrated`);

// ============================================
// BUILD REPORT VISIBILITY CHAIN
// ============================================
console.log('\nBuilding report visibility chain...');
const insertVisibility = db.prepare(`
  INSERT OR IGNORE INTO report_visibility (person_id, viewer_id) VALUES (?, ?)
`);

const buildVisibilityTransaction = db.transaction(() => {
  let visCount = 0;
  for (const person of peopleData) {
    // Walk up the chain from supervisor
    let currentSupervisor = person.supervisor_id;
    const visited = new Set();

    while (currentSupervisor && !visited.has(currentSupervisor)) {
      visited.add(currentSupervisor);
      insertVisibility.run(person.id, currentSupervisor);
      visCount++;

      // Find supervisor's supervisor
      const sup = peopleData.find(p => p.id === currentSupervisor);
      currentSupervisor = sup ? sup.supervisor_id : null;
    }

    // Person can always see their own reports
    insertVisibility.run(person.id, person.id);
    visCount++;
  }
  return visCount;
});

const visCount = buildVisibilityTransaction();
console.log(`  ✓ ${visCount} visibility entries created`);

// ============================================
// MIGRATE REPORTS
// ============================================
console.log('\nMigrating reports...');
const reportsDir = path.join(ROOT, 'reports');
const reportFiles = fs.readdirSync(reportsDir).filter(f => f.endsWith('.json'));

const insertReport = db.prepare(`
  INSERT OR REPLACE INTO reports (id, person_id, person_name, role_title, template_id, trade,
    project_id, status, created_at, duration_seconds, audio_files,
    transcript_raw, markdown_verbatim, markdown_structured, conversation_turns,
    photos, messages_addressed)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Build person→trade lookup
const personTrade = {};
const allPeople = db.prepare('SELECT id, trade FROM people').all();
for (const p of allPeople) {
  personTrade[p.id] = p.trade;
}

const migrateReportsTransaction = db.transaction(() => {
  let reportCount = 0;
  let errors = 0;

  for (const file of reportFiles) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(reportsDir, file), 'utf8'));

      insertReport.run(
        r.id,
        r.person_id,
        r.person_name || '',
        r.role_title || '',
        r.template_id || null,
        personTrade[r.person_id] || null,
        r.project_id || 'default',
        r.status || 'complete',
        r.created_at,
        r.duration_seconds || 0,
        JSON.stringify(r.audio_files || (r.audio_file ? [r.audio_file] : [])),
        r.transcript_raw || '',
        r.markdown_verbatim || '',
        r.markdown_structured || '',
        JSON.stringify(r.conversation_turns || []),
        JSON.stringify(r.photos || []),
        JSON.stringify(r.messages_addressed || [])
      );
      reportCount++;
    } catch (err) {
      errors++;
      if (errors <= 3) console.warn(`  Warning: ${file}: ${err.message.substring(0, 60)}`);
    }
  }

  if (errors > 3) console.warn(`  ... and ${errors - 3} more errors`);
  return reportCount;
});

const reportCount = migrateReportsTransaction();
console.log(`  ✓ ${reportCount} reports migrated`);

// ============================================
// MIGRATE CERTIFICATIONS (from certs/ folder)
// ============================================
console.log('\nMigrating certifications...');
const certsDir = path.join(ROOT, 'certs');
let certCount = 0;

if (fs.existsSync(certsDir)) {
  const insertCert = db.prepare(`
    INSERT INTO certifications (person_id, cert_name, file_path, uploaded_at)
    VALUES (?, ?, ?, ?)
  `);

  const certFiles = fs.readdirSync(certsDir);
  for (const file of certFiles) {
    // cert files are named: person_id_certname.ext
    const personId = file.split('_cert')[0] || file.split('.')[0];
    // Check if person exists
    const person = db.prepare('SELECT id FROM people WHERE id = ?').get(personId);
    if (person) {
      insertCert.run(personId, file, file, new Date().toISOString());
      certCount++;
    }
  }
}
console.log(`  ✓ ${certCount} certifications migrated`);

// ============================================
// SUMMARY
// ============================================
console.log('\n==========================================');
console.log('  Migration Complete!');
console.log('==========================================');
console.log(`  Database: ${DB_PATH}`);
console.log(`  Templates: ${templateCount}`);
console.log(`  People: ${peopleCount}`);
console.log(`  Reports: ${reportCount}`);
console.log(`  Visibility: ${visCount} entries`);
console.log(`  Certifications: ${certCount}`);

// Verify some queries
console.log('\n--- Verification Queries ---');

const reportsByTrade = db.prepare('SELECT trade, COUNT(*) as count FROM reports GROUP BY trade').all();
console.log('Reports by trade:', reportsByTrade);

const reportsByLevel = db.prepare(`
  SELECT p.role_title, COUNT(r.id) as count
  FROM reports r JOIN people p ON r.person_id = p.id
  GROUP BY p.role_title ORDER BY count DESC
`).all();
console.log('Reports by role:', reportsByLevel.slice(0, 6));

const visCheck = db.prepare(`
  SELECT v.viewer_id, p.name as viewer_name, COUNT(*) as can_see
  FROM report_visibility v JOIN people p ON v.viewer_id = p.id
  GROUP BY v.viewer_id ORDER BY can_see DESC LIMIT 5
`).all();
console.log('Visibility (top 5):', visCheck);

// Test FTS
const ftsTest = db.prepare(`
  SELECT id, person_name, substr(transcript_raw, 1, 60) as preview
  FROM reports WHERE id IN (SELECT id FROM reports_fts WHERE reports_fts MATCH ?)
  LIMIT 3
`).all('safety');
console.log('FTS search "safety":', ftsTest.length, 'results');

const ftsTest2 = db.prepare(`
  SELECT id, person_name, substr(transcript_raw, 1, 60) as preview
  FROM reports WHERE id IN (SELECT id FROM reports_fts WHERE reports_fts MATCH ?)
  LIMIT 3
`).all('conduit');
console.log('FTS search "conduit":', ftsTest2.length, 'results');

console.log('\n✓ Database ready for use!');
db.close();
