-- ============================================
-- Voice Report — Demo Seed Data
-- 4 Companies with realistic construction data
-- ============================================
SET search_path TO voicereport;

-- ============================================
-- COMPANIES
-- ============================================
INSERT INTO companies (id, name, slug, status, tier, notes, created_by) VALUES
  ('company_desert_valley', 'Desert Valley Contractors', 'desert-valley', 'active', 'professional', 'General contractor specializing in commercial builds in the Southwest', 'system'),
  ('company_pacific_mechanical', 'Pacific Mechanical Group', 'pacific-mechanical', 'active', 'enterprise', 'Full-service mechanical contractor — HVAC, plumbing, piping', 'system'),
  ('company_summit_electrical', 'Summit Electrical Services', 'summit-electrical', 'active', 'professional', 'Commercial and industrial electrical contractor', 'system'),
  ('company_ironclad_steel', 'Ironclad Steel & Welding', 'ironclad-steel', 'active', 'standard', 'Structural steel fabrication and field welding', 'system')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- COMPANY TRADES
-- ============================================
INSERT INTO company_trades (id, company_id, trade, status, licensed_by) VALUES
  ('ct_dv_gen', 'company_desert_valley', 'General', 'active', 'system'),
  ('ct_dv_concrete', 'company_desert_valley', 'Concrete', 'active', 'system'),
  ('ct_pm_hvac', 'company_pacific_mechanical', 'HVAC', 'active', 'system'),
  ('ct_pm_plumbing', 'company_pacific_mechanical', 'Plumbing', 'active', 'system'),
  ('ct_pm_piping', 'company_pacific_mechanical', 'Piping', 'active', 'system'),
  ('ct_se_electrical', 'company_summit_electrical', 'Electrical', 'active', 'system'),
  ('ct_se_instrumentation', 'company_summit_electrical', 'Instrumentation', 'active', 'system'),
  ('ct_is_steel', 'company_ironclad_steel', 'Structural Steel', 'active', 'system'),
  ('ct_is_welding', 'company_ironclad_steel', 'Welding', 'active', 'system')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- COMPANY PRODUCTS
-- ============================================
INSERT INTO company_products (id, company_id, product, status, licensed_by) VALUES
  ('cp_dv_reports', 'company_desert_valley', 'voice_reports', 'active', 'system'),
  ('cp_dv_forms', 'company_desert_valley', 'digital_forms', 'active', 'system'),
  ('cp_pm_reports', 'company_pacific_mechanical', 'voice_reports', 'active', 'system'),
  ('cp_pm_forms', 'company_pacific_mechanical', 'digital_forms', 'active', 'system'),
  ('cp_pm_ai', 'company_pacific_mechanical', 'ai_assistant', 'active', 'system'),
  ('cp_se_reports', 'company_summit_electrical', 'voice_reports', 'active', 'system'),
  ('cp_se_forms', 'company_summit_electrical', 'digital_forms', 'active', 'system'),
  ('cp_is_reports', 'company_ironclad_steel', 'voice_reports', 'active', 'system')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- TEMPLATES (role definitions per trade)
