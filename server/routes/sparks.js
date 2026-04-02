/**
 * Sparks Command Center API Routes
 * All routes require Sparks role. Data is filtered by company_id.
 */
const { Router } = require('express');
const crypto = require('crypto');
const DB = require('../../database/db');
const { requireAuth, requireSparksRole } = require('../middleware/sessionAuth');

const router = Router();

// All Sparks routes require authentication + Sparks role (at minimum advisor)
router.use(requireAuth);

// ============================================
// COMPANIES
// ============================================

// GET /api/sparks/companies — List all companies
router.get('/companies', requireSparksRole('support'), async (req, res) => {
  try {
    const { rows } = await DB.db.query(`
      SELECT c.*,
        (SELECT count(*)::int FROM people p WHERE p.company_id = c.id AND p.status = 'active') as people_count,
        (SELECT count(*)::int FROM reports r WHERE r.company_id = c.id) as report_count,
        (SELECT array_agg(cp.product) FROM company_products cp WHERE cp.company_id = c.id AND cp.status = 'active') as products,
        (SELECT array_agg(ct.trade) FROM company_trades ct WHERE ct.company_id = c.id AND ct.status = 'active') as trades
      FROM companies c
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Sparks companies error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sparks/companies — Create new company (admin only)
router.post('/companies', requireSparksRole('admin'), async (req, res) => {
  try {
    const { name, slug, tier, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Company name required' });

    const id = 'company_' + (slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
    const companySlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    await DB.db.query(`
      INSERT INTO companies (id, name, slug, status, tier, notes, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, 'active', $4, $5, $6, NOW(), NOW())
    `, [id, name, companySlug, tier || 'small', notes || null, req.auth.person_id]);

    // Log the action
    await DB.db.query(`
      INSERT INTO sparks_audit_log (id, person_id, action, resource_type, resource_id, details, created_at)
      VALUES ($1, $2, 'created_company', 'company', $3, $4, NOW())
    `, [crypto.randomUUID(), req.auth.person_id, id, JSON.stringify({ name, tier })]);

    const { rows } = await DB.db.query('SELECT * FROM companies WHERE id = $1', [id]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Company with that slug already exists' });
    console.error('Create company error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/sparks/companies/:id — Company detail
router.get('/companies/:id', requireSparksRole('support'), async (req, res) => {
  try {
    const { rows: companies } = await DB.db.query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
    if (!companies[0]) return res.status(404).json({ error: 'Company not found' });

    const company = companies[0];

    // Get products
    const { rows: products } = await DB.db.query(
      'SELECT * FROM company_products WHERE company_id = $1 ORDER BY product', [company.id]
    );

    // Get trades
    const { rows: trades } = await DB.db.query(
      'SELECT * FROM company_trades WHERE company_id = $1 ORDER BY trade', [company.id]
    );

    // Get people count by trade
    const { rows: peopleCounts } = await DB.db.query(`
      SELECT p.trade, count(*)::int as count
      FROM people p WHERE p.company_id = $1 AND p.status = 'active'
      GROUP BY p.trade ORDER BY p.trade
    `, [company.id]);

    // Get report count
    const { rows: reportCount } = await DB.db.query(
      'SELECT count(*)::int as count FROM reports WHERE company_id = $1', [company.id]
    );

    // Get recent activity (last 10 reports)
    const { rows: recentReports } = await DB.db.query(`
      SELECT r.id, r.created_at::date as report_date, r.created_at, p.name as person_name, p.trade
      FROM reports r JOIN people p ON r.person_id = p.id
      WHERE r.company_id = $1
      ORDER BY r.created_at DESC LIMIT 10
    `, [company.id]);

    res.json({
      ...company,
      products,
      trades,
      people_by_trade: peopleCounts,
      total_reports: reportCount[0].count,
      recent_reports: recentReports,
    });
  } catch (err) {
    console.error('Company detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/sparks/companies/:id — Update company (admin only)
router.put('/companies/:id', requireSparksRole('admin'), async (req, res) => {
  try {
    const { name, status, tier, notes } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (name) { updates.push(`name = $${idx++}`); values.push(name); }
    if (status) { updates.push(`status = $${idx++}`); values.push(status); }
    if (tier) { updates.push(`tier = $${idx++}`); values.push(tier); }
    if (notes !== undefined) { updates.push(`notes = $${idx++}`); values.push(notes); }
    updates.push(`updated_at = NOW()`);

    if (updates.length <= 1) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    await DB.db.query(`UPDATE companies SET ${updates.join(', ')} WHERE id = $${idx}`, values);

    // Audit
    await DB.db.query(`
      INSERT INTO sparks_audit_log (id, person_id, action, resource_type, resource_id, details, created_at)
      VALUES ($1, $2, 'updated_company', 'company', $3, $4, NOW())
    `, [crypto.randomUUID(), req.auth.person_id, req.params.id, JSON.stringify(req.body)]);

    const { rows } = await DB.db.query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    console.error('Update company error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// COMPANY PRODUCTS
// ============================================

// POST /api/sparks/companies/:id/products — Add product license (admin only)
router.post('/companies/:id/products', requireSparksRole('admin'), async (req, res) => {
  try {
    const { product } = req.body;
    if (!product) return res.status(400).json({ error: 'Product required (voice_report or relation_data)' });

    await DB.db.query(`
      INSERT INTO company_products (id, company_id, product, status, licensed_by)
      VALUES ($1, $2, $3, 'active', $4)
      ON CONFLICT (company_id, product) DO UPDATE SET status = 'active', licensed_at = NOW()
    `, [crypto.randomUUID(), req.params.id, product, req.auth.person_id]);

    // Audit
    await DB.db.query(`
      INSERT INTO sparks_audit_log (id, person_id, action, resource_type, resource_id, details, created_at)
      VALUES ($1, $2, 'licensed_product', 'company', $3, $4, NOW())
    `, [crypto.randomUUID(), req.auth.person_id, req.params.id, JSON.stringify({ product })]);

    res.json({ success: true, product, status: 'active' });
  } catch (err) {
    console.error('Add product error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/sparks/companies/:id/products/:product — Suspend product (admin only)
router.delete('/companies/:id/products/:product', requireSparksRole('admin'), async (req, res) => {
  try {
    await DB.db.query(`
      UPDATE company_products SET status = 'suspended'
      WHERE company_id = $1 AND product = $2
    `, [req.params.id, req.params.product]);

    // Audit
    await DB.db.query(`
      INSERT INTO sparks_audit_log (id, person_id, action, resource_type, resource_id, details, created_at)
      VALUES ($1, $2, 'suspended_product', 'company', $3, $4, NOW())
    `, [crypto.randomUUID(), req.auth.person_id, req.params.id, JSON.stringify({ product: req.params.product })]);

    res.json({ success: true, product: req.params.product, status: 'suspended' });
  } catch (err) {
    console.error('Suspend product error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// COMPANY TRADES
// ============================================

// POST /api/sparks/companies/:id/trades — Add trade license (admin only)
router.post('/companies/:id/trades', requireSparksRole('admin'), async (req, res) => {
  try {
    const { trade } = req.body;
    if (!trade) return res.status(400).json({ error: 'Trade name required' });

    await DB.db.query(`
      INSERT INTO company_trades (id, company_id, trade, status, licensed_by)
      VALUES ($1, $2, $3, 'active', $4)
      ON CONFLICT (company_id, trade) DO UPDATE SET status = 'active', licensed_at = NOW()
    `, [crypto.randomUUID(), req.params.id, trade, req.auth.person_id]);

    // Audit
    await DB.db.query(`
      INSERT INTO sparks_audit_log (id, person_id, action, resource_type, resource_id, details, created_at)
      VALUES ($1, $2, 'licensed_trade', 'company', $3, $4, NOW())
    `, [crypto.randomUUID(), req.auth.person_id, req.params.id, JSON.stringify({ trade })]);

    res.json({ success: true, trade, status: 'active' });
  } catch (err) {
    console.error('Add trade error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/sparks/companies/:id/trades/:trade — Suspend trade (admin only)
router.delete('/companies/:id/trades/:trade', requireSparksRole('admin'), async (req, res) => {
  try {
    await DB.db.query(`
      UPDATE company_trades SET status = 'suspended'
      WHERE company_id = $1 AND trade = $2
    `, [req.params.id, req.params.trade]);

    // Audit
    await DB.db.query(`
      INSERT INTO sparks_audit_log (id, person_id, action, resource_type, resource_id, details, created_at)
      VALUES ($1, $2, 'suspended_trade', 'company', $3, $4, NOW())
    `, [crypto.randomUUID(), req.auth.person_id, req.params.id, JSON.stringify({ trade: req.params.trade })]);

    res.json({ success: true, trade: req.params.trade, status: 'suspended' });
  } catch (err) {
    console.error('Suspend trade error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// TEAM
// ============================================

// GET /api/sparks/team — List Sparks team members
router.get('/team', requireSparksRole('advisor'), async (req, res) => {
  try {
    const { rows } = await DB.db.query(`
      SELECT id, name, role_title, role_level, trade, sparks_role, photo, status
      FROM people
      WHERE sparks_role IS NOT NULL
      ORDER BY
        CASE sparks_role WHEN 'admin' THEN 1 WHEN 'support' THEN 2 WHEN 'collaborator' THEN 3 WHEN 'advisor' THEN 4 END,
        name
    `);
    res.json(rows);
  } catch (err) {
    console.error('Team list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/sparks/team/:id/role — Update team member's Sparks role (admin only)
router.put('/team/:id/role', requireSparksRole('admin'), async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['admin', 'support', 'collaborator', 'advisor', null];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    await DB.db.query('UPDATE people SET sparks_role = $1 WHERE id = $2', [role, req.params.id]);

    // Audit
    await DB.db.query(`
      INSERT INTO sparks_audit_log (id, person_id, action, resource_type, resource_id, details, created_at)
      VALUES ($1, $2, 'changed_sparks_role', 'person', $3, $4, NOW())
    `, [crypto.randomUUID(), req.auth.person_id, req.params.id, JSON.stringify({ new_role: role })]);

    res.json({ success: true, person_id: req.params.id, sparks_role: role });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// DASHBOARD
// ============================================

// GET /api/sparks/dashboard — Today's metrics
router.get('/dashboard', requireSparksRole('support'), async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [companies, todayReports, totalPeople, totalReports, recentErrors, activeProjects, onlineUsers, aiTokens] = await Promise.all([
      DB.db.query("SELECT count(*)::int as count, count(*) FILTER (WHERE status = 'active')::int as active FROM companies"),
      DB.db.query("SELECT count(*)::int as count FROM reports WHERE created_at::date = $1", [today]),
      DB.db.query("SELECT count(*)::int as count FROM people WHERE status = 'active'"),
      DB.db.query("SELECT count(*)::int as count FROM reports"),
      DB.db.query("SELECT count(*)::int as count FROM sparks_audit_log WHERE action LIKE '%error%' AND created_at > NOW() - INTERVAL '24 hours'"),
      DB.db.query("SELECT count(*)::int as count FROM projects WHERE status = 'active'").catch(() => ({ rows: [{ count: 0 }] })),
      DB.db.query("SELECT count(*)::int as count FROM app_sessions WHERE last_active > NOW() - INTERVAL '24 hours'").catch(() => ({ rows: [{ count: 0 }] })),
      DB.db.query("SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::bigint as total FROM analytics_ai_costs").catch(() => ({ rows: [{ total: 0 }] })),
    ]);

    // Per-company breakdown
    const { rows: companyStats } = await DB.db.query(`
      SELECT c.id, c.name, c.status,
        (SELECT count(*)::int FROM people p WHERE p.company_id = c.id AND p.status = 'active') as people,
        (SELECT count(*)::int FROM reports r WHERE r.company_id = c.id AND r.created_at::date = $1) as today_reports,
        (SELECT count(*)::int FROM reports r WHERE r.company_id = c.id) as total_reports
      FROM companies c
      ORDER BY c.name
    `, [today]);

    const uptimeSeconds = process.uptime();
    const uptimeDays = Math.floor(uptimeSeconds / 86400);
    const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
    const uptimeStr = uptimeDays > 0 ? uptimeDays + 'd ' + uptimeHours + 'h' : uptimeHours + 'h ' + Math.floor((uptimeSeconds % 3600) / 60) + 'm';

    res.json({
      total_companies: companies.rows[0].count,
      active_companies: companies.rows[0].active,
      today_reports: todayReports.rows[0].count,
      total_people: totalPeople.rows[0].count,
      total_reports: totalReports.rows[0].count,
      recent_errors: recentErrors.rows[0].count,
      active_projects: activeProjects.rows[0].count,
      online_users: onlineUsers.rows[0].count,
      ai_tokens: parseInt(aiTokens.rows[0].total) || 0,
      uptime: uptimeStr,
      companies: companyStats,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// AUDIT LOG
// ============================================

// GET /api/sparks/audit — View audit trail (admin only)
router.get('/audit', requireSparksRole('admin'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const { rows } = await DB.db.query(`
      SELECT a.*, p.name as person_name
      FROM sparks_audit_log a
      LEFT JOIN people p ON a.person_id = p.id
      ORDER BY a.created_at DESC
      LIMIT $1
    `, [limit]);
    res.json(rows);
  } catch (err) {
    console.error('Audit log error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});



// ============================================
// EDIT MODE — PIN-protected editing for simulation
// ============================================

// Enable edit mode — requires operator's PIN
router.post('/edit-mode/enable', requireAuth, requireSparksRole('support'), async (req, res) => {
  try {
    if (!req.auth.sparks_role) return res.status(403).json({ error: 'Not a Sparks operator' });
    const { pin, company_id } = req.body;
    if (!pin || !company_id) return res.status(400).json({ error: 'PIN and company_id required' });

    // Validate company exists
    const company = (await DB.db.query("SELECT id, name FROM companies WHERE id = $1", [company_id])).rows[0];
    if (!company) return res.status(400).json({ error: "Company not found" });

    // Verify PIN against operator's record
    const person = await DB.people.getByPin(pin);
    if (!person || person.id !== req.auth.person_id) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    // Enable edit mode
    const { enableEditMode } = require('../middleware/sessionAuth');
    enableEditMode(req.auth.sessionId, company_id);

    // Audit log
    await DB.db.query(
      "INSERT INTO sparks_audit_log (id, person_id, person_name, action, resource_type, resource_id, details, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())",
      ['audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
       req.auth.person_id, person.name, 'enabled_edit_mode', 'company', company_id,
       JSON.stringify({ company_id })]
    );

    res.json({ enabled: true, expiresInSeconds: 900 });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Disable edit mode
router.post('/edit-mode/disable', requireAuth, requireSparksRole('support'), async (req, res) => {
  try {
    const { disableEditMode } = require('../middleware/sessionAuth');
    disableEditMode(req.auth.sessionId);

    // Audit log
    await DB.db.query(
      "INSERT INTO sparks_audit_log (id, person_id, person_name, action, resource_type, resource_id, details, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())",
      ['audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
       req.auth.person_id, '', 'disabled_edit_mode', '', '', '{}']
    );

    res.json({ enabled: false });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check edit mode status
router.get('/edit-mode/status', requireAuth, requireSparksRole('advisor'), async (req, res) => {
  const { isEditModeActive, getEditModeRemaining } = require('../middleware/sessionAuth');
  res.json({
    enabled: isEditModeActive(req.auth.sessionId),
    remainingSeconds: getEditModeRemaining(req.auth.sessionId),
  });
});

// ============================================
// SYSTEM HEALTH (Observability)
// ============================================

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://prometheus:9090';

// GET /api/sparks/system-health — Query Prometheus for at-a-glance system stats
router.get('/system-health', requireSparksRole('support'), async (req, res) => {
  try {
    const queries = {
      request_rate: 'sum(rate(horizon_http_requests_total[5m]))',
      error_rate: 'sum(rate(horizon_http_requests_total{status_code=~"5.."}[5m])) / sum(rate(horizon_http_requests_total[5m])) or vector(0)',
      p95_latency: 'histogram_quantile(0.95, sum(rate(horizon_http_request_duration_seconds_bucket[5m])) by (le)) or vector(0)',
      ai_cost_today: 'sum(increase(horizon_anthropic_cost_usd_total[24h])) or vector(0)',
      agent_sessions_today: 'sum(increase(horizon_agent_sessions_total[24h])) or vector(0)',
      cpu_percent: '1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))',
      memory_percent: '1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)',
      disk_percent: '1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})',
      targets_up: 'count(up == 1)',
      targets_total: 'count(up)',
      db_pool_total: 'horizon_db_pool_size{state="total"}',
      db_pool_idle: 'horizon_db_pool_size{state="idle"}',
      db_pool_waiting: 'horizon_db_pool_size{state="waiting"}',
      pg_db_size: 'pg_database_size_bytes{datname="horizon"}',
    };

    const results = {};
    await Promise.all(
      Object.entries(queries).map(async ([key, query]) => {
        try {
          const r = await fetch(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`);
          if (r.ok) {
            const data = await r.json();
            const val = data?.data?.result?.[0]?.value?.[1];
            results[key] = val !== undefined ? parseFloat(val) : null;
          } else {
            results[key] = null;
          }
        } catch {
          results[key] = null;
        }
      })
    );

    // Get target details
    let targets = [];
    try {
      const r = await fetch(`${PROMETHEUS_URL}/api/v1/targets`);
      if (r.ok) {
        const data = await r.json();
        targets = (data?.data?.activeTargets || []).map(t => ({
          job: t.labels?.job,
          health: t.health,
          lastScrape: t.lastScrape,
          product: t.labels?.product || t.labels?.service || t.labels?.instance || '',
        }));
      }
    } catch {}

    res.json({
      metrics: results,
      targets,
      grafana_url: 'http://192.168.1.117:3000',
      glitchtip_url: 'http://192.168.1.117:9500',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('System health error:', err);
    res.status(500).json({ error: 'Failed to fetch system health' });
  }
});

module.exports = router;
