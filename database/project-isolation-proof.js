#!/usr/bin/env node
/**
 * LEVEL 2 isolation proof — projects within ONE company (one database) do not bleed.
 *
 * Exercises the REAL db.js report-visibility graph (_rebuildAllVisibility, the see-down-never-up chain)
 * plus the exact scoping predicates the app enforces:
 *   - visiblePersonIds  = SELECT person_id FROM report_visibility WHERE viewer_id = me   (agent.js)
 *   - accessibleProjectIds = SELECT project_id FROM project_members WHERE person_id = me (reports.js)
 *   - canCrossProject   = role_level >= 6  (CEO/PM see all projects in their company)
 * Effective report scope for a non-cross user: author ∈ visiblePersonIds AND project ∈ accessibleProjectIds.
 *
 * Scenario (one company): CEO over Tony (project_1) and Bob (project_2), each with a worker.
 *   Tony must NOT see project_2's work; Bob must NOT see project_1's; the CEO sees BOTH (master key,
 *   but only inside this company). Negative control proves the other project's data EXISTS (hidden, not absent).
 *
 * SAFE: provisions its own throwaway DB (horizon_projtest) and drops it at the start of each run.
 *   PG_HOST=localhost PG_PORT=55432 PG_USER=... PG_PASSWORD=... node database/project-isolation-proof.js
 */
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
const HOST=process.env.PG_HOST||'localhost', PORT=process.env.PG_PORT||'55432',
      USER=process.env.PG_USER||'proofuser', PASS=process.env.PG_PASSWORD||'proofpass';
const TDB='horizon_projtest';
process.env.PG_HOST=HOST; process.env.PG_PORT=PORT; process.env.PG_USER=USER; process.env.PG_PASSWORD=PASS; process.env.PG_DATABASE=TDB;
const base={host:HOST,port:PORT,user:USER,password:PASS};
const results=[]; const check=(n,p)=>{results.push({n,p});console.log(`${p?'  PASS':'  FAIL'}  ${n}`);};
async function admin(sql,db='postgres'){const c=new Client({...base,database:db});await c.connect();try{return await c.query(sql);}finally{await c.end();}}

(async()=>{
  await admin(`DROP DATABASE IF EXISTS ${TDB} WITH (FORCE)`); await admin(`CREATE DATABASE ${TDB}`);
  { const c=new Client({...base,database:TDB}); await c.connect();
    await c.query('CREATE SCHEMA IF NOT EXISTS voicereport'); await c.query('SET search_path TO voicereport');
    await c.query(fs.readFileSync(path.join(__dirname,'postgres-schema.sql'),'utf8')); await c.end(); }
  const DB=require('./db');                       // shared pool == the single company DB (no per-company mirror)
  const q=(sql,p)=>DB.db.query(sql,p);

  // org: ceo(6) over tony(3,proj_1) & bob(3,proj_2); workers under each
  const C='SET search_path TO voicereport';
  for (const p of [
    {id:'ceo',name:'CEO',pin:'9001',rt:'CEO',rl:6,sup:null},
    {id:'tony',name:'Tony',pin:'9002',rt:'Foreman',rl:3,sup:'ceo'},
    {id:'bob',name:'Bob',pin:'9003',rt:'Foreman',rl:3,sup:'ceo'},
    {id:'wt',name:'WorkerT',pin:'9004',rt:'Journeyman',rl:2,sup:'tony'},
    {id:'wb',name:'WorkerB',pin:'9005',rt:'Journeyman',rl:2,sup:'bob'},
  ]) await DB.people.create({id:p.id,name:p.name,pin:p.pin,role_title:p.rt,role_level:p.rl,supervisor_id:p.sup,company_id:'co'});

  await q("INSERT INTO projects (id,name,company_id) VALUES ('proj_1','Unit 1','co'),('proj_2','Unit 2','co')");
  await q("INSERT INTO project_members (project_id,person_id) VALUES ('proj_1','tony'),('proj_1','wt'),('proj_2','bob'),('proj_2','wb')");
  const now=new Date().toISOString();
  await q(`INSERT INTO reports (id,person_id,project_id,company_id,created_at) VALUES
    ('r_tony','tony','proj_1','co',$1),('r_wt','wt','proj_1','co',$1),
    ('r_bob','bob','proj_2','co',$1),('r_wb','wb','proj_2','co',$1)`,[now]);
  await DB.people._rebuildAllVisibility();

  const visible = async (id)=> (await q('SELECT person_id FROM report_visibility WHERE viewer_id=$1',[id])).rows.map(r=>r.person_id);
  const projects = async (id)=> (await q('SELECT project_id FROM project_members WHERE person_id=$1',[id])).rows.map(r=>r.project_id);
  // effective report scope, exactly as the app enforces it
  async function reportsVisibleTo(id, role){
    const vis=await visible(id);
    if (role>=6) { return (await q("SELECT id FROM reports WHERE company_id='co' AND person_id = ANY($1)",[vis])).rows.map(r=>r.id); }
    const acc=await projects(id);
    return (await q("SELECT id FROM reports WHERE company_id='co' AND person_id = ANY($1) AND project_id = ANY($2)",[vis,acc])).rows.map(r=>r.id);
  }
  const has=(a,x)=>a.includes(x); const lacks=(a,x)=>!a.includes(x);

  const tVis=await visible('tony'), tProj=await projects('tony');
  check('Tony sees only his own chain (self + worker), not peer Bob/WorkerB', has(tVis,'tony')&&has(tVis,'wt')&&lacks(tVis,'bob')&&lacks(tVis,'wb'));
  check('Tony is a member of only project_1', tProj.length===1 && tProj[0]==='proj_1');
  const tR=await reportsVisibleTo('tony',3);
  check("Tony sees project_1 reports, NOT project_2's (no bleed)", has(tR,'r_tony')&&has(tR,'r_wt')&&lacks(tR,'r_bob')&&lacks(tR,'r_wb'));
  const bR=await reportsVisibleTo('bob',3);
  check("Bob sees project_2 reports, NOT project_1's (no bleed, both ways)", has(bR,'r_bob')&&has(bR,'r_wb')&&lacks(bR,'r_tony')&&lacks(bR,'r_wt'));
  const cR=await reportsVisibleTo('ceo',6);
  check('CEO (role 6) crosses both projects — sees ALL 4 reports (master key, within company)', ['r_tony','r_wt','r_bob','r_wb'].every(x=>has(cR,x)));
  const exist=(await q("SELECT count(*)::int n FROM reports WHERE project_id='proj_2'")).rows[0].n;
  check('Negative control: project_2 reports EXIST (filter hides them from Tony, not absence)', exist===2);

  // (leave the throwaway DB; next run drops+recreates it. Dropping it now would terminate db.js's open pool.)
  const failed=results.filter(r=>!r.p).length;
  console.log(`\n${failed===0?'🟢 ALL '+results.length+' PASSED — Level 2 proven: projects in one company do not bleed; CEO crosses, foremen do not.':'🔴 '+failed+' FAILED'}`);
  process.exit(failed===0?0:1);
})().catch(e=>{console.error('PROOF ERROR:',e.message);process.exit(2);});
