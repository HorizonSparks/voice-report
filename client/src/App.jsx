import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
    <div className="app">
      {/* Header with hamburger menu */}
      <header className="app-header">
        <button
          className="hamburger-btn"
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            background: 'none', border: 'none', color: 'white', fontSize: '32px',
            cursor: 'pointer', padding: '8px', lineHeight: 1, marginRight: '8px'
          }}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
        <div className="header-title-block" onClick={goHome} style={{cursor: 'pointer', flex: 1}}>
          {companySettings?.logo_data ? (
            <>
              <img src={companySettings.logo_data} alt={companySettings.company_name} style={{height: '32px', objectFit: 'contain', maxWidth: '180px'}} />
              <span className="header-product">{currentWorld === 'control-center' ? 'Control Center' : t('app.subtitle')}</span>
            </>
          ) : (
            <>
              <span className="header-brand">{companySettings?.company_name || t('app.title')}</span>
              <span className="header-product">{t('app.subtitle')}</span>
            </>
          )}
        </div>
        {/* Active trade indicator */}
        {view !== 'home' && (
          <span style={{fontSize: '13px', color: 'var(--primary)', fontWeight: 600, marginLeft: 'auto', whiteSpace: 'nowrap', alignSelf: 'flex-end'}}>
            {activeTrade}
          </span>
        )}
      </header>

      {/* Slide-out menu */}
      {menuOpen && (
        <>
          <div className="menu-overlay" onClick={() => setMenuOpen(false)} />
          <div className="slide-menu">
            {/* User info */}
            <div style={{padding: '20px 16px', borderBottom: '1px solid #eee'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
                {user.photo && <img src={`/api/photos/${user.photo}`} style={{width: 48, height: 48, borderRadius: '50%', objectFit: 'cover'}} alt="" />}
                <div>
                  <div style={{fontWeight: 700, fontSize: '16px', color: 'var(--charcoal)'}}>{user.name}</div>
                  <div style={{fontSize: '13px', color: '#888'}}>{user.role_title || t('common.administrator')}</div>
                </div>
              </div>
            </div>

            {/* Control Center World — Product Doors */}
            {currentWorld === 'control-center' && (
              <div style={{ padding: '0 16px 12px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--charcoal)', opacity: 0.5, marginBottom: '8px' }}>Products</div>
                <button onClick={() => enterWorld('voice-report')} style={{
                  width: '100%', padding: '14px', marginBottom: '8px', borderRadius: '10px',
                  background: 'var(--charcoal)', color: 'var(--primary)', border: '2px solid var(--primary)',
                  fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'left',
                }}>Voice Report</button>
                <button disabled style={{
                  width: '100%', padding: '14px', marginBottom: '8px', borderRadius: '10px',
                  background: 'var(--gray-100)', color: '#999', border: '2px solid var(--gray-200)',
                  fontSize: '14px', fontWeight: 700, cursor: 'default', textAlign: 'left', opacity: 0.6,
                }}>LoopFolders <span style={{ fontSize: '10px', opacity: 0.5 }}>coming soon</span></button>
                <button disabled style={{
                  width: '100%', padding: '14px', borderRadius: '10px',
                  background: 'var(--gray-100)', color: '#999', border: '2px solid var(--gray-200)',
                  fontSize: '14px', fontWeight: 700, cursor: 'default', textAlign: 'left', opacity: 0.6,
                }}>Sparks <span style={{ fontSize: '10px', opacity: 0.5 }}>coming soon</span></button>
              </div>
            )}

            {/* Voice Report World — Control Center return button */}
            {currentWorld === 'voice-report' && user?.sparks_role && !simulatingCompany && (
              <div style={{ padding: '0 16px 12px' }}>
                <button onClick={exitToControlCenter} style={{
                  width: '100%', padding: '12px', borderRadius: '10px',
                  background: 'var(--charcoal)', color: 'var(--primary)', border: '2px solid var(--primary)',
                  fontSize: '13px', fontWeight: 700, cursor: 'pointer', textAlign: 'center',
                }}>{String.fromCharCode(8592)} Control Center</button>
              </div>
            )}

            {/* Trade stars — only for admin and supervisors, NOT in Control Center */}
            {currentWorld !== 'control-center' && (user.is_admin || (user.role_level || 0) >= 4) && (
              <div style={{padding: '16px'}}>
                <p style={{fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px'}}>
                  {t('nav.activeTrades')}
                </p>
                {ALL_TRADES.map(trade => {
                  const isStarred = starredTrades.includes(trade.key);
                  const isConfigOpen = roleLevelConfigTrade === trade.key;
                  const tradeLevels = ROLE_LEVEL_LABELS[trade.key] || {};
                  const allLevels = Object.keys(tradeLevels).map(Number);
                  const activeLevels = activeRoleLevels[trade.key] || allLevels; // default: all
                  return (
                    <div key={trade.key}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                        padding: '12px 8px', borderBottom: isConfigOpen ? 'none' : '1px solid #f0f0f0',
                      }}>
                        <button onClick={() => toggleStar(trade.key)} style={{background: 'none', border: 'none', cursor: 'pointer', padding: 0}}>
                          <span style={{fontSize: '20px', color: isStarred ? '#F99440' : '#ccc'}}>
                            {isStarred ? '★' : '☆'}
                          </span>
                        </button>
                        <span style={{fontSize: '18px'}}>{trade.icon}</span>
                        <span style={{fontSize: '15px', fontWeight: isStarred ? 600 : 400, color: isStarred ? 'var(--charcoal)' : '#999', flex: 1, cursor: 'pointer'}}
                              onClick={() => toggleStar(trade.key)}>
                          {trade.label}
                        </span>
                        {user.is_admin && (
                          <button
                            onClick={() => setRoleLevelConfigTrade(isConfigOpen ? null : trade.key)}
                            style={{background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: '16px', color: isConfigOpen ? '#F99440' : '#999'}}
                            title="Configure active ranks"
                          >☰</button>
                        )}
                      </div>
                      {isConfigOpen && (
                        <div style={{padding: '4px 8px 12px 44px', borderBottom: '1px solid #f0f0f0', background: '#fafafa'}}>
                          <p style={{fontSize: '11px', color: '#888', margin: '0 0 8px', fontWeight: 600}}>Active Ranks</p>
                          {allLevels.map(level => {
                            const isActive = activeLevels.includes(level);
                            return (
                              <label key={level} style={{display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', cursor: 'pointer', fontSize: '14px', color: isActive ? 'var(--charcoal)' : '#bbb'}}>
                                <input type="checkbox" checked={isActive} onChange={() => toggleRoleLevel(trade.key, level)}
                                  style={{accentColor: '#F99440', width: '16px', height: '16px'}} />
                                {tradeLevels[level]}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Workers see their trade — no switching */}
            {currentWorld !== 'control-center' && !user.is_admin && (user.role_level || 0) < 4 && (
              <div style={{padding: '16px', borderBottom: '1px solid #eee'}}>
                <p style={{fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px'}}>
                  {t('nav.yourTrade')}
                </p>
                <div style={{display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0'}}>
                  <span style={{fontSize: '24px'}}>{ALL_TRADES.find(t => t.key === user.trade)?.icon || '⚡'}</span>
                  <span style={{fontSize: '16px', fontWeight: 700, color: 'var(--charcoal)'}}>{user.trade}</span>
                </div>
              </div>
            )}

            {/* Menu links */}
            <div style={{padding: '16px', borderTop: '1px solid #eee'}}>
              {currentWorld !== 'control-center' && user.is_admin && (
                <button onClick={() => navigateTo('templates')} className="menu-link">
                  📝 {t('nav.templates')}
                </button>
              )}
              <button onClick={() => navigateTo('messages')} className="menu-link">
                💬 {t('messages.title')}
              </button>
              <button onClick={() => { setSupportChatOpen(true); setMenuOpen(false); }} className="menu-link">
                🛠️ Tech Support
              </button>
              {/* Language toggle */}
              <div style={{display: 'flex', gap: '8px', padding: '12px 0', borderTop: '1px solid #333', marginTop: '8px'}}>
                <button onClick={() => { i18n.changeLanguage('en'); localStorage.setItem('hs_language', 'en'); }}
                  style={{flex: 1, padding: '10px', borderRadius: '8px', fontSize: '14px', fontWeight: i18n.language === 'en' ? 700 : 400,
                    border: i18n.language === 'en' ? '2px solid #E8922A' : '2px solid #555',
                    background: i18n.language === 'en' ? '#E8922A' : 'transparent',
                    color: i18n.language === 'en' ? 'var(--charcoal)' : '#999', cursor: 'pointer'}}>
                  English
                </button>
                <button onClick={() => { i18n.changeLanguage('es'); localStorage.setItem('hs_language', 'es'); }}
                  style={{flex: 1, padding: '10px', borderRadius: '8px', fontSize: '14px', fontWeight: i18n.language === 'es' ? 700 : 400,
                    border: i18n.language === 'es' ? '2px solid #E8922A' : '2px solid #555',
                    background: i18n.language === 'es' ? '#E8922A' : 'transparent',
                    color: i18n.language === 'es' ? 'var(--charcoal)' : '#999', cursor: 'pointer'}}>
                  Español
                </button>
              </div>
              <button
                onClick={() => { if (window.confirm(t('nav.confirmLogout'))) logout(); }}
                className="menu-link" style={{color: 'var(--charcoal)'}}
              >
                ⏻ {t('nav.logout')}
              </button>
            </div>
          </div>
        </>
      )}

      {view !== 'home' && (
        <div className="sub-header">
          {view !== 'home' ? (
            <button className="back-home-btn" onClick={goBack}><span style={{WebkitTextStroke: "1.5px var(--charcoal)"}}>←</span> {t('nav.back')}</button>
          ) : <span />}
          <div className="user-bar-inline">
            {user.photo && <img src={`/api/photos/${user.photo}`} className="user-avatar-sm" alt="" />}
            <span className="user-name-sm">{user.name}</span>
          </div>
        </div>
      )}

      {/* Simulation mode banner — Sparks user viewing as a company */}
      {simulatingCompany && (
        <div style={{
          background: editModeEnabled
            ? 'linear-gradient(90deg, #dc2626, #b91c1c)'
            : 'linear-gradient(90deg, var(--primary), #ff8c00)',
          color: editModeEnabled ? 'white' : 'var(--charcoal)',
          padding: '8px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontWeight: 700, fontSize: '13px', flexWrap: 'wrap', gap: '8px',
        }}>
          <span>
            {editModeEnabled
              ? '✏️ EDIT MODE — ' + simulatingCompany.name
              : '👁 Viewing: ' + simulatingCompany.name}
          </span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {editModeEnabled ? (
              <button onClick={handleDisableEditing} style={{
                background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.4)',
                borderRadius: '6px', padding: '4px 12px', fontWeight: 700, fontSize: '12px', cursor: 'pointer',
              }}>Lock</button>
            ) : (
              <button onClick={() => { setPinError(''); setShowPinModal(true); }} style={{
                background: 'var(--charcoal)', color: 'var(--primary)', border: 'none',
                borderRadius: '6px', padding: '4px 12px', fontWeight: 700, fontSize: '12px', cursor: 'pointer',
              }}>Enable Editing</button>
            )}
            <button onClick={exitSimulation} style={{
              background: editModeEnabled ? 'rgba(255,255,255,0.2)' : 'var(--charcoal)',
              color: 'white', border: editModeEnabled ? '1px solid rgba(255,255,255,0.4)' : 'none',
              borderRadius: '6px', padding: '4px 12px', fontWeight: 700, fontSize: '12px', cursor: 'pointer',
            }}>✕ Exit</button>
          </div>
        </div>
      )}

      <main>
        {readOnly && (
          <div style={{ background: "#fff3cd", color: "#856404", padding: "8px 16px", fontSize: "12px", fontWeight: 700, textAlign: "center", borderBottom: "1px solid #ffc107" }}>
            Read-only mode — viewing as {simulatingCompany?.name}. Enable editing to make changes.
          </div>
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
      </main>

      {/* Safety Quick-Access Panel */}
      {safetyPanelOpen && (
        <>
          <div className="menu-overlay" onClick={() => setSafetyPanelOpen(false)} style={{zIndex: 1000}} />
          <div className="safety-panel">
            <div className="safety-panel-header">
              <h2 style={{margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--charcoal)'}}>⛑️ {t('safety.title')}</h2>
              <button onClick={() => setSafetyPanelOpen(false)} style={{background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: 'var(--charcoal)', padding: '4px'}}>✕</button>
            </div>
            <div className="safety-panel-items">
              <button className="safety-panel-btn safety-btn-jsa" onClick={() => { setSafetyPanelOpen(false); navigateTo('jsa'); }}>
                <span className="safety-btn-icon">📋</span>
                <div>
                  <span className="safety-btn-title">{t('safety.jsa')}</span>
                  <span className="safety-btn-desc">{t('safety.jsaDesc')}</span>
                </div>
              </button>
              <button className="safety-panel-btn" onClick={() => { alert('Coming soon'); }}>
                <span className="safety-btn-icon">👁️</span>
                <div>
                  <span className="safety-btn-title">{t('safety.observation')}</span>
                  <span className="safety-btn-desc">{t('safety.observationDesc')}</span>
                </div>
              </button>
              <button className="safety-panel-btn" onClick={() => { alert('Coming soon'); }}>
                <span className="safety-btn-icon">⚠️</span>
                <div>
                  <span className="safety-btn-title">{t('safety.reportHazard')}</span>
                  <span className="safety-btn-desc">{t('safety.reportHazardDesc')}</span>
                </div>
              </button>
              <button className="safety-panel-btn" onClick={() => { alert('Coming soon'); }}>
                <span className="safety-btn-icon">🦺</span>
                <div>
                  <span className="safety-btn-title">{t('safety.requestPPE')}</span>
                  <span className="safety-btn-desc">{t('safety.requestPPEDesc')}</span>
                </div>
              </button>
              <button className="safety-panel-btn safety-btn-stop" onClick={() => { if (window.confirm(t('safety.stopWorkConfirm'))) { setSafetyPanelOpen(false); alert(t('safety.stopWorkSent')); } }}>
                <span className="safety-btn-icon">🛑</span>
                <div>
                  <span className="safety-btn-title">{t('safety.stopWork')}</span>
                  <span className="safety-btn-desc">{t('safety.stopWorkDesc')}</span>
                </div>
              </button>
              <button className="safety-panel-btn" onClick={() => { alert('Coming soon'); }}>
                <span className="safety-btn-icon">📞</span>
                <div>
                  <span className="safety-btn-title">{t('safety.emergency')}</span>
                  <span className="safety-btn-desc">{t('safety.emergencyDesc')}</span>
                </div>
              </button>
            </div>
          </div>
        </>
      )}
      <InstallBanner />
      {/* Floating Support Chat — for operators and supervisors */}
      {user && currentWorld === 'voice-report' && user.sparks_role && (
        <><PinModal
          visible={showPinModal}
          companyName={simulatingCompany?.name || ''}
          onSubmit={handleEnableEditing}
          onCancel={() => { setShowPinModal(false); setPinError(''); }}
          error={pinError}
        />
        <SupportChat user={user} simulatingCompany={simulatingCompany} externalOpen={supportChatOpen} onExternalOpenChange={setSupportChatOpen} /></>
      )}
    </div>
  );
}