-- ============================================
INSERT INTO templates (id, template_name, role_level, role_level_title, trade, role_description, report_focus, output_sections, vocabulary, safety_rules, safety_vocabulary, tools_and_equipment, is_system, created_by) VALUES
  ('tmpl_gen_foreman', 'General Foreman', 3, 'Foreman', 'General', 'Oversees all general construction activities', 'Daily progress, crew coordination, material deliveries', '["Progress Summary","Safety Observations","Material Status","Crew Hours"]', '{}', '["Hard hat required at all times","Fall protection above 6ft"]', '[]', '[]', 1, 'platform'),
  ('tmpl_gen_worker', 'General Laborer', 1, 'Worker', 'General', 'Performs general construction labor tasks', 'Work completed, materials used, issues encountered', '["Work Summary","Safety Notes"]', '{}', '["Wear PPE at all times","Report hazards immediately"]', '[]', '[]', 1, 'platform'),
  ('tmpl_concrete_foreman', 'Concrete Foreman', 3, 'Foreman', 'Concrete', 'Manages concrete pours, formwork, and finishing', 'Pour schedules, mix designs, curing status', '["Pour Summary","Mix Design","Weather Conditions","Crew Report"]', '{}', '["Silica exposure controls","Wet concrete skin protection"]', '[]', '[]', 1, 'platform'),
  ('tmpl_hvac_foreman', 'HVAC Foreman', 3, 'Foreman', 'HVAC', 'Supervises HVAC installation and commissioning', 'Equipment installs, duct runs, startup status', '["Installation Progress","Equipment Status","Testing Results","Crew Hours"]', '{}', '["Lockout/tagout for all equipment","Refrigerant handling certification required"]', '[]', '[]', 1, 'platform'),
  ('tmpl_hvac_tech', 'HVAC Technician', 2, 'Journeyman', 'HVAC', 'Installs and services HVAC systems', 'Units installed, connections made, testing done', '["Work Completed","Materials Used","Issues"]', '{}', '["Verify power is off before working on units"]', '[]', '[]', 1, 'platform'),
  ('tmpl_plumbing_foreman', 'Plumbing Foreman', 3, 'Foreman', 'Plumbing', 'Manages plumbing installations and inspections', 'Pipe runs, fixture installs, pressure tests', '["Progress Summary","Inspection Status","Material Tracking"]', '{}', '["Trench safety required","Hot work permits for soldering"]', '[]', '[]', 1, 'platform'),
  ('tmpl_elec_foreman', 'Electrical Foreman', 3, 'Foreman', 'Electrical', 'Supervises electrical installations', 'Panel installs, wire pulls, circuit testing', '["Installation Progress","Testing Results","Crew Report","Material Status"]', '{}', '["LOTO mandatory","Arc flash PPE required"]', '[]', '[]', 1, 'platform'),
  ('tmpl_elec_journeyman', 'Electrical Journeyman', 2, 'Journeyman', 'Electrical', 'Performs electrical installations and terminations', 'Wire runs, terminations, conduit installed', '["Work Completed","Materials Used","Safety Notes"]', '{}', '["Test before touch","De-energize before work"]', '[]', '[]', 1, 'platform'),
  ('tmpl_steel_foreman', 'Steel Foreman', 3, 'Foreman', 'Structural Steel', 'Manages structural steel erection', 'Steel erected, bolted connections, crane operations', '["Erection Progress","Crane Log","Bolt-Up Status","Safety Report"]', '{}', '["100% tie-off above 6ft","Crane exclusion zones enforced"]', '[]', '[]', 1, 'platform'),
  ('tmpl_welder', 'Certified Welder', 2, 'Journeyman', 'Welding', 'Performs structural and pipe welding', 'Welds completed, procedures followed, NDE status', '["Weld Log","Procedure Summary","QC Notes"]', '{}', '["Fire watch required","Ventilation for confined spaces"]', '[]', '[]', 1, 'platform')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- PEOPLE — Desert Valley Contractors
-- ============================================
INSERT INTO people (id, name, pin, template_id, role_title, role_level, trade, status, company_id, sparks_role, experience, specialties) VALUES
  ('p_dv_mike', 'Mike Sandoval', '1001', 'tmpl_gen_foreman', 'General Foreman', 3, 'General', 'active', 'company_desert_valley', 'admin', '18 years in general construction', 'Commercial tenant improvements'),
  ('p_dv_carlos', 'Carlos Espinoza', '1002', 'tmpl_gen_worker', 'Laborer', 1, 'General', 'active', 'company_desert_valley', NULL, '5 years construction labor', 'Demolition, cleanup'),
  ('p_dv_james', 'James Whitfield', '1003', 'tmpl_concrete_foreman', 'Concrete Foreman', 3, 'Concrete', 'active', 'company_desert_valley', NULL, '12 years concrete work', 'Flatwork, tilt-up panels'),
  ('p_dv_rosa', 'Rosa Gutierrez', '1004', 'tmpl_gen_worker', 'Laborer', 1, 'General', 'active', 'company_desert_valley', NULL, '3 years', 'Form setting, rebar tying'),
  ('p_dv_tony', 'Tony Reyes', '1005', 'tmpl_gen_worker', 'Laborer', 1, 'Concrete', 'active', 'company_desert_valley', NULL, '7 years', 'Finishing, stamped concrete')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- PEOPLE — Pacific Mechanical Group
