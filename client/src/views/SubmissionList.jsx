import { useState, useEffect } from 'react';
import StatusBadge from '../components/forms/StatusBadge.jsx';

export default function SubmissionList({ onViewSubmission, onBack }) {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/forms/submissions')
      .then(r => r.json())
      .then(data => { setSubs(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="submission-list">
      <button className="back-btn" onClick={onBack} style={{marginBottom: '12px'}}>&larr; Back</button>
      <h1>Completed Forms</h1>

      {subs.length === 0 ? (
        <p style={{color: 'var(--charcoal)', textAlign: 'center', padding: '40px 0'}}>No forms submitted yet.</p>
      ) : (
        <div className="report-list">
          {subs.map(s => (
            <button key={s.id} className="report-card" onClick={() => onViewSubmission(s.id)} style={{width: '100%', textAlign: 'left', marginBottom: '8px'}}>
              <div className="report-card-header">
                <span className="report-date" style={{fontWeight: 700}}>{s.form_code}</span>
                <StatusBadge status={s.status} />
              </div>
              <div className="report-preview">
                {s.form_title} - {s.technician_name}
                {s.submitted_at && <span style={{color: 'var(--charcoal)', marginLeft: '8px'}}>{new Date(s.submitted_at).toLocaleDateString()}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
