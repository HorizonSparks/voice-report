import { useState, useEffect } from 'react';
import StatusBadge from '../components/forms/StatusBadge.jsx';
import CalibrationTable from '../components/forms/CalibrationTable.jsx';

export default function SubmissionView({ id, onBack }) {
  const [sub, setSub] = useState(null);

  useEffect(() => {
    fetch(`/api/forms/submissions/${id}`)
      .then(r => r.json())
      .then(setSub)
      .catch(err => console.error('Failed to load submission:', err));
  }, [id]);

  if (!sub) return <div className="loading">Loading...</div>;

  const groups = {};
  if (sub.fields) {
    for (const f of sub.fields) {
      const g = f.field_group || 'other';
      if (!groups[g]) groups[g] = [];
      groups[g].push(f);
    }
  }

  const groupLabels = {
    header: 'Project / Loop Information', device_info: 'Device Information',
    cable_info: 'Cable Information', valve_info: 'Valve Information',
    positioner: 'Positioner', setpoint: 'Setpoint / Trip Settings',
    checks: 'Verification Checks', cable_check: 'Cable Continuity Check',
    calibration: 'Calibration Verification & Loop Check',
    leak_test: 'Leak / Continuity Test', loop_check: 'Loop Check with DCS',
    client_witness: 'Client / Owner Witness',
    site_conditions: 'Site Conditions',
    comments: 'Comments', test_equipment: 'Test Equipment', signatures: 'Sign-Off',
  };

  return (
    <div className="submission-view">
      <button className="back-btn" onClick={onBack} style={{marginBottom: '12px'}}>&larr; Back</button>

      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px'}}>
        <div>
          <h2 style={{margin: 0}}>{sub.form_title || 'Form'}</h2>
          <p style={{color: 'var(--charcoal)', margin: '4px 0'}}>{sub.form_code}</p>
        </div>
        <StatusBadge status={sub.status} />
      </div>

      <div style={{background: 'white', borderRadius: '12px', padding: '16px', marginBottom: '16px'}}>
        <div><strong>Technician:</strong> {sub.technician_name}</div>
        <div><strong>Submitted:</strong> {sub.submitted_at ? new Date(sub.submitted_at).toLocaleString() : 'Draft'}</div>
        {sub.values?.tag_number && <div><strong>Tag:</strong> {sub.values.tag_number}</div>}
      </div>

      {Object.entries(groups).map(([gKey, fields]) => (
        <div key={gKey} style={{marginBottom: '16px'}}>
          <h3 style={{fontSize: '16px', fontWeight: 700, color: 'var(--charcoal)', marginBottom: '8px'}}>
            {groupLabels[gKey] || gKey}
          </h3>
          {fields.map(field => {
            const val = sub.values?.[field.field_name];
            if (val === undefined || val === null || val === '') return null;
            if (field.field_type === 'signature' && val?.startsWith('data:')) {
              return (
                <div key={field.field_name} style={{marginBottom: '8px'}}>
                  <span style={{fontSize: '13px', color: 'var(--charcoal)'}}>{field.field_label}:</span>
                  <img src={val} alt="Signature" style={{maxWidth: '200px', display: 'block', marginTop: '4px'}} />
                </div>
              );
            }
            return (
              <div key={field.field_name} style={{display: 'flex', gap: '8px', marginBottom: '4px', fontSize: '14px'}}>
                <span style={{color: 'var(--charcoal)', minWidth: '140px'}}>{field.field_label}:</span>
                <span style={{fontWeight: 500}}>{String(val)}</span>
              </div>
            );
          })}
        </div>
      ))}

      {sub.calibration_points && sub.calibration_points.length > 0 && (
        <div style={{marginBottom: '16px'}}>
          <h3 style={{fontSize: '16px', fontWeight: 700, marginBottom: '8px'}}>Calibration Data</h3>
          <CalibrationTable points={sub.calibration_points} onChange={() => {}} disabled={true} />
        </div>
      )}

      {sub.values?.photos && sub.values.photos.length > 0 && (
        <div style={{marginBottom: '16px'}}>
          <h3 style={{fontSize: '16px', fontWeight: 700, marginBottom: '8px'}}>Photos</h3>
          <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
            {sub.values.photos.map((src, i) => (
              <img key={i} src={src} alt={`Photo ${i+1}`} style={{width: '100px', height: '100px', objectFit: 'cover', borderRadius: '8px'}} />
            ))}
          </div>
        </div>
      )}

      <div style={{display: 'flex', gap: '8px', marginTop: '20px'}}>
        <button className="btn btn-secondary" onClick={() => window.print()}>Print Form</button>
      </div>
    </div>
  );
}
