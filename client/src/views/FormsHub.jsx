import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import ForemanDailyForm from '../components/ForemanDailyForm.jsx';
import SafetyObservationForm from '../components/SafetyObservationForm.jsx';
import FormFill from './FormFill.jsx';
import SubmissionView from './SubmissionView.jsx';
import SubmissionList from './SubmissionList.jsx';

const TRADE_ICONS = {
  'Electrical': '⚡',
  'Instrumentation': '🔧',
  'Pipe Fitting': '🔩',
  'Industrial Erection': '🏗️',
  'Safety': '⛑️',
};

export default function FormsHub({ user, goHome, activeTrade }) {
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
      .then(r => r.json())
      .then(data => setDbTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});

    // Auto-seed if no templates exist
    fetch('/api/forms/seed', { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.count > 0) {
          fetch('/api/forms/templates').then(r => r.json()).then(d => setDbTemplates(Array.isArray(d) ? d : []));
        }
      })
      .catch(() => {});

    // Load company settings
    fetch('/api/settings')
      .then(r => r.json())
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
    const updated = await fetch('/api/settings').then(r => r.json());
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
    const updated = await res.json();
    setSettings(updated);
    setSaving(false);
    showMsg('Company name saved.');
  };

  // Saved form success screen
  if (savedFormId) {
    return (
      <div className="forms-hub">
        <div className="form-saved-banner">
          <span className="form-saved-icon">✅</span>
          <h3>{t('common.formSavedSuccess')}</h3>
          <p>Your form has been saved.</p>
          <div className="form-saved-actions">
            <button className="btn-primary" onClick={() => { setSavedFormId(null); setActiveForm(null); setSelectedTemplate(null); }}>← {t('nav.back')}</button>
            <button className="btn-secondary" onClick={goHome}>Home</button>
          </div>
        </div>
      </div>
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
      <div className="forms-hub">
        <button className="back-btn" onClick={() => setShowSettings(false)}>← {t('nav.back')}</button>
        <h2 style={{fontSize: '22px', fontWeight: 700, color: 'var(--charcoal)', marginBottom: '8px'}}>Company Settings</h2>
        <p style={{color: 'var(--charcoal)', fontSize: '14px', marginBottom: '20px'}}>
          Configure the logo and company name that appears on all forms and in the app header.
        </p>

        {settingsMsg && (
          <div style={{background: '#E8922A', color: 'var(--charcoal)', padding: '10px 16px', borderRadius: '8px', fontWeight: 600, fontSize: '14px', marginBottom: '16px', textAlign: 'center'}}>
            {settingsMsg}
          </div>
        )}

        {/* Logo Section */}
        <div style={{background: 'white', border: '2px solid #e0e0e0', borderRadius: '12px', padding: '20px', marginBottom: '16px'}}>
          <h3 style={{fontSize: '17px', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 8px'}}>Company Logo</h3>
          <p style={{color: 'var(--charcoal)', fontSize: '13px', margin: '0 0 16px'}}>
            This logo appears on every form header and in the app. Upload PNG, JPG, or SVG (max 10 MB).
          </p>

          {/* Logo Preview */}
          <div style={{
            border: '2px dashed #ccc', borderRadius: '10px', padding: '20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: '16px', minHeight: '80px', background: '#fafafa',
          }}>
            {settings?.logo_data ? (
              <img src={settings.logo_data} alt="Company logo" style={{maxHeight: '80px', maxWidth: '250px', objectFit: 'contain'}} />
            ) : (
              <span style={{color: 'var(--charcoal)', fontSize: '15px', fontWeight: 600}}>{settings?.company_name || 'No logo uploaded'}</span>
            )}
          </div>

          {/* Logo Actions */}
          <div style={{display: 'flex', gap: '10px'}}>
            <label style={{
              flex: 1, padding: '12px', background: 'var(--primary)', color: 'var(--charcoal)',
              borderRadius: '8px', fontSize: '14px', fontWeight: 700, textAlign: 'center',
              cursor: 'pointer',
            }}>
              {settings?.logo_data ? 'Replace Logo' : 'Upload Logo'}
              <input ref={logoFileRef} type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={handleLogoUpload} hidden />
            </label>
            {settings?.logo_data && (
              <button onClick={handleRemoveLogo} disabled={saving} style={{
                flex: 1, padding: '12px', background: 'white', color: 'var(--charcoal)',
                border: '2px solid #ccc', borderRadius: '8px', fontSize: '14px',
                fontWeight: 700, cursor: 'pointer',
              }}>
                Remove Logo
              </button>
            )}
          </div>
        </div>

        {/* Company Name Section */}
        <div style={{background: 'white', border: '2px solid #e0e0e0', borderRadius: '12px', padding: '20px', marginBottom: '16px'}}>
          <h3 style={{fontSize: '17px', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 8px'}}>Company Name</h3>
          <p style={{color: 'var(--charcoal)', fontSize: '13px', margin: '0 0 16px'}}>
            Used as text fallback when no logo is uploaded, and in form headers.
          </p>
          <div style={{display: 'flex', gap: '10px'}}>
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              placeholder="Company name"
              style={{
                flex: 1, padding: '12px', border: '2px solid #ccc', borderRadius: '8px',
                fontSize: '15px', fontWeight: 600, color: 'var(--charcoal)', fontFamily: 'inherit',
              }}
            />
            <button
              onClick={handleSaveName}
              disabled={saving || companyName === (settings?.company_name || '')}
              style={{
                padding: '12px 20px', background: 'var(--primary)', color: 'var(--charcoal)',
                border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700,
                cursor: 'pointer', opacity: saving || companyName === (settings?.company_name || '') ? 0.5 : 1,
              }}
            >
              Save
            </button>
          </div>
        </div>

        {/* Form Header Preview */}
        <div style={{background: 'white', border: '2px solid #e0e0e0', borderRadius: '12px', padding: '20px'}}>
          <h3 style={{fontSize: '17px', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 12px'}}>Form Header Preview</h3>
          <div className="form-header-banner">
            <div className="form-header-logo">
              {settings?.logo_data
                ? <img src={settings.logo_data} alt="Logo" className="header-logo-img" />
                : <span className="header-logo-text">{settings?.company_name || 'HORIZON SPARKS'}</span>}
            </div>
            <div className="form-header-info">
              <div className="form-header-code">HS-IC-001</div>
              <h2 className="form-header-title">Transmitter Calibration & Checkout</h2>
              <div className="form-header-subtitle">Quality Control Field Test Report</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="forms-hub">
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', background: 'var(--charcoal)', borderRadius: '12px', padding: '14px 20px'}}>
        <h2 style={{margin: 0, color: 'var(--primary)', fontSize: '20px', fontWeight: 800}}>
          {activeTrade} {t('common.forms')}
        </h2>
        {/* Settings gear button */}
        {(user.is_admin || (user.role_level || 0) >= 2) && (
          <button onClick={() => setShowSettings(true)} style={{
            padding: '8px 16px', borderRadius: '8px', border: 'none',
            background: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 700,
            color: 'var(--charcoal)', display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            + Add Logo
          </button>
        )}
      </div>

      {tradeTemplates.length > 0 ? (
        <div style={{marginBottom: '24px'}}>
          <div className="forms-list">
            {tradeTemplates.map(t => (
              <button key={t.id} className="form-card" onClick={() => setSelectedTemplate(t.id)}>
                <div className="form-card-icon" style={{fontSize: '13px', fontWeight: 700, color: 'var(--charcoal)', fontFamily: "'SF Mono','Consolas',monospace", minWidth: '80px', textAlign: 'center'}}>
                  {t.form_code}
                </div>
                <div className="form-card-info">
                  <span className="form-card-title">{t.form_title}</span>
                  <span className="form-card-desc">{t.category}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p style={{color: 'var(--charcoal)', fontSize: '14px', padding: '20px 0', textAlign: 'center'}}>
          {t('common.noFormsAvailable')}
        </p>
      )}

      {/* View completed forms */}
      <button className="btn btn-secondary" style={{width: '100%', padding: '12px'}} onClick={() => setShowSubmissions(true)}>
        {t('common.completedForms')}
      </button>
    </div>
  );
}
