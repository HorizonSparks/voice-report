/**
 * Safety Alert Notification Utility
 * Sends automated safety alerts via the existing messaging system
 */
const DB = require('../../database/db');

/**
 * Send a safety alert message to a person
 * Uses the existing messages table schema: from_id, to_id, from_name, to_name, type, content, metadata
 */
async function sendSafetyAlert(toPersonId, content, metadata = {}) {
  try {
    return await DB.messages.create({
      from_id: 'system_safety',
      to_id: toPersonId,
      from_name: 'Safety System',
      to_name: '',
      type: 'safety_alert',
      content,
      metadata,
    });
  } catch (err) {
    console.error('Failed to send safety alert:', err.message);
    return null;
  }
}

/**
 * Check JSA status for a person on a task and send alerts if needed
 */
async function checkAndAlertJsaMismatch(personId, task, foremanId) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const person = await DB.people.getById(personId);
    if (!person) return;

    // Find person's JSAs for today
    const jsas = (await DB.db.query(
      "SELECT * FROM jsa_records WHERE date = $1 AND status != 'rejected' AND (person_id = $2 OR crew_members LIKE $3)",
      [today, personId, `%${personId}%`]
    )).rows;

    if (jsas.length === 0) {
      const workerMsg = `⚠️ You have been assigned "${task.title}" but you don't have a JSA for today. Please complete your JSA before starting work.`;
      const foremanMsg = `⚠️ ${person.name} was assigned "${task.title}" but has no JSA for today.`;

      await sendSafetyAlert(personId, workerMsg, { task_id: task.id, alert_type: 'no_jsa' });
      if (foremanId && foremanId !== personId) {
        await sendSafetyAlert(foremanId, foremanMsg, { task_id: task.id, alert_type: 'no_jsa', person_id: personId });
      }

      // Alert safety supervisor(s)
      try {
        const safetyPeople = (await DB.db.query("SELECT id FROM people WHERE LOWER(role_title) LIKE '%safety%'")).rows;
        for (const sp of safetyPeople) {
          await sendSafetyAlert(sp.id, foremanMsg, { task_id: task.id, alert_type: 'no_jsa', person_id: personId });
        }
      } catch { /* no safety people found */ }
    }
  } catch (err) {
    console.error('JSA alert check error:', err.message);
  }
}

module.exports = { sendSafetyAlert, checkAndAlertJsaMismatch };
