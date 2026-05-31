/**
 * Knowledge Writer tests — the human-review queue + canonical-knowledge merge.
 * Runs against a throwaway HS_KNOWLEDGE_DIR so it never touches real knowledge.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SECTION = 'top_rework_causes_electrical';
const goodCandidate = { section: SECTION, items: [{ cause: 'c', prevention: 'p' }] };

function freshWriter(dir) {
  process.env.HS_KNOWLEDGE_DIR = dir;
  jest.resetModules();
  return require('../server/services/ai/knowledgeWriter');
}

describe('knowledgeWriter', () => {
  let dir, writer;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-'));
    fs.writeFileSync(path.join(dir, 'lessons_learned.json'), JSON.stringify({ [SECTION]: [] }, null, 2));
    writer = freshWriter(dir);
  });

  afterEach(() => {
    delete process.env.HS_KNOWLEDGE_DIR;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  const base = (over = {}) => ({ source: 'self_audit', op: 'add', target_file: 'lessons_learned.json', candidate: goodCandidate, ...over });

  test('rejects invalid source / op / target', async () => {
    await expect(writer.propose(base({ source: 'hacker' }))).rejects.toThrow(/invalid source/);
    await expect(writer.propose(base({ op: 'delete' }))).rejects.toThrow(/invalid op/);
    await expect(writer.propose(base({ target_file: 'electrical_codes.json' }))).rejects.toThrow(/not writable/);
  });

  test('validates lesson item schema', async () => {
    await expect(writer.propose(base({ candidate: { section: SECTION, items: [{ cause: 'c' }] } }))).rejects.toThrow(/prevention/);
    await expect(writer.propose(base({ candidate: { section: SECTION, items: [{ cause: 'c', prevention: 'p', extra: 'x' }] } }))).rejects.toThrow(/unexpected field/);
    await expect(writer.propose(base({ candidate: { section: SECTION, items: [{ cause: 'c', prevention: { nested: true } }] } }))).rejects.toThrow(/prevention/);
    await expect(writer.propose(base({ candidate: { section: SECTION, items: [{ cause: 'x'.repeat(400), prevention: 'p' }] } }))).rejects.toThrow(/exceeds/);
  });

  test('dedupeKey is idempotent for pending proposals', async () => {
    const a = await writer.propose(base({ dedupeKey: 'k1' }));
    const b = await writer.propose(base({ dedupeKey: 'k1' }));
    expect(b.id).toBe(a.id);
    expect(writer.listProposals({ status: 'pending' }).length).toBe(1);
  });

  test('applyApproved merges, backs up, and is non-reapplicable', async () => {
    const p = await writer.propose(base());
    const r = await writer.applyApproved(p.id, 'owner1');
    expect(r.applied).toBe(1);
    const merged = JSON.parse(fs.readFileSync(path.join(dir, 'lessons_learned.json'), 'utf8'));
    expect(merged[SECTION]).toEqual([{ cause: 'c', prevention: 'p' }]);
    expect(fs.existsSync(path.join(dir, '_backups'))).toBe(true);
    expect(fs.readdirSync(path.join(dir, '_backups')).length).toBe(1);
    // already approved → cannot apply again
    await expect(writer.applyApproved(p.id, 'owner1')).rejects.toThrow(/already approved/);
  });

  test('merge dedupes an identical existing lesson', async () => {
    fs.writeFileSync(path.join(dir, 'lessons_learned.json'), JSON.stringify({ [SECTION]: [{ cause: 'c', prevention: 'p' }] }, null, 2));
    const p = await writer.propose(base());
    const r = await writer.applyApproved(p.id, 'owner1');
    expect(r.applied).toBe(0);
    expect(r.skipped).toBe(1);
  });

  test('reject marks rejected and blocks later apply', async () => {
    const p = await writer.propose(base({ source: 'manual' }));
    const r = await writer.reject(p.id, 'owner1', 'not useful');
    expect(r.status).toBe('rejected');
    await expect(writer.applyApproved(p.id, 'owner1')).rejects.toThrow(/already rejected/);
  });

  test('corrupt queue fails closed (refuses to overwrite)', async () => {
    fs.writeFileSync(path.join(dir, '_pending.json'), '{ not valid json');
    await expect(writer.propose(base({ source: 'manual' }))).rejects.toThrow(/CORRUPT/);
  });

  test('serializes concurrent proposes without losing entries', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        writer.propose(base({ candidate: { section: SECTION, items: [{ cause: `c${i}`, prevention: 'p' }] } })))
    );
    expect(writer.listProposals({ status: 'pending' }).length).toBe(8);
  });
});