-- ============================================
INSERT INTO people (id, name, pin, template_id, role_title, role_level, trade, status, company_id, sparks_role, experience, specialties) VALUES
  ('p_pm_dave', 'Dave Nakamura', '2001', 'tmpl_hvac_foreman', 'HVAC Foreman', 3, 'HVAC', 'active', 'company_pacific_mechanical', 'admin', '20 years HVAC', 'Chiller plants, rooftop units'),
  ('p_pm_sarah', 'Sarah Chen', '2002', 'tmpl_hvac_tech', 'HVAC Technician', 2, 'HVAC', 'active', 'company_pacific_mechanical', NULL, '6 years HVAC install', 'Ductwork, controls'),
  ('p_pm_luis', 'Luis Morales', '2003', 'tmpl_plumbing_foreman', 'Plumbing Foreman', 3, 'Plumbing', 'active', 'company_pacific_mechanical', NULL, '15 years plumbing', 'Medical gas, backflow prevention'),
  ('p_pm_kevin', 'Kevin Park', '2004', 'tmpl_hvac_tech', 'HVAC Technician', 2, 'HVAC', 'active', 'company_pacific_mechanical', NULL, '4 years', 'Refrigerant piping, brazing'),
  ('p_pm_maria', 'Maria Vasquez', '2005', 'tmpl_gen_worker', 'Plumber Helper', 1, 'Plumbing', 'active', 'company_pacific_mechanical', NULL, '2 years', 'Pipe cutting, hangers')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- PEOPLE — Summit Electrical Services
-- ============================================
INSERT INTO people (id, name, pin, template_id, role_title, role_level, trade, status, company_id, sparks_role, experience, specialties) VALUES
  ('p_se_brian', 'Brian Thompson', '3001', 'tmpl_elec_foreman', 'Electrical Foreman', 3, 'Electrical', 'active', 'company_summit_electrical', 'admin', '22 years electrical', 'Switchgear, medium voltage'),
  ('p_se_jenny', 'Jenny Alvarez', '3002', 'tmpl_elec_journeyman', 'Electrician', 2, 'Electrical', 'active', 'company_summit_electrical', NULL, '8 years', 'Conduit bending, panel wiring'),
  ('p_se_omar', 'Omar Fayed', '3003', 'tmpl_elec_journeyman', 'Electrician', 2, 'Electrical', 'active', 'company_summit_electrical', NULL, '10 years', 'Fire alarm, low voltage'),
  ('p_se_derek', 'Derek Williams', '3004', 'tmpl_elec_journeyman', 'Apprentice', 1, 'Electrical', 'active', 'company_summit_electrical', NULL, '2 years apprentice', 'Wire pulling, box installation'),
  ('p_se_anna', 'Anna Kowalski', '3005', 'tmpl_elec_journeyman', 'Electrician', 2, 'Instrumentation', 'active', 'company_summit_electrical', NULL, '6 years instrumentation', 'PLC wiring, calibration')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- PEOPLE — Ironclad Steel & Welding
-- ============================================
INSERT INTO people (id, name, pin, template_id, role_title, role_level, trade, status, company_id, sparks_role, experience, specialties) VALUES
  ('p_is_frank', 'Frank Morrison', '4001', 'tmpl_steel_foreman', 'Steel Foreman', 3, 'Structural Steel', 'active', 'company_ironclad_steel', 'admin', '25 years ironworker', 'High-rise erection, crane signals'),
  ('p_is_ray', 'Ray Dominguez', '4002', 'tmpl_welder', 'Certified Welder', 2, 'Welding', 'active', 'company_ironclad_steel', NULL, '14 years welding', 'SMAW, FCAW, structural joints'),
  ('p_is_tommy', 'Tommy Nguyen', '4003', 'tmpl_welder', 'Certified Welder', 2, 'Welding', 'active', 'company_ironclad_steel', NULL, '9 years', 'Pipe welding, TIG'),
  ('p_is_jake', 'Jake Henderson', '4004', 'tmpl_gen_worker', 'Ironworker', 1, 'Structural Steel', 'active', 'company_ironclad_steel', NULL, '4 years', 'Bolting, plumbing columns')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- PROJECTS
