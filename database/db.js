/**
 * Database helper module — wraps node-postgres (pg) for Voice Report
 * Async replacement for the better-sqlite3 db.js
 */

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5433,
  database: process.env.PG_DATABASE || 'horizon',
  user: process.env.PG_USER || 'horizon_spark',
  password: process.env.PG_PASSWORD || '8oS4oc2hyYhyq698CPSqXbA1',
  options: '-c search_path=voicereport',
});

// Export pool as `db` for raw queries in routes
const db = pool;

// Prometheus pool monitoring — initialized after require cycle resolves
function initPoolMetrics() {
  try {
    const { dbPoolSize, dbErrorsTotal } = require('../server/services/metrics');
    const interval = setInterval(() => {
      dbPoolSize.set({ state: 'total' }, pool.totalCount);
      dbPoolSize.set({ state: 'idle' }, pool.idleCount);
      dbPoolSize.set({ state: 'waiting' }, pool.waitingCount);
    }, 5000);
    interval.unref(); // Don't keep process alive just for metrics
    pool.on('error', () => { dbErrorsTotal.inc(); });
  } catch (e) {
    // metrics module not loaded yet — will be initialized via db.initPoolMetrics()
  }
}
// Try immediate init, server/index.js calls db.initPoolMetrics() as fallback
initPoolMetrics();

