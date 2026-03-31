const { isSparks, buildSparksStructurePrompt, buildSparksConversePrompt } = require("./sparksPrompts");

/**
 * AI Prompt Builder
 * Constructs system prompts for all AI routes.
 * Extracted from ai.js for maintainability and testability.
 *
 * No side effects — pure functions that return prompt strings.
 */

/**
 * Build the safety knowledge block from safety_basics.json data
 */
function buildSafetyBlock(safetyBasics) {
  if (!safetyBasics) return '';
  return `

INDUSTRIAL SAFETY KNOWLEDGE (applies to all trades — use this to identify and flag safety concerns in the report):
Safety Rules:
${(safetyBasics.safety_rules || []).map(r => '- ' + r).join('\n')}

Tools & Equipment Safety:
${(safetyBasics.tools_and_equipment || []).map(r => '- ' + r).join('\n')}

Safety Vocabulary: ${(safetyBasics.safety_vocabulary || []).join(', ')}

IMPORTANT: If the worker mentions ANY safety concern, near-miss, PPE issue, or unsafe condition — even casually — flag it prominently in the structured report. Safety observations should never be buried or minimized.`;
}

/**
 * Build context package from person + template data
 */
async function buildContextPackage(person, template, dbOverride) {
  if (!person || !template) return null;
  const pc = person.personal_context || {};

  // Load knowledge files for this person from DB
  let knowledgeContext = '';
  try {
    const DB = dbOverride || require('../../../database/db');
    const knowledgeRows = (await DB.db.query(
      'SELECT title, text_content, source_type FROM knowledge_files WHERE person_id = $1 AND text_content IS NOT NULL AND text_content != $2 ORDER BY created_at DESC LIMIT 5',
      [person.id, '']
    )).rows;
    if (knowledgeRows.length > 0) {
      // Cap total knowledge context at ~8000 chars (~2000 tokens) to stay efficient
      let totalChars = 0;
      const maxChars = 8000;
      const chunks = [];
      for (const kf of knowledgeRows) {
        const text = kf.text_content || '';
        if (totalChars + text.length > maxChars) {
          chunks.push('--- ' + kf.title + ' (truncated) ---\n' + text.substring(0, maxChars - totalChars));
          break;
        }
        chunks.push('--- ' + kf.title + ' ---\n' + text);
        totalChars += text.length;
      }
      knowledgeContext = chunks.join('\n\n');
    }
  } catch (e) {
    console.error('Knowledge files load error:', e.message);
  }

  return {
    person_name: person.name,
    role_title: person.role_title,
    trade: person.trade || template.trade || '',
    role_description: pc.role_description || template.role_description,
    report_focus: pc.report_focus || template.report_focus,
    output_sections: (pc.output_sections && pc.output_sections.length > 0) ? pc.output_sections : template.output_sections,
    vocabulary_terms: (() => { try { const v = typeof template.vocabulary === 'string' ? JSON.parse(template.vocabulary) : template.vocabulary; return v?.terms ? v.terms.join(', ') : ''; } catch { return ''; } })(),
    language_notes: pc.language_preference || template.language_notes || '',
    personal_experience: pc.experience || '',
    personal_specialties: pc.specialties || '',
    personal_notes: pc.notes || '',
    personal_certifications: pc.certifications || '',
    safety_rules: (pc.safety_rules && pc.safety_rules.length > 0) ? pc.safety_rules : (template.safety_rules || []),
    safety_vocabulary: (pc.safety_vocabulary && pc.safety_vocabulary.length > 0) ? pc.safety_vocabulary : (template.safety_vocabulary || []),
    tools_and_equipment: (pc.tools_and_equipment && pc.tools_and_equipment.length > 0) ? pc.tools_and_equipment : (template.tools_and_equipment || []),
    safety_notes: pc.safety_notes || '',
    knowledge_context: knowledgeContext,
  };
}

/**
 * Build system prompt for /api/structure (full report structuring)
 */
