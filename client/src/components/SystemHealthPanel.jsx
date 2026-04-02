import { useState, useEffect } from 'react';
import { Box, Typography, Paper, Chip, Button, CircularProgress } from '@mui/material';

/**
 * System Health Panel — Observability dashboard for Control Center.
 * Shows real-time metrics from Prometheus, target health, and Grafana embeds.
 */
export default function SystemHealthPanel({ onBack }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [error, setError] = useState(null);

  async function loadHealth() {
    try {
      const res = await fetch('/api/sparks/system-health');
      if (res.ok) {
        setHealth(await res.json());
        setError(null);
      } else {
        setError('Failed to load system health');
      }
    } catch (e) {
      setError('Cannot reach observability stack');
    }
    setLoading(false);
  }

  useEffect(() => {
    loadHealth();
    const interval = setInterval(loadHealth, 15000); // Refresh every 15s
    return () => clearInterval(interval);
  }, []);

  const fmt = (val, type) => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    if (type === 'percent') return (val * 100).toFixed(1) + '%';
    if (type === 'dollar') return '$' + val.toFixed(2);
    if (type === 'rate') return val.toFixed(2) + '/s';
    if (type === 'seconds') return val.toFixed(2) + 's';
    if (type === 'bytes') return (val / (1024 * 1024)).toFixed(0) + ' MB';
    if (type === 'int') return Math.round(val).toString();
    return val.toFixed(2);
  };

  const getColor = (val, thresholds) => {
    if (val === null || val === undefined) return 'text.secondary';
    if (thresholds.red && val >= thresholds.red) return '#ef5350';
    if (thresholds.yellow && val >= thresholds.yellow) return '#ff9800';
    return '#4caf50';
  };

  const grafanaDashboards = [
    { key: 'overview', label: 'Voice Report', path: 'voice-report-overview/voice-report-overview' },
    { key: 'ai', label: 'AI Operations', path: 'ai-operations/ai-operations' },
    { key: 'system', label: 'DGX Spark', path: 'system-health/system-health-dgx-spark' },
    { key: 'loopfolders', label: 'LoopFolders', path: 'loopfolders-overview/loopfolders-pipeline' },
  ];

  if (loading) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <CircularProgress size={32} />
        <Typography sx={{ mt: 2, color: 'text.secondary', fontSize: 14 }}>Loading system health...</Typography>
      </Box>
    );
  }

  const m = health?.metrics || {};

  return (
    <Box>
      <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 2 }}>
        System Health
      </Typography>

      {error && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2.5, borderColor: '#ef5350', bgcolor: 'rgba(239,83,80,0.05)' }}>
          <Typography sx={{ fontSize: 13, color: '#ef5350', fontWeight: 600 }}>{error}</Typography>
        </Paper>
      )}

      {/* Stats Header */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.25, mb: 2 }}>
        {[
          { label: 'CPU', value: fmt(m.cpu_percent, 'percent'), color: getColor(m.cpu_percent, { yellow: 0.7, red: 0.9 }) },
          { label: 'Memory', value: fmt(m.memory_percent, 'percent'), color: getColor(m.memory_percent, { yellow: 0.7, red: 0.9 }) },
          { label: 'Disk', value: fmt(m.disk_percent, 'percent'), color: getColor(m.disk_percent, { yellow: 0.7, red: 0.9 }) },
          { label: 'Services', value: `${fmt(m.targets_up, 'int')}/${fmt(m.targets_total, 'int')}`, color: m.targets_up === m.targets_total ? '#4caf50' : '#ff9800' },
        ].map((stat, i) => (
          <Paper key={i} variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600 }}>{stat.label}</Typography>
          </Paper>
        ))}
      </Box>

      {/* Second row — App metrics */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.25, mb: 2 }}>
        {[
          { label: 'Request Rate', value: fmt(m.request_rate, 'rate') },
          { label: 'Error Rate', value: fmt(m.error_rate, 'percent'), color: getColor(m.error_rate, { yellow: 0.02, red: 0.05 }) },
          { label: 'p95 Latency', value: fmt(m.p95_latency, 'seconds'), color: getColor(m.p95_latency, { yellow: 2, red: 5 }) },
          { label: 'AI Cost (24h)', value: fmt(m.ai_cost_today, 'dollar'), color: 'var(--primary)' },
        ].map((stat, i) => (
          <Paper key={i} variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 20, fontWeight: 800, color: stat.color || 'text.primary' }}>{stat.value}</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600 }}>{stat.label}</Typography>
          </Paper>
        ))}
      </Box>

      {/* Third row — DB + Agent */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.25, mb: 2 }}>
        {[
          { label: 'DB Pool', value: `${fmt(m.db_pool_total, 'int')} total / ${fmt(m.db_pool_idle, 'int')} idle` },
          { label: 'Agent Sessions (24h)', value: fmt(m.agent_sessions_today, 'int'), color: 'var(--primary)' },
          { label: 'Database Size', value: fmt(m.pg_db_size, 'bytes') },
        ].map((stat, i) => (
          <Paper key={i} variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 18, fontWeight: 800, color: stat.color || 'text.primary' }}>{stat.value}</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600 }}>{stat.label}</Typography>
          </Paper>
        ))}
      </Box>

      {/* Target Health */}
      <Typography sx={{ fontSize: 14, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
        Monitored Services ({health?.targets?.length || 0})
      </Typography>
      <Paper variant="outlined" sx={{ borderRadius: 2.5, mb: 2.5, overflow: 'hidden' }}>
        {(health?.targets || []).map((t, i) => (
          <Box key={i} sx={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            px: 2, py: 1.25,
            borderBottom: i < (health?.targets || []).length - 1 ? '1px solid rgba(72,72,74,0.08)' : 'none',
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{
                width: 10, height: 10, borderRadius: '50%',
                bgcolor: t.health === 'up' ? '#4caf50' : '#ef5350',
              }} />
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'text.primary' }}>{t.job}</Typography>
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{t.product}</Typography>
              </Box>
            </Box>
            <Chip
              label={t.health}
              size="small"
              sx={{
                fontWeight: 700, fontSize: 11,
                bgcolor: t.health === 'up' ? 'rgba(76,175,80,0.1)' : 'rgba(239,83,80,0.1)',
                color: t.health === 'up' ? '#4caf50' : '#ef5350',
              }}
            />
          </Box>
        ))}
      </Paper>

      {/* Grafana Dashboard Tabs */}
      <Typography sx={{ fontSize: 14, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
        Live Dashboards
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75, mb: 1.5, flexWrap: 'wrap' }}>
        {grafanaDashboards.map(d => (
          <Button
            key={d.key}
            size="small"
            variant={activeTab === d.key ? 'contained' : 'outlined'}
            onClick={() => setActiveTab(d.key)}
            sx={{
              fontSize: 11, fontWeight: 700, borderRadius: 2, textTransform: 'none',
              ...(activeTab === d.key ? { bgcolor: 'var(--primary)', color: '#fff' } : {}),
            }}
          >
            {d.label}
          </Button>
        ))}
        {health?.grafana_url && (
          <Button
            size="small" variant="outlined"
            onClick={() => window.open(health.grafana_url, '_blank')}
            sx={{ fontSize: 11, fontWeight: 700, borderRadius: 2, textTransform: 'none', ml: 'auto' }}
          >
            Open Grafana
          </Button>
        )}
      </Box>

      {/* Grafana iFrame — proxied through same origin to avoid mixed-content blocking */}
      {health?.grafana_url && (
        <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden', mb: 2 }}>
          <iframe
            src={`/grafana/d/${grafanaDashboards.find(d => d.key === activeTab)?.path}?orgId=1&kiosk&refresh=10s`}
            width="100%"
            height="600"
            frameBorder="0"
            style={{ border: 'none', display: 'block' }}
            title="Grafana Dashboard"
          />
        </Paper>
      )}

      {/* Quick Links */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {health?.grafana_url && (
          <Button size="small" variant="outlined" onClick={() => window.open(health.grafana_url, '_blank')}
            sx={{ fontSize: 11, borderRadius: 2, textTransform: 'none' }}>
            Grafana Dashboards
          </Button>
        )}
        {health?.glitchtip_url && (
          <Button size="small" variant="outlined" onClick={() => window.open(health.glitchtip_url, '_blank')}
            sx={{ fontSize: 11, borderRadius: 2, textTransform: 'none' }}>
            GlitchTip Errors
          </Button>
        )}
        <Button size="small" variant="outlined" onClick={loadHealth}
          sx={{ fontSize: 11, borderRadius: 2, textTransform: 'none' }}>
          Refresh
        </Button>
      </Box>
    </Box>
  );
}
