#!/usr/bin/env node
/**
 * Migrate data from SQLite (voice_report.db) to PostgreSQL (voicereport schema)
 *
 * Prerequisites:
 *   1. PostgreSQL running with voicereport schema created (run postgres-schema.sql first)
 *   2. SQLite database at ./voice_report.db
 *   3. pg and better-sqlite3 npm packages installed
 *
 * Usage:
 *   node migrate-to-postgres.js
 *
 * Environment variables:
 *   PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD
 */

const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');

const DB_PATH = path.join(__dirname, 'voice_report.db');

// SQLite source
const sqlite = new Database(DB_PATH, { readonly: true });
sqlite.pragma('foreign_keys = OFF'); // Read-only, don't need FK checks

// PostgreSQL target
const pool = new Pool({
  host: process.env.PG_HOST || '192.168.1.117',
  port: process.env.PG_PORT || 5433,
  database: process.env.PG_DATABASE || 'horizon',
  user: process.env.PG_USER || 'horizon_spark',
  password: process.env.PG_PASSWORD || '8oS4oc2hyYhyq698CPSqXbA1',
});

// Tables to migrate in dependency order
const TABLES = [
  'templates',
  'people',
  'report_visibility',
  'reports',
  'messages',
  'certifications',
  'ai_conversations',
  'daily_instructions',
  'ppe_requests',
  'safety_observations',
  'contact_order',
  'daily_plans',
  'daily_plan_tasks',
  'task_days',
  'punch_items',
  'form_templates_v2',
  'form_fields_v2',
  'form_loops',
  'form_submissions',
  'form_submission_values',
  'form_calibration_points',
  'jsa_records',
  'jsa_acknowledgments',
  'analytics_api_calls',
  'analytics_ai_costs',
  'analytics_client_events',
  'analytics_refine_funnels',
  'analytics_sessions',
];

// Tables with SERIAL/AUTOINCREMENT PKs that need sequence reset
const SERIAL_TABLES = [
  'certifications',
  'ai_conversations',
  'form_templates_v2',
  'form_fields_v2',
  'form_loops',
  'form_submission_values',
  'form_calibration_points',
  'analytics_api_calls',
  'analytics_ai_costs',
  'analytics_client_events',
  'analytics_refine_funnels',
];

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query('SET search_path TO voicereport');

    console.log('Starting migration from SQLite to PostgreSQL...\n');

    // Disable foreign key checks during migration
    await client.query('SET session_replication_role = replica');

    let totalRows = 0;

    for (const table of TABLES) {
      try {
        // Check if table exists in SQLite
        const tableExists = sqlite.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        ).get(table);

        if (!tableExists) {
          console.log(`  ⚠ Table ${table} not found in SQLite — skipping`);
          continue;
        }

        // Get all rows from SQLite
        const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();

        if (rows.length === 0) {
          console.log(`  ○ ${table}: 0 rows (empty)`);
          continue;
        }

        // Clear target table first
        await client.query(`DELETE FROM ${table}`);

        // Get column names from first row
        const columns = Object.keys(rows[0]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const insertSQL = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

        // Batch insert
        let inserted = 0;
        const batchSize = 100;

        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);

          await client.query('BEGIN');
          for (const row of batch) {
            const values = columns.map(col => {
              const val = row[col];
              // Convert SQLite nulls
              if (val === null || val === undefined) return null;
              return val;
            });

            try {
              await client.query(insertSQL, values);
              inserted++;
            } catch (e) {
              // Log but continue on individual row errors
              if (!e.message.includes('duplicate key') && !e.message.includes('already exists')) {
                console.error(`    Error inserting into ${table}:`, e.message);
                console.error(`    Row:`, JSON.stringify(row).substring(0, 200));
              }
            }
          }
          await client.query('COMMIT');
        }

        console.log(`  ✓ ${table}: ${inserted}/${rows.length} rows migrated`);
        totalRows += inserted;

      } catch (e) {
        console.error(`  ✗ ${table}: FAILED — ${e.message}`);
        try { await client.query('ROLLBACK'); } catch(re) {}
      }
    }

    // Reset sequences for SERIAL columns
    console.log('\nResetting sequences...');
    for (const table of SERIAL_TABLES) {
      try {
        const result = await client.query(`SELECT MAX(id) as max_id FROM ${table}`);
        const maxId = result.rows[0]?.max_id;
        if (maxId) {
          await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), $1)`, [maxId]);
          console.log(`  ✓ ${table}: sequence reset to ${maxId}`);
        }
      } catch (e) {
        // Table might not have a serial column or might be empty
        console.log(`  ○ ${table}: no sequence to reset`);
      }
    }

    // Re-enable foreign key checks
    await client.query('SET session_replication_role = DEFAULT');

    // Update full-text search vectors
    console.log('\nUpdating full-text search vectors...');
    try {
      await client.query(`
        UPDATE reports SET search_vector =
          to_tsvector('english', COALESCE(person_name, '') || ' ' || COALESCE(role_title, '') || ' ' || COALESCE(transcript_raw, '') || ' ' || COALESCE(markdown_structured, ''))
        WHERE search_vector IS NULL
      `);
      console.log('  ✓ reports search vectors updated');
    } catch (e) {
      console.log('  ○ reports search vectors: skipped —', e.message);
    }

    try {
      await client.query(`
        UPDATE messages SET search_vector =
          to_tsvector('english', COALESCE(from_name, '') || ' ' || COALESCE(to_name, '') || ' ' || COALESCE(content, ''))
        WHERE search_vector IS NULL
      `);
      console.log('  ✓ messages search vectors updated');
    } catch (e) {
      console.log('  ○ messages search vectors: skipped —', e.message);
    }

    console.log(`\n✓ Migration complete! ${totalRows} total rows migrated.\n`);

  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

migrate().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
