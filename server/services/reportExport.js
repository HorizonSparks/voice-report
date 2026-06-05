/**
 * Report export rendering (P-export / Gap 1): turn a stored report into a human bundle
 * (printable HTML → "Save as PDF"), a markdown machine copy, or raw JSON. No heavy deps.
 * Access control is the CALLER's job — these are pure renderers.
 */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safe(s, n) {
  return String(s == null ? '' : s).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, n || 40);
}

function reportFilenameBase(r) {
  const who = safe(r.person_name || 'report', 40);
  let date = 'nodate';
  try { if (r.created_at) date = new Date(r.created_at).toISOString().slice(0, 10); } catch (e) {}
  const short = safe(r.id || '', 8) || 'report'; // sanitize: id is client-supplied on create
  return `report_${who}_${date}_${short}`;
}

function renderReportMarkdown(r) {
  const L = [];
  L.push(`# Field Report — ${r.person_name || ''}`, '');
  let when = '';
  try { when = r.created_at ? new Date(r.created_at).toISOString() : ''; } catch (e) {}
  L.push(`- Date: ${when}`);
  L.push(`- Role: ${r.role_title || ''}`);
  L.push(`- Trade: ${r.trade || ''}`);
  L.push(`- Status: ${r.status || ''}`);
  L.push(`- Report ID: ${r.id || ''}`, '');
  if (r.markdown_structured) L.push('## Structured report', '', r.markdown_structured, '');
  if (r.markdown_verbatim) L.push('## Verbatim', '', r.markdown_verbatim, '');
  if (r.transcript_raw) L.push('## Raw transcript', '', r.transcript_raw, '');
  return L.join('\n');
}

function renderReportHtml(r) {
  const photos = Array.isArray(r.photos) ? r.photos : [];
  const convo = Array.isArray(r.conversation_turns) ? r.conversation_turns : [];
  let when = '';
  try { when = r.created_at ? new Date(r.created_at).toLocaleString() : ''; } catch (e) {}
  const section = (title, body) => body
    ? `<h2>${escapeHtml(title)}</h2><div class="body">${escapeHtml(body)}</div>` : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Field Report — ${escapeHtml(r.person_name)}</title>
<style>
  @media print { .noprint { display:none } body { margin:0 } }
  body { font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; max-width:820px; margin:2rem auto; color:#1a1a1a; line-height:1.55; padding:0 1rem; }
  h1 { border-bottom:3px solid #e8731c; padding-bottom:.3rem; }
  h2 { color:#b85a12; margin-top:1.6rem; }
  .meta { background:#faf6f2; border:1px solid #eadfd5; border-radius:8px; padding:.8rem 1rem; font-size:.9rem; }
  .meta b { color:#555; }
  .body { white-space:pre-wrap; word-wrap:break-word; }
  .turn { margin:.4rem 0; padding:.4rem .6rem; border-radius:6px; white-space:pre-wrap; }
  .turn.user { background:#f0f4f8; }
  .turn.assistant { background:#f7f0e8; }
  .photos li { margin:.2rem 0; }
  footer { margin-top:2rem; font-size:.8rem; color:#888; border-top:1px solid #eee; padding-top:.5rem; }
  button { background:#e8731c; color:#fff; border:0; border-radius:6px; padding:.6rem 1rem; font-size:1rem; cursor:pointer; }
</style></head>
<body>
  <h1>Field Report — ${escapeHtml(r.person_name)}</h1>
  <div class="meta">
    <div><b>Date:</b> ${escapeHtml(when)}</div>
    <div><b>Role:</b> ${escapeHtml(r.role_title || '')} &nbsp; <b>Trade:</b> ${escapeHtml(r.trade || '')}</div>
    <div><b>Status:</b> ${escapeHtml(r.status || '')} &nbsp; <b>Duration:</b> ${escapeHtml(String(r.duration_seconds || 0))}s</div>
    <div><b>Report ID:</b> ${escapeHtml(r.id)}</div>
  </div>
  ${section('Structured Report', r.markdown_structured)}
  ${section('Verbatim', r.markdown_verbatim)}
  ${section('Raw Transcript', r.transcript_raw)}
  ${convo.length ? `<h2>Conversation</h2>${convo.map((t) => `<div class="turn ${escapeHtml(t.role || '')}"><b>${escapeHtml(t.role || '')}:</b> ${escapeHtml(t.content || t.text || '')}</div>`).join('')}` : ''}
  ${photos.length ? `<h2>Photos (${photos.length})</h2><ul class="photos">${photos.map((p) => `<li>${escapeHtml(typeof p === 'string' ? p : (p.filename || p.name || ''))}</li>`).join('')}</ul>` : ''}
  <footer>Horizon Sparks — Voice Report. Human copy; the machine copy (structured markdown) travels with it as JSON in a bundle export.</footer>
  <div class="noprint" style="margin-top:1rem"><button onclick="window.print()">Print / Save as PDF</button></div>
</body></html>`;
}

module.exports = { renderReportHtml, renderReportMarkdown, reportFilenameBase, escapeHtml };
