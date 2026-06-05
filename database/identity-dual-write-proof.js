#!/usr/bin/env node
/**
 * Identity dual-write proof / regression guard for the per-company people split.
 *
 * Runs the REAL database/db.js people methods through a per-company pool and asserts the dual-write
 * identity invariants: a person created in a company DB is stored there (joins keep working) AND
 * mirrored to the shared login table (login works), companies cannot see each other's people, PINs
 * are globally unique, PIN changes propagate, and deactivation locks login out.
 *
 * SAFE: it provisions its OWN throwaway databases (horizon_idtest_shared / _a / _b), never the real
 * shared or any tenant DB, and drops them at the end (hard-guarded to the horizon_idtest_ prefix).
 *
 *   PG_HOST=localhost PG_PORT=55432 PG_USER=... PG_PASSWORD=... node database/identity-dual-write-proof.js
 */
const { Pool, Client } = require('pg');
const fs = require('fs');
const path = require('path');

const HOST=process.env.PG_HOST||'localhost', PORT=process.env.PG_PORT||'55432',
      USER=process.env.PG_USER||'proofuser', PASS=process.env.PG_PASSWORD||'proofpass';
const SHARED='horizon_idtest_shared', A='horizon_idtest_a', B='horizon_idtest_b';
const PREFIX='horizon_idtest_';
// db.js reads PG_DATABASE at require-time → point its shared pool at our throwaway shared DB.
process.env.PG_HOST=HOST; process.env.PG_PORT=PORT; process.env.PG_USER=USER; process.env.PG_PASSWORD=PASS;
process.env.PG_DATABASE=SHARED;

const base={host:HOST,port:PORT,user:USER,password:PASS};
const mkPool=(db)=>new Pool({...base,database:db,options:'-c search_path=voicereport'});
const results=[]; const check=(n,p)=>{results.push({n,p});console.log(`${p?'  PASS':'  FAIL'}  ${n}`);};

async function admin(sql,db='postgres'){const c=new Client({...base,database:db});await c.connect();try{return await c.query(sql);}finally{await c.end();}}
async function applySchema(db){const SCHEMA=fs.readFileSync(path.join(__dirname,'postgres-schema.sql'),'utf8');const c=new Client({...base,database:db});await c.connect();try{await c.query('CREATE SCHEMA IF NOT EXISTS voicereport');await c.query('SET search_path TO voicereport');await c.query(SCHEMA);}finally{await c.end();}}
async function dropTestDbs(){for(const db of [A,B,SHARED]){if(!db.startsWith(PREFIX)){console.error('refuse drop '+db);continue;}try{await admin(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);}catch(e){}}}

(async()=>{
  await dropTestDbs();                                  // clean slate (safe: nothing connected yet)
  for(const db of [SHARED,A,B]) await admin(`CREATE DATABASE ${db}`);
  for(const db of [SHARED,A,B]) await applySchema(db);
  const DB=require('./db');
  const poolA=mkPool(A),poolB=mkPool(B),shared=mkPool(SHARED);
  const dbA=DB.withPool(poolA),dbB=DB.withPool(poolB);

  await dbA.people.create({id:'p_alpha',name:'Alpha',pin:'1111',role_title:'Foreman',role_level:3,company_id:'company_a'});
  check('person stored in company A own DB', !!(await poolA.query("SELECT 1 FROM people WHERE id='p_alpha'")).rows.length);
  check('login identity mirrored to shared', !!(await shared.query("SELECT 1 FROM people WHERE id='p_alpha' AND pin='1111'")).rows.length);
  const login=await DB.people.getByPin('1111');
  check('login finds the person + company', !!login && login.id==='p_alpha' && login.company_id==='company_a');

  await dbB.people.create({id:'p_beta',name:'Beta',pin:'2222',role_title:'Foreman',role_level:3,company_id:'company_b'});
  check("company A cannot see B's person", (await poolA.query("SELECT 1 FROM people WHERE id='p_beta'")).rows.length===0);
  check("company B cannot see A's person", (await poolB.query("SELECT 1 FROM people WHERE id='p_alpha'")).rows.length===0);

  let threw=false; try{await dbB.people.create({id:'p_clash',name:'Clash',pin:'1111',role_title:'X',role_level:1,company_id:'company_b'});}catch(e){threw=true;}
  check('duplicate PIN across companies rejected', threw);

  await dbB.people.update('p_beta',{pin:'9999'});
  check('PIN change propagates to shared login', !!(await DB.people.getByPin('9999')) && !(await DB.people.getByPin('2222')));

  await dbA.people.delete('p_alpha');
  check('deactivated person cannot log in', !(await DB.people.getByPin('1111')));

  await poolA.end(); await poolB.end(); await shared.end();
  const failed=results.filter(r=>!r.p).length;
  // Leave the throwaway test DBs in place (next run drops+recreates them); dropping the shared one now
  // would terminate db.js's still-open pool. Harmless: horizon_idtest_* only.
  console.log(`\n${failed===0?'ALL '+results.length+' PASSED — dual-write identity invariants hold.':failed+' FAILED'}`);
  process.exit(failed===0?0:1);
})().catch(async e=>{console.error('PROOF ERROR:',e.message); try{await dropTestDbs();}catch{} process.exit(2);});
