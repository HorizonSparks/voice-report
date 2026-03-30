import { useState } from 'react';
import { Box, Typography, Button, TextField, Select, MenuItem, Dialog, DialogContent, DialogActions } from '@mui/material';
import VoiceInput from './VoiceInput.jsx';

export default function ForemanDailyForm({ user, onBack, onSaved }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    shift: 'Day',
    area: '',
    crew: [{ name: '', craft: '', hours_st: '8', hours_ot: '0' }],
    work_accomplished: '',
    work_quantities: '',
    materials_used: '',
    materials_needed: '',
    equipment_used: '',
    equipment_needed: '',
    ptp_completed: 'Yes',
    toolbox_topic: '',
    safety_observations: '',
    hazards_corrected: '',
    incidents: 'None',
    schedule_notes: '',
    plan_tomorrow: '',
    additional_manpower: '',
  });
  const [saving, setSaving] = useState(false);
  const [dialogConfig, setDialogConfig] = useState(null);

  const showAlert = (message) => setDialogConfig({ message });

  const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const addCrewMember = () => {
    setForm(prev => ({ ...prev, crew: [...prev.crew, { name: '', craft: '', hours_st: '8', hours_ot: '0' }] }));
  };

  const updateCrew = (index, field, value) => {
    setForm(prev => {
      const crew = [...prev.crew];
      crew[index] = { ...crew[index], [field]: value };
      return { ...prev, crew };
    });
  };

  const removeCrew = (index) => {
    if (form.crew.length <= 1) return;
    setForm(prev => ({ ...prev, crew: prev.crew.filter((_, i) => i !== index) }));
  };

  const totalHours = form.crew.reduce((sum, c) => sum + (parseFloat(c.hours_st) || 0) + (parseFloat(c.hours_ot) || 0), 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      const reportData = {
        person_id: user.person_id || 'admin',
        person_name: user.name,
        role_title: user.role_title || 'Administrator',
        form_type: 'foreman_daily',
        form_title: 'Foreman Daily Report',
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
        showAlert('Failed to save form. Please try again.');
      }
    } catch (e) {
      showAlert('Error saving form: ' + e.message);
    }
    setSaving(false);
  };

  return (
    <Box className="form-fill-view">
      <Button className="office-back" onClick={onBack}>← Back</Button>
      <Typography variant="h2" className="section-heading">📊 Foreman Daily Report</Typography>
      <Typography className="form-subtitle">{user.name} — {form.date}</Typography>

      {/* Header */}
      <Box className="form-section">
        <Typography variant="h3" className="form-section-title">Report Info</Typography>
        <Box className="form-row">
          <label className="form-label">
            Date
            <TextField type="date" className="form-input" fullWidth size="small" value={form.date} onChange={e => updateField('date', e.target.value)} />
          </label>
          <label className="form-label">
            Shift
            <Select className="form-input" fullWidth size="small" value={form.shift} onChange={e => updateField('shift', e.target.value)}>
              <MenuItem value="Day">Day</MenuItem>
              <MenuItem value="Night">Night</MenuItem>
              <MenuItem value="Swing">Swing</MenuItem>
            </Select>
          </label>
        </Box>
        <label className="form-label">
          Area / Unit
          <TextField type="text" className="form-input" fullWidth size="small" placeholder="e.g., Unit 400, Area C" value={form.area} onChange={e => updateField('area', e.target.value)} />
        </label>
      </Box>

      {/* Crew */}
      <Box className="form-section">
        <Typography variant="h3" className="form-section-title">Crew ({form.crew.length} members — {totalHours} total hours)</Typography>
        {form.crew.map((member, i) => (
          <Box key={i} className="crew-row">
            <TextField type="text" className="form-input crew-name" size="small" placeholder="Name" value={member.name} onChange={e => updateCrew(i, 'name', e.target.value)} />
            <TextField type="text" className="form-input crew-craft" size="small" placeholder="Craft" value={member.craft} onChange={e => updateCrew(i, 'craft', e.target.value)} />
            <TextField type="number" className="form-input crew-hours" size="small" placeholder="ST" value={member.hours_st} onChange={e => updateCrew(i, 'hours_st', e.target.value)} />
            <TextField type="number" className="form-input crew-hours" size="small" placeholder="OT" value={member.hours_ot} onChange={e => updateCrew(i, 'hours_ot', e.target.value)} />
            {form.crew.length > 1 && <Button className="crew-remove" onClick={() => removeCrew(i)}>✕</Button>}
          </Box>
        ))}
        <Button className="btn-add-row" onClick={addCrewMember}>+ Add Crew Member</Button>
      </Box>

      {/* Work Accomplished */}
      <Box className="form-section">
        <Typography variant="h3" className="form-section-title">Work Accomplished</Typography>
        <Box className="form-label">
          Description of work performed
          <VoiceInput value={form.work_accomplished} onChange={v => updateField('work_accomplished', v)} placeholder="Describe work completed today..." rows={4} />
        </Box>
        <label className="form-label">
          Quantities (feet, welds, etc.)
          <TextField type="text" className="form-input" fullWidth size="small" placeholder="e.g., 200 ft conduit, 15 terminations" value={form.work_quantities} onChange={e => updateField('work_quantities', e.target.value)} />
        </label>
      </Box>

      {/* Materials */}
      <Box className="form-section">
        <Typography variant="h3" className="form-section-title">Materials</Typography>
        <Box className="form-label">
          Materials used today
          <VoiceInput value={form.materials_used} onChange={v => updateField('materials_used', v)} placeholder="List materials consumed..." rows={2} />
        </Box>
        <Box className="form-label">
          Materials needed for tomorrow
          <VoiceInput value={form.materials_needed} onChange={v => updateField('materials_needed', v)} placeholder="Pre-staging requests..." rows={2} />
        </Box>
      </Box>

      {/* Equipment */}
      <Box className="form-section">
        <Typography variant="h3" className="form-section-title">Equipment</Typography>
        <label className="form-label">
          Equipment used
          <TextField type="text" className="form-input" fullWidth size="small" placeholder="e.g., Boom lift 60ft, Megger" value={form.equipment_used} onChange={e => updateField('equipment_used', e.target.value)} />
        </label>
        <label className="form-label">
          Equipment needed for tomorrow
          <TextField type="text" className="form-input" fullWidth size="small" placeholder="Request equipment..." value={form.equipment_needed} onChange={e => updateField('equipment_needed', e.target.value)} />
        </label>
      </Box>

      {/* Safety */}
      <Box className="form-section">
        <Typography variant="h3" className="form-section-title">Safety</Typography>
        <Box className="form-row">
          <label className="form-label">
            PTP Completed?
            <Select className="form-input" fullWidth size="small" value={form.ptp_completed} onChange={e => updateField('ptp_completed', e.target.value)}>
              <MenuItem value="Yes">Yes</MenuItem>
              <MenuItem value="No">No</MenuItem>
            </Select>
          </label>
          <label className="form-label">
            Toolbox Talk Topic
            <TextField type="text" className="form-input" fullWidth size="small" placeholder="Today's safety topic" value={form.toolbox_topic} onChange={e => updateField('toolbox_topic', e.target.value)} />
          </label>
        </Box>
        <Box className="form-label">
          Safety Observations
          <VoiceInput value={form.safety_observations} onChange={v => updateField('safety_observations', v)} placeholder="Positive and at-risk observations..." rows={2} />
        </Box>
        <Box className="form-label">
          Hazards Identified & Corrected
          <VoiceInput value={form.hazards_corrected} onChange={v => updateField('hazards_corrected', v)} placeholder="Any hazards found and fixed..." rows={2} />
        </Box>
        <label className="form-label">
          Incidents / Near-Misses
          <TextField type="text" className="form-input" fullWidth size="small" value={form.incidents} onChange={e => updateField('incidents', e.target.value)} />
        </label>
      </Box>

      {/* Schedule */}
      <Box className="form-section">
        <Typography variant="h3" className="form-section-title">Schedule & Planning</Typography>
        <Box className="form-label">
          Schedule Notes / Constraints
          <VoiceInput value={form.schedule_notes} onChange={v => updateField('schedule_notes', v)} placeholder="Delays, coordination needs, hold points..." rows={2} />
        </Box>
        <Box className="form-label">
          Plan for Tomorrow
          <VoiceInput value={form.plan_tomorrow} onChange={v => updateField('plan_tomorrow', v)} placeholder="Work planned, prerequisites, requests..." rows={3} />
        </Box>
        <label className="form-label">
          Additional Manpower Request
          <TextField type="text" className="form-input" fullWidth size="small" placeholder="e.g., Need 2 more journeyman electricians" value={form.additional_manpower} onChange={e => updateField('additional_manpower', e.target.value)} />
        </label>
      </Box>

      {/* Submit */}
      <Button className="btn-primary btn-full" variant="contained" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save Report'}
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
