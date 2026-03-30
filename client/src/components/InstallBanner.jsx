import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * iOS Safari Install Banner
 * Shows instructions for adding the app to the home screen.
 * Only appears on iOS Safari when NOT already installed as PWA.
 */
export default function InstallBanner() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Check if already dismissed
    if (localStorage.getItem('pwa-install-dismissed')) return;

    // Check if already installed as PWA
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (isStandalone) return;

    // Check if iOS Safari (or any mobile browser that supports Add to Home Screen)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent) && !/CriOS/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    // Show on iOS Safari or any mobile browser
    if ((isIOS && isSafari) || isIOS || isAndroid) {
      // Show after a short delay so it doesn't compete with login
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
    <div style={{
      position: 'fixed',
      bottom: 'env(safe-area-inset-bottom, 0px)',
      left: 0,
      right: 0,
      background: 'var(--charcoal)',
      color: 'white',
      padding: '16px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      zIndex: 9999,
      borderTop: '3px solid var(--primary)',
      boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '4px', color: 'var(--primary)' }}>
          {t('install.title', 'Install Voice Report')}
        </div>
        <div style={{ fontSize: '13px', opacity: 0.9 }}>
          {t('install.instructions', 'Tap')} <span style={{ fontSize: '16px' }}>⎙</span> {t('install.then', 'then "Add to Home Screen"')}
        </div>
      </div>
      <button
        onClick={dismiss}
        style={{
          background: 'none',
          border: '1px solid rgba(255,255,255,0.3)',
          color: 'white',
          borderRadius: '8px',
          padding: '6px 14px',
          fontSize: '13px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {t('install.dismiss', 'Got it')}
      </button>
    </div>
  );
}
