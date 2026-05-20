import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Typography, Button, Paper, Chip, IconButton,
  CircularProgress, Stack, Tooltip, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

// Render a duration in seconds as a compact human string. Returns '—' for null.
function fmtDuration(sec) {
  if (sec == null) return '—';
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.round(n / 60)}m`;
  if (n < 86400) return `${(n / 3600).toFixed(1)}h`;
  return `${Math.round(n / 86400)}d`;
}

/**
 * SupportInboxPanel — Sparks operator's view of all open support threads.
 *
 * Lists every `support_conversations` row where status IN ('open','waiting'),
 * polls every 30s for new arrivals, and exposes a click-to-open callback that
 * pops the floating SupportChat widget (in App.jsx) targeting the chosen row.
 *
 * Sister to MessagesChatPanel.jsx but indexed by conversation, not by company.
 */
const ORIGIN_LABEL = {
  'voicereport': { label: 'Voice Report', color: 'primary' },
  'pids-app':    { label: 'P&IDS', color: 'secondary' },
};

// t() is passed in so this stays a plain function (testable + tree-shakeable)
// instead of becoming a hook.
function fmtRelative(iso, t) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return t('support.time.justNow');
  if (sec < 3600) return t('support.time.minutesAgo', { n: Math.floor(sec / 60) });
  if (sec < 86400) return t('support.time.hoursAgo', { n: Math.floor(sec / 3600) });
  return t('support.time.daysAgo', { n: Math.floor(sec / 86400) });
}

export default function SupportInboxPanel({ user, onBack, onOpenConversation }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'open' | 'waiting' | 'voicereport' | 'pids-app'
  const [resolvingId, setResolvingId] = useState(null);
  const [sla, setSla] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/support/inbox');
      if (!r.ok) {
        setError(r.status === 401 ? 'Not authorized' : `Failed to load (HTTP ${r.status})`);
        setLoading(false);
        return;
      }
      const data = await r.json();
      setRows(Array.isArray(data) ? data : []);
      setError(null);
    } catch (e) {
      setError(e.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch SLA metrics on mount + refresh every 5 min. They change slowly
  // compared to the inbox itself, so a higher cadence wastes server time.
  useEffect(() => {
    let cancelled = false;
    const loadSla = async () => {
      try {
        const r = await fetch('/api/support/sla-metrics');
        if (!r.ok || cancelled) return;
        const data = await r.json();
        if (!cancelled) setSla(data);
      } catch {
        // best-effort; missing SLA bar is acceptable degradation
      }
    };
    loadSla();
    const id = setInterval(loadSla, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000); // 30s poll — see also App.jsx for Fab badge polling
    return () => clearInterval(id);
  }, [load]);

  const handleResolve = async (id) => {
    setResolvingId(id);
    try {
      const r = await fetch(`/api/support/resolve/${id}`, { method: 'POST' });
      if (!r.ok) {
        setError(`Failed to resolve (HTTP ${r.status})`);
      } else {
        await load();
      }
    } catch (e) {
      setError(e.message || 'Failed to resolve');
    }
    setResolvingId(null);
  };

  const filtered = rows.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'open' || filter === 'waiting') return r.status === filter;
    if (filter === 'voicereport' || filter === 'pids-app') return (r.app_origin || 'voicereport') === filter;
    return true;
  });

  const totalUnread = rows.reduce((sum, r) => sum + (r.unread_count || 0), 0);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        {onBack && (
          <Button size="small" variant="outlined" onClick={onBack} sx={{ color: 'text.primary', borderColor: 'grey.300' }}>
            ← {t('support.back')}
          </Button>
        )}
        <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('support.inbox')}
        </Typography>
        {totalUnread > 0 && (
          <Chip label={t('support.unread', { count: totalUnread })} size="small" color="error" sx={{ fontWeight: 700 }} />
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t('support.refresh')}>
          <IconButton size="small" onClick={load} sx={{ color: 'text.secondary' }}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* SLA dashboard — rolled-up metrics for the last 30 days. Empty/null
          values render as '—' so a fresh-install state stays informative. */}
      {sla && (
        <Paper variant="outlined" sx={{ px: 2, py: 1.25, mb: 2, bgcolor: 'background.default' }}>
          <Stack direction="row" spacing={3} flexWrap="wrap" alignItems="center">
            <Box>
              <Typography sx={{ fontSize: 10, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('support.sla.avgFirstResponse')}
              </Typography>
              <Typography sx={{ fontSize: 15, fontWeight: 800, color: 'text.primary' }}>
                {fmtDuration(sla.avg_first_response_seconds)}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: 10, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('support.sla.resolution')}
              </Typography>
              <Typography sx={{ fontSize: 15, fontWeight: 800, color: 'text.primary' }}>
                {fmtDuration(sla.avg_resolution_seconds)}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: 10, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('support.sla.csat')}
              </Typography>
              <Typography sx={{ fontSize: 15, fontWeight: 800, color: 'text.primary' }}>
                {sla.avg_rating != null
                  ? <>{Number(sla.avg_rating).toFixed(2)} ⭐ <Typography component="span" sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 400 }}>({sla.ratings_count})</Typography></>
                  : <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', fontWeight: 400 }}>{t('support.sla.noRatings')}</Typography>}
              </Typography>
            </Box>
          </Stack>
        </Paper>
      )}

      {/* Filter chips */}
      <ToggleButtonGroup
        value={filter}
        exclusive
        onChange={(_e, v) => v && setFilter(v)}
        size="small"
        sx={{ mb: 2 }}
      >
        <ToggleButton value="all">{t('support.filterAll', { n: rows.length })}</ToggleButton>
        <ToggleButton value="open">{t('support.filterOpen', { n: rows.filter(r => r.status === 'open').length })}</ToggleButton>
        <ToggleButton value="waiting">{t('support.filterWaiting', { n: rows.filter(r => r.status === 'waiting').length })}</ToggleButton>
        <ToggleButton value="voicereport">{t('support.filterVoiceReport', { n: rows.filter(r => (r.app_origin || 'voicereport') === 'voicereport').length })}</ToggleButton>
        <ToggleButton value="pids-app">{t('support.filterPidsApp', { n: rows.filter(r => r.app_origin === 'pids-app').length })}</ToggleButton>
      </ToggleButtonGroup>

      {loading && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {error && (
        <Paper sx={{ p: 3, bgcolor: 'error.50', color: 'error.main', textAlign: 'center' }}>
          <Typography fontWeight={700}>{error}</Typography>
        </Paper>
      )}

      {!loading && !error && filtered.length === 0 && (
        <Paper sx={{ p: 6, textAlign: 'center', bgcolor: 'background.paper', border: '1px dashed', borderColor: 'grey.300' }}>
          <Typography fontSize={48} sx={{ mb: 1 }}>📭</Typography>
          <Typography sx={{ fontWeight: 700, color: 'text.primary' }}>{t('support.noConversations')}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
            {t('support.noConversationsHint')}
          </Typography>
        </Paper>
      )}

      {/* Conversation rows */}
      <Stack spacing={1}>
        {filtered.map((conv) => {
          const origin = ORIGIN_LABEL[conv.app_origin] || ORIGIN_LABEL['voicereport'];
          const isUnread = (conv.unread_count || 0) > 0;
          return (
            <Paper
              key={conv.id}
              elevation={isUnread ? 3 : 1}
              role="button"
              tabIndex={0}
              aria-label={`Open conversation with ${conv.person_name || 'unknown'}`}
              onClick={() => onOpenConversation && onOpenConversation(conv.id)}
              onKeyDown={(e) => {
                // Only react when the row itself has focus — never when a
                // bubble carries Enter/Space up from the inner resolve button.
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (onOpenConversation) onOpenConversation(conv.id);
                }
              }}
              sx={{
                outline: 'none',
                '&:focus-visible': { boxShadow: (t) => `0 0 0 3px ${t.palette.primary.main}` },
                p: 1.75,
                cursor: 'pointer',
                borderLeft: '4px solid',
                borderLeftColor: isUnread ? 'error.main' : (conv.status === 'waiting' ? 'warning.main' : 'success.main'),
                bgcolor: isUnread ? 'background.paper' : 'background.default',
                transition: 'transform 80ms ease, box-shadow 120ms ease',
                '&:hover': { transform: 'translateY(-1px)', boxShadow: 6 },
                '@media (pointer: coarse)': { minHeight: 64 },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: 14, color: 'text.primary' }} noWrap>
                      {conv.person_name || 'Unknown'}
                    </Typography>
                    {conv.person_role && (
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }} noWrap>
                        · {conv.person_role}
                      </Typography>
                    )}
                    {conv.company_name && (
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }} noWrap>
                        · {conv.company_name}
                      </Typography>
                    )}
                  </Box>
                  <Typography sx={{
                    fontSize: 13,
                    color: isUnread ? 'text.primary' : 'text.secondary',
                    fontWeight: isUnread ? 600 : 400,
                  }} noWrap>
                    {conv.last_message || '(no messages yet)'}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.75, flexWrap: 'wrap' }}>
                    <Chip
                      label={origin.label}
                      size="small"
                      color={origin.color}
                      variant="outlined"
                      sx={{ height: 20, fontSize: 10, fontWeight: 700 }}
                    />
                    <Chip
                      label={conv.status}
                      size="small"
                      color={conv.status === 'open' ? 'error' : conv.status === 'waiting' ? 'warning' : 'success'}
                      sx={{ height: 20, fontSize: 10, fontWeight: 700, textTransform: 'capitalize' }}
                    />
                    {conv.current_route && (
                      <Tooltip title={t('support.customerOn', { route: conv.current_route })}>
                        <Typography sx={{ fontSize: 10, color: 'text.secondary', fontFamily: 'monospace' }} noWrap>
                          {conv.current_route.length > 40 ? `${conv.current_route.slice(0, 37)}…` : conv.current_route}
                        </Typography>
                      </Tooltip>
                    )}
                    <Box sx={{ flex: 1 }} />
                    <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600 }}>
                      {fmtRelative(conv.last_message_at || conv.updated_at || conv.created_at, t)}
                    </Typography>
                  </Box>
                </Box>
                <Stack alignItems="flex-end" spacing={0.5} sx={{ flexShrink: 0 }}>
                  {isUnread && (
                    <Chip label={conv.unread_count} size="small" color="error" sx={{ height: 22, fontWeight: 800, fontSize: 11, minWidth: 28 }} />
                  )}
                  <Tooltip title={t('support.markResolved')}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={t('support.markResolved')}
                        disabled={resolvingId === conv.id}
                        onClick={(e) => { e.stopPropagation(); handleResolve(conv.id); }}
                        sx={{ color: 'success.main' }}
                      >
                        <CheckCircleIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              </Box>
            </Paper>
          );
        })}
      </Stack>
    </Box>
  );
}
