import { useState, useEffect, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import FormHeader from '../components/forms/FormHeader.jsx';
import CalibrationTable from '../components/forms/CalibrationTable.jsx';
import CableTable from '../components/forms/CableTable.jsx';
import ChecklistGroup from '../components/forms/ChecklistGroup.jsx';
import SignaturePad from '../components/forms/SignaturePad.jsx';
import PhotoCapture from '../components/forms/PhotoCapture.jsx';
import MeggerTable from '../components/forms/MeggerTable.jsx';

export default function FormFill({ templateId, loopId, onBack, onSubmitted, user }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(null);
  const [loop, setLoop] = useState(null);
  const [values, setValues] = useState({});
  const [calPoints, setCalPoints] = useState([
    { percent_range: 0, input_value: '', as_found_output: '', calibrated_output: '', dcs_reading: '' },
    { percent_range: 25, input_value: '', as_found_output: '', calibrated_output: '', dcs_reading: '' },
    { percent_range: 50, input_value: '', as_found_output: '', calibrated_output: '', dcs_reading: '' },
    { percent_range: 75, input_value: '', as_found_output: '', calibrated_output: '', dcs_reading: '' },
    { percent_range: 100, input_value: '', as_found_output: '', calibrated_output: '', dcs_reading: '' },
  ]);
  const [cableRows, setCableRows] = useState(
    Array.from({ length: 10 }, () => ({ tag_number: '', color_code: '', continuity: '', cable_landed: '' }))
  );
  const [meggerRows, setMeggerRows] = useState(
    Array.from({ length: 15 }, () => ({ megger: '', result: '', continuity: '', color: '' }))
  );
  const [photos, setPhotos] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [editingHeader, setEditingHeader] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!templateId) return;
    const fetches = [fetch(`/api/forms/templates/${templateId}`).then(r => r.ok ? r.json() : null)];
    if (loopId) fetches.push(fetch(`/api/forms/loops/${loopId}`).then(r => r.ok ? r.json() : null));

    Promise.all(fetches).then(([formData, loopData]) => {
      setForm(formData);
      if (loopData) setLoop(loopData);
      const pre = {};
      if (loopData) {
        pre.project_number = loopData.project_number;
        pre.project_name = loopData.project_name;
        pre.pid_system = loopData.pid_system || '';
        pre.tag_number = loopData.tag_number;
        pre.service = loopData.service || '';
        pre.line_number = loopData.line_number || '';
      }
      if (formData.fields) {
        for (const f of formData.fields) {
          if (f.default_value && !pre[f.field_name]) pre[f.field_name] = f.default_value;
        }
      }
      // Pre-fill technician name from user
      if (user) pre.inspected_by_name = user.name;
      setValues(pre);
    }).catch(err => console.error('Failed to load form:', err));
  }, [templateId, loopId]);

  const setValue = (name, val) => setValues(prev => ({ ...prev, [name]: val }));

  const [emptyWarnings, setEmptyWarnings] = useState([]);
  const [emptyFieldNames, setEmptyFieldNames] = useState([]);

  // Group labels for summary
  const groupLabelsForWarning = {
    header: 'Project / Loop Information',
    device_info: 'Device Information',
    valve_info: 'Valve Information',
    checks: 'Verification Checks',
    calibration: 'Calibration Data',
    cable_info: 'Cable Information',
    cable_check: 'Cable Checks',
    setpoint: 'Setpoint',
    positioner: 'Positioner',
    leak_test: 'Leak Test',
    loop_check: 'Loop Check',
    site_conditions: 'Site Conditions',
    test_equipment: 'Test Equipment',
    megger_matrix: 'Megger Matrix',
    tc_data: 'Thermocouple Data',
    comments: 'Comments',
    signatures: 'Signatures',
    job_identification: 'Job Identification',
    crew_supervision: 'Crew & Supervision',
    task_description: 'Task Description',
    permits_conditions: 'Permits & Conditions',
    hazard_analysis: 'Hazard Analysis Steps',
    ppe_required: 'Required PPE',
    emergency_info: 'Emergency Info',
    crew_acknowledgment: 'Crew Acknowledgment',
  };

  const handleSubmit = () => {
    const warnings = [];
    const allEmpty = [];

    if (!form.fields) { setShowConfirm(true); return; }

    // Count empty fields by group
    const groupCounts = {};
    for (const f of form.fields) {
      if (f.field_type === 'signature') {
        if (!values[f.field_name]) {
          groupCounts['signatures'] = (groupCounts['signatures'] || 0) + 1;
        }
      } else {
        const val = values[f.field_name];
        if (!val || val === '' || val === '-- Select --') {
          const g = f.field_group || 'other';
          groupCounts[g] = (groupCounts[g] || 0) + 1;
          allEmpty.push(f.field_label);
        }
      }
    }

    // Build section-level summary
    for (const [group, count] of Object.entries(groupCounts)) {
      const label = groupLabelsForWarning[group] || group;
      if (group === 'signatures') {
        warnings.push(`${label} — not signed`);
      } else {
        warnings.push(`${label} — ${count} empty field${count > 1 ? 's' : ''}`);
      }
    }

    setEmptyWarnings(warnings);
    setEmptyFieldNames(allEmpty);
    setShowConfirm(true);
  };

  const handlePrint = () => {
    // Mark fields as empty/filled based on React state for print CSS
    if (form && form.fields) {
      for (const f of form.fields) {
        const val = values[f.field_name];
        const isEmpty = !val || val === '' || val === '-- Select --';
        const els = document.querySelectorAll(`[data-field="${f.field_name}"]`);
        els.forEach(el => el.setAttribute('data-empty', isEmpty ? 'true' : 'false'));
      }
      // Mark empty groups
      document.querySelectorAll('.form-group').forEach(group => {
        const fields = group.querySelectorAll('.form-field');
        if (fields.length === 0) return;
        const allEmpty = Array.from(fields).every(f => f.getAttribute('data-empty') === 'true');
        group.setAttribute('data-all-empty', allEmpty ? 'true' : 'false');
      });
    }
    window.print();
  };

  const handleConfirmedSubmit = async () => {
    setShowConfirm(false);
    setSubmitting(true);

    const payload = {
      template_id: parseInt(templateId),
      loop_id: loopId ? parseInt(loopId) : null,
      technician_name: values.inspected_by_name || user?.name || 'Field Technician',
      person_id: user?.person_id || null,
      values: { ...values },
      calibration_points: form.form_code !== 'HS-IC-002'
        ? calPoints.map(cp => ({
            ...cp,
            input_value: cp.input_value ? parseFloat(cp.input_value) : null,
            as_found_output: cp.as_found_output ? parseFloat(cp.as_found_output) : null,
            calibrated_output: cp.calibrated_output ? parseFloat(cp.calibrated_output) : null,
            dcs_reading: cp.dcs_reading ? parseFloat(cp.dcs_reading) : null,
          }))
        : undefined,
    };

    if (form.form_code === 'HS-IC-002') {
      const filledRows = cableRows.filter(r => r.tag_number.trim());
      payload.values.cable_table = filledRows;
    }
    if (photos.length > 0) payload.values.photos = photos;

    // Include megger data if any rows have data
    const filledMegger = meggerRows.filter(r => r.megger || r.result || r.continuity || r.color);
    if (filledMegger.length > 0) payload.values.megger_matrix = meggerRows;

    try {
      const res = await fetch('/api/forms/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Server error');
      const data = await res.json();
      if (onSubmitted) onSubmitted(data.id);
    } catch (e) {
      alert('Failed to submit form: ' + e.message);
    }
    setSubmitting(false);
  };

  if (!form) return <div className="loading">{t('common.loading')}</div>;

  const groups = {};
  if (form.fields) {
    for (const f of form.fields) {
      const g = f.field_group || 'other';
      if (!groups[g]) groups[g] = [];
      groups[g].push(f);
    }
  }

  const groupLabels = {
    header: 'Project / Loop Information', device_info: 'Device Information',
    cable_info: 'Cable Information', valve_info: 'Valve Information',
    positioner: 'Positioner', setpoint: 'Setpoint / Trip Settings',
    checks: 'Verification Checks',
    megger_matrix: 'Insulation Resistance (Megger) Matrix',
    tc_data: 'Thermocouple Data',
    calibration: 'Calibration Verification & Loop Check', transducer: 'Transducer',
    leak_test: 'Leak / Continuity Test', loop_check: 'Loop Check with DCS',
    client_witness: 'Client / Owner Witness', cable_check: 'Cable Continuity Check',
    site_conditions: 'Site Conditions',
    comments: 'Comments', test_equipment: 'Test Equipment', signatures: 'Sign-Off',
    // JSA sections
    job_identification: 'Job Identification',
    crew_supervision: 'Crew & Supervision',
    task_description: 'Task Description',
    permits_conditions: 'Permits & Environmental Conditions',
    hazard_analysis: 'Hazard Analysis — Job Steps',
    ppe_required: 'Required PPE',
    emergency_info: 'Emergency Information',
    crew_acknowledgment: 'Crew Review & Acknowledgment',
  };

  const groupOrder = [
    'header', 'job_identification', 'crew_supervision', 'task_description',
    'permits_conditions', 'device_info', 'cable_info', 'valve_info', 'positioner', 'setpoint',
    'checks', 'hazard_analysis', 'megger_matrix', 'tc_data', 'cable_check', 'calibration', 'transducer',
    'leak_test', 'loop_check', 'ppe_required', 'emergency_info', 'crew_acknowledgment',
    'site_conditions', 'client_witness', 'comments', 'test_equipment', 'signatures'
  ];

  const isEditing = editingHeader;

  return (
    <div className="form-fill">
      <button className="back-btn" onClick={onBack} style={{marginBottom: '12px'}}>&larr; Back</button>
      <FormHeader formCode={form.form_code} formTitle={form.form_title} />

      <div className="form-edit-bar">
        {!isEditing ? (
          <button type="button" className="btn form-edit-btn edit-mode" onClick={() => setEditingHeader(true)}>{t('common.edit')}</button>
        ) : (
          <button type="button" className="btn form-edit-btn lock-mode" onClick={() => setEditingHeader(false)}>{t('forms.lockForm')}</button>
        )}
        <span className="form-edit-status">
          {isEditing ? t('forms.editing') : t('forms.locked')}
        </span>
      </div>

      {showConfirm && (
        <div className="confirm-overlay">
          <div className="confirm-modal">
            {emptyWarnings.length > 0 ? (
              <>
                <h3 className="confirm-title">{t('forms.headsUp')}</h3>
                <p className="confirm-text">{t('forms.headsUp')}</p>
                <ul style={{textAlign: 'left', margin: '10px 20px', color: '#e8922a', fontSize: '14px', lineHeight: '1.8'}}>
                  {emptyWarnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
                <p className="confirm-text" style={{fontSize: '13px', color: 'var(--charcoal)', marginTop: '8px'}}>You can still save — these are not required.</p>
                <div className="confirm-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowConfirm(false)}>{t('forms.goBack')}</button>
                  <button type="button" className="btn btn-primary" onClick={handleConfirmedSubmit}>{t('forms.saveAnyway')}</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="confirm-title">Submit this form?</h3>
                <p className="confirm-text">Once submitted, this form becomes a permanent record.</p>
                <div className="confirm-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowConfirm(false)}>{t('forms.goBack')}</button>
                  <button type="button" className="btn btn-primary" onClick={handleConfirmedSubmit}>{t('common.submit')}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <form onSubmit={e => { e.preventDefault(); handleSubmit(); }}>
        {groupOrder.map(gKey => {
          const fields = groups[gKey];
          if (!fields) return null;

          if (gKey === 'megger_matrix') {
            return (
              <fieldset key={gKey} className={`form-group group-${gKey} ${!isEditing ? 'form-locked' : ''}`}>
                <legend>{groupLabels[gKey] || gKey}</legend>
                <MeggerTable rows={meggerRows} onChange={setMeggerRows} disabled={!isEditing} />
              </fieldset>
            );
          }

          if (gKey === 'signatures') {
            const nameFields = fields.filter(f => f.field_type !== 'signature');
            const sigFields = fields.filter(f => f.field_type === 'signature');
            // Build pairs: each name field pairs with its matching signature
            const pairs = nameFields.map((nf, i) => ({ name: nf, sig: sigFields[i] || null }));
            // If there are extra sigs without names, add them
            if (sigFields.length > nameFields.length) {
              for (let i = nameFields.length; i < sigFields.length; i++) {
                pairs.push({ name: null, sig: sigFields[i] });
              }
            }
            return (
              <fieldset key={gKey} className={`form-group group-${gKey} ${!isEditing ? 'form-locked' : ''}`}>
                <legend>{groupLabels[gKey] || gKey}</legend>
                <div className="sig-fill-block" style={pairs.length > 2 ? {flexWrap: 'wrap'} : {}}>
                  {pairs.map((pair, i) => (
                    <Fragment key={i}>
                      {i > 0 && <div className="sig-fill-divider"></div>}
                      <div className="sig-fill-column" style={pairs.length > 2 ? {minWidth: '30%'} : {}}>
                        {pair.name && <div className="form-field" data-field={pair.name.field_name}>{renderField(pair.name, values, setValue, calPoints, setCalPoints, cableRows, setCableRows, isEditing)}</div>}
                        {pair.sig && <div className="form-field" data-field={pair.sig.field_name}>{renderField(pair.sig, values, setValue, calPoints, setCalPoints, cableRows, setCableRows, isEditing)}</div>}
                      </div>
                    </Fragment>
                  ))}
                </div>
              </fieldset>
            );
          }

          return (
            <fieldset key={gKey} className={`form-group group-${gKey} ${!isEditing ? 'form-locked' : ''}`}>
              <legend>{groupLabels[gKey] || gKey}</legend>
              {fields.map(field => (
                <div key={field.id || field.field_name} className="form-field" data-field={field.field_name}>
                  {renderField(field, values, setValue, calPoints, setCalPoints, cableRows, setCableRows, isEditing)}
                </div>
              ))}
              {gKey === 'comments' && (
                <div className="form-field">
                  <span className="field-label">Photo Evidence</span>
                  <PhotoCapture photos={photos} onChange={setPhotos} disabled={!isEditing} />
                </div>
              )}
            </fieldset>
          );
        })}

        {isEditing && (
          <div className="form-actions" style={{display: 'flex', gap: '12px', flexWrap: 'wrap'}}>
            <button type="submit" className="btn btn-primary btn-lg" style={{flex: 1, minWidth: '140px'}} disabled={submitting}>
              {submitting ? t('common.loading') : t('forms.submitForm')}
            </button>
            <button type="button" className="btn btn-secondary btn-lg" style={{flex: 1, minWidth: '120px'}} onClick={handlePrint}>
              🖨️ {t('forms.print')}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

function renderField(field, values, setValue, calPoints, setCalPoints, cableRows, setCableRows, isEditing) {
  const val = values[field.field_name] ?? '';
  const isLocked = !isEditing;

  switch (field.field_type) {
    case 'text':
      return (<label><span className="field-label">{field.field_label}{field.is_required ? ' *' : ''}</span>
        <input type="text" value={val} onChange={e => setValue(field.field_name, e.target.value)} readOnly={isLocked} className={isLocked ? 'readonly' : ''} /></label>);
    case 'number':
      return (<label><span className="field-label">{field.field_label}{field.unit ? ` (${field.unit})` : ''}{field.is_required ? ' *' : ''}</span>
        <input type="number" step="any" value={val} onChange={e => setValue(field.field_name, e.target.value)} readOnly={isLocked} className={isLocked ? 'readonly' : ''} /></label>);
    case 'textarea':
      return (<label><span className="field-label">{field.field_label}</span>
        <textarea rows={3} value={val} onChange={e => setValue(field.field_name, e.target.value)} readOnly={isLocked} className={isLocked ? 'readonly' : ''} /></label>);
    case 'select':
      const opts = field.select_options ? (typeof field.select_options === 'string' ? JSON.parse(field.select_options) : field.select_options) : [];
      return (<label><span className="field-label">{field.field_label}{field.is_required ? ' *' : ''}</span>
        <div className="select-wrapper"><select value={val} onChange={e => setValue(field.field_name, e.target.value)} disabled={isLocked} className={isLocked ? 'readonly' : ''}>
          <option value="">-- Select --</option>{opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select></div></label>);
    case 'yesno':
      return <ChecklistGroup label={field.field_label} value={val} onChange={isLocked ? () => {} : v => setValue(field.field_name, v)} />;
    case 'calibration_table':
      return <CalibrationTable points={calPoints} onChange={setCalPoints} disabled={isLocked} />;
    case 'cable_table':
      return <CableTable rows={cableRows} onChange={setCableRows} disabled={isLocked} />;
    case 'signature':
      return <SignaturePad label={field.field_label} value={val} onChange={dataUrl => setValue(field.field_name, dataUrl)} />;
    default:
      return (<label><span className="field-label">{field.field_label}</span>
        <input type="text" value={val} onChange={e => setValue(field.field_name, e.target.value)} /></label>);
  }
}
