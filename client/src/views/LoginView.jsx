import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, TextField, Typography, Alert, Dialog, DialogContent, DialogTitle,
  ToggleButton, ToggleButtonGroup, CircularProgress
} from '@mui/material';

// ── Constants (hoisted out of render) ──

const CREAM = '#FAF5EE';
const ORANGE = '#E8913A';
const CHARCOAL = '#333';
const PHONE = '(346) 220-4606';
const PHONE_HREF = 'tel:3462204606';
const EMAIL = 'creations@horizonsparks.ai';

const PRODUCT_CARDS = [
  {
    title: 'Voice Report',
    desc: 'Your crew talks, AI structures. Daily reports, safety, punch lists — done by voice.',
  },
  {
    title: 'Loop Folders',
    desc: 'P&IDs and commissioning documents. AI extracts, organizes, and traces every instrument.',
  },
  {
    title: 'AI Agent',
    desc: 'An intelligence layer that enhances your project, your people, and your chain of command.',
  },
];

const ROLES = [
  {
    title: 'Field Workers & Journeymen',
    points: ['Talk instead of type', 'Safety captured automatically', 'Your focus stays on the job'],
  },
  {
    title: 'Foremen & Crew Leaders',
    points: ['See your whole crew\u2019s work in one view', 'Manage daily plans without chasing people', 'Spot issues before they become problems'],
  },
  {
    title: 'Project Managers & Superintendents',
    points: ['Real-time visibility into all crews and all projects', 'Data-driven decisions, not guesses', 'Commissioning progress tracked automatically'],
  },
  {
    title: 'CEOs & Company Owners',
    points: ['Full visibility across projects', 'Billing and utilization in real time', 'Scale your operations without scaling headcount'],
  },
];

const WHY_DIFFERENT = [
  'Built by people who understand industrial projects',
  'Tested with commissioning professionals before release',
  'Shaped by feedback from people who manage thousand-loop projects',
  'Voice-first design works with gloves on, not against them',
  'AI enhances, never controls \u2014 humans always decide',
];

// ── Landing page section components ──

