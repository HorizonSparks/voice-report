import { useState } from 'react';
import { Box, Typography, Button, TextField, Select, MenuItem, Dialog, DialogContent, DialogActions } from '@mui/material';
import VoiceInput from './VoiceInput.jsx';

export default function SafetyObservationForm({ user, onBack, onSaved }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    location: '',
    observation_type: 'Planned',
    category: '',
    safe_behaviors: '',
    at_risk_behaviors: '',
    corrective_action: '',
    follow_up_required: 'No',
    persons_observed_craft: '',
    supervisor_notified: 'No',
    severity: 'Low',
    additional_notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [dialogConfig, setDialogConfig] = useState(null);

  const showAlert = (message) => setDialogConfig({ message });

  const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const categories = [
    'PPE Compliance',
    'Body Position / Line of Fire',
    'Tools & Equipment',
    'Housekeeping',
    'Fall Protection',
    'Scaffolding',
    'Electrical Safety',
    'Confined Space',
    'Hot Work',
    'Excavation / Trenching',
    'Crane / Rigging',
    'Chemical / Hazmat',
    'Fire Protection',
    'Procedures / Permits',
    'Communication',
    'Other',
  ];

  const handleSave = async () => {
    setSaving(true);
    try {
      const reportData = {
        person_id: user.person_id || 'admin',
        person_name: user.name,
        role_title: user.role_title || 'Administrator',
        form_type: 'safety_observation',
        form_title: 'Safety Observation Card',
        form_data: form,
        created_at: new Date().toISOString(),
      };

      const res = await fetch('/api/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData),
      });

      if (res.ok) {
        const result = await res.json();
        onSaved(result.id);
      } else {
        showAlert('Failed to save form.');
      }
    } catch (e) {
      showAlert('Error saving: ' + e.message);
    }
    setSaving(false);
  };

  return (
    <Box className="form-fill-view">
      <Button className="office-back" onClick={onBack}>← Back</Button>
      <Typography variant="h2" className="section-heading">⛑️ Safety Observation Card</Typography>
      <Typography className="form-subtitle">{user.name} — {form.date}</Typography>

      {/* Header */}
      <Box className="form-section">
        <Typography variant="h3" className="form-section-title">Observation Info</Typography>
        <Box className="form-row">
          <label className="form-label">
            Date
            <TextField type="date" className="form-input" fullWidth size="small" value={form.date} onChange={e => updateField('date', e.target.value)} />
          </label>
          <label className="form-label">
            Time
            <TextField type="time" className="form-input" fullWidth size="small" value={form.time} onChange={e => updateField('time', e.target.value)} />
          </label>
        </Box>
        <label className="form-label">
          Location / Area
          <TextField type="text" className="form-input" fullWidth size="small" placeholder="e.g., Unit 400, Level 2" value={form.location} onChange={e => updateField('location', e.target.value)} />
        </label>
        <Box className="form-row">
          <label className="form-label">
            Type
            <Select className="form-input" fullWidth size="small" value={form.observation_type} onChange={e => updateField('observation_type', e.target.value)}>
              <MenuItem value="Planned">Planned</MenuItem>
              <MenuItem value="Unplanned">Unplanned</MenuItem>
            </Select>
          </label>
          <label className="form-label">
            Potential Severity
            <Select className="form-input" fullWidth size="small" value={form.severity} onChange={e => updateField('severity', e.target.value)}>
              <MenuItem value="Low">Low</MenuItem>
              <MenuItem value="Medium">Medium</MenuItem>
              <MenuItem value="High">High</MenuItem>
            </Select>
          </label>
        </Box>
      </Box>

      {/* Category */}
      <Box className="form-section">
        <Typography variant="h3" className="form-section-title">Category</Typography>
        <Box className="category-grid">
          {categories.map(cat => (
            <Button key={cat} className={`category-chip ${form.category === cat ? 'chip-active' : ''}`} onClick={() => updateField('category', cat)}>
              {cat}
            </Button>
          ))}
        </Box>
      </Box>

      {/* Observations */}
      <Box className="form-section">
        <Typography variant="h3" className="form-section-title">Observations</Typography>
        <Box className="form-label">
          ✅ Safe Behaviors Observed
          <VoiceInput value={form.safe_behaviors} onChange={v => updateField('safe_behaviors', v)} placeholder="Describe positive/safe behaviors observed..." rows={3} />
        </Box>
        <Box className="form-label">
          ⚠️ At-Risk Behaviors Observed
          <VoiceInput value={form.at_risk_behaviors} onChange={v => updateField('at_risk_behaviors', v)} placeholder="Describe at-risk or unsafe behaviors observed..." rows={3} />
        </Box>
      </Box>

      {/* Actions */}
      <Box className="form-section">
        <Typography variant="h3" className="form-section-title">Corrective Actions</Typography>
        <label className="form-label">
          Immediate Corrective Action Taken
          <VoiceInput value={form.corrective_action} onChange={v => updateField('corrective_action', v)} placeholder="What was done to correct the issue..." rows={2} />
        </label>
        <Box className="form-row">
          <label className="form-label">
            Follow-Up Required?
            <Select className="form-input" fullWidth size="small" value={form.follow_up_required} onChange={e => updateField('follow_up_required', e.target.value)}>
              <MenuItem value="No">No</MenuItem>
              <MenuItem value="Yes">Yes</MenuItem>
            </Select>
          </label>
          <label className="form-label">
            Supervisor Notified?
            <Select className="form-input" fullWidth size="small" value={form.supervisor_notified} onChange={e => updateField('supervisor_notified', e.target.value)}>
              <MenuItem value="No">No</MenuItem>
              <MenuItem value="Yes">Yes</MenuItem>
            </Select>
          </label>
        </Box>
        <label className="form-label">
          Craft / Trade of Person(s) Observed
          <TextField type="text" className="form-input" fullWidth size="small" placeholder="e.g., Electrician, Pipefitter" value={form.persons_observed_craft} onChange={e => updateField('persons_observed_craft', e.target.value)} />
        </label>
      </Box>

      {/* Notes */}
      <Box className="form-section">
        <Typography variant="h3" className="form-section-title">Additional Notes</Typography>
        <VoiceInput value={form.additional_notes} onChange={v => updateField('additional_notes', v)} placeholder="Any additional observations or context..." rows={3} />
      </Box>

      {/* Submit */}
      <Button className="btn-primary btn-full" variant="contained" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save Observation'}
      </Button>

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
