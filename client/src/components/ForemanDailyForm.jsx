import { useState } from 'react';
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
        alert('Failed to save form. Please try again.');
      }
    } catch (e) {
      alert('Error saving form: ' + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="form-fill-view">
      <button className="office-back" onClick={onBack}>← Back</button>
      <h2 className="section-heading">📊 Foreman Daily Report</h2>
      <p className="form-subtitle">{user.name} — {form.date}</p>

      {/* Header */}
      <div className="form-section">
        <h3 className="form-section-title">Report Info</h3>
        <div className="form-row">
          <label className="form-label">
            Date
            <input type="date" className="form-input" value={form.date} onChange={e => updateField('date', e.target.value)} />
          </label>
          <label className="form-label">
            Shift
            <select className="form-input" value={form.shift} onChange={e => updateField('shift', e.target.value)}>
              <option>Day</option>
              <option>Night</option>
              <option>Swing</option>
            </select>
          </label>
        </div>
        <label className="form-label">
          Area / Unit
          <input type="text" className="form-input" placeholder="e.g., Unit 400, Area C" value={form.area} onChange={e => updateField('area', e.target.value)} />
        </label>
      </div>

      {/* Crew */}
      <div className="form-section">
        <h3 className="form-section-title">Crew ({form.crew.length} members — {totalHours} total hours)</h3>
        {form.crew.map((member, i) => (
          <div key={i} className="crew-row">
            <input type="text" className="form-input crew-name" placeholder="Name" value={member.name} onChange={e => updateCrew(i, 'name', e.target.value)} />
            <input type="text" className="form-input crew-craft" placeholder="Craft" value={member.craft} onChange={e => updateCrew(i, 'craft', e.target.value)} />
            <input type="number" className="form-input crew-hours" placeholder="ST" value={member.hours_st} onChange={e => updateCrew(i, 'hours_st', e.target.value)} />
            <input type="number" className="form-input crew-hours" placeholder="OT" value={member.hours_ot} onChange={e => updateCrew(i, 'hours_ot', e.target.value)} />
            {form.crew.length > 1 && <button className="crew-remove" onClick={() => removeCrew(i)}>✕</button>}
          </div>
        ))}
        <button className="btn-add-row" onClick={addCrewMember}>+ Add Crew Member</button>
      </div>

      {/* Work Accomplished */}
      <div className="form-section">
        <h3 className="form-section-title">Work Accomplished</h3>
        <div className="form-label">
          Description of work performed
          <VoiceInput value={form.work_accomplished} onChange={v => updateField('work_accomplished', v)} placeholder="Describe work completed today..." rows={4} />
        </div>
        <label className="form-label">
          Quantities (feet, welds, etc.)
          <input type="text" className="form-input" placeholder="e.g., 200 ft conduit, 15 terminations" value={form.work_quantities} onChange={e => updateField('work_quantities', e.target.value)} />
        </label>
      </div>

      {/* Materials */}
      <div className="form-section">
        <h3 className="form-section-title">Materials</h3>
        <div className="form-label">
          Materials used today
          <VoiceInput value={form.materials_used} onChange={v => updateField('materials_used', v)} placeholder="List materials consumed..." rows={2} />
        </div>
        <div className="form-label">
          Materials needed for tomorrow
          <VoiceInput value={form.materials_needed} onChange={v => updateField('materials_needed', v)} placeholder="Pre-staging requests..." rows={2} />
        </div>
      </div>

      {/* Equipment */}
      <div className="form-section">
        <h3 className="form-section-title">Equipment</h3>
        <label className="form-label">
          Equipment used
          <input type="text" className="form-input" placeholder="e.g., Boom lift 60ft, Megger" value={form.equipment_used} onChange={e => updateField('equipment_used', e.target.value)} />
        </label>
        <label className="form-label">
          Equipment needed for tomorrow
          <input type="text" className="form-input" placeholder="Request equipment..." value={form.equipment_needed} onChange={e => updateField('equipment_needed', e.target.value)} />
        </label>
      </div>

      {/* Safety */}
      <div className="form-section">
        <h3 className="form-section-title">Safety</h3>
        <div className="form-row">
          <label className="form-label">
            PTP Completed?
            <select className="form-input" value={form.ptp_completed} onChange={e => updateField('ptp_completed', e.target.value)}>
              <option>Yes</option>
              <option>No</option>
            </select>
          </label>
          <label className="form-label">
            Toolbox Talk Topic
            <input type="text" className="form-input" placeholder="Today's safety topic" value={form.toolbox_topic} onChange={e => updateField('toolbox_topic', e.target.value)} />
          </label>
        </div>
        <div className="form-label">
          Safety Observations
          <VoiceInput value={form.safety_observations} onChange={v => updateField('safety_observations', v)} placeholder="Positive and at-risk observations..." rows={2} />
        </div>
        <div className="form-label">
          Hazards Identified & Corrected
          <VoiceInput value={form.hazards_corrected} onChange={v => updateField('hazards_corrected', v)} placeholder="Any hazards found and fixed..." rows={2} />
        </div>
        <label className="form-label">
          Incidents / Near-Misses
          <input type="text" className="form-input" value={form.incidents} onChange={e => updateField('incidents', e.target.value)} />
        </label>
      </div>

      {/* Schedule */}
      <div className="form-section">
        <h3 className="form-section-title">Schedule & Planning</h3>
        <div className="form-label">
          Schedule Notes / Constraints
          <VoiceInput value={form.schedule_notes} onChange={v => updateField('schedule_notes', v)} placeholder="Delays, coordination needs, hold points..." rows={2} />
        </div>
        <div className="form-label">
          Plan for Tomorrow
          <VoiceInput value={form.plan_tomorrow} onChange={v => updateField('plan_tomorrow', v)} placeholder="Work planned, prerequisites, requests..." rows={3} />
        </div>
        <label className="form-label">
          Additional Manpower Request
          <input type="text" className="form-input" placeholder="e.g., Need 2 more journeyman electricians" value={form.additional_manpower} onChange={e => updateField('additional_manpower', e.target.value)} />
        </label>
      </div>

      {/* Submit */}
      <button className="btn-primary btn-full" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save Report'}
      </button>
    </div>
  );
}