// ============================================
// TEMPLATES
// ============================================
const templates = {
  async getAll() {
    const { rows } = await (this._pool || pool).query('SELECT *, is_system FROM templates ORDER BY trade, role_level');
    return rows.map(t => ({
      ...t,
      output_sections: JSON.parse(t.output_sections || '[]'),
      vocabulary: JSON.parse(t.vocabulary || '{}'),
      safety_rules: JSON.parse(t.safety_rules || '[]'),
      safety_vocabulary: JSON.parse(t.safety_vocabulary || '[]'),
      tools_and_equipment: JSON.parse(t.tools_and_equipment || '[]'),
    }));
  },

  async getById(id) {
    const { rows } = await (this._pool || pool).query('SELECT * FROM templates WHERE id = $1', [id]);
    const t = rows[0];
    if (!t) return null;
    return {
      ...t,
      output_sections: JSON.parse(t.output_sections || '[]'),
      vocabulary: JSON.parse(t.vocabulary || '{}'),
      safety_rules: JSON.parse(t.safety_rules || '[]'),
      safety_vocabulary: JSON.parse(t.safety_vocabulary || '[]'),
      tools_and_equipment: JSON.parse(t.tools_and_equipment || '[]'),
    };
  },

  /**
   * Rank fallback: find the nearest template ABOVE the given role level
   * within the SAME trade. Trades never cross — each trade is its own universe.
   * If no template exists above, returns the highest available template in the trade.
   * If no templates exist for the trade at all, returns null.
   */
  async getFallbackForTrade(trade, roleLevel) {
    if (!trade) return null;
    // Look for templates at the same level or above, ordered by closest first
    const { rows } = await (this._pool || pool).query(
      'SELECT * FROM templates WHERE trade = $1 AND role_level >= $2 ORDER BY role_level ASC LIMIT 1',
      [trade, roleLevel]
    );
    let t = rows[0];
    // If nothing above, get the highest template in this trade
    if (!t) {
      const { rows: fallback } = await (this._pool || pool).query(
        'SELECT * FROM templates WHERE trade = $1 ORDER BY role_level DESC LIMIT 1',
        [trade]
      );
      t = fallback[0];
    }
    if (!t) return null;
    return {
      ...t,
      output_sections: JSON.parse(t.output_sections || '[]'),
      vocabulary: JSON.parse(t.vocabulary || '{}'),
      safety_rules: JSON.parse(t.safety_rules || '[]'),
      safety_vocabulary: JSON.parse(t.safety_vocabulary || '[]'),
      tools_and_equipment: JSON.parse(t.tools_and_equipment || '[]'),
    };
  },

  async create(t) {
    await (this._pool || pool).query(`
      INSERT INTO templates (id, template_name, role_level, role_level_title, trade,
        role_description, report_focus, output_sections, vocabulary, language_notes,
        safety_rules, safety_vocabulary, tools_and_equipment, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [
      t.id, t.template_name, t.role_level || 1, t.role_level_title || '', t.trade || 'Electrical',
      t.role_description || '', t.report_focus || '',
      JSON.stringify(t.output_sections || []), JSON.stringify(t.vocabulary || {}),
      t.language_notes || '', JSON.stringify(t.safety_rules || []),
      JSON.stringify(t.safety_vocabulary || []), JSON.stringify(t.tools_and_equipment || []),
      t.created_at || new Date().toISOString()
    ]);
    return t;
  },

  async update(id, data, callerLevel = 'admin') {
    const existing = await this.getById(id);
    if (!existing) return null;
    // Protect system templates from client-level edits to core fields
    const { rows } = await (this._pool || pool).query('SELECT is_system FROM templates WHERE id = $1', [id]);
    const isSystem = rows[0];
    if (isSystem && isSystem.is_system && callerLevel !== 'superadmin') {
      const allowed = ['vocabulary', 'language_notes'];
      const restricted = Object.keys(data).filter(k => !allowed.includes(k));
      if (restricted.length > 0) {
        return { error: 'Cannot modify system template core fields. Contact Horizon Sparks support.' };
      }
    }
    const merged = { ...existing, ...data };
    await (this._pool || pool).query(`
      UPDATE templates SET template_name=$1, role_level=$2, role_level_title=$3, trade=$4,
        role_description=$5, report_focus=$6, output_sections=$7, vocabulary=$8, language_notes=$9,
        safety_rules=$10, safety_vocabulary=$11, tools_and_equipment=$12, updated_at=$13
      WHERE id=$14
    `, [
      merged.template_name, merged.role_level, merged.role_level_title, merged.trade,
      merged.role_description, merged.report_focus,
      JSON.stringify(merged.output_sections || []), JSON.stringify(merged.vocabulary || {}),
      merged.language_notes || '',
      JSON.stringify(merged.safety_rules || []), JSON.stringify(merged.safety_vocabulary || []),
      JSON.stringify(merged.tools_and_equipment || []),
      new Date().toISOString(), id
    ]);
    return this.getById(id);
  },

  async deleteTemplate(id, callerLevel = 'admin') {
    const { rows } = await (this._pool || pool).query('SELECT is_system FROM templates WHERE id = $1', [id]);
    const tmpl = rows[0];
    if (!tmpl) return { error: 'Template not found' };
    if (tmpl.is_system && callerLevel !== 'superadmin') {
      return { error: 'Cannot delete system template. Contact Horizon Sparks support.' };
    }
    await (this._pool || pool).query('DELETE FROM templates WHERE id = $1', [id]);
    return { success: true };
  },
};

// ============================================
// PEOPLE
// ============================================
const people = {
  async getAll(companyId) {
    let sql = `SELECT id, name, role_title, status, pin, template_id, role_level, photo, supervisor_id, trade, company_id
      FROM people`;
    const params = [];
    if (companyId) {
      sql += ' WHERE company_id = $1';
      params.push(companyId);
    }
    sql += ' ORDER BY role_level DESC, name';
    const { rows } = await (this._pool || pool).query(sql, params);
    return rows;
  },

  async getById(id) {
    const { rows } = await (this._pool || pool).query('SELECT * FROM people WHERE id = $1', [id]);
    const p = rows[0];
    if (!p) return null;
    // Reconstruct personal_context for backward compatibility
    p.personal_context = {
      role_description: p.custom_role_description || '',
      report_focus: p.custom_report_focus || '',
      output_sections: JSON.parse(p.custom_output_sections || '[]'),
      safety_rules: JSON.parse(p.custom_safety_rules || '[]'),
      experience: p.experience || '',
      specialties: p.specialties || '',
      certifications: p.certifications || '',
      language_preference: p.language_preference || '',
      notes: p.notes || '',
    };
    // Include template data if not overridden
    // Rank fallback: if person's template is missing, find the nearest template
    // UP in the same trade. Trades never cross.
    let tmpl = null;
    if (p.template_id) {
      tmpl = await templates.getById(p.template_id);
    }
    if (!tmpl && p.trade) {
      // Fallback: find nearest template above this person's role level, same trade only
      tmpl = await templates.getFallbackForTrade(p.trade, p.role_level || 0);
    }
    if (tmpl) {
      if (!p.personal_context.role_description) p.personal_context.role_description = tmpl.role_description;
      if (!p.personal_context.report_focus) p.personal_context.report_focus = tmpl.report_focus;
      if (p.personal_context.output_sections.length === 0) p.personal_context.output_sections = tmpl.output_sections;
      if (p.personal_context.safety_rules.length === 0) p.personal_context.safety_rules = tmpl.safety_rules;
      p.personal_context.safety_vocabulary = tmpl.safety_vocabulary || [];
      p.personal_context.tools_and_equipment = tmpl.tools_and_equipment || [];
      if (tmpl.language_notes) p.personal_context.language_preference = p.language_preference || tmpl.language_notes;
    }
    return p;
  },

  async getByPin(pin) {
    const { rows } = await (this._pool || pool).query('SELECT * FROM people WHERE pin = $1 AND status = $2', [pin, 'active']);
    const p = rows[0];
    if (!p) return null;
    return this.getById(p.id);
  },

  async create(data) {
    const id = data.id || 'person_' + Date.now();
    const pc = data.personal_context || {};
    // Get trade from template
    let trade = data.trade || null;
    if (!trade && data.template_id) {
      const tmpl = await templates.getById(data.template_id);
      if (tmpl) trade = tmpl.trade;
    }

    await (this._pool || pool).query(`
      INSERT INTO people (id, name, pin, template_id, role_title, role_level, trade,
        supervisor_id, status, project_id, photo, is_admin,
        experience, specialties, certifications, language_preference, notes,
        custom_role_description, custom_report_focus, custom_output_sections, custom_safety_rules,
        webauthn_credential_id, webauthn_raw_id, webauthn_public_key, company_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
    `, [
      id, data.name, data.pin, data.template_id || null,
      data.role_title || '', data.role_level || 1, trade,
      data.supervisor_id || null, data.status || 'active',
      data.project_id || 'default', data.photo || null, data.is_admin ? 1 : 0,
      pc.experience || null, pc.specialties || null, pc.certifications || null,
      pc.language_preference || null, pc.notes || null,
      pc.role_description || null, pc.report_focus || null,
      pc.output_sections ? JSON.stringify(pc.output_sections) : null,
      pc.safety_rules ? JSON.stringify(pc.safety_rules) : null,
      data.webauthn_credential_id || null, data.webauthn_raw_id || null,
      data.webauthn_public_key || null,
      data.company_id || null,
      new Date().toISOString()
    ]);

    // Rebuild visibility for this person
    await this._rebuildVisibility(id);
    return { success: true, id };
  },

  async update(id, data) {
    const { rows: existRows } = await (this._pool || pool).query('SELECT * FROM people WHERE id = $1', [id]);
    if (existRows.length === 0) return null;

    const pc = data.personal_context || {};
    const updates = {};

    // Map flat fields
    const flatFields = ['name', 'pin', 'template_id', 'role_title', 'role_level', 'trade',
      'supervisor_id', 'status', 'project_id', 'photo', 'is_admin',
      'webauthn_credential_id', 'webauthn_raw_id', 'webauthn_public_key'];

    for (const f of flatFields) {
      if (data[f] !== undefined) updates[f] = data[f];
    }

    // Map personal_context fields
    const pcFields = { experience: 'experience', specialties: 'specialties',
      certifications: 'certifications', language_preference: 'language_preference',
      notes: 'notes', role_description: 'custom_role_description',
      report_focus: 'custom_report_focus' };

    for (const [pcKey, dbCol] of Object.entries(pcFields)) {
      if (pc[pcKey] !== undefined) updates[dbCol] = pc[pcKey];
    }
    if (pc.output_sections) updates.custom_output_sections = JSON.stringify(pc.output_sections);
    if (pc.safety_rules) updates.custom_safety_rules = JSON.stringify(pc.safety_rules);

    // Get trade from template if changing template
    if (updates.template_id && !updates.trade) {
      const tmpl = await templates.getById(updates.template_id);
      if (tmpl) updates.trade = tmpl.trade;
    }

    if (Object.keys(updates).length > 0) {
      const keys = Object.keys(updates);
      let paramIdx = 1;
      const setClauses = keys.map(k => `${k} = $${paramIdx++}`).join(', ');
      const values = [...Object.values(updates), new Date().toISOString(), id];
      await (this._pool || pool).query(`UPDATE people SET ${setClauses}, updated_at = $${paramIdx++} WHERE id = $${paramIdx}`, values);
    }

    // Rebuild visibility if supervisor changed
    if (data.supervisor_id !== undefined) {
      await this._rebuildAllVisibility();
    }

    return { success: true };
  },

  async delete(id, callerLevel = 'admin') {
    if (callerLevel === 'superadmin') {
      // Hard delete — only platform superadmin can do this
      await (this._pool || pool).query('DELETE FROM report_visibility WHERE person_id = $1 OR viewer_id = $1', [id]);
      await (this._pool || pool).query('DELETE FROM people WHERE id = $1', [id]);
      return { success: true, type: 'hard_delete' };
    }
    // Soft delete — deactivate instead. Reports stay in the system.
    const now = new Date().toISOString();
    await (this._pool || pool).query(`UPDATE people SET status = 'inactive', deactivated_at = $1, updated_at = $2 WHERE id = $3`, [now, now, id]);
    // Remove from visibility chain (they're inactive, reports should still be searchable)
    await (this._pool || pool).query('DELETE FROM report_visibility WHERE person_id = $1', [id]);
    return { success: true, type: 'deactivated' };
  },

  // Get people who report to this person
  async getTeam(supervisorId) {
    const { rows } = await (this._pool || pool).query(`
      SELECT id, name, role_title, role_level, pin, status, photo, trade
      FROM people WHERE supervisor_id = $1 AND status = 'active'
      ORDER BY role_level DESC, name
    `, [supervisorId]);
    return rows;
  },

  // Find by WebAuthn credential
  async getByWebAuthn(credentialId) {
    const { rows } = await (this._pool || pool).query('SELECT * FROM people WHERE webauthn_credential_id = $1', [credentialId]);
    return rows[0] || null;
  },

  // Rebuild visibility chain for one person
  async _rebuildVisibility(personId) {
    await (this._pool || pool).query('DELETE FROM report_visibility WHERE person_id = $1', [personId]);
    // Self can always see own
    await (this._pool || pool).query('INSERT INTO report_visibility (person_id, viewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [personId, personId]);
    // Walk up supervisor chain
    const { rows } = await (this._pool || pool).query('SELECT supervisor_id FROM people WHERE id = $1', [personId]);
    const person = rows[0];
    if (!person) return;
    let currentSup = person.supervisor_id;
    const visited = new Set();
    while (currentSup && !visited.has(currentSup)) {
      visited.add(currentSup);
      await (this._pool || pool).query('INSERT INTO report_visibility (person_id, viewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [personId, currentSup]);
      const { rows: supRows } = await (this._pool || pool).query('SELECT supervisor_id FROM people WHERE id = $1', [currentSup]);
      const sup = supRows[0];
      currentSup = sup ? sup.supervisor_id : null;
    }
  },

  // Rebuild all visibility (when supervisor changes)
  async _rebuildAllVisibility() {
    await (this._pool || pool).query('DELETE FROM report_visibility');
    const { rows: allPeople } = await (this._pool || pool).query('SELECT id, supervisor_id FROM people');
    for (const p of allPeople) {
      await (this._pool || pool).query('INSERT INTO report_visibility (person_id, viewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [p.id, p.id]);
      let currentSup = p.supervisor_id;
      const visited = new Set();
      while (currentSup && !visited.has(currentSup)) {
        visited.add(currentSup);
        await (this._pool || pool).query('INSERT INTO report_visibility (person_id, viewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [p.id, currentSup]);
        const sup = allPeople.find(x => x.id === currentSup);
        currentSup = sup ? sup.supervisor_id : null;
      }
    }
  },
};

// ============================================
// REPORTS
// ============================================
const reports = {
  async getAll(filters = {}) {
    let sql = 'SELECT * FROM reports WHERE 1=1';
    const params = [];
    let paramIdx = 1;

    if (filters.person_id) {
      sql += ` AND person_id = $${paramIdx++}`;
      params.push(filters.person_id);
    }
    if (filters.trade) {
      sql += ` AND trade = $${paramIdx++}`;
      params.push(filters.trade);
    }
    if (filters.viewer_id) {
      sql += ` AND person_id IN (SELECT person_id FROM report_visibility WHERE viewer_id = $${paramIdx++})`;
      params.push(filters.viewer_id);
    }
    if (filters.company_id) {
      sql += ` AND company_id = $${paramIdx++}`;
      params.push(filters.company_id);
    }

    sql += ' ORDER BY created_at DESC';

    if (filters.limit) {
      sql += ` LIMIT $${paramIdx++}`;
      params.push(filters.limit);
    }

    const { rows } = await (this._pool || pool).query(sql, params);
    return rows.map(r => ({
      ...r,
      audio_files: JSON.parse(r.audio_files || '[]'),
      conversation_turns: JSON.parse(r.conversation_turns || '[]'),
      photos: JSON.parse(r.photos || '[]'),
      messages_addressed: JSON.parse(r.messages_addressed || '[]'),
    }));
  },

  async getById(id) {
    const { rows } = await (this._pool || pool).query('SELECT * FROM reports WHERE id = $1', [id]);
    const r = rows[0];
    if (!r) return null;
    return {
      ...r,
      audio_files: JSON.parse(r.audio_files || '[]'),
      conversation_turns: JSON.parse(r.conversation_turns || '[]'),
      photos: JSON.parse(r.photos || '[]'),
      messages_addressed: JSON.parse(r.messages_addressed || '[]'),
    };
  },

  async create(data) {
    const id = data.id || new Date().toISOString().replace(/[:.]/g, '-');
    // Get trade from person
    let trade = data.trade || null;
    if (!trade && data.person_id) {
      const { rows } = await (this._pool || pool).query('SELECT trade FROM people WHERE id = $1', [data.person_id]);
      const person = rows[0];
      if (person) trade = person.trade;
    }

    // Get company_id from person if not provided
    let companyId = data.company_id || null;
    if (!companyId && data.person_id) {
      const { rows: pRows } = await (this._pool || pool).query('SELECT company_id FROM people WHERE id = $1', [data.person_id]);
      if (pRows[0]) companyId = pRows[0].company_id;
    }

    await (this._pool || pool).query(`
      INSERT INTO reports (id, person_id, person_name, role_title, template_id, trade,
        project_id, status, created_at, duration_seconds, audio_files,
        transcript_raw, markdown_verbatim, markdown_structured, conversation_turns,
        photos, messages_addressed, company_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    `, [
      id, data.person_id, data.person_name || '', data.role_title || '',
      data.template_id || null, trade,
      data.project_id || 'default', data.status || 'complete',
      data.created_at || new Date().toISOString(),
      data.duration_seconds || 0,
      JSON.stringify(data.audio_files || []),
      data.transcript_raw || '', data.markdown_verbatim || '',
      data.markdown_structured || '',
      JSON.stringify(data.conversation_turns || []),
      JSON.stringify(data.photos || []),
      JSON.stringify(data.messages_addressed || []),
      companyId
    ]);
    return { success: true, id };
  },

  // Full-text search across all reports
  async search(query, viewerId, companyId) {
    // Use ILIKE fallback instead of FTS5 MATCH
    const searchPattern = `%${query}%`;
    let sql = `
      SELECT r.id, r.person_name, r.role_title, r.created_at, r.trade,
        substring(r.transcript_raw from 1 for 200) as preview
      FROM reports r
      WHERE (r.transcript_raw ILIKE $1 OR r.markdown_structured ILIKE $1 OR r.markdown_verbatim ILIKE $1)
    `;
    const params = [searchPattern];
    let paramIdx = 2;

    if (viewerId) {
      sql += ` AND r.person_id IN (SELECT person_id FROM report_visibility WHERE viewer_id = $${paramIdx++})`;
      params.push(viewerId);
    }
    if (companyId) {
      sql += ` AND r.company_id = $${paramIdx++}`;
      params.push(companyId);
    }

    sql += ' ORDER BY r.created_at DESC LIMIT 50';
    const { rows } = await (this._pool || pool).query(sql, params);
    return rows;
  },
};

// ============================================
// MESSAGES (private between two people)
// ============================================
const messages = {
  async getConversation(personA, personB) {
    const { rows } = await (this._pool || pool).query(`
      SELECT * FROM messages
      WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)
      ORDER BY created_at ASC
    `, [personA, personB]);
    return rows.map(m => ({
      ...m,
      metadata: JSON.parse(m.metadata || '{}'),
    }));
  },

  async getForPerson(personId) {
    const { rows } = await (this._pool || pool).query(`
      SELECT * FROM messages
      WHERE from_id = $1 OR to_id = $1
      ORDER BY created_at DESC
    `, [personId]);
    return rows.map(m => ({
      ...m,
      metadata: JSON.parse(m.metadata || '{}'),
    }));
  },

  async getUnread(personId) {
    const { rows } = await (this._pool || pool).query(`
      SELECT * FROM messages
      WHERE to_id = $1 AND read_at IS NULL
      ORDER BY created_at DESC
    `, [personId]);
    return rows;
  },

  async create(data) {
    const id = data.id || 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    await (this._pool || pool).query(`
      INSERT INTO messages (id, from_id, to_id, from_name, to_name, type, content,
        audio_file, photo, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      id, data.from_id, data.to_id, data.from_name || '', data.to_name || '',
      data.type || 'text', data.content || '', data.audio_file || null,
      data.photo || null, JSON.stringify(data.metadata || {}),
      new Date().toISOString()
    ]);
    return { success: true, id };
  },

  async markRead(messageId) {
    await (this._pool || pool).query('UPDATE messages SET read_at = $1 WHERE id = $2', [new Date().toISOString(), messageId]);
  },

  // Search messages (privacy-scoped)
  async search(query, personId) {
    const searchPattern = `%${query}%`;
    const { rows } = await (this._pool || pool).query(`
      SELECT m.* FROM messages m
      WHERE m.content ILIKE $1
        AND (m.from_id = $2 OR m.to_id = $2)
      ORDER BY m.created_at DESC LIMIT 50
    `, [searchPattern, personId]);
    return rows;
  },
};

// ============================================
// CONTACTS — who can message who (chain of command rules)
// ============================================
const contacts = {
  // Get all people this person is allowed to message
  async getForPerson(personId) {
    const { rows: personRows } = await (this._pool || pool).query('SELECT id, supervisor_id, role_level, trade FROM people WHERE id = $1', [personId]);
    const person = personRows[0];
    if (!person) return [];

    const contactIds = new Set();

    // 1. Direct supervisor (one level UP)
    if (person.supervisor_id) {
      contactIds.add(person.supervisor_id);
    }

    // 2. Direct reports (one level DOWN) — same company only
    const { rows: directReports } = await (this._pool || pool).query("SELECT id FROM people WHERE supervisor_id = $1 AND status = 'active' AND company_id = (SELECT company_id FROM people WHERE id = $2)", [personId, personId]);
    directReports.forEach(r => contactIds.add(r.id));

    // 3. Sideways — same supervisor (same crew)
    if (person.supervisor_id) {
      const { rows: siblings } = await (this._pool || pool).query("SELECT id FROM people WHERE supervisor_id = $1 AND id != $2 AND status = 'active'", [person.supervisor_id, personId]);
      siblings.forEach(s => contactIds.add(s.id));
    }

    // 4. For supervisors (role_level >= 3): can also reach everyone below them (not just direct reports)
    if (person.role_level >= 3) {
      const { rows: allBelow } = await (this._pool || pool).query("SELECT person_id FROM report_visibility WHERE viewer_id = $1 AND person_id != $1", [personId]);
      allBelow.forEach(r => contactIds.add(r.person_id));
    }

    // 5. Sparks team — all members with sparks_role can message each other
    const { rows: sparksCheck } = await (this._pool || pool).query('SELECT sparks_role FROM people WHERE id = $1', [personId]);
    if (sparksCheck[0]?.sparks_role) {
      const { rows: sparksTeam } = await (this._pool || pool).query("SELECT id FROM people WHERE sparks_role IS NOT NULL AND id != $1", [personId]);
      sparksTeam.forEach(s => contactIds.add(s.id));
    }

    // Remove self
    contactIds.delete(personId);

    if (contactIds.size === 0) return [];

    // Fetch contact details
    const ids = [...contactIds];
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await (this._pool || pool).query(`
      SELECT id, name, role_title, role_level, photo, trade, supervisor_id, is_lead_man
      FROM people WHERE id IN (${placeholders}) AND status = 'active'
      ORDER BY role_level DESC, is_lead_man DESC, name
    `, ids);
    return rows;
  },

  // Check if person A is allowed to message person B
  async canMessage(fromId, toId) {
    const { rows: fromRows } = await (this._pool || pool).query('SELECT id, supervisor_id, role_level, sparks_role FROM people WHERE id = $1', [fromId]);
    const { rows: toRows } = await (this._pool || pool).query('SELECT id, supervisor_id, role_level, sparks_role FROM people WHERE id = $1', [toId]);
    const from = fromRows[0];
    const to = toRows[0];
    if (!from || !to) return false;

    // Sparks team members can always message each other
    if (from.sparks_role && to.sparks_role) return true;
    // Direct supervisor
    if (from.supervisor_id === toId) return true;
    // Direct report
    if (to.supervisor_id === fromId) return true;
    // Same crew (same supervisor)
    if (from.supervisor_id && from.supervisor_id === to.supervisor_id) return true;
    // Supervisors (level 3+) can reach anyone below them
    if (from.role_level >= 3) {
      const { rows: vis } = await (this._pool || pool).query('SELECT 1 FROM report_visibility WHERE person_id = $1 AND viewer_id = $2', [toId, fromId]);
      if (vis.length > 0) return true;
    }
    return false;
  },

  // Get conversation list (recent conversations with unread counts)
  async getConversationList(personId) {
    const { rows: conversations } = await (this._pool || pool).query(`
      SELECT
        CASE WHEN from_id = $1 THEN to_id ELSE from_id END as contact_id,
        CASE WHEN from_id = $1 THEN to_name ELSE from_name END as contact_name,
        MAX(created_at) as last_message_at,
        COUNT(CASE WHEN to_id = $1 AND read_at IS NULL THEN 1 END) as unread_count
      FROM messages
      WHERE from_id = $1 OR to_id = $1
      GROUP BY contact_id, contact_name
      ORDER BY last_message_at DESC
    `, [personId]);

    // Enrich with person details
    const results = [];
    for (const c of conversations) {
      const { rows: contactRows } = await (this._pool || pool).query('SELECT id, name, role_title, role_level, photo, is_lead_man FROM people WHERE id = $1', [c.contact_id]);
      const contact = contactRows[0];
      const { rows: lastMsgRows } = await (this._pool || pool).query(`
        SELECT content, type, from_id FROM messages
        WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)
        ORDER BY created_at DESC LIMIT 1
      `, [personId, c.contact_id]);
      const lastMsg = lastMsgRows[0];

      results.push({
        contact_id: c.contact_id,
        contact_name: contact ? contact.name : c.contact_name,
        role_title: contact ? contact.role_title : '',
        role_level: contact ? contact.role_level : 0,
        photo: contact ? contact.photo : null,
        last_message_at: c.last_message_at,
        unread_count: parseInt(c.unread_count, 10),
        last_message_preview: lastMsg ? (lastMsg.type === 'text' ? lastMsg.content.substring(0, 60) : `[${lastMsg.type}]`) : '',
        last_message_is_mine: lastMsg ? lastMsg.from_id === personId : false,
        is_lead_man: contact ? (contact.is_lead_man || 0) : 0,
      });
    }
    return results;
  },
};

// ============================================
// LEGACY MESSAGE SUPPORT (supervisor → worker messages from JSON)
// ============================================
const legacyMessages = {
  getForPerson(personId) {
    const filePath = path.join(__dirname, '..', 'messages', `${personId}.json`);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  },

  save(personId, msgs) {
    const filePath = path.join(__dirname, '..', 'messages', `${personId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(msgs, null, 2));
  },
};

// ============================================
// AI CONVERSATIONS
// ============================================
const aiConversations = {
  async getHistory(personId, limit = 50) {
    const { rows } = await (this._pool || pool).query(`
      SELECT * FROM ai_conversations
      WHERE person_id = $1
      ORDER BY created_at DESC LIMIT $2
    `, [personId, limit]);
    return rows.reverse();
  },

  async addTurn(personId, sessionId, role, content) {
    await (this._pool || pool).query(`
      INSERT INTO ai_conversations (person_id, session_id, role, content)
      VALUES ($1, $2, $3, $4)
    `, [personId, sessionId, role, content]);
  },
};

// ============================================
// PPE REQUESTS
// ============================================
const ppeRequests = {
  async create(data) {
    const id = 'ppe_' + Date.now();
    await (this._pool || pool).query(`
      INSERT INTO ppe_requests (id, requester_id, assigned_to, requester_name, items, status, notes)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6)
    `, [id, data.requester_id, data.assigned_to || null, data.requester_name || '',
      JSON.stringify(data.items), data.notes || '']);
    return { success: true, id };
  },

  async getForPerson(personId) {
    const { rows } = await (this._pool || pool).query(`
      SELECT * FROM ppe_requests
      WHERE requester_id = $1 OR assigned_to = $1
      ORDER BY created_at DESC
    `, [personId]);
    return rows.map(r => ({ ...r, items: JSON.parse(r.items || '[]') }));
  },

  async updateStatus(id, status, notes) {
    await (this._pool || pool).query('UPDATE ppe_requests SET status = $1, notes = $2, resolved_at = $3 WHERE id = $4',
      [status, notes || null, status === 'delivered' || status === 'denied' ? new Date().toISOString() : null, id]);
  },
};

// ============================================
// SAFETY OBSERVATIONS
// ============================================
const safetyObservations = {
  async create(data) {
    const id = 'safety_' + Date.now();
    await (this._pool || pool).query(`
      INSERT INTO safety_observations (id, person_id, person_name, type, severity,
        description, location, photo, assigned_to)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [id, data.person_id, data.person_name || '', data.type || 'observation',
      data.severity || 'low', data.description, data.location || null,
      data.photo || null, data.assigned_to || null]);
    return { success: true, id };
  },

  async getAll(filters = {}) {
    let sql = 'SELECT * FROM safety_observations WHERE 1=1';
    const params = [];
    let paramIdx = 1;
    if (filters.status) { sql += ` AND status = $${paramIdx++}`; params.push(filters.status); }
    if (filters.type) { sql += ` AND type = $${paramIdx++}`; params.push(filters.type); }
    sql += ' ORDER BY created_at DESC';
    const { rows } = await (this._pool || pool).query(sql, params);
    return rows;
  },
};

