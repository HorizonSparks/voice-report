import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppBar, Toolbar, IconButton, Typography, Drawer, Box, Button, Avatar, Divider,
  List, ListItemButton, ListItemIcon, ListItemText, Checkbox, FormControlLabel,
  Alert, Collapse, ToggleButton, ToggleButtonGroup,
  Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AnalyticsTracker from './utils/AnalyticsTracker.js';
import LoginView from './views/LoginView.jsx';
import HomeView from './views/HomeView.jsx';
import RecordView from './views/RecordView.jsx';
import ListView from './views/ListView.jsx';
import DetailView from './views/DetailView.jsx';
import ReportsView from './views/ReportsView.jsx';
import MessagesView from './views/MessagesView.jsx';
import PeopleView from './views/PeopleView.jsx';
import TemplatesView from './views/TemplatesView.jsx';
import SafetyHub from './views/SafetyHub.jsx';
import FormsHub from './views/FormsHub.jsx';
import DailyPlanView from './views/DailyPlanView.jsx';
import PunchListView from './views/PunchListView.jsx';
import JSAView from './views/JSAView.jsx';
import TaskDetailView from './views/TaskDetailView.jsx';
import AnalyticsView from './views/AnalyticsView.jsx';
import ProjectsView from './views/ProjectsView.jsx';
import InstallBanner from './components/InstallBanner.jsx';
import PinModal from './components/PinModal.jsx';
import SparksCommandCenter from './views/SparksCommandCenter.jsx';
import SupportChat from './components/SupportChat.jsx';

const ALL_TRADES_KEYS = [
  { key: 'Electrical', icon: '⚡', tradeKey: 'trades.electrical' },
  { key: 'Instrumentation', icon: '🔧', tradeKey: 'trades.instrumentation' },
  { key: 'Pipe Fitting', icon: '🔩', tradeKey: 'trades.pipeFitting' },
  { key: 'Industrial Erection', icon: '🏗️', tradeKey: 'trades.erection' },
  { key: 'Safety', icon: '⛑️', tradeKey: 'trades.safety' },
];

