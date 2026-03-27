/**
 * Demo Data Seed Script — Electrical Trade
 *
 * Creates realistic scenarios for testing the full workflow:
 * - Multi-day tasks with daily entries
 * - JSAs (matching, mismatched, and missing)
 * - Daily reports with progress and issues
 * - Worker movements between tasks
 * - Safety compliance gaps
 *
 * Run: node database/seed-demo.js
 */

const DB = require('./db');
const { v4: uuidv4 } = require('uuid');

const today = new Date().toISOString().split('T')[0];
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];
const fourDaysAgo = new Date(Date.now() - 4 * 86400000).toISOString().split('T')[0];

// ──────────────────────────────────────────
// PEOPLE IDs (existing + new)
// ──────────────────────────────────────────
const PEOPLE = {
  // Leadership
  pm: 'person_pm_henderson',
  supt: 'person_supt_medina',

  // GFs
  gf_thompson: 'person_gf_thompson',
  gf_vega: 'person_gf_vega',
  gf_harris: 'person_gf_harris',

  // Foremen (under Thompson)
  fm_rios: 'person_1774050780743',       // Jose Rios
  fm_gutierrez: 'person_foreman_gutierrez', // Luis Gutierrez

  // Foremen (under Vega)
  fm_park: 'person_foreman_park',         // Steve Park
  fm_mitchell: 'person_foreman_mitchell', // Tony Mitchell

  // Foremen (under Harris)
  fm_garcia: 'person_foreman_garcia',     // Eddie Garcia

  // Journeymen (Rios crew)
  jw_delgado: 'person_jw_delgado',       // Marco Delgado
  jw_reyes: 'person_jw_extra_5',         // Carlos Reyes
  jw_torres: 'person_jw_extra_6',        // Miguel Torres

  // Journeymen (Gutierrez crew)
  jw_williams: 'person_jw_williams',     // Danny Williams
  jw_sanchez: 'person_jw_sanchez',       // Roberto Sanchez
  jw_chen: 'person_jw_extra_7',          // David Chen
  jw_walker: 'person_jw_extra_8',        // James Walker

  // Journeymen (Park crew — need to reassign some)
  jw_jairo: 'person_1774034302762',      // John Jairo

  // Helpers
  helper_martinez: 'person_helper_1',    // Pedro Martinez
  helper_brown: 'person_helper_2',       // Kevin Brown
  helper_ramirez: 'person_helper_3',     // Angel Ramirez
  helper_johnson: 'person_helper_4',     // Tyler Johnson
  helper_ruiz: 'person_helper_extra_5',  // Oscar Ruiz
  helper_lee: 'person_helper_extra_6',   // Brian Lee

  // Safety
  safety_santos: 'person_safety_santos', // Maria Santos
};

console.log('Seeding demo data...\n');