function SectionWhatWeDo() {
  return (
    <Box sx={{ py: { xs: 6, md: 10 }, px: { xs: 3, md: 6 }, maxWidth: 1100, mx: 'auto' }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
        {PRODUCT_CARDS.map((c) => (
          <Box key={c.title} sx={{
            flex: '1 1 280px',
            maxWidth: 340,
            p: 4,
            borderRadius: 3,
            backgroundColor: '#fff',
            border: '1px solid rgba(0,0,0,0.06)',
            textAlign: 'center',
            transition: 'box-shadow 0.3s',
            '&:hover': { boxShadow: '0 8px 30px rgba(0,0,0,0.08)' },
          }}>
            <Typography variant="h6" sx={{ fontWeight: 700, color: CHARCOAL, mb: 1.5, letterSpacing: 1 }}>
              {c.title}
            </Typography>
            <Typography sx={{ color: '#555', fontSize: 15, lineHeight: 1.7 }}>
              {c.desc}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function SectionWhoItsFor() {
  return (
    <Box sx={{ py: { xs: 6, md: 10 }, px: { xs: 3, md: 6 }, backgroundColor: CREAM }}>
      <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
        <Typography variant="h5" sx={{ textAlign: 'center', fontWeight: 700, color: CHARCOAL, mb: 1, letterSpacing: 1 }}>
          Different Roles. Same Goal.
        </Typography>
        <Typography sx={{ textAlign: 'center', color: '#666', mb: 4, fontSize: 16 }}>
          Smarter work, from the field to the front office.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, justifyContent: 'center' }}>
          {ROLES.map((r) => (
            <Box key={r.title} sx={{
              flex: '1 1 240px',
              maxWidth: 260,
              p: 3,
              borderRadius: 3,
              backgroundColor: '#fff',
              border: '1px solid rgba(0,0,0,0.06)',
            }}>
              <Typography sx={{ fontWeight: 700, color: ORANGE, fontSize: 15, mb: 1.5 }}>
                {r.title}
              </Typography>
              {r.points.map((pt) => (
                <Typography key={pt} sx={{ color: '#555', fontSize: 14, lineHeight: 1.8, pl: 1, borderLeft: `2px solid ${ORANGE}`, mb: 1 }}>
                  {pt}
                </Typography>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function SectionCredibility() {
  return (
    <Box sx={{ py: { xs: 6, md: 10 }, px: { xs: 3, md: 6 } }}>
      <Box sx={{ maxWidth: 800, mx: 'auto', textAlign: 'center' }}>
        <Typography variant="h5" sx={{ fontWeight: 700, color: CHARCOAL, mb: 3, letterSpacing: 1 }}>
          Built from Real Commissioning Challenges
        </Typography>
        <Typography sx={{ color: '#555', fontSize: 16, lineHeight: 1.9, mb: 2 }}>
          We built Horizon Sparks from a deep understanding of industrial commissioning.
          This platform solves problems we have seen on real projects — fragmented documents,
          manual Loop Folder assembly, timeline delays.
        </Typography>
        <Typography sx={{ color: '#555', fontSize: 16, lineHeight: 1.9 }}>
          Tested with commissioning professionals who work these problems every day.
          Their feedback shapes every release. Because the people who have commissioned
          thousands of loops know what works.
        </Typography>
      </Box>
    </Box>
  );
}

function SectionWhyDifferent() {
  return (
    <Box sx={{ py: { xs: 6, md: 10 }, px: { xs: 3, md: 6 }, backgroundColor: CREAM }}>
      <Box sx={{ maxWidth: 800, mx: 'auto' }}>
        <Typography variant="h5" sx={{ textAlign: 'center', fontWeight: 700, color: CHARCOAL, mb: 4, letterSpacing: 1 }}>
          Why We Are Different
        </Typography>
        <Box sx={{ mb: 12 }}>
          {WHY_DIFFERENT.map((b) => (
            <Box key={b} sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: ORANGE, mt: 1, mr: 2, flexShrink: 0 }} />
              <Typography sx={{ color: '#444', fontSize: 16, lineHeight: 1.7 }}>{b}</Typography>
            </Box>
          ))}
        </Box>
        <Box sx={{ p: 4, borderRadius: 3, textAlign: 'center', border: `1px solid rgba(232,145,58,0.3)`, backgroundColor: '#fff' }}>
          <Typography sx={{ color: CHARCOAL, fontSize: 17, fontWeight: 600, mb: 1 }}>
            Ready to Work Smarter?
          </Typography>
          <Typography sx={{ color: '#666', fontSize: 15, mb: 2 }}>
            See how Horizon Sparks fits your project. Call us.
          </Typography>
          <Typography
            component="a"
            href={PHONE_HREF}
            sx={{ color: ORANGE, fontSize: 22, fontWeight: 700, textDecoration: 'none', letterSpacing: 1 }}
          >
            {PHONE}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}


function SectionFooter() {
  return (
    <Box sx={{ py: 4, px: { xs: 3, md: 6 }, backgroundColor: CHARCOAL, color: '#ccc' }}>
      <Box sx={{ maxWidth: 1100, mx: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
        <Box>
          <Typography sx={{ color: ORANGE, fontWeight: 700, fontSize: 16, letterSpacing: 2, mb: 0.5 }}>
            HORIZON SPARKS
          </Typography>
          <Typography sx={{ color: '#999', fontSize: 13 }}>Houston, Texas</Typography>
        </Box>
        <Box sx={{ textAlign: { xs: 'left', md: 'center' } }}>
          <Typography component="a" href={PHONE_HREF} sx={{ color: '#ccc', fontSize: 14, textDecoration: 'none', mr: 3 }}>
            {PHONE}
          </Typography>
          <Typography component="a" href={`mailto:${EMAIL}`} sx={{ color: '#ccc', fontSize: 14, textDecoration: 'none' }}>
            {EMAIL}
          </Typography>
        </Box>
        <Box>
          <Typography sx={{ color: '#666', fontSize: 12 }}>
            Privacy Policy · Terms of Service · Security
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

// ── Main LoginView ──

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

  // Only check Face ID when login modal opens (Codex: avoid unnecessary API call on page load)
  useEffect(() => {
    if (!showLogin) return;
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
    checkFaceId();
  }, [showLogin]);

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
    <Box sx={{ backgroundColor: CREAM }}>

      {/* ── HERO SECTION ── */}
      <Box sx={{
        minHeight: '100vh',
        width: '100%',
        backgroundImage: 'url(/HS_image01.png)',
        backgroundSize: { xs: 'contain', md: 'cover' },
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundColor: CREAM,
        position: 'relative',
      }}>
        {/* Tagline — above the orange arc */}
        <Box sx={{
          position: 'absolute',
          top: '53%',
          left: 0,
          right: 0,
          textAlign: 'center',
          px: 3,
        }}>
          <Typography sx={{
            fontSize: { xs: 16, md: 22 },
            fontWeight: 300,
            letterSpacing: 2,
            color: 'rgba(255,255,255,0.9)',
          }}>
            <Box component="span" sx={{ color: ORANGE, fontWeight: 600 }}>AI</Box>{' '}
            Layer that Enhances your Intelligence
          </Typography>
        </Box>

        {/* Top bar — Sign In button (Codex: must be a real button, not Typography) */}
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
          <Button
            variant="text"
            onClick={() => setShowLogin(true)}
            sx={{
              color: CHARCOAL,
              fontWeight: 600,
              fontSize: 20,
              letterSpacing: 0.5,
              textTransform: 'none',
              '&:hover': { color: ORANGE, backgroundColor: 'transparent' },
              transition: 'color 0.2s',
            }}
          >
            {t('login.title', 'Sign In')}
          </Button>
        </Box>
      </Box>

      {/* ── SCROLL SECTIONS ── */}
      <SectionWhatWeDo />
      <SectionWhoItsFor />
      <SectionCredibility />
      <SectionWhyDifferent />
      <SectionFooter />

      {/* ── LOGIN MODAL ── */}
      <Dialog
        open={showLogin}
        onClose={() => { setShowLogin(false); setError(''); setPin(''); }}
        aria-labelledby="login-dialog-title"
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
        <DialogTitle id="login-dialog-title" sx={{ p: 0, mb: 1 }}>
          <Typography variant="h5" sx={{ textAlign: 'center', fontWeight: 800, letterSpacing: 3, color: ORANGE }}>
            HORIZON SPARKS
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ p: 1 }}>
          {showInstall && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <Button variant="outlined" color="secondary" onClick={handleInstall} sx={{ borderRadius: 5, fontWeight: 700, fontSize: 13 }}>
                {t('install.button', 'Install App')}
              </Button>
            </Box>
          )}
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
          <Typography variant="h6" sx={{ textAlign: 'center', mb: 0.5 }}>{t('login.title')}</Typography>
          <Typography sx={{ textAlign: 'center', color: 'text.secondary', mb: 2, fontSize: 14 }}>{t('login.enterPin')}</Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {faceIdAvailable && (
            <Button fullWidth variant="outlined" color="secondary" onClick={handleFaceId} disabled={loading}
              sx={{ mb: 2, py: 1.5, borderRadius: 3, display: 'flex', gap: 1 }}>
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
            label={t('login.pin', 'PIN')}
            slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*', maxLength: 8 } }}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            variant="outlined"
            sx={{ mb: 2 }}
          />
          <Button fullWidth variant="contained" size="large" onClick={handleSubmit}
            disabled={loading || !pin.trim()} sx={{ py: 1.5, fontSize: 16 }}>
            {loading ? <CircularProgress size={24} color="inherit" /> : t('login.submit')}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Install instructions modal (iOS) */}
      <Dialog open={showInstallInstructions} onClose={() => setShowInstallInstructions(false)}
        slotProps={{ paper: { sx: { borderRadius: 4, p: 2, maxWidth: 340, textAlign: 'center' } } }}>
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
