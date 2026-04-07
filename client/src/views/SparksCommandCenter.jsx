import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import {
  Box, Typography, Button, Paper, Chip, Alert, CircularProgress,
  Card, CardContent, CardActionArea, TextField, Select, MenuItem,
  Grid, Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import AnalyticsView from './AnalyticsView.jsx';
import MessagesView from './MessagesView.jsx';
import TeamChatPanel from '../components/TeamChatPanel.jsx';
import CompanyChatPanel from '../components/CompanyChatPanel.jsx';
import MessagesChatPanel from '../components/MessagesChatPanel.jsx';
import SystemHealthPanel from '../components/SystemHealthPanel.jsx';
import PeopleView from './PeopleView.jsx';
import ReportsView from './ReportsView.jsx';
import DailyPlanView from './DailyPlanView.jsx';
import PunchListView from './PunchListView.jsx';

/**
 * Control Center — the operating system for Horizon Sparks.
 * Only visible to users with a sparks_role.
 */
export default forwardRef(function SparksCommandCenter({ user, onEnterCompany, agentOpen }, ref) {
  const [screen, setScreen] = useState('dashboard');
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [companyScreen, setCompanyScreen] = useState("overview");
  const [companyTrade, setCompanyTrade] = useState(null);
  const [splitChatPerson, setSplitChatPerson] = useState(null);
  const [splitPanelWidth, setSplitPanelWidth] = useState(40);
  const [splitRightView, setSplitRightView] = useState('people'); // active trade within company control center // overview | chat | people | billing | analytics | reports | licenses
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
  const [teamConversations, setTeamConversations] = useState({});

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
    setCompanyBilling(null);
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

  const [aiSpending, setAiSpending] = useState(null);

  async function loadAiSpending() {
    try {
      setLoading(true);
      const res = await fetch('/api/analytics/ai-spending');
      if (res.ok) setAiSpending(await res.json());
      setScreen('ai-spending');
      setError(null);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function loadMessages() {
    try {
      setLoading(true);
      const res = await fetch('/api/sparks/companies');
      if (!res.ok) throw new Error('Failed to load companies');
      setCompanies(await res.json());
      setScreen('messages');
      setError(null);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function loadCompanyDetail(companyId) {
    try {
      setLoading(true);
      const res = await fetch('/api/sparks/companies/' + companyId);
      if (!res.ok) throw new Error('Failed to load company');
      const data = await res.json();
      setSelectedCompany(data);
      setCompanyScreen('overview');
      // Default to first licensed trade for this company
      const trades = (data.trades || []).map(t => typeof t === 'object' ? t.trade : t).filter(Boolean);
      setCompanyTrade(trades[0] || null);
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
      // Fetch conversations for the team chat list (WhatsApp-style previews)
      const adminEntry = data.find(m => m.sparks_role === 'admin');
      const myId = user.person_id === '__admin__' && adminEntry ? adminEntry.id : user.person_id;
      try {
        const convRes = await fetch(`/api/v2/conversations/${myId}`);
        if (convRes.ok) {
          const convData = await convRes.json();
          const convMap = {};
          convData.forEach(c => { convMap[c.contact_id] = c; });
          setTeamConversations(convMap);
        }
      } catch(e) { /* conversations optional */ }
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
    if (screen === 'company-detail') { if (companyScreen === 'support-split') { window.__simulatingCompanyId = null; setSplitChatPerson(null); setCompanyScreen('chat'); return; } if (companyScreen !== 'overview') { setCompanyScreen('overview'); return; } setSelectedCompany(null); loadCompanies(); return; }
    if (screen !== 'dashboard') { setScreen('dashboard'); return; }
  }

  useImperativeHandle(ref, () => ({
    tryGoBack() {
      if (screen === 'company-detail') { if (companyScreen === 'support-split') { window.__simulatingCompanyId = null; setSplitChatPerson(null); setCompanyScreen('chat'); return true; } if (companyScreen !== 'overview') { setCompanyScreen('overview'); return true; } setSelectedCompany(null); loadCompanies(); return true; }
      if (screen !== 'dashboard') { setScreen('dashboard'); return true; }
      return false;
    },
    tryGoHome() {
      if (screen !== 'dashboard') { setScreen('dashboard'); return true; }
      return false;
    },
    navigateTo(nav) {
      if (!nav || !nav.screen) return false;
      switch (nav.screen) {
        case 'dashboard': setScreen('dashboard'); return true;
        case 'team': loadTeam(); return true;
        case 'messages': loadMessages(); return true;
        case 'companies': loadCompanies(); return true;
        case 'analytics': setScreen('analytics'); return true;
        case 'audit': loadAudit(); return true;
        case 'ai-spending': loadAiSpending(); return true;
        case 'folders': loadTeam(); setTimeout(() => { /* folders tab handled by TeamChatPanel */ }, 500); return true;
        case 'company-detail':
          if (nav.company_id) { loadCompanyDetail(nav.company_id); return true; }
          if (nav.company_name) {
            // Find company by name and navigate
            fetch('/api/sparks/companies').then(r => r.json()).then(companies => {
              const match = companies.find(c => c.name.toLowerCase().includes(nav.company_name.toLowerCase()));
              if (match) loadCompanyDetail(match.id);
            });
            return true;
          }
          return false;
        default: return false;
      }
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
    <Box className="list-view" sx={{ pb: screen === 'team' ? 0 : 12, pt: 0 }}>

      {/* Header — hidden on team chat screen to give full space */}
      {screen !== 'team' && screen !== 'company-detail' && screen !== 'messages' && (
        <Box sx={{ mb: 1, mt: -2.5, textAlign: 'center' }}>
          <Typography variant="h4" sx={{ color: 'text.primary', fontWeight: 800, fontSize: 32 }}>
            Control Center
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'primary.main', fontWeight: 600 }}>
            {user.sparks_role?.toUpperCase()} ACCESS
          </Typography>
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
                  { label: 'Messages', icon: '\uD83D\uDCAC', action: loadMessages, show: true },
                  { label: 'AI Spending', icon: '\uD83E\uDDE0', action: loadAiSpending, show: ['admin', 'support'].includes(user.sparks_role) },
                  { label: 'System Health', icon: '\uD83D\uDCCA', action: () => setScreen('system-health'), show: ['admin', 'support'].includes(user.sparks_role) },
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

      {/* COMPANY CONTROL CENTER — mini dashboard for each company */}
      {screen === 'company-detail' && selectedCompany && (
        <>
          {/* Sub-screen: Chat (full) */}
          {companyScreen === 'chat' && (
            <CompanyChatPanel
              user={user}
              company={selectedCompany}
              companyDetail={selectedCompany}
              companyBilling={companyBilling}
              companyAnalytics={companyAnalytics}
              onBack={() => setCompanyScreen('overview')}
              agentOpen={agentOpen}
              onEnterSplit={(person) => {
                setSplitChatPerson(person);
                setSplitRightView('people');
                window.__simulatingCompanyId = selectedCompany?.id || null;
                setCompanyScreen('support-split');
              }}
            />
          )}

          {/* Sub-screen: Support Split — customer service workstation */}
          {companyScreen === 'support-split' && splitChatPerson && (
            <Box sx={{ display: 'flex', position: 'fixed', top: 68, left: 0, right: agentOpen ? { xs: 0, sm: '420px', md: '440px' } : 0, bottom: 0, zIndex: 50, bgcolor: 'background.default' }}>

              {/* LEFT: Chat conversation */}
              <Box sx={{ width: splitPanelWidth + '%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: '#ECE5DD' }}>
                {/* Chat header */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, bgcolor: 'var(--charcoal)', borderBottom: '3px solid var(--primary)', flexShrink: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'white' }}>
                        {(splitChatPerson.name || '?').split(' ').map(n => n[0]).join('').substring(0, 2)}
                      </Typography>
                    </Box>
                    <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'white' }}>{splitChatPerson.name}</Typography>
                  </Box>
                  <Button size="small" onClick={() => { window.__simulatingCompanyId = null; setCompanyScreen('chat'); }}
                    sx={{ color: 'var(--primary)', fontSize: 11, fontWeight: 700, textTransform: 'none' }}>
                    Full Chat
                  </Button>
                </Box>
                {/* Message thread */}
                <Box sx={{ flex: 1, overflow: 'hidden' }}>
                  <MessagesView
                    key={splitChatPerson.id}
                    user={user}
                    initialContact={splitChatPerson}
                    embedded={true}
                  />
                </Box>
              </Box>

              {/* DRAGGABLE DIVIDER */}
              <Box
                sx={{
                  width: 6, cursor: 'col-resize', bgcolor: 'grey.300', flexShrink: 0,
                  '&:hover': { bgcolor: 'primary.main' },
                  transition: 'background-color 0.15s',
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const containerWidth = window.innerWidth - (agentOpen ? 440 : 0);
                  const onMouseMove = (moveEvent) => {
                    const pct = (moveEvent.clientX / containerWidth) * 100;
                    setSplitPanelWidth(Math.min(75, Math.max(25, pct)));
                  };
                  const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    document.body.style.userSelect = '';
                    document.body.style.cursor = '';
                  };
                  document.body.style.userSelect = 'none';
                  document.body.style.cursor = 'col-resize';
                  document.addEventListener('mousemove', onMouseMove);
                  document.addEventListener('mouseup', onMouseUp);
                }}
              />

              {/* RIGHT: Customer view — navigable */}
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Right header: company + trade + navigation tabs */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 0.75, bgcolor: 'rgba(249,148,64,0.06)', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0, flexWrap: 'wrap', gap: 0.5 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.primary' }}>
                    {selectedCompany.name}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                    {(selectedCompany.trades || []).map(t => {
                      const tradeName = typeof t === 'object' ? t.trade : t;
                      if (!tradeName) return null;
                      return (
                        <Button key={tradeName} size="small"
                          variant={companyTrade === tradeName ? 'contained' : 'outlined'}
                          onClick={() => setCompanyTrade(tradeName)}
                          sx={{ fontSize: 10, fontWeight: 700, borderRadius: 1.5, textTransform: 'none', px: 1, py: 0.25, minWidth: 'auto',
                            ...(companyTrade === tradeName ? { bgcolor: 'secondary.main', color: 'primary.main' } : {}),
                          }}>
                          {tradeName}
                        </Button>
                      );
                    })}
                    <Button size="small" onClick={() => { window.__simulatingCompanyId = null; setSplitChatPerson(null); setCompanyScreen('overview'); }}
                      sx={{ fontSize: 10, fontWeight: 700, textTransform: 'none', color: 'text.secondary', ml: 1 }}>
                      ✕ Close
                    </Button>
                  </Box>
                </Box>
                {/* Navigation tabs */}
                <Box sx={{ display: 'flex', gap: 0.5, px: 2, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0, bgcolor: 'background.paper' }}>
                  {[
                    { key: 'people', label: 'People' },
                    { key: 'reports', label: 'Reports' },
                    { key: 'dailyplans', label: 'Daily Plans' },
                    { key: 'punchlist', label: 'Punch List' },
                  ].map(tab => (
                    <Button key={tab.key} size="small"
                      variant={splitRightView === tab.key ? 'contained' : 'text'}
                      onClick={() => setSplitRightView(tab.key)}
                      sx={{ fontSize: 11, fontWeight: 700, borderRadius: 1.5, textTransform: 'none', px: 1.5, py: 0.5,
                        ...(splitRightView === tab.key ? { bgcolor: 'secondary.main', color: 'primary.main' } : { color: 'text.secondary' }),
                      }}>
                      {tab.label}
                    </Button>
                  ))}
                </Box>
                {/* View content */}
                <Box sx={{ flex: 1, overflow: 'auto' }}>
                  {splitRightView === 'people' && (
                    <PeopleView user={user} activeTrade={companyTrade} activeRoleLevels={{}} readOnly={true}
                      companyId={selectedCompany?.id} onOpenReport={() => {}} persistedViewingId={null}
                      setPeopleViewingId={() => {}} setView={() => {}} navigateTo={() => {}} />
                  )}
                  {splitRightView === 'reports' && (
                    <ReportsView user={user} activeTrade={companyTrade} onOpenReport={() => {}}
                      reportsPersonId={null} setReportsPersonId={() => {}} onNavigate={() => {}} />
                  )}
                  {splitRightView === 'dailyplans' && (
                    <DailyPlanView user={user} readOnly={true} onNavigate={() => {}} goBack={() => setSplitRightView('people')} />
                  )}
                  {splitRightView === 'punchlist' && (
                    <PunchListView user={user} readOnly={true} onNavigate={() => {}} goBack={() => setSplitRightView('people')} />
                  )}
                </Box>
              </Box>
            </Box>
          )}

          {/* Sub-screen: Overview (Company Control Center) */}
          {companyScreen === 'overview' && (
            <>
              {/* Header: Company name + status + action buttons */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary', fontSize: 20 }}>
                    {selectedCompany.name}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mt: 0.5 }}>
                    <Chip label={selectedCompany.status} size="small" sx={{ bgcolor: statusColors[selectedCompany.status], color: 'white', fontWeight: 700, fontSize: 11 }} />
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Tier: {selectedCompany.tier}</Typography>
                  </Box>
                </Box>
                {onEnterCompany && (
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button variant="contained" color="secondary"
                      onClick={() => onEnterCompany({ id: selectedCompany.id, name: selectedCompany.name, mode: 'customer', trades: (selectedCompany.trades || []).map(t => typeof t === 'object' ? t.trade : t).filter(Boolean) })}
                      sx={{ borderRadius: 5, fontSize: 12, fontWeight: 700, px: 2 }}>
                      View as Customer
                    </Button>
                    <Button variant="outlined"
                      onClick={() => setCompanyScreen('chat')}
                      sx={{ borderRadius: 5, fontSize: 12, fontWeight: 700, px: 2, color: 'primary.main', borderColor: 'primary.main' }}>
                      Customer Service
                    </Button>
                  </Box>
                )}
              </Box>

              {/* Quick Stats Row */}
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', my: 2, justifyContent: 'flex-start' }}>
                {[
                  { label: 'People', value: selectedCompany.total_people || selectedCompany.people_count || 0 },
                  { label: 'Reports', value: selectedCompany.total_reports || selectedCompany.report_count || 0 },
                  { label: 'AI Cost', value: companyAnalytics?.summary?.total_ai_cost_cents ? '$' + (companyAnalytics.summary.total_ai_cost_cents / 100).toFixed(0) : '$0' },
                  { label: 'Trades', value: (selectedCompany.trades || []).filter(t => typeof t === 'object' ? t.status === 'active' : true).length },
                ].map((stat, i) => (
                  <Paper key={i} variant="outlined" sx={{
                    width: 80, height: 80, display: 'flex', flexDirection: 'column',
                    justifyContent: 'center', alignItems: 'center', textAlign: 'center',
                    borderRadius: 2.5, border: '2px solid', borderColor: 'secondary.main',
                  }}>
                    <Typography sx={{ fontSize: 20, fontWeight: 800, color: 'primary.main', lineHeight: 1 }}>{stat.value}</Typography>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, mt: 0.5, color: 'text.primary' }}>{stat.label}</Typography>
                  </Paper>
                ))}
              </Box>

              {/* Trade Selector */}
              <Box sx={{ display: 'flex', gap: 1, mb: 2.5, flexWrap: 'wrap', alignItems: 'center' }}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mr: 0.5 }}>
                  Trade:
                </Typography>
                {(selectedCompany.trades || []).map(t => {
                  const tradeName = typeof t === 'object' ? t.trade : t;
                  if (!tradeName) return null;
                  return (
                    <Button key={tradeName} size="small"
                      variant={companyTrade === tradeName ? 'contained' : 'outlined'}
                      onClick={() => setCompanyTrade(tradeName)}
                      sx={{
                        fontSize: 12, fontWeight: 700, borderRadius: 2, textTransform: 'none', px: 2, py: 0.75,
                        ...(companyTrade === tradeName ? { bgcolor: 'secondary.main', color: 'primary.main' } : {}),
                      }}>
                      {tradeName}
                    </Button>
                  );
                })}
              </Box>

              {/* Action Tiles */}
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1.5 }}>
                Company Operations
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25, mb: 3 }}>
                {[
                  { label: 'Chat', icon: '💬', action: () => setCompanyScreen('chat') },
                  { label: 'People', icon: '👥', action: () => setCompanyScreen('people') },
                  { label: 'AI Analytics', icon: '🧠', action: () => setCompanyScreen('analytics') },
                  { label: 'Billing', icon: '💳', action: () => setCompanyScreen('billing'), show: ['admin'].includes(user.sparks_role) },
                  { label: 'Reports', icon: '📋', action: () => setCompanyScreen('reports') },
                  { label: 'Daily Plans', icon: '📌', action: () => setCompanyScreen('dailyplans') },
                  { label: 'Punch List', icon: '🔨', action: () => setCompanyScreen('punchlist') },
                  { label: 'Licenses', icon: '⚙️', action: () => setCompanyScreen('licenses'), show: ['admin'].includes(user.sparks_role) },
                ].filter(t => t.show !== false).map((tile, i) => (
                  <Button key={i} onClick={tile.action}
                    variant="outlined"
                    sx={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      p: 2, borderRadius: 3, minHeight: 70,
                      bgcolor: 'background.paper',
                      borderColor: 'grey.200', borderWidth: 2,
                      color: 'text.primary',
                    }}>
                    <Typography sx={{ fontSize: 22, mb: 0.5 }}>{tile.icon}</Typography>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary' }}>{tile.label}</Typography>
                  </Button>
                ))}
              </Box>

              {/* Quick view: People by Trade + Recent Reports */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 }}>
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
                    People by Trade
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                    {(selectedCompany.people_by_trade || []).map(pt => (
                      <Paper key={pt.trade} variant="outlined" sx={{ borderRadius: 2, p: 1.25 }}>
                        <Typography sx={{ fontSize: 20, fontWeight: 800, color: 'primary.main' }}>{pt.count}</Typography>
                        <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.primary' }}>{pt.trade}</Typography>
                      </Paper>
                    ))}
                  </Box>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
                    Recent Reports
                  </Typography>
                  {(selectedCompany.recent_reports || []).slice(0, 5).map(r => (
                    <Paper key={r.id} variant="outlined" sx={{ borderRadius: 2, p: 1.25, mb: 0.75, fontSize: 13 }}>
                      <Typography sx={{ fontWeight: 600, color: 'text.primary', fontSize: 13 }}>{r.person_name}</Typography>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{r.trade} · {r.report_date}</Typography>
                    </Paper>
                  ))}
                  {(!selectedCompany.recent_reports || selectedCompany.recent_reports.length === 0) && (
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', p: 1 }}>No recent reports</Typography>
                  )}
                </Box>
              </Box>
            </>
          )}

          {/* Sub-screen: People — trade selector + real PeopleView */}
          {companyScreen === 'people' && (
            <PeopleView
                user={user}
                activeTrade={companyTrade}
                companyId={selectedCompany?.id}
                activeRoleLevels={{}}
                readOnly={true}
                onOpenReport={() => {}}
                persistedViewingId={null}
                setPeopleViewingId={() => {}}
                setView={() => {}}
                navigateTo={() => {}}
              />
          )}

          {/* Sub-screen: Analytics */}
          {companyScreen === 'analytics' && (
            <>
              <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', mb: 2 }}>
                {selectedCompany.name} — AI Analytics
              </Typography>
              {companyAnalytics ? (
                <>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2 }}>
                    {[
                      { label: 'API Calls', value: companyAnalytics.summary?.total_api_calls || 0, color: 'primary.main' },
                      { label: 'AI Cost', value: '$' + ((companyAnalytics.summary?.total_ai_cost_cents || 0) / 100).toFixed(2), color: 'text.primary' },
                      { label: 'Unique Users', value: companyAnalytics.summary?.unique_users || 0, color: 'primary.main' },
                      { label: 'Total Tokens', value: (companyAnalytics.costs?.by_provider || []).reduce((s, p) => s + parseInt(p.total_input_tokens || 0) + parseInt(p.total_output_tokens || 0), 0), color: 'primary.main' },
                    ].map((card, i) => (
                      <Paper key={i} variant="outlined" sx={{ borderRadius: 2.5, p: 1.5, textAlign: 'center' }}>
                        <Typography sx={{ fontSize: 20, fontWeight: 800, color: card.color }}>{card.value}</Typography>
                        <Typography sx={{ fontSize: 10, fontWeight: 600, color: 'text.primary' }}>{card.label}</Typography>
                      </Paper>
                    ))}
                  </Box>
                  {(companyAnalytics.costs?.by_provider || []).map((p, i) => (
                    <Paper key={i} variant="outlined" sx={{ p: 1.25, borderRadius: 2.5, mb: 0.75, fontSize: 11 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography sx={{ fontWeight: 700, color: 'text.primary', fontSize: 11 }}>
                          {p.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} — {p.service}
                        </Typography>
                        <Typography sx={{ fontWeight: 800, color: 'primary.main', fontSize: 11 }}>{'$' + ((p.total_cost_cents || 0) / 100).toFixed(2)}</Typography>
                      </Box>
                    </Paper>
                  ))}
                  {companyAnalytics.costs?.by_person?.length > 0 && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.primary', mb: 0.75 }}>Top AI Users</Typography>
                      {companyAnalytics.costs.by_person.slice(0, 5).map((p, i) => (
                        <Paper key={i} variant="outlined" sx={{
                          display: 'flex', justifyContent: 'space-between', px: 1.25, py: 0.75,
                          borderRadius: 2, mb: 0.5, fontSize: 11,
                        }}>
                          <Typography sx={{ fontWeight: 600, color: 'text.primary', fontSize: 11 }}>{p.person_name || 'Unknown'}</Typography>
                          <Typography sx={{ fontWeight: 700, color: 'primary.main', fontSize: 11 }}>{'$' + ((p.total_cost_cents || 0) / 100).toFixed(2)} ({p.call_count})</Typography>
                        </Paper>
                      ))}
                    </Box>
                  )}
                </>
              ) : (
                <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center', p: 2 }}>Loading analytics...</Typography>
              )}
            </>
          )}

          {/* Sub-screen: Billing */}
          {companyScreen === 'billing' && (
            <>
              <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', mb: 2 }}>
                {selectedCompany.name} — Billing
              </Typography>
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
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                        Next billing: {sub.next_billing_date ? new Date(sub.next_billing_date).toLocaleDateString() : '—'}
                      </Typography>
                      {user.sparks_role === 'admin' && (
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                          <Select value={sub.plan_id} size="small"
                            onChange={(e) => changePlan(selectedCompany.id, e.target.value)}
                            sx={{ borderRadius: 2, fontSize: 12, fontWeight: 600, minWidth: 150 }}>
                            {allPlans.map(p => (
                              <MenuItem key={p.id} value={p.id}>{p.name + ' — $' + (p.price_cents / 100).toFixed(0) + '/mo'}</MenuItem>
                            ))}
                          </Select>
                          {sub.status !== 'cancelled' && (
                            <Button variant="outlined" color="error" size="small"
                              onClick={() => cancelSubscription(selectedCompany.id)}
                              sx={{ borderRadius: 2, fontSize: 12, fontWeight: 700 }}>
                              Cancel
                            </Button>
                          )}
                        </Box>
                      )}
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
                        sx={{ borderRadius: 2, fontSize: 12, fontWeight: 600, minWidth: 180 }}>
                        <MenuItem value="" disabled>Assign a plan...</MenuItem>
                        {allPlans.map(p => (
                          <MenuItem key={p.id} value={p.id}>{p.name + ' — $' + (p.price_cents / 100).toFixed(0) + '/mo'}</MenuItem>
                        ))}
                      </Select>
                    )}
                  </CardContent>
                </Card>
              )}
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
                Invoices
              </Typography>
              {user.sparks_role === 'admin' && (
                <Box sx={{ mb: 1.25 }}>
                  {!showInvoiceForm ? (
                    <Button variant="contained" color="secondary" size="small"
                      onClick={() => setShowInvoiceForm(true)}
                      sx={{ fontSize: 12 }}>
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
                        <Button variant="contained" size="small" onClick={() => createInvoice(selectedCompany.id)} sx={{ fontSize: 12 }}>Save</Button>
                        <Button variant="outlined" size="small" onClick={() => setShowInvoiceForm(false)} sx={{ fontSize: 12 }}>Cancel</Button>
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
                        {'Due: ' + new Date(inv.due_date).toLocaleDateString()}{inv.paid_at && (' · Paid: ' + new Date(inv.paid_at).toLocaleDateString())}
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
                <Typography sx={{ fontSize: 13, color: 'text.secondary', textAlign: 'center', p: 1.5 }}>No invoices yet</Typography>
              )}
            </>
          )}

          {/* Sub-screen: Reports — renders the real ReportsView */}
          {companyScreen === 'reports' && (
            <ReportsView
              user={user}
              activeTrade={companyTrade}
              onOpenReport={() => {}}
              reportsPersonId={null}
              setReportsPersonId={() => {}}
              onNavigate={() => {}}
            />
          )}

          {/* Sub-screen: Daily Plans — renders the real DailyPlanView */}
          {companyScreen === 'dailyplans' && (
            <DailyPlanView
              user={user}
              readOnly={true}
              onNavigate={() => {}}
              goBack={() => setCompanyScreen('overview')}
            />
          )}

          {/* Sub-screen: Punch List — renders the real PunchListView */}
          {companyScreen === 'punchlist' && (
            <PunchListView
              user={user}
              readOnly={true}
              onNavigate={() => {}}
              goBack={() => setCompanyScreen('overview')}
            />
          )}

          {/* Sub-screen: Licenses */}
          {companyScreen === 'licenses' && (
            <>
              <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', mb: 2 }}>
                {selectedCompany.name} — Licensed Products & Trades
              </Typography>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
                Products
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
                {['voice_report', 'relation_data'].map(product => {
                  const licensed = (selectedCompany.products || []).find(p => typeof p === 'object' ? p.product === product : p === product);
                  const isActive = typeof licensed === 'object' ? licensed && licensed.status === 'active' : !!licensed;
                  return (
                    <Button key={product} variant={isActive ? 'contained' : 'outlined'}
                      color={isActive ? 'secondary' : 'inherit'}
                      onClick={() => user.sparks_role === 'admin' && toggleProduct(selectedCompany.id, product, isActive ? 'active' : 'inactive')}
                      sx={{
                        borderRadius: 2.5, fontWeight: 700, fontSize: 13, px: 2, py: 1.25,
                        cursor: user.sparks_role === 'admin' ? 'pointer' : 'default',
                        ...(isActive && { bgcolor: 'secondary.main', color: 'primary.main' }),
                      }}>
                      {product === 'voice_report' ? 'Voice Report' : 'Relation Data / LoopFolders'}
                      {isActive ? ' ✓' : ''}
                    </Button>
                  );
                })}
              </Box>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
                Trades
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {['Electrical', 'Instrumentation', 'Pipe Fitting', 'Industrial Erection', 'Safety'].map(trade => {
                  const licensed = (selectedCompany.trades || []).find(t => typeof t === 'object' ? t.trade === trade : t === trade);
                  const isActive = typeof licensed === 'object' ? licensed && licensed.status === 'active' : !!licensed;
                  return (
                    <Button key={trade} variant={isActive ? 'contained' : 'outlined'}
                      color={isActive ? 'secondary' : 'inherit'} size="small"
                      onClick={() => user.sparks_role === 'admin' && toggleTrade(selectedCompany.id, trade, isActive ? 'active' : 'inactive')}
                      sx={{
                        borderRadius: 2.5, fontWeight: 600, fontSize: 12, px: 1.75, py: 1,
                        cursor: user.sparks_role === 'admin' ? 'pointer' : 'default',
                        ...(isActive && { bgcolor: 'secondary.main', color: 'primary.main' }),
                      }}>
                      {trade} {isActive ? '✓' : ''}
                    </Button>
                  );
                })}
              </Box>
            </>
          )}
        </>
      )}


      {/* TEAM SCREEN — WhatsApp Desktop split-panel layout */}
      {screen === 'team' && (
        <TeamChatPanel
          user={user}
          team={team}
          teamConversations={teamConversations}
          agentOpen={agentOpen}
        />
      )}

      {/* MESSAGES SCREEN — company communication hub */}
      {screen === 'messages' && (
        <MessagesChatPanel
          user={user}
          companies={companies}
          onBack={() => setScreen('dashboard')}
          agentOpen={agentOpen}
        />
      )}

      {/* AI SPENDING DASHBOARD */}
      {screen === 'ai-spending' && (
        <Box>
          <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 2 }}>
            AI Spending Dashboard
          </Typography>

          {aiSpending ? (
            <>
              {/* Summary cards */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5, mb: 3 }}>
                {[
                  { label: 'Total Cost', value: '$' + ((aiSpending.total_cost_cents || 0) / 100).toFixed(2), color: 'var(--primary)' },
                  { label: 'API Calls', value: aiSpending.total_calls || 0, color: 'var(--primary)' },
                  { label: 'Input Tokens', value: ((aiSpending.total_input || 0) / 1000).toFixed(1) + 'K', color: 'text.primary' },
                  { label: 'Output Tokens', value: ((aiSpending.total_output || 0) / 1000).toFixed(1) + 'K', color: 'text.primary' },
                ].map((card, i) => (
                  <Paper key={i} variant="outlined" sx={{ p: 2, borderRadius: 2.5, textAlign: 'center' }}>
                    <Typography sx={{ fontSize: 24, fontWeight: 800, color: card.color }}>{card.value}</Typography>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', fontWeight: 600 }}>{card.label}</Typography>
                  </Paper>
                ))}
              </Box>

              {/* Cost by Service */}
              <Typography sx={{ fontSize: 14, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>Cost by Service</Typography>
              <Paper variant="outlined" sx={{ borderRadius: 2.5, mb: 3, overflow: 'hidden' }}>
                {(aiSpending.by_service || []).map((s, i) => (
                  <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.25, borderBottom: i < (aiSpending.by_service || []).length - 1 ? '1px solid rgba(72,72,74,0.08)' : 'none' }}>
                    <Box>
                      <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'text.primary' }}>{s.provider} — {s.service}</Typography>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{s.calls} calls · {((s.input_tokens || 0) / 1000).toFixed(1)}K in · {((s.output_tokens || 0) / 1000).toFixed(1)}K out</Typography>
                    </Box>
                    <Typography sx={{ fontSize: 16, fontWeight: 800, color: 'var(--primary)' }}>${((s.cost_cents || 0) / 100).toFixed(2)}</Typography>
                  </Box>
                ))}
              </Paper>

              {/* Cost by Day */}
              <Typography sx={{ fontSize: 14, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>Daily Spending (Last 14 Days)</Typography>
              <Paper variant="outlined" sx={{ borderRadius: 2.5, mb: 3, p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 120 }}>
                  {(aiSpending.by_day || []).map((d, i) => {
                    const maxCost = Math.max(...(aiSpending.by_day || []).map(x => x.cost_cents || 0), 1);
                    const height = Math.max(4, ((d.cost_cents || 0) / maxCost) * 100);
                    return (
                      <Box key={i} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                        <Typography sx={{ fontSize: 9, color: 'var(--primary)', fontWeight: 700 }}>${((d.cost_cents || 0) / 100).toFixed(2)}</Typography>
                        <Box sx={{ width: '100%', height: height + '%', bgcolor: 'var(--primary)', borderRadius: '4px 4px 0 0', minHeight: 4 }} />
                        <Typography sx={{ fontSize: 9, color: 'text.secondary', whiteSpace: 'nowrap' }}>{new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Typography>
                      </Box>
                    );
                  })}
                </Box>
              </Paper>

              {/* Top Users */}
              <Typography sx={{ fontSize: 14, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>Top AI Users</Typography>
              <Paper variant="outlined" sx={{ borderRadius: 2.5, mb: 3, overflow: 'hidden' }}>
                {(aiSpending.by_user || []).map((u, i) => (
                  <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.25, borderBottom: i < (aiSpending.by_user || []).length - 1 ? '1px solid rgba(72,72,74,0.08)' : 'none' }}>
                    <Box>
                      <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'text.primary' }}>{u.person_name || 'Unknown'}</Typography>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{u.calls} calls</Typography>
                    </Box>
                    <Typography sx={{ fontSize: 16, fontWeight: 800, color: 'var(--primary)' }}>${((u.cost_cents || 0) / 100).toFixed(2)}</Typography>
                  </Box>
                ))}
              </Paper>

              {/* Monthly Projection */}
              {aiSpending.by_day && aiSpending.by_day.length > 0 && (() => {
                const totalDays = aiSpending.by_day.length;
                const totalCost = (aiSpending.total_cost_cents || 0) / 100;
                const dailyAvg = totalCost / totalDays;
                const monthlyProjection = dailyAvg * 30;
                return (
                  <Paper variant="outlined" sx={{ borderRadius: 2.5, p: 2, bgcolor: 'rgba(249,148,64,0.06)' }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 800, color: 'text.primary', mb: 0.5 }}>Monthly Projection</Typography>
                    <Typography sx={{ fontSize: 28, fontWeight: 800, color: 'var(--primary)' }}>${monthlyProjection.toFixed(2)}/mo</Typography>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Based on ${dailyAvg.toFixed(2)}/day average over {totalDays} days</Typography>
                  </Paper>
                );
              })()}
            </>
          ) : (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography sx={{ color: 'text.secondary' }}>Loading AI spending data...</Typography>
            </Box>
          )}
        </Box>
      )}

      {/* SYSTEM HEALTH SCREEN */}
      {screen === 'system-health' && (
        <SystemHealthPanel onBack={() => setScreen('dashboard')} />
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
