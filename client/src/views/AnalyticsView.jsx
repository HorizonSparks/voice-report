import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  CircularProgress,
  Tabs,
  Tab,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';

/**
 * Analytics Dashboard — Full analytics view for Control Center
 * Shows AI costs, API performance, user behavior, voice conversations
 */
export default function AnalyticsView({ goBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [dateRange, setDateRange] = useState('all');

  useEffect(() => {
    loadData();
  }, [dateRange]);

  async function loadData() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (dateRange === '7d') {
        params.set('from', new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]);
      } else if (dateRange === '30d') {
        params.set('from', new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
      } else if (dateRange === 'today') {
        params.set('from', new Date().toISOString().split('T')[0]);
      }
      // Scope to simulated company if active
      if (window.__simulatingCompanyId) params.set("company_id", window.__simulatingCompanyId);
      const res = await fetch("/api/analytics/dashboard?" + params.toString());
      if (!res.ok) throw new Error('Failed to load');
      setData(await res.json());
    } catch (e) {
      console.error('Analytics load error:', e);
    } finally {
      setLoading(false);
    }
  }

  const fmt = (n) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'K' : (n || 0);
  const fmtDollars = (cents) => '$' + (cents / 100).toFixed(2);

  if (loading) return (
    <Box sx={{ padding: '40px', textAlign: 'center', color: 'text.primary' }}>
      <CircularProgress size={24} sx={{ mr: 1 }} />
      Loading analytics...
    </Box>
  );
  if (!data) return (
    <Box sx={{ padding: '40px', textAlign: 'center', color: 'text.primary' }}>
      No analytics data available
    </Box>
  );

  const tabItems = [
    { key: 'overview', label: 'Overview' },
    { key: 'ai', label: 'AI Costs' },
    { key: 'api', label: 'API Performance' },
    { key: 'users', label: 'User Behavior' },
    { key: 'voice', label: 'Voice Conversations' },
  ];

  return (
    <Box sx={{ paddingBottom: '60px' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <Button onClick={goBack} variant="text" sx={{ fontSize: '18px', padding: '8px', minWidth: 'auto' }}>
          ← Back
        </Button>
        <Typography variant="h2" sx={{ margin: 0, color: 'text.primary', fontSize: '20px', fontWeight: 800 }}>
          Analytics
        </Typography>
      </Box>

      {/* Date Range Filter */}
      <ToggleButtonGroup
        value={dateRange}
        exclusive
        onChange={(e, val) => { if (val !== null) setDateRange(val); }}
        sx={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', '& .MuiToggleButtonGroup-grouped': { border: 'none' } }}
      >
        {[
          { key: 'today', label: 'Today' },
          { key: '7d', label: 'Last 7 Days' },
          { key: '30d', label: 'Last 30 Days' },
          { key: 'all', label: 'All Time' },
        ].map(r => (
          <ToggleButton key={r.key} value={r.key} sx={{
            padding: '6px 14px', borderRadius: '20px !important', fontSize: '12px', fontWeight: 600,
            '&.Mui-selected': {
              background: 'primary.main',
              bgcolor: 'primary.main',
              color: '#fff',
              border: '2px solid',
              borderColor: 'primary.main',
              '&:hover': { bgcolor: 'primary.dark' },
            },
            '&:not(.Mui-selected)': {
              background: 'white',
              color: 'text.primary',
              border: '2px solid',
              borderColor: 'text.primary',
            },
          }}>{r.label}</ToggleButton>
        ))}
      </ToggleButtonGroup>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(e, val) => setTab(val)}
        sx={{ marginBottom: '20px', borderBottom: '2px solid rgba(72,72,74,0.1)' }}
        variant="scrollable"
        scrollButtons="auto"
      >
        {tabItems.map(t => (
          <Tab key={t.key} value={t.key} label={t.label} sx={{
            fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap', textTransform: 'none',
          }} />
        ))}
      </Tabs>

      {/* OVERVIEW TAB */}
      {tab === 'overview' && (
        <>
          {/* Summary Cards */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '24px' }}>
            {[
              { label: 'API Calls', value: fmt(data.summary?.total_api_calls), color: 'primary.main' },
              { label: 'Unique Users', value: data.summary?.unique_users || 0, color: 'primary.main' },
              { label: 'AI Cost', value: fmtDollars(data.summary?.total_ai_cost_cents || 0), color: 'error.main' },
              { label: 'Total Tokens', value: fmt((data.costs?.by_provider || []).reduce((s, p) => s + parseInt(p.total_input_tokens || 0) + parseInt(p.total_output_tokens || 0), 0)), color: 'primary.main' },
            ].map((card, i) => (
              <Paper key={i} sx={{
                border: '2px solid', borderColor: 'text.primary', borderRadius: '12px',
                padding: '16px', textAlign: 'center',
              }}>
                <Typography sx={{ fontSize: '28px', fontWeight: 800, color: card.color }}>{card.value}</Typography>
                <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'text.primary', marginTop: '4px' }}>{card.label}</Typography>
              </Paper>
            ))}
          </Box>

          {/* Cost by Day (mini chart) */}
          {data.costs?.by_day?.length > 0 && (
            <Box sx={{ marginBottom: '24px' }}>
              <Typography variant="h3" sx={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'text.primary' }}>Daily AI Cost</Typography>
              <Paper sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '100px', borderRadius: '12px', padding: '12px', border: '1px solid rgba(72,72,74,0.1)' }}>
                {data.costs.by_day.slice(0, 14).reverse().map((day, i) => {
                  const maxCents = Math.max(...data.costs.by_day.map(d => d.total_cents || 1));
                  const h = Math.max(4, (day.total_cents / maxCents) * 80);
                  return (
                    <Box key={i} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                      <Box sx={{ width: '100%', maxWidth: '24px', height: h + 'px', bgcolor: 'primary.main', borderRadius: '4px 4px 0 0', minWidth: '6px' }} title={day.date + ': $' + (day.total_cents / 100).toFixed(2)} />
                      <Typography sx={{ fontSize: '7px', color: 'text.primary', opacity: 0.5 }}>{new Date(day.date).getDate()}</Typography>
                    </Box>
                  );
                })}
              </Paper>
            </Box>
          )}

          {/* Cost by Person (top users) */}
          {data.costs?.by_person?.length > 0 && (
            <Box sx={{ marginBottom: '24px' }}>
              <Typography variant="h3" sx={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'text.primary' }}>Top AI Users</Typography>
              {data.costs.by_person.slice(0, 8).map((p, i) => (
                <Paper key={i} sx={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px', borderRadius: '10px', marginBottom: '6px',
                  border: '1px solid rgba(72,72,74,0.1)',
                }}>
                  <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'text.primary' }}>{p.person_name || 'Unknown'}</Typography>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography component="span" sx={{ fontSize: '13px', fontWeight: 700, color: 'primary.main' }}>{fmtDollars(p.total_cost_cents)}</Typography>
                    <Typography component="span" sx={{ fontSize: '10px', color: 'text.primary', opacity: 0.6, marginLeft: '8px' }}>{p.call_count} calls</Typography>
                  </Box>
                </Paper>
              ))}
            </Box>
          )}
        </>
      )}

      {/* AI COSTS TAB */}
      {tab === 'ai' && (
        <>
          <Typography variant="h3" sx={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'text.primary' }}>Cost by Provider & Service</Typography>
          {(data.costs?.by_provider || []).map((p, i) => (
            <Paper key={i} sx={{
              padding: '14px', borderRadius: '12px', marginBottom: '8px',
              border: '1px solid rgba(72,72,74,0.1)',
            }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <Typography sx={{ fontSize: '14px', fontWeight: 700, color: 'text.primary' }}>
                  {p.provider === 'anthropic' ? '🤖 Anthropic' : '🧠 OpenAI'} — {p.service}
                </Typography>
                <Typography sx={{ fontSize: '14px', fontWeight: 800, color: 'primary.main' }}>{fmtDollars(p.total_cost_cents)}</Typography>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', fontSize: '11px', color: 'text.primary' }}>
                <Box><strong>{fmt(p.total_calls)}</strong><br/>Calls</Box>
                <Box><strong>{fmt(parseInt(p.total_input_tokens || 0))}</strong><br/>Input Tokens</Box>
                <Box><strong>{fmt(parseInt(p.total_output_tokens || 0))}</strong><br/>Output Tokens</Box>
                <Box><strong>{fmtDollars(p.avg_cost_cents || 0)}</strong><br/>Avg/Call</Box>
              </Box>
            </Paper>
          ))}

          {/* Daily breakdown */}
          {data.costs?.by_day?.length > 0 && (
            <>
              <Typography variant="h3" sx={{ margin: '20px 0 12px', fontSize: '15px', fontWeight: 700, color: 'text.primary' }}>Daily Breakdown</Typography>
              <Paper sx={{ borderRadius: '12px', border: '1px solid rgba(72,72,74,0.1)', overflow: 'hidden' }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '10px 14px', fontWeight: 700, fontSize: '11px', color: 'text.primary', borderBottom: '1px solid rgba(72,72,74,0.1)' }}>
                  <Typography component="span">Date</Typography><Typography component="span">Anthropic</Typography><Typography component="span">OpenAI</Typography><Typography component="span">Total</Typography>
                </Box>
                {data.costs.by_day.slice(0, 14).map((d, i) => (
                  <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '8px 14px', fontSize: '12px', color: 'text.primary', borderBottom: '1px solid rgba(72,72,74,0.05)' }}>
                    <Typography component="span">{new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Typography>
                    <Typography component="span">{fmtDollars(d.anthropic_cents || 0)}</Typography>
                    <Typography component="span">{fmtDollars(d.openai_cents || 0)}</Typography>
                    <Typography component="span" sx={{ fontWeight: 700 }}>{fmtDollars(d.total_cents || 0)}</Typography>
                  </Box>
                ))}
              </Paper>
            </>
          )}
        </>
      )}

      {/* API PERFORMANCE TAB */}
      {tab === 'api' && (
        <>
          <Typography variant="h3" sx={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'text.primary' }}>Endpoint Performance</Typography>
          <Paper sx={{ borderRadius: '12px', border: '1px solid rgba(72,72,74,0.1)', overflow: 'hidden' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '10px 14px', fontWeight: 700, fontSize: '11px', color: 'text.primary', borderBottom: '1px solid rgba(72,72,74,0.1)' }}>
              <Typography component="span">Endpoint</Typography><Typography component="span">Calls</Typography><Typography component="span">Avg ms</Typography><Typography component="span">Errors</Typography>
            </Box>
            {(data.api_performance?.by_endpoint || []).slice(0, 20).map((ep, i) => (
              <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '8px 14px', fontSize: '11px', color: 'text.primary', borderBottom: '1px solid rgba(72,72,74,0.05)' }}>
                <Typography component="span" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.endpoint}</Typography>
                <Typography component="span">{fmt(ep.call_count)}</Typography>
                <Typography component="span">{ep.avg_duration_ms}ms</Typography>
                <Typography component="span" sx={{ color: parseFloat(ep.error_rate_pct) > 5 ? 'error.main' : 'text.primary' }}>{ep.error_rate_pct}%</Typography>
              </Box>
            ))}
          </Paper>

          {/* Errors */}
          {data.api_performance?.errors?.length > 0 && (
            <>
              <Typography variant="h3" sx={{ margin: '20px 0 12px', fontSize: '15px', fontWeight: 700, color: 'text.primary' }}>Recent Errors</Typography>
              {data.api_performance.errors.slice(0, 10).map((err, i) => (
                <Paper key={i} sx={{
                  padding: '10px 14px', bgcolor: '#fef5f5', borderRadius: '10px', marginBottom: '6px',
                  border: '1px solid rgba(231,76,60,0.2)', fontSize: '12px',
                }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{err.endpoint}</Typography>
                    <Typography component="span" sx={{ color: 'error.main', fontWeight: 700 }}>{err.status_code} × {err.count}</Typography>
                  </Box>
                  {err.latest_error && <Typography sx={{ marginTop: '4px', color: 'text.primary', opacity: 0.7 }}>{err.latest_error}</Typography>}
                </Paper>
              ))}
            </>
          )}
        </>
      )}

      {/* USER BEHAVIOR TAB */}
      {tab === 'users' && (
        <>
          {/* Session Stats */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '24px' }}>
            {[
              { label: 'Total Sessions', value: data.user_behavior?.session_stats?.total_sessions || 0 },
              { label: 'Avg Screens/Session', value: Math.round(data.user_behavior?.session_stats?.avg_screens || 0) },
              { label: 'Avg AI Calls/Session', value: Math.round(data.user_behavior?.session_stats?.avg_ai_calls || 0) },
            ].map((s, i) => (
              <Paper key={i} sx={{
                border: '2px solid', borderColor: 'text.primary', borderRadius: '12px',
                padding: '14px', textAlign: 'center',
              }}>
                <Typography sx={{ fontSize: '24px', fontWeight: 800, color: 'primary.main' }}>{s.value}</Typography>
                <Typography sx={{ fontSize: '11px', fontWeight: 600, color: 'text.primary' }}>{s.label}</Typography>
              </Paper>
            ))}
          </Box>

          {/* Screen Views */}
          <Typography variant="h3" sx={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'text.primary' }}>Screen Views</Typography>
          {(data.user_behavior?.screen_views || []).slice(0, 15).map((sv, i) => (
            <Paper key={i} sx={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 14px', borderRadius: '10px', marginBottom: '6px',
              border: '1px solid rgba(72,72,74,0.1)',
            }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'text.primary' }}>{sv.screen}</Typography>
              <Box sx={{ textAlign: 'right', fontSize: '12px' }}>
                <Typography component="span" sx={{ fontWeight: 700, color: 'primary.main' }}>{fmt(sv.view_count)}</Typography>
                <Typography component="span" sx={{ color: 'text.primary', opacity: 0.6, marginLeft: '8px' }}>{sv.unique_users} users</Typography>
                {sv.avg_duration_ms > 0 && <Typography component="span" sx={{ color: 'text.primary', opacity: 0.6, marginLeft: '8px' }}>{sv.avg_duration_ms}ms</Typography>}
              </Box>
            </Paper>
          ))}
        </>
      )}

      {/* VOICE CONVERSATIONS TAB */}
      {tab === 'voice' && (
        <>
          {/* Funnel */}
          <Typography variant="h3" sx={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'text.primary' }}>Conversation Funnel</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '8px', marginBottom: '24px' }}>
            {Object.entries(data.voice_conversations?.refine_funnel || {}).map(([stage, count], i) => (
              <Paper key={i} sx={{
                border: '2px solid', borderColor: 'text.primary', borderRadius: '12px',
                padding: '12px', textAlign: 'center',
              }}>
                <Typography sx={{ fontSize: '22px', fontWeight: 800, color: 'primary.main' }}>{count}</Typography>
                <Typography sx={{ fontSize: '10px', fontWeight: 600, color: 'text.primary', textTransform: 'capitalize' }}>{stage.replace(/_/g, ' ')}</Typography>
              </Paper>
            ))}
          </Box>

          {/* Outcomes */}
          {Object.keys(data.voice_conversations?.outcomes || {}).length > 0 && (
            <>
              <Typography variant="h3" sx={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'text.primary' }}>Outcomes</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '24px' }}>
                {Object.entries(data.voice_conversations.outcomes).map(([outcome, count], i) => (
                  <Paper key={i} sx={{
                    padding: '12px', borderRadius: '12px',
                    border: '1px solid rgba(72,72,74,0.1)', display: 'flex', justifyContent: 'space-between',
                  }}>
                    <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'text.primary', textTransform: 'capitalize' }}>{outcome.replace(/_/g, ' ')}</Typography>
                    <Typography sx={{ fontSize: '15px', fontWeight: 800, color: 'primary.main' }}>{count}</Typography>
                  </Paper>
                ))}
              </Box>
            </>
          )}

          {/* By Context */}
          {data.voice_conversations?.by_context_type?.length > 0 && (
            <>
              <Typography variant="h3" sx={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'text.primary' }}>By Context Type</Typography>
              {data.voice_conversations.by_context_type.map((ctx, i) => (
                <Paper key={i} sx={{
                  display: 'flex', justifyContent: 'space-between', padding: '10px 14px',
                  borderRadius: '10px', marginBottom: '6px',
                  border: '1px solid rgba(72,72,74,0.1)',
                }}>
                  <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'text.primary' }}>{ctx.context_type || 'General'}</Typography>
                  <Box sx={{ fontSize: '12px', color: 'text.primary' }}>
                    <Typography component="span" sx={{ fontWeight: 700, color: 'primary.main' }}>{ctx.conversations}</Typography> convos
                    <Typography component="span" sx={{ marginLeft: '8px', opacity: 0.6 }}>~{Math.round(ctx.avg_rounds)} rounds</Typography>
                  </Box>
                </Paper>
              ))}
            </>
          )}
        </>
      )}
    </Box>
  );
}
