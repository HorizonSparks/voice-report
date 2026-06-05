#!/usr/bin/env node
/**
 * CEO Control Center proof — the per-company administrator window's WALL.
 *
 * Proves two things end-to-end against a REAL throwaway Postgres + the REAL db.js / ceoGuards.js:
 *   (A) sanitizePersonChange (the security core) — a CEO has absolute power INSIDE their company,
 *       and is blocked at every edge: not-CEO, cross-company, sparks escalation, managing Sparks
 *       staff, role clamp [1,6], self-lockout, self-deactivate, self-supervise.
 *   (B) GET /api/ceo/overview SQL — company-scoped aggregation that does NOT bleed another company's
 *       projects/people, with correct member counts.
 *   (C) A real role change via db.people.update persists (role_level + status), exercising the same
 *       path the PATCH endpoint uses. (Identity DUAL-WRITE across DBs is separately proven 11/11 by
 *       identity-dual-write-proof.js — not re-proven here.)
 *
 * SAFE: provisions its own throwaway DB (horizon_ceotest), dropped+recreated at the start of each run.
 *   PG_HOST=localhost PG_PORT=55432 PG_USER=proofuser PG_PASSWORD=proofpass node database/ceo-control-center-proof.js
 */
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
const HOST=process.env.PG_HOST||'localhost', PORT=process.env.PG_PORT||'55432',
      USER=process.env.PG_USER||'proofuser', PASS=process.env.PG_PASSWORD||'proofpass';
const TDB='horizon_ceotest';
process.env.PG_HOST=HOST; process.env.PG_PORT=PORT; process.env.PG_USER=USER; process.env.PG_PASSWORD=PASS; process.env.PG_DATABASE=TDB;
const base={host:HOST,port:PORT,user:USER,password:PASS};
const results=[]; const check=(n,p)=>{results.push({n,p});console.log(`${p?'  PASS':'  FAIL'}  ${n}`);};
async function admin(sql,db='postgres'){const c=new Client({...base,database:db});await c.connect();try{return await c.query(sql);}finally{await c.end();}}

// Capture a CeoGuardError code, or '<no throw>' if the call unexpectedly succeeded.
function denyCode(fn){ try { fn(); return '<no throw>'; } catch(e){ return e.code || e.message; } }

