import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export default function LoginView({ onLogin }) {
  const { t, i18n } = useTranslation();
  const [language, setLanguage] = useState(i18n.language || 'en');
  const [showInstall, setShowInstall] = useState(false);
  const [showInstallInstructions, setShowInstallInstructions] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  const toggleLanguage = (lang) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
    localStorage.setItem('hs_language', lang);
  };
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [faceIdAvailable, setFaceIdAvailable] = useState(false);

  useEffect(() => {
    // Check if Face ID / Touch ID is available
    checkFaceId();

    // Check if app is installable
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (!isStandalone) {
      setShowInstall(true);
    }

    // Listen for Android/Chrome install prompt
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const checkFaceId = async () => {
    try {
      const res = await fetch('/api/webauthn/login-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.available && window.PublicKeyCredential) {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        setFaceIdAvailable(available);
      }
    } catch (e) {}
  };

  const handleFaceId = async () => {
    try {
      setLoading(true);
      setError('');
      const optRes = await fetch('/api/webauthn/login-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const options = await optRes.json();
      if (!options.available) { setError(t('common.noFaceIdCredentials')); setLoading(false); return; }

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: Uint8Array.from(atob(options.challenge.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)),
          rpId: options.rpId,
          allowCredentials: options.allowCredentials.map(c => ({
            id: Uint8Array.from(atob(c.id.replace(/-/g,'+').replace(/_/g,'/')), ch => ch.charCodeAt(0)),
            type: c.type,
          })),
          userVerification: options.userVerification,
          timeout: options.timeout,
        }
      });

      const credId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
      const loginRes = await fetch('/api/webauthn/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential_id: credId }),
      });
      const data = await loginRes.json();
      if (loginRes.ok) onLogin(data);
      else setError(data.error || 'Face ID login failed');
    } catch (e) {
      if (e.name !== 'NotAllowedError') setError(t('login.faceIdFailed'));
    }
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!pin.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const data = await res.json();
      if (res.ok) onLogin(data);
      else { setError(data.error || 'PIN not recognized'); setPin(''); }
    } catch (e) { setError(t('common.connectionError')); }
    setLoading(false);
  };

  const handleInstall = async () => {
    if (deferredPrompt) {
      // Android/Chrome — trigger native install
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') setShowInstall(false);
      setDeferredPrompt(null);
    } else {
      // iOS — show instructions
      setShowInstallInstructions(true);
    }
  };

  return (
    <div className="login-view">
      <div className="login-card">
        {/* Install App button — top of card */}
        {showInstall && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
            <button onClick={handleInstall} style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 18px', borderRadius: '20px',
              background: "#faf8f5", color: "var(--charcoal)",
              border: "2px solid var(--charcoal)",
              fontSize: '13px', fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
            }}>
              {t('install.button', 'Install App')}
            </button>
          </div>
        )}

        {/* Install instructions modal (iOS) */}
        {showInstallInstructions && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px',
          }} onClick={() => setShowInstallInstructions(false)}>
            <div style={{
              background: 'white', borderRadius: '16px', padding: '28px',
              maxWidth: '340px', width: '100%', textAlign: 'center',
              boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
            }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📲</div>
              <h3 style={{ margin: '0 0 8px', color: 'var(--charcoal)', fontSize: '18px' }}>
                {t('install.title', 'Install Voice Report')}
              </h3>
              <p style={{ color: 'var(--charcoal)', fontSize: '14px', lineHeight: '1.5', margin: '0 0 20px' }}>
                {t('install.step1', '1. Tap the Share button')} <span style={{ fontSize: '18px' }}>⎙</span><br/>
                {t('install.step2', '2. Scroll down and tap')} <strong>"{t('install.addToHome', 'Add to Home Screen')}"</strong><br/>
                {t('install.step3', '3. Tap "Add" to confirm')}
              </p>
              <button onClick={() => setShowInstallInstructions(false)} style={{
                padding: '10px 28px', background: 'var(--primary)', color: 'white',
                border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700,
                cursor: 'pointer',
              }}>
                {t('install.gotIt', 'Got it!')}
              </button>
            </div>
          </div>
        )}

        {/* Language toggle */}
        <div style={{display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '16px'}}>
          <button onClick={() => toggleLanguage('en')}
            style={{padding: '8px 16px', borderRadius: '20px', fontSize: '14px', fontWeight: language === 'en' ? 700 : 400,
              border: language === 'en' ? '2px solid var(--primary)' : '2px solid var(--gray-200)',
              background: language === 'en' ? 'var(--charcoal)' : 'white',
              color: language === 'en' ? 'var(--primary)' : 'var(--gray-400)', cursor: 'pointer'}}>
            English
          </button>
          <button onClick={() => toggleLanguage('es')}
            style={{padding: '8px 16px', borderRadius: '20px', fontSize: '14px', fontWeight: language === 'es' ? 700 : 400,
              border: language === 'es' ? '2px solid var(--primary)' : '2px solid var(--gray-200)',
              background: language === 'es' ? 'var(--charcoal)' : 'white',
              color: language === 'es' ? 'var(--primary)' : 'var(--gray-400)', cursor: 'pointer'}}>
            Español
          </button>
        </div>

        <div className="login-brand">HORIZON SPARKS</div>
        <h2>{t('login.title')}</h2>
        <p className="login-subtitle">{t('login.enterPin')}</p>

        {error && <div className="error-banner"><span>{error}</span></div>}

        {faceIdAvailable && (
          <button className="face-id-btn" onClick={handleFaceId} disabled={loading}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M9 11.75c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zm6 0c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8 0-.29.02-.58.05-.86 2.36-1.05 4.23-2.98 5.21-5.37C11.07 8.33 14.05 10 17.42 10c.78 0 1.53-.09 2.25-.26.21.71.33 1.47.33 2.26 0 4.41-3.59 8-8 8z"/></svg>
            <span>{t('login.faceId')}</span>
          </button>
        )}

        {faceIdAvailable && <div className="login-divider"><span>{t('login.orUsePin')}</span></div>}

        <div className="pin-input-row">
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder={t('login.pin')}
            className="pin-input"
          />
        </div>

        <button className="btn btn-primary btn-lg login-btn" onClick={handleSubmit} disabled={loading || !pin.trim()}>
          {loading ? '...' : t('login.submit')}
        </button>
      </div>
    </div>
  );
}
