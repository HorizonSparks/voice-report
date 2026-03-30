import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography, Button, TextField, Paper, Alert } from '@mui/material';
import ForemanDailyForm from '../components/ForemanDailyForm.jsx';
import SafetyObservationForm from '../components/SafetyObservationForm.jsx';
import FormFill from './FormFill.jsx';
import SubmissionView from './SubmissionView.jsx';
import SubmissionList from './SubmissionList.jsx';


export default function FormsHub({ user, goHome, activeTrade, readOnly }) {
  const { t } = useTranslation();
  const [activeForm, setActiveForm] = useState(null);
  const [savedFormId, setSavedFormId] = useState(null);
  const [dbTemplates, setDbTemplates] = useState([]);
  const [viewingSubmission, setViewingSubmission] = useState(null);
  const [showSubmissions, setShowSubmissions] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // Company settings state
  const [settings, setSettings] = useState(null);
  const [companyName, setCompanyName] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');
  const logoFileRef = useRef(null);

  useEffect(() => {
    fetch('/api/forms/templates')
      .then(r => r.ok ? r.json() : [])
      .then(data => setDbTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});

    // Auto-seed if no templates exist
    fetch('/api/forms/seed', { method: 'POST' })
      .then(r => r.ok ? r.json() : {})
      .then(data => {
        if (data.count > 0) {
          fetch('/api/forms/templates').then(r => r.ok ? r.json() : []).then(d => setDbTemplates(Array.isArray(d) ? d : []));
        }
      })
      .catch(() => {});

    // Load company settings
    fetch('/api/settings')
      .then(r => r.ok ? r.json() : {})
      .then(data => { setSettings(data); setCompanyName(data.company_name || ''); })
      .catch(() => {});
  }, []);

  // Filter forms to active trade ONLY
  const tradeTemplates = dbTemplates.filter(t => t.trade === activeTrade);

  const showMsg = (msg) => { setSettingsMsg(msg); setTimeout(() => setSettingsMsg(''), 3000); };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showMsg('Please select an image file (PNG, JPG, SVG).'); return; }
    if (file.size > 10 * 1024 * 1024) { showMsg('Logo must be under 10 MB.'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      setSaving(true);
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_data: reader.result, logo_filename: file.name }),
      });
      if (!res.ok) { setSaving(false); return; }
      const updated = await res.json();
      setSettings(updated);
      setSaving(false);
      showMsg('Logo uploaded successfully.');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = async () => {
    setSaving(true);
    await fetch('/api/settings/logo', { method: 'DELETE' });
    const updated = await fetch('/api/settings').then(r => r.ok ? r.json() : {});
    setSettings(updated);
    setSaving(false);
    showMsg('Logo removed.');
    if (logoFileRef.current) logoFileRef.current.value = '';
  };

  const handleSaveName = async () => {
    setSaving(true);
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name: companyName }),
    });
    if (!res.ok) { setSaving(false); return; }
    const updated = await res.json();
    setSettings(updated);
    setSaving(false);
    showMsg('Company name saved.');
  };

  // Saved form success screen
  if (savedFormId) {
    return (
      <Box className="forms-hub">
        <Box className="form-saved-banner">
          <Typography component="span" className="form-saved-icon">✅</Typography>
          <Typography variant="h3">{t('common.formSavedSuccess')}</Typography>
          <Typography>Your form has been saved.</Typography>
          <Box className="form-saved-actions">
            <Button className="btn-primary" onClick={() => { setSavedFormId(null); setActiveForm(null); setSelectedTemplate(null); }}>← {t('nav.back')}</Button>

          </Box>
        </Box>
      </Box>
    );
  }

  if (viewingSubmission) {
    return <SubmissionView id={viewingSubmission} onBack={() => setViewingSubmission(null)} />;
  }

  if (showSubmissions) {
    return <SubmissionList onViewSubmission={(id) => { setShowSubmissions(false); setViewingSubmission(id); }} onBack={() => setShowSubmissions(false)} />;
  }

  if (selectedTemplate) {
    return <FormFill templateId={selectedTemplate} user={user} onBack={() => setSelectedTemplate(null)} onSubmitted={(id) => { setSelectedTemplate(null); setViewingSubmission(id); }} />;
  }

  // Company Settings view
  if (showSettings) {
    return (
      <Box className="forms-hub">
        <Button className="back-btn" onClick={() => setShowSettings(false)}>← {t('nav.back')}</Button>
        <Typography variant="h2" sx={{ fontSize: '22px', fontWeight: 700, color: 'text.primary', marginBottom: '8px' }}>Company Settings</Typography>
        <Typography sx={{ color: 'text.primary', fontSize: '14px', marginBottom: '20px' }}>
          Configure the logo and company name that appears on all forms and in the app header.
        </Typography>

        {settingsMsg && (
          <Alert severity="info" sx={{ background: '#E8922A', color: 'text.primary', padding: '10px 16px', borderRadius: '8px', fontWeight: 600, fontSize: '14px', marginBottom: '16px', textAlign: 'center' }}>
            {settingsMsg}
          </Alert>
        )}

        {/* Logo Section */}
        <Paper sx={{ background: 'white', border: '2px solid', borderColor: 'grey.300', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
          <Typography variant="h3" sx={{ fontSize: '17px', fontWeight: 700, color: 'text.primary', margin: '0 0 8px' }}>Company Logo</Typography>
          <Typography sx={{ color: 'text.primary', fontSize: '13px', margin: '0 0 16px' }}>
            This logo appears on every form header and in the app. Upload PNG, JPG, or SVG (max 10 MB).
          </Typography>

          {/* Logo Preview */}
          <Box sx={{
            border: '2px dashed', borderColor: 'secondary.main', borderRadius: '10px', padding: '20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: '16px', minHeight: '80px', background: '#fafafa',
          }}>
            {settings?.logo_data ? (
              <Box component="img" src={settings.logo_data} alt="Company logo" sx={{ maxHeight: '80px', maxWidth: '250px', objectFit: 'contain' }} />
            ) : (
              <Typography sx={{ color: 'text.primary', fontSize: '15px', fontWeight: 600 }}>{settings?.company_name || 'No logo uploaded'}</Typography>
            )}
          </Box>

          {/* Logo Actions */}
          <Box sx={{ display: 'flex', gap: '10px' }}>
            <Button component="label" sx={{
              flex: 1, padding: '12px', background: 'primary.main', color: 'text.primary',
              borderRadius: '8px', fontSize: '14px', fontWeight: 700, textAlign: 'center',
              cursor: 'pointer',
            }}>
              {settings?.logo_data ? 'Replace Logo' : 'Upload Logo'}
              <input ref={logoFileRef} type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={handleLogoUpload} hidden />
            </Button>
            {settings?.logo_data && (
              <Button onClick={handleRemoveLogo} disabled={saving} sx={{
                flex: 1, padding: '12px', background: 'white', color: 'text.primary',
                border: '2px solid', borderColor: 'secondary.main', borderRadius: '8px', fontSize: '14px',
                fontWeight: 700, cursor: 'pointer',
              }}>
                Remove Logo
              </Button>
            )}
          </Box>
        </Paper>

        {/* Company Name Section */}
        <Paper sx={{ background: 'white', border: '2px solid', borderColor: 'grey.300', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
          <Typography variant="h3" sx={{ fontSize: '17px', fontWeight: 700, color: 'text.primary', margin: '0 0 8px' }}>Company Name</Typography>
          <Typography sx={{ color: 'text.primary', fontSize: '13px', margin: '0 0 16px' }}>
            Used as text fallback when no logo is uploaded, and in form headers.
          </Typography>
          <Box sx={{ display: 'flex', gap: '10px' }}>
            <TextField
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              placeholder="Company name"
              variant="outlined"
              sx={{
                flex: 1,
                '& .MuiOutlinedInput-root': {
                  padding: '0',
                  borderRadius: '8px',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: 'text.primary',
                  fontFamily: 'inherit',
                  '& fieldset': {
                    border: '2px solid',
                    borderColor: 'secondary.main',
                  },
                },
                '& .MuiOutlinedInput-input': {
                  padding: '12px',
                },
              }}
            />
            <Button
              onClick={handleSaveName}
              disabled={saving || companyName === (settings?.company_name || '')}
              sx={{
                padding: '12px 20px', background: 'primary.main', color: 'text.primary',
                border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700,
                cursor: 'pointer', opacity: saving || companyName === (settings?.company_name || '') ? 0.5 : 1,
              }}
            >
              Save
            </Button>
          </Box>
        </Paper>

        {/* Form Header Preview */}
        <Paper sx={{ background: 'white', border: '2px solid', borderColor: 'grey.300', borderRadius: '12px', padding: '20px' }}>
          <Typography variant="h3" sx={{ fontSize: '17px', fontWeight: 700, color: 'text.primary', margin: '0 0 12px' }}>Form Header Preview</Typography>
          <Box className="form-header-banner">
            <Box className="form-header-logo">
              {settings?.logo_data
                ? <Box component="img" src={settings.logo_data} alt="Logo" className="header-logo-img" />
                : <Typography component="span" className="header-logo-text">{settings?.company_name || 'HORIZON SPARKS'}</Typography>}
            </Box>
            <Box className="form-header-info">
              <Box className="form-header-code">HS-IC-001</Box>
              <Typography variant="h2" className="form-header-title">Transmitter Calibration & Checkout</Typography>
              <Box className="form-header-subtitle">Quality Control Field Test Report</Box>
            </Box>
          </Box>
        </Paper>
      </Box>
    );
  }

  return (
    <Box className="forms-hub">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', background: 'text.primary', borderRadius: '12px', padding: '14px 20px' }}>
        <Typography variant="h2" sx={{ margin: 0, color: 'primary.main', fontSize: '20px', fontWeight: 800 }}>
          {activeTrade} {t('common.forms')}
        </Typography>
        {/* Settings gear button */}
        {(user.is_admin || (user.role_level || 0) >= 2) && (
          <Button onClick={() => setShowSettings(true)} sx={{
            padding: '8px 16px', borderRadius: '8px', border: 'none',
            background: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 700,
            color: 'text.primary', display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            + Add Logo
          </Button>
        )}
      </Box>

      {tradeTemplates.length > 0 ? (
        <Box sx={{ marginBottom: '24px' }}>
          <Box className="forms-list">
            {tradeTemplates.map(t => (
              <Button key={t.id} className="form-card" onClick={() => setSelectedTemplate(t.id)}>
                <Box className="form-card-icon" sx={{ fontSize: '13px', fontWeight: 700, color: 'text.primary', fontFamily: "'SF Mono','Consolas',monospace", minWidth: '80px', textAlign: 'center' }}>
                  {t.form_code}
                </Box>
                <Box className="form-card-info">
                  <Typography component="span" className="form-card-title">{t.form_title}</Typography>
                  <Typography component="span" className="form-card-desc">{t.category}</Typography>
                </Box>
              </Button>
            ))}
          </Box>
        </Box>
      ) : (
        <Typography sx={{ color: 'text.primary', fontSize: '14px', padding: '20px 0', textAlign: 'center' }}>
          {t('common.noFormsAvailable')}
        </Typography>
      )}

      {/* View completed forms */}
      <Button className="btn btn-secondary" sx={{ width: '100%', padding: '12px' }} onClick={() => setShowSubmissions(true)}>
        {t('common.completedForms')}
      </Button>
    </Box>
  );
}
