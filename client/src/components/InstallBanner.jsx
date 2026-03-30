import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography, Button, Paper } from '@mui/material';

export default function InstallBanner() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('pwa-install-dismissed')) return;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (isStandalone) return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent) && !/CriOS/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    if ((isIOS && isSafari) || isIOS || isAndroid) {
      const timer = setTimeout(() => setShow(true), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  if (!show) return null;

  return (
    <Paper sx={{
      position: 'fixed', bottom: 'env(safe-area-inset-bottom, 0px)',
      left: 0, right: 0, bgcolor: 'secondary.main', color: 'white',
      px: 2.5, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 1.5, zIndex: 9999, borderTop: '3px solid', borderColor: 'primary.main',
      boxShadow: '0 -4px 20px rgba(0,0,0,0.3)', borderRadius: 0,
    }}>
      <Box sx={{ flex: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 0.5, color: 'primary.main' }}>
          {t('install.title', 'Install Voice Report')}
        </Typography>
        <Typography sx={{ fontSize: 13, opacity: 0.9 }}>
          {t('install.instructions', 'Tap')} <span style={{ fontSize: '16px' }}>⎙</span> {t('install.then', 'then "Add to Home Screen"')}
        </Typography>
      </Box>
      <Button variant="outlined" onClick={dismiss}
        sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.3)', fontSize: 13, whiteSpace: 'nowrap', borderRadius: 2 }}>
        {t('install.dismiss', 'Got it')}
      </Button>
    </Paper>
  );
}