-- ============================================
INSERT INTO projects (id, name, trade, owner_id, description, color, status, company_id) VALUES
  ('proj_dv_mesa', 'Mesa Business Park - Bldg C', 'General', 'p_dv_mike', 'New 40,000 sqft commercial office build', '#F99440', 'active', 'company_desert_valley'),
  ('proj_dv_school', 'Chandler Elementary Renovation', 'Concrete', 'p_dv_james', 'Summer renovation — new sidewalks, ADA ramps', '#4A90D9', 'active', 'company_desert_valley'),
  ('proj_pm_hospital', 'St. Mary Hospital Wing B', 'HVAC', 'p_pm_dave', 'Mechanical systems for 3-story hospital expansion', '#E74C3C', 'active', 'company_pacific_mechanical'),
  ('proj_pm_hotel', 'Marriott Downtown Remodel', 'Plumbing', 'p_pm_luis', 'Plumbing retrofit — 120 rooms, new risers', '#27AE60', 'active', 'company_pacific_mechanical'),
  ('proj_se_datacenter', 'CloudPeak Data Center', 'Electrical', 'p_se_brian', '2MW electrical distribution and backup power', '#9B59B6', 'active', 'company_summit_electrical'),
  ('proj_is_warehouse', 'Amazon Fulfillment Center', 'Structural Steel', 'p_is_frank', 'Steel erection — 200,000 sqft warehouse', '#E67E22', 'active', 'company_ironclad_steel')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- PROJECT MEMBERS
-- ============================================
INSERT INTO project_members (project_id, person_id, role) VALUES
  ('proj_dv_mesa', 'p_dv_mike', 'foreman'),
  ('proj_dv_mesa', 'p_dv_carlos', 'member'),
  ('proj_dv_mesa', 'p_dv_rosa', 'member'),
  ('proj_dv_school', 'p_dv_james', 'foreman'),
  ('proj_dv_school', 'p_dv_tony', 'member'),
  ('proj_pm_hospital', 'p_pm_dave', 'foreman'),
  ('proj_pm_hospital', 'p_pm_sarah', 'member'),
  ('proj_pm_hospital', 'p_pm_kevin', 'member'),
  ('proj_pm_hotel', 'p_pm_luis', 'foreman'),
  ('proj_pm_hotel', 'p_pm_maria', 'member'),
  ('proj_se_datacenter', 'p_se_brian', 'foreman'),
  ('proj_se_datacenter', 'p_se_jenny', 'member'),
  ('proj_se_datacenter', 'p_se_omar', 'member'),
  ('proj_se_datacenter', 'p_se_derek', 'member'),
  ('proj_se_datacenter', 'p_se_anna', 'member'),
  ('proj_is_warehouse', 'p_is_frank', 'foreman'),
  ('proj_is_warehouse', 'p_is_ray', 'member'),
  ('proj_is_warehouse', 'p_is_tommy', 'member'),
  ('proj_is_warehouse', 'p_is_jake', 'member')
ON CONFLICT (project_id, person_id) DO NOTHING;

-- ============================================
-- DAILY PLANS
-- ============================================
INSERT INTO daily_plans (id, date, created_by, trade, notes) VALUES
  ('dp_dv_0328', '2026-03-28', 'p_dv_mike', 'General', 'Framing 2nd floor east wing, drywall delivery at 10am'),
  ('dp_dv_0329', '2026-03-29', 'p_dv_mike', 'General', 'Continue framing, start MEP rough-in coordination'),
  ('dp_pm_0328', '2026-03-28', 'p_pm_dave', 'HVAC', 'AHU-3 rigging to roof, duct tie-ins on 2nd floor'),
  ('dp_pm_0329', '2026-03-29', 'p_pm_dave', 'HVAC', 'Start AHU-3 connections, refrigerant piping 3rd floor'),
  ('dp_se_0328', '2026-03-28', 'p_se_brian', 'Electrical', 'Pull feeders to MDP-2, mount panels in server room'),
  ('dp_is_0328', '2026-03-28', 'p_is_frank', 'Structural Steel', 'Erect columns grid D-F, bolt beam connections')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- DAILY PLAN TASKS