// ============================================
// DAILY PLANS
// ============================================
const dailyPlans = {
  async create(data) {
    const id = 'plan_' + Date.now();
    await (this._pool || pool).query(`INSERT INTO daily_plans (id, date, created_by, trade, notes) VALUES ($1, $2, $3, $4, $5)`,
      [id, data.date, data.created_by, data.trade || null, data.notes || null]);
    return { success: true, id };
  },

  async getByDate(date, createdBy) {
    const { rows } = await (this._pool || pool).query('SELECT * FROM daily_plans WHERE date = $1 AND created_by = $2', [date, createdBy]);
    return rows[0] || null;
  },

  async getOrCreate(date, createdBy, trade) {
    let plan = await this.getByDate(date, createdBy);
    if (!plan) {
      const result = await this.create({ date, created_by: createdBy, trade });
      const { rows } = await (this._pool || pool).query('SELECT * FROM daily_plans WHERE id = $1', [result.id]);
      plan = rows[0];
    }
    return plan;
  },

  async getPlansForPerson(personId) {
    const { rows } = await (this._pool || pool).query(`
      SELECT DISTINCT dp.* FROM daily_plans dp
      JOIN daily_plan_tasks t ON t.plan_id = dp.id
      WHERE t.assigned_to = $1
      ORDER BY dp.date DESC
    `, [personId]);
    return rows;
  },

  async addTask(data) {
    const id = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    await (this._pool || pool).query(`INSERT INTO daily_plan_tasks (id, plan_id, assigned_to, title, description, status, priority, form_id, folder_data, attachments, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, data.plan_id, data.assigned_to || null, data.title, data.description || null,
        data.status || 'pending', data.priority || 'normal', data.form_id || null,
        data.folder_data ? JSON.stringify(data.folder_data) : null,
        JSON.stringify(data.attachments || []), data.sort_order || 0]);
    return { success: true, id };
  },

  async getTasks(planId) {
    const { rows } = await (this._pool || pool).query('SELECT * FROM daily_plan_tasks WHERE plan_id = $1 ORDER BY sort_order, created_at', [planId]);
    return rows.map(t => ({ ...t, attachments: JSON.parse(t.attachments || '[]'), folder_data: t.folder_data ? JSON.parse(t.folder_data) : null }));
  },

  async getTasksForPerson(personId, date) {
    const { rows } = await (this._pool || pool).query(`
      SELECT t.*, dp.date, dp.created_by FROM daily_plan_tasks t
      JOIN daily_plans dp ON dp.id = t.plan_id
      WHERE t.assigned_to = $1 AND dp.date = $2
      ORDER BY t.sort_order, t.created_at
    `, [personId, date]);
    return rows.map(t => ({ ...t, attachments: JSON.parse(t.attachments || '[]'), folder_data: t.folder_data ? JSON.parse(t.folder_data) : null }));
  },

  async updateTask(taskId, data) {
    const sets = [];
    const vals = [];
    let paramIdx = 1;
    if (data.status !== undefined) { sets.push(`status = $${paramIdx++}`); vals.push(data.status); }
    if (data.title !== undefined) { sets.push(`title = $${paramIdx++}`); vals.push(data.title); }
    if (data.description !== undefined) { sets.push(`description = $${paramIdx++}`); vals.push(data.description); }
    if (data.assigned_to !== undefined) { sets.push(`assigned_to = $${paramIdx++}`); vals.push(data.assigned_to); }
    if (data.priority !== undefined) { sets.push(`priority = $${paramIdx++}`); vals.push(data.priority); }
    if (data.completed_at !== undefined) { sets.push(`completed_at = $${paramIdx++}`); vals.push(data.completed_at); }
    if (data.completed_notes !== undefined) { sets.push(`completed_notes = $${paramIdx++}`); vals.push(data.completed_notes); }
    if (sets.length === 0) return { success: false };
    vals.push(taskId);
    await (this._pool || pool).query(`UPDATE daily_plan_tasks SET ${sets.join(', ')} WHERE id = $${paramIdx}`, vals);
    return { success: true };
  },

  async deleteTask(taskId) {
    await (this._pool || pool).query('DELETE FROM daily_plan_tasks WHERE id = $1', [taskId]);
    return { success: true };
  },

  // ── Persistent task queries ──

  async getActiveTasks(personId) {
    const { rows } = await (this._pool || pool).query(`
      SELECT t.*, dp.date as plan_date, dp.created_by as plan_created_by,
        creator.name as created_by_name, assignee.name as assigned_to_name, assignee.role_title as assigned_to_role
      FROM daily_plan_tasks t
      JOIN daily_plans dp ON dp.id = t.plan_id
      LEFT JOIN people creator ON creator.id = COALESCE(t.created_by, dp.created_by)
      LEFT JOIN people assignee ON assignee.id = t.assigned_to
      WHERE (t.assigned_to = $1 OR dp.created_by = $1)
        AND t.status NOT IN ('completed', 'cancelled')
      ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END,
        t.created_at DESC
    `, [personId]);
    return rows.map(t => ({ ...t, attachments: JSON.parse(t.attachments || '[]'), folder_data: t.folder_data ? JSON.parse(t.folder_data) : null }));
  },

  async getActiveTasksForSupervisor(supervisorId) {
    const { rows } = await (this._pool || pool).query(`
      SELECT t.*, dp.date as plan_date, dp.created_by as plan_created_by,
        assignee.name as assigned_to_name, assignee.role_title as assigned_to_role
      FROM daily_plan_tasks t
      JOIN daily_plans dp ON dp.id = t.plan_id
      LEFT JOIN people assignee ON assignee.id = t.assigned_to
      WHERE (dp.created_by = $1 OR t.created_by = $1)
        AND t.status NOT IN ('completed', 'cancelled')
      ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END,
        t.created_at DESC
    `, [supervisorId]);
    return rows.map(t => ({ ...t, attachments: JSON.parse(t.attachments || '[]'), folder_data: t.folder_data ? JSON.parse(t.folder_data) : null }));
  },

  async getTaskById(taskId) {
    const { rows } = await (this._pool || pool).query(`
      SELECT t.*, dp.date as plan_date, dp.created_by as plan_created_by,
        creator.name as created_by_name, assignee.name as assigned_to_name, assignee.role_title as assigned_to_role
      FROM daily_plan_tasks t
      JOIN daily_plans dp ON dp.id = t.plan_id
      LEFT JOIN people creator ON creator.id = COALESCE(t.created_by, dp.created_by)
      LEFT JOIN people assignee ON assignee.id = t.assigned_to
      WHERE t.id = $1
    `, [taskId]);
    const t = rows[0];
    if (!t) return null;
    return { ...t, attachments: JSON.parse(t.attachments || '[]'), folder_data: t.folder_data ? JSON.parse(t.folder_data) : null };
  },

  async getTaskWithHistory(taskId) {
    const task = await this.getTaskById(taskId);
    if (!task) return null;
    const days = await taskDays.getForTask(taskId);
    return { ...task, days };
  },

  async getAllTasksForPerson(personId, filters = {}) {
    let where = '(t.assigned_to = $1 OR dp.created_by = $1)';
    const params = [personId];
    let paramIdx = 2;
    if (filters.status) { where += ` AND t.status = $${paramIdx++}`; params.push(filters.status); }
    if (filters.trade) { where += ` AND (t.trade = $${paramIdx++} OR dp.trade = $${paramIdx++})`; params.push(filters.trade, filters.trade); }
    const { rows } = await (this._pool || pool).query(`
      SELECT t.*, dp.date as plan_date, dp.created_by as plan_created_by,
        creator.name as created_by_name, assignee.name as assigned_to_name, assignee.role_title as assigned_to_role
      FROM daily_plan_tasks t
      JOIN daily_plans dp ON dp.id = t.plan_id
      LEFT JOIN people creator ON creator.id = COALESCE(t.created_by, dp.created_by)
      LEFT JOIN people assignee ON assignee.id = t.assigned_to
      WHERE ${where}
      ORDER BY t.created_at DESC
    `, params);
    return rows.map(t => ({ ...t, attachments: JSON.parse(t.attachments || '[]'), folder_data: t.folder_data ? JSON.parse(t.folder_data) : null }));
  },
};

// ============================================
// TASK DAYS (daily entries within persistent tasks)
// ============================================
const taskDays = {
  async create(data) {
    const id = 'td_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    await (this._pool || pool).query(`INSERT INTO task_days (id, task_id, date, person_id, jsa_id, shift_notes, shift_audio, shift_transcript, shift_structured, shift_conversation, photos, forms, hours_worked, weather)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id, data.task_id, data.date, data.person_id, data.jsa_id || null,
        data.shift_notes || null, data.shift_audio || null, data.shift_transcript || null,
        data.shift_structured || null, data.shift_conversation ? JSON.stringify(data.shift_conversation) : null,
        JSON.stringify(data.photos || []), JSON.stringify(data.forms || []),
        data.hours_worked || null, data.weather || null]);
    return { success: true, id };
  },

  async getForTask(taskId) {
    const { rows } = await (this._pool || pool).query(`
      SELECT td.*, j.status as jsa_status, j.jsa_number, j.form_data as jsa_form_data
      FROM task_days td
      LEFT JOIN jsa_records j ON j.id = td.jsa_id
      WHERE td.task_id = $1
      ORDER BY td.date DESC
    `, [taskId]);
    return rows.map(td => ({
      ...td,
      photos: JSON.parse(td.photos || '[]'),
      forms: JSON.parse(td.forms || '[]'),
      notes: JSON.parse(td.notes || '[]'),
      shift_conversation: td.shift_conversation ? JSON.parse(td.shift_conversation) : [],
    }));
  },

  async getForDate(taskId, date) {
    const { rows } = await (this._pool || pool).query(`
      SELECT td.*, j.status as jsa_status, j.jsa_number, j.form_data as jsa_form_data
      FROM task_days td
      LEFT JOIN jsa_records j ON j.id = td.jsa_id
      WHERE td.task_id = $1 AND td.date = $2
    `, [taskId, date]);
    const td = rows[0];
    if (!td) return null;
    return {
      ...td,
      photos: JSON.parse(td.photos || '[]'),
      forms: JSON.parse(td.forms || '[]'),
      notes: JSON.parse(td.notes || '[]'),
      shift_conversation: td.shift_conversation ? JSON.parse(td.shift_conversation) : [],
    };
  },

  async getOrCreate(taskId, date, personId) {
    let td = await this.getForDate(taskId, date);
    if (!td) {
      await this.create({ task_id: taskId, date, person_id: personId });
      td = await this.getForDate(taskId, date);
    }
    return td;
  },

  async update(id, data) {
    const sets = [];
    const vals = [];
    let paramIdx = 1;
    if (data.jsa_id !== undefined) { sets.push(`jsa_id = $${paramIdx++}`); vals.push(data.jsa_id); }
    if (data.shift_notes !== undefined) { sets.push(`shift_notes = $${paramIdx++}`); vals.push(data.shift_notes); }
    if (data.shift_audio !== undefined) { sets.push(`shift_audio = $${paramIdx++}`); vals.push(data.shift_audio); }
    if (data.shift_transcript !== undefined) { sets.push(`shift_transcript = $${paramIdx++}`); vals.push(data.shift_transcript); }
    if (data.shift_structured !== undefined) { sets.push(`shift_structured = $${paramIdx++}`); vals.push(data.shift_structured); }
    if (data.shift_conversation !== undefined) { sets.push(`shift_conversation = $${paramIdx++}`); vals.push(JSON.stringify(data.shift_conversation)); }
    if (data.photos !== undefined) { sets.push(`photos = $${paramIdx++}`); vals.push(JSON.stringify(data.photos)); }
    if (data.forms !== undefined) { sets.push(`forms = $${paramIdx++}`); vals.push(JSON.stringify(data.forms)); }
    if (data.hours_worked !== undefined) { sets.push(`hours_worked = $${paramIdx++}`); vals.push(data.hours_worked); }
    if (data.weather !== undefined) { sets.push(`weather = $${paramIdx++}`); vals.push(data.weather); }
    if (data.notes !== undefined) { sets.push(`notes = $${paramIdx++}`); vals.push(JSON.stringify(data.notes)); }
    if (sets.length === 0) return { success: false };
    vals.push(id);
    await (this._pool || pool).query(`UPDATE task_days SET ${sets.join(', ')} WHERE id = $${paramIdx}`, vals);
    return { success: true };
  },

  async getRecentForTask(taskId, limit = 3) {
    const { rows } = await (this._pool || pool).query(`
      SELECT td.date, td.shift_structured, td.shift_notes, td.hours_worked,
        j.jsa_number, j.form_data as jsa_form_data
      FROM task_days td
      LEFT JOIN jsa_records j ON j.id = td.jsa_id
      WHERE td.task_id = $1 AND (td.shift_structured IS NOT NULL OR td.shift_notes IS NOT NULL)
      ORDER BY td.date DESC LIMIT $2
    `, [taskId, limit]);
    return rows;
  },
};

