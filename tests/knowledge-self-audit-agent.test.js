/**
 * Knowledge Self-Audit agent-definition tests — pure, no I/O.
 */
const selfAudit = require('../server/services/ai/agents/knowledgeSelfAudit');

describe('knowledge.selfAudit.v1 agent definition', () => {
  test('has the expected shape and guardrails', () => {
    expect(selfAudit.name).toBe('knowledge.selfAudit.v1');
    expect(selfAudit.jsonMode).toBe(true);
    expect(selfAudit.tools).toEqual([]);
    expect(selfAudit.guardrails.costLimitPerCallCents).toBeLessThanOrEqual(60);
    expect(Object.isFrozen(selfAudit)).toBe(true);
  });

  test('targets exactly the three trade sections', () => {
    expect(selfAudit.ALLOWED_SECTIONS).toEqual([
      'top_rework_causes_electrical',
      'top_rework_causes_instrumentation',
      'top_rework_causes_pipefitting',
    ]);
  });

  test('buildUserContent requires non-empty reports', () => {
    expect(() => selfAudit.buildUserContent({ lessons: {}, reports: [] })).toThrow();
    expect(() => selfAudit.buildUserContent({})).toThrow();
  });

  test('buildUserContent embeds report ids and keeps lessons in the USER message', () => {
    const content = selfAudit.buildUserContent({
      lessons: { top_rework_causes_electrical: [{ cause: 'x', prevention: 'y' }] },
      reports: [{ id: 'R-1', trade: 'electrical', date: '2026-05-30', text: 'ran out of conduit' }],
    });
    expect(content).toContain('[R-1]');
    expect(content).toContain('CURRENT CAPTURED LESSONS');
    expect(content).toContain('ran out of conduit');
  });
});
