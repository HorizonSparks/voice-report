/**
 * Feedback Capture
 * Captures AI draft vs final saved version for learning signal.
 * Just stores the data — no model training yet.
 */

const DB = require('../../../database/db');

/**
 * Save a feedback record comparing AI draft to final version
 * @param {object} params
 * @param {string} params.person_id - Worker ID
 * @param {string} params.context_type - daily_task | shift_update | punch_list
 * @param {object} params.ai_draft - What the AI produced
 * @param {object} params.final_version - What was actually saved (after edits)
 * @param {object} params.conversation - Full conversation history
 * @param {string} params.raw_transcript - Original transcript
 */
async function captureFeedback({ person_id, context_type, ai_draft, final_version, conversation, raw_transcript }) {
  if (!ai_draft || !final_version) return null;

  // Compute differences
  const diffs = computeDiffs(ai_draft, final_version);
  if (diffs.length === 0) return null; // No edits — nothing to learn from

  try {
    // Store in ai_conversations table with type 'feedback'
    const result = await DB.query(`
      INSERT INTO ai_conversations (person_id, context_type, conversation_data, created_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING id
    `, [
      person_id,
      `feedback_${context_type}`,
      JSON.stringify({
        ai_draft,
        final_version,
        diffs,
        raw_transcript: (raw_transcript || '').substring(0, 500),
        conversation_rounds: (conversation || []).length,
        captured_at: new Date().toISOString(),
      }),
    ]);

    return { id: result.rows[0]?.id, diffs };
  } catch (err) {
    // Don't fail the main flow — feedback is best-effort
    console.warn('Feedback capture error:', err.message);
    return null;
  }
}

/**
 * Compute field-level differences between AI draft and final version
 */
function computeDiffs(aiDraft, finalVersion) {
  const diffs = [];
  const aiFields = aiDraft.fields || aiDraft;
  const finalFields = finalVersion.fields || finalVersion;

  for (const key of new Set([...Object.keys(aiFields), ...Object.keys(finalFields)])) {
    const aiVal = normalize(aiFields[key]);
    const finalVal = normalize(finalFields[key]);

    if (aiVal !== finalVal) {
      diffs.push({
        field: key,
        ai_value: aiFields[key],
        final_value: finalFields[key],
        category: categorizeDiff(key, aiFields[key], finalFields[key]),
      });
    }
  }

  return diffs;
}

/**
 * Categorize a diff for analytics
 */
function categorizeDiff(field, aiVal, finalVal) {
  if (aiVal === undefined || aiVal === null || aiVal === '') return 'missing_detail';
  if (finalVal === undefined || finalVal === null || finalVal === '') return 'removed';
  if (field === 'priority') return 'wrong_emphasis';
  if (field === 'assigned_to') return 'incorrect_assignee';
  if (field === 'location') return 'vague_location';
  if (field.includes('safety')) return 'safety_omission';

  // Check if it's just a wording cleanup vs substantive change
  const aiStr = String(aiVal).toLowerCase().trim();
  const finalStr = String(finalVal).toLowerCase().trim();
  if (aiStr.length > 0 && finalStr.length > 0) {
    // If more than 50% of words are shared, it's a wording cleanup
    const aiWords = new Set(aiStr.split(/\s+/));
    const finalWords = new Set(finalStr.split(/\s+/));
    const shared = [...aiWords].filter(w => finalWords.has(w)).length;
    const overlap = shared / Math.max(aiWords.size, finalWords.size);
    if (overlap > 0.5) return 'wording_cleanup';
  }

  return 'wrong_field_mapping';
}

function normalize(val) {
  if (val === undefined || val === null) return '';
  if (Array.isArray(val)) return JSON.stringify(val.sort());
  return String(val).trim().toLowerCase();
}

module.exports = { captureFeedback, computeDiffs };
