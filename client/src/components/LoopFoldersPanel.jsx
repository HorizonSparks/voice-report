import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Typography, Button, IconButton, Tooltip, CircularProgress } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';

/**
 * LoopFoldersPanel — embed PIDS-app inside Voice Report's right pane.
 *
 * Operator (Sparks staff) is chatting with a customer in the left pane.
 * This panel loads PIDS-app in an iframe scoped to that customer's company
 * so the operator can look at the customer's projects/files/loop folders
 * AND take fix actions, all without leaving the chat.
 *
 * Auth model TODAY: iframe inherits whatever Keycloak session the browser
 * already has for app.horizonsparks.ai. If none → first-load shows the
 * PIDS-app login screen, operator signs in once per browser session, done.
 *
 * URL contract (consumed by PIDS-app /feature/sparks-support-mode):
 *   ?support_mode=1
 *   &company=<id>
 *   &support_thread=<conversation_id>   (optional, for postMessage audit)
 *
 * postMessage events FROM iframe (we listen):
 *   sparks-support:ready          — PIDS-app booted; dismiss spinner
 *   sparks-support:auth-required  — no Keycloak session; show sign-in CTA
 *   sparks-support:forbidden      — session present but role missing
 *   sparks-support:context        — operator opened a file/folder
 *   sparks-support:action         — operator did a write action (parent logs)
 *   sparks-support:exit           — operator clicked "Exit support" in banner
 *
 * postMessage events TO iframe (Phase 4):
 *   sparks-support:focus-file     — VR asks PIDS to open a specific file
 *
 * See docs/SPARKS_SUPPORT_MODE.md for the full architecture + handoff items.
 */

// PIDS-app prod URL — keep in sync with .env/NEXT_PUBLIC_PIDS_URL when we wire it.
const PIDS_APP_URL = (typeof window !== 'undefined' && window.__PIDS_APP_URL) || 'https://app.horizonsparks.ai';
const ALLOWED_ORIGINS = [PIDS_APP_URL];

export default function LoopFoldersPanel({ company, supportThreadId, onAction, onExit }) {
  const iframeRef = useRef(null);
  const [loading, setLoading] = useState(true);
  // gate: 'ok' | 'auth-required' | 'forbidden'
  const [gate, setGate] = useState('ok');
  const [iframeKey, setIframeKey] = useState(0); // bump to force reload

  // Build iframe URL with support-mode params
  const iframeSrc = (() => {
    if (!company?.id) return null;
    const url = new URL(PIDS_APP_URL);
    url.searchParams.set('support_mode', '1');
    url.searchParams.set('company', company.id);
    if (supportThreadId) url.searchParams.set('support_thread', supportThreadId);
    return url.toString();
  })();

  // postMessage listener — events from PIDS-app
  useEffect(() => {
    const onMessage = (e) => {
      if (!ALLOWED_ORIGINS.includes(e.origin)) return; // origin guard
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      if (typeof msg.type !== 'string' || !msg.type.startsWith('sparks-support:')) return;

      switch (msg.type) {
        case 'sparks-support:ready':
          setLoading(false);
          setGate('ok');
          break;
        case 'sparks-support:auth-required':
          setGate('auth-required');
          setLoading(false);
          break;
        case 'sparks-support:forbidden':
          setGate('forbidden');
          setLoading(false);
          break;
        case 'sparks-support:action':
          // Bubble up so parent can log to support_conversations thread.
          if (onAction) onAction(msg);
          break;
        case 'sparks-support:context':
          // Could update a context strip in VR — Phase 4 wiring.
          break;
        case 'sparks-support:exit':
          if (onExit) onExit();
          break;
        default:
          // Unknown event from our own app — ignore quietly.
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onAction, onExit]);

  // Reset gate state when company changes
  useEffect(() => {
    setLoading(true);
    setGate('ok');
  }, [company?.id]);

  const reload = useCallback(() => {
    setIframeKey((k) => k + 1);
    setLoading(true);
    setGate('ok');
  }, []);

  const openInNewTab = useCallback(() => {
    if (iframeSrc) window.open(iframeSrc, '_blank', 'noopener,noreferrer');
  }, [iframeSrc]);

  if (!company) {
    return (
      <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
        <Typography>Select a company to view its LoopFolders.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Mini header — minimal, the iframe owns most chrome */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 0.5, bgcolor: 'rgba(249,148,64,0.06)', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          🗂️ LoopFolders · {company.name}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="Reload">
            <IconButton size="small" onClick={reload} sx={{ color: 'text.secondary' }}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Open in new tab">
            <IconButton size="small" onClick={openInNewTab} sx={{ color: 'text.secondary' }}>
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Iframe */}
      <Box sx={{ flex: 1, position: 'relative', bgcolor: 'background.default' }}>
        {loading && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,255,255,0.85)', zIndex: 2 }}>
            <Box sx={{ textAlign: 'center' }}>
              <CircularProgress size={28} />
              <Typography sx={{ mt: 1.5, fontSize: 12, color: 'text.secondary' }}>Loading LoopFolders…</Typography>
            </Box>
          </Box>
        )}
        {gate === 'auth-required' && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,255,255,0.95)', zIndex: 3 }}>
            <Box sx={{ textAlign: 'center', maxWidth: 360, p: 3 }}>
              <Typography sx={{ fontWeight: 700, mb: 1 }}>Sign into LoopFolders</Typography>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
                You need to sign in once per browser session. After that the iframe stays authenticated.
              </Typography>
              <Button variant="contained" onClick={openInNewTab}>
                Sign in (new tab)
              </Button>
            </Box>
          </Box>
        )}
        {gate === 'forbidden' && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,235,238,0.95)', zIndex: 3 }}>
            <Box sx={{ textAlign: 'center', maxWidth: 380, p: 3 }}>
              <Typography sx={{ fontWeight: 800, mb: 1, color: 'error.main' }}>
                ⛔ Not authorized
              </Typography>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
                Your LoopFolders account is signed in but doesn't have a Sparks support role
                (sparks_support, pm_admin, or admin). Contact an admin to be added.
              </Typography>
              <Button variant="outlined" onClick={openInNewTab}>
                Open LoopFolders directly
              </Button>
            </Box>
          </Box>
        )}
        <iframe
          key={iframeKey}
          ref={iframeRef}
          src={iframeSrc}
          title={`LoopFolders for ${company.name}`}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          // sandbox left wide-open — this is a trusted first-party app, not arbitrary content.
          // Adding allow-* for forms/popups/scripts in case Keycloak login uses them.
          allow="clipboard-read; clipboard-write"
          onLoad={() => {
            // We treat iframe-load as 'loaded' even if Keycloak login screen is showing,
            // because the iframe itself is reachable. The 'sparks-support:ready' postMessage
            // (sent by PIDS-app on app boot) is the better signal — but onLoad is the fallback.
            // Slight delay so the postMessage has a chance to arrive first.
            setTimeout(() => setLoading(false), 800);
          }}
        />
      </Box>
    </Box>
  );
}
