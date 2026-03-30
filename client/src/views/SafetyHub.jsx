import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import SafetyObservationForm from '../components/SafetyObservationForm.jsx';

// PPERequestForm placeholder - will be defined inline if needed
function PPERequestForm({ user, onBack, onSaved }) {
  const { t } = useTranslation();
  return <div style={{padding: '20px'}}><button onClick={onBack}>&larr; Back</button><p>{t('common.ppeComingSoon')}</p></div>;
}

export default function SafetyHub({ user, goHome }) {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState(null);
  const [savedFormId, setSavedFormId] = useState(null);

  if (savedFormId) {
    return (
      <div className="forms-hub">
        <div className="form-saved-banner">
          <span className="form-saved-icon">✅</span>
          <h3>{t('common.savedSuccessfully')}</h3>
          <div className="form-saved-actions">
            <button className="btn-primary" onClick={() => { setSavedFormId(null); setActiveView(null); }}>← {t('nav.back')}</button>
            
          </div>
        </div>
      </div>
    );
  }

  if (activeView === 'observation') {
    return <SafetyObservationForm user={user} onBack={() => setActiveView(null)} onSaved={(id) => setSavedFormId(id)} />;
  }

  if (activeView === 'ppe') {
    return <PPERequestForm user={user} onBack={() => setActiveView(null)} onSaved={(id) => setSavedFormId(id)} />;
  }

  return (
    <div className="forms-hub">
      <h2 className="section-heading">⛑️ Safety</h2>
      <p style={{color: 'var(--charcoal)', marginBottom: '16px', fontSize: '14px'}}>Safety tools, observations, and requests.</p>

      <div className="forms-list">
        <button className="form-card" onClick={() => setActiveView('observation')}>
          <div className="form-card-icon">⛑️</div>
          <div className="form-card-info">
            <span className="form-card-title">Safety Observation</span>
            <span className="form-card-desc">Report safe or at-risk behaviors</span>
          </div>
        </button>
        <button className="form-card" onClick={() => setActiveView('ppe')}>
          <div className="form-card-icon">🥽</div>
          <div className="form-card-info">
            <span className="form-card-title">Request PPE</span>
            <span className="form-card-desc">Request safety equipment</span>
          </div>
        </button>
        <button className="form-card" disabled>
          <div className="form-card-icon">⚠️</div>
          <div className="form-card-info">
            <span className="form-card-title">Report Concern</span>
            <span className="form-card-desc">Flag a safety concern to the safety team</span>
          </div>
          <span className="tile-badge" style={{position:'static', marginLeft:'auto'}}>Soon</span>
        </button>
        <button className="form-card" disabled>
          <div className="form-card-icon">📞</div>
          <div className="form-card-info">
            <span className="form-card-title">Safety Contacts</span>
            <span className="form-card-desc">Emergency numbers and safety team</span>
          </div>
          <span className="tile-badge" style={{position:'static', marginLeft:'auto'}}>Soon</span>
        </button>
      </div>
    </div>
  );
}
