import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import SafetyObservationForm from '../components/SafetyObservationForm.jsx';
import PPERequestForm from '../components/PPERequestForm.jsx';

// PPERequestForm now lives in ../components/PPERequestForm.jsx (real DB-backed form)

export default function SafetyHub({ user, goHome }) {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState(null);
  const [savedFormId, setSavedFormId] = useState(null);

  if (savedFormId) {
    return (
      <Box className="forms-hub">
        <Alert severity="success" className="form-saved-banner" icon={false}>
          <Typography className="form-saved-icon" component="span">✅</Typography>
          <Typography variant="h3">{t('common.savedSuccessfully')}</Typography>
          <Box className="form-saved-actions">
            <Button className="btn-primary" onClick={() => { setSavedFormId(null); setActiveView(null); }}>← {t('nav.back')}</Button>
          </Box>
        </Alert>
      </Box>
    );
  }

  if (activeView === 'observation') {
    return <SafetyObservationForm user={user} onBack={() => setActiveView(null)} onSaved={(id) => setSavedFormId(id)} />;
  }

  if (activeView === 'ppe') {
    return <PPERequestForm user={user} onBack={() => setActiveView(null)} onSaved={(id) => setSavedFormId(id)} />;
  }

  return (
    <Box className="forms-hub">
      <Typography variant="h2" className="section-heading">⛑️ Safety</Typography>
      <Typography sx={{ color: 'text.primary', marginBottom: '16px', fontSize: '14px' }}>Safety tools, observations, and requests.</Typography>

      <Box className="forms-list">
        <Button className="form-card" onClick={() => setActiveView('observation')}>
          <Box className="form-card-icon">⛑️</Box>
          <Box className="form-card-info">
            <Typography className="form-card-title" component="span">Safety Observation</Typography>
            <Typography className="form-card-desc" component="span">Report safe or at-risk behaviors</Typography>
          </Box>
        </Button>
        <Button className="form-card" onClick={() => setActiveView('ppe')}>
          <Box className="form-card-icon">🥽</Box>
          <Box className="form-card-info">
            <Typography className="form-card-title" component="span">Request PPE</Typography>
            <Typography className="form-card-desc" component="span">Request safety equipment</Typography>
          </Box>
        </Button>
        <Button className="form-card" disabled>
          <Box className="form-card-icon">⚠️</Box>
          <Box className="form-card-info">
            <Typography className="form-card-title" component="span">Report Concern</Typography>
            <Typography className="form-card-desc" component="span">Flag a safety concern to the safety team</Typography>
          </Box>
          <Typography className="tile-badge" component="span" sx={{ position: 'static', marginLeft: 'auto' }}>Soon</Typography>
        </Button>
        <Button className="form-card" disabled>
          <Box className="form-card-icon">📞</Box>
          <Box className="form-card-info">
            <Typography className="form-card-title" component="span">Safety Contacts</Typography>
            <Typography className="form-card-desc" component="span">Emergency numbers and safety team</Typography>
          </Box>
          <Typography className="tile-badge" component="span" sx={{ position: 'static', marginLeft: 'auto' }}>Soon</Typography>
        </Button>
      </Box>
    </Box>
  );
}
