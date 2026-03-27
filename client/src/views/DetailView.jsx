import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import TabView from '../components/TabView.jsx';

export default function DetailView({ id, onBack, onHome }) {
  const { t } = useTranslation();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/reports/${id}`).then(r => r.json()).then(data => { setReport(data); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="loading">{t('common.loadingReport')}</div>;
  if (!report) return <div className="loading">{t('common.reportNotFound')}</div>;

  return (
    <div className="detail-view">
      <div className="detail-top-bar">
        <span className="detail-role-top">{report.role_title}</span>
      </div>
      <div className="detail-meta">
        <h1>{report.person_name || 'Report'}</h1>
        <span className="detail-date">{new Date(report.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — {new Date(report.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      <TabView tabs={[
        { label: 'Report', content: report.markdown_structured },
        { label: 'Original', content: report.markdown_verbatim },
        { label: 'Audio', content: null, isAudio: true, audioFile: report.audio_file },
      ]} />
    </div>
  );
}