// ============================================
// PUNCH LIST
// ============================================
const punchList = {
  async create(data) {
    const id = 'punch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    await (this._pool || pool).query(`INSERT INTO punch_items (id, title, description, location, trade, system_name, status, priority, photo, created_by, assigned_to, form_id, task_id, company_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id, data.title, data.description || null, data.location || null, data.trade || null,
        data.system_name || null, data.status || 'open', data.priority || 'normal',
        data.photo || null, data.created_by, data.assigned_to || null,
        data.form_id || null, data.task_id || null, data.company_id || null]);
    return { success: true, id };
  },

  async getAll(filters = {}) {
    let sql = 'SELECT p.*, creator.name as created_by_name, assignee.name as assigned_to_name FROM punch_items p LEFT JOIN people creator ON creator.id = p.created_by LEFT JOIN people assignee ON assignee.id = p.assigned_to WHERE 1=1';
    const params = [];
    let paramIdx = 1;
    if (filters.status) { sql += ` AND p.status = $${paramIdx++}`; params.push(filters.status); }
    if (filters.trade) { sql += ` AND p.trade = $${paramIdx++}`; params.push(filters.trade); }
    if (filters.assigned_to) { sql += ` AND p.assigned_to = $${paramIdx++}`; params.push(filters.assigned_to); }
    if (filters.created_by) { sql += ` AND p.created_by = $${paramIdx++}`; params.push(filters.created_by); }
    if (filters.company_id) { sql += ` AND p.company_id = $${paramIdx++}`; params.push(filters.company_id); }
    sql += " ORDER BY CASE p.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END, p.created_at DESC";
    const { rows } = await (this._pool || pool).query(sql, params);
    return rows;
  },

  async getForPerson(personId) {
    const { rows } = await (this._pool || pool).query(`
      SELECT p.*, creator.name as created_by_name, assignee.name as assigned_to_name
      FROM punch_items p
      LEFT JOIN people creator ON creator.id = p.created_by
      LEFT JOIN people assignee ON assignee.id = p.assigned_to
      WHERE p.created_by = $1 OR p.assigned_to = $1
      ORDER BY CASE p.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'ready_recheck' THEN 2 WHEN 'closed' THEN 3 END,
      CASE p.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END,
      p.created_at DESC
    `, [personId]);
    return rows;
  },

  async update(id, data) {
    const sets = [];
    const vals = [];
    let paramIdx = 1;
    if (data.status !== undefined) { sets.push(`status = $${paramIdx++}`); vals.push(data.status); }
    if (data.title !== undefined) { sets.push(`title = $${paramIdx++}`); vals.push(data.title); }
    if (data.description !== undefined) { sets.push(`description = $${paramIdx++}`); vals.push(data.description); }
    if (data.assigned_to !== undefined) { sets.push(`assigned_to = $${paramIdx++}`); vals.push(data.assigned_to); }
    if (data.priority !== undefined) { sets.push(`priority = $${paramIdx++}`); vals.push(data.priority); }
    if (data.closed_by !== undefined) { sets.push(`closed_by = $${paramIdx++}`); vals.push(data.closed_by); }
    if (data.closed_at !== undefined) { sets.push(`closed_at = $${paramIdx++}`); vals.push(data.closed_at); }
    if (data.closed_notes !== undefined) { sets.push(`closed_notes = $${paramIdx++}`); vals.push(data.closed_notes); }
    if (data.photo !== undefined) { sets.push(`photo = $${paramIdx++}`); vals.push(data.photo); }
    sets.push(`updated_at = NOW()`);
    if (sets.length === 1) return { success: false }; // only updated_at, no real changes
    vals.push(id);
    await (this._pool || pool).query(`UPDATE punch_items SET ${sets.join(', ')} WHERE id = $${paramIdx}`, vals);
    return { success: true };
  },

  async delete(id) {
    await (this._pool || pool).query('DELETE FROM punch_items WHERE id = $1', [id]);
    return { success: true };
  },

  async getStats(filters = {}) {
    let where = '1=1';
    const params = [];
    let paramIdx = 1;
    if (filters.trade) { where += ` AND trade = $${paramIdx++}`; params.push(filters.trade); }
    if (filters.created_by) { where += ` AND created_by = $${paramIdx++}`; params.push(filters.created_by); }
    if (filters.company_id) { where += ` AND company_id = $${paramIdx++}`; params.push(filters.company_id); }
    const { rows: stats } = await (this._pool || pool).query(`
      SELECT status, COUNT(*) as count FROM punch_items WHERE ${where} GROUP BY status
    `, params);
    return { open: 0, in_progress: 0, ready_recheck: 0, closed: 0, ...Object.fromEntries(stats.map(s => [s.status, parseInt(s.count, 10)])) };
  },
};

