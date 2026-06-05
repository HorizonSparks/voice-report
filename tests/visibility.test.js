/**
 * CHAIN-OF-COMMAND VISIBILITY — regression guard for the Voice Report permission model.
 *
 * Locks Ellery's four rules against the ACTUAL report_visibility builder so we never
 * silently regress (or re-derive) them. See VR_CHAIN_OF_COMMAND_CANONICAL.md.
 *   Rule 2/3  SEE-DOWN, never up, all the way down.
 *   Rule 1    SAME-TEAM peers (workers under one foreman) see each other; different teams don't.
 *   Rule 4    Messaging is ANCESTOR-only (a supervisor may read/send a subordinate's messages;
 *             PEERS may NOT) — enforced by messages.js isAncestorOf(), deliberately NOT
 *             report_visibility (which now also carries the Rule-1 peer edges). v2 chat uses
 *             canMessage. (Route-level coverage is a follow-up; see Codex note E1.)
 *
 * Pure logic: the real DB.people._rebuildAllVisibility runs against a mock pool that returns
 * the org tree and captures every (person_id, viewer_id) edge. No real database.
 */
const DB = require('../database/db');

// Mock pool: serves the people SELECT, captures report_visibility INSERTs.
function makePool(people) {
  const edges = [];
  return {
    edges,
    query: async (sql, params) => {
      if (/DELETE FROM report_visibility/i.test(sql)) return { rows: [] };
      if (/FROM people/i.test(sql) && /SELECT id, supervisor_id, role_level/i.test(sql)) {
        return { rows: people };
      }
      if (/INSERT INTO report_visibility/i.test(sql)) {
        edges.push({ person_id: params[0], viewer_id: params[1] });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

describe('Voice Report chain-of-command visibility (report_visibility)', () => {
  // gf(4) -> f1(3), f2(3);  f1 -> j1(2), j2(2);  f2 -> j3(2)
  const people = [
    { id: 'gf', supervisor_id: null, role_level: 4, status: 'active' },
    { id: 'f1', supervisor_id: 'gf', role_level: 3, status: 'active' },
    { id: 'f2', supervisor_id: 'gf', role_level: 3, status: 'active' },
    { id: 'j1', supervisor_id: 'f1', role_level: 2, status: 'active' },
    { id: 'j2', supervisor_id: 'f1', role_level: 2, status: 'active' },
    { id: 'j3', supervisor_id: 'f2', role_level: 2, status: 'active' },
  ];
  let sees; // sees(viewer, person) -> can `viewer` see `person`'s reports?

  beforeAll(async () => {
    const pool = makePool(people);
    await DB.people._rebuildAllVisibility.call({ _pool: pool });
    const set = new Set(pool.edges.map((e) => `${e.viewer_id}->${e.person_id}`));
    sees = (viewer, person) => set.has(`${viewer}->${person}`);
  });

  test('everyone sees their own reports', () => {
    for (const p of people) expect(sees(p.id, p.id)).toBe(true);
  });

  test('SEE-DOWN: a foreman sees his crew, a GF sees all the way down', () => {
    expect(sees('f1', 'j1')).toBe(true);
    expect(sees('f1', 'j2')).toBe(true);
    expect(sees('gf', 'f1')).toBe(true);
    expect(sees('gf', 'j1')).toBe(true);
    expect(sees('gf', 'j3')).toBe(true);
  });

  test('NEVER UP: a journeyman cannot see his foreman or the GF', () => {
    expect(sees('j1', 'f1')).toBe(false);
    expect(sees('j1', 'gf')).toBe(false);
    expect(sees('f1', 'gf')).toBe(false);
  });

  test('SAME-TEAM PEERS: journeymen under the same foreman see each other', () => {
    expect(sees('j1', 'j2')).toBe(true);
    expect(sees('j2', 'j1')).toBe(true);
  });

  test('DIFFERENT TEAMS: journeymen under different foremen cannot see each other', () => {
    expect(sees('j1', 'j3')).toBe(false);
    expect(sees('j3', 'j1')).toBe(false);
  });

  test('peer foremen (separate crews under one GF) do NOT see each other', () => {
    expect(sees('f1', 'f2')).toBe(false);
    expect(sees('f2', 'f1')).toBe(false);
  });
});

describe('Incremental rebuild on create (_rebuildVisibility)', () => {
  // Existing crew: gf -> f1 -> j1(active worker). A NEW worker j2 joins under f1.
  const peopleById = {
    gf: { id: 'gf', supervisor_id: null, role_level: 4, status: 'active' },
    f1: { id: 'f1', supervisor_id: 'gf', role_level: 3, status: 'active' },
    j1: { id: 'j1', supervisor_id: 'f1', role_level: 2, status: 'active' },
    j2: { id: 'j2', supervisor_id: 'f1', role_level: 2, status: 'active' },
  };
  function makeIncPool() {
    const edges = [];
    return {
      edges,
      query: async (sql, params) => {
        if (/DELETE FROM report_visibility/i.test(sql)) return { rows: [] };
        if (/INSERT INTO report_visibility/i.test(sql)) {
          edges.push({ person_id: params[0], viewer_id: params[1] });
          return { rows: [] };
        }
        if (/SELECT supervisor_id, role_level, status FROM people WHERE id = \$1/i.test(sql)) {
          const p = peopleById[params[0]];
          return { rows: p ? [p] : [] };
        }
        if (/SELECT supervisor_id FROM people WHERE id = \$1/i.test(sql)) {
          const p = peopleById[params[0]];
          return { rows: p ? [{ supervisor_id: p.supervisor_id }] : [] };
        }
        if (/SELECT id FROM people WHERE supervisor_id = \$1/i.test(sql)) {
          const [sup, exclude] = params;
          const ids = Object.values(peopleById)
            .filter((x) => x.supervisor_id === sup && x.id !== exclude && x.status === 'active' && (x.role_level || 1) <= 2)
            .map((x) => ({ id: x.id }));
          return { rows: ids };
        }
        return { rows: [] };
      },
    };
  }
  let sees;
  beforeAll(async () => {
    const pool = makeIncPool();
    await DB.people._rebuildVisibility.call({ _pool: pool }, 'j2');
    const set = new Set(pool.edges.map((e) => `${e.viewer_id}->${e.person_id}`));
    sees = (viewer, person) => set.has(`${viewer}->${person}`);
  });

  test('new worker: self + see-down ancestors are set', () => {
    expect(sees('j2', 'j2')).toBe(true); // self
    expect(sees('f1', 'j2')).toBe(true); // foreman sees the new worker
    expect(sees('gf', 'j2')).toBe(true); // all the way up the chain sees down
  });

  test('new worker: BOTH peer directions with the existing crew mate', () => {
    expect(sees('j1', 'j2')).toBe(true); // existing crew mate sees the newcomer
    expect(sees('j2', 'j1')).toBe(true); // newcomer sees the existing crew mate
  });

  test('new worker still cannot see UP the chain', () => {
    expect(sees('j2', 'f1')).toBe(false);
    expect(sees('j2', 'gf')).toBe(false);
  });
});
