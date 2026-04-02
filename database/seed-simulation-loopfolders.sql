SET search_path TO voicereport;

-- Company products (with explicit IDs)
INSERT INTO company_products (id, company_id, product, status) VALUES
  ('cp_gillis_vr', 'company_gillis', 'voice_report', 'active'),
  ('cp_gillis_rd', 'company_gillis', 'relation_data', 'active'),
  ('cp_bxp_vr', 'company_bxp_refinery', 'voice_report', 'active'),
  ('cp_bxp_rd', 'company_bxp_refinery', 'relation_data', 'active')
ON CONFLICT DO NOTHING;

-- Company trades (with explicit IDs)
INSERT INTO company_trades (id, company_id, trade, status) VALUES
  ('ct_gillis_inst', 'company_gillis', 'instrumentation', 'active'),
  ('ct_gillis_elec', 'company_gillis', 'electrical', 'active'),
  ('ct_bxp_inst', 'company_bxp_refinery', 'instrumentation', 'active'),
  ('ct_bxp_elec', 'company_bxp_refinery', 'electrical', 'active'),
  ('ct_bxp_pipe', 'company_bxp_refinery', 'pipe_fitting', 'active')
ON CONFLICT DO NOTHING;

-- PEOPLE — Gillis (with pin)
INSERT INTO people (id, name, pin, role_title, role_level, trade, status, company_id) VALUES
  ('person_gillis_lead_inst', 'Marcus Rivera', '5501', 'Lead Instrument Tech', 3, 'instrumentation', 'active', 'company_gillis'),
  ('person_gillis_tech1', 'David Chen', '5502', 'Instrument Technician', 2, 'instrumentation', 'active', 'company_gillis'),
  ('person_gillis_tech2', 'Carlos Mendez', '5503', 'Instrument Technician', 2, 'instrumentation', 'active', 'company_gillis'),
  ('person_gillis_tech3', 'James Wright', '5504', 'Calibration Specialist', 2, 'instrumentation', 'active', 'company_gillis'),
  ('person_gillis_elec_lead', 'Robert Okafor', '5505', 'Lead Electrician', 3, 'electrical', 'active', 'company_gillis'),
  ('person_gillis_elec1', 'Mike Patterson', '5506', 'Journeyman Electrician', 2, 'electrical', 'active', 'company_gillis'),
  ('person_gillis_elec2', 'Tony Reeves', '5507', 'Journeyman Electrician', 2, 'electrical', 'active', 'company_gillis'),
  ('person_gillis_safety', 'Linda Cho', '5508', 'Safety Coordinator', 2, 'safety', 'active', 'company_gillis')
ON CONFLICT (id) DO NOTHING;

-- PEOPLE — BXP (with pin)
INSERT INTO people (id, name, pin, role_title, role_level, trade, status, company_id) VALUES
  ('person_bxp_pm', 'Richard Hayes', '6601', 'Project Manager', 4, 'instrumentation', 'active', 'company_bxp_refinery'),
  ('person_bxp_lead_inst', 'Angela Torres', '6602', 'Lead Instrument Tech', 3, 'instrumentation', 'active', 'company_bxp_refinery'),
  ('person_bxp_tech1', 'Brian Kowalski', '6603', 'Instrument Technician', 2, 'instrumentation', 'active', 'company_bxp_refinery'),
  ('person_bxp_tech2', 'Sarah Mitchell', '6604', 'Instrument Technician', 2, 'instrumentation', 'active', 'company_bxp_refinery'),
  ('person_bxp_elec_lead', 'Derek Johnson', '6605', 'Lead Electrician', 3, 'electrical', 'active', 'company_bxp_refinery'),
  ('person_bxp_elec1', 'Kevin Nguyen', '6606', 'Journeyman Electrician', 2, 'electrical', 'active', 'company_bxp_refinery'),
  ('person_bxp_pipe_lead', 'Omar Ramirez', '6607', 'Lead Pipefitter', 3, 'pipe_fitting', 'active', 'company_bxp_refinery'),
  ('person_bxp_pipe1', 'Jake Williams', '6608', 'Journeyman Pipefitter', 2, 'pipe_fitting', 'active', 'company_bxp_refinery'),
  ('person_bxp_foreman', 'Steve Blackwood', '6609', 'General Foreman', 3, 'instrumentation', 'active', 'company_bxp_refinery'),
  ('person_bxp_safety', 'Maria Santos', '6610', 'Safety Coordinator', 2, 'safety', 'active', 'company_bxp_refinery')
ON CONFLICT (id) DO NOTHING;

-- REPORTS — Gillis (Sparks team + crew, real instrument tags from LoopFolders)
INSERT INTO reports (id, person_id, company_id, trade, created_at, transcript_raw, markdown_structured) VALUES
('rpt_gillis_pm_001', 'person_shannon', 'company_gillis', 'instrumentation', '2026-04-01 07:00:00',
 'Gillis Amine Plant commissioning kickoff. We have 76 loop folders to commission across 201A 201B and 201C sections. Ellery is running the field as superintendent. Tommy is general foreman coordinating the instrument and electrical crews. Ender is foreman on the instrument side Anthony is assisting. Our priority is the 201A absorber section first because startup is in two weeks.',
 '## Gillis Amine Plant — Commissioning Kickoff'),