// ============================================
// SESSIONS
// ============================================
const sessions = {
  async create({ person_id, is_admin, role_level, trade, company_id, sparks_role, user_agent, ip_address }) {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
    await (this._pool || pool).query(`
      INSERT INTO app_sessions (id, person_id, is_admin, role_level, trade, company_id, sparks_role, expires_at, user_agent, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [id, person_id, is_admin ? 1 : 0, role_level || 1, trade || null, company_id || null, sparks_role || null, expires_at, user_agent || null, ip_address || null]);
    return { id, person_id, is_admin: !!is_admin, role_level: role_level || 1, trade, company_id, sparks_role, expires_at };
  },

  async getById(sessionId) {
    if (!sessionId) return null;
    const { rows } = await (this._pool || pool).query(`
      SELECT * FROM app_sessions WHERE id = $1 AND expires_at > NOW()
    `, [sessionId]);
    if (!rows[0]) return null;
    return {
      sessionId: rows[0].id,
      person_id: rows[0].person_id,
      is_admin: rows[0].is_admin === 1,
      role_level: rows[0].role_level,
      trade: rows[0].trade,
      company_id: rows[0].company_id,
      sparks_role: rows[0].sparks_role,
      issued_at: rows[0].issued_at,
      last_seen_at: rows[0].last_seen_at,
      expires_at: rows[0].expires_at,
    };
  },

  async touch(sessionId) {
    await (this._pool || pool).query(`UPDATE app_sessions SET last_seen_at = NOW() WHERE id = $1`, [sessionId]);
  },

  async delete(sessionId) {
    await (this._pool || pool).query(`DELETE FROM app_sessions WHERE id = $1`, [sessionId]);
  },

  async deleteExpired() {
    const { rowCount } = await (this._pool || pool).query(`DELETE FROM app_sessions WHERE expires_at < NOW()`);
    return rowCount;
  },

  async deleteForPerson(personId) {
    await (this._pool || pool).query(`DELETE FROM app_sessions WHERE person_id = $1`, [personId]);
  },
};

// ============================================
// WEBAUTHN CREDENTIALS
// ============================================
const webauthnCredentials = {
  async create({ person_id, credential_id, public_key, counter, transports, device_type, backed_up }) {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    await (this._pool || pool).query(`
      INSERT INTO webauthn_credentials (id, person_id, credential_id, public_key, counter, transports, device_type, backed_up)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [id, person_id, credential_id, public_key, counter || 0, transports || null, device_type || null, backed_up ? 1 : 0]);
    return { id, person_id, credential_id };
  },

  async getByCredentialId(credentialId) {
    const { rows } = await (this._pool || pool).query(`SELECT * FROM webauthn_credentials WHERE credential_id = $1`, [credentialId]);
    return rows[0] || null;
  },

  async getForPerson(personId) {
    const { rows } = await (this._pool || pool).query(`SELECT * FROM webauthn_credentials WHERE person_id = $1 ORDER BY created_at DESC`, [personId]);
    return rows;
  },

  async updateCounter(credentialId, newCounter) {
    await (this._pool || pool).query(`UPDATE webauthn_credentials SET counter = $1, last_used_at = NOW() WHERE credential_id = $2`, [newCounter, credentialId]);
  },

  async delete(credentialId) {
    await (this._pool || pool).query(`DELETE FROM webauthn_credentials WHERE credential_id = $1`, [credentialId]);
  },
};



