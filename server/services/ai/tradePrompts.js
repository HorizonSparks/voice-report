/**
 * Trade-specific Whisper vocabulary prompts.
 * Extracted from ai.js for maintainability.
 */
const DB = require('../../../database/db');

const TRADE_WHISPER_PROMPTS = {
  electrical: 'Construction electrical work: cable tray, conduit, EMT, RGS, IMC, PVC, raceway, pull wire, Cadweld, megger, switchgear, panelboard, MCC, transformer, junction box, J-box, NEC, OSHA, JSA, PPE, scaffold, cable tray support, trapeze hanger, Unistrut, strut, threader, bender, knockout, LB, condulet, wire pull, fish tape, cable rack, ladder tray, trough, nipple, coupling, connector, ground rod, ground grid, busbar, breaker, disconnect, motor starter, VFD, lug, termination, splice, heat shrink, torque wrench, interlock.',
  instrumentation: 'Construction instrumentation and controls work: transmitter, transducer, thermocouple, RTD, resistance temperature detector, control valve, positioner, I/P converter, 4-20 milliamp, HART, Foundation Fieldbus, DCS, PLC, loop check, loop diagram, loop sheet, calibration, calibrator, Beamex, Fluke, zero, span, as-found, as-left, tuning, PID, thermowell, manifold, impulse line, pressure test, orifice plate, magnetic flow meter, Coriolis, vortex, radar level, level transmitter, pressure transmitter, temperature transmitter, differential pressure, DP, instrument air, pneumatic, solenoid valve, limit switch, proximity switch, junction box, J-box, marshalling cabinet, intrinsically safe, IS barrier, zener barrier, cable tray, conduit, instrument tubing, Swagelok, compression fitting, tube bender, flare fitting, tag number, nameplate, P&ID, ISA, NEC, OSHA, JSA, PPE.',
  pipe_fitting: 'Construction pipe fitting work: pipe spool, flange, elbow, tee, reducer, coupling, union, nipple, weld, butt weld, socket weld, threaded, pipe hanger, pipe support, spring hanger, strut, Unistrut, pipe clamp, U-bolt, pipe rack, hydrostatic test, hydrotest, pneumatic test, pressure test, NDE, radiograph, dye penetrant, magnetic particle, weld map, fit-up, tack weld, root pass, hot pass, cap, purge, GTAW, TIG, SMAW, stick weld, FCAW, pipe schedule, wall thickness, carbon steel, stainless steel, alloy, chrome-moly, gasket, spiral wound gasket, ring joint, bolt torque, flange bolt-up, pipe bender, pipe cutter, beveling machine, OSHA, JSA, PPE.',
  safety: 'Construction safety observation: JSA, JHA, job safety analysis, job hazard analysis, PPE, personal protective equipment, hard hat, safety glasses, gloves, fall protection, harness, lanyard, anchor point, scaffold, guardrail, barricade, LOTO, lockout tagout, confined space, permit, hot work, fire watch, fire extinguisher, first aid, near miss, incident, OSHA, toolbox talk, safety stand-down, SWA, stop work authority.',
  default: 'Construction work: conduit, cable tray, pipe, valve, transmitter, instrument, wire, panel, transformer, scaffold, JSA, PPE, OSHA, safety, harness, NEC.',
};

async function getTradeWhisperPrompt(personId) {
  if (!personId) return TRADE_WHISPER_PROMPTS.default;
  try {
    const person = await DB.people.getById(personId);
    if (!person || !person.trade) return TRADE_WHISPER_PROMPTS.default;
    const tradeKey = person.trade.toLowerCase().replace(/[\s-]+/g, '_');
    return TRADE_WHISPER_PROMPTS[tradeKey] || TRADE_WHISPER_PROMPTS.default;
  } catch (err) {
    console.error('Trade lookup for Whisper prompt failed:', err.message);
    return TRADE_WHISPER_PROMPTS.default;
  }
}

module.exports = { TRADE_WHISPER_PROMPTS, getTradeWhisperPrompt };
