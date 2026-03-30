import { useState, useEffect, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Typography, Button, TextField, Select, MenuItem, Paper,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
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
  const [dialogConfig, setDialogConfig] = useState(null);

  const showAlert = (message) => setDialogConfig({ message });

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
      showAlert('Failed to submit form: ' + e.message);
    }
    setSubmitting(false);
  };

  if (!form) return (
    <Box className="loading" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
      <CircularProgress size={20} />
      <Typography>{t('common.loading')}</Typography>
    </Box>
  );

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
    <Box className="form-fill">
      <Button className="back-btn" onClick={onBack} sx={{ mb: '12px' }}>&larr; Back</Button>
      <FormHeader formCode={form.form_code} formTitle={form.form_title} />

      <Box className="form-edit-bar">
        {!isEditing ? (
          <Button type="button" className="btn form-edit-btn edit-mode" onClick={() => setEditingHeader(true)}>{t('common.edit')}</Button>
        ) : (
          <Button type="button" className="btn form-edit-btn lock-mode" onClick={() => setEditingHeader(false)}>{t('forms.lockForm')}</Button>
        )}
        <Typography component="span" className="form-edit-status">
          {isEditing ? t('forms.editing') : t('forms.locked')}
        </Typography>
      </Box>

      <Dialog open={showConfirm} onClose={() => setShowConfirm(false)}>
        {emptyWarnings.length > 0 ? (
          <>
            <DialogTitle className="confirm-title">{t('forms.headsUp')}</DialogTitle>
            <DialogContent>
              <Typography className="confirm-text">{t('forms.headsUp')}</Typography>
              <Box
                component="ul"
                sx={{ textAlign: 'left', m: '10px 20px', color: 'warning.main', fontSize: '14px', lineHeight: 1.8 }}
              >
                {emptyWarnings.map((w, i) => <li key={i}>{w}</li>)}
              </Box>
              <Typography className="confirm-text" sx={{ fontSize: '13px', color: 'text.primary', mt: '8px' }}>
                You can still save — these are not required.
              </Typography>
            </DialogContent>
            <DialogActions className="confirm-actions">
              <Button type="button" className="btn btn-secondary" onClick={() => setShowConfirm(false)}>{t('forms.goBack')}</Button>
              <Button type="button" className="btn btn-primary" onClick={handleConfirmedSubmit}>{t('forms.saveAnyway')}</Button>
            </DialogActions>
          </>
        ) : (
          <>
            <DialogTitle className="confirm-title">Submit this form?</DialogTitle>
            <DialogContent>
              <Typography className="confirm-text">Once submitted, this form becomes a permanent record.</Typography>
            </DialogContent>
            <DialogActions className="confirm-actions">
              <Button type="button" className="btn btn-secondary" onClick={() => setShowConfirm(false)}>{t('forms.goBack')}</Button>
              <Button type="button" className="btn btn-primary" onClick={handleConfirmedSubmit}>{t('common.submit')}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Box component="form" onSubmit={e => { e.preventDefault(); handleSubmit(); }}>
        {groupOrder.map(gKey => {
          const fields = groups[gKey];
          if (!fields) return null;

          if (gKey === 'megger_matrix') {
            return (
              <Paper key={gKey} className={`form-group group-${gKey} ${!isEditing ? 'form-locked' : ''}`}>
                <Typography component="legend">{groupLabels[gKey] || gKey}</Typography>
                <MeggerTable rows={meggerRows} onChange={setMeggerRows} disabled={!isEditing} />
              </Paper>
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
              <Paper key={gKey} className={`form-group group-${gKey} ${!isEditing ? 'form-locked' : ''}`}>
                <Typography component="legend">{groupLabels[gKey] || gKey}</Typography>
                <Box className="sig-fill-block" sx={pairs.length > 2 ? { flexWrap: 'wrap' } : {}}>
                  {pairs.map((pair, i) => (
                    <Fragment key={i}>
                      {i > 0 && <Box className="sig-fill-divider" />}
                      <Box className="sig-fill-column" sx={pairs.length > 2 ? { minWidth: '30%' } : {}}>
                        {pair.name && <Box className="form-field" data-field={pair.name.field_name}>{renderField(pair.name, values, setValue, calPoints, setCalPoints, cableRows, setCableRows, isEditing)}</Box>}
                        {pair.sig && <Box className="form-field" data-field={pair.sig.field_name}>{renderField(pair.sig, values, setValue, calPoints, setCalPoints, cableRows, setCableRows, isEditing)}</Box>}
                      </Box>
                    </Fragment>
                  ))}
                </Box>
              </Paper>
            );
          }

          return (
            <Paper key={gKey} className={`form-group group-${gKey} ${!isEditing ? 'form-locked' : ''}`}>
              <Typography component="legend">{groupLabels[gKey] || gKey}</Typography>
              {fields.map(field => (
                <Box key={field.id || field.field_name} className="form-field" data-field={field.field_name}>
                  {renderField(field, values, setValue, calPoints, setCalPoints, cableRows, setCableRows, isEditing)}
                </Box>
              ))}
              {gKey === 'comments' && (
                <Box className="form-field">
                  <Typography component="span" className="field-label">Photo Evidence</Typography>
                  <PhotoCapture photos={photos} onChange={setPhotos} disabled={!isEditing} />
                </Box>
              )}
            </Paper>
          );
        })}

        {isEditing && (
          <Box className="form-actions" sx={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <Button type="submit" className="btn btn-primary btn-lg" sx={{ flex: 1, minWidth: '140px' }} disabled={submitting}>
              {submitting ? t('common.loading') : t('forms.submitForm')}
            </Button>
            <Button type="button" className="btn btn-secondary btn-lg" sx={{ flex: 1, minWidth: '120px' }} onClick={handlePrint}>
              {t('forms.print')}
            </Button>
          </Box>
        )}
      </Box>

      <Dialog open={!!dialogConfig} onClose={() => setDialogConfig(null)}>
        <DialogContent>
          <Typography>{dialogConfig?.message}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogConfig(null)}>OK</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function renderField(field, values, setValue, calPoints, setCalPoints, cableRows, setCableRows, isEditing) {
  const val = values[field.field_name] ?? '';
  const isLocked = !isEditing;

  switch (field.field_type) {
    case 'text':
      return (
        <Box component="label">
          <Typography component="span" className="field-label">
            {field.field_label}{field.is_required ? ' *' : ''}
          </Typography>
          <TextField
            type="text"
            value={val}
            onChange={e => setValue(field.field_name, e.target.value)}
            slotProps={{ input: { readOnly: isLocked } }}
            className={isLocked ? 'readonly' : ''}
            size="small"
            fullWidth
          />
        </Box>
      );
    case 'number':
      return (
        <Box component="label">
          <Typography component="span" className="field-label">
            {field.field_label}{field.unit ? ` (${field.unit})` : ''}{field.is_required ? ' *' : ''}
          </Typography>
          <TextField
            type="number"
            slotProps={{ input: { readOnly: isLocked }, htmlInput: { step: 'any' } }}
            value={val}
            onChange={e => setValue(field.field_name, e.target.value)}
            className={isLocked ? 'readonly' : ''}
            size="small"
            fullWidth
          />
        </Box>
      );
    case 'textarea':
      return (
        <Box component="label">
          <Typography component="span" className="field-label">{field.field_label}</Typography>
          <TextField
            multiline
            rows={3}
            value={val}
            onChange={e => setValue(field.field_name, e.target.value)}
            slotProps={{ input: { readOnly: isLocked } }}
            className={isLocked ? 'readonly' : ''}
            size="small"
            fullWidth
          />
        </Box>
      );
    case 'select': {
      const opts = field.select_options
        ? (typeof field.select_options === 'string' ? JSON.parse(field.select_options) : field.select_options)
        : [];
      return (
        <Box component="label">
          <Typography component="span" className="field-label">
            {field.field_label}{field.is_required ? ' *' : ''}
          </Typography>
          <Box className="select-wrapper">
            <Select
              value={val}
              onChange={e => setValue(field.field_name, e.target.value)}
              disabled={isLocked}
              className={isLocked ? 'readonly' : ''}
              size="small"
              fullWidth
              displayEmpty
            >
              <MenuItem value="">-- Select --</MenuItem>
              {opts.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
            </Select>
          </Box>
        </Box>
      );
    }
    case 'yesno':
      return <ChecklistGroup label={field.field_label} value={val} onChange={isLocked ? () => {} : v => setValue(field.field_name, v)} />;
    case 'calibration_table':
      return <CalibrationTable points={calPoints} onChange={setCalPoints} disabled={isLocked} />;
    case 'cable_table':
      return <CableTable rows={cableRows} onChange={setCableRows} disabled={isLocked} />;
    case 'signature':
      return <SignaturePad label={field.field_label} value={val} onChange={dataUrl => setValue(field.field_name, dataUrl)} />;
    default:
      return (
        <Box component="label">
          <Typography component="span" className="field-label">{field.field_label}</Typography>
          <TextField
            type="text"
            value={val}
            onChange={e => setValue(field.field_name, e.target.value)}
            size="small"
            fullWidth
          />
        </Box>
      );
  }
}