// ============================================
// PLANS
// ============================================
const plans = {
  async getAll() {
    const { rows } = await (this._pool || pool).query("SELECT * FROM plans WHERE status = 'active' ORDER BY price_cents ASC");
    return rows;
  },

  async getById(id) {
    const { rows } = await (this._pool || pool).query('SELECT * FROM plans WHERE id = $1', [id]);
    return rows[0] || null;
  },
};

// ============================================
// SUBSCRIPTIONS
// ============================================
const subscriptions = {
  async getByCompanyId(companyId) {
    const { rows } = await (this._pool || pool).query(
      "SELECT cs.*, p.name as plan_name, p.price_cents, p.max_trades, p.max_people, p.max_projects, p.includes_ai, p.includes_forms, p.includes_relation_data FROM company_subscriptions cs JOIN plans p ON cs.plan_id = p.id WHERE cs.company_id = $1 AND cs.status != 'cancelled' ORDER BY cs.created_at DESC LIMIT 1",
      [companyId]
    );
    return rows[0] || null;
  },

  async create(data) {
    const { v4: uuidv4 } = require('uuid');
    const id = data.id || uuidv4();
    await (this._pool || pool).query(
      `INSERT INTO company_subscriptions (id, company_id, plan_id, status, started_at, current_period_start, current_period_end, next_billing_date, stripe_subscription_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, data.company_id, data.plan_id, data.status || 'active', data.started_at || new Date(), data.current_period_start || new Date(), data.current_period_end, data.next_billing_date, data.stripe_subscription_id || null]
    );
    return { id, ...data };
  },

  async update(id, data) {
    const updates = [];
    const values = [];
    let idx = 1;
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined && key !== 'id') {
        updates.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }
    updates.push('updated_at = NOW()');
    values.push(id);
    await (this._pool || pool).query(`UPDATE company_subscriptions SET ${updates.join(', ')} WHERE id = $${idx}`, values);
  },

  async cancel(id) {
    await (this._pool || pool).query(
      "UPDATE company_subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id]
    );
  },
};

// ============================================
// INVOICES
// ============================================
const invoicesMod = {
  async getByCompanyId(companyId) {
    const { rows } = await (this._pool || pool).query(
      'SELECT * FROM invoices WHERE company_id = $1 ORDER BY due_date DESC',
      [companyId]
    );
    return rows;
  },

  async create(data) {
    const { v4: uuidv4 } = require('uuid');
    const id = data.id || uuidv4();
    await (this._pool || pool).query(
      `INSERT INTO invoices (id, company_id, subscription_id, amount_cents, status, description, due_date, stripe_invoice_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, data.company_id, data.subscription_id, data.amount_cents, data.status || 'pending', data.description, data.due_date, data.stripe_invoice_id || null]
    );
    return { id, ...data };
  },

  async markPaid(id) {
    await (this._pool || pool).query(
      "UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE id = $1",
      [id]
    );
  },
};