// Ensure JSA tables exist (normally created by jsa.js route on first load)
const db0 = DB.db;
db0.exec(`
  CREATE TABLE IF NOT EXISTS jsa_records (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    person_name TEXT NOT NULL,
    trade TEXT,
    date TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    mode TEXT DEFAULT 'shared',
    form_data TEXT DEFAULT '{}',
    supervisor_id TEXT,
    foreman_id TEXT,
    foreman_name TEXT,
    foreman_approved_at TEXT,
    safety_id TEXT,
    safety_name TEXT,
    safety_approved_at TEXT,
    rejection_reason TEXT,
    crew_members TEXT DEFAULT '[]',
    task_id TEXT,
    jsa_number TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);
db0.exec(`
  CREATE TABLE IF NOT EXISTS jsa_acknowledgments (
    id TEXT PRIMARY KEY,
    jsa_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    person_name TEXT NOT NULL,
    role_title TEXT,
    my_task TEXT,
    my_hazards TEXT,
    my_controls TEXT,
    ai_conversation TEXT DEFAULT '[]',
    signature TEXT,
    acknowledged_at TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (jsa_id) REFERENCES jsa_records(id)
  )
`);
console.log('  JSA tables ensured');

// ──────────────────────────────────────────
// 1. TASKS — Multi-day, realistic scenarios
// ──────────────────────────────────────────
const tasks = [
  {
    id: 'task_conduit_2nd_floor',
    title: 'Run 2-inch RMC conduit in Area 5 pipe rack',
    description: 'Continue from JB-501 to MCC-5A. ~120 feet remaining. Scaffold crew at 7 AM.',
    assigned_to: PEOPLE.jw_reyes,
    assigned_to_name: 'Carlos Reyes',
    created_by: PEOPLE.fm_rios,
    created_by_name: 'Jose Rios',
    status: 'in_progress',
    priority: 'high',
    trade: 'Electrical',
    location: 'Area 5, Pipe Rack, Elevation 30ft',
    start_date: fourDaysAgo,
    target_end_date: null,
  },
  {
    id: 'task_cable_pull_tray5a',
    title: 'Pull power cables in Cable Tray 5A',
    description: 'Pull 3/C #4/0 from MCC-5A to Motor M-501. ~200 feet. Need tugger and sheaves.',
    assigned_to: PEOPLE.jw_torres,
    assigned_to_name: 'Miguel Torres',
    created_by: PEOPLE.fm_rios,
    created_by_name: 'Jose Rios',
    status: 'in_progress',
    priority: 'high',
    trade: 'Electrical',
    location: 'Building A, Cable Tray 5A',
    start_date: twoDaysAgo,
    target_end_date: null,
  },
  {
    id: 'task_panel_terminations',
    title: 'Terminate circuits in Panel LP-3B',
    description: 'Land 24 branch circuits per drawing E-3015 Rev 2. Check wire markings against schedule.',
    assigned_to: PEOPLE.jw_delgado,
    assigned_to_name: 'Marco Delgado',
    created_by: PEOPLE.fm_rios,
    created_by_name: 'Jose Rios',
    status: 'in_progress',
    priority: 'normal',
    trade: 'Electrical',
    location: 'Building A, Electrical Room 3B',
    start_date: yesterday,
    target_end_date: today,
  },
  {
    id: 'task_megger_test',
    title: 'Megger test cables in Tray TR-5A',
    description: 'Test 6 cables pulled yesterday. 1000V test. Record on HS-EL-001.',
    assigned_to: PEOPLE.jw_williams,
    assigned_to_name: 'Danny Williams',
    created_by: PEOPLE.fm_gutierrez,
    created_by_name: 'Luis Gutierrez',
    status: 'pending',
    priority: 'high',
    trade: 'Electrical',
    location: 'Building A, Cable Tray TR-5A',
    start_date: today,
    target_end_date: today,
  },
  {
    id: 'task_ground_grid',
    title: 'Install ground grid connections Area 7',
    description: 'Cadweld 12 connections per ground grid drawing E-7001. Verify soil resistance.',
    assigned_to: PEOPLE.jw_sanchez,
    assigned_to_name: 'Roberto Sanchez',
    created_by: PEOPLE.fm_gutierrez,
    created_by_name: 'Luis Gutierrez',
    status: 'in_progress',
    priority: 'normal',
    trade: 'Electrical',
    location: 'Area 7, Grade Level',
    start_date: threeDaysAgo,
    target_end_date: null,
  },
  {
    id: 'task_mcc_installation',
    title: 'Set and align MCC-5A motor control center',
    description: 'Rig MCC-5A into position. Level, anchor, connect ground bus. 4500 lbs.',
    assigned_to: PEOPLE.jw_chen,
    assigned_to_name: 'David Chen',
    created_by: PEOPLE.fm_gutierrez,
    created_by_name: 'Luis Gutierrez',
    status: 'completed',
    priority: 'critical',
    trade: 'Electrical',
    location: 'Building A, Electrical Room 5A',
    start_date: fourDaysAgo,
    target_end_date: twoDaysAgo,
    completed_at: twoDaysAgo + 'T15:30:00.000Z',
  },
  {
    id: 'task_lighting_area3',
    title: 'Install temporary lighting Area 3',
    description: 'String lights per temp power plan. 20 fixtures, 500 feet of SO cord.',
    assigned_to: PEOPLE.jw_walker,
    assigned_to_name: 'James Walker',
    created_by: PEOPLE.fm_gutierrez,
    created_by_name: 'Luis Gutierrez',
    status: 'in_progress',
    priority: 'normal',
    trade: 'Electrical',
    location: 'Area 3, All levels',
    start_date: yesterday,
    target_end_date: null,
  },
];

// Insert tasks — need daily_plans first (tasks require plan_id)
const db = DB.db;

// Create daily plans for each foreman who has tasks
const insertPlan = db.prepare(`
  INSERT OR REPLACE INTO daily_plans (id, date, created_by, trade, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

const plans = [
  { id: 'plan_rios_today', date: today, created_by: PEOPLE.fm_rios, trade: 'Electrical' },
  { id: 'plan_rios_yesterday', date: yesterday, created_by: PEOPLE.fm_rios, trade: 'Electrical' },
  { id: 'plan_gutierrez_today', date: today, created_by: PEOPLE.fm_gutierrez, trade: 'Electrical' },
  { id: 'plan_gutierrez_yesterday', date: yesterday, created_by: PEOPLE.fm_gutierrez, trade: 'Electrical' },
  { id: 'plan_rios_2ago', date: twoDaysAgo, created_by: PEOPLE.fm_rios, trade: 'Electrical' },
  { id: 'plan_gutierrez_2ago', date: twoDaysAgo, created_by: PEOPLE.fm_gutierrez, trade: 'Electrical' },
  { id: 'plan_gutierrez_3ago', date: threeDaysAgo, created_by: PEOPLE.fm_gutierrez, trade: 'Electrical' },
  { id: 'plan_rios_3ago', date: threeDaysAgo, created_by: PEOPLE.fm_rios, trade: 'Electrical' },
  { id: 'plan_rios_4ago', date: fourDaysAgo, created_by: PEOPLE.fm_rios, trade: 'Electrical' },
  { id: 'plan_gutierrez_4ago', date: fourDaysAgo, created_by: PEOPLE.fm_gutierrez, trade: 'Electrical' },
];

for (const p of plans) {
  insertPlan.run(p.id, p.date, p.created_by, p.trade, p.date + 'T06:00:00.000Z');
}
console.log(`  Created ${plans.length} daily plans`);

const insertTask = db.prepare(`
  INSERT OR REPLACE INTO daily_plan_tasks
  (id, plan_id, title, description, assigned_to, status, priority, trade, location,
   start_date, target_end_date, created_by, completed_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Map tasks to their plan_ids
const taskPlanMap = {
  'task_conduit_2nd_floor': 'plan_rios_4ago',
  'task_cable_pull_tray5a': 'plan_rios_2ago',
  'task_panel_terminations': 'plan_rios_yesterday',
  'task_megger_test': 'plan_gutierrez_today',
  'task_ground_grid': 'plan_gutierrez_3ago',
  'task_mcc_installation': 'plan_gutierrez_4ago',
  'task_lighting_area3': 'plan_gutierrez_yesterday',
};

for (const t of tasks) {
  insertTask.run(
    t.id, taskPlanMap[t.id], t.title, t.description, t.assigned_to, t.status, t.priority,
    t.trade, t.location, t.start_date, t.target_end_date, t.created_by,
    t.completed_at || null, t.start_date + 'T06:30:00.000Z'
  );
  console.log(`  Task: ${t.title} (${t.status})`);
}

// ──────────────────────────────────────────
// 2. TASK DAYS — Daily entries with shift reports
// ──────────────────────────────────────────
const insertTaskDay = db.prepare(`
  INSERT OR REPLACE INTO task_days
  (id, task_id, date, person_id, jsa_id, shift_structured, shift_notes, hours_worked, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const taskDays = [
  // Conduit run — 4 days of progress
  { task_id: 'task_conduit_2nd_floor', date: fourDaysAgo, person_id: PEOPLE.jw_reyes,
    shift: 'Installed first 40 feet of 2-inch RMC from JB-501 heading toward MCC-5A. Set 8 supports per drawing. Scaffold was delayed 45 minutes — crew stood down. Material staged for tomorrow.',
    hours: 9.5 },
  { task_id: 'task_conduit_2nd_floor', date: threeDaysAgo, person_id: PEOPLE.jw_reyes,
    shift: 'Continued conduit run. Added 35 feet today. Had to reroute around pipe support at column 14 — conflict with piping not shown on drawing. Submitted RFI #E-047. Used 4 elbows and 2 couplings.',
    hours: 10 },
  { task_id: 'task_conduit_2nd_floor', date: twoDaysAgo, person_id: PEOPLE.jw_reyes,
    shift: 'Engineering responded to RFI — approved offset route. Installed 25 feet with the offset. Pedro helped with pipe rack access. ~20 feet remaining to MCC-5A location.',
    hours: 10 },
  { task_id: 'task_conduit_2nd_floor', date: yesterday, person_id: PEOPLE.jw_reyes,
    shift: 'Ran final 15 feet of conduit to MCC-5A stub-up location. Pulled rope through. Conduit run is 95% complete — need to install last coupling and bell end at MCC. Will finish tomorrow morning.',
    hours: 9 },

  // Cable pull — 2 days
  { task_id: 'task_cable_pull_tray5a', date: twoDaysAgo, person_id: PEOPLE.jw_torres,
    shift: 'Set up tugger at pull point. Installed sheaves at 3 direction changes. Pre-measured and cut cable to length — 215 feet with service loops. Cable is 3/C #4/0 aluminum XHHW. Ready to pull tomorrow.',
    hours: 10 },
  { task_id: 'task_cable_pull_tray5a', date: yesterday, person_id: PEOPLE.jw_torres,
    shift: 'Pulled cable successfully. No damage, no exceeding pulling tension. Cable supported every 3 feet in tray per NEC. Tagged both ends. Need to terminate at MCC-5A when conduit run is complete.',
    hours: 10 },

  // Panel terminations — started yesterday
  { task_id: 'task_panel_terminations', date: yesterday, person_id: PEOPLE.jw_delgado,
    shift: 'Started landing circuits in LP-3B. Completed 12 of 24 branch circuits. Wire markings match schedule. Found 2 wires with wrong color tape — fixed per drawing E-3015. Will finish remaining 12 tomorrow.',
    hours: 9 },

  // Ground grid — 3 days
  { task_id: 'task_ground_grid', date: threeDaysAgo, person_id: PEOPLE.jw_sanchez,
    shift: 'Excavated for 4 Cadweld connections. Verified conductor routing per E-7001. Installed molds for first 4 joints. Angel helped with excavation.',
    hours: 10 },
  { task_id: 'task_ground_grid', date: twoDaysAgo, person_id: PEOPLE.jw_sanchez,
    shift: 'Completed 4 Cadweld connections. All passed visual inspection — full fill, no voids. Started next 4 locations. Rain delay from 1-2 PM.',
    hours: 8 },
  { task_id: 'task_ground_grid', date: yesterday, person_id: PEOPLE.jw_sanchez,
    shift: 'Completed 4 more Cadweld joints (8 total of 12). Ground resistance test on completed section: 3.2 ohms — within spec. 4 remaining connections tomorrow.',
    hours: 10 },

  // MCC installation — completed task, 3 days
  { task_id: 'task_mcc_installation', date: fourDaysAgo, person_id: PEOPLE.jw_chen,
    shift: 'Received MCC-5A from laydown yard. Verified shipping damage — none. Rigged with crane per lifting plan. Set on housekeeping pad. Initial alignment.',
    hours: 10 },
  { task_id: 'task_mcc_installation', date: threeDaysAgo, person_id: PEOPLE.jw_chen,
    shift: 'Final leveling and alignment. Drilled and installed 8 anchor bolts. Torqued to spec. Connected ground bus to building ground.',
    hours: 10 },
  { task_id: 'task_mcc_installation', date: twoDaysAgo, person_id: PEOPLE.jw_chen,
    shift: 'Final inspection with QC. All anchor bolts verified. Ground continuity test passed. MCC-5A installation complete. Ready for cable terminations.',
    hours: 6 },

  // Lighting — started yesterday
  { task_id: 'task_lighting_area3', date: yesterday, person_id: PEOPLE.jw_walker,
    shift: 'Installed 8 of 20 temporary light fixtures in Area 3 first floor. Ran 200 feet of 10/3 SO cord from temp panel. All GFCI protected. Tyler helped stringing lights on elevated areas.',
    hours: 10 },
];

for (const td of taskDays) {
  insertTaskDay.run(
    `td_${td.task_id}_${td.date}`, td.task_id, td.date, td.person_id,
    null, td.shift, JSON.stringify({ shift_summary: td.shift }), td.hours,
    td.date + 'T15:30:00.000Z'
  );
}
console.log(`\n  Created ${taskDays.length} task day entries`);

// ──────────────────────────────────────────
// 3. JSAs — Various scenarios
// ──────────────────────────────────────────
const insertJsa = db.prepare(`
  INSERT OR REPLACE INTO jsa_records
  (id, person_id, person_name, trade, date, status, mode, form_data,
   foreman_id, foreman_name, foreman_approved_at, crew_members, jsa_number, task_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const jsas = [
  // SCENARIO 1: Matching JSA — Carlos Reyes conduit work (today)
  {
    id: 'jsa_reyes_today',
    person_id: PEOPLE.jw_reyes, person_name: 'Carlos Reyes',
    trade: 'Electrical', date: today, status: 'active', mode: 'shared',
    form_data: JSON.stringify({
      task_description: 'Complete 2-inch RMC conduit run from JB-501 to MCC-5A in Area 5 pipe rack at 30ft elevation',
      hazards: ['Working at heights (30ft elevation on scaffold)', 'Overhead crane operations in area', 'Hot surfaces from adjacent piping', 'Pinch points with conduit and fittings', 'Material handling — conduit sections at height'],
      controls: ['Full body harness tied off 100% on scaffold', 'Hard hat, safety glasses, gloves at all times', 'Spotter when lifting material to elevation', 'Communication with crane operator before movement', 'Tool lanyards for hand tools above 6 feet'],
      ppe: ['Hard Hat', 'Safety Glasses', 'Leather Gloves', 'Steel Toe Boots', 'Full Body Harness with Shock Absorbing Lanyard', 'High-Vis Vest'],
    }),
    foreman_id: PEOPLE.fm_rios, foreman_name: 'Jose Rios',
    foreman_approved_at: today + 'T06:45:00.000Z',
    crew_members: JSON.stringify([
      { id: PEOPLE.jw_reyes, name: 'Carlos Reyes', role_title: 'Journeyman Electrician' },
      { id: PEOPLE.helper_martinez, name: 'Pedro Martinez', role_title: 'Helper' },
    ]),
    jsa_number: 'JSA-2026-0042',
    task_id: 'task_conduit_2nd_floor',
  },

  // SCENARIO 2: JSA MISMATCH — Miguel Torres has JSA for cable pulling but got assigned panel work
  {
    id: 'jsa_torres_today',
    person_id: PEOPLE.jw_torres, person_name: 'Miguel Torres',
    trade: 'Electrical', date: today, status: 'active', mode: 'shared',
    form_data: JSON.stringify({
      task_description: 'Pull power cables in Cable Tray 5A from MCC-5A to Motor M-501',
      hazards: ['Manual handling of heavy cable reels', 'Pinch points at sheaves and bends', 'Elevated work on ladder to access tray', 'Electrical hazard from adjacent energized tray'],
      controls: ['Use tugger for cable pull — no manual pulling', 'Wear leather gloves during cable handling', 'Ladder secured and footed by helper', 'Verify adjacent trays de-energized or barricaded'],
      ppe: ['Hard Hat', 'Safety Glasses', 'Leather Gloves', 'Steel Toe Boots', 'High-Vis Vest'],
    }),
    foreman_id: PEOPLE.fm_rios, foreman_name: 'Jose Rios',
    foreman_approved_at: today + 'T06:50:00.000Z',
    crew_members: JSON.stringify([
      { id: PEOPLE.jw_torres, name: 'Miguel Torres', role_title: 'Journeyman Electrician' },
      { id: PEOPLE.helper_brown, name: 'Kevin Brown', role_title: 'Helper' },
    ]),
    jsa_number: 'JSA-2026-0043',
    task_id: 'task_cable_pull_tray5a',
  },

  // SCENARIO 3: NO JSA TODAY — Danny Williams assigned to megger test but hasn't done JSA
  // (no record created — this is intentional to test the "missing JSA" alert)

  // SCENARIO 4: Yesterday's JSAs (for history)
  {
    id: 'jsa_reyes_yesterday',
    person_id: PEOPLE.jw_reyes, person_name: 'Carlos Reyes',
    trade: 'Electrical', date: yesterday, status: 'active', mode: 'shared',
    form_data: JSON.stringify({
      task_description: 'Continue 2-inch RMC conduit run in Area 5 pipe rack',
      hazards: ['Working at heights', 'Hot piping adjacent', 'Overhead work by pipefitters'],
      controls: ['100% tie-off on scaffold', 'Hard barricade below work area', 'Coordinate with pipefitting foreman'],
      ppe: ['Hard Hat', 'Safety Glasses', 'Gloves', 'Harness', 'Steel Toes'],
    }),
    foreman_id: PEOPLE.fm_rios, foreman_name: 'Jose Rios',
    foreman_approved_at: yesterday + 'T06:40:00.000Z',
    crew_members: JSON.stringify([
      { id: PEOPLE.jw_reyes, name: 'Carlos Reyes', role_title: 'Journeyman Electrician' },
      { id: PEOPLE.helper_martinez, name: 'Pedro Martinez', role_title: 'Helper' },
    ]),
    jsa_number: 'JSA-2026-0038',
    task_id: 'task_conduit_2nd_floor',
  },
  {
    id: 'jsa_sanchez_yesterday',
    person_id: PEOPLE.jw_sanchez, person_name: 'Roberto Sanchez',
    trade: 'Electrical', date: yesterday, status: 'active', mode: 'shared',
    form_data: JSON.stringify({
      task_description: 'Continue ground grid Cadweld connections in Area 7',
      hazards: ['Open excavation — tripping/fall hazard', 'Cadweld exothermic reaction — burn hazard', 'Underground utilities adjacent', 'Weather — rain expected afternoon'],
      controls: ['Barricade excavations when unattended', 'Fire extinguisher at each Cadweld location', 'Pothole before digging near marked utilities', 'Monitor weather — stop Cadweld if rain starts'],
      ppe: ['Hard Hat', 'Safety Glasses', 'Leather Gloves', 'Face Shield for Cadweld', 'Steel Toe Boots', 'High-Vis Vest'],
    }),
    foreman_id: PEOPLE.fm_gutierrez, foreman_name: 'Luis Gutierrez',
    foreman_approved_at: yesterday + 'T06:45:00.000Z',
    crew_members: JSON.stringify([
      { id: PEOPLE.jw_sanchez, name: 'Roberto Sanchez', role_title: 'Journeyman Electrician' },
      { id: PEOPLE.helper_ramirez, name: 'Angel Ramirez', role_title: 'Helper' },
    ]),
    jsa_number: 'JSA-2026-0039',
    task_id: 'task_ground_grid',
  },

  // SCENARIO 5: Gutierrez crew — Roberto Sanchez today's JSA for ground grid
  {
    id: 'jsa_sanchez_today',
    person_id: PEOPLE.jw_sanchez, person_name: 'Roberto Sanchez',
    trade: 'Electrical', date: today, status: 'active', mode: 'shared',
    form_data: JSON.stringify({
      task_description: 'Complete final 4 Cadweld ground grid connections in Area 7',
      hazards: ['Open excavation', 'Cadweld exothermic reaction', 'Adjacent construction traffic', 'Buried utility markings faded'],
      controls: ['Re-mark utility locations before digging', 'Hard barricade all excavations', 'Spotter for equipment near excavation', 'Full face shield during Cadweld ignition'],
      ppe: ['Hard Hat', 'Safety Glasses', 'Leather Gloves', 'Face Shield', 'Steel Toe Boots', 'High-Vis Vest'],
    }),
    foreman_id: PEOPLE.fm_gutierrez, foreman_name: 'Luis Gutierrez',
    foreman_approved_at: today + 'T06:55:00.000Z',
    crew_members: JSON.stringify([
      { id: PEOPLE.jw_sanchez, name: 'Roberto Sanchez', role_title: 'Journeyman Electrician' },
      { id: PEOPLE.helper_ramirez, name: 'Angel Ramirez', role_title: 'Helper' },
    ]),
    jsa_number: 'JSA-2026-0044',
    task_id: 'task_ground_grid',
  },

  // SCENARIO 6: Delgado — panel terminations, today
  {
    id: 'jsa_delgado_today',
    person_id: PEOPLE.jw_delgado, person_name: 'Marco Delgado',
    trade: 'Electrical', date: today, status: 'active', mode: 'shared',
    form_data: JSON.stringify({
      task_description: 'Complete circuit terminations in Panel LP-3B — 12 remaining circuits',
      hazards: ['Adjacent energized panel LP-3A', 'Wire management — cuts from sharp conductors', 'Confined electrical room — limited egress'],
      controls: ['Verify LP-3B is de-energized and locked out', 'Maintain 3-foot clear space in front of LP-3A', 'Wear cut-resistant gloves when stripping conductors', 'Keep electrical room door open and unobstructed'],
      ppe: ['Hard Hat', 'Safety Glasses', 'Cut-Resistant Gloves', 'Steel Toe Boots'],
    }),
    foreman_id: PEOPLE.fm_rios, foreman_name: 'Jose Rios',
    foreman_approved_at: today + 'T06:48:00.000Z',
    crew_members: JSON.stringify([
      { id: PEOPLE.jw_delgado, name: 'Marco Delgado', role_title: 'Journeyman Electrician' },
    ]),
    jsa_number: 'JSA-2026-0045',
    task_id: 'task_panel_terminations',
  },

  // SCENARIO 7: Walker — lighting, no safety approval yet (pending)
  {
    id: 'jsa_walker_today',
    person_id: PEOPLE.jw_walker, person_name: 'James Walker',
    trade: 'Electrical', date: today, status: 'pending_safety', mode: 'shared',
    form_data: JSON.stringify({
      task_description: 'Continue temporary lighting installation Area 3',
      hazards: ['Working from ladder — fall hazard', 'Temporary electrical — shock hazard', 'SO cord routing — trip hazard for others'],
      controls: ['Ladder secured and footed', 'GFCI protection on all temp circuits', 'Route SO cord along walls, cover crossing points with cable ramps'],
      ppe: ['Hard Hat', 'Safety Glasses', 'Leather Gloves', 'Steel Toe Boots'],
    }),
    foreman_id: PEOPLE.fm_gutierrez, foreman_name: 'Luis Gutierrez',
    foreman_approved_at: today + 'T07:00:00.000Z',
    crew_members: JSON.stringify([
      { id: PEOPLE.jw_walker, name: 'James Walker', role_title: 'Journeyman Electrician' },
      { id: PEOPLE.helper_johnson, name: 'Tyler Johnson', role_title: 'Helper' },
    ]),
    jsa_number: 'JSA-2026-0046',
    task_id: 'task_lighting_area3',
  },
];

for (const j of jsas) {
  insertJsa.run(
    j.id, j.person_id, j.person_name, j.trade, j.date, j.status, j.mode,
    j.form_data, j.foreman_id, j.foreman_name, j.foreman_approved_at,
    j.crew_members, j.jsa_number, j.task_id, j.date + 'T06:30:00.000Z'
  );
}
console.log(`  Created ${jsas.length} JSAs`);

// Link JSAs to task days
const updateTaskDayJsa = db.prepare(`UPDATE task_days SET jsa_id = ? WHERE task_id = ? AND date = ?`);
updateTaskDayJsa.run('jsa_reyes_today', 'task_conduit_2nd_floor', today);
updateTaskDayJsa.run('jsa_reyes_yesterday', 'task_conduit_2nd_floor', yesterday);
updateTaskDayJsa.run('jsa_sanchez_yesterday', 'task_ground_grid', yesterday);
updateTaskDayJsa.run('jsa_sanchez_today', 'task_ground_grid', today);
console.log('  Linked JSAs to task days');

// ──────────────────────────────────────────
// 4. JSA ACKNOWLEDGMENTS
// ──────────────────────────────────────────
const insertAck = db.prepare(`
  INSERT OR REPLACE INTO jsa_acknowledgments
  (id, jsa_id, person_id, person_name, role_title, status, acknowledged_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

// Today's acknowledgments
const acks = [
  // Reyes crew signed
  { jsa: 'jsa_reyes_today', person: PEOPLE.jw_reyes, name: 'Carlos Reyes', role: 'Journeyman Electrician', status: 'signed' },
  { jsa: 'jsa_reyes_today', person: PEOPLE.helper_martinez, name: 'Pedro Martinez', role: 'Helper', status: 'signed' },
  // Torres crew signed
  { jsa: 'jsa_torres_today', person: PEOPLE.jw_torres, name: 'Miguel Torres', role: 'Journeyman Electrician', status: 'signed' },
  { jsa: 'jsa_torres_today', person: PEOPLE.helper_brown, name: 'Kevin Brown', role: 'Helper', status: 'signed' },
  // Delgado signed (solo)
  { jsa: 'jsa_delgado_today', person: PEOPLE.jw_delgado, name: 'Marco Delgado', role: 'Journeyman Electrician', status: 'signed' },
  // Sanchez crew signed
  { jsa: 'jsa_sanchez_today', person: PEOPLE.jw_sanchez, name: 'Roberto Sanchez', role: 'Journeyman Electrician', status: 'signed' },
  { jsa: 'jsa_sanchez_today', person: PEOPLE.helper_ramirez, name: 'Angel Ramirez', role: 'Helper', status: 'signed' },
  // Walker crew — signed but JSA still pending safety
  { jsa: 'jsa_walker_today', person: PEOPLE.jw_walker, name: 'James Walker', role: 'Journeyman Electrician', status: 'signed' },
  { jsa: 'jsa_walker_today', person: PEOPLE.helper_johnson, name: 'Tyler Johnson', role: 'Helper', status: 'signed' },
];

for (const a of acks) {
  insertAck.run(
    `ack_${a.jsa}_${a.person}`, a.jsa, a.person, a.name, a.role, a.status,
    a.status === 'signed' ? today + 'T06:50:00.000Z' : null,
    today + 'T06:30:00.000Z'
  );
}
console.log(`  Created ${acks.length} JSA acknowledgments`);

// ──────────────────────────────────────────
// 5. SAFETY ALERT — Danny Williams has no JSA
// ──────────────────────────────────────────
const insertMessage = db.prepare(`
  INSERT OR REPLACE INTO messages
  (id, from_id, from_name, to_id, content, type, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const safetyAlerts = [
  {
    to: PEOPLE.fm_gutierrez,
    msg: '⚠️ SAFETY ALERT: Danny Williams is assigned to "Megger test cables in Tray TR-5A" but has NO JSA for today. JSA required before work can begin.',
  },
  {
    to: PEOPLE.safety_santos,
    msg: '⚠️ SAFETY ALERT: Danny Williams (Journeyman Electrician, Gutierrez crew) has no JSA on file for today. Assigned task: Megger test cables in Tray TR-5A.',
  },
  {
    to: PEOPLE.jw_williams,
    msg: '⚠️ You have been assigned to "Megger test cables in Tray TR-5A" but you do not have a JSA for today. Please complete your JSA before starting work.',
  },
];

for (const alert of safetyAlerts) {
  insertMessage.run(
    `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    PEOPLE.safety_santos, 'Maria Santos (Safety)', alert.to, alert.msg, 'safety_alert',
    today + 'T07:15:00.000Z'
  );
}
console.log('  Created safety alert messages for missing JSA');

console.log('\n✅ Demo data seeded successfully!');
console.log('\nSCENARIOS TO TEST:');
console.log('  1. Carlos Reyes — Conduit run, 4 days, JSA matches task ✓');
console.log('  2. Miguel Torres — Cable pull, JSA says cable pulling but check if task changed');
console.log('  3. Danny Williams — Megger test assigned, NO JSA today ⚠️');
console.log('  4. Marco Delgado — Panel terminations, JSA matches ✓');
console.log('  5. Roberto Sanchez — Ground grid, 3 days of history, JSA matches ✓');
console.log('  6. David Chen — MCC installation, COMPLETED task with 3 days history');
console.log('  7. James Walker — Lighting, JSA pending safety approval ⏳');
console.log('  8. Helpers on JSAs — Pedro, Kevin, Angel, Tyler all signed crew JSAs');
console.log('  9. Safety alerts — Danny Williams missing JSA sent to foreman + safety + worker');