-- ============================================
INSERT INTO daily_plan_tasks (id, plan_id, assigned_to, title, description, status, priority, trade, location) VALUES
  ('dpt_dv_01', 'dp_dv_0328', 'p_dv_carlos', 'Frame east wall section 4-7', 'Metal studs, 10ft walls, fire-rated assembly', 'completed', 'high', 'General', '2nd Floor East'),
  ('dpt_dv_02', 'dp_dv_0328', 'p_dv_rosa', 'Unload and stage drywall delivery', '200 sheets 5/8 Type X, stage at freight elevator', 'completed', 'normal', 'General', 'Loading Dock'),
  ('dpt_dv_03', 'dp_dv_0329', 'p_dv_carlos', 'Frame east wall section 8-11', 'Continue metal stud framing, complete by EOD', 'pending', 'high', 'General', '2nd Floor East'),
  ('dpt_pm_01', 'dp_pm_0328', 'p_pm_sarah', 'Install duct mains 2nd floor zone 3', '24x12 rectangular main duct, 80 linear ft', 'completed', 'high', 'HVAC', '2nd Floor Zone 3'),
  ('dpt_pm_02', 'dp_pm_0328', 'p_pm_kevin', 'Braze refrigerant lines AHU-3', '2-1/8 suction, 7/8 liquid line from condenser', 'in_progress', 'high', 'HVAC', 'Roof / Mech Room'),
  ('dpt_pm_03', 'dp_pm_0328', 'p_pm_maria', 'Install waste piping room 204-210', '4" cast iron waste, 2" copper vents', 'completed', 'normal', 'Plumbing', '2nd Floor Rooms 204-210'),
  ('dpt_se_01', 'dp_se_0328', 'p_se_jenny', 'Pull 500MCM feeders to MDP-2', '4 runs of 500MCM copper, 200ft each', 'completed', 'high', 'Electrical', 'Electrical Room B'),
  ('dpt_se_02', 'dp_se_0328', 'p_se_omar', 'Mount panels PP-1 through PP-4', '42-space panels, server room wall', 'completed', 'normal', 'Electrical', 'Server Room 101'),
  ('dpt_se_03', 'dp_se_0328', 'p_se_derek', 'Run EMT conduit server room racks', '3/4" and 1" EMT to cable tray', 'in_progress', 'normal', 'Electrical', 'Server Room 101'),
  ('dpt_is_01', 'dp_is_0328', 'p_is_ray', 'Weld column splices grid D-E', 'CJP welds per AWS D1.1, 4 splices', 'completed', 'high', 'Welding', 'Grid D-E'),
  ('dpt_is_02', 'dp_is_0328', 'p_is_tommy', 'Weld beam connections grid E-F', 'Moment connections, 6 joints', 'in_progress', 'high', 'Welding', 'Grid E-F'),
  ('dpt_is_03', 'dp_is_0328', 'p_is_jake', 'Bolt beam clips and kickers', 'Snug-tight per spec, torque tomorrow', 'completed', 'normal', 'Structural Steel', 'Grid D-F')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- REPORTS
