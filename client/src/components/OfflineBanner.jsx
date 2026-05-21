import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Snackbar, Alert, Button } from '@mui/material';
import { subscribe, drain } from '../lib/offlineQueue.js';

/**
 * Surfaces two states to the user:
 *   - Device is offline → persistent banner so they know writes are
 *     being queued rather than silently lost.
 *   - Items are pending in the outbox → banner with a Retry action so
 *     they can force a drain instead of waiting for the 60s tick.
 *
 * Renders nothing in the common case (online + empty queue).
 */
export default function OfflineBanner() {
  const { t } = useTranslation();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => subscribe(setPending), []);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online && pending === 0) return null;

  const severity = !online ? 'warning' : 'info';
  const message = !online
    ? (pending > 0
        ? t('offline.noConnectionWithQueue', { count: pending })
        : t('offline.noConnection'))
    : t('offline.pendingSync', { count: pending });

  return (
    <Snackbar
      open
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      sx={{ bottom: { xs: 80, sm: 24 } }}
    >
      <Alert
        severity={severity}
        variant="filled"
        action={online && pending > 0 ? (
          <Button color="inherit" size="small" onClick={() => drain()}>
            {t('offline.retryNow')}
          </Button>
        ) : null}
        sx={{ width: '100%' }}
      >
        {message}
      </Alert>
    </Snackbar>
  );
}
