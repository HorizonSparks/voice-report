import { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Button, Paper, Chip, IconButton,
  CircularProgress, Stack, Tooltip, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

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

function fmtRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export default function SupportInboxPanel({ user, onBack, onOpenConversation }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'open' | 'waiting' | 'voicereport' | 'pids-app'
  const [resolvingId, setResolvingId] = useState(null);

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

  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // 30s poll — see also App.jsx for Fab badge polling
    return () => clearInterval(t);
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
            ← Back
          </Button>
        )}
        <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1 }}>
          Support Inbox
        </Typography>
        {totalUnread > 0 && (
          <Chip label={`${totalUnread} unread`} size="small" color="error" sx={{ fontWeight: 700 }} />
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={load} sx={{ color: 'text.secondary' }}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Filter chips */}
      <ToggleButtonGroup
        value={filter}
        exclusive
        onChange={(_e, v) => v && setFilter(v)}
        size="small"
        sx={{ mb: 2 }}
      >
        <ToggleButton value="all">All ({rows.length})</ToggleButton>
        <ToggleButton value="open">Open ({rows.filter(r => r.status === 'open').length})</ToggleButton>
        <ToggleButton value="waiting">Waiting ({rows.filter(r => r.status === 'waiting').length})</ToggleButton>
        <ToggleButton value="voicereport">Voice Report ({rows.filter(r => (r.app_origin || 'voicereport') === 'voicereport').length})</ToggleButton>
        <ToggleButton value="pids-app">P&IDS ({rows.filter(r => r.app_origin === 'pids-app').length})</ToggleButton>
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
          <Typography sx={{ fontWeight: 700, color: 'text.primary' }}>No support conversations</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
            When customers send a message from the floating bubble, it shows up here.
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
                      <Tooltip title={`Customer is on: ${conv.current_route}`}>
                        <Typography sx={{ fontSize: 10, color: 'text.secondary', fontFamily: 'monospace' }} noWrap>
                          {conv.current_route.length > 40 ? `${conv.current_route.slice(0, 37)}…` : conv.current_route}
                        </Typography>
                      </Tooltip>
                    )}
                    <Box sx={{ flex: 1 }} />
                    <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600 }}>
                      {fmtRelative(conv.last_message_at || conv.updated_at || conv.created_at)}
                    </Typography>
                  </Box>
                </Box>
                <Stack alignItems="flex-end" spacing={0.5} sx={{ flexShrink: 0 }}>
                  {isUnread && (
                    <Chip label={conv.unread_count} size="small" color="error" sx={{ height: 22, fontWeight: 800, fontSize: 11, minWidth: 28 }} />
                  )}
                  <Tooltip title="Mark resolved">
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`Mark conversation with ${conv.person_name || 'unknown'} as resolved`}
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