export default function App() {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState('loading'); // 'loading' | 'authenticated' | 'anonymous'
  const [view, setView] = useState('home');
  const [selectedReport, setSelectedReport] = useState(null);
  const [reportsPersonId, setReportsPersonId] = useState(null);
  const [viewHistory, setViewHistory] = useState([]);
  const [activeTrade, setActiveTrade] = useState(null); // null = no trade selected, show nothing
  const [peopleViewingId, setPeopleViewingId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [safetyPanelOpen, setSafetyPanelOpen] = useState(false);
  const [companySettings, setCompanySettings] = useState(null);
  const [activeRoleLevels, setActiveRoleLevels] = useState({}); // { "Pipe Fitting": [1,2,4,5], ... }
  const [roleLevelConfigTrade, setRoleLevelConfigTrade] = useState(null); // which trade's gear panel is open
  const [simulatingCompany, setSimulatingCompany] = useState(null); // { id, name, mode } — Sparks user viewing as a company
  const [simulationMode, setSimulationMode] = useState(null);
  const [editModeEnabled, setEditModeEnabled] = useState(false);
  const [editModeExpiry, setEditModeExpiry] = useState(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinError, setPinError] = useState('');
  const readOnly = !!simulatingCompany && !editModeEnabled;
  const [supportChatOpen, setSupportChatOpen] = useState(false); // 'customer' or 'support'
  const [currentWorld, setCurrentWorld] = useState(null); // 'control-center' | 'voice-report' | null
  const [dialogConfig, setDialogConfig] = useState(null); // { title, message, onConfirm, confirmText, cancelText }

  const closeDialog = () => setDialogConfig(null);
  const showAlert = (title, message) => setDialogConfig({ title, message, confirmText: 'OK' });
  const showConfirm = (title, message, onConfirm, confirmText = 'OK', cancelText) => setDialogConfig({ title, message, onConfirm, confirmText, cancelText });

  // Build ALL_TRADES with translated labels
  // Sparks only visible to Sparks users — everyone else never sees it
  const tradeKeys = user && user.trade === 'Sparks'
    ? [...ALL_TRADES_KEYS, { key: 'Sparks', icon: '✦', tradeKey: 'trades.sparks' }]
    : ALL_TRADES_KEYS;
  const ALL_TRADES = tradeKeys.map(td => ({
    key: td.key,
    icon: td.icon,
    label: td.key === 'Sparks' ? 'Sparks' : t(td.tradeKey),
  }));

  // Role level labels per trade (for the config panel)
  const ROLE_LEVEL_LABELS = {
    Electrical: { 0: 'Helpers', 1: 'Journeymen', 2: 'Foremen', 3: 'General Foremen', 4: 'Superintendents', 5: 'Project Management' },
    Instrumentation: { 0: 'Junior Techs', 1: 'Instrument Techs', 2: 'Senior Techs', 3: 'Instrument Leads', 4: 'Instrument Supervisors', 5: 'Project Management' },
    'Pipe Fitting': { 0: 'Pipefitter Helpers', 1: 'Journeyman Pipefitters', 2: 'Pipefitter Foremen', 3: 'Pipe General Foremen', 4: 'Pipe Superintendents', 5: 'Project Management' },
    'Industrial Erection': { 0: 'Ironworker Helpers', 1: 'Journeyman Ironworkers', 2: 'Ironworker Foremen', 3: 'Erection General Foremen', 4: 'Erection Superintendents', 5: 'Project Management' },
    Safety: { 2: 'Safety Coordinators', 3: 'Safety Officers', 4: 'HSE Managers', 5: 'Site Safety Directors' },
  };

  // Toggle a role level for a trade and save to server
  const toggleRoleLevel = async (trade, level) => {
    const allLevels = Object.keys(ROLE_LEVEL_LABELS[trade] || {}).map(Number);
    const current = activeRoleLevels[trade] || allLevels; // default: all active
    let next;
    if (current.includes(level)) {
      next = current.filter(l => l !== level);
    } else {
      next = [...current, level].sort((a, b) => a - b);
    }
    // If all levels are checked, remove the key (= default all active)
    const isAllActive = allLevels.every(l => next.includes(l));
    const updated = { ...activeRoleLevels };
    if (isAllActive || next.length === 0) {
      delete updated[trade];
    } else {
      updated[trade] = next;
    }
    setActiveRoleLevels(updated);
    // Save to server
    try {
      await fetch('/api/settings/role-levels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade, levels: isAllActive ? [] : next }),
      });
    } catch (e) { console.error('Failed to save role levels:', e); }
  };

  // Starred trades — saved per user in localStorage
  const [starredTrades, setStarredTrades] = useState(() => {
    // Default: all trades starred
    return ALL_TRADES_KEYS.map(t => t.key);
  });

  // Load starred trades and restore last active trade when user logs in
  useEffect(() => {
    if (user) {
      const userKey = user.person_id || user.id || 'admin';
      const saved = localStorage.getItem(`starred_trades_${userKey}`);
      if (saved) {
        setStarredTrades(JSON.parse(saved));
      } else {
        // First login: for non-admin, star their own trade only
        if (!user.is_admin && user.trade) {
          const defaults = [user.trade];
          setStarredTrades(defaults);
          localStorage.setItem(`starred_trades_${userKey}`, JSON.stringify(defaults));
        }
      }
      // Restore last active trade from localStorage, or fall back to user's trade
      const lastTrade = localStorage.getItem(`active_trade_${userKey}`);
      if (lastTrade) {
        setActiveTrade(lastTrade);
      } else if (user.trade) {
        setActiveTrade(user.trade);
      }
    }
  }, [user]);

  // Persist active trade to localStorage whenever it changes
  useEffect(() => {
    if (user && activeTrade) {
      const userKey = user.person_id || user.id || 'admin';
      localStorage.setItem(`active_trade_${userKey}`, activeTrade);
    }
  }, [activeTrade, user]);

  const toggleStar = (tradeKey) => {
    setStarredTrades(prev => {
      const next = prev.includes(tradeKey)
        ? prev.filter(t => t !== tradeKey)
        : [...prev, tradeKey];
      if (user) localStorage.setItem(`starred_trades_${user.person_id || user.id || 'admin'}`, JSON.stringify(next));
      return next;
    });
  };

  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [jsaTaskContext, setJsaTaskContext] = useState(null);

  const navigateTo = (newView, payload) => {
    AnalyticsTracker.trackScreen(newView);
    setViewHistory(prev => [...prev, view]);
    // Clear persisted state when navigating away from views
    // DON'T clear peopleViewingId when going to dailyplan/punchlist (Assign Task flow — need to come back)
    if (view === 'people' && newView !== 'people' && newView !== 'dailyplan' && newView !== 'punchlist' && newView !== 'taskdetail') setPeopleViewingId(null);
    if (view === 'reports' && newView !== 'reports' && newView !== 'detail') setReportsPersonId(null);
    if (view === 'detail' && newView !== 'detail') setSelectedReport(null);
    // Handle payload for task detail and JSA navigation
    if (payload?.taskId) setSelectedTaskId(payload.taskId);
    if (newView === 'jsa' && payload) setJsaTaskContext(payload);
    else if (newView !== 'jsa') setJsaTaskContext(null);
    setView(newView);
    setMenuOpen(false);
  };

  const viewRef = useRef(null);
  const goBack = () => {
    // Let the current view handle back first (e.g. close a sub-view)
    if (viewRef.current?.tryGoBack?.()) return;
    if (viewHistory.length > 0) {
      const prev = viewHistory[viewHistory.length - 1];
      setViewHistory(h => h.slice(0, -1));
      setView(prev);
    } else {
      setView(currentWorld === 'control-center' || (user?.sparks_role && !simulatingCompany && currentWorld !== 'voice-report') ? 'sparks' : 'home');
    }
  };

  // Session restoration — check /api/me on mount
  useEffect(() => {
    fetch('/api/me')
      .then(r => {
        if (r.ok) return r.json();
        throw new Error('Not authenticated');
      })
      .then(userData => {
        setUser(userData);
        setAuthStatus('authenticated');
        // Sparks users land on Control Center, not home
        if (userData.sparks_role) { setView('sparks'); setCurrentWorld('control-center'); }
        AnalyticsTracker.personId = userData.person_id || userData.id || null;
      })
      .catch(() => {
        setAuthStatus('anonymous');
      });
  }, []);

  // Sparks users should never land on 'home' — redirect to Control Center
  // This is the single source of truth, regardless of caching or load order
  useEffect(() => {
    if (user?.sparks_role && !simulatingCompany && currentWorld !== 'voice-report' && view === 'home') {
      setView('sparks');
    }
  }, [user, view, simulatingCompany, currentWorld]);

  // Load company settings (only after auth resolves)
  useEffect(() => {
    if (authStatus !== 'loading') {
      fetch('/api/settings').then(r => { if (!r.ok) throw new Error('Settings failed'); return r.json(); }).then(s => {
        setCompanySettings(s);
        if (s.active_role_levels) setActiveRoleLevels(s.active_role_levels);
      }).catch(() => {});
    }
  }, [authStatus]);

  const handleLogin = (userData) => {
    setUser(userData);
    setAuthStatus('authenticated');
    // Sparks users go straight to Control Center
    setView(userData.sparks_role ? 'sparks' : 'home');
    if (userData.sparks_role) setCurrentWorld('control-center');
    setViewHistory([]);
    AnalyticsTracker.personId = userData.person_id || userData.id || null;
    AnalyticsTracker.track('auth', 'login', { role: userData.role_level, trade: userData.trade });
  };

  const logout = () => {
    // Clear local state immediately for snappy UX
    setUser(null);
    setAuthStatus('anonymous');
    setView('home');
    setViewHistory([]);
    setMenuOpen(false);
    setCurrentWorld(null);
    // Then destroy server session
    fetch('/api/logout', { method: 'POST' }).catch(() => {});
  };

  // World switching — drop into a product from Control Center
  const enterWorld = (world) => {
    setCurrentWorld(world);
    setView(world === 'voice-report' ? 'home' : 'sparks');
    setViewHistory([]);
    setMenuOpen(false);
    setActiveTrade(null);
  };
  const exitToControlCenter = () => {
    setCurrentWorld('control-center');
    setView('sparks');
    setViewHistory([]);
    setMenuOpen(false);
    setActiveTrade(null);
  };

  // Auto-expire edit mode after 15 min inactivity
  useEffect(() => {
    if (!editModeEnabled || !editModeExpiry) return;
    const remaining = editModeExpiry - Date.now();
    if (remaining <= 0) { setEditModeEnabled(false); setEditModeExpiry(null); return; }
    const timer = setTimeout(() => { setEditModeEnabled(false); setEditModeExpiry(null); }, remaining);
    return () => clearTimeout(timer);
  }, [editModeEnabled, editModeExpiry]);

  // Reset edit mode expiry on user activity
  useEffect(() => {
    if (!editModeEnabled) return;
    const refresh = () => setEditModeExpiry(Date.now() + 15 * 60 * 1000);
    const events = ['mousedown', 'keydown', 'touchstart'];
    events.forEach(e => window.addEventListener(e, refresh, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, refresh));
  }, [editModeEnabled]);

  // Sync with server every 60s — server is authoritative
  useEffect(() => {
    if (!editModeEnabled) return;
    const sync = async () => {
      try {
        const res = await fetch('/api/sparks/edit-mode/status', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (!data.enabled) { setEditModeEnabled(false); setEditModeExpiry(null); }
          else { setEditModeExpiry(Date.now() + data.remainingSeconds * 1000); }
        }
      } catch(e) {}
    };
    const interval = setInterval(sync, 60000);
    return () => clearInterval(interval);
  }, [editModeEnabled]);

  // Show loading screen while checking session
  if (authStatus === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
        <h1 style={{ color: 'var(--primary)', fontFamily: 'var(--font-header)', letterSpacing: '3px', fontSize: '28px' }}>Horizon Sparks</h1>
        <p style={{ color: 'var(--charcoal)', marginTop: '8px', fontSize: '14px' }}>Voice-Report.ai</p>
      </div>
    );
  }

  if (!user) return <LoginView onLogin={handleLogin} />;

  const openReport = (id) => { setSelectedReport(id); navigateTo('detail'); };
  const goHome = () => { if (viewRef.current?.tryGoHome?.()) return; setView(currentWorld === 'control-center' || (user?.sparks_role && !simulatingCompany && currentWorld !== 'voice-report') ? 'sparks' : 'home'); setViewHistory([]); setMenuOpen(false); setPeopleViewingId(null); setReportsPersonId(null); setSelectedReport(null); };

  // Simulation mode — Sparks user enters a company's view

  const enterSimulation = (company) => {
    const mode = company?.mode || 'customer';
    setSimulatingCompany(company);
    setSimulationMode(mode);
    setEditModeEnabled(false);
    setEditModeExpiry(null);
    setShowPinModal(false);
    setPinError('');
    window.__simulatingCompanyId = company?.id || null;
    window.__simulationMode = mode;
    setActiveTrade(null);
    setCurrentWorld('voice-report');
    setView('home');
    setViewHistory([]);
  };
  const exitSimulation = () => {
    if (editModeEnabled) fetch('/api/sparks/edit-mode/disable', { method: 'POST', credentials: 'include' }).catch(() => {});
    setEditModeEnabled(false);
    setEditModeExpiry(null);
    setShowPinModal(false);
    setSimulatingCompany(null);
    setSimulationMode(null);
    window.__simulatingCompanyId = null;
    window.__simulationMode = null;
    setActiveTrade(null);
    setCurrentWorld('control-center');
    setView('sparks');
    setViewHistory([]);
  };
  const handleEnableEditing = async (pin) => {
    try {
      setPinError('');
      const res = await fetch('/api/sparks/edit-mode/enable', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, company_id: simulatingCompany?.id }),
      });
      if (res.ok) {
        setEditModeEnabled(true);
        setEditModeExpiry(Date.now() + 15 * 60 * 1000);
        setShowPinModal(false);
        setPinError('');
      } else {
        const data = await res.json().catch(() => ({}));
        setPinError(data.error || 'Invalid PIN');
      }
    } catch (e) { setPinError('Connection error'); }
  };
  const handleDisableEditing = async () => {
    try { await fetch('/api/sparks/edit-mode/disable', { method: 'POST', credentials: 'include' }); } catch(e) {}
    setEditModeEnabled(false);
    setEditModeExpiry(null);
  };

  return (
    <Box className="app" sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', borderBottom: '4px solid', borderColor: 'primary.main' }}>
      {/* Header */}
      <AppBar position="sticky" sx={{ bgcolor: 'secondary.main', borderBottom: '4px solid', borderColor: 'primary.main' }}>
        <Toolbar sx={{ gap: 0.5, px: 2, pt: 1 }}>
          <IconButton color="inherit" onClick={() => setMenuOpen(!menuOpen)} sx={{ mr: 0.5 }}>
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </IconButton>
          {view === 'sparks' && (
            <IconButton color="inherit" onClick={goBack} sx={{ mr: 0.5 }}>
              <ArrowBackIcon sx={{ fontSize: 22 }} />
            </IconButton>
          )}
          <Box onClick={goHome} sx={{ cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {companySettings?.logo_data ? (
              <>
                <img src={companySettings.logo_data} alt={companySettings.company_name} style={{height: '32px', objectFit: 'contain', maxWidth: '180px'}} />
                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600 }}>
                  {currentWorld === 'control-center' ? 'Control Center' : t('app.subtitle')}
                </Typography>
              </>
            ) : (
              <>
                <Typography sx={{ fontWeight: 800, letterSpacing: 2, color: 'white', fontSize: 16 }}>
                  {companySettings?.company_name || t('app.title')}
                </Typography>
                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600 }}>
                  {t('app.subtitle')}
                </Typography>
              </>
            )}
          </Box>
          {view !== 'home' && (
            <Typography sx={{ fontSize: 13, color: 'primary.main', fontWeight: 600, ml: 'auto', whiteSpace: 'nowrap', alignSelf: 'flex-end' }}>
              {activeTrade}
            </Typography>
          )}
        </Toolbar>
      </AppBar>

      {/* Slide-out Drawer menu */}
      <Drawer anchor="left" open={menuOpen} onClose={() => setMenuOpen(false)}
        slotProps={{ paper: { sx: { width: 300, bgcolor: 'background.paper' } } }}>
        {/* User info */}
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {user.photo && <Avatar src={`/api/photos/${user.photo}`} sx={{ width: 48, height: 48 }} />}
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: 16, color: 'text.primary' }}>{user.name}</Typography>
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{user.role_title || t('common.administrator')}</Typography>
            </Box>
          </Box>
        </Box>

        {/* Control Center World — Product Doors */}
        {currentWorld === 'control-center' && (
          <Box sx={{ px: 2, pb: 1.5 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'text.secondary', mb: 1 }}>Products</Typography>
            <Button fullWidth variant="contained" color="secondary" onClick={() => enterWorld('voice-report')}
              sx={{ mb: 1, justifyContent: 'flex-start', borderColor: 'primary.main', border: '2px solid', fontSize: 14 }}>
              Voice Report
            </Button>
            <Button fullWidth disabled sx={{ mb: 1, justifyContent: 'flex-start', fontSize: 14, opacity: 0.6 }}>
              LoopFolders <Typography component="span" sx={{ fontSize: 10, opacity: 0.5, ml: 1 }}>coming soon</Typography>
            </Button>
            <Button fullWidth disabled sx={{ justifyContent: 'flex-start', fontSize: 14, opacity: 0.6 }}>
              Sparks <Typography component="span" sx={{ fontSize: 10, opacity: 0.5, ml: 1 }}>coming soon</Typography>
            </Button>
          </Box>
        )}

        {/* Voice Report World — Control Center return button */}
        {currentWorld === 'voice-report' && user?.sparks_role && !simulatingCompany && (
          <Box sx={{ px: 2, pb: 1.5 }}>
            <Button fullWidth variant="contained" color="secondary" onClick={exitToControlCenter}
              sx={{ border: '2px solid', borderColor: 'primary.main', fontSize: 13 }}>
              {'\u2190'} Control Center
            </Button>
          </Box>
        )}

        {/* Trade stars — only for admin and supervisors, NOT in Control Center */}
        {currentWorld !== 'control-center' && (user.is_admin || (user.role_level || 0) >= 4) && (
          <Box sx={{ px: 2, py: 2 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1.5 }}>
              {t('nav.activeTrades')}
            </Typography>
            <List disablePadding>
              {ALL_TRADES.map(trade => {
                const isStarred = starredTrades.includes(trade.key);
                const isConfigOpen = roleLevelConfigTrade === trade.key;
                const tradeLevels = ROLE_LEVEL_LABELS[trade.key] || {};
                const allLevels = Object.keys(tradeLevels).map(Number);
                const activeLevels = activeRoleLevels[trade.key] || allLevels;
                return (
                  <Box key={trade.key}>
                    <ListItemButton onClick={() => toggleStar(trade.key)} sx={{ px: 1, borderBottom: isConfigOpen ? 'none' : '1px solid', borderColor: 'divider' }}>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Typography sx={{ fontSize: 20, color: isStarred ? 'primary.main' : 'grey.300' }}>
                          {isStarred ? '★' : '☆'}
                        </Typography>
                      </ListItemIcon>
                      <ListItemText
                        primary={trade.label}
                        secondary={trade.icon}
                        slotProps={{
                          primary: { sx: { fontWeight: isStarred ? 600 : 400, color: isStarred ? 'text.primary' : 'text.secondary', fontSize: 15 } },
                          secondary: { component: 'span', sx: { fontSize: 18 } },
                        }}
                      />
                      {user.is_admin && (
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); setRoleLevelConfigTrade(isConfigOpen ? null : trade.key); }}
                          sx={{ color: isConfigOpen ? 'primary.main' : 'text.secondary' }}>
                          <MenuIcon fontSize="small" />
                        </IconButton>
                      )}
                    </ListItemButton>
                    <Collapse in={isConfigOpen}>
                      <Box sx={{ pl: 5.5, pb: 1.5, bgcolor: 'grey.100', borderBottom: '1px solid', borderColor: 'divider' }}>
                        <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1, fontWeight: 600 }}>Active Ranks</Typography>
                        {allLevels.map(level => {
                          const isActive = activeLevels.includes(level);
                          return (
                            <FormControlLabel key={level}
                              control={<Checkbox checked={isActive} onChange={() => toggleRoleLevel(trade.key, level)} size="small" sx={{ color: 'primary.main', '&.Mui-checked': { color: 'primary.main' } }} />}
                              label={tradeLevels[level]}
                              sx={{ display: 'flex', mb: 0, '& .MuiFormControlLabel-label': { fontSize: 14, color: isActive ? 'text.primary' : 'text.disabled' } }}
                            />
                          );
                        })}
                      </Box>
                    </Collapse>
                  </Box>
                );
              })}
            </List>
          </Box>
        )}

        {/* Workers see their trade — no switching */}
        {currentWorld !== 'control-center' && !user.is_admin && (user.role_level || 0) < 4 && (
          <Box sx={{ px: 2, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
              {t('nav.yourTrade')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
              <Typography sx={{ fontSize: 24 }}>{ALL_TRADES.find(t => t.key === user.trade)?.icon || '⚡'}</Typography>
              <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'text.primary' }}>{user.trade}</Typography>
            </Box>
          </Box>
        )}

        {/* Menu links */}
        <Divider />
        <List sx={{ px: 1 }}>
          {currentWorld !== 'control-center' && user.is_admin && (
            <ListItemButton onClick={() => navigateTo('templates')}>
              <ListItemText primary={'📝 ' + t('nav.templates')} />
            </ListItemButton>
          )}
          <ListItemButton onClick={() => navigateTo('messages')}>
            <ListItemText primary={'💬 ' + t('messages.title')} />
          </ListItemButton>
          <ListItemButton onClick={() => { setSupportChatOpen(true); setMenuOpen(false); }}>
            <ListItemText primary="🛠️ Tech Support" />
          </ListItemButton>
        </List>

        {/* Language toggle */}
        <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <ToggleButtonGroup value={i18n.language} exclusive fullWidth size="small"
            onChange={(_e, lang) => { if (lang) { i18n.changeLanguage(lang); localStorage.setItem('hs_language', lang); } }}>
            <ToggleButton value="en" sx={{ fontWeight: i18n.language === 'en' ? 700 : 400, fontSize: 14 }}>English</ToggleButton>
            <ToggleButton value="es" sx={{ fontWeight: i18n.language === 'es' ? 700 : 400, fontSize: 14 }}>Español</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <List sx={{ px: 1 }}>
          <ListItemButton onClick={() => { showConfirm(t('nav.logout'), t('nav.confirmLogout'), () => { closeDialog(); logout(); }, t('nav.logout'), t('common.cancel')); }}>
            <ListItemText primary={'⏻ ' + t('nav.logout')} slotProps={{ primary: { sx: { color: 'text.primary' } } }} />
          </ListItemButton>
        </List>
      </Drawer>

      {/* Sub-header with back button */}
      {view !== 'home' && (
        <Box className="sub-header" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1, bgcolor: 'background.default', borderBottom: 'none' }}>
          <Button startIcon={<ArrowBackIcon />} onClick={goBack} size="small" color="secondary" sx={{ fontWeight: 700 }}>
            {t('nav.back')}
          </Button>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {user.photo && <Avatar src={`/api/photos/${user.photo}`} sx={{ width: 28, height: 28 }} />}
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.primary' }}>{user.name}</Typography>
          </Box>
        </Box>
      )}

      {/* Simulation mode banner */}
      {simulatingCompany && (
        <Alert
          severity={editModeEnabled ? 'error' : 'warning'}
          variant="filled"
          sx={{
            borderRadius: 0, py: 0.5,
            display: 'flex', alignItems: 'center',
            '& .MuiAlert-message': { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: 1 },
          }}
        >
          <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
            {editModeEnabled
              ? '✏️ EDIT MODE — ' + simulatingCompany.name
              : '👁 Viewing: ' + simulatingCompany.name}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            {editModeEnabled ? (
              <Button size="small" variant="outlined" onClick={handleDisableEditing}
                sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 700 }}>
                Lock
              </Button>
            ) : (
              <Button size="small" variant="contained" color="secondary" onClick={() => { setPinError(''); setShowPinModal(true); }}
                sx={{ fontSize: 12, fontWeight: 700 }}>
                Enable Editing
              </Button>
            )}
            <Button size="small" variant="outlined" onClick={exitSimulation}
              sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 700 }}>
              ✕ Exit
            </Button>
          </Box>
        </Alert>
      )}

      <Box component="main" sx={{ flex: 1 }}>
        {readOnly && (
          <Alert severity="warning" variant="standard" sx={{ borderRadius: 0, fontSize: 12, fontWeight: 700, justifyContent: 'center' }}>
            Read-only mode — viewing as {simulatingCompany?.name}. Enable editing to make changes.
          </Alert>
        )}
        {view === 'home' && <HomeView user={user} setView={navigateTo} logout={logout} activeTrade={activeTrade} setActiveTrade={setActiveTrade} starredTrades={starredTrades} allTrades={ALL_TRADES} onSafetyOpen={() => setSafetyPanelOpen(true)} simulatingCompany={simulatingCompany} currentWorld={currentWorld} onEnterCompany={enterSimulation} onSupportOpen={() => setSupportChatOpen(true)} />}
        {view === 'record' && <RecordView readOnly={readOnly} user={user} onSaved={() => navigateTo('list')} />}
        {view === 'list' && <ListView user={user} onOpen={openReport} />}
        {view === 'detail' && <DetailView id={selectedReport} onBack={goBack} onHome={goHome} />}
        {view === 'reports' && <ReportsView ref={viewRef} user={user} onOpenReport={openReport} reportsPersonId={reportsPersonId} setReportsPersonId={setReportsPersonId} activeTrade={activeTrade} onNavigate={navigateTo} />}
        {view === 'forms' && <FormsHub readOnly={readOnly} user={user} goHome={goHome} activeTrade={activeTrade} />}
        {view === 'safety' && <SafetyHub user={user} goHome={goHome} />}
        {view === 'people' && (user.is_admin || (user.role_level || 1) >= 2) && <PeopleView readOnly={readOnly} ref={viewRef} activeTrade={activeTrade} activeRoleLevels={activeRoleLevels} onOpenReport={openReport} persistedViewingId={peopleViewingId} setPeopleViewingId={setPeopleViewingId} user={user} setView={setView} navigateTo={navigateTo} />}
        {view === 'templates' && user.is_admin && <TemplatesView />}
        {view === 'messages' && <MessagesView readOnly={readOnly} user={user} />}
        {view === 'dailyplan' && <DailyPlanView readOnly={readOnly} user={user} onNavigate={navigateTo} goBack={viewHistory.length > 0 ? goBack : null} />}
        {view === 'taskdetail' && <TaskDetailView readOnly={readOnly} user={user} taskId={selectedTaskId} goBack={goBack} onNavigate={navigateTo} activeTrade={activeTrade} />}
        {view === 'punchlist' && <PunchListView readOnly={readOnly} user={user} onNavigate={navigateTo} goBack={viewHistory.length > 0 ? goBack : null} />}
        {view === 'jsa' && <JSAView readOnly={readOnly} user={user} goHome={goHome} activeTrade={activeTrade} presetTaskId={jsaTaskContext?.taskId} presetTaskTitle={jsaTaskContext?.taskTitle} presetTaskDescription={jsaTaskContext?.taskDescription} />}
        {view === 'sparks' && user.sparks_role && <SparksCommandCenter ref={viewRef} user={user} goBack={goBack} onEnterCompany={enterSimulation} />}
        {view === "analytics" && <AnalyticsView goBack={goBack} />}
        {view === "projects" && <ProjectsView readOnly={readOnly} user={user} activeTrade={activeTrade} navigateTo={navigateTo} />}
      </Box>

      {/* Safety Quick-Access Panel */}
      <Drawer anchor="bottom" open={safetyPanelOpen} onClose={() => setSafetyPanelOpen(false)}
        slotProps={{ paper: { sx: { borderRadius: '20px 20px 0 0', maxHeight: '80vh' } } }}>
        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary' }}>⛑️ {t('safety.title')}</Typography>
            <IconButton onClick={() => setSafetyPanelOpen(false)}><CloseIcon /></IconButton>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Button fullWidth variant="outlined" onClick={() => { setSafetyPanelOpen(false); navigateTo('jsa'); }}
              sx={{ justifyContent: 'flex-start', gap: 1.5, py: 1.5, textAlign: 'left', borderColor: 'primary.main', borderWidth: 2 }}>
              <Typography sx={{ fontSize: 24 }}>📋</Typography>
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: 14, color: 'text.primary' }}>{t('safety.jsa')}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('safety.jsaDesc')}</Typography>
              </Box>
            </Button>
            {[
              { icon: '👁️', title: t('safety.observation'), desc: t('safety.observationDesc') },
              { icon: '⚠️', title: t('safety.reportHazard'), desc: t('safety.reportHazardDesc') },
              { icon: '🦺', title: t('safety.requestPPE'), desc: t('safety.requestPPEDesc') },
            ].map((item, i) => (
              <Button key={i} fullWidth variant="outlined" onClick={() => showAlert(t('common.info') || 'Info', 'Coming soon')}
                sx={{ justifyContent: 'flex-start', gap: 1.5, py: 1.5, textAlign: 'left' }}>
                <Typography sx={{ fontSize: 24 }}>{item.icon}</Typography>
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: 14, color: 'text.primary' }}>{item.title}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{item.desc}</Typography>
                </Box>
              </Button>
            ))}
            <Button fullWidth variant="outlined" color="error"
              onClick={() => { showConfirm(t('safety.stopWork'), t('safety.stopWorkConfirm'), () => { closeDialog(); setSafetyPanelOpen(false); showAlert(t('safety.stopWork'), t('safety.stopWorkSent')); }); }}
              sx={{ justifyContent: 'flex-start', gap: 1.5, py: 1.5, textAlign: 'left', borderWidth: 2 }}>
              <Typography sx={{ fontSize: 24 }}>🛑</Typography>
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: 14, color: 'error.main' }}>{t('safety.stopWork')}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('safety.stopWorkDesc')}</Typography>
              </Box>
            </Button>
            <Button fullWidth variant="outlined" onClick={() => showAlert(t('common.info') || 'Info', 'Coming soon')}
              sx={{ justifyContent: 'flex-start', gap: 1.5, py: 1.5, textAlign: 'left' }}>
              <Typography sx={{ fontSize: 24 }}>📞</Typography>
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: 14, color: 'text.primary' }}>{t('safety.emergency')}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('safety.emergencyDesc')}</Typography>
              </Box>
            </Button>
          </Box>
        </Box>
      </Drawer>

      <InstallBanner />
      {user && currentWorld === 'voice-report' && user.sparks_role && (
        <><PinModal
          visible={showPinModal}
          companyName={simulatingCompany?.name || ''}
          onSubmit={handleEnableEditing}
          onCancel={() => { setShowPinModal(false); setPinError(''); }}
          error={pinError}
        />
        {/* SupportChat removed — replaced by Messages panel + Agent sidebar */}
        </>
      )}

      {/* Reusable Dialog — replaces native alert() / confirm() */}
      <Dialog open={!!dialogConfig} onClose={closeDialog}>
        {dialogConfig?.title && <DialogTitle>{dialogConfig.title}</DialogTitle>}
        {dialogConfig?.message && (
          <DialogContent>
            <Typography>{dialogConfig.message}</Typography>
          </DialogContent>
        )}
        <DialogActions>
          {dialogConfig?.onConfirm && dialogConfig?.cancelText && (
            <Button onClick={closeDialog} color="secondary">
              {dialogConfig.cancelText}
            </Button>
          )}
          <Button
            onClick={() => { if (dialogConfig?.onConfirm) { dialogConfig.onConfirm(); } else { closeDialog(); } }}
            variant="contained"
            color="primary"
          >
            {dialogConfig?.confirmText || 'OK'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
