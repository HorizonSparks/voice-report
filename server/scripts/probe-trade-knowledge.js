#!/usr/bin/env node
/**
 * Per-trade knowledge reachability probe (task #45, 2026-06-11)
 *
 * THE CONTRACT THIS PROVES: for every trade in config/task-keywords.json,
 * a synthetic transcript built from that trade's OWN task keywords must make
 * loadRefineKnowledge() return (a) a non-empty safety block and (b) at least
 * MIN_CONTENT_SECTIONS content sections. This is the probe the 2026-06-11
 * audit demanded — ~500KB of accurate trade knowledge sat dark for months
 * because loader key names and file key names drifted with zero detection
 * ("active ≠ retrieving"). Run after ANY change to refineKnowledgeLoader.js
 * or knowledge/*.json:
 *
 *   docker exec voice-report-app-1 node server/scripts/probe-trade-knowledge.js
 *
 * Exit 0 = all trades pass. Exit 1 = at least one trade fails (CI-able).
 * No DB, no network, no AI spend — pure loader + disk.
 */

/* eslint-disable no-console */
const path = require('path');

const { TASK_KEYWORDS, loadRefineKnowledge } = require(
  path.join(__dirname, '../services/ai/refineKnowledgeLoader')
);

const MIN_TOTAL_CHARS = 600; // a real knowledge block, not a stub line

// Per-trade minimums. Default: ≥1 safety entry + ≥2 content sections.
// The safety-department trade is the exception by design: its corpus IS the
// safety_department.json sections, which the loader injects as safety
// entries — so it must show MORE safety depth and is allowed zero
// bracketed content sections.
const EXPECTATIONS = {
  default: { safety: 1, content: 2 },
  safety: { safety: 2, content: 0 },
};

// Filler that trips the troubleshooting/quality/codes gates the way a real
// foreman's narrative would. Trade keywords supply the task-specific part.
const GENERIC_FILLER =
  'today the crew had a problem and an issue we need to troubleshoot, ' +
  'quality inspection found a defect, checked the code and standard specs, ' +
  'torque and tolerance look wrong, rework needed on the install';

function buildSyntheticTranscript(trade) {
  const tasks = TASK_KEYWORDS[trade] || {};
  const keywordSample = Object.values(tasks)
    .flatMap((kws) => (Array.isArray(kws) ? kws.slice(0, 3) : []))
    .join(' ');
  return `${keywordSample} ${GENERIC_FILLER}`;
}

function countSections(knowledge) {
  // Safety entries are structurally marked: the loader's formatSafetyEntry
  // emits "[Safety — <label>] ...". Everything else bracketed is a content
  // section ([Materials — …], [QC — …], [Codes & standards — …], procedure
  // steps, …). Plain lines (cable types, rework causes, quick reference)
  // deliberately do NOT count toward the content minimum — they're garnish,
  // and counting them is exactly how a probe false-passes (Codex MAJOR-3).
  const lines = knowledge.split('\n').map((l) => l.trim());
  const safetyEntryCount = lines.filter((l) => l.startsWith('[Safety — ')).length;
  const contentSections = lines.filter((l) => l.startsWith('[') && !l.startsWith('[Safety — ')).length;
  const safetyBlock = knowledge.includes('Relevant safety knowledge') && safetyEntryCount > 0;
  return { safetyBlock, safetyEntryCount, contentSections };
}

const STUB_PATTERN = /knowledge available/i;

let failures = 0;
const rows = [];

for (const trade of Object.keys(TASK_KEYWORDS)) {
  const transcript = buildSyntheticTranscript(trade);
  let knowledge = '';
  let error = null;
  try {
    knowledge = loadRefineKnowledge(trade, transcript) || '';
  } catch (e) {
    error = e.message;
  }

  const { safetyBlock, safetyEntryCount, contentSections } = countSections(knowledge);
  const expected = EXPECTATIONS[trade] || EXPECTATIONS.default;
  const hasStubs = STUB_PATTERN.test(knowledge);
  const checks = {
    loads: !error,
    safety: safetyBlock && safetyEntryCount >= expected.safety,
    content: contentSections >= expected.content,
    size: knowledge.length >= MIN_TOTAL_CHARS,
    noStubs: !hasStubs,
  };
  const pass = Object.values(checks).every(Boolean);
  if (!pass) failures += 1;

  rows.push({
    trade,
    pass,
    chars: knowledge.length,
    safetyEntries: safetyEntryCount,
    contentSections,
    failed: Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k).join(',') || '-',
    error: error || '',
  });
}

console.log('\nTRADE KNOWLEDGE REACHABILITY PROBE');
console.log('===================================');
console.log('trade            pass  chars  safety  content  failed-checks');
for (const r of rows) {
  console.log(
    `${r.trade.padEnd(16)} ${r.pass ? 'PASS' : 'FAIL'}  ${String(r.chars).padStart(5)}  ${String(r.safetyEntries).padStart(6)}  ${String(r.contentSections).padStart(7)}  ${r.failed}${r.error ? `  ERROR: ${r.error}` : ''}`
  );
}
console.log(
  `\n${rows.length - failures}/${rows.length} trades reachable.` +
    (failures ? ` ${failures} FAILING — knowledge is dark for those trades.` : ' All knowledge reachable.')
);

process.exit(failures > 0 ? 1 : 0);