-- ============================================
INSERT INTO reports (id, person_id, person_name, role_title, template_id, trade, project_id, status, created_at, duration_seconds, transcript_raw, markdown_structured, company_id) VALUES
  ('rpt_dv_01', 'p_dv_mike', 'Mike Sandoval', 'General Foreman', 'tmpl_gen_foreman', 'General', 'proj_dv_mesa', 'complete', '2026-03-28 16:30:00', 185,
   'We finished framing the east wing second floor today, sections 4 through 7. Carlos and his crew knocked it out ahead of schedule. Drywall delivery came at 10, Rosa got it all staged by the freight elevator. No safety issues. Tomorrow we continue framing sections 8 through 11 and start coordinating with Pacific Mechanical for the rough-in.',
   '## Daily Report — March 28, 2026\n\n### Progress Summary\n- Completed metal stud framing sections 4-7, 2nd floor east wing\n- Drywall delivery received and staged (200 sheets 5/8" Type X)\n\n### Crew Hours\n- Carlos Espinoza: 8 hrs — framing\n- Rosa Gutierrez: 8 hrs — material handling\n\n### Safety Observations\n- No incidents or near-misses\n- All PPE compliance verified\n\n### Tomorrow\n- Continue framing sections 8-11\n- Coordinate MEP rough-in with Pacific Mechanical',
   'company_desert_valley'),

  ('rpt_pm_01', 'p_pm_dave', 'Dave Nakamura', 'HVAC Foreman', 'tmpl_hvac_foreman', 'HVAC', 'proj_pm_hospital', 'complete', '2026-03-28 17:00:00', 240,
   'Big day today. We rigged AHU-3 to the roof, went smooth, crane was on site from 7 to noon. Sarah finished the main duct runs on second floor zone 3, about 80 feet of 24 by 12 rectangular. Kevin started the refrigerant piping from the condenser down to the mech room, he is about 60 percent done with the brazing. One safety note, we had to stop work for 20 minutes because the fire watch guy did not show up on time for Kevin hot work permit.',
   '## Daily Report — March 28, 2026\n\n### Installation Progress\n- AHU-3 successfully rigged to roof (crane op 7am-12pm)\n- 80 LF rectangular duct installed, 2nd floor zone 3\n- Refrigerant piping 60% complete (AHU-3 to condenser)\n\n### Equipment Status\n- AHU-3: Set on roof, ready for connections\n- Condenser: In place, piping in progress\n\n### Safety\n- **Near-miss**: Fire watch late for hot work permit — 20 min delay\n- Action: Reminded crew lead to confirm fire watch before starting\n\n### Crew Hours\n- Sarah Chen: 8 hrs — ductwork\n- Kevin Park: 8 hrs — refrigerant piping\n- Crane operator: 5 hrs',
   'company_pacific_mechanical'),

  ('rpt_se_01', 'p_se_brian', 'Brian Thompson', 'Electrical Foreman', 'tmpl_elec_foreman', 'Electrical', 'proj_se_datacenter', 'complete', '2026-03-28 16:45:00', 195,
   'Good progress on the data center today. Jenny and her guys pulled all four runs of 500 MCM feeders to MDP-2, about 200 feet each run. That is a big milestone, we can start terminations Monday. Omar mounted panels PP-1 through PP-4 in the server room. Derek is running conduit from the panels to the cable tray, he should finish Monday morning. No safety issues, everyone had their arc flash PPE.',
   '## Daily Report — March 28, 2026\n\n### Installation Progress\n- 4x 500MCM feeder runs complete to MDP-2 (200ft ea)\n- Panels PP-1 through PP-4 mounted in server room\n- EMT conduit to cable tray — 70% complete\n\n### Testing Results\n- Megger test on feeders: PASS (all 4 runs >1000 MΩ)\n\n### Crew Report\n- Jenny Alvarez: 8 hrs — feeder pulls\n- Omar Fayed: 8 hrs — panel mounting\n- Derek Williams: 8 hrs — conduit\n- Anna Kowalski: Off (scheduled for instrumentation next week)\n\n### Material Status\n- Panel breakers on order, ETA Wednesday',
   'company_summit_electrical'),

  ('rpt_is_01', 'p_is_frank', 'Frank Morrison', 'Steel Foreman', 'tmpl_steel_foreman', 'Structural Steel', 'proj_is_warehouse', 'complete', '2026-03-28 15:30:00', 160,
   'Erected 6 columns on grid D through F today and set 4 beams. Ray finished the column splice welds, all CJP per AWS D1.1. Tommy is working on the moment connections at E-F, got 3 of 6 done. Jake bolted all the clips and kickers, will torque-verify tomorrow. Crane worked great, no swing issues. 100 percent tie-off all day, no safety concerns.',
   '## Daily Report — March 28, 2026\n\n### Erection Progress\n- 6 columns erected (grid D-F)\n- 4 beams set and connected\n\n### Weld Log\n- Ray: 4 CJP column splices — complete\n- Tommy: 3/6 moment connections — in progress\n\n### Bolt-Up Status\n- All clips and kickers snug-tight\n- Torque verification scheduled tomorrow\n\n### Crane Log\n- 80-ton mobile crane, 8 hrs\n- No swing or rigging issues\n\n### Safety\n- 100% tie-off compliance\n- No incidents',
   'company_ironclad_steel')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- MESSAGES
