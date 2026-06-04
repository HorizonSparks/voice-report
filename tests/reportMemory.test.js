/**
 * Per-tenant report memory — THE WALLS test (Phase 3). This is the security guard: it proves
 * recall() can never surface a report across a company or up/out of the see-down chain, and
 * fails CLOSED when context is missing. If this goes red, the memory has become a leak.
 *
 * Pure logic: openaiClient.embed is mocked (deterministic vectors); the DB is a mock that
 * captures the SQL + params so we can assert the wall is in the query itself.
 */
jest.mock('../server/services/ai/openaiClient', () => ({
  embed: jest.fn(async (input) => {
    const arr = Array.isArray(input) ? input : [input];
    return arr.map(() => [1, 0, 0]); // query embeds to [1,0,0]; row vectors are set in each test
  }),
}));

const reportMemory = require('../server/services/reportMemory');

function makeDb(queryImpl) { return { db: { query: queryImpl } }; }

describe('reportMemory.recall — the walls', () => {
  test('fail CLOSED: non-admin with no company recalls nothing and never touches the DB', async () => {
    const calls = [];
    const db = makeDb(async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; });
    const out = await reportMemory.recall(db, { is_admin: false, company_id: null, visiblePersonIds: ['p1'] }, 'q');
    expect(out).toEqual([]);
    expect(calls.length).toBe(0);
  });

  test('fail CLOSED: non-admin with an empty visible set recalls nothing', async () => {
    const calls = [];
    const db = makeDb(async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; });
    const out = await reportMemory.recall(db, { is_admin: false, company_id: 'A', visiblePersonIds: [] }, 'q');
    expect(out).toEqual([]);
    expect(calls.length).toBe(0);
  });

  test('THE WALL: non-admin query filters company_id AND person_id IN the see-down set, then ranks', async () => {
    let select = null;
    const db = makeDb(async (sql, params) => {
      if (/SELECT report_id/.test(sql)) {
        select = { sql, params };
        return { rows: [
          { report_id: 'r1', person_id: 'p1', project_id: null, content: 'pump', embedding: JSON.stringify([1, 0, 0]), created_at: '2026-06-01' }, // score 1
          { report_id: 'r2', person_id: 'p2', project_id: null, content: 'valve', embedding: JSON.stringify([0, 1, 0]), created_at: '2026-06-02' }, // score 0
        ] };
      }
      return { rows: [] }; // CREATE TABLE / INDEX
    });
    const out = await reportMemory.recall(db,
      { is_admin: false, company_id: 'CompanyA', visiblePersonIds: ['p1', 'p2'], person_id: 'p1' }, 'q');
    expect(select).not.toBeNull();
    expect(select.sql).toMatch(/company_id = \$1/);
    expect(select.sql).toMatch(/person_id = ANY\(\$2\)/);
    expect(select.params[0]).toBe('CompanyA');
    expect(select.params[1]).toEqual(['p1', 'p2']);
    expect(out[0].report_id).toBe('r1'); // most relevant first
    expect(out.map((h) => h.report_id)).toEqual(['r1', 'r2']);
  });

  test('admin: company filter applied, NO person (see-down) filter, NO project filter', async () => {
    let select = null;
    const db = makeDb(async (sql) => {
      if (/SELECT report_id/.test(sql)) { select = { sql }; return { rows: [] }; }
      return { rows: [] };
    });
    await reportMemory.recall(db, { is_admin: true, company_id: 'CompanyA', visiblePersonIds: [] }, 'q');
    expect(select.sql).toMatch(/company_id = \$1/);
    expect(select.sql).not.toMatch(/person_id = ANY/);
    expect(select.sql).not.toMatch(/project_id IS NULL OR project_id/);
  });

  test('PROJECT axis (strict): a non-cross-project worker is filtered to accessible projects (+ null/default)', async () => {
    let select = null;
    const db = makeDb(async (sql, params) => {
      if (/SELECT report_id/.test(sql)) { select = { sql, params }; return { rows: [] }; }
      return { rows: [] };
    });
    await reportMemory.recall(db,
      { is_admin: false, company_id: 'A', visiblePersonIds: ['p1'], canCrossProject: false, accessibleProjectIds: ['projA'] }, 'q');
    expect(select.sql).toMatch(/person_id = ANY\(\$2\)/);
    expect(select.sql).toMatch(/project_id IS NULL OR project_id = 'default' OR project_id = ANY\(\$3\)/);
    expect(select.params[2]).toEqual(['projA']);
  });

  test('PROJECT axis: PM/CEO tier (canCrossProject) has NO project filter', async () => {
    let select = null;
    const db = makeDb(async (sql) => {
      if (/SELECT report_id/.test(sql)) { select = { sql }; return { rows: [] }; }
      return { rows: [] };
    });
    await reportMemory.recall(db,
      { is_admin: false, company_id: 'A', visiblePersonIds: ['p1'], canCrossProject: true, accessibleProjectIds: [] }, 'q');
    expect(select.sql).toMatch(/person_id = ANY/);
    expect(select.sql).not.toMatch(/project_id IS NULL OR project_id/);
  });
});

describe('reportMemory helpers', () => {
  test('cosineSim: identical=1, orthogonal=0, mismatched length=-1', () => {
    expect(reportMemory.cosineSim([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(reportMemory.cosineSim([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
    expect(reportMemory.cosineSim([1, 0], [1, 0, 0])).toBe(-1);
  });

  test('chunkText splits on paragraphs and bounds length + count', () => {
    const big = Array.from({ length: 50 }, (_, i) => `Para${i} `.repeat(30)).join('\n\n');
    const chunks = reportMemory.chunkText(big, 200, 5);
    expect(chunks.length).toBeLessThanOrEqual(5);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(reportMemory.chunkText('', 200, 5)).toEqual([]);
  });
});
