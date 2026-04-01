import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import {
  Box, Typography, Button, Paper, Chip, Alert, CircularProgress,
  Card, CardContent, CardActionArea, TextField, Select, MenuItem,
  Grid, Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import AnalyticsView from './AnalyticsView.jsx';

/**
 * Control Center — the operating system for Horizon Sparks.
 * Only visible to users with a sparks_role.
 */
// Poll support unread count
function useSupportUnread(setSupportUnread) {
  useEffect(() => {
    const check = () => fetch('/api/support/unread-count').then(r => r.ok ? r.json() : { unread: 0 }).then(d => setSupportUnread(d.unread)).catch(() => {});
    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, []);
}

export default forwardRef(function SparksCommandCenter({ user, onEnterCompany, navigateTo }, ref) {
  const [screen, setScreen] = useState('dashboard');
  const [supportInbox, setSupportInbox] = useState([]);
  const [supportUnread, setSupportUnread] = useState(0);
  const [activeConvId, setActiveConvId] = useState(null);
  useSupportUnread(setSupportUnread);
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
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [newCompany, setNewCompany] = useState({ name: '', tier: 'standard', notes: '' });
  const [creating, setCreating] = useState(false);
  const [dialogConfig, setDialogConfig] = useState(null);

  const showConfirm = (message, onConfirm) => setDialogConfig({ message, onConfirm, showCancel: true });

  useEffect(() => { loadDashboard(); }, []);

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

  function cancelSubscription(companyId) {
    showConfirm('Cancel this subscription? The company will lose access at the end of the billing period.', async () => {
      try {
        const res = await fetch('/api/billing/company/' + companyId + '/cancel', { method: 'POST' });
        if (res.ok) {
          loadCompanyBilling(companyId);
          loadRevenue();
        }
      } catch(e) { setError(e.message); }
    });
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
    if (screen === 'support-inbox') { setScreen('dashboard'); return; }
    if (screen !== 'dashboard') { setScreen('dashboard'); return; }
  }

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

  // Helper formatters
  const fmt = (n) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'K' : (n || 0);
  const fmtD = (cents) => '$' + (cents / 100).toFixed(2);

  // ============================================
  // RENDER
  // ============================================

  return (
    <Box className="list-view" sx={{ pb: 12, pt: 0 }}>

      {/* Header */}
      <Box sx={{ mb: 1, mt: -2.5, textAlign: 'center' }}>
        <Typography variant="h4" sx={{ color: 'text.primary', fontWeight: 800, fontSize: 32 }}>
          Control Center
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'primary.main', fontWeight: 600 }}>
          {user.sparks_role?.toUpperCase()} ACCESS
        </Typography>
        {/* Product launchers */}
        <Box sx={{ display: 'flex', gap: 1.5, mt: 2, justifyContent: 'center' }}>
          <Button variant="contained" color="secondary"
            onClick={() => { if (typeof navigateTo === 'function') navigateTo('home'); }}
            sx={{ px: 3, py: 1, borderRadius: 3, fontWeight: 700, fontSize: 14, border: '2px solid', borderColor: 'primary.main' }}>
            Field Operations
          </Button>
          <Button variant="outlined" color="secondary"
            onClick={() => window.open('https://app.horizonsparks.ai', '_blank')}
            sx={{ px: 3, py: 1, borderRadius: 3, fontWeight: 700, fontSize: 14 }}>
            LoopFolders
          </Button>
        </Box>
      </Box>

      {/* Back button for internal CC navigation */}
      {screen !== "dashboard" && (
        <Box sx={{ px: 2, mb: 1 }}>
          <Button onClick={handleBack} size="small" color="secondary" sx={{ fontWeight: 700 }}>
            ← Back
          </Button>
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>
      )}

      {/* DASHBOARD SCREEN */}
      {screen === 'dashboard' && dashboard && (
        <>
          {/* Stats Row */}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 7.5, mb: 4, justifyContent: 'center' }}>
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
              <Paper key={i} variant="outlined" sx={{
                width: 90, height: 90, display: 'flex', flexDirection: 'column',
                justifyContent: 'center', alignItems: 'center', textAlign: 'center',
                borderRadius: 2.5, border: '2px solid', borderColor: 'secondary.main',
              }}>
                <Typography sx={{ fontSize: 22, fontWeight: 800, color: 'primary.main', lineHeight: 1 }}>{stat.value}</Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 700, mt: 0.5, color: 'text.primary' }}>{stat.label}</Typography>
                <Typography sx={{ fontSize: 9, opacity: 0.6, mt: '1px', color: 'text.primary' }}>{stat.sub}</Typography>
              </Paper>
            ))}
          </Box>

          {/* Two-Column Layout */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2.5 }}>

            {/* LEFT: Inline Analytics */}
            <Box>
              {analyticsData ? (() => {
                return (
                  <>
                    <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1.5 }}>
                      Analytics
                    </Typography>
                    {/* Summary Cards */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2 }}>
                      {[
                        { label: 'API Calls', value: fmt(analyticsData.summary?.total_api_calls), color: 'primary.main' },
                        { label: 'AI Cost', value: fmtD(analyticsData.summary?.total_ai_cost_cents || 0), color: 'text.primary' },
                        { label: 'Unique Users', value: analyticsData.summary?.unique_users || 0, color: 'primary.main' },
                        { label: 'Total Tokens', value: fmt((analyticsData.costs?.by_provider || []).reduce((s, p) => s + parseInt(p.total_input_tokens || 0) + parseInt(p.total_output_tokens || 0), 0)), color: 'primary.main' },
                      ].map((card, i) => (
                        <Paper key={i} variant="outlined" sx={{ borderRadius: 2.5, p: 1.5, textAlign: 'center', border: '1px solid rgba(72,72,74,0.1)' }}>
                          <Typography sx={{ fontSize: 20, fontWeight: 800, color: card.color }}>{card.value}</Typography>
                          <Typography sx={{ fontSize: 10, fontWeight: 600, color: 'text.primary' }}>{card.label}</Typography>
                        </Paper>
                      ))}
                    </Box>

                    {/* Cost by Provider */}
                    {(analyticsData.costs?.by_provider || []).map((p, i) => (
                      <Paper key={i} variant="outlined" sx={{ p: 1.25, borderRadius: 2.5, mb: 0.75, border: '1px solid rgba(72,72,74,0.1)', fontSize: 11 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                          <Typography sx={{ fontWeight: 700, color: 'text.primary', fontSize: 11 }}>
                            {p.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} {'\u2014'} {p.service}
                          </Typography>
                          <Typography sx={{ fontWeight: 800, color: 'primary.main', fontSize: 11 }}>{fmtD(p.total_cost_cents)}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1.5, color: 'text.primary', opacity: 0.7, fontSize: 11 }}>
                          <span>{fmt(p.total_calls)} calls</span>
                          <span>{fmt(parseInt(p.total_input_tokens || 0))} in</span>
                          <span>{fmt(parseInt(p.total_output_tokens || 0))} out</span>
                        </Box>
                      </Paper>
                    ))}

                    {/* Daily Cost Mini Chart */}
                    {analyticsData.costs?.by_day?.length > 0 && (
                      <Box sx={{ mt: 1.5 }}>
                        <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.primary', mb: 0.75 }}>Daily Cost (last 14 days)</Typography>
                        <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 60, borderRadius: 2, p: 1, border: '1px solid rgba(72,72,74,0.1)' }}>
                          {analyticsData.costs.by_day.slice(0, 14).reverse().map((day, i) => {
                            const maxCents = Math.max(...analyticsData.costs.by_day.map(d => d.total_cents || 1));
                            const h = Math.max(3, (day.total_cents / maxCents) * 50);
                            return (
                              <Box key={i} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}>
                                <Box sx={{ width: '100%', maxWidth: 16, height: h + 'px', bgcolor: 'primary.main', borderRadius: '3px 3px 0 0', minWidth: 4 }} title={day.date + ': $' + (day.total_cents / 100).toFixed(2)} />
                              </Box>
                            );
                          })}
                        </Paper>
                      </Box>
                    )}

                    {/* Top AI Users */}
                    {analyticsData.costs?.by_person?.length > 0 && (
                      <Box sx={{ mt: 1.5 }}>
                        <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.primary', mb: 0.75 }}>Top AI Users</Typography>
                        {analyticsData.costs.by_person.slice(0, 5).map((p, i) => (
                          <Paper key={i} variant="outlined" sx={{
                            display: 'flex', justifyContent: 'space-between', px: 1.25, py: 0.75,
                            borderRadius: 2, mb: 0.5, border: '1px solid rgba(72,72,74,0.1)', fontSize: 11,
                          }}>
                            <Typography sx={{ fontWeight: 600, color: 'text.primary', fontSize: 11 }}>{p.person_name || 'Unknown'}</Typography>
                            <Typography sx={{ fontWeight: 700, color: 'primary.main', fontSize: 11 }}>{fmtD(p.total_cost_cents)} ({p.call_count})</Typography>
                          </Paper>
                        ))}
                      </Box>
                    )}

                    {/* Full Analytics Link */}
                    <Button fullWidth variant="contained" color="secondary" onClick={() => setScreen('analytics')}
                      sx={{ mt: 1.5, fontSize: 12 }}>
                      View Full Analytics {'\u2192'}
                    </Button>
                  </>
                );
              })() : (
                <Box sx={{ p: 2.5, textAlign: 'center', color: 'text.secondary', fontSize: 12 }}>Loading analytics...</Box>
              )}
            </Box>

            {/* RIGHT: Navigation + Companies */}
            <Box>
              <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1.5 }}>
                Operations
              </Typography>
              {/* Navigation Tiles */}
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25, mb: 2 }}>
                {[
                  { label: 'Companies', icon: '\uD83C\uDFE2', action: loadCompanies, show: ['admin', 'support'].includes(user.sparks_role) },
                  { label: 'Team', icon: '\uD83D\uDC65', action: loadTeam, show: true },
                  { label: 'Audit Log', icon: '\uD83D\uDCCB', action: loadAudit, show: user.sparks_role === 'admin' },
                  { label: supportUnread > 0 ? 'Support (' + supportUnread + ')' : 'Support Inbox', icon: '\uD83D\uDCAC', action: () => {
                    fetch('/api/support/inbox').then(r => r.ok ? r.json() : []).then(data => { setSupportInbox(data); setScreen('support-inbox'); }).catch(() => setScreen('support-inbox'));
                  }, show: true, accent: supportUnread > 0 },
                ].filter(t => t.show).map((tile, i) => (
                  <Button key={i} onClick={tile.action} disabled={tile.disabled}
                    variant="outlined"
                    sx={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      p: 2, borderRadius: 3, minHeight: 70,
                      bgcolor: tile.disabled ? 'grey.100' : 'background.paper',
                      borderColor: 'grey.200', borderWidth: 2,
                      opacity: tile.disabled ? 0.5 : 1,
                      color: 'text.primary',
                    }}>
                    <Typography sx={{ fontSize: 22, mb: 0.5 }}>{tile.icon}</Typography>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary' }}>{tile.label}</Typography>
                    {tile.disabled && <Typography sx={{ fontSize: 9, color: 'text.secondary' }}>coming soon</Typography>}
                  </Button>
                ))}
              </Box>

              {/* Per-Company Breakdown */}
              <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1.5 }}>
                Company Activity
              </Typography>
              {dashboard.companies.map(c => (
                <Card key={c.id} variant="outlined"
                  sx={{ mb: 1, borderRadius: 2.5, cursor: ['admin', 'support'].includes(user.sparks_role) ? 'pointer' : 'default' }}
                  onClick={() => ['admin', 'support'].includes(user.sparks_role) && loadCompanyDetail(c.id)}
                >
                  <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Box>
                      <Typography sx={{ fontWeight: 700, color: 'text.primary', fontSize: 14 }}>{c.name}</Typography>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                        {c.people} people {'\u00B7'} {c.total_reports} reports
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'primary.main' }}>{c.today_reports}</Typography>
                      <Typography sx={{ fontSize: 9, color: 'text.secondary' }}>today</Typography>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          </Box>
        </>
      )}

      {/* COMPANIES LIST SCREEN */}
      {screen === 'companies' && (
        <>
          <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1.5 }}>
            All Companies ({companies.length})
          </Typography>
          {companies.map(c => (
            <Card key={c.id} variant="outlined" sx={{ mb: 1, borderRadius: 2.5, cursor: 'pointer' }}
              onClick={() => loadCompanyDetail(c.id)}>
              <CardContent sx={{ py: 1.75, '&:last-child': { pb: 1.75 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography sx={{ fontWeight: 700, color: 'text.primary', fontSize: 16 }}>{c.name}</Typography>
                  <Chip label={c.status} size="small" sx={{ bgcolor: statusColors[c.status] || '#ccc', color: 'white', fontWeight: 700, fontSize: 11 }} />
                </Box>
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                  {(c.products || []).map(p => (
                    <Chip key={p} label={p === 'voice_report' ? 'Voice Report' : 'Relation Data / LoopFolders'} size="small"
                      sx={{ bgcolor: 'secondary.main', color: 'primary.main', fontWeight: 600, fontSize: 10 }} />
                  ))}
                  {(c.trades || []).map(t => (
                    <Chip key={t} label={t} size="small" variant="outlined" sx={{ fontWeight: 600, fontSize: 10 }} />
                  ))}
                </Box>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.75 }}>
                  {c.people_count} people {'\u00B7'} {c.report_count} reports
                </Typography>
              </CardContent>
            </Card>
          ))}
        </>
      )}

      {/* COMPANY DETAIL SCREEN */}
      {screen === 'company-detail' && selectedCompany && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2.5 }}>
            <Box sx={{ gridColumn: '1 / -1', mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary', fontSize: 18 }}>
                  {selectedCompany.name}
                </Typography>
                {onEnterCompany && (
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button variant="contained" color="secondary"
                      onClick={() => onEnterCompany({ id: selectedCompany.id, name: selectedCompany.name, mode: 'customer' })}
                      sx={{ borderRadius: 5, fontSize: 13, px: 2.25 }}>
                      View as Customer
                    </Button>
                    <Button variant="outlined"
                      onClick={() => onEnterCompany({ id: selectedCompany.id, name: selectedCompany.name, mode: 'support' })}
                      sx={{ borderRadius: 5, fontSize: 13, px: 2.25, color: '#4ade80', borderColor: '#4ade80' }}>
                      Customer Service
                    </Button>
                  </Box>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Chip label={selectedCompany.status} size="small" sx={{ bgcolor: statusColors[selectedCompany.status], color: 'white', fontWeight: 700, fontSize: 11 }} />
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Tier: {selectedCompany.tier}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{selectedCompany.total_reports} reports</Typography>
              </Box>
            </Box>

            {/* Products */}
            <Typography sx={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
              Licensed Products
            </Typography>
            <Box sx={{ gridColumn: '1 / -1', display: 'flex', gap: 1, mb: 2 }}>
              {['voice_report', 'relation_data'].map(product => {
                const licensed = (selectedCompany.products || []).find(p => p.product === product);
                const isActive = licensed && licensed.status === 'active';
                return (
                  <Button key={product} variant={isActive ? 'contained' : 'outlined'}
                    color={isActive ? 'secondary' : 'inherit'}
                    onClick={() => user.sparks_role === 'admin' && toggleProduct(selectedCompany.id, product, isActive ? 'active' : 'inactive')}
                    sx={{
                      borderRadius: 2.5, fontWeight: 700, fontSize: 13, px: 2, py: 1.25,
                      cursor: user.sparks_role === 'admin' ? 'pointer' : 'default',
                      ...(isActive && { bgcolor: 'secondary.main', color: 'primary.main', borderColor: 'primary.main' }),
                    }}>
                    {product === 'voice_report' ? 'Voice Report' : 'Relation Data / LoopFolders'}
                    {isActive ? ' \u2713' : ''}
                  </Button>
                );
              })}
            </Box>

            {/* Trades */}
            <Typography sx={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
              Licensed Trades
            </Typography>
            <Box sx={{ gridColumn: '1 / -1', display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              {['Electrical', 'Instrumentation', 'Pipe Fitting', 'Industrial Erection', 'Safety'].map(trade => {
                const licensed = (selectedCompany.trades || []).find(t => t.trade === trade);
                const isActive = licensed && licensed.status === 'active';
                return (
                  <Button key={trade} variant={isActive ? 'contained' : 'outlined'}
                    color={isActive ? 'secondary' : 'inherit'} size="small"
                    onClick={() => user.sparks_role === 'admin' && toggleTrade(selectedCompany.id, trade, isActive ? 'active' : 'inactive')}
                    sx={{
                      borderRadius: 2.5, fontWeight: 600, fontSize: 12, px: 1.75, py: 1,
                      cursor: user.sparks_role === 'admin' ? 'pointer' : 'default',
                      ...(isActive && { bgcolor: 'secondary.main', color: 'primary.main', borderColor: 'primary.main' }),
                    }}>
                    {trade} {isActive ? '\u2713' : ''}
                  </Button>
                );
              })}
            </Box>

            <Box>
              {/* People by Trade */}
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
                People by Trade
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2 }}>
                {(selectedCompany.people_by_trade || []).map(pt => (
                  <Paper key={pt.trade} variant="outlined" sx={{ borderRadius: 2, p: 1.25 }}>
                    <Typography sx={{ fontSize: 20, fontWeight: 800, color: 'primary.main' }}>{pt.count}</Typography>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.primary' }}>{pt.trade}</Typography>
                  </Paper>
                ))}
              </Box>

              {/* SUBSCRIPTION */}
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
                Subscription
              </Typography>
              {companyBilling?.subscription ? (() => {
                const sub = companyBilling.subscription;
                const subStatusColor = { active: '#2ecc71', trial: '#f39c12', past_due: '#e74c3c', cancelled: '#95a5a6' }[sub.status] || '#ccc';
                return (
                  <Card variant="outlined" sx={{ mb: 2, borderRadius: 2.5 }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Box>
                          <Typography component="span" sx={{ fontWeight: 800, fontSize: 16, color: 'text.primary' }}>{sub.plan_name}</Typography>
                          <Typography component="span" sx={{ fontSize: 14, color: 'primary.main', fontWeight: 700, ml: 1 }}>
                            {'$' + (sub.price_cents / 100).toFixed(0) + '/mo'}
                          </Typography>
                        </Box>
                        <Chip label={sub.status} size="small" sx={{ bgcolor: subStatusColor, color: 'white', fontWeight: 700, fontSize: 11 }} />
                      </Box>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.25 }}>
                        Next billing: {sub.next_billing_date ? new Date(sub.next_billing_date).toLocaleDateString() : '\u2014'}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                        {user.sparks_role === 'admin' && (
                          <>
                            <Select value={sub.plan_id} size="small"
                              onChange={(e) => changePlan(selectedCompany.id, e.target.value)}
                              sx={{ borderRadius: 2, fontSize: 12, fontWeight: 600, minWidth: 150 }}>
                              {allPlans.map(p => (
                                <MenuItem key={p.id} value={p.id}>{p.name + ' \u2014 $' + (p.price_cents / 100).toFixed(0) + '/mo'}</MenuItem>
                              ))}
                            </Select>
                            {sub.status !== 'cancelled' && (
                              <Button variant="outlined" color="error" size="small"
                                onClick={() => cancelSubscription(selectedCompany.id)}
                                sx={{ borderRadius: 2, fontSize: 12, fontWeight: 700 }}>
                                Cancel
                              </Button>
                            )}
                          </>
                        )}
                      </Box>
                    </CardContent>
                  </Card>
                );
              })() : (
                <Card variant="outlined" sx={{ mb: 2, borderRadius: 2.5, textAlign: 'center' }}>
                  <CardContent>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1 }}>No active subscription</Typography>
                    {user.sparks_role === 'admin' && allPlans.length > 0 && (
                      <Select defaultValue="" size="small" displayEmpty
                        onChange={(e) => e.target.value && changePlan(selectedCompany.id, e.target.value)}
                        sx={{ borderRadius: 2, fontSize: 12, fontWeight: 600, minWidth: 180, borderColor: 'primary.main' }}>
                        <MenuItem value="" disabled>Assign a plan...</MenuItem>
                        {allPlans.map(p => (
                          <MenuItem key={p.id} value={p.id}>{p.name + ' \u2014 $' + (p.price_cents / 100).toFixed(0) + '/mo'}</MenuItem>
                        ))}
                      </Select>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* INVOICES */}
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
                Invoices
              </Typography>
              <Box sx={{ mb: 2 }}>
                {user.sparks_role === 'admin' && (
                  <Box sx={{ mb: 1.25 }}>
                    {!showInvoiceForm ? (
                      <Button variant="contained" color="secondary" size="small"
                        onClick={() => setShowInvoiceForm(true)}
                        sx={{ fontSize: 12, borderColor: 'primary.main' }}>
                        + Create Invoice
                      </Button>
                    ) : (
                      <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2.5, borderColor: 'primary.main' }}>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                          <TextField size="small" type="number" inputProps={{ step: '0.01' }} placeholder="Amount ($)"
                            value={invoiceForm.amount} onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })}
                            sx={{ width: 100 }} />
                          <TextField size="small" placeholder="Description" value={invoiceForm.description}
                            onChange={(e) => setInvoiceForm({ ...invoiceForm, description: e.target.value })}
                            sx={{ flex: 1, minWidth: 120 }} />
                          <TextField size="small" type="date" value={invoiceForm.due_date}
                            onChange={(e) => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} />
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button variant="contained" size="small" onClick={() => createInvoice(selectedCompany.id)} sx={{ fontSize: 12 }}>
                            Save
                          </Button>
                          <Button variant="outlined" size="small" onClick={() => setShowInvoiceForm(false)} sx={{ fontSize: 12 }}>
                            Cancel
                          </Button>
                        </Box>
                      </Paper>
                    )}
                  </Box>
                )}
                {(companyBilling?.invoices || []).map(inv => {
                  const invStatusColor = { paid: '#2ecc71', pending: '#f39c12', overdue: '#e74c3c', void: '#95a5a6' }[inv.status] || '#ccc';
                  return (
                    <Paper key={inv.id} variant="outlined" sx={{
                      borderRadius: 2, px: 1.25, py: 1.25, mb: 0.75,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <Box>
                        <Typography sx={{ fontWeight: 600, color: 'text.primary', fontSize: 13 }}>{inv.description}</Typography>
                        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                          {'Due: ' + new Date(inv.due_date).toLocaleDateString()}{inv.paid_at && (' \u00B7 Paid: ' + new Date(inv.paid_at).toLocaleDateString())}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography sx={{ fontWeight: 700, color: 'text.primary', fontSize: 14 }}>{'$' + (inv.amount_cents / 100).toFixed(2)}</Typography>
                        <Chip label={inv.status} size="small" sx={{ bgcolor: invStatusColor, color: 'white', fontWeight: 700, fontSize: 10 }} />
                        {inv.status === 'pending' && user.sparks_role === 'admin' && (
                          <Button variant="outlined" size="small" color="success"
                            onClick={() => markInvoicePaid(inv.id, selectedCompany.id)}
                            sx={{ fontSize: 11, fontWeight: 700, borderRadius: 1.5 }}>
                            Mark Paid
                          </Button>
                        )}
                      </Box>
                    </Paper>
                  );
                })}
                {(!companyBilling?.invoices || companyBilling.invoices.length === 0) && (
                  <Typography sx={{ fontSize: 13, color: 'text.secondary', textAlign: 'center', p: 1.5 }}>
                    No invoices yet
                  </Typography>
                )}
              </Box>

              {/* Recent Reports */}
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
                Recent Reports
              </Typography>
              {(selectedCompany.recent_reports || []).map(r => (
                <Paper key={r.id} variant="outlined" sx={{ borderRadius: 2, p: 1.25, mb: 0.75, fontSize: 13 }}>
                  <Typography sx={{ fontWeight: 600, color: 'text.primary', fontSize: 13 }}>{r.person_name}</Typography>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{r.trade} {'\u00B7'} {r.report_date}</Typography>
                </Paper>
              ))}
            </Box>

            {/* RIGHT: Company Analytics */}
            <Box sx={{ alignSelf: 'start' }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1.5 }}>
                AI Usage &mdash; {selectedCompany.name}
              </Typography>
              {companyAnalytics ? (() => {
                return (
                  <>
                    {/* Summary Cards */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2 }}>
                      {[
                        { label: 'API Calls', value: fmt(companyAnalytics.summary?.total_api_calls), color: 'primary.main' },
                        { label: 'AI Cost', value: fmtD(companyAnalytics.summary?.total_ai_cost_cents || 0), color: 'text.primary' },
                        { label: 'Unique Users', value: companyAnalytics.summary?.unique_users || 0, color: 'primary.main' },
                        { label: 'Total Tokens', value: fmt((companyAnalytics.costs?.by_provider || []).reduce((s, p) => s + parseInt(p.total_input_tokens || 0) + parseInt(p.total_output_tokens || 0), 0)), color: 'primary.main' },
                      ].map((card, i) => (
                        <Paper key={i} variant="outlined" sx={{ borderRadius: 2.5, p: 1.5, textAlign: 'center', border: '1px solid rgba(72,72,74,0.1)' }}>
                          <Typography sx={{ fontSize: 20, fontWeight: 800, color: card.color }}>{card.value}</Typography>
                          <Typography sx={{ fontSize: 10, fontWeight: 600, color: 'text.primary' }}>{card.label}</Typography>
                        </Paper>
                      ))}
                    </Box>

                    {/* Cost by Provider */}
                    {(companyAnalytics.costs?.by_provider || []).map((p, i) => (
                      <Paper key={i} variant="outlined" sx={{ p: 1.25, borderRadius: 2.5, mb: 0.75, border: '1px solid rgba(72,72,74,0.1)', fontSize: 11 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                          <Typography sx={{ fontWeight: 700, color: 'text.primary', fontSize: 11 }}>
                            {p.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} &mdash; {p.service}
                          </Typography>
                          <Typography sx={{ fontWeight: 800, color: 'primary.main', fontSize: 11 }}>{fmtD(p.total_cost_cents)}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1.5, color: 'text.primary', opacity: 0.7, fontSize: 11 }}>
                          <span>{fmt(p.total_calls)} calls</span>
                          <span>{fmt(parseInt(p.total_input_tokens || 0))} in</span>
                          <span>{fmt(parseInt(p.total_output_tokens || 0))} out</span>
                        </Box>
                      </Paper>
                    ))}

                    {/* Daily Cost Mini Chart */}
                    {companyAnalytics.costs?.by_day?.length > 0 && (
                      <Box sx={{ mt: 1.5 }}>
                        <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.primary', mb: 0.75 }}>Daily Cost (last 14 days)</Typography>
                        <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 60, borderRadius: 2, p: 1, border: '1px solid rgba(72,72,74,0.1)' }}>
                          {companyAnalytics.costs.by_day.slice(0, 14).reverse().map((day, i) => {
                            const maxCents = Math.max(...companyAnalytics.costs.by_day.map(d => d.total_cents || 1));
                            const h = Math.max(3, (day.total_cents / maxCents) * 50);
                            return (
                              <Box key={i} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}>
                                <Box sx={{ width: '100%', maxWidth: 16, height: h + 'px', bgcolor: 'primary.main', borderRadius: '3px 3px 0 0', minWidth: 4 }} title={day.date + ': $' + (day.total_cents / 100).toFixed(2)} />
                              </Box>
                            );
                          })}
                        </Paper>
                      </Box>
                    )}

                    {/* Top AI Users in this company */}
                    {companyAnalytics.costs?.by_person?.length > 0 && (
                      <Box sx={{ mt: 1.5 }}>
                        <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.primary', mb: 0.75 }}>Top AI Users</Typography>
                        {companyAnalytics.costs.by_person.slice(0, 5).map((p, i) => (
                          <Paper key={i} variant="outlined" sx={{
                            display: 'flex', justifyContent: 'space-between', px: 1.25, py: 0.75,
                            borderRadius: 2, mb: 0.5, border: '1px solid rgba(72,72,74,0.1)', fontSize: 11,
                          }}>
                            <Typography sx={{ fontWeight: 600, color: 'text.primary', fontSize: 11 }}>{p.person_name || 'Unknown'}</Typography>
                            <Typography sx={{ fontWeight: 700, color: 'primary.main', fontSize: 11 }}>{fmtD(p.total_cost_cents)} ({p.call_count})</Typography>
                          </Paper>
                        ))}
                      </Box>
                    )}

                    {(companyAnalytics.costs?.by_provider || []).length === 0 && (
                      <Typography sx={{ p: 2.5, textAlign: 'center', color: 'text.secondary', fontSize: 12 }}>
                        No AI usage recorded for this company yet
                      </Typography>
                    )}
                  </>
                );
              })() : (
                <Box sx={{ p: 2.5, textAlign: 'center', color: 'text.secondary', fontSize: 12 }}>Loading analytics...</Box>
              )}
            </Box>
          </Box>
        </>
      )}

      {/* TEAM SCREEN */}
      {screen === 'team' && (
        <>
          <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1.5 }}>
            Sparks Team ({team.length})
          </Typography>
          {team.map(member => (
            <Card key={member.id} variant="outlined" sx={{ mb: 1, borderRadius: 2.5 }}>
              <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.75, '&:last-child': { pb: 1.75 } }}>
                <Box>
                  <Typography sx={{ fontWeight: 700, color: 'text.primary', fontSize: 15 }}>{member.name}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{member.role_title}</Typography>
                </Box>
                <Chip label={member.sparks_role} size="small"
                  sx={{ bgcolor: roleColors[member.sparks_role] || '#ccc', color: 'white', fontWeight: 700, fontSize: 11 }} />
              </CardContent>
            </Card>
          ))}
        </>
      )}

      {/* ANALYTICS SCREEN */}
      {screen === 'analytics' && (
        <AnalyticsView goBack={() => setScreen('dashboard')} />
      )}

      {/* AUDIT LOG SCREEN */}
      {screen === 'audit' && (
        <>
          <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1.5 }}>
            Audit Trail ({audit.length})
          </Typography>
          {audit.length === 0 && (
            <Typography sx={{ color: 'text.secondary', fontSize: 14, textAlign: 'center', py: 2.5 }}>
              No audit entries yet. Actions will appear here as they happen.
            </Typography>
          )}
          {audit.map(entry => (
            <Paper key={entry.id} variant="outlined" sx={{ borderRadius: 2, p: 1.25, mb: 0.75, fontSize: 13 }}>
              <Typography sx={{ fontWeight: 600, color: 'text.primary', fontSize: 13 }}>{entry.action.replace(/_/g, ' ')}</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                {entry.person_name || 'System'} {'\u00B7'} {new Date(entry.created_at).toLocaleString()}
              </Typography>
              {entry.details && (
                <Typography sx={{ fontSize: 11, color: 'grey.500', mt: 0.25 }}>
                  {JSON.stringify(entry.details)}
                </Typography>
              )}
            </Paper>
          ))}
        </>
      )}

      {/* Support Inbox */}
      {screen === 'support-inbox' && (
        <Box sx={{ p: 2 }}>
          <Typography variant="h5" sx={{ fontWeight: 800, mb: 2 }}>Support Inbox</Typography>
          {supportInbox.length === 0 ? (
            <Typography sx={{ color: 'text.secondary', textAlign: 'center', py: 6 }}>No support conversations yet.</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {supportInbox.map(conv => (
                <Paper key={conv.id} elevation={conv.unread_count > 0 ? 3 : 1}
                  onClick={() => { setActiveConvId(conv.id); }}
                  sx={{
                    p: 2, borderRadius: 3, cursor: 'pointer',
                    border: conv.unread_count > 0 ? '2px solid' : '1px solid',
                    borderColor: conv.unread_count > 0 ? 'primary.main' : 'divider',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Box>
                      <Typography sx={{ fontWeight: 700, fontSize: 15 }}>{conv.person_name || 'Unknown'}</Typography>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                        {conv.company_name || 'No company'} — {conv.person_role || 'User'}
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      {conv.unread_count > 0 && (
                        <Box sx={{ bgcolor: 'error.main', color: 'white', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, mb: 0.5, ml: 'auto' }}>
                          {conv.unread_count}
                        </Box>
                      )}
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                        {conv.last_message_at ? new Date(conv.last_message_at).toLocaleDateString() : ''}
                      </Typography>
                    </Box>
                  </Box>
                  {conv.last_message && (
                    <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conv.last_message}
                    </Typography>
                  )}
                </Paper>
              ))}
            </Box>
          )}
        </Box>
      )}

      {loading && screen !== 'dashboard' && (
        <Box sx={{ textAlign: 'center', py: 5 }}>
          <CircularProgress color="primary" />
        </Box>
      )}

      <Dialog open={!!dialogConfig} onClose={() => setDialogConfig(null)}>
        <DialogContent>
          <Typography>{dialogConfig?.message}</Typography>
        </DialogContent>
        <DialogActions>
          {dialogConfig?.showCancel && (
            <Button onClick={() => setDialogConfig(null)}>Cancel</Button>
          )}
          <Button onClick={() => { setDialogConfig(null); if (dialogConfig?.onConfirm) dialogConfig.onConfirm(); }}>OK</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
});