-- ============================================
INSERT INTO messages (id, from_id, to_id, from_name, to_name, type, content, created_at) VALUES
  ('msg_01', 'p_dv_mike', 'p_dv_james', 'Mike Sandoval', 'James Whitfield', 'text', 'James, the concrete pour for the ADA ramps at Chandler Elementary is scheduled for Wednesday. Make sure we have the 4000 PSI mix on order and the finishers confirmed.', '2026-03-28 07:15:00'),
  ('msg_02', 'p_dv_james', 'p_dv_mike', 'James Whitfield', 'Mike Sandoval', 'text', 'Copy that Mike. Mix is ordered, 12 yards. Got Tony and two finishers confirmed. We will need barricades for the sidewalk closure, can you coordinate with the school?', '2026-03-28 07:22:00'),
  ('msg_03', 'p_pm_dave', 'p_pm_luis', 'Dave Nakamura', 'Luis Morales', 'text', 'Luis, we need to coordinate the 2nd floor ceiling space. My duct mains are going in zone 3 this week — can your waste piping crew work zone 4 so we do not conflict?', '2026-03-28 06:45:00'),
  ('msg_04', 'p_pm_luis', 'p_pm_dave', 'Luis Morales', 'Dave Nakamura', 'text', 'Good call Dave. We will shift to zone 4 starting tomorrow. Maria is almost done with waste piping in 204-210 anyway. Let me know when zone 3 duct is done and we will follow behind with the vents.', '2026-03-28 06:52:00'),
  ('msg_05', 'p_se_brian', 'p_se_jenny', 'Brian Thompson', 'Jenny Alvarez', 'text', 'Great work on the feeder pulls today Jenny. Monday we start terminations on MDP-2 — bring your torque wrench and megger.', '2026-03-28 17:10:00'),
  ('msg_06', 'p_is_frank', 'p_is_ray', 'Frank Morrison', 'Ray Dominguez', 'text', 'Ray, the inspector wants to see your CJP welds on grid D-E Monday morning. Have your WPS and daily logs ready. Good work today.', '2026-03-28 16:00:00'),
  ('msg_07', 'p_is_ray', 'p_is_frank', 'Ray Dominguez', 'Frank Morrison', 'text', 'Will do boss. All my paperwork is up to date. Preheat logs, interpass temps, everything per the WPS. We will be ready.', '2026-03-28 16:15:00')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- PUNCH ITEMS