function buildStructurePrompt(contextPackage, safetyBlock) {
  if (!contextPackage) {
    // Fallback: generic prompt
    return `You are a report structuring assistant for an industrial software company called Horizon Sparks. The founder has recorded a voice note. Your job is to produce TWO markdown documents from the transcript.

OUTPUT FORMAT — return valid JSON with two keys:
{ "verbatim": "...", "structured": "..." }

DOCUMENT 1 — "verbatim": Take the raw transcript and format it as clean markdown. Preserve every word. Add paragraph breaks and a date header.

DOCUMENT 2 — "structured": Reorganize into sections:
## Summary
## Key Points
## Action Items
## Open Questions
## Raw Context

Keep language direct and professional. Do not invent information.`;
  }

  // Route Sparks trade to dedicated prompt builder — completely different persona
  if (isSparks({ trade: contextPackage.trade }, null)) {
    return buildSparksStructurePrompt(contextPackage);
  }

  const sectionsText = contextPackage.output_sections.map((s, i) => `${i + 1}. ${s}`).join('\n');

  return `You are a report structuring assistant for a construction/refinery project run by Horizon Sparks.

A field worker has recorded a voice report. Use the context below to produce a well-structured report appropriate to their role and experience level.

PERSON: ${contextPackage.person_name}
ROLE: ${contextPackage.role_title}
ROLE DESCRIPTION: ${contextPackage.role_description}
EXPERIENCE: ${contextPackage.personal_experience}
SPECIALTIES: ${contextPackage.personal_specialties}
CERTIFICATIONS: ${contextPackage.personal_certifications}

REPORT FOCUS: ${contextPackage.report_focus}

LANGUAGE NOTES: ${contextPackage.language_notes}

VOCABULARY REFERENCE (preserve these terms exactly as spoken):
${contextPackage.vocabulary_terms}

PERSONAL NOTES: ${contextPackage.personal_notes}

${contextPackage.knowledge_context ? 'KNOWLEDGE FILES (uploaded background documents about this person):\n' + contextPackage.knowledge_context : ''}

SAFETY KNOWLEDGE:
${contextPackage.safety_rules.length > 0 ? 'Safety Rules:\n' + contextPackage.safety_rules.map(r => '- ' + r).join('\n') : ''}
${contextPackage.tools_and_equipment.length > 0 ? '\nTools & Equipment Safety:\n' + contextPackage.tools_and_equipment.map(r => '- ' + r).join('\n') : ''}
${contextPackage.safety_vocabulary.length > 0 ? '\nSafety Vocabulary: ' + contextPackage.safety_vocabulary.join(', ') : ''}
${contextPackage.safety_notes ? '\nPersonal Safety Notes: ' + contextPackage.safety_notes : ''}
${safetyBlock}

IMPORTANT: If the worker mentions ANY safety concern, near-miss, PPE issue, or unsafe condition — even casually — flag it prominently in the structured report.

SECTIONS TO PRODUCE:
${sectionsText}

INSTRUCTIONS:
Produce TWO outputs as valid JSON with keys "verbatim" and "structured":

1. "verbatim" — The raw transcript formatted as clean markdown. Preserve every word exactly as spoken, including any Spanish or mixed-language content. Add paragraph breaks where natural pauses occur. Add a header with the person's name, role, date, and time.

2. "structured" — The transcript reorganized into the sections listed above. Skip any section that has no relevant content. Preserve technical terms, tag numbers, loop numbers, and equipment identifiers exactly as spoken. If the person reported in mixed languages, the structured version should be in English but preserve any technical terms or direct quotes in the original language. Keep language direct and professional. Do not invent information not present in the transcript. Pay special attention to any safety-related content.`;
}

/**
 * Build system prompt for /api/converse (follow-up conversation)
 */
function buildConversePrompt({ personName, roleTitle, roleDescription, reportFocus, outputSections, messagesForPerson, trade }) {
  let messagesBlock = '';
  // Route Sparks trade to dedicated converse prompt
  if (isSparks({ trade }, null)) {
    return buildSparksConversePrompt({ personName, roleTitle, roleDescription, reportFocus, outputSections, messagesForPerson });
  }

  if (messagesForPerson && messagesForPerson.length > 0) {
    messagesBlock = `\n\nIMPORTANT MESSAGES FOR ${personName.toUpperCase()}:\nThe following messages were left by supervisors or safety officers. You MUST mention each one naturally during the conversation:\n${messagesForPerson.map((m, i) => `${i + 1}. From ${m.from}: "${m.text}"`).join('\n')}`;
  }

  const firstName = personName.split(' ')[0];

  return `You are a friendly, professional AI assistant helping a field worker complete their daily voice report. You are having a SPOKEN CONVERSATION — keep your responses short, natural, and conversational (2-4 sentences max).

WORKER: ${personName} (${roleTitle})
ROLE: ${roleDescription}
REPORT SECTIONS NEEDED: ${(outputSections || []).join(', ')}
${reportFocus ? `FOCUS AREAS: ${reportFocus}` : ''}
${messagesBlock}

YOUR JOB:
1. Review what ${personName} has said so far
2. Acknowledge what they reported (briefly)
3. If there are supervisor/safety messages, deliver them naturally (e.g. "Oh, by the way, your safety officer left you a note about...")
4. Ask ONE or TWO follow-up questions about missing information — things a good report should include but weren't mentioned
5. Keep it conversational — like talking to a coworker, not reading a form

RULES:
- Be brief. This is spoken aloud. No long paragraphs.
- Use the worker's first name
- Ask about specifics: crew size, exact counts, equipment models, tag numbers
- If they mentioned a problem, ask what they need to fix it
- If safety was mentioned, acknowledge it positively
- If nothing is missing, just say "Sounds good, ${firstName}. Ready to wrap up?"
- Respond in the same language the worker used (English or Spanish or mixed)
- Never say "as an AI" or break character
- When you think the report is mostly complete, remind ${personName} to take a photo of their work if they haven't mentioned it. Say something like "Hey ${firstName}, don't forget to snap a photo of the work area before you wrap up — hit the camera button."
- Only remind about photos ONCE, and only when the report feels close to done`;
}

module.exports = {
  buildSafetyBlock,
  buildContextPackage,
  buildStructurePrompt,
  buildConversePrompt,
};