(async()=>{
  await admin(`DROP DATABASE IF EXISTS ${TDB} WITH (FORCE)`); await admin(`CREATE DATABASE ${TDB}`);
  { const c=new Client({...base,database:TDB}); await c.connect();
    await c.query('CREATE SCHEMA IF NOT EXISTS voicereport'); await c.query('SET search_path TO voicereport');
    await c.query(fs.readFileSync(path.join(__dirname,'postgres-schema.sql'),'utf8')); await c.end(); }

  const DB=require('./db');
  const { sanitizePersonChange } = require('../server/lib/ceoGuards');
  const { getActor } = require('../server/auth/authz');
  const q=(sql,p)=>DB.db.query(sql,p);

  // ---- org for company 'co': CEO(6), PM(5), Foreman(3), Worker(2); plus an outsider in 'other' and a Sparks staffer
  for (const p of [
    {id:'ceo',  name:' Celia CEO', pin:'7001', rt:'CEO',         rl:6, sup:null,  co:'co'},
    {id:'pm',   name:'Pat PM',     pin:'7002', rt:'Project Mgr', rl:5, sup:'ceo', co:'co'},
    {id:'fore', name:'Fran Fore',  pin:'7003', rt:'Foreman',     rl:3, sup:'pm',  co:'co'},
    {id:'wk',   name:'Will Worker',pin:'7004', rt:'Journeyman',  rl:2, sup:'fore',co:'co'},
    {id:'out',  name:'Otto Other', pin:'7005', rt:'Foreman',     rl:3, sup:null,  co:'other'},
    {id:'spark',name:'Sam Sparks', pin:'7006', rt:'Support',     rl:5, sup:null,  co:'co'},
  ]) await DB.people.create({id:p.id,name:p.name,pin:p.pin,role_title:p.rt,role_level:p.rl,supervisor_id:p.sup,company_id:p.co});
  await q("UPDATE people SET sparks_role='support' WHERE id='spark'");

  // companies registry + projects/members for two companies (to prove overview no-bleed)
  await q("INSERT INTO companies (id,name,slug,status,tier) VALUES ('co','Refinery Co','refinery-co','active','standard'),('other','Other Co','other-co','active','standard')");
  await q("INSERT INTO projects (id,name,company_id) VALUES ('p1','Unit 1','co'),('p2','Unit 2','co'),('p9','Foreign Unit','other')");
  await q("INSERT INTO project_members (project_id,person_id,role) VALUES ('p1','fore','member'),('p1','wk','member'),('p2','pm','pm'),('p9','out','member')");

  const ceo   = {person_id:'ceo', role_level:6, company_id:'co', sparks_role:null};
  const pm    = {person_id:'pm',  role_level:5, company_id:'co', sparks_role:null};
  const row = async (id)=> (await q('SELECT * FROM people WHERE id=$1',[id])).rows[0];

  console.log('\n— (A) sanitizePersonChange — the wall —');
  // ALLOW: CEO promotes foreman 3 -> superintendent 4
  const promo = sanitizePersonChange(ceo, await row('fore'), {role_level:4, role_title:'Superintendent'});
  check('CEO promotes foreman to superintendent (role 4) — allowed', promo.role_level===4 && promo.role_title==='Superintendent');
  // CLAMP: role_level 9 -> 6
  check('role_level 9 is clamped to 6 (company cap)', sanitizePersonChange(ceo, await row('fore'), {role_level:9}).role_level===6);
  check('role_level 0 is clamped to 1 (floor)', sanitizePersonChange(ceo, await row('fore'), {role_level:0}).role_level===1);
  // DENY edges
  check('non-CEO (PM role 5) is denied (NOT_CEO)',                 denyCode(()=>sanitizePersonChange(pm,  ()=>{}, {role_level:4}))==='NOT_CEO');
  check('CEO setting sparks_role is denied (NO_SPARKS_GRANT)',     denyCode(()=>sanitizePersonChange(ceo, {id:'fore',company_id:'co'}, {sparks_role:'admin'}))==='NO_SPARKS_GRANT');
  check('CEO managing a Sparks-staff target denied (TARGET_IS_SPARKS)', denyCode(()=>sanitizePersonChange(ceo, {id:'spark',company_id:'co',sparks_role:'support'}, {role_level:3}))==='TARGET_IS_SPARKS');
  check('CEO reaching into another company denied (CROSS_COMPANY)', denyCode(()=>sanitizePersonChange(ceo, {id:'out',company_id:'other'}, {role_level:4}))==='CROSS_COMPANY');
  check('CEO lowering OWN role below 6 denied (SELF_LOCKOUT)',      denyCode(()=>sanitizePersonChange(ceo, {id:'ceo',company_id:'co'}, {role_level:5}))==='SELF_LOCKOUT');
  check('CEO deactivating OWN account denied (SELF_DEACTIVATE)',    denyCode(()=>sanitizePersonChange(ceo, {id:'ceo',company_id:'co'}, {status:'inactive'}))==='SELF_DEACTIVATE');
  check('self-supervise denied (SELF_SUPERVISE)',                  denyCode(()=>sanitizePersonChange(ceo, {id:'fore',company_id:'co'}, {supervisor_id:'fore'}))==='SELF_SUPERVISE');
  check('bad status value denied (BAD_STATUS)',                    denyCode(()=>sanitizePersonChange(ceo, {id:'fore',company_id:'co'}, {status:'banished'}))==='BAD_STATUS');
  check('empty/no-op change denied (NOOP)',                        denyCode(()=>sanitizePersonChange(ceo, {id:'fore',company_id:'co'}, {}))==='NOOP');
  check('missing target denied (NO_TARGET)',                       denyCode(()=>sanitizePersonChange(ceo, null, {role_level:4}))==='NO_TARGET');
  // FAIL-CLOSED edges (Codex review) — the bugs that the hand-built-actor proof had masked:
  check('actor with NO company_id denied (NO_COMPANY, fail-closed)', denyCode(()=>sanitizePersonChange({person_id:'ceo',role_level:6,sparks_role:null}, {id:'fore',company_id:'co'}, {role_level:4}))==='NO_COMPANY');
  check('target with NULL company_id denied (CROSS_COMPANY, fail-closed)', denyCode(()=>sanitizePersonChange(ceo, {id:'orphan',company_id:null}, {role_level:4}))==='CROSS_COMPANY');
  // getActor MUST surface company_id (Codex HIGH #1) — without it the route's cross-company guard never fires.
  check('getActor() surfaces company_id from req.auth (the real route source)', getActor({auth:{person_id:'ceo',role_level:6,company_id:'co',sparks_role:null}}).company_id==='co');

  console.log('\n— (B) GET /api/ceo/overview SQL — company-scoped, no bleed —');
  const projects = (await q(
    `SELECT p.*, (SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_id=p.id) AS member_count
     FROM projects p WHERE p.company_id=$1 ORDER BY p.name`, ['co'])).rows;
  const people = (await q(
    `SELECT id, name, role_level, status FROM people WHERE company_id=$1 ORDER BY role_level DESC, name`, ['co'])).rows;
  check("overview lists only company 'co' projects (p1,p2) — NOT 'other' p9", projects.length===2 && projects.every(p=>p.id!=='p9'));
  check('overview member_count is correct (p1=2, p2=1)', projects.find(p=>p.id==='p1').member_count===2 && projects.find(p=>p.id==='p2').member_count===1);
  check("overview roster excludes the outsider in 'other'", people.every(p=>p.id!=='out'));
  check('overview roster includes co people incl. the Sparks staffer row (roster is company-scoped)', people.some(p=>p.id==='ceo') && people.some(p=>p.id==='spark'));
  const co=(await q('SELECT id,name,slug,status,tier FROM companies WHERE id=$1',['co'])).rows[0];
  check('overview company metadata resolves from registry', co && co.name==='Refinery Co' && co.tier==='standard');

  console.log('\n— (C) real role change persists via db.people.update —');
  const applied = sanitizePersonChange(ceo, await row('fore'), {role_level:4, status:'active'});
  await DB.people.update('fore', applied);
  const after = await row('fore');
  check('db.people.update applied the CEO role change (foreman -> 4)', after.role_level===4 && after.status==='active');

  console.log('\n— (D) /api/people fail-closed tenant check (Codex round 2 — pre-existing hole) —');
  try {
    const { blockedCrossCompany } = require('../server/routes/people');
    const cust = (companyId, sparks=null) => ({ auth:{sparks_role:sparks}, companyId });
    check('Sparks admin may cross tenants (NOT blocked)',            blockedCrossCompany(cust('co','admin'), {company_id:'other'})===false);
    check('customer same-company NOT blocked',                       blockedCrossCompany(cust('co'), {company_id:'co'})===false);
    check('customer cross-company BLOCKED',                          blockedCrossCompany(cust('co'), {company_id:'other'})===true);
    check('customer with NULL req.companyId BLOCKED (fail-closed)',  blockedCrossCompany(cust(null), {company_id:'co'})===true);
    check('customer w/ target NULL company_id BLOCKED (fail-closed)',blockedCrossCompany(cust('co'), {company_id:null})===true);
    // stripPrivilegedFields — the PUT write-wall (Codex round 3: PM self-promote via polluted is_admin)
    const { stripPrivilegedFields } = require('../server/routes/people');
    // PM (role 5, is_admin TRUE because polluted) editing SELF must NOT keep role_level/is_admin/status
    const pmSelf = stripPrivilegedFields({person_id:'pm', sparks_role:null, is_admin:true}, 'pm', {role_level:6, is_admin:1, status:'inactive', name:'Pat'});
    check('PM self-edit cannot self-promote (role_level/is_admin/status stripped)', pmSelf.role_level===undefined && pmSelf.is_admin===undefined && pmSelf.status===undefined && pmSelf.name==='Pat');
    // customer self-edit cannot set cross-tenant fields
    const custSelf = stripPrivilegedFields({person_id:'fore', sparks_role:null}, 'fore', {sparks_role:'admin', company_id:'other', role_title:'x'});
    check('customer self-edit cannot set sparks_role/company_id', custSelf.sparks_role===undefined && custSelf.company_id===undefined && custSelf.role_title==='x');
    // customer editing ANOTHER may set role_level (admin power) but NOT cross-tenant fields
    const custOther = stripPrivilegedFields({person_id:'ceo', sparks_role:null}, 'fore', {role_level:4, sparks_role:'admin', company_id:'other'});
    check('customer editing another keeps role_level, drops cross-tenant fields', custOther.role_level===4 && custOther.sparks_role===undefined && custOther.company_id===undefined);
    // Sparks staff are unrestricted
    const sparkAny = stripPrivilegedFields({person_id:'s', sparks_role:'admin'}, 'x', {sparks_role:'support', company_id:'co', role_level:6});
    check('Sparks staff write is unrestricted', sparkAny.sparks_role==='support' && sparkAny.company_id==='co' && sparkAny.role_level===6);
  } catch (e) {
    check('load server/routes/people.js helpers', false);
    console.log('    (require failed: '+e.message+')');
  }

  console.log('\n— (E) requireCeo middleware — self-contained company wall (Codex round 3) —');
  try {
    const { requireCeo } = require('../server/routes/ceo');
    const run = (auth, companyId) => { let code=null, passed=false;
      const req={auth, companyId, get:()=>null};
      const res={status:(c)=>{code=c; return {json:()=>{}};}};
      requireCeo(req, res, ()=>{passed=true;});
      return passed ? 'NEXT' : code;
    };
    check('CEO with matching company -> NEXT', run({person_id:'ceo',role_level:6,company_id:'co',sparks_role:null}, 'co')==='NEXT');
    check('Sparks staff -> 403 (denied from CEO window)',   run({person_id:'s',role_level:6,company_id:'co',sparks_role:'admin'}, 'co')===403);
    check('non-CEO (role 5) -> 403',                        run({person_id:'pm',role_level:5,company_id:'co',sparks_role:null}, 'co')===403);
    check('CEO with MISMATCHED route company -> 403',       run({person_id:'ceo',role_level:6,company_id:'co',sparks_role:null}, 'other')===403);
    check('CEO with NULL route company -> 403 (fail-closed)',run({person_id:'ceo',role_level:6,company_id:'co',sparks_role:null}, null)===403);
    check('CEO with NO actor company -> 403 (fail-closed)', run({person_id:'ceo',role_level:6,company_id:null,sparks_role:null}, 'co')===403);
  } catch (e) {
    check('load server/routes/ceo.js requireCeo', false);
    console.log('    (require failed: '+e.message+')');
  }

  // (leave the throwaway DB; next run drops+recreates it. Dropping now would terminate db.js's open pool.)
  const failed=results.filter(r=>!r.p).length;
  console.log(`\n${failed?`❌ ${failed} FAILED`:'✅ ALL PASS'} — ${results.length-failed}/${results.length}`);
  process.exit(failed?1:0);
})().catch(e=>{console.error('PROOF CRASH:',e);process.exit(2);});