// ============================================
// POOL INJECTION — Database-per-company support
// ============================================
// ============================================
// SHARED FOLDERS
// ============================================
const sharedFolders = {
  async getForPerson(personId) {
    const { rows } = await (this._pool || pool).query(`
      SELECT f.*, fm.role as my_role,
        (SELECT COUNT(*) FROM shared_files sf WHERE sf.folder_id = f.id) as file_count,
        (SELECT COUNT(*) FROM shared_folder_members sfm WHERE sfm.folder_id = f.id) as member_count
      FROM shared_folders f
      JOIN shared_folder_members fm ON fm.folder_id = f.id AND fm.person_id = $1
      ORDER BY f.updated_at DESC
    `, [personId]);
    return rows;
  },

  async getById(folderId) {
    const { rows } = await (this._pool || pool).query('SELECT * FROM shared_folders WHERE id = $1', [folderId]);
    return rows[0] || null;
  },

  async create(data) {
    const id = 'folder_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    await (this._pool || pool).query(
      'INSERT INTO shared_folders (id, name, created_by, context_type, context_id, description) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, data.name, data.created_by, data.context_type || 'team', data.context_id || null, data.description || null]
    );
    // Add creator as owner
    await (this._pool || pool).query(
      'INSERT INTO shared_folder_members (folder_id, person_id, role) VALUES ($1,$2,$3)',
      [id, data.created_by, 'owner']
    );
    return { id, ...data };
  },

  async addMember(folderId, personId, role) {
    await (this._pool || pool).query(
      'INSERT INTO shared_folder_members (folder_id, person_id, role) VALUES ($1,$2,$3) ON CONFLICT (folder_id, person_id) DO UPDATE SET role = $3',
      [folderId, personId, role || 'viewer']
    );
  },

  async removeMember(folderId, personId) {
    await (this._pool || pool).query('DELETE FROM shared_folder_members WHERE folder_id = $1 AND person_id = $2', [folderId, personId]);
  },

  async getMembers(folderId) {
    const { rows } = await (this._pool || pool).query(`
      SELECT p.id, p.name, p.role_title, p.photo, fm.role
      FROM shared_folder_members fm JOIN people p ON p.id = fm.person_id
      WHERE fm.folder_id = $1 ORDER BY fm.role, p.name
    `, [folderId]);
    return rows;
  },

  async getFiles(folderId) {
    const { rows } = await (this._pool || pool).query(`
      SELECT sf.*, p.name as uploaded_by_name
      FROM shared_files sf LEFT JOIN people p ON p.id = sf.uploaded_by
      WHERE sf.folder_id = $1 ORDER BY sf.created_at DESC
    `, [folderId]);
    return rows;
  },

  async addFile(data) {
    const id = 'sfile_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    await (this._pool || pool).query(
      'INSERT INTO shared_files (id, folder_id, type, name, description, filename, original_name, mime_type, size_bytes, url, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, data.folder_id, data.type || 'file', data.name, data.description || null, data.filename || null, data.original_name || null, data.mime_type || null, data.size_bytes || null, data.url || null, data.uploaded_by]
    );
    // Touch folder updated_at
    await (this._pool || pool).query('UPDATE shared_folders SET updated_at = NOW() WHERE id = $1', [data.folder_id]);
    return { id, ...data };
  },

  async removeFile(fileId) {
    await (this._pool || pool).query('DELETE FROM shared_files WHERE id = $1', [fileId]);
  },

  async deleteFolder(folderId) {
    await (this._pool || pool).query('DELETE FROM shared_folders WHERE id = $1', [folderId]);
  },

  async isMember(folderId, personId) {
    const { rows } = await (this._pool || pool).query('SELECT 1 FROM shared_folder_members WHERE folder_id = $1 AND person_id = $2', [folderId, personId]);
    return rows.length > 0;
  },
};

