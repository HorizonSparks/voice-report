import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, TextField, Typography, Alert, Dialog, DialogContent,
  ToggleButton, ToggleButtonGroup, Paper, CircularProgress
} from '@mui/material';

export default function LoginView({ onLogin }) {
  const { t, i18n } = useTranslation();
  const [language, setLanguage] = useState(i18n.language || 'en');
  const [showInstall, setShowInstall] = useState(false);
  const [showInstallInstructions, setShowInstallInstructions] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  const toggleLanguage = (_e, lang) => {
    if (!lang) return;
    setLanguage(lang);
    i18n.changeLanguage(lang);
    localStorage.setItem('hs_language', lang);
  };
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [faceIdAvailable, setFaceIdAvailable] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    checkFaceId();
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (!isStandalone) {
      setShowInstall(true);
    }
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
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') setShowInstall(false);
      setDeferredPrompt(null);
    } else {
      setShowInstallInstructions(true);
    }
  };

  return (
    <Box className="login-view" sx={{
      minHeight: '100vh',
      width: '100%',
      backgroundImage: 'url(/HS_image01.png)',
      backgroundSize: { xs: 'contain', md: 'cover' },
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundColor: '#FAF5EE',
      position: 'relative',
    }}>
      {/* Top bar — Sign In link */}
      <Box sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        px: { xs: 3, md: 5 },
        py: 2.5,
      }}>
        <Typography
          onClick={() => setShowLogin(true)}
          sx={{
            color: '#333',
            fontWeight: 600,
            fontSize: 15,
            cursor: 'pointer',
            letterSpacing: 0.5,
            '&:hover': { color: '#E8913A' },
            transition: 'color 0.2s',
          }}
        >
          {t('login.title', 'Sign In')}
        </Typography>
      </Box>

      {/* Login modal */}
      <Dialog
        open={showLogin}
        onClose={() => { setShowLogin(false); setError(''); setPin(''); }}
        slotProps={{
          backdrop: { sx: { backgroundColor: 'rgba(0, 0, 0, 0.3)', backdropFilter: 'blur(4px)' } },
          paper: { sx: {
            borderRadius: 3,
            p: 3,
            maxWidth: 380,
            width: '100%',
            mx: 2,
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(12px)',
          } },
        }}
      >
        <DialogContent sx={{ p: 1 }}>
          {/* Install App button */}
          {showInstall && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <Button variant="outlined" color="secondary" onClick={handleInstall} sx={{ borderRadius: 5, fontWeight: 700, fontSize: 13 }}>
                {t('install.button', 'Install App')}
              </Button>
            </Box>
          )}

          {/* Language toggle */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <ToggleButtonGroup value={language} exclusive onChange={toggleLanguage} size="small">
              <ToggleButton value="en" sx={{ px: 2, borderRadius: '20px !important', fontWeight: language === 'en' ? 700 : 400, fontSize: 14 }}>
                English
              </ToggleButton>
              <ToggleButton value="es" sx={{ px: 2, borderRadius: '20px !important', fontWeight: language === 'es' ? 700 : 400, fontSize: 14 }}>
                Español
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <Typography variant="h5" sx={{ textAlign: 'center', fontWeight: 800, letterSpacing: 3, color: '#E8913A', mb: 1 }}>
            HORIZON SPARKS
          </Typography>
          <Typography variant="h6" sx={{ textAlign: 'center', mb: 0.5 }}>{t('login.title')}</Typography>
          <Typography sx={{ textAlign: 'center', color: 'text.secondary', mb: 2, fontSize: 14 }}>{t('login.enterPin')}</Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          {faceIdAvailable && (
            <Button
              fullWidth
              variant="outlined"
              color="secondary"
              onClick={handleFaceId}
              disabled={loading}
              sx={{ mb: 2, py: 1.5, borderRadius: 3, display: 'flex', gap: 1 }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M9 11.75c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zm6 0c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8 0-.29.02-.58.05-.86 2.36-1.05 4.23-2.98 5.21-5.37C11.07 8.33 14.05 10 17.42 10c.78 0 1.53-.09 2.25-.26.21.71.33 1.47.33 2.26 0 4.41-3.59 8-8 8z"/></svg>
              <span>{t('login.faceId')}</span>
            </Button>
          )}

          {faceIdAvailable && (
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Box sx={{ flex: 1, height: '1px', bgcolor: 'grey.300' }} />
              <Typography sx={{ px: 2, color: 'text.secondary', fontSize: 13 }}>{t('login.orUsePin')}</Typography>
              <Box sx={{ flex: 1, height: '1px', bgcolor: 'grey.300' }} />
            </Box>
          )}

          <TextField
            fullWidth
            autoFocus
            type="tel"
            slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*', maxLength: 8 } }}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder={t('login.pin')}
            variant="outlined"
            sx={{ mb: 2 }}
          />

          <Button
            fullWidth
            variant="contained"
            size="large"
            onClick={handleSubmit}
            disabled={loading || !pin.trim()}
            sx={{ py: 1.5, fontSize: 16 }}
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : t('login.submit')}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Install instructions modal (iOS) */}
      <Dialog open={showInstallInstructions} onClose={() => setShowInstallInstructions(false)} slotProps={{ paper: { sx: { borderRadius: 4, p: 2, maxWidth: 340, textAlign: 'center' } } }}>
        <DialogContent>
          <Typography sx={{ fontSize: 40, mb: 1.5 }}>📲</Typography>
          <Typography variant="h6" sx={{ mb: 1, color: 'text.primary', fontWeight: 700 }}>
            {t('install.title', 'Install Voice Report')}
          </Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 14, lineHeight: 1.5, mb: 2.5 }}>
            {t('install.step1', '1. Tap the Share button')} <span style={{ fontSize: '18px' }}>⎙</span><br/>
            {t('install.step2', '2. Scroll down and tap')} <strong>"{t('install.addToHome', 'Add to Home Screen')}"</strong><br/>
            {t('install.step3', '3. Tap "Add" to confirm')}
          </Typography>
          <Button variant="contained" onClick={() => setShowInstallInstructions(false)} sx={{ px: 4 }}>
            {t('install.gotIt', 'Got it!')}
          </Button>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
