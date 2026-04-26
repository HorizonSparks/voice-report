import { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Button, Paper, Chip, IconButton,
  CircularProgress, Stack, Tooltip, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

/**
 * PPEInboxPanel — Sparks operator's queue of PPE requests.
 *
 * Lists every voicereport.ppe_requests row, default filter is 'open'.
 * Click the green check to mark a request fulfilled (sparks_role >= support).
 * Polls every 30s — light load, request volume is low.
 */
function fmtRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  return Math.floor(sec / 86400) + 'd ago';
}

export default function PPEInboxPanel({ user, onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('open');
  const [fulfillingId, setFulfillingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/ppe?status=' + encodeURIComponent(filter));
      if (!r.ok) {
        setError(r.status === 401 ? 'Not authorized' : 'Failed to load (HTTP ' + r.status + ')');
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
  }, [filter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const handleFulfill = async (id) => {
    setFulfillingId(id);
    try {
      const r = await fetch('/api/ppe/' + encodeURIComponent(id) + '/fulfill', { method: 'POST' });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        setError('Fulfill failed: ' + (err.error || r.status));
      }
      await load();
    } catch (e) {
      setError('Fulfill failed: ' + e.message);
    }
    setFulfillingId(null);
  };

  const canFulfill = ['admin', 'support'].includes(user?.sparks_role);

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
          🥽 PPE Requests
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={load} sx={{ color: 'text.secondary' }}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Filter */}
      <ToggleButtonGroup
        value={filter}
        exclusive
        onChange={(_e, v) => v && setFilter(v)}
        size="small"
        sx={{ mb: 2 }}
      >
        <ToggleButton value="open">Open</ToggleButton>
        <ToggleButton value="fulfilled">Fulfilled</ToggleButton>
        <ToggleButton value="all">All</ToggleButton>
      </ToggleButtonGroup>

      {loading && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {error && (
        <Paper sx={{ p: 3, bgcolor: 'error.50', color: 'error.main', textAlign: 'center', mb: 2 }}>
          <Typography fontWeight={700}>{error}</Typography>
        </Paper>
      )}

      {!loading && !error && rows.length === 0 && (
        <Paper sx={{ p: 6, textAlign: 'center', bgcolor: 'background.paper', border: '1px dashed', borderColor: 'grey.300' }}>
          <Typography fontSize={48} sx={{ mb: 1 }}>🥽</Typography>
          <Typography sx={{ fontWeight: 700, color: 'text.primary' }}>No {filter === 'all' ? '' : filter} PPE requests</Typography>
        </Paper>
      )}

      <Stack spacing={1}>
        {rows.map(r => (
          <Paper
            key={r.id}
            elevation={r.status === 'open' ? 2 : 0}
            sx={{
              p: 1.75,
              borderLeft: '4px solid',
              borderLeftColor: r.status === 'open' ? 'warning.main' : 'success.main',
              bgcolor: r.status === 'open' ? 'background.paper' : 'background.default',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 800, fontSize: 14, color: 'text.primary' }} noWrap>
                    {r.requester_name || r.requester_id || 'Unknown requester'}
                  </Typography>
                  <Chip
                    label={r.status}
                    size="small"
                    color={r.status === 'open' ? 'warning' : 'success'}
                    sx={{ height: 20, fontSize: 10, fontWeight: 700, textTransform: 'capitalize' }}
                  />
                  <Box sx={{ flex: 1 }} />
                  <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600 }}>
                    {fmtRelative(r.created_at)}
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: 13, color: 'text.primary', whiteSpace: 'pre-line', mb: r.notes ? 0.5 : 0 }}>
                  {r.items}
                </Typography>
                {r.notes && (
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', fontStyle: 'italic' }}>
                    Note: {r.notes}
                  </Typography>
                )}
              </Box>
              {canFulfill && r.status === 'open' && (
                <Tooltip title="Mark fulfilled">
                  <span>
                    <IconButton
                      size="small"
                      disabled={fulfillingId === r.id}
                      onClick={() => handleFulfill(r.id)}
                      sx={{ color: 'success.main' }}
                    >
                      <CheckCircleIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </Box>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}