/**
 * Create a DB interface bound to a specific pool (company database).
 * All namespace methods use this._pool when rebound.
 * Templates, sessions, plans, subscriptions, invoices always use shared pool.
 *
 * Usage:
 *   const companyDb = DB.withPool(companyPool);
 *   const people = await companyDb.people.getAll();
 *   // → queries the company's database, not the shared one
 */
function withPool(targetPool) {
  function bindNamespace(ns) {
    const bound = Object.create(ns);
    bound._pool = targetPool;
    return bound;
  }
  return {
    db: targetPool,                              // Raw pool for direct queries
    templates: bindNamespace(templates),          // Templates rebound — copied to each company DB so queries work on either pool
    people: bindNamespace(people),
    reports: bindNamespace(reports),
    messages: bindNamespace(messages),
    contacts: bindNamespace(contacts),
    legacyMessages: legacyMessages,              // File-based, no pool
    aiConversations: bindNamespace(aiConversations),
    ppeRequests: bindNamespace(ppeRequests),
    safetyObservations: bindNamespace(safetyObservations),
    dailyPlans: bindNamespace(dailyPlans),
    taskDays: bindNamespace(taskDays),
    punchList: bindNamespace(punchList),
    sessions: sessions,                          // ALWAYS shared — login is cross-company
    webauthnCredentials: bindNamespace(webauthnCredentials),
    plans: plans,                                // ALWAYS shared — billing is platform-level
    subscriptions: subscriptions,                // ALWAYS shared
    invoices: invoicesMod,                       // ALWAYS shared
    sharedFolders: bindNamespace(sharedFolders),
    withPool: withPool,                          // Allow chaining
  };
}

module.exports = { db, templates, people, reports, messages, contacts, legacyMessages, aiConversations, ppeRequests, safetyObservations, dailyPlans, taskDays, punchList, sessions, webauthnCredentials, plans, subscriptions, invoices: invoicesMod, sharedFolders, withPool };
