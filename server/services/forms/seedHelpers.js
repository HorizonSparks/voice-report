/**
 * Form Seed Helpers
 * Universal field definitions and seeding functions.
 * Extracted from formsV2.js for maintainability.
 */

// Universal fields appended to every form
const UNIVERSAL_SITE = [
  ['area_classification', 'Area Classification', 'select', 'site_conditions', 55, 0, null, '["Non-Hazardous","Class I Div 1","Class I Div 2","Zone 0","Zone 1","Zone 2"]', null],
  ['ambient_temp', 'Ambient Temperature', 'number', 'site_conditions', 56, 0, '°F', null, null],
  ['ambient_humidity', 'Ambient Humidity', 'number', 'site_conditions', 57, 0, '%', null, null],
  ['applicable_standard', 'Applicable Code/Standard', 'text', 'site_conditions', 58, 0, null, null, null],
  ['qc_hold_point', 'QC Hold/Witness Point', 'select', 'site_conditions', 59, 0, null, '["Hold Point","Witness Point","Review Point","N/A"]', null],
];

const UNIVERSAL_COMMENTS = [
  ['comments', 'Comments', 'textarea', 'comments', 50, 0, null, null, null],
];

const UNIVERSAL_TEST_EQUIP = [
  ['test_equip_make', 'Test Equipment Make', 'text', 'test_equipment', 60, 0, null, null, null],
  ['test_equip_model', 'Test Equipment Model', 'text', 'test_equipment', 61, 0, null, null, null],
  ['test_equip_serial', 'Test Equip Serial No.', 'text', 'test_equipment', 62, 0, null, null, null],
  ['test_equip_cal_date', 'Calibration Due Date', 'text', 'test_equipment', 63, 0, null, null, null],
];

const UNIVERSAL_SIGS = [
  ['inspected_by_name', 'Inspected By', 'text', 'signatures', 70, 1, null, null, null],
  ['inspected_by_sig', 'Inspector Signature', 'signature', 'signatures', 71, 0, null, null, null],
  ['accepted_by_name', 'Accepted By', 'text', 'signatures', 72, 0, null, null, null],
  ['accepted_by_sig', 'Acceptance Signature', 'signature', 'signatures', 73, 0, null, null, null],
];

/**
 * Create form template and insert fields
 * @param {object} client - PostgreSQL client (in transaction)
 * @param {string} code - Form code (e.g. 'HS-IC-001')
 * @param {string} title - Form title
 * @param {string} category - Form category
 * @param {string} trade - Trade name
 * @param {Array} fields - Custom fields for this form
 * @param {string} type - 'standard' | 'custom_sigs' | 'safety'
 */
async function insertForm(client, code, title, category, trade, fields, type = 'standard') {
  const t = await client.query(
    'INSERT INTO form_templates_v2 (form_code, form_title, category, trade) VALUES ($1, $2, $3, $4) RETURNING id',
    [code, title, category, trade]
  );
  const id = t.rows[0].id;

  let allFields;
  if (type === 'safety') {
    allFields = [...fields, ...UNIVERSAL_COMMENTS];
  } else if (type === 'custom_sigs') {
    allFields = [...fields, ...UNIVERSAL_COMMENTS, ...UNIVERSAL_SITE, ...UNIVERSAL_TEST_EQUIP];
  } else {
    allFields = [...fields, ...UNIVERSAL_COMMENTS, ...UNIVERSAL_SITE, ...UNIVERSAL_TEST_EQUIP, ...UNIVERSAL_SIGS];
  }

  for (const f of allFields) {
    await client.query(
      'INSERT INTO form_fields_v2 (template_id, field_name, field_label, field_type, field_group, display_order, is_required, unit, select_options, default_value) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [id, ...f]
    );
  }

  return id;
}

module.exports = {
  UNIVERSAL_SITE,
  UNIVERSAL_COMMENTS,
  UNIVERSAL_TEST_EQUIP,
  UNIVERSAL_SIGS,
  insertForm,
};
