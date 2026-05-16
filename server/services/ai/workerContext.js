/**
 * Worker World Context Loader
 *
 * Loads everything an AI agent might want to know about the worker it is
 * talking to (or about): person + supervisor + project + customer + today's
 * JSA + on-file certifications. Formats it as a single readable block to
 * append to any agent's system prompt.
 *
 * Defensive: every query is wrapped in try/catch. If any individual load
 * fails, the corresponding section is silently omitted. If the whole loader
 * throws, callers get null and existing prompt-building behavior is unchanged.
 *
 * Created 2026-05-15 to close the 5 context gaps identified in the AI
 * knowledge-graph audit (voiceConverse blind to JSA, no supervisor visible,
 * project_id hardcoded as 'default', real certifications never reached AI,
 * etc.).
 */
const DB = require('../../../database/db');

/**
 * Load the full worker world for a person.
 *
 * @param {string} personId
 * @param {object} dbOverride - optional, defaults to DB
 * @returns {Promise<object|null>} { person, project?, company?, jsa_today?, certifications? }
 *                                  or null if personId missing or person not found.
 */
async function loadWorkerWorld(personId, dbOverride) {
  if (!personId) return null;
  const db = dbOverride || DB;
  const world = {};

  // 1) Person + supervisor (single LEFT JOIN — supervisor row is optional)
  try {
    const { rows } = await db.db.query(
      `SELECT
         p.id, p.name, p.role_title, p.role_level, p.trade,
         p.project_id, p.company_id, p.supervisor_id,
         s.name AS supervisor_name, s.role_title AS supervisor_role
       FROM people p
       LEFT JOIN people s ON s.id = p.supervisor_id
       WHERE p.id = $1`,
      [personId]
    );
    if (rows[0]) world.person = rows[0];
  } catch (e) {
    // schema mismatch or missing table — silently fall back
  }
  if (!world.person) return null;

  // 2) Project + customer (only if person has a real project_id)
  try {
    if (world.person.project_id && world.person.project_id !== 'default') {
      const { rows } = await db.db.query(
        `SELECT pr.id, pr.name AS project_name,
                pr.description AS project_description,
                pr.trade AS project_trade,
                c.id AS customer_id, c.name AS customer_name
         FROM projects pr
         LEFT JOIN companies c ON c.id = pr.company_id
         WHERE pr.id = $1`,
        [world.person.project_id]
      );
      if (rows[0]) world.project = rows[0];
    } else if (world.person.company_id) {
      // No project, but a direct customer is set on the person
      const { rows } = await db.db.query(
        `SELECT id, name FROM companies WHERE id = $1`,
        [world.person.company_id]
      );
      if (rows[0]) world.company = rows[0];
    }
  } catch (e) {}

  // 3) Today's most-relevant JSA (active > signed > pending_safety > pending_foreman > draft)
  try {
    const { rows } = await db.db.query(
      `SELECT id, jsa_number, status, trade, form_data,
              foreman_name, safety_name, foreman_approved_at, safety_approved_at
       FROM jsa_records
       WHERE date = CURRENT_DATE::text
         AND status != 'rejected'
         AND (person_id = $1 OR crew_members LIKE $2)
       ORDER BY
         CASE status
           WHEN 'active' THEN 1
           WHEN 'signed' THEN 2
           WHEN 'pending_safety' THEN 3
           WHEN 'pending_foreman' THEN 4
           WHEN 'draft' THEN 5
           ELSE 6
         END
       LIMIT 1`,
      [personId, `%${personId}%`]
    );
    if (rows[0]) {
      let hazardsSummary = '';
      try {
        const fd = typeof rows[0].form_data === 'string'
          ? JSON.parse(rows[0].form_data || '{}')
          : (rows[0].form_data || {});
        const hazards = [];
        for (let i = 1; i <= 5; i++) {
          const step = fd[`step${i}`] || {};
          if (step.hazard) hazards.push(step.hazard);
          if (Array.isArray(step.hazards)) hazards.push(...step.hazards);
        }
        hazardsSummary = hazards.filter(Boolean).slice(0, 6).join('; ');
      } catch {}
      world.jsa_today = {
        jsa_number: rows[0].jsa_number,
        status: rows[0].status,
        trade: rows[0].trade,
        foreman_approved: !!rows[0].foreman_approved_at,
        safety_approved: !!rows[0].safety_approved_at,
        hazards_summary: hazardsSummary,
      };
    }
  } catch (e) {}

  // 4) Real certifications (file-uploaded permits, NOT the free-text people.certifications column)
  try {
    const { rows } = await db.db.query(
      `SELECT cert_name, cert_type, expiration_date
       FROM certifications
       WHERE person_id = $1
       ORDER BY uploaded_at DESC
       LIMIT 20`,
      [personId]
    );
    world.certifications = rows;
  } catch (e) {}

  return world;
}

/**
 * Format a worker-world object as a readable text block to append to a system prompt.
 * Returns '' if the world is empty or only contains a stub person record.
 */
function formatWorkerWorldBlock(world) {
  if (!world || !world.person) return '';
  const lines = [];
  lines.push('');
  lines.push('── Worker context (live from DB at request time) ──');

  const p = world.person;
  const tradeBit = p.trade ? `, ${p.trade}` : '';
  const roleBit = p.role_title || 'role unknown';
  lines.push(`Worker: ${p.name} (${roleBit}${tradeBit})`);

  if (p.supervisor_name) {
    const supRole = p.supervisor_role ? ` (${p.supervisor_role})` : '';
    lines.push(`Foreman/Supervisor: ${p.supervisor_name}${supRole}`);
  } else {
    lines.push('Foreman/Supervisor: not assigned in records');
  }

  if (world.project) {
    const pr = world.project;
    const ptrade = pr.project_trade ? ` (${pr.project_trade})` : '';
    lines.push(`Project: ${pr.project_name}${ptrade}`);
    if (pr.project_description) {
      lines.push(`  Scope: ${pr.project_description}`);
    }
    if (pr.customer_name) {
      lines.push(`Customer: ${pr.customer_name}`);
    }
  } else if (world.company) {
    lines.push(`Customer: ${world.company.name}`);
  } else {
    lines.push('Project: not assigned');
  }

  if (world.jsa_today) {
    const j = world.jsa_today;
    const statusLabel = {
      'draft': 'DRAFT (not yet submitted to foreman)',
      'pending_foreman': 'awaiting FOREMAN approval',
      'pending_safety': 'awaiting SAFETY approval',
      'signed': 'signed by worker, pending approval chain',
      'active': 'ACTIVE (approved, work is permitted)',
    }[j.status] || j.status;
    const num = j.jsa_number || '(no number)';
    lines.push(`Today's JSA: ${num} — ${statusLabel}`);
    if (j.hazards_summary) {
      lines.push(`  Hazards on JSA: ${j.hazards_summary}`);
    }
  } else {
    lines.push("Today's JSA: NONE on file for today");
  }

  if (world.certifications && world.certifications.length > 0) {
    const certNames = world.certifications
      .map(c => c.cert_name || c.cert_type)
      .filter(Boolean);
    if (certNames.length > 0) {
      lines.push(`On-file certifications/permits: ${certNames.slice(0, 10).join(', ')}`);
    }
  }

  lines.push('');
  lines.push("Use this context only when relevant to what the worker is asking. Don't dump it.");
  return lines.join('\n');
}

module.exports = {
  loadWorkerWorld,
  formatWorkerWorldBlock,
};
