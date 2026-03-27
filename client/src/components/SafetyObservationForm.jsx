import { useState } from 'react';
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
        alert('Failed to save form.');
      }
    } catch (e) {
      alert('Error saving: ' + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="form-fill-view">
      <button className="office-back" onClick={onBack}>← Back</button>
      <h2 className="section-heading">⛑️ Safety Observation Card</h2>
      <p className="form-subtitle">{user.name} — {form.date}</p>

      {/* Header */}
      <div className="form-section">
        <h3 className="form-section-title">Observation Info</h3>
        <div className="form-row">
          <label className="form-label">
            Date
            <input type="date" className="form-input" value={form.date} onChange={e => updateField('date', e.target.value)} />
          </label>
          <label className="form-label">
            Time
            <input type="time" className="form-input" value={form.time} onChange={e => updateField('time', e.target.value)} />
          </label>
        </div>
        <label className="form-label">
          Location / Area
          <input type="text" className="form-input" placeholder="e.g., Unit 400, Level 2" value={form.location} onChange={e => updateField('location', e.target.value)} />
        </label>
        <div className="form-row">
          <label className="form-label">
            Type
            <select className="form-input" value={form.observation_type} onChange={e => updateField('observation_type', e.target.value)}>
              <option>Planned</option>
              <option>Unplanned</option>
            </select>
          </label>
          <label className="form-label">
            Potential Severity
            <select className="form-input" value={form.severity} onChange={e => updateField('severity', e.target.value)}>
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
            </select>
          </label>
        </div>
      </div>

      {/* Category */}
      <div className="form-section">
        <h3 className="form-section-title">Category</h3>
        <div className="category-grid">
          {categories.map(cat => (
            <button key={cat} className={`category-chip ${form.category === cat ? 'chip-active' : ''}`} onClick={() => updateField('category', cat)}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Observations */}
      <div className="form-section">
        <h3 className="form-section-title">Observations</h3>
        <div className="form-label">
          ✅ Safe Behaviors Observed
          <VoiceInput value={form.safe_behaviors} onChange={v => updateField('safe_behaviors', v)} placeholder="Describe positive/safe behaviors observed..." rows={3} />
        </div>
        <div className="form-label">
          ⚠️ At-Risk Behaviors Observed
          <VoiceInput value={form.at_risk_behaviors} onChange={v => updateField('at_risk_behaviors', v)} placeholder="Describe at-risk or unsafe behaviors observed..." rows={3} />
        </div>
      </div>

      {/* Actions */}
      <div className="form-section">
        <h3 className="form-section-title">Corrective Actions</h3>
        <label className="form-label">
          Immediate Corrective Action Taken
          <VoiceInput value={form.corrective_action} onChange={v => updateField('corrective_action', v)} placeholder="What was done to correct the issue..." rows={2} />
        </label>
        <div className="form-row">
          <label className="form-label">
            Follow-Up Required?
            <select className="form-input" value={form.follow_up_required} onChange={e => updateField('follow_up_required', e.target.value)}>
              <option>No</option>
              <option>Yes</option>
            </select>
          </label>
          <label className="form-label">
            Supervisor Notified?
            <select className="form-input" value={form.supervisor_notified} onChange={e => updateField('supervisor_notified', e.target.value)}>
              <option>No</option>
              <option>Yes</option>
            </select>
          </label>
        </div>
        <label className="form-label">
          Craft / Trade of Person(s) Observed
          <input type="text" className="form-input" placeholder="e.g., Electrician, Pipefitter" value={form.persons_observed_craft} onChange={e => updateField('persons_observed_craft', e.target.value)} />
        </label>
      </div>

      {/* Notes */}
      <div className="form-section">
        <h3 className="form-section-title">Additional Notes</h3>
        <VoiceInput value={form.additional_notes} onChange={v => updateField('additional_notes', v)} placeholder="Any additional observations or context..." rows={3} />
      </div>

      {/* Submit */}
      <button className="btn-primary btn-full" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save Observation'}
      </button>
    </div>
  );
}