-- ============================================
INSERT INTO punch_items (id, title, description, location, trade, status, priority, created_by, assigned_to, company_id) VALUES
  ('pi_dv_01', 'Drywall gap at column wrap', 'Gap between drywall and column wrap at grid B-3, needs fire caulk', '2nd Floor, Grid B-3', 'General', 'open', 'high', 'p_dv_mike', 'p_dv_carlos', 'company_desert_valley'),
  ('pi_dv_02', 'Missing fire extinguisher station 2E', 'Extinguisher cabinet installed but extinguisher not placed', '2nd Floor East Corridor', 'General', 'open', 'normal', 'p_dv_mike', 'p_dv_rosa', 'company_desert_valley'),
  ('pi_pm_01', 'Condensate drain not connected AHU-1', 'AHU-1 condensate drain pipe stubbed but not connected to floor drain', 'Mechanical Room 2nd Floor', 'HVAC', 'open', 'high', 'p_pm_dave', 'p_pm_sarah', 'company_pacific_mechanical'),
  ('pi_pm_02', 'Insulation missing on chilled water return', '3 ft section of insulation missing on CHW return near valve V-12', '3rd Floor Ceiling', 'HVAC', 'open', 'normal', 'p_pm_dave', 'p_pm_kevin', 'company_pacific_mechanical'),
  ('pi_pm_03', 'Backflow preventer test overdue', 'Annual test due, need certified tester on site', 'Mechanical Room 1st Floor', 'Plumbing', 'open', 'high', 'p_pm_luis', 'p_pm_luis', 'company_pacific_mechanical'),
  ('pi_se_01', 'Label missing on panels PP-2, PP-3', 'Circuit directory not filled out, NEC violation', 'Server Room 101', 'Electrical', 'open', 'normal', 'p_se_brian', 'p_se_omar', 'company_summit_electrical'),
  ('pi_se_02', 'Ground rod resistance too high', 'Measured 28 ohms, spec requires <25 ohms. Need additional rod.', 'Building Exterior NE Corner', 'Electrical', 'open', 'high', 'p_se_brian', 'p_se_jenny', 'company_summit_electrical'),
  ('pi_is_01', 'Touch-up paint needed grid D columns', 'Fireproofing damaged during erection, needs touch-up before inspection', 'Grid D Columns, All Levels', 'Structural Steel', 'open', 'normal', 'p_is_frank', 'p_is_jake', 'company_ironclad_steel')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- COMPANY SETTINGS
-- ============================================
INSERT INTO company_settings (company_id, company_name, active_role_levels) VALUES
  ('company_desert_valley', 'Desert Valley Contractors', '[1,2,3]'),
  ('company_pacific_mechanical', 'Pacific Mechanical Group', '[1,2,3]'),
  ('company_summit_electrical', 'Summit Electrical Services', '[1,2,3]'),
  ('company_ironclad_steel', 'Ironclad Steel & Welding', '[1,2,3]')
ON CONFLICT DO NOTHING;

-- ============================================
-- SUBSCRIPTIONS
-- ============================================
INSERT INTO company_subscriptions (id, company_id, plan_id, status, started_at, current_period_start, current_period_end, next_billing_date) VALUES
  ('sub_desert_valley', 'company_desert_valley', 'plan_professional', 'active', '2026-01-15', '2026-03-15', '2026-04-14', '2026-04-15'),
  ('sub_pacific_mech', 'company_pacific_mechanical', 'plan_enterprise', 'active', '2025-06-01', '2026-03-01', '2026-03-31', '2026-04-01'),
  ('sub_summit_elec', 'company_summit_electrical', 'plan_professional', 'active', '2026-02-01', '2026-03-01', '2026-03-31', '2026-04-01'),
  ('sub_ironclad', 'company_ironclad_steel', 'plan_starter', 'active', '2026-03-01', '2026-03-01', '2026-03-31', '2026-04-01')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- SAFETY OBSERVATIONS
-- ============================================
INSERT INTO safety_observations (id, person_id, person_name, type, severity, description, location, status, created_at) VALUES
  ('so_01', 'p_dv_mike', 'Mike Sandoval', 'positive', 'low', 'All crew wearing hard hats and safety vests during drywall delivery unloading', 'Loading Dock', 'open', '2026-03-28 10:30:00'),
  ('so_02', 'p_pm_dave', 'Dave Nakamura', 'near_miss', 'medium', 'Fire watch not present when hot work began on refrigerant brazing. Stopped work immediately, waited 20 min for fire watch to arrive.', 'Roof', 'resolved', '2026-03-28 09:15:00'),
  ('so_03', 'p_se_brian', 'Brian Thompson', 'positive', 'low', 'Entire crew had correct arc flash PPE during feeder pull. Good job.', 'Electrical Room B', 'open', '2026-03-28 14:00:00'),
  ('so_04', 'p_is_frank', 'Frank Morrison', 'positive', 'low', '100% tie-off compliance all day during steel erection. Zero safety violations.', 'Grid D-F', 'open', '2026-03-28 15:00:00')
ON CONFLICT (id) DO NOTHING;
