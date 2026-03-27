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
  const [activeTrade, setActiveTrade] = useState('Electrical');
  const [peopleViewingId, setPeopleViewingId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [safetyPanelOpen, setSafetyPanelOpen] = useState(false);
  const [companySettings, setCompanySettings] = useState(null);

  // Build ALL_TRADES with translated labels
  const ALL_TRADES = ALL_TRADES_KEYS.map(td => ({
    key: td.key,
    icon: td.icon,
    label: t(td.tradeKey),
  }));

  // Starred trades — saved per user in localStorage
  const [starredTrades, setStarredTrades] = useState(() => {
    // Default: all trades starred
    return ALL_TRADES_KEYS.map(t => t.key);
  });

  // Load starred trades when user logs in
  useEffect(() => {
    if (user) {
      const saved = localStorage.getItem(`starred_trades_${user.person_id || user.id || 'admin'}`);
      if (saved) {
        setStarredTrades(JSON.parse(saved));
      } else {
        // First login: for non-admin, star their own trade only
        if (!user.is_admin && user.trade) {
          const defaults = [user.trade];
          setStarredTrades(defaults);
          localStorage.setItem(`starred_trades_${user.person_id || user.id}`, JSON.stringify(defaults));
        }
      }
      // Set active trade to user's trade or first starred
      if (user.trade) setActiveTrade(user.trade);
    }
  }, [user]);

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
      setView('home');
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
        AnalyticsTracker.personId = userData.person_id || userData.id || null;
      })
      .catch(() => {
        setAuthStatus('anonymous');
      });
  }, []);

  // Load company settings (only after auth resolves)
  useEffect(() => {
    if (authStatus !== 'loading') {
      fetch('/api/settings').then(r => r.json()).then(setCompanySettings).catch(() => {});
    }
  }, [authStatus]);

  const handleLogin = (userData) => {
    setUser(userData);
    setAuthStatus('authenticated');
    setView('home');
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
    // Then destroy server session
    fetch('/api/logout', { method: 'POST' }).catch(() => {});
  };

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
  const goHome = () => { setView('home'); setViewHistory([]); setMenuOpen(false); setPeopleViewingId(null); setReportsPersonId(null); setSelectedReport(null); };

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
              <span className="header-product">{t('app.subtitle')}</span>
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

            {/* Trade stars — only for admin and supervisors (role_level >= 4) */}
            {(user.is_admin || (user.role_level || 0) >= 4) && (
              <div style={{padding: '16px'}}>
                <p style={{fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px'}}>
                  {t('nav.activeTrades')}
                </p>
                {ALL_TRADES.map(trade => {
                  const isStarred = starredTrades.includes(trade.key);
                  return (
                    <button
                      key={trade.key}
                      onClick={() => toggleStar(trade.key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
                        padding: '12px 8px', background: 'none', border: 'none', cursor: 'pointer',
                        borderBottom: '1px solid #f0f0f0', textAlign: 'left'
                      }}
                    >
                      <span style={{fontSize: '20px', color: isStarred ? '#F99440' : '#ccc'}}>
                        {isStarred ? '★' : '☆'}
                      </span>
                      <span style={{fontSize: '18px'}}>{trade.icon}</span>
                      <span style={{fontSize: '15px', fontWeight: isStarred ? 600 : 400, color: isStarred ? 'var(--charcoal)' : '#999'}}>
                        {trade.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {/* Workers see their trade — no switching */}
            {!user.is_admin && (user.role_level || 0) < 4 && (
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
              {user.is_admin && (
                <button onClick={() => navigateTo('templates')} className="menu-link">
                  📝 {t('nav.templates')}
                </button>
              )}
              <button onClick={() => navigateTo('messages')} className="menu-link">
                💬 {t('messages.title')}
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
          <button className="back-home-btn" onClick={goHome}>← {t('nav.home')}</button>
          <div className="user-bar-inline">
            {user.photo && <img src={`/api/photos/${user.photo}`} className="user-avatar-sm" alt="" />}
            <span className="user-name-sm">{user.name}</span>
          </div>
        </div>
      )}

      {view !== 'home' && viewHistory.length > 0 && (
        <button className="back-home-btn" onClick={goBack} style={{display: 'block', padding: '4px 14px', marginLeft: '16px', marginTop: '8px', marginBottom: '0', textAlign: 'left'}}>← {t('nav.back')}</button>
      )}

      <main>
        {view === 'home' && <HomeView user={user} setView={navigateTo} logout={logout} activeTrade={activeTrade} setActiveTrade={setActiveTrade} starredTrades={starredTrades} allTrades={ALL_TRADES} onSafetyOpen={() => setSafetyPanelOpen(true)} />}
        {view === 'record' && <RecordView user={user} onSaved={() => navigateTo('list')} />}
        {view === 'list' && <ListView user={user} onOpen={openReport} />}
        {view === 'detail' && <DetailView id={selectedReport} onBack={goBack} onHome={goHome} />}
        {view === 'reports' && <ReportsView ref={viewRef} user={user} onOpenReport={openReport} reportsPersonId={reportsPersonId} setReportsPersonId={setReportsPersonId} activeTrade={activeTrade} onNavigate={navigateTo} />}
        {view === 'forms' && <FormsHub user={user} goHome={goHome} activeTrade={activeTrade} />}
        {view === 'safety' && <SafetyHub user={user} goHome={goHome} />}
        {view === 'people' && (user.is_admin || (user.role_level || 1) >= 2) && <PeopleView ref={viewRef} activeTrade={activeTrade} onOpenReport={openReport} persistedViewingId={peopleViewingId} setPeopleViewingId={setPeopleViewingId} user={user} setView={setView} navigateTo={navigateTo} />}
        {view === 'templates' && user.is_admin && <TemplatesView />}
        {view === 'messages' && <MessagesView user={user} />}
        {view === 'dailyplan' && <DailyPlanView user={user} onNavigate={navigateTo} goBack={viewHistory.length > 0 ? goBack : null} />}
        {view === 'taskdetail' && <TaskDetailView user={user} taskId={selectedTaskId} goBack={goBack} onNavigate={navigateTo} activeTrade={activeTrade} />}
        {view === 'punchlist' && <PunchListView user={user} onNavigate={navigateTo} goBack={viewHistory.length > 0 ? goBack : null} />}
        {view === 'jsa' && <JSAView user={user} goHome={goHome} activeTrade={activeTrade} presetTaskId={jsaTaskContext?.taskId} presetTaskTitle={jsaTaskContext?.taskTitle} presetTaskDescription={jsaTaskContext?.taskDescription} />}
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
              <button className="safety-panel-btn" onClick={() => { setSafetyPanelOpen(false); navigateTo('safety-observation'); }}>
                <span className="safety-btn-icon">👁️</span>
                <div>
                  <span className="safety-btn-title">{t('safety.observation')}</span>
                  <span className="safety-btn-desc">{t('safety.observationDesc')}</span>
                </div>
              </button>
              <button className="safety-panel-btn" onClick={() => { setSafetyPanelOpen(false); navigateTo('report-hazard'); }}>
                <span className="safety-btn-icon">⚠️</span>
                <div>
                  <span className="safety-btn-title">{t('safety.reportHazard')}</span>
                  <span className="safety-btn-desc">{t('safety.reportHazardDesc')}</span>
                </div>
              </button>
              <button className="safety-panel-btn" onClick={() => { setSafetyPanelOpen(false); navigateTo('request-ppe'); }}>
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
              <button className="safety-panel-btn" onClick={() => { setSafetyPanelOpen(false); navigateTo('emergency-contacts'); }}>
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
    </div>
  );
}