('rpt_gillis_super_001', 'person_ellery_vargas', 'company_gillis', 'instrumentation', '2026-04-01 08:00:00',
 'Morning walkdown at Gillis. 201A section has the most instruments pressure transmitters 201A-PIT-2130-01 level instruments 201A-LIC-2130-01 and 201A-LIC-2130-02 and the full temperature array 201A-TIT-2131-01 through 201A-TIT-2131-06. I told Tommy to prioritize the safety instruments first the PSVs and LSHH switches. We need 201A-PSV-2130-01 201A-LSHH-2130-01 and 201A-LSHH-2130-02 done before anything else.',
 '## Field Direction — 201A Absorber Priorities'),
('rpt_gillis_gf_001', 'person_1774715685696', 'company_gillis', 'instrumentation', '2026-04-01 09:00:00',
 'Assigned David Chen to calibrate 201A-PIT-2130-01 pressure transmitter on the absorber. Carlos Mendez is doing the flow loop check on 201A-FIC-2101-01. James Wright is handling all six temperature thermocouples 201A-TIT-2131-01 through 201A-TIT-2131-06 on the regenerator. Robert Okafor electrical crew is pulling cables for the XV solenoid valves. Ender is supervising the instrument crew in the field. Anthony is running materials.',
 '## Crew Assignments — April 1 (Tommy)'),
('rpt_gillis_foreman_001', 'person_ender', 'company_gillis', 'instrumentation', '2026-04-01 14:00:00',
 'Status update from the field. David finished calibrating 201A-PIT-2130-01 as-found was 2.3 percent high adjusted per ISA standards as-left within 0.5 percent. Carlos completed the 201A-FIC-2101-01 loop check but found 201A-LIC-2130-01 has a sticky control valve tagged it out of service. James did all six TIT instruments five passed but 201A-TIT-2131-04 was reading 3 degrees low he replaced the thermocouple element. Anthony kept materials flowing all day.',
 '## Field Status — Ender reporting'),
('rpt_gillis_helper_001', 'person_anthony', 'company_gillis', 'instrumentation', '2026-04-01 15:30:00',
 'Delivered calibration equipment to David for 201A-PIT-2130-01 job this morning. Ran tubing fittings and gaskets to Carlos for 201A-FIC-2101-01 loop check. Picked up replacement thermocouple for James when 201A-TIT-2131-04 failed. Also brought cable reels to Robert electrical crew for solenoid valve wiring on 201A-XV-2130-03 and 201A-XV-2131-02.',
 '## Material Support Log — Anthony'),
('rpt_gillis_cal_001', 'person_gillis_tech1', 'company_gillis', 'instrumentation', '2026-04-01 08:30:00',
 'Calibrated pressure transmitter 201A-PIT-2130-01 on the amine absorber tower. As-found reading 2.3 percent high on 4-20mA output. Adjusted span and zero per ISA standards. As-left within 0.5 percent accuracy. Also checked 201A-PI-2130-01 gauge reading correctly.',
 '## Calibration — 201A-PIT-2130-01'),
('rpt_gillis_loop_001', 'person_gillis_tech2', 'company_gillis', 'instrumentation', '2026-04-01 09:15:00',
 'Completed loop check on 201A-FIC-2101-01 flow control loop. Verified 4-20mA signal from transmitter through DCS to control valve stroked 0 to 100 percent. Also tested 201A-LIC-2130-01 level control found sticky valve tagged out of service.',
 '## Loop Check — 201A-FIC-2101-01'),
('rpt_gillis_elec_001', 'person_gillis_elec_lead', 'company_gillis', 'electrical', '2026-04-01 15:00:00',
 'Electrical crew finished wiring for 201A section instruments. Pulled cables for 201A-XV-2130-03 solenoid valve and 201A-XV-2131-02 shutdown valve. Megger tested all new cables insulation resistance above 100 megohms. Terminations at marshalling cabinet complete.',
 '## Electrical Wiring — 201A Section')
ON CONFLICT (id) DO NOTHING;

-- REPORTS — BXP Refinery
INSERT INTO reports (id, person_id, company_id, trade, created_at, transcript_raw, markdown_structured) VALUES
('rpt_bxp_001', 'person_bxp_tech1', 'company_bxp_refinery', 'instrumentation', '2026-04-01 07:30:00',
 'Started work on BXP unit. Reviewing PID Combined 12-20-24 drawings 100 through 112. Identified 47 instruments that need calibration before startup.',
 '## BXP Project — Instrument Survey'),
('rpt_bxp_002', 'person_bxp_lead_inst', 'company_bxp_refinery', 'instrumentation', '2026-04-01 11:00:00',
 'KEELY project update reviewed Copeland PID drawings Rev 5. Drawings 10 11 13 17 and 23 processed through AI model. Checkmate has 4 drawings processed Grand Slam has 1. BXP is biggest scope with 54 of 147 drawings done.',
 '## Multi-Project Status'),
('rpt_bxp_003', 'person_bxp_pipe_lead', 'company_bxp_refinery', 'pipe_fitting', '2026-04-01 13:00:00',
 'Pipe crew completing tie-ins for BXP unit. Main headers done working on branch connections to instrument taps.',
 '## Pipe Fitting — BXP Unit'),
('rpt_bxp_004', 'person_bxp_pm', 'company_bxp_refinery', 'instrumentation', '2026-04-01 16:00:00',
 'End of day summary. Four active projects BXP KEELY Checkmate Grand Slam. Team of 10 across three trades. PID processing 69 of 222 total drawings processed.',
 '## BXP Refinery — Daily Summary')
ON CONFLICT (id) DO NOTHING;
