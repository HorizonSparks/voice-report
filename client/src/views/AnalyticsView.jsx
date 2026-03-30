import { useState, useEffect } from 'react';

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
      const res = await fetch('/api/analytics/dashboard?' + params.toString());
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

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--charcoal)' }}>Loading analytics...</div>;
  if (!data) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--charcoal)' }}>No analytics data available</div>;

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'ai', label: 'AI Costs' },
    { key: 'api', label: 'API Performance' },
    { key: 'users', label: 'User Behavior' },
    { key: 'voice', label: 'Voice Conversations' },
  ];

  return (
    <div style={{ paddingBottom: '60px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button onClick={goBack} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', padding: '8px' }}>
          ← Back
        </button>
        <h2 style={{ margin: 0, color: 'var(--charcoal)', fontSize: '20px', fontWeight: 800 }}>
          Analytics
        </h2>
      </div>

      {/* Date Range Filter */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {[
          { key: 'today', label: 'Today' },
          { key: '7d', label: 'Last 7 Days' },
          { key: '30d', label: 'Last 30 Days' },
          { key: 'all', label: 'All Time' },
        ].map(r => (
          <button key={r.key} onClick={() => setDateRange(r.key)} style={{
            padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            background: dateRange === r.key ? 'var(--primary)' : 'white',
            color: dateRange === r.key ? '#fff' : 'var(--charcoal)',
            border: dateRange === r.key ? '2px solid var(--primary)' : '2px solid var(--charcoal)',
          }}>{r.label}</button>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '2px solid rgba(72,72,74,0.1)', paddingBottom: '8px', overflowX: 'auto' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 16px', borderRadius: '8px 8px 0 0', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
            background: tab === t.key ? 'var(--charcoal)' : 'transparent',
            color: tab === t.key ? '#fff' : 'var(--charcoal)',
            border: 'none', whiteSpace: 'nowrap',
          }}>{t.label}</button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {tab === 'overview' && (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '24px' }}>
            {[
              { label: 'API Calls', value: fmt(data.summary?.total_api_calls), color: 'var(--primary)' },
              { label: 'Unique Users', value: data.summary?.unique_users || 0, color: 'var(--primary)' },
              { label: 'AI Cost', value: fmtDollars(data.summary?.total_ai_cost_cents || 0), color: '#e74c3c' },
              { label: 'Total Tokens', value: fmt((data.costs?.by_provider || []).reduce((s, p) => s + parseInt(p.total_input_tokens || 0) + parseInt(p.total_output_tokens || 0), 0)), color: 'var(--primary)' },
            ].map((card, i) => (
              <div key={i} style={{
                background: 'white', border: '2px solid var(--charcoal)', borderRadius: '12px',
                padding: '16px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '28px', fontWeight: 800, color: card.color }}>{card.value}</div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--charcoal)', marginTop: '4px' }}>{card.label}</div>
              </div>
            ))}
          </div>

          {/* Cost by Day (mini chart) */}
          {data.costs?.by_day?.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--charcoal)' }}>Daily AI Cost</h3>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '100px', background: 'white', borderRadius: '12px', padding: '12px', border: '1px solid rgba(72,72,74,0.1)' }}>
                {data.costs.by_day.slice(0, 14).reverse().map((day, i) => {
                  const maxCents = Math.max(...data.costs.by_day.map(d => d.total_cents || 1));
                  const h = Math.max(4, (day.total_cents / maxCents) * 80);
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                      <div style={{ width: '100%', maxWidth: '24px', height: h + 'px', background: 'var(--primary)', borderRadius: '4px 4px 0 0', minWidth: '6px' }} title={day.date + ': $' + (day.total_cents / 100).toFixed(2)} />
                      <span style={{ fontSize: '7px', color: 'var(--charcoal)', opacity: 0.5 }}>{new Date(day.date).getDate()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cost by Person (top users) */}
          {data.costs?.by_person?.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--charcoal)' }}>Top AI Users</h3>
              {data.costs.by_person.slice(0, 8).map((p, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px', background: 'white', borderRadius: '10px', marginBottom: '6px',
                  border: '1px solid rgba(72,72,74,0.1)',
                }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--charcoal)' }}>{p.person_name || 'Unknown'}</span>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary)' }}>{fmtDollars(p.total_cost_cents)}</span>
                    <span style={{ fontSize: '10px', color: 'var(--charcoal)', opacity: 0.6, marginLeft: '8px' }}>{p.call_count} calls</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* AI COSTS TAB */}
      {tab === 'ai' && (
        <>
          <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--charcoal)' }}>Cost by Provider & Service</h3>
          {(data.costs?.by_provider || []).map((p, i) => (
            <div key={i} style={{
              padding: '14px', background: 'white', borderRadius: '12px', marginBottom: '8px',
              border: '1px solid rgba(72,72,74,0.1)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--charcoal)' }}>
                  {p.provider === 'anthropic' ? '🤖 Anthropic' : '🧠 OpenAI'} — {p.service}
                </span>
                <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--primary)' }}>{fmtDollars(p.total_cost_cents)}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', fontSize: '11px', color: 'var(--charcoal)' }}>
                <div><strong>{fmt(p.total_calls)}</strong><br/>Calls</div>
                <div><strong>{fmt(parseInt(p.total_input_tokens || 0))}</strong><br/>Input Tokens</div>
                <div><strong>{fmt(parseInt(p.total_output_tokens || 0))}</strong><br/>Output Tokens</div>
                <div><strong>{fmtDollars(p.avg_cost_cents || 0)}</strong><br/>Avg/Call</div>
              </div>
            </div>
          ))}

          {/* Daily breakdown */}
          {data.costs?.by_day?.length > 0 && (
            <>
              <h3 style={{ margin: '20px 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--charcoal)' }}>Daily Breakdown</h3>
              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid rgba(72,72,74,0.1)', overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '10px 14px', fontWeight: 700, fontSize: '11px', color: 'var(--charcoal)', borderBottom: '1px solid rgba(72,72,74,0.1)' }}>
                  <span>Date</span><span>Anthropic</span><span>OpenAI</span><span>Total</span>
                </div>
                {data.costs.by_day.slice(0, 14).map((d, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '8px 14px', fontSize: '12px', color: 'var(--charcoal)', borderBottom: '1px solid rgba(72,72,74,0.05)' }}>
                    <span>{new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    <span>{fmtDollars(d.anthropic_cents || 0)}</span>
                    <span>{fmtDollars(d.openai_cents || 0)}</span>
                    <span style={{ fontWeight: 700 }}>{fmtDollars(d.total_cents || 0)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* API PERFORMANCE TAB */}
      {tab === 'api' && (
        <>
          <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--charcoal)' }}>Endpoint Performance</h3>
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid rgba(72,72,74,0.1)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '10px 14px', fontWeight: 700, fontSize: '11px', color: 'var(--charcoal)', borderBottom: '1px solid rgba(72,72,74,0.1)' }}>
              <span>Endpoint</span><span>Calls</span><span>Avg ms</span><span>Errors</span>
            </div>
            {(data.api_performance?.by_endpoint || []).slice(0, 20).map((ep, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '8px 14px', fontSize: '11px', color: 'var(--charcoal)', borderBottom: '1px solid rgba(72,72,74,0.05)' }}>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.endpoint}</span>
                <span>{fmt(ep.call_count)}</span>
                <span>{ep.avg_duration_ms}ms</span>
                <span style={{ color: parseFloat(ep.error_rate_pct) > 5 ? '#e74c3c' : 'var(--charcoal)' }}>{ep.error_rate_pct}%</span>
              </div>
            ))}
          </div>

          {/* Errors */}
          {data.api_performance?.errors?.length > 0 && (
            <>
              <h3 style={{ margin: '20px 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--charcoal)' }}>Recent Errors</h3>
              {data.api_performance.errors.slice(0, 10).map((err, i) => (
                <div key={i} style={{
                  padding: '10px 14px', background: '#fef5f5', borderRadius: '10px', marginBottom: '6px',
                  border: '1px solid rgba(231,76,60,0.2)', fontSize: '12px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700, color: 'var(--charcoal)' }}>{err.endpoint}</span>
                    <span style={{ color: '#e74c3c', fontWeight: 700 }}>{err.status_code} × {err.count}</span>
                  </div>
                  {err.latest_error && <div style={{ marginTop: '4px', color: 'var(--charcoal)', opacity: 0.7 }}>{err.latest_error}</div>}
                </div>
              ))}
            </>
          )}
        </>
      )}

      {/* USER BEHAVIOR TAB */}
      {tab === 'users' && (
        <>
          {/* Session Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '24px' }}>
            {[
              { label: 'Total Sessions', value: data.user_behavior?.session_stats?.total_sessions || 0 },
              { label: 'Avg Screens/Session', value: Math.round(data.user_behavior?.session_stats?.avg_screens || 0) },
              { label: 'Avg AI Calls/Session', value: Math.round(data.user_behavior?.session_stats?.avg_ai_calls || 0) },
            ].map((s, i) => (
              <div key={i} style={{
                background: 'white', border: '2px solid var(--charcoal)', borderRadius: '12px',
                padding: '14px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--primary)' }}>{s.value}</div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--charcoal)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Screen Views */}
          <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--charcoal)' }}>Screen Views</h3>
          {(data.user_behavior?.screen_views || []).slice(0, 15).map((sv, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 14px', background: 'white', borderRadius: '10px', marginBottom: '6px',
              border: '1px solid rgba(72,72,74,0.1)',
            }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--charcoal)' }}>{sv.screen}</span>
              <div style={{ textAlign: 'right', fontSize: '12px' }}>
                <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{fmt(sv.view_count)}</span>
                <span style={{ color: 'var(--charcoal)', opacity: 0.6, marginLeft: '8px' }}>{sv.unique_users} users</span>
                {sv.avg_duration_ms > 0 && <span style={{ color: 'var(--charcoal)', opacity: 0.6, marginLeft: '8px' }}>{sv.avg_duration_ms}ms</span>}
              </div>
            </div>
          ))}
        </>
      )}

      {/* VOICE CONVERSATIONS TAB */}
      {tab === 'voice' && (
        <>
          {/* Funnel */}
          <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--charcoal)' }}>Conversation Funnel</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '8px', marginBottom: '24px' }}>
            {Object.entries(data.voice_conversations?.refine_funnel || {}).map(([stage, count], i) => (
              <div key={i} style={{
                background: 'white', border: '2px solid var(--charcoal)', borderRadius: '12px',
                padding: '12px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--primary)' }}>{count}</div>
                <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--charcoal)', textTransform: 'capitalize' }}>{stage.replace(/_/g, ' ')}</div>
              </div>
            ))}
          </div>

          {/* Outcomes */}
          {Object.keys(data.voice_conversations?.outcomes || {}).length > 0 && (
            <>
              <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--charcoal)' }}>Outcomes</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '24px' }}>
                {Object.entries(data.voice_conversations.outcomes).map(([outcome, count], i) => (
                  <div key={i} style={{
                    padding: '12px', background: 'white', borderRadius: '12px',
                    border: '1px solid rgba(72,72,74,0.1)', display: 'flex', justifyContent: 'space-between',
                  }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--charcoal)', textTransform: 'capitalize' }}>{outcome.replace(/_/g, ' ')}</span>
                    <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--primary)' }}>{count}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* By Context */}
          {data.voice_conversations?.by_context_type?.length > 0 && (
            <>
              <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--charcoal)' }}>By Context Type</h3>
              {data.voice_conversations.by_context_type.map((ctx, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', padding: '10px 14px',
                  background: 'white', borderRadius: '10px', marginBottom: '6px',
                  border: '1px solid rgba(72,72,74,0.1)',
                }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--charcoal)' }}>{ctx.context_type || 'General'}</span>
                  <div style={{ fontSize: '12px', color: 'var(--charcoal)' }}>
                    <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{ctx.conversations}</span> convos
                    <span style={{ marginLeft: '8px', opacity: 0.6 }}>~{Math.round(ctx.avg_rounds)} rounds</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
