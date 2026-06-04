// Role 6 = company CEO / top administrator (distinct from PM = role 5). This re-tags the
// company top from role_level 5 -> 6 so "see all company projects" (canCrossProject) can be the
// CEO without also granting it to PMs. role_title is the only available signal, so this is a
// JUDGMENT call — review the DRY-RUN list before committing.
//
//   Dry run (default): node database/retag-ceo-role6.js
//   Commit:            node database/retag-ceo-role6.js --commit
//
// Default match: role_title contains 'CEO' or 'Administrator'. Adjust TITLE_RE for your data.
const DB = require('./db');

const COMMIT = process.argv.includes('--commit');
const TITLE_RE = /\b(ceo|administrator)\b/i;

async function main() {
  const { rows } = await DB.db.query(
    "SELECT id, name, role_title, role_level, company_id FROM people WHERE role_level = 5 ORDER BY company_id, name"
  );
  const targets = rows.filter((r) => TITLE_RE.test(r.role_title || ''));
  console.log(`role-5 people: ${rows.length}; matching CEO/Administrator: ${targets.length}`);
  for (const t of targets) console.log(`  ${COMMIT ? 'RETAG' : 'would retag'} 5->6: ${t.name} (${t.role_title}) [company ${t.company_id}]`);
  const others = rows.filter((r) => !TITLE_RE.test(r.role_title || ''));
  console.log(`  (left at role 5 = PM/other: ${others.map((o) => o.role_title).join(', ') || 'none'})`);
  if (!COMMIT) { console.log('\nDRY-RUN — no changes. Re-run with --commit after reviewing.'); return; }
  let n = 0;
  for (const t of targets) {
    await DB.db.query('UPDATE people SET role_level = 6, updated_at = NOW() WHERE id = $1', [t.id]);
    n++;
  }
  // visibility chains don't change on a role bump alone, but project-access (canCrossProject) does;
  // a full visibility rebuild is harmless and keeps same-team/role gating consistent.
  try { await DB.people._rebuildAllVisibility(); } catch (e) { console.warn('visibility rebuild warn:', e.message); }
  console.log(`\nCOMMIT: re-tagged ${n} CEO/Administrator(s) to role 6.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
