import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export default function ListView({ user, onOpen }) {
  const { t } = useTranslation();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = user.is_admin ? '/api/reports' : `/api/reports?person_id=${user.person_id}`;
    fetch(url).then(r => r.json()).then(data => { setReports(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">{t('common.loadingReports')}</div>;

  return (
    <div className="list-view">
      <h1>{user.is_admin ? t('common.allReports') : t('common.myReports')}</h1>
      {reports.length === 0 ? (
        <div className="empty-state"><p>{t('common.noReportsYet')}</p></div>
      ) : (
        <div className="report-list">
          {reports.map(r => (
            <button key={r.id} className="report-card" onClick={() => onOpen(r.id)}>
              <div className="report-card-header">
                <span className="report-date">{new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                <span className="report-duration">{r.duration_seconds ? `${Math.floor(r.duration_seconds / 60)}m ${r.duration_seconds % 60}s` : ''}</span>
              </div>
              {user.is_admin && r.person_name && <div className="report-person">{r.person_name} — {r.role_title}</div>}
              <div className="report-preview">{r.preview || t('common.noTranscript')}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
