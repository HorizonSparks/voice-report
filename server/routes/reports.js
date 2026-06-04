const { Router } = require('express');
const JSZip = require('jszip');
const DB = require('../../database/db');
const {requireAuth, requireSparksEditMode} = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');
const { renderReportHtml, renderReportMarkdown, reportFilenameBase, escapeHtml } = require('../services/reportExport');

const router = Router();

// Can the actor see this report? (same wall as GET /:id: company + owner/admin/see-down chain)
async function canSeeReport(req, r) {
  const actor = getActor(req);
  if (req.companyId && r.company_id && r.company_id !== req.companyId) return false;
  if (r.person_id === actor.person_id || actor.is_admin) return true;
  const { rows } = await (req.db || DB).db.query(
    'SELECT 1 FROM report_visibility WHERE viewer_id = $1 AND person_id = $2 LIMIT 1',
    [actor.person_id, r.person_id]
  );
  return rows.length > 0;
}

router.post('/', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const report = req.body;
    if (!report.id) return res.status(400).json({ error: 'Report must have an id' });
    // ALWAYS derive person_id + tenant from session — caller cannot create on behalf of others
    // nor stamp a foreign company. report.company_id from the body is IGNORED; when null,
    // reports.create + indexReport both derive it from the owning person (server truth).
    const actor = getActor(req);
    report.person_id = actor.person_id;
    report.company_id = req.companyId || null;
    await (req.db || DB).reports.create(report);
    // Phase 3: index into per-tenant semantic memory. Fire-and-forget — embedding latency or
    // an OpenAI hiccup must NEVER block or fail the report save.
    try {
      const reportMemory = require('../services/reportMemory');
      reportMemory.indexReport(req.db || DB, { ...report, company_id: req.companyId || null })
        .catch((e) => console.warn('[reportMemory] index failed:', e.message));
    } catch (e) { /* memory indexing is best-effort */ }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const filters = {};
    if (req.query.person_id) filters.person_id = req.query.person_id;
    if (req.query.trade) filters.trade = req.query.trade;
    // Company isolation — always filter by company
    if (req.companyId) filters.company_id = req.companyId;
    // DERIVE viewer_id from session — never trust client
    // Admin bypasses visibility filter to see all reports
    if (!actor.is_admin) {
      filters.viewer_id = actor.person_id;
    }
    const reports = (await (req.db || DB).reports.getAll(filters)).map(r => ({
      id: r.id, person_id: r.person_id, person_name: r.person_name, role_title: r.role_title,
      created_at: r.created_at, duration_seconds: r.duration_seconds, transcript_raw: r.transcript_raw,
      preview: r.transcript_raw ? r.transcript_raw.substring(0, 100) : '', status: r.status,
    }));
    res.json(reports);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /:id/export?format=html|md|json — export ONE report "to office" (download).
// Respects the SAME visibility wall as GET /:id.
router.get('/:id/export', requireAuth, async (req, res) => {
  try {
    const r = await (req.db || DB).reports.getById(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    // Mirror GET /:id exactly: cross-company => 404 (no existence oracle); no-visibility => 403.
    if (req.companyId && r.company_id && r.company_id !== req.companyId) {
      return res.status(404).json({ error: 'Report not found' });
    }
    if (!(await canSeeReport(req, r))) return res.status(403).json({ error: 'Not authorized' });
    const base = reportFilenameBase(r);
    const fmt = String(req.query.format || 'html').toLowerCase();
    if (fmt === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="${base}.json"`);
      return res.json(r);
    }
    if (fmt === 'md' || fmt === 'markdown') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.md"`);
      return res.send(renderReportMarkdown(r));
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.html"`);
    return res.send(renderReportHtml(r));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /export/bundle?person_id=&project_id=&trade=&from=&to= — zip bundle of reports the
// actor can see (each as a human HTML page + machine JSON, plus an index). The scoped set
// comes from reports.getAll with viewer_id (the see-down wall) + company — never wider.
router.get('/export/bundle', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const MAX = 200;
    const filters = { limit: MAX + 1 }; // bound the DB read; +1 detects truncation
    if (req.companyId) filters.company_id = req.companyId;
    if (!actor.is_admin) filters.viewer_id = actor.person_id; // the wall
    if (req.query.person_id) filters.person_id = req.query.person_id;
    if (req.query.trade) filters.trade = req.query.trade;
    if (req.query.project_id) filters.project_id = req.query.project_id;
    if (req.query.from) filters.from = req.query.from;
    if (req.query.to) filters.to = req.query.to;
    const scoped = await (req.db || DB).reports.getAll(filters); // already scoped + bounded
    const truncated = scoped.length > MAX;
    const picked = scoped.slice(0, MAX);
    if (picked.length === 0) return res.status(404).json({ error: 'No reports match (or none visible to you).' });

    const zip = new JSZip();
    const index = [];
    for (const lite of picked) {
      const full = await (req.db || DB).reports.getById(lite.id);
      if (!full) continue;
      if (req.companyId && full.company_id && full.company_id !== req.companyId) continue; // defense in depth
      const base = reportFilenameBase(full);
      zip.file(`${base}.html`, renderReportHtml(full));
      zip.file(`${base}.json`, JSON.stringify(full, null, 2));
      index.push({ base, person: full.person_name || '', date: full.created_at });
    }
    const indexHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report bundle</title></head><body><h1>Report bundle (${index.length})</h1>${truncated ? `<p><b>Note:</b> capped at ${MAX} reports — narrow the filters for the rest.</p>` : ''}<ul>${index.map((i) => `<li><a href="./${escapeHtml(i.base)}.html">${escapeHtml(i.person || '')} — ${escapeHtml(String(i.date || ''))}</a></li>`).join('')}</ul></body></html>`;
    zip.file('index.html', indexHtml);

    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="voicereport_bundle.zip"');
    return res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /archive/tree — the report archive as a navigable folder tree (project -> person ->
// date -> reports), scoped to what the actor can see (reuses the see-down + company wall via
// reports.getAll viewer_id). Each folder node pairs with /export/bundle to download it.
router.get('/archive/tree', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const filters = { limit: 5000 }; // archive index — bounded
    if (req.companyId) filters.company_id = req.companyId;
    if (!actor.is_admin) filters.viewer_id = actor.person_id; // the wall
    if (req.query.project_id) filters.project_id = req.query.project_id;
    const rows = await (req.db || DB).reports.getSummaries(filters); // lean: no SELECT */JSON parse

    // null-proto maps so user-derived keys (project_id, person_id, date) can't pollute prototypes
    const tree = Object.create(null);
    for (const r of rows) {
      const proj = r.project_id || 'default';
      const pid = r.person_id || 'unknown'; // group by ID, not display name (avoids merging namesakes)
      let date = 'nodate';
      try { if (r.created_at) date = new Date(r.created_at).toISOString().slice(0, 10); } catch (e) {}
      if (!tree[proj]) tree[proj] = { project_id: proj, count: 0, people: Object.create(null) };
      const P = tree[proj];
      if (!P.people[pid]) P.people[pid] = { person_id: pid, person: r.person_name || 'Unknown', count: 0, dates: Object.create(null) };
      const PE = P.people[pid];
      if (!PE.dates[date]) PE.dates[date] = { date, reports: [] };
      P.count++; PE.count++;
      PE.dates[date].reports.push({
        id: r.id, person_id: r.person_id, status: r.status, created_at: r.created_at, preview: r.preview || '',
      });
    }
    const projects = Object.values(tree).map((p) => ({
      project_id: p.project_id, count: p.count,
      people: Object.values(p.people).map((pe) => ({
        person_id: pe.person_id, person: pe.person, count: pe.count,
        dates: Object.values(pe.dates).sort((a, b) => String(b.date).localeCompare(String(a.date))),
      })).sort((a, b) => b.count - a.count),
    })).sort((a, b) => b.count - a.count);
    res.json({ total: rows.length, projects });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/search/:query', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    // DERIVE viewer_id from session — admin sees all
    const viewerId = actor.is_admin ? null : actor.person_id;
    res.json(await (req.db || DB).reports.search(req.params.query, viewerId, req.companyId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const r = await (req.db || DB).reports.getById(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    // Company isolation — reject if report belongs to different company
    if (req.companyId && r.company_id && r.company_id !== req.companyId) {
      return res.status(404).json({ error: 'Report not found' });
    }
    // Visibility scope — owner, admin, or someone above the author in the see-down
    // chain (report_visibility), NOT a flat role_level proxy. Closes the sideways/up leak
    // where any foreman+ could read ANY report in the company.
    const actor = getActor(req);
    if (r.person_id !== actor.person_id && !actor.is_admin) {
      const { rows: vis } = await (req.db || DB).db.query(
        'SELECT 1 FROM report_visibility WHERE viewer_id = $1 AND person_id = $2 LIMIT 1',
        [actor.person_id, r.person_id]
      );
      if (vis.length === 0) return res.status(403).json({ error: 'Not authorized' });
    }
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Delete a report (owner or admin/supervisor can delete)
router.delete('/:id', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const actor = getActor(req);
    let delQuery = 'SELECT * FROM reports WHERE id = $1';
    const delParams = [req.params.id];
    if (req.companyId) { delParams.push(req.companyId); delQuery += ` AND company_id = $${delParams.length}`; }
    const report = (await (req.db || DB).db.query(delQuery, delParams)).rows[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });

    // Delete authority — owner, admin, or a supervisor above the author in the chain
    // (report_visibility), NOT a flat role_level proxy.
    if (report.person_id !== actor.person_id && !actor.is_admin) {
      const { rows: vis } = await (req.db || DB).db.query(
        'SELECT 1 FROM report_visibility WHERE viewer_id = $1 AND person_id = $2 LIMIT 1',
        [actor.person_id, report.person_id]
      );
      if (vis.length === 0) return res.status(403).json({ error: 'Not authorized' });
    }

    await (req.db || DB).db.query('DELETE FROM reports WHERE id = $1', [req.params.id]);
    // keep memory consistent — drop the report's chunks too (best-effort)
    try {
      const reportMemory = require('../services/reportMemory');
      await reportMemory.removeReport(req.db || DB, req.params.id);
    } catch (e) { /* best-effort */ }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
