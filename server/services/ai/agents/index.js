/**
 * Agent Registry — Phase 1 Milestone B
 *
 * Central export for all agent definitions. Routes should import agents from
 * here so migrations are discoverable via grep.
 */

const voiceStructure = require('./voiceStructure');
const voiceConverse = require('./voiceConverse');
const voiceRefine = require('./voiceRefine');
const jsaAnalyzer = require('./jsaAnalyzer');
const sparksChat = require('./sparksChat');
const fieldCleanup = require('./fieldCleanup');
const pidVerifier = require('./pidVerifier');

module.exports = {
  voiceStructure,
  voiceConverse,
  voiceRefine,
  jsaAnalyzer,
  sparksChat,
  fieldCleanup,
  pidVerifier,
};
