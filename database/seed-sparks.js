/**
 * Seed Sparks team into PostgreSQL
 * Run: node database/seed-sparks.js
 */
const DB = require('./db');
const fs = require('fs');
const path = require('path');

const SPARKS_PEOPLE = [
  'person_ellery_vargas',
  'person_rabia',
  'person_ender',
  'person_anthony',
  'person_shannon',
];

const SPARKS_TEMPLATES = [
  'template_sparks_pm',
  'template_sparks_developer',
];

async function seedSparks() {
  console.log('Seeding Sparks trade...\n');

  // Seed templates first
  for (const templateId of SPARKS_TEMPLATES) {
    const filePath = path.join(__dirname, '..', 'templates', `${templateId}.json`);
    if (!fs.existsSync(filePath)) {
      console.log(`  SKIP template ${templateId} — file not found`);
      continue;
    }
    const template = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    try {
      const existing = await DB.templates.getById(templateId);
      if (existing) {
        console.log(`  EXISTS: ${template.template_name}`);
      } else {
        await DB.templates.create(template);
      }
      console.log(`  OK template: ${template.template_name}`);
    } catch (err) {
      console.log(`  SKIP template ${templateId}: ${err.message}`);
    }
  }

  // Seed people
  for (const personId of SPARKS_PEOPLE) {
    const filePath = path.join(__dirname, '..', 'people', `${personId}.json`);
    if (!fs.existsSync(filePath)) {
      console.log(`  SKIP person ${personId} — file not found`);
      continue;
    }
    const person = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    try {
      // Check if exists
      const existing = await DB.people.getById(personId);
      if (existing) {
        console.log(`  EXISTS: ${person.name} (${person.role_title}) — updating`);
        await DB.people.update(personId, person);
      } else {
        await DB.people.create(person);
        console.log(`  CREATED: ${person.name} (${person.role_title}) PIN: ${person.pin}`);
      }
    } catch (err) {
      console.log(`  ERROR ${personId}: ${err.message}`);
    }
  }

  console.log('\nSparks team seeded!');
  process.exit(0);
}

seedSparks().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
