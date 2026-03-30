import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import AnalyticsView from './AnalyticsView.jsx';

/**
 * Control Center — the operating system for Horizon Sparks.
 * Only visible to users with a sparks_role.
 */
export default forwardRef(function SparksCommandCenter({ user, goBack, onEnterCompany }, ref) {
  const [screen, setScreen] = useState('dashboard'); // dashboard, companies, company-detail, team, audit, analytics
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [team, setTeam] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [error, setError] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [companyBilling, setCompanyBilling] = useState(null);
  const [allPlans, setAllPlans] = useState([]);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [companyAnalytics, setCompanyAnalytics] = useState(null);
  const [invoiceForm, setInvoiceForm] = useState({ amount: '', description: '', due_date: '' });

  // Load dashboard on mount
  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadAnalytics() {
    try {
      const res = await fetch('/api/analytics/dashboard');
      if (res.ok) setAnalyticsData(await res.json());
    } catch(e) {}
  }

  async function loadRevenue() {
    try {
      const res = await fetch('/api/billing/revenue');
      if (res.ok) setRevenue(await res.json());
    } catch(e) {}
  }

  async function loadDashboard() {
    try {
      setLoading(true);
      const res = await fetch('/api/sparks/dashboard');
      if (!res.ok) throw new Error('Failed to load dashboard');
      const data = await res.json();
      setDashboard(data);
      setError(null);
      loadAnalytics();
      loadRevenue();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadCompanyBilling(companyId) {
    try {
      const [billingRes, plansRes] = await Promise.all([
        fetch('/api/billing/company/' + companyId),
        fetch('/api/billing/plans'),
      ]);
      if (billingRes.ok) setCompanyBilling(await billingRes.json());
      if (plansRes.ok) setAllPlans(await plansRes.json());
    } catch(e) {}
  }

  async function loadCompanyAnalytics(companyId) {
    try {
      setCompanyAnalytics(null);
      const res = await fetch('/api/analytics/dashboard?company_id=' + companyId);
      if (res.ok) setCompanyAnalytics(await res.json());
    } catch(e) {}
  }

    async function changePlan(companyId, planId) {
    try {
      const res = await fetch('/api/billing/company/' + companyId + '/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (res.ok) {
        loadCompanyBilling(companyId);
        loadRevenue();
      }
    } catch(e) { setError(e.message); }
  }

  async function cancelSubscription(companyId) {
    if (!confirm('Cancel this subscription? The company will lose access at the end of the billing period.')) return;
    try {
      const res = await fetch('/api/billing/company/' + companyId + '/cancel', { method: 'POST' });
      if (res.ok) {
        loadCompanyBilling(companyId);
        loadRevenue();
      }
    } catch(e) { setError(e.message); }
  }

  async function createInvoice(companyId) {
    try {
      const res = await fetch('/api/billing/company/' + companyId + '/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_cents: Math.round(parseFloat(invoiceForm.amount) * 100),
          description: invoiceForm.description,
          due_date: invoiceForm.due_date,
        }),
      });
      if (res.ok) {
        setShowInvoiceForm(false);
        setInvoiceForm({ amount: '', description: '', due_date: '' });
        loadCompanyBilling(companyId);
      }
    } catch(e) { setError(e.message); }
  }

  async function markInvoicePaid(invoiceId, companyId) {
    try {
      const res = await fetch('/api/billing/invoice/' + invoiceId + '/pay', { method: 'POST' });
      if (res.ok) loadCompanyBilling(companyId);
    } catch(e) { setError(e.message); }
  }

  async function loadCompanies() {
    try {
      setLoading(true);
      const res = await fetch('/api/sparks/companies');
      if (!res.ok) throw new Error('Failed to load companies');
      const data = await res.json();
      setCompanies(data);
      setScreen('companies');
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadCompanyDetail(companyId) {
    try {
      setLoading(true);
      const res = await fetch('/api/sparks/companies/' + companyId);
      if (!res.ok) throw new Error('Failed to load company');
      const data = await res.json();
      setSelectedCompany(data);
      setScreen('company-detail');
      setError(null);
      loadCompanyBilling(companyId);
      loadCompanyAnalytics(companyId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTeam() {
    try {
      setLoading(true);
      const res = await fetch('/api/sparks/team');
      if (!res.ok) throw new Error('Failed to load team');
      const data = await res.json();
      setTeam(data);
      setScreen('team');
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadAudit() {
    try {
      setLoading(true);
      const res = await fetch('/api/sparks/audit');
      if (!res.ok) throw new Error('Failed to load audit log');
      const data = await res.json();
      setAudit(data);
      setScreen('audit');
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleTrade(companyId, trade, currentStatus) {
    try {
      if (currentStatus === 'active') {
        await fetch('/api/sparks/companies/' + companyId + '/trades/' + encodeURIComponent(trade), { method: 'DELETE' });
      } else {
        await fetch('/api/sparks/companies/' + companyId + '/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trade }),
        });
      }
      loadCompanyDetail(companyId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleProduct(companyId, product, currentStatus) {
    try {
      if (currentStatus === 'active') {
        await fetch('/api/sparks/companies/' + companyId + '/products/' + product, { method: 'DELETE' });
      } else {
        await fetch('/api/sparks/companies/' + companyId + '/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product }),
        });
      }
      loadCompanyDetail(companyId);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleBack() {
    if (screen === 'company-detail') { loadCompanies(); return; }
    if (screen !== 'dashboard') { setScreen('dashboard'); return; }
    if (goBack) goBack();
  }

  // Expose tryGoBack to App.jsx's goBack() via ref
  useImperativeHandle(ref, () => ({
    tryGoBack() {
      if (screen === 'company-detail') { loadCompanies(); return true; }
      if (screen !== 'dashboard') { setScreen('dashboard'); return true; }
      return false;
    },
    tryGoHome() {
      if (screen !== 'dashboard') { setScreen('dashboard'); return true; }
      return false;
    }
  }));

  const roleColors = { admin: '#e74c3c', support: '#3498db', collaborator: '#2ecc71', advisor: '#f39c12' };
  const statusColors = { active: '#2ecc71', trial: '#f39c12', suspended: '#e74c3c', churned: '#95a5a6' };

  const fmtMRR = (cents) => {
    if (!cents) return '$0';
    if (cents >= 100000) return '$' + (cents / 100000).toFixed(1) + 'K';
    return '$' + (cents / 100).toFixed(0);
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="list-view" style={{ paddingBottom: '100px', paddingTop: '0' }}>

      {/* Header */}
      <div style={{ marginBottom: '10px', marginTop: '-20px', textAlign: 'center' }}>
        <h2 style={{ margin: 0, color: 'var(--charcoal)', fontSize: '32px', fontWeight: 800 }}>
          Control Center
        </h2>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--primary)', fontWeight: 600 }}>
          {user.sparks_role?.toUpperCase()} ACCESS
        </p>
      </div>

      {error && (
        <div style={{ background: '#fee', color: '#c00', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
          {error}
        </div>
      )}
      {/* DASHBOARD SCREEN */}
      {screen === 'dashboard' && dashboard && (
        <>
          {/* Stats Row */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '60px', marginBottom: '35px', justifyContent: 'center' }}>
            {[
              { label: 'Companies', value: dashboard.active_companies, sub: dashboard.total_companies + ' total' },
              { label: 'People', value: dashboard.total_people, sub: 'active' },
              { label: 'Errors', value: dashboard.recent_errors, sub: dashboard.recent_errors === 0 ? 'all clear' : 'attention' },
              { label: 'Projects', value: dashboard.active_projects || 0, sub: 'active' },
              { label: 'Online', value: dashboard.online_users || 0, sub: '24h' },
              { label: 'Uptime', value: dashboard.uptime || '\u2014', sub: 'server' },
              { label: 'MRR', value: revenue ? fmtMRR(revenue.mrr_cents) : '\u2014', sub: 'revenue' },
              { label: 'Subscriptions', value: revenue ? revenue.active_subscriptions : '\u2014', sub: 'active' },
            ].map((stat, i) => (
              <div key={i} style={{
                background: 'white', border: '2px solid var(--charcoal)', borderRadius: '10px', padding: '8px',
                width: '90px', height: '90px',
                display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center',
              }}>
                <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>{stat.value}</div>
                <div style={{ fontSize: '11px', fontWeight: 700, marginTop: '4px', color: 'var(--charcoal)' }}>{stat.label}</div>
                <div style={{ fontSize: '9px', opacity: 0.6, marginTop: '1px', color: 'var(--charcoal)' }}>{stat.sub}</div>
              </div>
            ))}
          </div>

          {/* Two-Column Layout: Analytics left, Tiles + Companies right */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>

            {/* LEFT: Inline Analytics */}
            <div>

              {analyticsData ? (() => {
                const fmt = (n) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'K' : (n || 0);
                const fmtD = (cents) => '$' + (cents / 100).toFixed(2);
                return (
                  <>
                    <h3 style={{ fontSize: "18px", fontWeight: 800, color: "var(--charcoal)", textTransform: "uppercase", letterSpacing: "1px", margin: "0 0 12px" }}>Analytics</h3>
                    {/* Summary Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                      {[
                        { label: 'API Calls', value: fmt(analyticsData.summary?.total_api_calls), color: 'var(--primary)' },
                        { label: 'AI Cost', value: fmtD(analyticsData.summary?.total_ai_cost_cents || 0), color: 'var(--charcoal)' },
                        { label: 'Unique Users', value: analyticsData.summary?.unique_users || 0, color: 'var(--primary)' },
                        { label: 'Total Tokens', value: fmt((analyticsData.costs?.by_provider || []).reduce((s, p) => s + parseInt(p.total_input_tokens || 0) + parseInt(p.total_output_tokens || 0), 0)), color: 'var(--primary)' },
                      ].map((card, i) => (
                        <div key={i} style={{
                          background: 'white', border: '1px solid rgba(72,72,74,0.1)', borderRadius: '10px',
                          padding: '12px', textAlign: 'center',
                        }}>
                          <div style={{ fontSize: '20px', fontWeight: 800, color: card.color }}>{card.value}</div>
                          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--charcoal)' }}>{card.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Cost by Provider */}
                    {(analyticsData.costs?.by_provider || []).map((p, i) => (
                      <div key={i} style={{
                        padding: '10px', background: 'white', borderRadius: '10px', marginBottom: '6px',
                        border: '1px solid rgba(72,72,74,0.1)', fontSize: '11px',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 700, color: 'var(--charcoal)' }}>
                            {p.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} {'\u2014'} {p.service}
                          </span>
                          <span style={{ fontWeight: 800, color: 'var(--primary)' }}>{fmtD(p.total_cost_cents)}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '12px', color: 'var(--charcoal)', opacity: 0.7 }}>
                          <span>{fmt(p.total_calls)} calls</span>
                          <span>{fmt(parseInt(p.total_input_tokens || 0))} in</span>
                          <span>{fmt(parseInt(p.total_output_tokens || 0))} out</span>
                        </div>
                      </div>
                    ))}

                    {/* Daily Cost Mini Chart */}
                    {analyticsData.costs?.by_day?.length > 0 && (
                      <div style={{ marginTop: '12px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--charcoal)', marginBottom: '6px' }}>Daily Cost (last 14 days)</div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '60px', background: 'white', borderRadius: '8px', padding: '8px', border: '1px solid rgba(72,72,74,0.1)' }}>
                          {analyticsData.costs.by_day.slice(0, 14).reverse().map((day, i) => {
                            const maxCents = Math.max(...analyticsData.costs.by_day.map(d => d.total_cents || 1));
                            const h = Math.max(3, (day.total_cents / maxCents) * 50);
                            return (
                              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}>
                                <div style={{ width: '100%', maxWidth: '16px', height: h + 'px', background: 'var(--primary)', borderRadius: '3px 3px 0 0', minWidth: '4px' }} title={day.date + ': $' + (day.total_cents / 100).toFixed(2)} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Top AI Users */}
                    {analyticsData.costs?.by_person?.length > 0 && (
                      <div style={{ marginTop: '12px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--charcoal)', marginBottom: '6px' }}>Top AI Users</div>
                        {analyticsData.costs.by_person.slice(0, 5).map((p, i) => (
                          <div key={i} style={{
                            display: 'flex', justifyContent: 'space-between', padding: '6px 10px',
                            background: 'white', borderRadius: '8px', marginBottom: '4px',
                            border: '1px solid rgba(72,72,74,0.1)', fontSize: '11px',
                          }}>
                            <span style={{ fontWeight: 600, color: 'var(--charcoal)' }}>{p.person_name || 'Unknown'}</span>
                            <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{fmtD(p.total_cost_cents)} ({p.call_count})</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Full Analytics Link */}
                    <button onClick={() => setScreen('analytics')} style={{
                      marginTop: '12px', width: '100%', padding: '10px', borderRadius: '10px',
                      background: 'var(--charcoal)', color: '#fff', border: 'none', cursor: 'pointer',
                      fontSize: '12px', fontWeight: 700,
                    }}>
                      View Full Analytics {'\u2192'}
                    </button>
                  </>
                );
              })() : (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--charcoal)', opacity: 0.5, fontSize: '12px' }}>Loading analytics...</div>
              )}
            </div>

            {/* RIGHT: Navigation + Companies */}
            <div>
              <h3 style={{ fontSize: "18px", fontWeight: 800, color: "var(--charcoal)", textTransform: "uppercase", letterSpacing: "1px", margin: "0 0 12px" }}>Operations</h3>
              {/* Navigation Tiles */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                {[
                  { label: 'Companies', icon: '\uD83C\uDFE2', action: loadCompanies, show: ['admin', 'support'].includes(user.sparks_role) },
                  { label: 'Team', icon: '\uD83D\uDC65', action: loadTeam, show: true },
                  { label: 'Audit Log', icon: '\uD83D\uDCCB', action: loadAudit, show: user.sparks_role === 'admin' },
                  { label: 'Messages', icon: '\uD83D\uDCAC', action: () => {}, show: true, disabled: true },
                ].filter(t => t.show).map((tile, i) => (
                  <button key={i} onClick={tile.action} disabled={tile.disabled} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: '16px', borderRadius: '12px', cursor: tile.disabled ? 'default' : 'pointer',
                    background: tile.disabled ? 'var(--gray-100)' : 'white',
                    border: '2px solid var(--gray-200)',
                    opacity: tile.disabled ? 0.5 : 1, minHeight: '70px',
                  }}>
                    <span style={{ fontSize: '22px', marginBottom: '4px' }}>{tile.icon}</span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)' }}>{tile.label}</span>
                    {tile.disabled && <span style={{ fontSize: '9px', color: 'var(--charcoal)', opacity: 0.5 }}>coming soon</span>}
                  </button>
                ))}
              </div>

              {/* Per-Company Breakdown */}
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
                Company Activity
              </h3>
              {dashboard.companies.map(c => (
                <div key={c.id} onClick={() => ['admin', 'support'].includes(user.sparks_role) && loadCompanyDetail(c.id)} style={{
                  background: 'white', borderRadius: '10px', padding: '12px',
                  border: '2px solid var(--gray-200)', marginBottom: '8px',
                  cursor: ['admin', 'support'].includes(user.sparks_role) ? 'pointer' : 'default',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--charcoal)', fontSize: '14px' }}>{c.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--charcoal)', opacity: 0.6 }}>
                      {c.people} people {'\u00B7'} {c.total_reports} reports
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--primary)' }}>{c.today_reports}</div>
                    <div style={{ fontSize: '9px', color: 'var(--charcoal)', opacity: 0.5 }}>today</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}


      {/* COMPANIES LIST SCREEN */}
      {screen === 'companies' && (
        <>
          <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
            All Companies ({companies.length})
          </h3>
          {companies.map(c => (
            <div key={c.id} onClick={() => loadCompanyDetail(c.id)} style={{
              background: 'white', borderRadius: '10px', padding: '14px',
              border: '2px solid var(--gray-200)', marginBottom: '8px', cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ fontWeight: 700, color: 'var(--charcoal)', fontSize: '16px' }}>{c.name}</div>
                <span style={{
                  fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px',
                  background: statusColors[c.status] || '#ccc', color: 'white',
                }}>{c.status}</span>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {(c.products || []).map(p => (
                  <span key={p} style={{
                    fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '6px',
                    background: 'var(--charcoal)', color: 'var(--primary)',
                  }}>{p === 'voice_report' ? 'Voice Report' : 'Relation Data / LoopFolders'}</span>
                ))}
                {(c.trades || []).map(t => (
                  <span key={t} style={{
                    fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '6px',
                    background: 'var(--gray-100)', color: 'var(--charcoal)',
                  }}>{t}</span>
                ))}
              </div>
              <div style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
                {c.people_count} people {'\u00B7'} {c.report_count} reports
              </div>
            </div>
          ))}
        </>
      )}

      {/* COMPANY DETAIL SCREEN */}
      {screen === 'company-detail' && selectedCompany && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div style={{ gridColumn: '1 / -1', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <h3 style={{ margin: 0, color: 'var(--charcoal)', fontSize: '18px', fontWeight: 800 }}>
                {selectedCompany.name}
              </h3>
              {onEnterCompany && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => onEnterCompany({ id: selectedCompany.id, name: selectedCompany.name, mode: 'customer' })}
                    style={{
                      padding: '8px 18px',
                      background: 'var(--charcoal)',
                      color: 'var(--primary)', border: '1px solid var(--primary)',
                      borderRadius: '20px', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
                    }}>
                    View as Customer
                  </button>
                  <button onClick={() => onEnterCompany({ id: selectedCompany.id, name: selectedCompany.name, mode: 'support' })}
                    style={{
                      padding: '8px 18px',
                      background: 'white',
                      color: '#4ade80', border: '1px solid #4ade80',
                      borderRadius: '20px', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
                    }}>
                    Customer Service
                  </button>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px',
                background: statusColors[selectedCompany.status], color: 'white',
              }}>{selectedCompany.status}</span>
              <span style={{ fontSize: '12px', color: '#666' }}>Tier: {selectedCompany.tier}</span>
              <span style={{ fontSize: '12px', color: '#666' }}>{selectedCompany.total_reports} reports</span>
            </div>
          </div>



          {/* Products */}
          <h4 style={{ gridColumn: '1 / -1', fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>
            Licensed Products
          </h4>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {['voice_report', 'relation_data'].map(product => {
              const licensed = (selectedCompany.products || []).find(p => p.product === product);
              const isActive = licensed && licensed.status === 'active';
              return (
                <button key={product} onClick={() => user.sparks_role === 'admin' && toggleProduct(selectedCompany.id, product, isActive ? 'active' : 'inactive')}
                  style={{
                    padding: '10px 16px', borderRadius: '10px', cursor: user.sparks_role === 'admin' ? 'pointer' : 'default',
                    background: isActive ? 'var(--charcoal)' : 'var(--gray-100)',
                    color: isActive ? 'var(--primary)' : '#999',
                    border: isActive ? '2px solid var(--primary)' : '2px solid var(--gray-200)',
                    fontWeight: 700, fontSize: '13px',
                  }}>
                  {product === 'voice_report' ? 'Voice Report' : 'Relation Data / LoopFolders'}
                  {isActive ? ' \u2713' : ''}
                </button>
              );
            })}
          </div>

          {/* Trades */}
          <h4 style={{ gridColumn: '1 / -1', fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>
            Licensed Trades
          </h4>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            {['Electrical', 'Instrumentation', 'Pipe Fitting', 'Industrial Erection', 'Safety'].map(trade => {
              const licensed = (selectedCompany.trades || []).find(t => t.trade === trade);
              const isActive = licensed && licensed.status === 'active';
              return (
                <button key={trade} onClick={() => user.sparks_role === 'admin' && toggleTrade(selectedCompany.id, trade, isActive ? 'active' : 'inactive')}
                  style={{
                    padding: '8px 14px', borderRadius: '10px', cursor: user.sparks_role === 'admin' ? 'pointer' : 'default',
                    background: isActive ? 'var(--charcoal)' : 'var(--gray-100)',
                    color: isActive ? 'var(--primary)' : '#999',
                    border: isActive ? '2px solid var(--primary)' : '2px solid var(--gray-200)',
                    fontWeight: 600, fontSize: '12px',
                  }}>
                  {trade} {isActive ? '\u2713' : ''}
                </button>
              );
            })}
          </div>

          <div>
          {/* People by Trade */}
          <h4 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>
            People by Trade
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            {(selectedCompany.people_by_trade || []).map(pt => (
              <div key={pt.trade} style={{
                background: 'white', borderRadius: '8px', padding: '10px',
                border: '2px solid var(--gray-200)',
              }}>
                <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--primary)' }}>{pt.count}</div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--charcoal)' }}>{pt.trade}</div>
              </div>
            ))}
          </div>

          {/* SUBSCRIPTION */}
          <h4 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>
            Subscription
          </h4>
          {companyBilling?.subscription ? (() => {
            const sub = companyBilling.subscription;
            const subStatusColor = { active: '#2ecc71', trial: '#f39c12', past_due: '#e74c3c', cancelled: '#95a5a6' }[sub.status] || '#ccc';
            return (
              <div style={{ background: 'white', borderRadius: '10px', padding: '14px', border: '2px solid var(--gray-200)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <span style={{ fontWeight: 800, fontSize: '16px', color: 'var(--charcoal)' }}>{sub.plan_name}</span>
                    <span style={{ fontSize: '14px', color: 'var(--primary)', fontWeight: 700, marginLeft: '8px' }}>
                      {'$' + (sub.price_cents / 100).toFixed(0) + '/mo'}
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '10px', background: subStatusColor, color: 'white' }}>
                    {sub.status}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--charcoal)', opacity: 0.7, marginBottom: '10px' }}>
                  Next billing: {sub.next_billing_date ? new Date(sub.next_billing_date).toLocaleDateString() : '\u2014'}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {user.sparks_role === 'admin' && (
                    <>
                      <select
                        value={sub.plan_id}
                        onChange={(e) => changePlan(selectedCompany.id, e.target.value)}
                        style={{
                          padding: '6px 10px', borderRadius: '8px', border: '2px solid var(--gray-200)',
                          fontSize: '12px', fontWeight: 600, color: 'var(--charcoal)', background: 'white', cursor: 'pointer',
                        }}
                      >
                        {allPlans.map(p => (
                          <option key={p.id} value={p.id}>{p.name + ' \u2014 $' + (p.price_cents / 100).toFixed(0) + '/mo'}</option>
                        ))}
                      </select>
                      {sub.status !== 'cancelled' && (
                        <button onClick={() => cancelSubscription(selectedCompany.id)} style={{
                          padding: '6px 14px', borderRadius: '8px', border: '2px solid #e74c3c',
                          background: 'white', color: '#e74c3c', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                        }}>
                          Cancel
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })() : (
            <div style={{ background: 'white', borderRadius: '10px', padding: '14px', border: '2px solid var(--gray-200)', marginBottom: '16px', textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: 'var(--charcoal)', opacity: 0.5, marginBottom: '8px' }}>No active subscription</div>
              {user.sparks_role === 'admin' && allPlans.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => e.target.value && changePlan(selectedCompany.id, e.target.value)}
                  style={{
                    padding: '6px 10px', borderRadius: '8px', border: '2px solid var(--primary)',
                    fontSize: '12px', fontWeight: 600, color: 'var(--charcoal)', background: 'white', cursor: 'pointer',
                  }}
                >
                  <option value="" disabled>Assign a plan...</option>
                  {allPlans.map(p => (
                    <option key={p.id} value={p.id}>{p.name + ' \u2014 $' + (p.price_cents / 100).toFixed(0) + '/mo'}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* INVOICES */}
          <h4 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>
            Invoices
          </h4>
          <div style={{ marginBottom: '16px' }}>
            {user.sparks_role === 'admin' && (
              <div style={{ marginBottom: '10px' }}>
                {!showInvoiceForm ? (
                  <button onClick={() => setShowInvoiceForm(true)} style={{
                    padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--primary)',
                    background: 'var(--charcoal)', color: 'var(--primary)', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                  }}>
                    + Create Invoice
                  </button>
                ) : (
                  <div style={{ background: 'white', borderRadius: '10px', padding: '14px', border: '2px solid var(--primary)' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                      <input type="number" step="0.01" placeholder="Amount ($)" value={invoiceForm.amount}
                        onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })}
                        style={{ padding: '6px 10px', borderRadius: '8px', border: '2px solid var(--gray-200)', fontSize: '12px', width: '100px' }} />
                      <input type="text" placeholder="Description" value={invoiceForm.description}
                        onChange={(e) => setInvoiceForm({ ...invoiceForm, description: e.target.value })}
                        style={{ padding: '6px 10px', borderRadius: '8px', border: '2px solid var(--gray-200)', fontSize: '12px', flex: 1, minWidth: '120px' }} />
                      <input type="date" value={invoiceForm.due_date}
                        onChange={(e) => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })}
                        style={{ padding: '6px 10px', borderRadius: '8px', border: '2px solid var(--gray-200)', fontSize: '12px' }} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => createInvoice(selectedCompany.id)} style={{
                        padding: '6px 14px', borderRadius: '8px', border: 'none',
                        background: 'var(--primary)', color: 'white', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                      }}>Save</button>
                      <button onClick={() => setShowInvoiceForm(false)} style={{
                        padding: '6px 14px', borderRadius: '8px', border: '2px solid var(--gray-200)',
                        background: 'white', color: 'var(--charcoal)', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                      }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {(companyBilling?.invoices || []).map(inv => {
              const invStatusColor = { paid: '#2ecc71', pending: '#f39c12', overdue: '#e74c3c', void: '#95a5a6' }[inv.status] || '#ccc';
              return (
                <div key={inv.id} style={{
                  background: 'white', borderRadius: '8px', padding: '10px',
                  border: '1px solid var(--gray-200)', marginBottom: '6px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--charcoal)', fontSize: '13px' }}>{inv.description}</div>
                    <div style={{ fontSize: '11px', color: 'var(--charcoal)', opacity: 0.6 }}>
                      {'Due: ' + new Date(inv.due_date).toLocaleDateString()}{inv.paid_at && (' \u00B7 Paid: ' + new Date(inv.paid_at).toLocaleDateString())}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 700, color: 'var(--charcoal)', fontSize: '14px' }}>{'$' + (inv.amount_cents / 100).toFixed(2)}</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', background: invStatusColor, color: 'white' }}>
                      {inv.status}
                    </span>
                    {inv.status === 'pending' && user.sparks_role === 'admin' && (
                      <button onClick={() => markInvoicePaid(inv.id, selectedCompany.id)} style={{
                        padding: '4px 10px', borderRadius: '6px', border: '1px solid #2ecc71',
                        background: 'white', color: '#2ecc71', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                      }}>
                        Mark Paid
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {(!companyBilling?.invoices || companyBilling.invoices.length === 0) && (
              <div style={{ fontSize: '13px', color: 'var(--charcoal)', opacity: 0.5, textAlign: 'center', padding: '12px' }}>
                No invoices yet
              </div>
            )}
          </div>

          {/* Recent Reports */}
          <h4 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>
            Recent Reports
          </h4>
          {(selectedCompany.recent_reports || []).map(r => (
            <div key={r.id} style={{
              background: 'white', borderRadius: '8px', padding: '10px',
              border: '1px solid var(--gray-200)', marginBottom: '6px',
              fontSize: '13px',
            }}>
              <div style={{ fontWeight: 600, color: 'var(--charcoal)' }}>{r.person_name}</div>
              <div style={{ fontSize: '11px', color: '#666' }}>{r.trade} {'\u00B7'} {r.report_date}</div>
            </div>
          ))}

          </div>
          {/* RIGHT: Company Analytics */}
          <div style={{ alignSelf: 'start' }}>
            <h4 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
              AI Usage &mdash; {selectedCompany.name}
            </h4>
            {companyAnalytics ? (() => {
              const fmt = (n) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'K' : (n || 0);
              const fmtD = (cents) => '$' + (cents / 100).toFixed(2);
              return (
                <>
                  {/* Summary Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                    {[
                      { label: 'API Calls', value: fmt(companyAnalytics.summary?.total_api_calls), color: 'var(--primary)' },
                      { label: 'AI Cost', value: fmtD(companyAnalytics.summary?.total_ai_cost_cents || 0), color: 'var(--charcoal)' },
                      { label: 'Unique Users', value: companyAnalytics.summary?.unique_users || 0, color: 'var(--primary)' },
                      { label: 'Total Tokens', value: fmt((companyAnalytics.costs?.by_provider || []).reduce((s, p) => s + parseInt(p.total_input_tokens || 0) + parseInt(p.total_output_tokens || 0), 0)), color: 'var(--primary)' },
                    ].map((card, i) => (
                      <div key={i} style={{
                        background: 'white', border: '1px solid rgba(72,72,74,0.1)', borderRadius: '10px',
                        padding: '12px', textAlign: 'center',
                      }}>
                        <div style={{ fontSize: '20px', fontWeight: 800, color: card.color }}>{card.value}</div>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--charcoal)' }}>{card.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Cost by Provider */}
                  {(companyAnalytics.costs?.by_provider || []).map((p, i) => (
                    <div key={i} style={{
                      padding: '10px', background: 'white', borderRadius: '10px', marginBottom: '6px',
                      border: '1px solid rgba(72,72,74,0.1)', fontSize: '11px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700, color: 'var(--charcoal)' }}>
                          {p.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} &mdash; {p.service}
                        </span>
                        <span style={{ fontWeight: 800, color: 'var(--primary)' }}>{fmtD(p.total_cost_cents)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', color: 'var(--charcoal)', opacity: 0.7 }}>
                        <span>{fmt(p.total_calls)} calls</span>
                        <span>{fmt(parseInt(p.total_input_tokens || 0))} in</span>
                        <span>{fmt(parseInt(p.total_output_tokens || 0))} out</span>
                      </div>
                    </div>
                  ))}

                  {/* Daily Cost Mini Chart */}
                  {companyAnalytics.costs?.by_day?.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--charcoal)', marginBottom: '6px' }}>Daily Cost (last 14 days)</div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '60px', background: 'white', borderRadius: '8px', padding: '8px', border: '1px solid rgba(72,72,74,0.1)' }}>
                        {companyAnalytics.costs.by_day.slice(0, 14).reverse().map((day, i) => {
                          const maxCents = Math.max(...companyAnalytics.costs.by_day.map(d => d.total_cents || 1));
                          const h = Math.max(3, (day.total_cents / maxCents) * 50);
                          return (
                            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}>
                              <div style={{ width: '100%', maxWidth: '16px', height: h + 'px', background: 'var(--primary)', borderRadius: '3px 3px 0 0', minWidth: '4px' }} title={day.date + ': $' + (day.total_cents / 100).toFixed(2)} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Top AI Users in this company */}
                  {companyAnalytics.costs?.by_person?.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--charcoal)', marginBottom: '6px' }}>Top AI Users</div>
                      {companyAnalytics.costs.by_person.slice(0, 5).map((p, i) => (
                        <div key={i} style={{
                          display: 'flex', justifyContent: 'space-between', padding: '6px 10px',
                          background: 'white', borderRadius: '8px', marginBottom: '4px',
                          border: '1px solid rgba(72,72,74,0.1)', fontSize: '11px',
                        }}>
                          <span style={{ fontWeight: 600, color: 'var(--charcoal)' }}>{p.person_name || 'Unknown'}</span>
                          <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{fmtD(p.total_cost_cents)} ({p.call_count})</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* No data state */}
                  {(companyAnalytics.costs?.by_provider || []).length === 0 && (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--charcoal)', opacity: 0.5, fontSize: '12px' }}>
                      No AI usage recorded for this company yet
                    </div>
                  )}
                </>
              );
            })() : (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--charcoal)', opacity: 0.5, fontSize: '12px' }}>Loading analytics...</div>
            )}
          </div>
          </div>

        </>
      )}

      {/* TEAM SCREEN */}
      {screen === 'team' && (
        <>
          <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
            Sparks Team ({team.length})
          </h3>
          {team.map(member => (
            <div key={member.id} style={{
              background: 'white', borderRadius: '10px', padding: '14px',
              border: '2px solid var(--gray-200)', marginBottom: '8px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--charcoal)', fontSize: '15px' }}>{member.name}</div>
                <div style={{ fontSize: '12px', color: '#666' }}>{member.role_title}</div>
              </div>
              <span style={{
                fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '10px',
                background: roleColors[member.sparks_role] || '#ccc', color: 'white',
              }}>{member.sparks_role}</span>
            </div>
          ))}
        </>
      )}

      {/* AUDIT LOG SCREEN */}
      {screen === 'analytics' && (
        <AnalyticsView goBack={() => setScreen('dashboard')} />
      )}

      {screen === 'audit' && (
        <>
          <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
            Audit Trail ({audit.length})
          </h3>
          {audit.length === 0 && (
            <p style={{ color: '#666', fontSize: '14px', textAlign: 'center', padding: '20px' }}>
              No audit entries yet. Actions will appear here as they happen.
            </p>
          )}
          {audit.map(entry => (
            <div key={entry.id} style={{
              background: 'white', borderRadius: '8px', padding: '10px',
              border: '1px solid var(--gray-200)', marginBottom: '6px',
              fontSize: '13px',
            }}>
              <div style={{ fontWeight: 600, color: 'var(--charcoal)' }}>{entry.action.replace(/_/g, ' ')}</div>
              <div style={{ fontSize: '11px', color: '#666' }}>
                {entry.person_name || 'System'} {'\u00B7'} {new Date(entry.created_at).toLocaleString()}
              </div>
              {entry.details && (
                <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
                  {JSON.stringify(entry.details)}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {loading && screen !== 'dashboard' && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>Loading...</div>
      )}
    </div>
  );
});