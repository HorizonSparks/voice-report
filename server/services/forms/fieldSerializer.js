/**
 * Form Field Serializer
 * Handles serialization/deserialization of form submission values.
 * Extracted from formsV2.js for reusability.
 */

/**
 * Serialize a field value into the correct column for form_submission_values
 * @param {string} fieldName
 * @param {*} value
 * @returns {{ field_name, text_value, numeric_value, boolean_value, json_value }}
 */
function serializeFieldValue(fieldName, value) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'object') {
    return { field_name: fieldName, text_value: null, numeric_value: null, boolean_value: null, json_value: JSON.stringify(value) };
  }
  if (typeof value === 'number') {
    return { field_name: fieldName, text_value: null, numeric_value: value, boolean_value: null, json_value: null };
  }
  if (typeof value === 'boolean') {
    return { field_name: fieldName, text_value: null, numeric_value: null, boolean_value: value ? 1 : 0, json_value: null };
  }
  return { field_name: fieldName, text_value: String(value), numeric_value: null, boolean_value: null, json_value: null };
}

/**
 * Deserialize form_submission_values rows into a key-value map
 * @param {Array} valueRows - Rows from form_submission_values table
 * @returns {Object} key-value map
 */
function deserializeValues(valueRows) {
  const valuesMap = {};
  for (const v of valueRows) {
    if (v.json_value) valuesMap[v.field_name] = JSON.parse(v.json_value);
    else if (v.numeric_value !== null) valuesMap[v.field_name] = v.numeric_value;
    else if (v.boolean_value !== null) valuesMap[v.field_name] = v.boolean_value === 1;
    else valuesMap[v.field_name] = v.text_value;
  }
  return valuesMap;
}

module.exports = { serializeFieldValue, deserializeValues };
