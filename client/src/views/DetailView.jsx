import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import TabView from '../components/TabView.jsx';

export default function DetailView({ id, onBack, onHome }) {
  const { t } = useTranslation();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/reports/${id}`).then(r => r.json()).then(data => { setReport(data); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return <Box className="loading" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;
  if (!report) return <Box className="loading">{t('common.reportNotFound')}</Box>;

  return (
    <Box className="detail-view">
      <Box className="detail-top-bar">
        <Typography component="span" className="detail-role-top">{report.role_title}</Typography>
      </Box>
      <Box className="detail-meta">
        <Typography variant="h4" component="h1">{report.person_name || 'Report'}</Typography>
        <Typography component="span" className="detail-date">{new Date(report.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — {new Date(report.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</Typography>
      </Box>
      <TabView tabs={[
        { label: 'Report', content: report.markdown_structured },
        { label: 'Original', content: report.markdown_verbatim },
        { label: 'Audio', content: null, isAudio: true, audioFile: report.audio_file },
      ]} />
    </Box>
  );
}
