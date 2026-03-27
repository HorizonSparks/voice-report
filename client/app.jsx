const { useState, useEffect, useRef } = React;

// ============================================================
// Analytics Tracker — lightweight client-side event tracking
// ============================================================
const AnalyticsTracker = {
  sessionId: 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
  queue: [],
  personId: null,
  lastScreen: null,
  lastScreenTime: Date.now(),

  track(eventType, eventName, data = {}) {
    this.queue.push({
      event_type: eventType,
      event_name: eventName,
      event_data: Object.keys(data).length ? JSON.stringify(data) : null,
      screen: data.screen || this.lastScreen || null,
      duration_ms: data.duration_ms || null,
    });
    if (this.queue.length >= 10) this.flush();
  },

  trackScreen(screenName) {
    const now = Date.now();
    const duration = this.lastScreen ? (now - this.lastScreenTime) : null;
    this.track('screen_view', screenName, { screen: screenName, duration_ms: duration });
    this.lastScreen = screenName;
    this.lastScreenTime = now;
  },

  flush() {
    if (!this.queue.length) return;
    const events = this.queue.splice(0);
    try {
      const blob = new Blob([JSON.stringify({
        session_id: this.sessionId,
        person_id: this.personId,
        events,
      })], { type: 'application/json' });
      navigator.sendBeacon('/api/analytics/events', blob);
    } catch(e) { /* silent */ }
  },
};
setInterval(() => AnalyticsTracker.flush(), 5000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') AnalyticsTracker.flush();
});
window.onerror = (msg, src, line) => {
  AnalyticsTracker.track('error', 'js_error', { message: String(msg).substring(0, 200), source: src, line });
};
window.onunhandledrejection = (e) => {
  AnalyticsTracker.track('error', 'promise_rejection', { message: String(e.reason).substring(0, 200) });
};

// ============================================================
// App — Router with Auth
// ============================================================
function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home');
  const [selectedReport, setSelectedReport] = useState(null);
  const [officePersonId, setOfficePersonId] = useState(null);
  const [viewHistory, setViewHistory] = useState([]);
  const [activeTrade, setActiveTrade] = useState('Electrical');
  const [peopleViewingId, setPeopleViewingId] = useState(null);

  const navigateTo = (newView) => {
    AnalyticsTracker.trackScreen(newView);
    setViewHistory(prev => [...prev, view]);
    setView(newView);
  };

  const goBack = () => {
    if (viewHistory.length > 0) {
      const prev = viewHistory[viewHistory.length - 1];
      setViewHistory(h => h.slice(0, -1));
      setView(prev);
    } else {
      setView('home');
    }
  };

  const handleLogin = (userData) => {
    setUser(userData);
    setView('home');
    setViewHistory([]);
    AnalyticsTracker.personId = userData.person_id || userData.id || null;
    AnalyticsTracker.track('auth', 'login', { role: userData.role_level, trade: userData.trade });
  };

  const logout = () => { setUser(null); setView('home'); setViewHistory([]); };

  if (!user) return <LoginView onLogin={handleLogin} />;

  const openReport = (id) => { setSelectedReport(id); navigateTo('detail'); };
  const goHome = () => { setView('home'); setViewHistory([]); };

  return (
    <div className="app">
      <header className="app-header" onClick={goHome} style={{cursor:'pointer'}}>
        <div className="header-title-block">
          <span className="header-brand">HORIZON SPARKS</span>
          <span className="header-product">Voice-Report.ai</span>
        </div>
      </header>

      {view !== 'home' && (
        <div className="sub-header">
          <button className="back-home-btn" onClick={goHome}>← Home</button>
          <div className="user-bar-inline">
            {user.photo && <img src={`/api/photos/${user.photo}`} className="user-avatar-sm" alt="" />}
            <span className="user-name-sm">{user.name}</span>
          </div>
        </div>
      )}

      <main>
        {view === 'home' && <HomeView user={user} setView={navigateTo} logout={logout} activeTrade={activeTrade} setActiveTrade={setActiveTrade} />}
        {view === 'record' && <RecordView user={user} onSaved={() => navigateTo('list')} />}
        {view === 'list' && <ListView user={user} onOpen={openReport} />}
        {view === 'detail' && <DetailView id={selectedReport} onBack={goBack} onHome={goHome} />}
        {view === 'office' && <OfficeView user={user} onOpenReport={openReport} officePersonId={officePersonId} setOfficePersonId={setOfficePersonId} activeTrade={activeTrade} />}
        {view === 'forms' && <FormsHub user={user} goHome={goHome} />}
        {view === 'safety' && <SafetyHub user={user} goHome={goHome} />}
        {view === 'people' && (user.is_admin || (user.role_level || 1) >= 2) && <PeopleView activeTrade={activeTrade} onOpenReport={openReport} persistedViewingId={peopleViewingId} setPeopleViewingId={setPeopleViewingId} user={user} />}
        {view === 'templates' && user.is_admin && <TemplatesView />}
        {view === 'messages' && <MessagesView user={user} />}
        {view === 'dailyplan' && <DailyPlanView user={user} />}
        {view === 'punchlist' && <PunchListView user={user} />}
      </main>
    </div>
  );
}

// ============================================================
// Home View — Big Square Tile Buttons
// ============================================================
function HomeView({ user, setView, logout, activeTrade, setActiveTrade }) {
  const tiles = [];
  const isJourneyman = (user.role_level || 1) === 1 && !user.is_admin;

  if (user.is_admin) {
    // Admin layout: People, All Reports, Safety, Forms, Templates, then extras
    tiles.push({ id: 'people', icon: '👥', label: 'People', color: '#48484A', view: 'people' });
    tiles.push({ id: 'office', icon: '📋', label: 'Reports', color: '#48484A', view: 'office' });
    tiles.push({ id: 'safety', icon: '⛑️', label: 'Safety', color: '#48484A', view: 'safety' });
    tiles.push({ id: 'forms', icon: '📝', label: 'Forms', color: '#48484A', view: 'forms' });
    tiles.push({ id: 'templates', icon: '📝', label: 'Templates', color: '#48484A', view: 'templates' });
    tiles.push({ id: 'messages', icon: '💬', label: 'Messages', color: '#48484A', view: 'messages' });
    tiles.push({ id: 'assistant', icon: '🤖', label: 'Assistant', color: '#48484A', view: 'assistant', disabled: true, badge: 'Soon' });
  } else {
    // Non-admin layout — Daily Plan on top, then Reports, Assistant, Messages, Safety
    const isSupervisor = (user.role_level || 1) >= 2;
    tiles.push({ id: 'dailyplan', icon: '📌', label: 'Daily Plan / Punch List', color: '#48484A', view: 'dailyplan', fullWidth: true });
    tiles.push({ id: 'office', icon: '📋', label: 'Reports', color: '#48484A', view: 'office' });
    tiles.push({ id: 'assistant', icon: '🤖', label: 'Assistant', color: '#48484A', view: 'assistant', disabled: true, badge: 'Soon' });
    tiles.push({ id: 'messages', icon: '💬', label: 'Messages', color: '#48484A', view: 'messages' });
    tiles.push({ id: 'safety', icon: '⛑️', label: 'Safety', color: '#48484A', view: 'safety' });
    if (isSupervisor) {
      tiles.push({ id: 'crew', icon: '👥', label: 'Crew', color: '#48484A', view: 'people' });
    }
    if (isSupervisor) {
      tiles.push({ id: 'forms', icon: '📝', label: 'Forms', color: '#48484A', view: 'forms' });
    }
  }

  return (
    <div className="home-view">
      <div className="home-welcome">
        <div className="home-welcome-row">
          {user.photo && <img src={`/api/photos/${user.photo}`} className="home-avatar" alt="" />}
          <div>
            <h2 className="home-greeting">Welcome, {user.name}</h2>
            <p className="home-role">{user.role_title || 'Administrator'}</p>
          </div>
        </div>
      </div>

      {/* Admin trade filter tabs — always on top */}
      {user.is_admin && (
        <div className="trade-tabs">
          {[
            { key: 'Electrical', label: '⚡ Electrical' },
            { key: 'Instrumentation', label: '🔧 Instrumentation' },
            { key: 'Pipe Fitting', label: '🔩 Pipe Fitting' },
            { key: 'Industrial Erection', label: '🏗️ Erection' },
            { key: 'Safety', label: '⛑️ Safety' },
          ].map(tab => (
            <button
              key={tab.label}
              className={`trade-tab ${activeTrade === tab.key ? 'trade-tab-active' : ''}`}
              onClick={() => setActiveTrade(tab.key)}
            >
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="home-tiles">
        {tiles.map(tile => (
          <button
            key={tile.id}
            className={`home-tile ${tile.disabled ? 'tile-disabled' : ''} ${tile.id === 'record' ? 'tile-primary' : ''}`}
            onClick={() => tile.action ? tile.action() : !tile.disabled && setView(tile.view)}
            disabled={tile.disabled}
            style={tile.fullWidth ? {gridColumn: '1 / -1', justifyContent: 'center'} : undefined}
          >
            {tile.badge && <span className="tile-badge">{tile.badge}</span>}
            <span className="tile-icon">{tile.icon === 'mic-svg' ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="var(--charcoal)">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            ) : tile.icon}</span>
            <span className="tile-label">{tile.label}</span>
          </button>
        ))}
      </div>

      <button
        className="home-tile tile-primary home-voice-btn"
        onClick={() => setView('record')}
        style={{maxWidth: '280px', marginTop: '8px', alignSelf: 'center', margin: '8px auto 0'}}
      >
        <span className="tile-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="var(--charcoal)">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
        </svg></span>
        <span className="tile-label">Voice Report</span>
      </button>

      <div className="home-bottom-line"></div>
      <button className="home-logout" onClick={() => { if (window.confirm('Are you sure you want to log out?')) logout(); }}>
        ⏻ Logout
      </button>
    </div>
  );
}

// ============================================================
// Office View — Folder Navigation
// ============================================================
function OfficeView({ user, onOpenReport, officePersonId, setOfficePersonId, activeTrade }) {
  const [people, setPeople] = useState([]);
  const [allReports, setAllReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('category'); // category, timeline
  const [expandedFolders, setExpandedFolders] = useState({});
  const [selectedCategory, setSelectedCategory] = useState(null); // role level for full-screen category view

  useEffect(() => { loadOffice(); }, []);

  const loadOffice = async () => {
    try {
      const [pRes, rRes] = await Promise.all([
        fetch('/api/people'),
        fetch('/api/reports'),
      ]);
      const allPeople = pRes.ok ? await pRes.json() : [];
      const reports = rRes.ok ? await rRes.json() : [];

      let visiblePeople = [];
      if (user.is_admin) {
        visiblePeople = allPeople;
      } else {
        visiblePeople = allPeople.filter(p => p.supervisor_id === user.person_id);
        const self = allPeople.find(p => p.id === user.person_id);
        if (self) visiblePeople.unshift(self);
      }
      setPeople(visiblePeople);

      // Filter reports to visible people
      const visibleIds = new Set(visiblePeople.map(p => p.id));
      const visibleReports = user.is_admin ? reports : reports.filter(r => visibleIds.has(r.person_id));
      setAllReports(visibleReports.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch (e) { console.error('Failed to load office:', e); }
    setLoading(false);
  };

  const toggleFolder = (key) => setExpandedFolders(f => ({ ...f, [key]: !f[key] }));

  const formatSmartDate = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const reportDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.floor((today - reportDay) / 86400000);
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (diffDays === 0) return { main: 'Today', sub: time };
    if (diffDays === 1) return { main: 'Yesterday', sub: time };
    if (diffDays < 7) return { main: d.toLocaleDateString('en-US', { weekday: 'long' }), sub: time };
    return { main: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), sub: d.toLocaleDateString('en-US', { weekday: 'long' }) + ' · ' + time };
  };

  const renderReportCard = (report) => {
    const person = people.find(p => p.id === report.person_id);
    const sd = formatSmartDate(report.created_at);
    return (
      <button key={report.id} className="report-card" style={{marginBottom: '6px', width: '100%', textAlign: 'left'}} onClick={() => onOpenReport(report.id)}>
        <div className="report-card-header">
          <span className="report-date" style={{fontWeight: 700}}>{person?.name || 'Unknown'}</span>
          <span style={{fontSize: '12px', color: 'var(--gray-500)'}}>{sd.main} · {sd.sub}</span>
        </div>
        <div className="report-preview">
          <span style={{color: 'var(--primary)', fontSize: '12px', marginRight: '6px'}}>{person?.role_title || ''}</span>
          {(report.preview || report.transcript_raw || '').substring(0, 60)}...
        </div>
      </button>
    );
  };

  if (loading) return <div className="loading">Loading Office...</div>;

  // Role groups for category view (lowest first like People)
  const roleGroupsByTrade = {
    Electrical: [
      { level: 0, label: 'Helpers' },
      { level: 1, label: 'Journeymen' },
      { level: 2, label: 'Foremen' },
      { level: 3, label: 'General Foremen' },
      { level: 4, label: 'Superintendents' },
      { level: 5, label: 'Project Management' },
    ],
    Instrumentation: [
      { level: 0, label: 'Junior Techs' },
      { level: 1, label: 'Instrument Techs' },
      { level: 2, label: 'Senior Techs' },
      { level: 3, label: 'Instrument Leads' },
      { level: 4, label: 'Instrument Supervisors' },
      { level: 5, label: 'Project Management' },
    ],
    Safety: [
      { level: 0, label: 'Safety Assistants' },
      { level: 1, label: 'Safety Officers' },
      { level: 2, label: 'Safety Supervisors' },
      { level: 3, label: 'Safety Managers' },
      { level: 4, label: 'Safety Directors' },
      { level: 5, label: 'Project Management' },
    ],
  };
  const roleGroups = roleGroupsByTrade[activeTrade] || roleGroupsByTrade.Electrical;

  // Timeline grouping — defined here so full-screen category can use it
  const getWeekKey2 = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - dayOfWeek);
    const reportDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (reportDay >= weekStart) return 'this_week';
    const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(weekStart.getDate() - 7);
    if (reportDay >= lastWeekStart) return 'last_week';
    const twoWeeksStart = new Date(weekStart); twoWeeksStart.setDate(weekStart.getDate() - 14);
    if (reportDay >= twoWeeksStart) return 'two_weeks_ago';
    return `month_${d.getFullYear()}_${d.getMonth()}`;
  };
  const getWeekLabel2 = (key) => {
    if (key === 'this_week') return 'This Week';
    if (key === 'last_week') return 'Last Week';
    if (key === 'two_weeks_ago') return '2 Weeks Ago';
    if (key.startsWith('month_')) {
      const parts = key.split('_');
      const d = new Date(parseInt(parts[1]), parseInt(parts[2]), 1);
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    return key;
  };

  // Full-screen category view
  if (selectedCategory !== null) {
    const isMineCategory = selectedCategory === 'mine';
    const group = isMineCategory ? { label: 'My Reports' } : roleGroups.find(g => g.level === selectedCategory);
    const groupPeople = isMineCategory
      ? people.filter(p => p.id === user.person_id)
      : people.filter(p => (parseInt(p.role_level) || 0) === selectedCategory && p.id !== user.person_id).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const groupReports = allReports.filter(r => groupPeople.some(p => p.id === r.person_id));

    return (
      <div className="office-view">
        <button className="back-btn" onClick={() => setSelectedCategory(null)}>← Back to Reports</button>
        <h2 className="office-title" style={{marginBottom: '20px'}}>{group?.label} <span style={{color: 'var(--primary)', fontSize: '20px'}}>({groupReports.length} reports)</span></h2>

        {groupPeople.map(person => {
          const personReports = allReports.filter(r => r.person_id === person.id);
          // Group by week/month
          const groups = {}; const groupOrder = [];
          personReports.forEach(r => {
            const key = getWeekKey2(r.created_at);
            if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
            groups[key].push(r);
          });

          return (
            <div key={person.id} style={{marginBottom: '24px'}}>
              <div style={{background: 'var(--charcoal)', color: 'var(--primary)', padding: '12px 18px', borderRadius: '10px 10px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                <span style={{fontWeight: 700, fontSize: '16px'}}>{person.name}</span>
                <span style={{fontSize: '13px', color: 'var(--gray-400)'}}>{personReports.length} reports</span>
              </div>
              <div style={{border: '2px solid var(--gray-200)', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '12px 14px'}}>
                {personReports.length === 0 ? (
                  <p style={{color: 'var(--gray-400)', fontSize: '13px', margin: 0}}>No reports yet</p>
                ) : groupOrder.map(key => {
                  const isThisWeek = key === 'this_week';
                  const folderKey = 'oc_' + person.id + '_' + key;
                  const isOpen = isThisWeek || expandedFolders[folderKey];
                  return (
                    <div key={key} style={{marginBottom: '8px'}}>
                      <div
                        onClick={() => !isThisWeek && toggleFolder(folderKey)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
                          background: isThisWeek ? 'transparent' : 'var(--gray-100)',
                          borderRadius: isThisWeek ? 0 : '8px',
                          cursor: isThisWeek ? 'default' : 'pointer',
                          fontWeight: 600, fontSize: '14px', color: 'var(--charcoal)',
                          borderBottom: isThisWeek ? '2px solid var(--primary)' : 'none',
                        }}
                      >
                        {!isThisWeek && <span style={{fontSize: '13px'}}>📁</span>}
                        <span style={{flex: 1}}>{getWeekLabel2(key)}</span>
                        <span style={{fontSize: '12px', color: 'var(--primary)', fontWeight: 600}}>{groups[key].length}</span>
                        {!isThisWeek && <span style={{fontSize: '11px'}}>{isOpen ? '▼' : '▶'}</span>}
                      </div>
                      {isOpen && (
                        <div style={{padding: isThisWeek ? '4px 0' : '4px 8px'}}>
                          {groups[key].map(renderReportCard)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Timeline grouping
  const getWeekKey = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek); // Sunday

    const reportDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.floor((today - reportDay) / 86400000);

    if (reportDay >= weekStart) return 'this_week';

    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(weekStart.getDate() - 7);
    if (reportDay >= lastWeekStart) return 'last_week';

    const twoWeeksStart = new Date(weekStart);
    twoWeeksStart.setDate(weekStart.getDate() - 14);
    if (reportDay >= twoWeeksStart) return 'two_weeks_ago';

    // Group by month
    return `month_${d.getFullYear()}_${d.getMonth()}`;
  };

  const getWeekLabel = (key) => {
    if (key === 'this_week') return 'This Week';
    if (key === 'last_week') return 'Last Week';
    if (key === 'two_weeks_ago') return '2 Weeks Ago';
    if (key.startsWith('month_')) {
      const parts = key.split('_');
      const d = new Date(parseInt(parts[1]), parseInt(parts[2]), 1);
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    return key;
  };

  return (
    <div className="office-view">
      <h2 className="office-title" style={{fontWeight: 800}}>Reports</h2>

      {/* Tab switcher */}
      <div style={{display: 'flex', gap: '0', marginBottom: '20px', border: '2px solid var(--charcoal)', borderRadius: '10px', overflow: 'hidden'}}>
        <button onClick={() => setTab('category')} style={{flex: 1, padding: '14px', border: 'none', fontSize: '16px', fontWeight: 700, cursor: 'pointer', background: tab === 'category' ? 'var(--charcoal)' : 'white', color: 'var(--primary)'}}>Category</button>
        <button onClick={() => setTab('timeline')} style={{flex: 1, padding: '14px', border: 'none', fontSize: '16px', fontWeight: 700, cursor: 'pointer', background: tab === 'timeline' ? 'var(--charcoal)' : 'white', color: 'var(--primary)', borderLeft: '2px solid var(--charcoal)'}}>Timeline</button>
      </div>

      {/* CATEGORY VIEW — bubbles navigate to full-screen */}
      {tab === 'category' && (
        <div className="people-grid">
          {/* My Reports — for non-admin, shown first in the grid */}
          {!user.is_admin && (() => {
            const myReports = allReports.filter(r => r.person_id === user.person_id);
            if (myReports.length === 0) return null;
            const thisWeek = myReports.filter(r => { const d = new Date(r.created_at); const now = new Date(); const weekAgo = new Date(now - 7*86400000); return d >= weekAgo; });
            const preview = thisWeek.slice(0, 4);
            return (
              <div className="people-category-bubble">
                <div className="people-category-header" onClick={() => setSelectedCategory('mine')} style={{cursor: 'pointer'}}>
                  <span className="people-category-label">My Reports</span>
                  <span className="people-category-count">{myReports.length}</span>
                  <span style={{fontSize: '14px', marginLeft: '4px'}}>▶</span>
                </div>
                {preview.length > 0 && (
                  <div className="people-category-body" style={{maxHeight: '200px', overflowY: 'auto'}}>
                    {preview.map(r => {
                      const sd = formatSmartDate(r.created_at);
                      return (
                        <div key={r.id} className="report-card" style={{marginBottom: '4px', cursor: 'pointer', padding: '8px 10px'}} onClick={() => onOpenReport && onOpenReport(r.id)}>
                          <div style={{fontSize: '12px', color: 'var(--gray-500)'}}>{sd.main} · {sd.sub}</div>
                          <div style={{fontSize: '13px', color: 'var(--charcoal)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{(r.transcript_raw || r.structured_report || '').substring(0, 60)}...</div>
                        </div>
                      );
                    })}
                    {thisWeek.length > 4 && <div style={{fontSize: '12px', color: 'var(--primary)', textAlign: 'center', padding: '4px'}}>+{thisWeek.length - 4} more this week</div>}
                  </div>
                )}
              </div>
            );
          })()}
          {[...roleGroups].sort((a, b) => {
            if (a.level === 1 && b.level !== 1) return -1;
            if (b.level === 1 && a.level !== 1) return 1;
            if (a.level === 0 && b.level !== 0) return -1;
            if (b.level === 0 && a.level !== 0) return 1;
            return a.level - b.level;
          }).map(group => {
            const groupPeople = people.filter(p => (parseInt(p.role_level) || 0) === group.level && p.id !== user.person_id);
            const groupReports = allReports.filter(r => groupPeople.some(p => p.id === r.person_id));
            if (groupPeople.length === 0) return null;
            const thisWeek = groupReports.filter(r => { const d = new Date(r.created_at); const now = new Date(); const weekAgo = new Date(now - 7*86400000); return d >= weekAgo; });
            const preview = thisWeek.slice(0, 4);
            return (
              <div key={group.level} className="people-category-bubble">
                <div className="people-category-header" onClick={() => setSelectedCategory(group.level)} style={{cursor: 'pointer'}}>
                  <span className="people-category-label">{group.label}</span>
                  <span className="people-category-count">{groupReports.length}</span>
                  <span style={{fontSize: '14px', marginLeft: '4px'}}>▶</span>
                </div>
                {preview.length > 0 && (
                  <div className="people-category-body" style={{maxHeight: '200px', overflowY: 'auto'}}>
                    {preview.map(r => {
                      const person = groupPeople.find(p => p.id === r.person_id);
                      const sd = formatSmartDate(r.created_at);
                      return (
                        <div key={r.id} className="report-card" style={{marginBottom: '4px', cursor: 'pointer', padding: '8px 10px'}} onClick={() => onOpenReport && onOpenReport(r.id)}>
                          <div style={{display: 'flex', justifyContent: 'space-between'}}>
                            <span style={{fontSize: '13px', fontWeight: 600, color: 'var(--charcoal)'}}>{person?.name || 'Unknown'}</span>
                            <span style={{fontSize: '11px', color: 'var(--gray-500)'}}>{sd.main}</span>
                          </div>
                          <div style={{fontSize: '12px', color: 'var(--gray-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{(r.transcript_raw || r.structured_report || '').substring(0, 50)}...</div>
                        </div>
                      );
                    })}
                    {thisWeek.length > 4 && <div style={{fontSize: '12px', color: 'var(--primary)', textAlign: 'center', padding: '4px'}}>+{thisWeek.length - 4} more this week</div>}
                  </div>
                )}
              </div>
            );
          })}
          {allReports.length === 0 && <p className="office-empty">No reports yet. Start by recording a report!</p>}
        </div>
      )}

      {/* TIMELINE VIEW */}
      {tab === 'timeline' && (
        <div>
          {(() => {
            // Group reports by week/month
            const groups = {};
            const groupOrder = [];
            allReports.forEach(r => {
              const key = getWeekKey(r.created_at);
              if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
              groups[key].push(r);
            });

            if (groupOrder.length === 0) return <p className="office-empty">No reports yet.</p>;

            return groupOrder.map(key => {
              const isThisWeek = key === 'this_week';
              const isOpen = isThisWeek || expandedFolders['tl_' + key];
              return (
                <div key={key} style={{marginBottom: '16px'}}>
                  <div
                    onClick={() => !isThisWeek && toggleFolder('tl_' + key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px',
                      background: isThisWeek ? 'transparent' : 'var(--gray-100)',
                      borderRadius: isThisWeek ? 0 : '10px',
                      cursor: isThisWeek ? 'default' : 'pointer',
                      fontWeight: 700, fontSize: '16px', color: 'var(--charcoal)',
                      borderBottom: isThisWeek ? '2px solid var(--primary)' : 'none',
                    }}
                  >
                    {!isThisWeek && <span>📁</span>}
                    <span style={{flex: 1}}>{getWeekLabel(key)}</span>
                    <span style={{fontSize: '13px', color: 'var(--primary)', fontWeight: 600}}>{groups[key].length} report{groups[key].length !== 1 ? 's' : ''}</span>
                    {!isThisWeek && <span style={{fontSize: '12px'}}>{isOpen ? '▼' : '▶'}</span>}
                  </div>
                  {isOpen && (
                    <div style={{padding: isThisWeek ? '8px 0' : '8px 16px'}}>
                      {groups[key].map(renderReportCard)}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Login View — PIN + Face ID
// ============================================================
function LoginView({ onLogin }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [faceIdAvailable, setFaceIdAvailable] = useState(false);

  useEffect(() => {
    // Check if Face ID / Touch ID is available
    checkFaceId();
  }, []);

  const checkFaceId = async () => {
    try {
      const res = await fetch('/api/webauthn/login-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.available && window.PublicKeyCredential) {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        setFaceIdAvailable(available);
      }
    } catch (e) {}
  };

  const handleFaceId = async () => {
    try {
      setLoading(true);
      setError('');
      const optRes = await fetch('/api/webauthn/login-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const options = await optRes.json();
      if (!options.available) { setError('No Face ID credentials registered yet'); setLoading(false); return; }

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: Uint8Array.from(atob(options.challenge.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)),
          rpId: options.rpId,
          allowCredentials: options.allowCredentials.map(c => ({
            id: Uint8Array.from(atob(c.id.replace(/-/g,'+').replace(/_/g,'/')), ch => ch.charCodeAt(0)),
            type: c.type,
          })),
          userVerification: options.userVerification,
          timeout: options.timeout,
        }
      });

      const credId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
      const loginRes = await fetch('/api/webauthn/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential_id: credId }),
      });
      const data = await loginRes.json();
      if (loginRes.ok) onLogin(data);
      else setError(data.error || 'Face ID login failed');
    } catch (e) {
      if (e.name !== 'NotAllowedError') setError('Face ID failed. Use PIN instead.');
    }
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!pin.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const data = await res.json();
      if (res.ok) onLogin(data);
      else { setError(data.error || 'PIN not recognized'); setPin(''); }
    } catch (e) { setError('Connection error.'); }
    setLoading(false);
  };

  return (
    <div className="login-view">
      <div className="login-card">
        <div className="login-brand">HORIZON SPARKS</div>
        <h2>Voice Report System</h2>
        <p className="login-subtitle">Enter your PIN to continue</p>

        {error && <div className="error-banner"><span>{error}</span></div>}

        {faceIdAvailable && (
          <button className="face-id-btn" onClick={handleFaceId} disabled={loading}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M9 11.75c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zm6 0c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8 0-.29.02-.58.05-.86 2.36-1.05 4.23-2.98 5.21-5.37C11.07 8.33 14.05 10 17.42 10c.78 0 1.53-.09 2.25-.26.21.71.33 1.47.33 2.26 0 4.41-3.59 8-8 8z"/></svg>
            <span>Sign in with Face ID</span>
          </button>
        )}

        {faceIdAvailable && <div className="login-divider"><span>or use PIN</span></div>}

        <div className="pin-input-row">
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="PIN"
            autoFocus={!faceIdAvailable}
            className="pin-input"
          />
        </div>

        <button className="btn btn-primary btn-lg login-btn" onClick={handleSubmit} disabled={loading || !pin.trim()}>
          {loading ? 'Checking...' : 'Enter'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Record View — Conversational Voice Flow
// ============================================================
function RecordView({ user, onSaved }) {
  const [stage, setStage] = useState('idle'); // idle, recording, processing, conversation, structuring, done
  const [elapsed, setElapsed] = useState(0);
  const [turns, setTurns] = useState([]); // [{role:'user',text:''},{role:'ai',text:''}]
  const [liveText, setLiveText] = useState('');
  const [verbatim, setVerbatim] = useState('');
  const [structured, setStructured] = useState('');
  const [audioFilenames, setAudioFilenames] = useState([]);
  const [error, setError] = useState('');
  const [reportId, setReportId] = useState('');
  const [contextPackage, setContextPackage] = useState(null);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState(-1); // which turn index is being read
  const [pendingMessages, setPendingMessages] = useState([]);
  const [totalDuration, setTotalDuration] = useState(0);

  const [reportPhotos, setReportPhotos] = useState([]); // [{file, preview}]
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);
  const timerRef = useRef(null);
  const startTime = useRef(null);
  const recognition = useRef(null);
  const fullTranscript = useRef('');
  const audioFilenamesRef = useRef([]);
  const ttsAudio = useRef(null);
  const ttsCache = useRef({}); // {text: blobUrl} cache for pre-fetched audio
  const audioUnlocked = useRef(false); // track if iOS audio context is unlocked
  const chatEndRef = useRef(null);

  // Load messages for this person on mount
  useEffect(() => {
    if (user.person_id) {
      fetch(`/api/messages/${user.person_id}`).then(r => r.json()).then(msgs => {
        const unaddressed = msgs.filter(m => !m.addressed_in_report);
        setPendingMessages(unaddressed);
      }).catch(() => {});
    }
    setReportId(new Date().toISOString().replace(/[:.]/g, '-').replace('Z', ''));
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [turns, liveText]);

  const startRecording = async () => {
    try {
      setError('');
      setLiveText('');
      fullTranscript.current = '';
      audioUnlocked.current = true;

      // Step 1: Get microphone access
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micErr) {
        if (micErr.name === 'NotAllowedError' || micErr.name === 'PermissionDeniedError') {
          setError('Microphone access denied. Please allow microphone access in your browser settings.');
        } else if (micErr.name === 'NotFoundError') {
          setError('No microphone found. Please connect a microphone.');
        } else if (micErr.name === 'NotSupportedError') {
          setError('Microphone not supported. Please use HTTPS (https://192.168.1.137:3443).');
        } else {
          setError('Microphone error: ' + micErr.message);
        }
        return;
      }

      // Step 2: Create MediaRecorder with best supported format
      let recorder;
      const mimeTypes = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
      let selectedMime = '';

      for (const mime of mimeTypes) {
        try {
          if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime)) {
            selectedMime = mime;
            break;
          }
        } catch(e) {}
      }

      try {
        recorder = selectedMime
          ? new MediaRecorder(stream, { mimeType: selectedMime })
          : new MediaRecorder(stream);
      } catch (recErr) {
        setError('Recording not supported on this browser. Try Safari or Chrome.');
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      audioChunks.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      recorder.onstop = () => stream.getTracks().forEach(t => t.stop());
      recorder.start(1000);
      mediaRecorder.current = recorder;

      // Step 3: Live speech preview (optional — not all browsers support this)
      try {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SR) {
          const recog = new SR();
          recog.continuous = true;
          recog.interimResults = true;
          recog.lang = 'en-US';
          recog.onresult = (event) => {
            let interim = '', final = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const text = event.results[i][0].transcript;
              if (event.results[i].isFinal) final += text + ' ';
              else interim = text;
            }
            if (final) { fullTranscript.current += final; }
            setLiveText(fullTranscript.current + interim);
          };
          recog.onerror = () => {};
          recog.onend = () => {
            if (mediaRecorder.current?.state === 'recording') try { recog.start(); } catch(e) {}
          };
          recog.start();
          recognition.current = recog;
        }
      } catch(e) {
        // Speech recognition not available — recording still works, just no live text
      }

      startTime.current = Date.now();
      setStage('recording');
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 500);
    } catch (err) {
      setError('Recording error: ' + (err.message || 'Unknown error. Make sure you are using HTTPS.'));
    }
  };

  const cancelRecording = () => {
    if (recognition.current) { recognition.current.onend = null; try { recognition.current.stop(); } catch(e) {} }
    if (mediaRecorder.current?.state !== 'inactive') try { mediaRecorder.current.stop(); } catch(e) {}
    clearInterval(timerRef.current);
    stopSpeaking();
    setStage('idle');
    setElapsed(0);
    setTurns([]);
    setLiveText('');
    setVerbatim('');
    setStructured('');
    setAudioFilenames([]);
    audioFilenamesRef.current = [];
    fullTranscript.current = '';
    setReportPhotos([]);
    setTotalDuration(0);
    setError('');
    setReportId(new Date().toISOString().replace(/[:.]/g, '-').replace('Z', ''));
  };

  const takeReportPhoto = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.capture = 'environment';
    inp.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setReportPhotos(prev => [...prev, { file, preview: ev.target.result, name: file.name }]);
      };
      reader.readAsDataURL(file);
    };
    inp.click();
  };

  const stopRecording = async () => {
    if (recognition.current) { recognition.current.onend = null; recognition.current.stop(); }
    if (mediaRecorder.current?.state !== 'inactive') mediaRecorder.current.stop();
    clearInterval(timerRef.current);
    setTotalDuration(d => d + elapsed);
    setStage('processing');

    setTimeout(async () => {
      try {
        const mimeType = mediaRecorder.current?.mimeType || 'audio/webm';
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(audioChunks.current, { type: mimeType });
        const formData = new FormData();
        formData.append('audio', blob, `recording.${ext}`);
        formData.append('report_id', reportId + '_turn' + turns.length);

        const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
        let transcriptText = '';

        if (res.ok) {
          const data = await res.json();
          transcriptText = data.transcript;
          audioFilenamesRef.current = [...audioFilenamesRef.current, data.audio_file];
          setAudioFilenames(audioFilenamesRef.current);
        } else {
          transcriptText = fullTranscript.current.trim();
        }

        if (!transcriptText) {
          setError('No speech detected. Try again.');
          setStage(turns.length > 0 ? 'conversation' : 'idle');
          return;
        }

        // Add user turn
        const newTurns = [...turns, { role: 'user', text: transcriptText }];
        setTurns(newTurns);
        setLiveText('');

        // Get AI follow-up
        await getAiResponse(newTurns);
      } catch (e) {
        const fallbackText = fullTranscript.current.trim();
        if (fallbackText) {
          const newTurns = [...turns, { role: 'user', text: fallbackText }];
          setTurns(newTurns);
          await getAiResponse(newTurns);
        } else {
          setError('Recording failed. Try again.');
          setStage(turns.length > 0 ? 'conversation' : 'idle');
        }
      }
    }, 500);
  };

  const getAiResponse = async (currentTurns) => {
    try {
      // Send the FULL conversation (user + AI turns) so Claude has full context
      const conversationHistory = currentTurns.map(t => ({
        role: t.role === 'user' ? 'user' : 'assistant',
        content: t.text
      }));

      const res = await fetch('/api/converse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person_id: user.person_id,
          conversation: conversationHistory,
          transcript_so_far: currentTurns.filter(t => t.role === 'user').map(t => t.text).join('\n\n'),
          messages_for_person: currentTurns.length <= 1 ? pendingMessages : [],
        }),
      });

      if (!res.ok) throw new Error('AI response failed');
      const data = await res.json();
      const aiText = data.response;

      const newTurns = [...currentTurns, { role: 'ai', text: aiText }];
      setTurns(newTurns);
      setStage('conversation');

      // Pre-fetch OpenAI TTS so Read button is instant
      prefetchTTS(aiText);
    } catch (err) {
      setTurns([...currentTurns, { role: 'ai', text: "I couldn't process that. You can try recording again or finalize your report." }]);
      setStage('conversation');
    }
  };

  // Pre-fetch TTS audio in background (called when AI responds)
  const prefetchTTS = async (text) => {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, speed: 1.15 }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        ttsCache.current[text] = url;
      }
    } catch (e) { /* silent fail — user can still tap Read and it will fetch then */ }
  };

  // Play TTS — OpenAI only. Uses cache if available, otherwise fetches.
  const speakText = async (text, index) => {
    try {
      setAiSpeaking(true);
      setSpeakingIndex(index !== undefined ? index : -1);
      if (ttsAudio.current) { ttsAudio.current.pause(); ttsAudio.current = null; }

      let audioUrl = ttsCache.current[text];

      // If not cached, fetch now
      if (!audioUrl) {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, speed: 1.15 }),
        });
        if (res.ok) {
          const blob = await res.blob();
          audioUrl = URL.createObjectURL(blob);
          ttsCache.current[text] = audioUrl;
        }
      }

      if (audioUrl) {
        const audio = new Audio(audioUrl);
        ttsAudio.current = audio;
        audio.onended = () => { setAiSpeaking(false); setSpeakingIndex(-1); ttsAudio.current = null; };
        audio.onerror = () => { setAiSpeaking(false); setSpeakingIndex(-1); ttsAudio.current = null; };
        await audio.play();
      } else {
        setAiSpeaking(false);
        setSpeakingIndex(-1);
      }
    } catch (e) {
      setAiSpeaking(false);
      setSpeakingIndex(-1);
    }
  };

  const stopSpeaking = () => {
    if (ttsAudio.current) { ttsAudio.current.pause(); ttsAudio.current = null; }
    setAiSpeaking(false);
    setSpeakingIndex(-1);
  };

  const finalizeReport = async () => {
    stopSpeaking();
    setStage('structuring');

    try {
      const allText = turns.filter(t => t.role === 'user').map(t => t.text).join('\n\n');
      const body = { transcript: allText };
      if (user.person_id) body.person_id = user.person_id;

      const res = await fetch('/api/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Structuring failed');
      const data = await res.json();
      setVerbatim(data.verbatim);
      setStructured(data.structured);
      setContextPackage(data.context_package);
      setStage('done');
    } catch (err) {
      setError('Structuring failed. Saving with transcript only.');
      setStage('done');
    }
  };

  const saveReport = async () => {
    const allText = turns.filter(t => t.role === 'user').map(t => t.text).join('\n\n');
    const report = {
      id: reportId,
      person_id: user.person_id || null,
      person_name: user.name,
      role_title: user.role_title,
      template_id: user.template_id || null,
      project_id: 'default',
      created_at: new Date().toISOString(),
      audio_file: audioFilenamesRef.current[0] || audioFilenames[0] || null,
      audio_files: audioFilenamesRef.current.length > 0 ? audioFilenamesRef.current : audioFilenames,
      duration_seconds: totalDuration,
      transcript_raw: allText,
      conversation_turns: turns,
      markdown_verbatim: verbatim || null,
      markdown_structured: structured || null,
      context_package_snapshot: contextPackage || null,
      messages_addressed: pendingMessages.map(m => m.id),
      status: verbatim && structured ? 'complete' : 'partial',
    };

    try {
      await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });

      // Mark messages as addressed
      if (pendingMessages.length > 0 && user.person_id) {
        await fetch(`/api/messages/${user.person_id}/mark-addressed`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_ids: pendingMessages.map(m => m.id), report_id: reportId }),
        });
      }

      reset();
      onSaved();
    } catch (err) { setError('Failed to save report'); }
  };

  const reset = () => {
    stopSpeaking();
    if (recognition.current) { recognition.current.onend = null; recognition.current.stop(); }
    if (mediaRecorder.current?.state !== 'inactive') try { mediaRecorder.current.stop(); } catch(e) {}
    clearInterval(timerRef.current);
    setStage('idle'); setTurns([]); setVerbatim(''); setStructured('');
    setElapsed(0); setError(''); setAudioFilenames([]); setLiveText('');
    setContextPackage(null); setTotalDuration(0); fullTranscript.current = ''; audioFilenamesRef.current = [];
    setReportId(new Date().toISOString().replace(/[:.]/g, '-').replace('Z', ''));
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const DeleteConfirmModal = () => showDeleteConfirm ? (
    <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999}}>
      <div style={{background: 'white', borderRadius: '16px', padding: '28px', maxWidth: '320px', width: '90%', textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.2)'}}>
        <p style={{fontSize: '17px', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 8px'}}>Delete this recording?</p>
        <p style={{fontSize: '14px', color: 'var(--gray-500)', margin: '0 0 24px'}}>This will discard everything and start over.</p>
        <div style={{display: 'flex', gap: '10px'}}>
          <button onClick={() => setShowDeleteConfirm(false)} style={{flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--gray-300)', background: 'white', color: 'var(--charcoal)', fontSize: '15px', fontWeight: 600, cursor: 'pointer'}}>Cancel</button>
          <button onClick={confirmDelete} style={{flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: '#ff3b30', color: 'white', fontSize: '15px', fontWeight: 700, cursor: 'pointer'}}>Delete</button>
        </div>
      </div>
    </div>
  ) : null;

  // Idle — big mic button
  if (stage === 'idle') {
    return (
      <div className="record-view">
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}>&times;</button></div>}
        {pendingMessages.length > 0 && (
          <div className="messages-banner">
            <span className="messages-icon">💬</span>
            <span>You have {pendingMessages.length} message{pendingMessages.length > 1 ? 's' : ''} from your team</span>
          </div>
        )}
        <div className="record-center">
          <button className="record-btn-main" onClick={startRecording}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </button>
          <p className="record-label">Tap to Record</p>
          <p className="record-sublabel">Start your daily voice report</p>
        </div>
      </div>
    );
  }

  // Recording (first time, no turns yet) — big mic button
  if (stage === 'recording' && turns.length === 0) {
    return (
      <div className="record-view">

        <div className="record-center">
          <button className="record-btn-main recording-main" onClick={stopRecording}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button>
          <p className="record-timer">{formatTime(elapsed)}</p>
          <p className="record-label">Recording... Tap to Stop</p>
          {liveText && <div className="live-transcript"><span className="live-final">{liveText}</span></div>}
          <button className="btn btn-delete" style={{fontSize: '14px', padding: '10px 20px', marginTop: '20px'}} onClick={cancelRecording}>✕ Cancel</button>
        </div>
      </div>
    );
  }

  // Processing (first time, no turns yet) — spinner
  if (stage === 'processing' && turns.length === 0) {
    return (
      <div className="record-view">
        <div className="record-center"><div className="spinner"></div><p className="record-label">Processing...</p></div>
      </div>
    );
  }

  // Conversation — stays on this page for recording, processing, and chatting
  if (stage === 'conversation' || stage === 'recording' || stage === 'processing') {
    return (
      <div className="conversation-view">

        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}>&times;</button></div>}

        <div className="chat-container">
          {turns.map((turn, i) => (
            <div key={i} className={`chat-bubble ${turn.role}`}>
              <div className="chat-role">{turn.role === 'user' ? user.name.split(' ')[0] : 'AI ASSISTANT'}</div>
              <div className="chat-text">{turn.text}</div>
              {turn.role === 'ai' && (
                (aiSpeaking && speakingIndex === i) ? (
                  <button className="read-btn reading-active" onClick={stopSpeaking}>
                    ⏸ Pause
                  </button>
                ) : (
                  <button className="read-btn" onClick={() => speakText(turn.text, i)} disabled={aiSpeaking && speakingIndex !== i}>
                    🔊 Read
                  </button>
                )
              )}
            </div>
          ))}
          {/* Show live transcript while recording in conversation */}
          {stage === 'recording' && liveText && (
            <div className="chat-bubble user recording-live">
              <div className="chat-role">Recording...</div>
              <div className="chat-text">{liveText}</div>
            </div>
          )}
          {stage === 'processing' && (
            <div className="chat-bubble processing-bubble">
              <div className="spinner-small"></div>
              <span>Processing...</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {reportPhotos.length > 0 && (
          <div style={{display: 'flex', gap: '6px', padding: '8px 16px', flexWrap: 'wrap', background: 'var(--gray-50)', borderTop: '1px solid var(--gray-200)'}}>
            {reportPhotos.map((p, i) => (
              <div key={i} style={{position: 'relative'}}>
                <img src={p.preview} style={{width: '44px', height: '44px', borderRadius: '6px', objectFit: 'cover', border: '2px solid var(--primary)'}} alt="" />
                <button onClick={() => setReportPhotos(prev => prev.filter((_, j) => j !== i))} style={{position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px', borderRadius: '50%', background: '#ff3b30', color: 'white', border: 'none', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="conversation-actions">
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '10px'}}>
            <button onClick={cancelRecording} style={{background: '#ff3b30', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap'}}>Delete</button>
            <button className="btn btn-primary finalize-btn" onClick={finalizeReport} disabled={stage !== 'conversation'} style={{flex: 1, padding: '14px', fontSize: '16px'}}>
              Finalize Report
            </button>
          </div>
          <div style={{display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', marginTop: '8px'}}>
            <button className="record-btn-conv" onClick={takeReportPhoto} style={{background: 'var(--gray-100)', color: 'var(--charcoal)', border: '2px solid var(--gray-300)'}} title="Take Photo">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/><path d="M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>
            </button>
            {stage === 'recording' ? (
              <button className="record-btn-conv recording-conv" onClick={stopRecording}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                <span>{formatTime(elapsed)}</span>
              </button>
            ) : stage === 'processing' ? (
              <div className="record-btn-conv processing-conv">
                <div className="spinner-small"></div>
              </div>
            ) : (
              <button className="record-btn-conv" onClick={() => { stopSpeaking(); startRecording(); }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Structuring — spinner
  if (stage === 'structuring') {
    return (
      <div className="record-view">
        <div className="record-center"><div className="spinner"></div><p className="record-label">Building your report...</p></div>
      </div>
    );
  }

  // Done — show structured report
  if (stage === 'done') {
    const now = new Date();
    return (
      <div className="result-section">
        <div className="report-header-info">
          <h3>{user.name}</h3>
          <span className="report-meta">{user.role_title || 'Administrator'}</span>
          <span className="report-meta">{now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
        </div>
        <TabView tabs={[
          { label: 'Report', content: structured },
          { label: 'Original', content: verbatim },
          { label: 'Conversation', content: turns.map(t => `**${t.role === 'user' ? user.name : 'AI'}:** ${t.text}`).join('\n\n'), isPlain: false },
        ]} />
        <div className="action-row">
          <button className="btn btn-primary btn-lg" onClick={saveReport}>Save Report</button>
          <button className="btn btn-secondary" onClick={reset}>Discard</button>
        </div>
      </div>
    );
  }

  return null;
}

// ============================================================
// List View — Reports
// ============================================================
function ListView({ user, onOpen }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = user.is_admin ? '/api/reports' : `/api/reports?person_id=${user.person_id}`;
    fetch(url).then(r => r.json()).then(data => { setReports(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading reports...</div>;

  return (
    <div className="list-view">
      <h1>{user.is_admin ? 'All Reports' : 'My Reports'}</h1>
      {reports.length === 0 ? (
        <div className="empty-state"><p>No reports yet.</p></div>
      ) : (
        <div className="report-list">
          {reports.map(r => (
            <button key={r.id} className="report-card" onClick={() => onOpen(r.id)}>
              <div className="report-card-header">
                <span className="report-date">{new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                <span className="report-duration">{r.duration_seconds ? `${Math.floor(r.duration_seconds / 60)}m ${r.duration_seconds % 60}s` : ''}</span>
              </div>
              {user.is_admin && r.person_name && <div className="report-person">{r.person_name} — {r.role_title}</div>}
              <div className="report-preview">{r.preview || 'No transcript'}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Detail View
// ============================================================
function DetailView({ id, onBack, onHome }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/reports/${id}`).then(r => r.json()).then(data => { setReport(data); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="loading">Loading report...</div>;
  if (!report) return <div className="loading">Report not found</div>;

  return (
    <div className="detail-view">
      <div style={{display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px'}}>
        <button className="back-btn" onClick={onBack} style={{margin: 0}}>← Back</button>
      </div>
      <div className="detail-top-bar">
        <span className="detail-role-top">{report.role_title}</span>
      </div>
      <div className="detail-meta">
        <h1>{report.person_name || 'Report'}</h1>
        <span className="detail-date">{new Date(report.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — {new Date(report.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      <TabView tabs={[
        { label: 'Report', content: report.markdown_structured },
        { label: 'Original', content: report.markdown_verbatim },
        { label: 'Audio', content: null, isAudio: true, audioFile: report.audio_file },
      ]} />
    </div>
  );
}

// ============================================================
// WhatsApp-style voice message player
// ============================================================
function VoiceMessagePlayer({ src, isMine }) {
  const audioRef = React.useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = (e) => {
    e.stopPropagation();
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  const onTimeUpdate = () => {
    if (audioRef.current && audioRef.current.duration) {
      setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
    }
  };

  const onLoadedMetadata = () => {
    if (audioRef.current) setDuration(Math.round(audioRef.current.duration));
  };

  const onEnded = () => { setPlaying(false); setProgress(0); };

  const seekTo = (e) => {
    e.stopPropagation();
    if (!audioRef.current || !audioRef.current.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = pct * audioRef.current.duration;
    setProgress(pct * 100);
  };

  const formatDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{display: 'flex', alignItems: 'center', gap: '10px', minWidth: '200px', padding: '4px 0'}}>
      <audio ref={audioRef} src={src} preload="metadata" onTimeUpdate={onTimeUpdate} onLoadedMetadata={onLoadedMetadata} onEnded={onEnded} />
      <button onClick={toggle} style={{
        width: '36px', height: '36px', borderRadius: '50%', border: 'none',
        background: isMine ? 'rgba(0,0,0,0.15)' : 'var(--primary)',
        color: 'white', fontSize: '14px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{playing ? '⏸' : '▶'}</button>
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: '4px'}}>
        <div onClick={seekTo} style={{height: '4px', background: 'rgba(0,0,0,0.15)', borderRadius: '2px', cursor: 'pointer', position: 'relative'}}>
          <div style={{height: '100%', width: progress + '%', background: isMine ? 'var(--charcoal)' : 'var(--primary)', borderRadius: '2px', transition: 'width 0.1s'}} />
        </div>
        <span style={{fontSize: '11px', color: isMine ? 'rgba(0,0,0,0.5)' : 'var(--gray-500)'}}>{duration > 0 ? formatDur(duration) : '0:00'}</span>
      </div>
      <svg width="18" height="18" viewBox="0 0 24 24" fill={isMine ? 'rgba(0,0,0,0.4)' : 'var(--gray-500)'} stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke={isMine ? 'rgba(0,0,0,0.4)' : 'var(--gray-500)'} strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke={isMine ? 'rgba(0,0,0,0.4)' : 'var(--gray-500)'} strokeWidth="2" strokeLinecap="round"/></svg>
    </div>
  );
}

// ============================================================
// Messages View — chain of command messaging
// ============================================================
function MessagesView({ user }) {
  const [contacts, setContacts] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeChat, setActiveChat] = useState(null); // contact_id
  const [activeChatName, setActiveChatName] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showContacts, setShowContacts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const chatEndRef = React.useRef(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceRecordingTime, setVoiceRecordingTime] = useState(0);
  const voiceRecorderRef = React.useRef(null);
  const voiceChunksRef = React.useRef([]);
  const voiceTimerRef = React.useRef(null);
  const personId = user.person_id;

  // Load contacts on mount to know who the supervisor is
  React.useEffect(() => {
    if (personId) loadContacts();
  }, [personId]);

  // Load conversations on mount
  React.useEffect(() => {
    if (!personId) return;
    loadConversations();
  }, [personId]);

  // Scroll to bottom when messages change
  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Poll for new messages every 5 seconds when in a chat
  React.useEffect(() => {
    if (!activeChat) return;
    const interval = setInterval(() => {
      loadChat(activeChat, false);
    }, 5000);
    return () => clearInterval(interval);
  }, [activeChat]);

  const loadConversations = async () => {
    try {
      const res = await fetch(`/api/v2/conversations/${personId}`);
      const data = await res.json();
      setConversations(data);
      setLoading(false);
    } catch(e) { setLoading(false); }
  };

  const loadContacts = async () => {
    try {
      const res = await fetch(`/api/v2/contacts/${personId}`);
      const data = await res.json();
      setContacts(data);
    } catch(e) {}
  };

  const loadChat = async (contactId, showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch(`/api/v2/messages/${personId}/${contactId}`);
      const data = await res.json();
      setChatMessages(data);
      if (showLoading) setLoading(false);
      // Refresh conversation list to update unread counts
      loadConversations();
    } catch(e) { if (showLoading) setLoading(false); }
  };

  const openChat = (contactId, contactName) => {
    setActiveChat(contactId);
    setActiveChatName(contactName);
    setShowContacts(false);
    loadChat(contactId);
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeChat) return;
    try {
      await fetch('/api/v2/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_id: personId,
          to_id: activeChat,
          content: newMessage.trim(),
          type: 'text',
        }),
      });
      setNewMessage('');
      loadChat(activeChat, false);
    } catch(e) { alert('Failed to send message'); }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4' });
      voiceChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) voiceChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(voiceChunksRef.current, { type: mimeType });
        if (blob.size < 1000) return; // Too short, ignore
        // Upload
        const ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'webm';
        const formData = new window.FormData();
        formData.append('audio', blob, `voice_msg.${ext}`);
        formData.append('from_id', personId);
        formData.append('to_id', activeChat);
        try {
          await fetch('/api/v2/messages/voice', { method: 'POST', body: formData });
          loadChat(activeChat, false);
        } catch(e) { alert('Failed to send voice message'); }
      };
      recorder.start(100);
      voiceRecorderRef.current = recorder;
      setIsRecordingVoice(true);
      setVoiceRecordingTime(0);
      voiceTimerRef.current = setInterval(() => setVoiceRecordingTime(t => t + 1), 1000);
    } catch(e) { alert('Microphone access denied'); }
  };

  const stopVoiceRecording = () => {
    if (voiceRecorderRef.current && voiceRecorderRef.current.state !== 'inactive') {
      voiceRecorderRef.current.stop();
    }
    clearInterval(voiceTimerRef.current);
    setIsRecordingVoice(false);
    setVoiceRecordingTime(0);
  };

  const cancelVoiceRecording = () => {
    if (voiceRecorderRef.current) {
      voiceRecorderRef.current.ondataavailable = null;
      voiceRecorderRef.current.onstop = null;
      if (voiceRecorderRef.current.state !== 'inactive') voiceRecorderRef.current.stop();
      voiceRecorderRef.current.stream?.getTracks().forEach(t => t.stop());
    }
    clearInterval(voiceTimerRef.current);
    setIsRecordingVoice(false);
    setVoiceRecordingTime(0);
    voiceChunksRef.current = [];
  };

  const formatTime = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (msgDay.getTime() === today.getTime()) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (msgDay.getTime() === yesterday.getTime()) {
      return 'Yesterday ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  // Track keyboard height for mobile
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const inputBarRef = React.useRef(null);

  React.useEffect(() => {
    if (!activeChat) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const offset = window.innerHeight - vv.height;
      setKeyboardOffset(offset);
      // Scroll to bottom when keyboard opens
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    return () => { vv.removeEventListener('resize', onResize); vv.removeEventListener('scroll', onResize); };
  }, [activeChat]);

  // Photo upload for messages
  const chatPhotoRef = React.useRef(null);
  const chatGalleryRef = React.useRef(null);
  const [showChatPhotoChoice, setShowChatPhotoChoice] = React.useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);

  const sendPhoto = async (file) => {
    if (!file || !activeChat) return;
    setSendingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      formData.append('from_id', personId);
      formData.append('to_id', activeChat);
      const res = await fetch('/api/v2/messages/photo', { method: 'POST', body: formData });
      if (res.ok) loadChat(activeChat, false);
    } catch(e) { alert('Failed to send photo'); }
    setSendingPhoto(false);
  };

  // ---- CHAT VIEW ----
  if (activeChat) {
    // Find contact info for role display
    const chatContact = contacts.find(c => c.id === activeChat) || conversations.find(c => c.contact_id === activeChat);
    const chatRole = chatContact?.role_title || '';

    return (
      <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', background: '#ECE5DD', zIndex: 100}}>
        {/* Chat header — WhatsApp style */}
        <div style={{display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--charcoal)', flexShrink: 0}}>
          <button onClick={() => { setActiveChat(null); setKeyboardOffset(0); loadConversations(); }} style={{background: 'none', border: 'none', color: 'white', fontSize: '22px', cursor: 'pointer', padding: '4px 8px'}}>←</button>
          <div style={{width: '40px', height: '40px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '16px', flexShrink: 0}}>
            {activeChatName.split(' ').map(n => n[0]).join('').substring(0,2)}
          </div>
          <div style={{flex: 1}}>
            <div style={{fontWeight: 700, fontSize: '16px', color: 'white'}}>{activeChatName}</div>
            {chatRole && <div style={{fontSize: '12px', color: 'rgba(255,255,255,0.7)'}}>{chatRole}</div>}
          </div>
        </div>

        {/* Messages area — WhatsApp wallpaper style */}
        <div style={{flex: 1, overflowY: 'auto', padding: '12px 16px', paddingBottom: '80px'}}>
          {chatMessages.length === 0 && (
            <div style={{textAlign: 'center', marginTop: '40px'}}>
              <div style={{background: 'rgba(255,255,255,0.9)', display: 'inline-block', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', color: 'var(--gray-500)'}}>No messages yet. Start the conversation!</div>
            </div>
          )}
          {chatMessages.map((m, i) => {
            const isMine = m.from_id === personId;
            // Show date separator
            const showDate = i === 0 || new Date(m.created_at).toDateString() !== new Date(chatMessages[i-1].created_at).toDateString();
            return (
              <React.Fragment key={m.id}>
                {showDate && (
                  <div style={{textAlign: 'center', margin: '12px 0'}}>
                    <span style={{background: 'rgba(255,255,255,0.9)', padding: '4px 12px', borderRadius: '6px', fontSize: '12px', color: 'var(--gray-500)', fontWeight: 600}}>
                      {(() => {
                        const d = new Date(m.created_at);
                        const now = new Date();
                        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                        const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
                        if (msgDay.getTime() === today.getTime()) return 'Today';
                        const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
                        if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
                        return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                      })()}
                    </span>
                  </div>
                )}
                <div style={{
                  display: 'flex',
                  justifyContent: isMine ? 'flex-end' : 'flex-start',
                  marginBottom: '4px',
                }}>
                  <div style={{
                    maxWidth: '80%',
                    padding: '8px 12px',
                    borderRadius: isMine ? '8px 8px 2px 8px' : '8px 8px 8px 2px',
                    background: isMine ? '#F99440' : 'white',
                    color: 'var(--charcoal)',
                    boxShadow: '0 1px 1px rgba(0,0,0,0.1)',
                    position: 'relative',
                  }}>
                    {m.type === 'safety_alert' && (
                      <div style={{fontSize: '11px', fontWeight: 700, color: '#d32f2f', marginBottom: '4px'}}>⚠ SAFETY ALERT</div>
                    )}
                    {m.metadata && m.metadata.group && (
                      <div style={{fontSize: '11px', fontWeight: 700, color: 'var(--primary)', marginBottom: '4px'}}>📢 Group</div>
                    )}
                    {m.photo && (
                      <img src={`/api/message-photos/${m.photo}`} alt="" style={{maxWidth: '100%', borderRadius: '6px', marginBottom: '4px', cursor: 'pointer'}} onClick={() => setLightboxPhoto(`/api/message-photos/${m.photo}`)} />
                    )}
                    {m.type === 'voice' && m.audio_file ? (
                      <VoiceMessagePlayer src={`/api/message-audio/${m.audio_file}`} isMine={isMine} />
                    ) : (
                      <div style={{fontSize: '15px', lineHeight: '1.4', whiteSpace: 'pre-wrap', fontWeight: 600}}>{typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}</div>
                    )}
                    <div style={{fontSize: '11px', marginTop: '2px', color: 'var(--charcoal)', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px'}}>
                      {formatTime(m.created_at)}
                      {isMine && <span style={{fontSize: '14px', color: 'var(--charcoal)'}}>✓✓</span>}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        {/* Hidden photo input */}
        <input ref={chatPhotoRef} type="file" accept="image/*" capture="environment" style={{display: 'none'}} onChange={e => { if (e.target.files[0]) sendPhoto(e.target.files[0]); e.target.value = ''; }} />
        <input ref={chatGalleryRef} type="file" accept="image/*" style={{display: 'none'}} onChange={e => { if (e.target.files[0]) sendPhoto(e.target.files[0]); e.target.value = ''; }} />

        {/* Message input — WhatsApp style */}
        <div ref={inputBarRef} style={{
          position: 'fixed', left: 0, right: 0,
          bottom: keyboardOffset + 'px',
          padding: '6px 8px', display: 'flex', gap: '6px', alignItems: 'flex-end',
          background: '#ECE5DD',
          paddingBottom: Math.max(6, keyboardOffset > 0 ? 6 : 16) + 'px',
        }}>
          {isRecordingVoice ? (
            /* Voice recording mode */
            <React.Fragment>
              <button onClick={cancelVoiceRecording} style={{
                width: '40px', height: '40px', borderRadius: '50%', border: 'none',
                background: '#d32f2f', color: 'white', fontSize: '16px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>✕</button>
              <div style={{flex: 1, display: 'flex', alignItems: 'center', gap: '8px', background: 'white', borderRadius: '24px', padding: '10px 16px'}}>
                <span style={{width: '10px', height: '10px', borderRadius: '50%', background: '#d32f2f', animation: 'pulse 1s infinite'}} />
                <span style={{fontSize: '15px', fontWeight: 600, color: 'var(--charcoal)'}}>
                  {Math.floor(voiceRecordingTime / 60)}:{String(voiceRecordingTime % 60).padStart(2, '0')}
                </span>
                <span style={{fontSize: '13px', color: 'var(--gray-500)', flex: 1}}>Recording...</span>
              </div>
              <button onClick={stopVoiceRecording} style={{
                width: '44px', height: '44px', borderRadius: '50%', border: 'none',
                background: 'var(--primary)', color: 'white', fontSize: '20px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>➤</button>
            </React.Fragment>
          ) : (
            /* Normal input mode */
            <React.Fragment>
              <div style={{position: 'relative', flexShrink: 0}}>
                <button
                  onClick={() => setShowChatPhotoChoice(!showChatPhotoChoice)}
                  disabled={sendingPhoto}
                  style={{
                    width: '40px', height: '40px', borderRadius: '50%', border: 'none',
                    background: 'var(--gray-500)', color: 'white', fontSize: '18px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
                {showChatPhotoChoice && (
                  <React.Fragment>
                    <div onClick={() => setShowChatPhotoChoice(false)} style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9}} />
                    <div style={{position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px', background: 'white', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 10, overflow: 'hidden', minWidth: '140px'}}>
                      <button onClick={() => { chatPhotoRef.current?.click(); setShowChatPhotoChoice(false); }} style={{display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #eee'}}>
                        <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Camera</span>
                      </button>
                      <button onClick={() => { chatGalleryRef.current?.click(); setShowChatPhotoChoice(false); }} style={{display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left'}}>
                        <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>Gallery</span>
                      </button>
                    </div>
                  </React.Fragment>
                )}
              </div>
              <div style={{flex: 1, display: 'flex', alignItems: 'flex-end', background: 'white', borderRadius: '24px', padding: '2px 4px'}}>
                <textarea
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  onFocus={() => setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 300)}
                  placeholder="Type a message..."
                  rows={1}
                  style={{
                    flex: 1, padding: '10px 14px', border: 'none', borderRadius: '24px',
                    fontSize: '16px', resize: 'none', fontFamily: 'inherit', outline: 'none',
                    maxHeight: '100px', background: 'transparent',
                  }}
                />
              </div>
              {newMessage.trim() ? (
                <button onClick={sendMessage} style={{
                  width: '44px', height: '44px', borderRadius: '50%', border: 'none',
                  background: 'var(--primary)', color: 'white', fontSize: '20px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>➤</button>
              ) : (
                <button onClick={startVoiceRecording} style={{
                  width: '44px', height: '44px', borderRadius: '50%', border: 'none',
                  background: 'var(--primary)', color: 'white', fontSize: '20px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}><svg width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg></button>
              )}
            </React.Fragment>
          )}
        </div>
        {lightboxPhoto && (
          <div onClick={() => setLightboxPhoto(null)} style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.9)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}>
            <button onClick={() => setLightboxPhoto(null)} style={{
              position: 'absolute', top: '16px', right: '16px',
              background: 'none', border: 'none', color: 'white', fontSize: '32px', cursor: 'pointer', zIndex: 10000,
            }}>✕</button>
            <img src={lightboxPhoto} alt="" style={{maxWidth: '95%', maxHeight: '90vh', objectFit: 'contain', borderRadius: '4px'}} onClick={e => e.stopPropagation()} />
          </div>
        )}
      </div>
    );
  }

  // ---- CONTACTS LIST (new conversation) — WhatsApp style ----
  if (showContacts) {
    // Separate supervisor from peers
    const supervisorContacts = contacts.filter(c => c.role_level > (user.role_level || 1));
    const peerContacts = contacts.filter(c => c.role_level <= (user.role_level || 1));

    return (
      <div className="list-view">
        <button className="back-btn" onClick={() => setShowContacts(false)}>← Back</button>
        <h1 className="view-title">New Message</h1>

        {contacts.length === 0 && <p style={{color: 'var(--gray-500)'}}>Loading contacts...</p>}

        {/* Supervisor section */}
        {supervisorContacts.length > 0 && (
          <div style={{marginBottom: '16px'}}>
            <div style={{fontSize: '13px', fontWeight: 700, color: 'var(--primary)', padding: '8px 0', textTransform: 'uppercase', letterSpacing: '1px'}}>Supervisor</div>
            {supervisorContacts.map(c => {
              const initials = c.name.split(' ').map(n => n[0]).join('').substring(0,2);
              return (
                <button key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
                  padding: '12px 14px', background: 'white', border: 'none',
                  borderBottom: '1px solid #f0ece8', cursor: 'pointer',
                  borderLeft: '4px solid var(--primary)',
                }}
                  onClick={() => openChat(c.id, c.name)}>
                  <div style={{width: '48px', height: '48px', borderRadius: '50%', background: 'var(--charcoal)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '16px', flexShrink: 0}}>
                    {initials}
                  </div>
                  <div>
                    <div style={{fontWeight: 700, fontSize: '16px', color: 'var(--charcoal)'}}>{c.name}</div>
                    <div style={{fontSize: '13px', color: 'var(--primary)', fontWeight: 600}}>{c.role_title}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Crew / Peers section */}
        {peerContacts.length > 0 && (
          <div>
            <div style={{fontSize: '13px', fontWeight: 700, color: 'var(--gray-500)', padding: '8px 0', textTransform: 'uppercase', letterSpacing: '1px'}}>Crew</div>
            {peerContacts.map(c => {
              const initials = c.name.split(' ').map(n => n[0]).join('').substring(0,2);
              return (
                <button key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
                  padding: '10px 14px', background: 'white', border: 'none',
                  borderBottom: '1px solid #f0ece8', cursor: 'pointer',
                }}
                  onClick={() => openChat(c.id, c.name)}>
                  <div style={{width: '40px', height: '40px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '14px', flexShrink: 0}}>
                    {initials}
                  </div>
                  <div>
                    <div style={{fontWeight: 600, fontSize: '15px', color: 'var(--charcoal)'}}>{c.name}</div>
                    <div style={{fontSize: '13px', color: 'var(--gray-500)'}}>{c.role_title}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---- CONVERSATION LIST (main view) — WhatsApp style ----
  // Ensure supervisor is always in the list even without messages
  const supervisorContact = contacts.find(c => c.role_level > (user.role_level || 1));
  const allConversations = [...conversations];
  if (supervisorContact && !allConversations.find(c => c.contact_id === supervisorContact.id)) {
    allConversations.unshift({
      contact_id: supervisorContact.id,
      contact_name: supervisorContact.name,
      role_title: supervisorContact.role_title,
      role_level: supervisorContact.role_level,
      photo: supervisorContact.photo,
      last_message_at: null,
      unread_count: 0,
      last_message_preview: 'Tap to start a conversation',
      last_message_is_mine: false,
    });
  }

  // Sort: supervisor first, lead man second, then by last message time
  const sortedConversations = allConversations.sort((a, b) => {
    const aIsSupervisor = a.role_level > (user.role_level || 1);
    const bIsSupervisor = b.role_level > (user.role_level || 1);
    if (aIsSupervisor && !bIsSupervisor) return -1;
    if (!aIsSupervisor && bIsSupervisor) return 1;
    const aIsLead = a.is_lead_man || 0;
    const bIsLead = b.is_lead_man || 0;
    if (aIsLead && !bIsLead) return -1;
    if (!aIsLead && bIsLead) return 1;
    if (!a.last_message_at) return 1;
    if (!b.last_message_at) return -1;
    return new Date(b.last_message_at) - new Date(a.last_message_at);
  });

  const toggleLeadMan = async (contactId, currentValue) => {
    await fetch(`/api/people/${contactId}/lead-man`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_lead_man: !currentValue }),
    });
    loadConversations();
    loadContacts();
  };

  return (
    <div className="list-view">
      {/* Header bar */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px'}}>
        <h1 className="view-title" style={{margin: 0}}>Messages</h1>
        <div style={{display: 'flex', gap: '8px'}}>
          {(user.role_level || 1) >= 2 && (
            <button
              className="btn btn-secondary"
              style={{padding: '10px 16px', fontSize: '13px', borderRadius: '20px', fontWeight: 800}}
              onClick={() => {
                const msg = prompt('Message to all your team:');
                if (!msg || !msg.trim()) return;
                fetch('/api/v2/messages/group', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ from_id: personId, content: msg.trim() }),
                }).then(r => r.json()).then(res => {
                  if (res.success) { alert(`Sent to ${res.sent_to} team members`); loadConversations(); }
                  else alert(res.error || 'Failed');
                }).catch(() => alert('Failed to send'));
              }}
            >📢 All</button>
          )}
          <button
            className="btn btn-primary"
            style={{padding: '10px 20px', fontSize: '14px', borderRadius: '20px'}}
            onClick={() => { loadContacts(); setShowContacts(true); }}
          >+ New</button>
        </div>
      </div>

      {loading && <p style={{color: 'var(--gray-500)'}}>Loading...</p>}

      {!loading && sortedConversations.length === 0 && (
        <div style={{textAlign: 'center', padding: '40px 0', color: 'var(--gray-500)'}}>
          <p style={{fontSize: '16px', marginBottom: '8px'}}>No conversations yet</p>
          <p style={{fontSize: '14px'}}>Tap "+ New" to start a conversation</p>
        </div>
      )}

      {sortedConversations.map(c => {
        const isSupervisor = c.role_level > (user.role_level || 1);
        const initials = c.contact_name.split(' ').map(n => n[0]).join('').substring(0,2);
        return (
          <button key={c.contact_id} style={{
            display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
            padding: '12px 14px', marginBottom: '2px', background: 'white', border: 'none',
            borderBottom: '1px solid #f0ece8', cursor: 'pointer',
            borderLeft: isSupervisor ? '4px solid var(--primary)' : '4px solid transparent',
          }}
            onClick={() => openChat(c.contact_id, c.contact_name)}>
            {/* Avatar */}
            <div style={{
              width: isSupervisor ? '52px' : '48px', height: isSupervisor ? '52px' : '48px',
              borderRadius: '50%', flexShrink: 0,
              background: isSupervisor ? 'var(--charcoal)' : 'var(--primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 700, fontSize: isSupervisor ? '18px' : '16px',
            }}>
              {initials}
            </div>
            {/* Content */}
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
                <span style={{fontWeight: c.unread_count > 0 ? 800 : 600, fontSize: isSupervisor ? '17px' : '16px', color: 'var(--charcoal)'}}>
                  {c.contact_name}{c.is_lead_man ? ' ⭐' : ''}
                </span>
                {(user.role_level || 1) >= 2 && !isSupervisor && c.role_level < (user.role_level || 1) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleLeadMan(c.contact_id, c.is_lead_man); }}
                    style={{background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '2px 6px', marginLeft: '4px', opacity: c.is_lead_man ? 1 : 0.3}}
                    title={c.is_lead_man ? 'Remove Lead Man' : 'Set as Lead Man'}
                  >{c.is_lead_man ? '⭐' : '☆'}</button>
                )}
                <span style={{fontSize: '12px', color: c.unread_count > 0 ? 'var(--primary)' : 'var(--gray-500)', flexShrink: 0, marginLeft: '8px'}}>{formatTime(c.last_message_at)}</span>
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px'}}>
                <div style={{minWidth: 0, flex: 1}}>
                  <div style={{fontSize: '13px', color: isSupervisor ? 'var(--primary)' : 'var(--gray-500)', fontWeight: isSupervisor ? 600 : 400, marginBottom: '1px'}}>{c.role_title}</div>
                  <div style={{fontSize: '14px', color: c.unread_count > 0 ? 'var(--charcoal)' : 'var(--gray-500)', fontWeight: c.unread_count > 0 ? 500 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                    {c.last_message_is_mine ? 'You: ' : ''}{c.last_message_preview || 'No messages yet'}
                  </div>
                </div>
                {c.unread_count > 0 && (
                  <span style={{
                    background: '#25D366', color: 'white', borderRadius: '50%',
                    width: '22px', height: '22px', fontSize: '12px', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: '8px',
                  }}>{c.unread_count}</span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// Admin: People View — with Photo + Messages
// ============================================================
function PeopleView({ activeTrade, onOpenReport, persistedViewingId, setPeopleViewingId, user }) {
  const [people, setPeople] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(persistedViewingId || null); // person dashboard
  const [viewingPerson, setViewingPerson] = useState(null);
  const [viewingReports, setViewingReports] = useState([]);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState([]);
  const [showMessages, setShowMessages] = useState(false);
  const [openSections, setOpenSections] = useState({});
  const toggleSection = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }));

  const isAdmin = user && user.is_admin;
  const myPersonId = user && user.person_id;

  const load = () => {
    Promise.all([
      fetch('/api/people').then(r => r.json()),
      fetch('/api/templates').then(r => r.json()),
    ]).then(([p, t]) => {
      // Non-admin supervisors only see their direct reports
      if (!isAdmin && myPersonId) {
        setPeople(p.filter(person => person.supervisor_id === myPersonId));
      } else {
        setPeople(p);
      }
      setTemplates(t);
      setLoading(false);
    });
  };
  useEffect(load, []);

  // View person dashboard
  const viewPerson = async (id) => {
    const res = await fetch(`/api/people/${id}`);
    const p = await res.json();
    setViewingPerson(p);
    setViewing(id);
    if (setPeopleViewingId) setPeopleViewingId(id);
    // Load their reports
    try {
      const reportsRes = await fetch(`/api/reports?person_id=${id}`);
      const reports = await reportsRes.json();
      setViewingReports(reports);
    } catch(e) { setViewingReports([]); }
  };

  // Auto-load person when returning from report detail view
  // If viewing is set but viewingPerson is stale or missing, re-fetch
  useEffect(() => {
    if (viewing && (!viewingPerson || viewingPerson.id !== viewing)) {
      viewPerson(viewing);
    } else if (viewing && viewingPerson) {
      // Just refresh the reports in case new ones were added from another device
      fetch(`/api/reports?person_id=${viewing}`).then(r => r.json()).then(setViewingReports).catch(() => {});
    }
  }, [viewing]);

  const deletePerson2 = async () => {
    const id = viewing;
    const name = viewingPerson?.name || 'this person';
    if (!confirm(`Are you sure you want to delete ${name}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/people/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setViewing(null);
        setViewingPerson(null);
        setLoading(true);
        load();
      } else { alert('Failed to delete person.'); }
    } catch (err) { alert('Error: ' + err.message); }
  };

  const startNew = () => {
    setForm({ name: '', pin: '', template_id: '', role_title: '', role_level: 1, personal_context: {} });
    setEditing('new');
    setShowMessages(false);
  };

  const startEdit = async (id) => {
    const res = await fetch(`/api/people/${id}`);
    const p = await res.json();
    setEditing(id);

    // Auto-fill empty fields from template
    if (p.template_id) {
      try {
        const tmplRes = await fetch(`/api/templates/${p.template_id}`);
        const tmpl = await tmplRes.json();
        const pc = p.personal_context || {};
        p.personal_context = {
          ...pc,
          role_description: pc.role_description || tmpl.role_description || '',
          report_focus: pc.report_focus || tmpl.report_focus || '',
          output_sections: (pc.output_sections && pc.output_sections.length > 0) ? pc.output_sections : (tmpl.output_sections || []),
          language_preference: pc.language_preference || tmpl.language_notes || '',
          safety_rules: (pc.safety_rules && pc.safety_rules.length > 0) ? pc.safety_rules : (tmpl.safety_rules || []),
          safety_vocabulary: (pc.safety_vocabulary && pc.safety_vocabulary.length > 0) ? pc.safety_vocabulary : (tmpl.safety_vocabulary || []),
          tools_and_equipment: (pc.tools_and_equipment && pc.tools_and_equipment.length > 0) ? pc.tools_and_equipment : (tmpl.tools_and_equipment || []),
        };
      } catch (e) {}
    }

    setForm(p);
    // Load messages for this person
    const msgRes = await fetch(`/api/messages/${id}`);
    const msgs = await msgRes.json();
    setMessages(msgs);
    setShowMessages(false);
  };

  const save = async () => {
    const tmpl = templates.find(t => t.id === form.template_id);
    if (tmpl) { form.role_title = tmpl.template_name; form.role_level = tmpl.role_level; }
    // Clean up internal fields before saving
    const saveData = { ...form };
    delete saveData._pendingPhotoPreview;
    delete saveData._pendingPhotoFile;
    delete saveData._selectedTrade;

    const method = editing === 'new' ? 'POST' : 'PUT';
    const url = editing === 'new' ? '/api/people' : `/api/people/${editing}`;
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saveData) });
    const result = await res.json();

    // Upload pending photo for new person
    if (editing === 'new' && form._pendingPhotoFile && result.id) {
      const fd = new FormData();
      fd.append('photo', form._pendingPhotoFile);
      await fetch(`/api/people/${result.id}/photo`, { method: 'POST', body: fd });
    }

    const savedId = editing === 'new' ? result.id : editing;
    setEditing(null);
    setLoading(true);
    load();
    // Go back to dashboard if we were viewing someone
    if (savedId && savedId !== 'new') {
      setTimeout(() => viewPerson(savedId), 300);
    }
  };

  const deletePerson = async () => {
    if (!confirm(`Are you sure you want to delete ${form.name || 'this person'}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/people/${editing}`, { method: 'DELETE' });
      if (res.ok) {
        setEditing(null);
        setViewing(null);
        setViewingPerson(null);
        setLoading(true);
        load();
      } else {
        alert('Failed to delete person.');
      }
    } catch (err) { alert('Error deleting person: ' + err.message); }
  };

  const uploadPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file || editing === 'new') return;
    const fd = new FormData();
    fd.append('photo', file);
    const res = await fetch(`/api/people/${editing}/photo`, { method: 'POST', body: fd });
    if (res.ok) {
      const data = await res.json();
      setForm(f => ({ ...f, photo: data.photo }));
    }
  };

  const sendMessage = async () => {
    if (!messageText.trim() || editing === 'new') return;
    const res = await fetch(`/api/messages/${editing}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: messageText, from: 'Admin', from_role: 'Administrator' }),
    });
    if (res.ok) {
      const data = await res.json();
      setMessages(prev => [...prev, data.message]);
      setMessageText('');
    }
  };

  const registerFaceId = async () => {
    if (editing === 'new' || !window.PublicKeyCredential) return;
    try {
      const optRes = await fetch('/api/webauthn/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: editing }),
      });
      const options = await optRes.json();

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: Uint8Array.from(atob(options.challenge.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)),
          rp: options.rp,
          user: {
            id: Uint8Array.from(atob(options.user.id.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)),
            name: options.user.name,
            displayName: options.user.displayName,
          },
          pubKeyCredParams: options.pubKeyCredParams,
          authenticatorSelection: options.authenticatorSelection,
          timeout: options.timeout,
        }
      });

      const credId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
      await fetch('/api/webauthn/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: editing, credential: { id: credId, rawId: credId } }),
      });
      setForm(f => ({ ...f, webauthn_credential_id: credId }));
      alert('Face ID registered successfully!');
    } catch (e) {
      if (e.name !== 'NotAllowedError') alert('Face ID registration failed: ' + e.message);
    }
  };

  const generatePin = () => {
    const usedPins = people.map(p => p.pin);
    let pin;
    let attempts = 0;
    do {
      pin = String(Math.floor(1000 + Math.random() * 9000)); // 4 digits, 1000-9999
      attempts++;
    } while (usedPins.includes(pin) && attempts < 100);
    setForm(f => ({ ...f, pin }));
  };

  const updateCtx = (key, val) => setForm(f => ({ ...f, personal_context: { ...f.personal_context, [key]: val } }));

  const uploadCert = async (file) => {
    if (editing === 'new') { alert('Save the person first, then upload certifications.'); return; }
    const fd = new FormData();
    fd.append('cert', file);
    try {
      const res = await fetch(`/api/people/${editing}/certs`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) {
        setForm(f => ({ ...f, certifications_files: [...(f.certifications_files || []), data.file] }));
      }
    } catch (err) { console.error('Cert upload failed:', err); }
  };

  const removeCert = async (filename) => {
    if (!confirm('Remove this certification file?')) return;
    try {
      await fetch(`/api/people/${editing}/certs/${filename}`, { method: 'DELETE' });
      setForm(f => ({ ...f, certifications_files: (f.certifications_files || []).filter(c => c.filename !== filename) }));
    } catch (err) { console.error('Cert delete failed:', err); }
  };

  if (loading) return <div className="loading">Loading...</div>;

  if (editing !== null) {
    const pc = form.personal_context || {};
    return (
      <div className="admin-form">
        <button className="back-btn" onClick={() => { setEditing(null); if (viewing) { viewPerson(viewing); } }}>&larr; Back</button>
        <h1>{editing === 'new' ? 'Add Person' : 'Edit Person'}</h1>

        {/* Photo */}
        <div className="photo-section">
          <div className="photo-circle" style={{cursor:'pointer', position:'relative'}} onClick={() => { if (editing === 'new') return; document.getElementById('photo-input')?.click(); }}>
            {form.photo ? (
              <img src={`/api/photos/${form.photo}`} alt={form.name} />
            ) : form._pendingPhotoPreview ? (
              <img src={form._pendingPhotoPreview} alt="Preview" />
            ) : (
              <>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="#ccc"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
              </>
            )}
          </div>
          <label className="btn btn-sm photo-upload-btn">
            {form.photo || form._pendingPhotoPreview ? 'Change Photo' : 'Upload Photo'}
            <input id="photo-input" type="file" accept="image/*" onChange={(e) => {
              const file = e.target.files[0];
              if (!file) return;
              if (editing !== 'new') {
                uploadPhoto(e);
              } else {
                // For new person, store file for later upload and show preview
                const reader = new FileReader();
                reader.onload = (ev) => setForm(f => ({ ...f, _pendingPhotoPreview: ev.target.result, _pendingPhotoFile: file }));
                reader.readAsDataURL(file);
              }
            }} hidden />
          </label>
        </div>

        <label className="admin-label">Name<input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></label>
        <div className="form-row-2col">
          <label className="admin-label" style={{flex:1}}>PIN (4 digits)
            <div style={{position:'relative'}}>
              <input type="text" inputMode="numeric" maxLength={4} value={form.pin || ''} onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))} style={{paddingRight:'60px'}} />
              <button type="button" onClick={generatePin} style={{position:'absolute', right:'4px', top:'50%', transform:'translateY(-50%)', background:'var(--primary)', color:'white', border:'none', borderRadius:'6px', padding:'4px 12px', fontSize:'12px', fontWeight:700, cursor:'pointer'}}>Auto</button>
            </div>
          </label>
          <label className="admin-label" style={{flex:1}}>Status
            <select value={form.status || 'active'} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
        <div className="form-row-2col">
          <label className="admin-label" style={{flex:1}}>Trade
            <select value={form._selectedTrade || (form.template_id ? (templates.find(t => t.id === form.template_id)?.trade || '') : '')} onChange={e => {
              const trade = e.target.value;
              setForm(f => ({ ...f, _selectedTrade: trade, template_id: '' }));
            }}>
              <option value="" disabled>— Select a trade —</option>
              {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="admin-label" style={{flex:1}}>Role
            <select value={form.template_id || ''} disabled={!form._selectedTrade && !form.template_id} onChange={e => {
              const tmplId = e.target.value;
              setForm(f => ({ ...f, template_id: tmplId }));
              fetch(`/api/templates/${tmplId}`).then(r => r.json()).then(fullTmpl => {
                setForm(f => ({
                  ...f,
                  template_id: tmplId,
                  role_title: fullTmpl.template_name,
                  role_level: fullTmpl.role_level,
                  personal_context: {
                    ...f.personal_context,
                    role_description: fullTmpl.role_description || '',
                    report_focus: fullTmpl.report_focus || '',
                    output_sections: fullTmpl.output_sections || [],
                    language_preference: fullTmpl.language_notes || '',
                    safety_rules: fullTmpl.safety_rules || [],
                    safety_vocabulary: fullTmpl.safety_vocabulary || [],
                    tools_and_equipment: fullTmpl.tools_and_equipment || [],
                  }
                }));
              });
            }}>
              <option value="" disabled>— Select a role —</option>
              {templates
                .filter(t => t.trade === (form._selectedTrade || (form.template_id ? (templates.find(tt => tt.id === form.template_id)?.trade) : '')))
                .map(t => <option key={t.id} value={t.id}>{t.template_name}</option>)}
            </select>
          </label>
        </div>
        <label className="admin-label">Reports To (optional)
          <select value={form.supervisor_id || ''} onChange={e => setForm(f => ({ ...f, supervisor_id: e.target.value || null }))}>
            <option value="">— None (top of chain) —</option>
            {people.filter(p => p.id !== editing && (parseInt(p.role_level) || 1) > (parseInt(form.role_level) || 1)).sort((a,b) => (b.role_level || 1) - (a.role_level || 1)).map(p => (
              <option key={p.id} value={p.id}>{p.name} — {p.role_title}</option>
            ))}
          </select>
        </label>

        {/* Face ID */}
        {editing !== 'new' && (
          <div className="face-id-section">
            <button className="btn btn-secondary" onClick={registerFaceId} style={{width:'100%'}}>
              {form.webauthn_credential_id ? '✓ Face ID Registered — Re-register' : 'Enable Face ID / Touch ID'}
            </button>
          </div>
        )}

        <div className="section-dropdown">
        <button className="section-dropdown-header" onClick={() => toggleSection('resume')}>
          <span>Resume / Background</span>
          <span className="section-arrow">{openSections.resume ? '▼' : '▶'}</span>
        </button>
        {openSections.resume && <div className="section-dropdown-body">
        <div style={{display:'flex', gap:'8px', marginBottom:'16px', alignItems:'center', justifyContent:'space-between'}}>
          {pc.resume_file ? (
            <span style={{fontSize:'13px', color:'var(--green)', fontWeight:600}}>✓ {pc.resume_file}</span>
          ) : (
            <span style={{fontSize:'13px', color:'var(--gray-500)'}}>No resume uploaded</span>
          )}
          <label style={{fontSize:'12px', padding:'4px 10px', background:'var(--gray-100)', color:'var(--gray-700)', border:'1px solid var(--gray-300)', borderRadius:'6px', cursor:'pointer', whiteSpace:'nowrap'}}>
            Upload
            <input type="file" accept=".pdf,.doc,.docx,.txt" onChange={async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              updateCtx('resume_file', file.name);

              // Try to read text content
              let text = '';
              if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
                text = await file.text();
              }

              if (text) {
                updateCtx('resume_text', text);
                // Auto-fill personal context from resume using Claude
                try {
                  const res = await fetch('/api/structure', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      transcript: `Parse this resume and extract the following as JSON: {"experience":"years and background summary","specialties":"key skills and focus areas","certifications":"licenses and certifications","language_preference":"languages spoken"}. Resume:\n\n${text}`,
                    }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    try {
                      const parsed = JSON.parse(data.structured || '{}');
                      if (parsed.experience) updateCtx('experience', parsed.experience);
                      if (parsed.specialties) updateCtx('specialties', parsed.specialties);
                      if (parsed.certifications) updateCtx('certifications', parsed.certifications);
                      if (parsed.language_preference) updateCtx('language_preference', parsed.language_preference);
                    } catch(pe) {}
                  }
                } catch(ae) {}
              }
            }} hidden />
          </label>
        </div>

        </div>}
        </div>

        <div className="section-dropdown">
        <button className="section-dropdown-header" onClick={() => toggleSection('role')}>
          <span>Role Configuration</span>
          <span className="section-arrow">{openSections.role ? '▼' : '▶'}</span>
        </button>
        {openSections.role && <div className="section-dropdown-body">
        <p style={{fontSize:'13px', color:'var(--gray-500)', marginBottom:'12px'}}>Pre-filled from template. Customize for this person if needed.</p>
        <label className="admin-label">Role Description<textarea rows={3} value={pc.role_description || ''} onChange={e => updateCtx('role_description', e.target.value)} placeholder="What this person does on the job..." /></label>
        <label className="admin-label">Report Focus (what AI looks for)<textarea rows={3} value={pc.report_focus || ''} onChange={e => updateCtx('report_focus', e.target.value)} placeholder="Work completed, equipment issues, safety observations..." /></label>
        <label className="admin-label">Output Sections (one per line)
          <textarea rows={5} value={Array.isArray(pc.output_sections) ? pc.output_sections.join('\n') : (pc.output_sections || '')} onChange={e => updateCtx('output_sections', e.target.value.split('\n').filter(s => s.trim()))} placeholder="Work Completed&#10;Equipment Issues&#10;Safety Observations&#10;Plan for Tomorrow" />
        </label>
        <label className="admin-label">Language Notes<textarea rows={2} value={pc.language_preference || ''} onChange={e => updateCtx('language_preference', e.target.value)} placeholder="English, Spanish, bilingual, etc." /></label>

        </div>}
        </div>

        <div className="section-dropdown">
        <button className="section-dropdown-header" onClick={() => toggleSection('personal')}>
          <span>Personal Context</span>
          <span className="section-arrow">{openSections.personal ? '▼' : '▶'}</span>
        </button>
        {openSections.personal && <div className="section-dropdown-body">
        <label className="admin-label">Experience<textarea rows={3} value={pc.experience || ''} onChange={e => updateCtx('experience', e.target.value)} placeholder="Years of experience, past projects, background..." /></label>
        <label className="admin-label">Specialties<textarea rows={2} value={pc.specialties || ''} onChange={e => updateCtx('specialties', e.target.value)} placeholder="What they're especially good at or focused on..." /></label>
        <label className="admin-label">Notes for AI<textarea rows={3} value={pc.notes || ''} onChange={e => updateCtx('notes', e.target.value)} placeholder="Anything that helps the AI understand this person's reports better..." /></label>
        <label className="admin-label">Certifications</label>
        <div className="cert-box">
          <textarea rows={4} value={pc.certifications || ''} onChange={e => updateCtx('certifications', e.target.value)} placeholder="Licenses, OSHA, NFPA 70E, TWIC, etc." className="cert-textarea" />
          <div className="cert-upload-row">
            <button className="btn btn-charcoal cert-upload-btn" onClick={() => {
              const inp = document.createElement('input');
              inp.type = 'file';
              inp.accept = 'image/*,.pdf';
              inp.capture = 'environment';
              inp.onchange = e => { if (e.target.files[0]) uploadCert(e.target.files[0]); };
              inp.click();
            }}>📷 Camera</button>
            <button className="btn btn-orange cert-upload-btn" onClick={() => {
              const inp = document.createElement('input');
              inp.type = 'file';
              inp.accept = 'image/*,.pdf';
              inp.onchange = e => { if (e.target.files[0]) uploadCert(e.target.files[0]); };
              inp.click();
            }}>📁 Upload File</button>
          </div>
          {(form.certifications_files || []).length > 0 && (
            <div className="cert-file-list">
              {(form.certifications_files || []).map(cf => (
                <div key={cf.filename} className="cert-file-item">
                  {cf.type && cf.type.startsWith('image/') ? (
                    <img src={`/api/certs/${cf.filename}`} className="cert-thumb" onClick={() => window.open(`/api/certs/${cf.filename}`, '_blank')} alt={cf.original_name} />
                  ) : (
                    <div className="cert-file-icon" onClick={() => window.open(`/api/certs/${cf.filename}`, '_blank')}>PDF</div>
                  )}
                  <span className="cert-file-name" onClick={() => window.open(`/api/certs/${cf.filename}`, '_blank')}>{cf.original_name}</span>
                  <button className="cert-remove-btn" onClick={() => removeCert(cf.filename)}>&times;</button>
                </div>
              ))}
            </div>
          )}
          {editing === 'new' && <p className="cert-hint">Save person first to upload certification files.</p>}
        </div>

        </div>}
        </div>

        <div className="section-dropdown">
        <button className="section-dropdown-header" onClick={() => toggleSection('safety')}>
          <span>Safety Knowledge</span>
          <span className="section-arrow">{openSections.safety ? '▼' : '▶'}</span>
        </button>
        {openSections.safety && <div className="section-dropdown-body">
        <p style={{fontSize:'13px', color:'var(--gray-500)', marginBottom:'12px'}}>Pre-filled from template. Add personal safety focus if needed.</p>
        <label className="admin-label">Safety Rules (one per line)
          <textarea rows={5} value={Array.isArray(pc.safety_rules) ? pc.safety_rules.join('\n') : (pc.safety_rules || '')} onChange={e => updateCtx('safety_rules', e.target.value.split('\n').filter(s => s.trim()))} placeholder="PPE required at all times&#10;LOTO before electrical work..." />
        </label>
        <label className="admin-label">Safety Vocabulary (comma-separated)
          <textarea rows={2} value={Array.isArray(pc.safety_vocabulary) ? pc.safety_vocabulary.join(', ') : (pc.safety_vocabulary || '')} onChange={e => updateCtx('safety_vocabulary', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="PPE, LOTO, JSA, confined space..." />
        </label>
        <label className="admin-label">Tools & Equipment Safety (one per line)
          <textarea rows={3} value={Array.isArray(pc.tools_and_equipment) ? pc.tools_and_equipment.join('\n') : (pc.tools_and_equipment || '')} onChange={e => updateCtx('tools_and_equipment', e.target.value.split('\n').filter(s => s.trim()))} placeholder="Inspect tools before use&#10;Ground portable equipment..." />
        </label>
        <label className="admin-label">Personal Safety Notes<textarea rows={2} value={pc.safety_notes || ''} onChange={e => updateCtx('safety_notes', e.target.value)} placeholder="Past incidents, specific hazard focus areas..." /></label>

        </div>}
        </div>

        {/* Team Assignment — only show for supervisors (level 2+) */}
        {editing !== 'new' && parseInt(form.role_level || 1) >= 2 && (
          <TeamAssignment person={form} allPeople={people} onUpdate={() => {
            fetch('/api/people').then(r => r.json()).then(setPeople);
          }} />
        )}

        {/* Messages */}
        {editing !== 'new' && (
          <>
            <h2 className="admin-section-title" onClick={() => setShowMessages(!showMessages)} style={{cursor:'pointer'}}>
              Messages ({messages.filter(m => !m.addressed_in_report).length} pending) {showMessages ? '▼' : '▶'}
            </h2>
            {showMessages && (
              <div className="messages-section">
                <div className="message-compose">
                  <textarea
                    rows={2}
                    value={messageText}
                    onChange={e => setMessageText(e.target.value)}
                    placeholder={`Leave a message for ${form.name}... (AI will deliver it during their next report)`}
                  />
                  <button className="btn btn-primary btn-sm" onClick={sendMessage} disabled={!messageText.trim()}>Send</button>
                </div>
                {messages.length > 0 && (
                  <div className="messages-list">
                    {messages.slice().reverse().map(m => (
                      <div key={m.id} className={`message-item ${m.addressed_in_report ? 'addressed' : 'pending'}`}>
                        <div className="message-meta">
                          <span className="message-from">{m.from} ({m.from_role})</span>
                          <span className="message-date">{new Date(m.created_at).toLocaleString()}</span>
                        </div>
                        <div className="message-text">{m.text}</div>
                        {m.addressed_in_report && <div className="message-status">✓ Addressed in report</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="action-row"><button className="btn btn-primary btn-lg" onClick={save}>Save Person</button></div>
      </div>
    );
  }

  // Smart date formatting
  const formatSmartDate = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const reportDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.floor((today - reportDay) / 86400000);
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    if (diffDays === 0) return { main: 'Today', sub: time };
    if (diffDays === 1) return { main: 'Yesterday', sub: time };
    if (diffDays < 7) {
      const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
      return { main: dayName, sub: time };
    }
    return {
      main: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      sub: d.toLocaleDateString('en-US', { weekday: 'long' }) + ' · ' + time
    };
  };

  // ============================================================
  // Person Dashboard View
  // ============================================================
  if (viewing && viewingPerson && !editing) {
    const teamMembers = people.filter(p => p.supervisor_id === viewing);
    const supervisor = viewingPerson.supervisor_id ? people.find(p => p.id === viewingPerson.supervisor_id) : null;
    const roleLevel = parseInt(viewingPerson.role_level || 1);

    // Timeline grouping helper
    const getWeekKey = (dateStr) => {
      const d = new Date(dateStr);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dayOfWeek = today.getDay();
      const weekStart = new Date(today); weekStart.setDate(today.getDate() - dayOfWeek);
      const reportDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (reportDay >= weekStart) return 'this_week';
      const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(weekStart.getDate() - 7);
      if (reportDay >= lastWeekStart) return 'last_week';
      const twoWeeksStart = new Date(weekStart); twoWeeksStart.setDate(weekStart.getDate() - 14);
      if (reportDay >= twoWeeksStart) return 'two_weeks_ago';
      return `month_${d.getFullYear()}_${d.getMonth()}`;
    };
    const getWeekLabel = (key) => {
      if (key === 'this_week') return 'This Week';
      if (key === 'last_week') return 'Last Week';
      if (key === 'two_weeks_ago') return '2 Weeks Ago';
      if (key.startsWith('month_')) {
        const parts = key.split('_');
        const d = new Date(parseInt(parts[1]), parseInt(parts[2]), 1);
        return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      }
      return key;
    };

    // Get all subordinate reports (team members' reports)
    const getAllSubordinateIds = (personId) => {
      const directReports = people.filter(p => p.supervisor_id === personId);
      let allIds = directReports.map(p => p.id);
      directReports.forEach(dr => {
        allIds = allIds.concat(getAllSubordinateIds(dr.id));
      });
      return allIds;
    };

    return (
      <div className="list-view">
        <button className="back-btn" onClick={() => { setViewing(null); setViewingPerson(null); if (setPeopleViewingId) setPeopleViewingId(null); }}>← Back</button>

        {/* Person header */}
        <div style={{textAlign: 'center', marginBottom: '20px'}}>
          {viewingPerson.photo && (
            <img src={`/api/photos/${viewingPerson.photo}`} style={{width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--primary)', marginBottom: '8px'}} alt="" />
          )}
          <h1 style={{margin: '4px 0', fontSize: '24px'}}>{viewingPerson.name}</h1>
          <p style={{color: 'var(--primary)', fontWeight: 600, fontSize: '18px', margin: '4px 0'}}>{viewingPerson.role_title}</p>
          {supervisor && <p style={{color: 'var(--gray-500)', fontSize: '14px', margin: '4px 0'}}>Reports to: {supervisor.name}</p>}
          <p style={{color: 'var(--gray-500)', fontSize: '13px'}}>PIN: {viewingPerson.pin}</p>
        </div>

        {/* Quick stats */}
        <div style={{display: 'flex', gap: '10px', marginBottom: '20px', justifyContent: 'center'}}>
          <div style={{background: 'white', border: '2px solid var(--primary)', borderRadius: '12px', padding: '10px 24px', textAlign: 'center', cursor: viewingReports.length > 0 ? 'pointer' : 'default', minWidth: '100px'}} onClick={() => { if (viewingReports.length > 0) { document.getElementById('recent-reports')?.scrollIntoView({behavior: 'smooth'}); } }}>
            <div style={{fontSize: '22px', fontWeight: 700, color: 'var(--charcoal)'}}>{viewingReports.length}</div>
            <div style={{fontSize: '12px', color: 'var(--gray-500)', fontWeight: 600}}>Reports</div>
          </div>
          {roleLevel >= 2 && (
            <div style={{background: 'white', border: '2px solid var(--primary)', borderRadius: '12px', padding: '10px 24px', textAlign: 'center', minWidth: '100px'}}>
              <div style={{fontSize: '22px', fontWeight: 700, color: 'var(--charcoal)'}}>{teamMembers.length}</div>
              <div style={{fontSize: '12px', color: 'var(--gray-500)', fontWeight: 600}}>Team</div>
            </div>
          )}
        </div>

        {/* Team section — only for supervisors */}
        {roleLevel >= 2 && (
          <div style={{marginBottom: '20px'}}>
            <h2 style={{fontSize: '22px', marginBottom: '12px', color: 'var(--charcoal)', fontWeight: 700}}>Team</h2>
            {teamMembers.length === 0 ? (
              <p style={{color: 'var(--gray-500)', fontSize: '14px'}}>No team members assigned yet.</p>
            ) : (
              <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px'}}>
                {teamMembers.map(tm => (
                  <button key={tm.id} onClick={() => viewPerson(tm.id)} style={{
                    background: 'white', border: '2px solid var(--gray-200)', borderRadius: '10px',
                    padding: '10px 16px', cursor: 'pointer', textAlign: 'left',
                    minWidth: '140px', flex: '1 1 calc(33.33% - 8px)', maxWidth: 'calc(50% - 4px)',
                    transition: 'border-color 0.15s',
                  }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--gray-200)'}>
                    <div style={{fontWeight: 700, fontSize: '14px', color: 'var(--charcoal)'}}>{tm.name}</div>
                    <div style={{fontSize: '12px', color: 'var(--gray-500)'}}>{tm.role_title}</div>
                  </button>
                ))}
              </div>
            )}
            <button
              className="btn btn-secondary"
              style={{marginTop: '8px', fontSize: '13px', padding: '8px 16px'}}
              onClick={() => startEdit(viewing)}
            >+ Assign Team Member</button>
          </div>
        )}

        {/* Reports — timeline folders */}
        <div id="recent-reports" style={{marginBottom: '20px'}}>
          <h2 style={{fontSize: '22px', marginBottom: '12px', color: 'var(--charcoal)', fontWeight: 700}}>Reports <span style={{color: 'var(--primary)', fontSize: '16px'}}>({viewingReports.length})</span></h2>
          {viewingReports.length === 0 ? (
            <p style={{color: 'var(--gray-500)', fontSize: '14px'}}>No reports yet.</p>
          ) : (() => {
            const sorted = [...viewingReports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            const groups = {}; const groupOrder = [];
            sorted.forEach(r => {
              const key = getWeekKey(r.created_at);
              if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
              groups[key].push(r);
            });
            return groupOrder.map(key => {
              const isThisWeek = key === 'this_week';
              const folderKey = 'pr_' + viewing + '_' + key;
              const isOpen = isThisWeek || openSections[folderKey];
              return (
                <div key={key} style={{marginBottom: '12px'}}>
                  <div
                    onClick={() => !isThisWeek && toggleSection(folderKey)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px',
                      background: isThisWeek ? 'transparent' : 'var(--gray-100)',
                      borderRadius: isThisWeek ? 0 : '10px',
                      cursor: isThisWeek ? 'default' : 'pointer',
                      fontWeight: 700, fontSize: '15px', color: 'var(--charcoal)',
                      borderBottom: isThisWeek ? '2px solid var(--primary)' : 'none',
                    }}
                  >
                    {!isThisWeek && <span>📁</span>}
                    <span style={{flex: 1}}>{getWeekLabel(key)}</span>
                    <span style={{fontSize: '12px', color: 'var(--primary)', fontWeight: 600}}>{groups[key].length}</span>
                    {!isThisWeek && <span style={{fontSize: '11px'}}>{isOpen ? '▼' : '▶'}</span>}
                  </div>
                  {isOpen && (
                    <div style={{padding: isThisWeek ? '6px 0' : '6px 12px'}}>
                      {groups[key].map(r => {
                        const sd = formatSmartDate(r.created_at);
                        return (
                          <button key={r.id} className="report-card" style={{marginBottom: '6px', cursor: 'pointer', width: '100%', textAlign: 'left'}} onClick={() => onOpenReport && onOpenReport(r.id)}>
                            <div className="report-card-header">
                              <span className="report-date">{sd.main}</span>
                              <span style={{fontSize: '12px', color: 'var(--gray-500)'}}>{sd.sub}</span>
                            </div>
                            <div className="report-preview">{(r.preview || r.transcript_raw || '').substring(0, 80)}...</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>

        {/* Edit / Delete buttons — same size, right-aligned */}
        <div style={{display: 'flex', gap: '10px', justifyContent: 'flex-end'}}>
          <button
            className="btn btn-primary"
            style={{padding: '10px 24px', fontSize: '14px'}}
            onClick={() => startEdit(viewing)}
          >Edit</button>
          <button
            className="btn btn-delete"
            style={{padding: '10px 24px', fontSize: '14px'}}
            onClick={deletePerson2}
          >Delete</button>
        </div>
      </div>
    );
  }

  // Filter by active trade if set
  const filteredPeople = activeTrade
    ? people.filter(p => {
        const tmpl = templates.find(t => t.id === p.template_id);
        return tmpl && tmpl.trade === activeTrade;
      })
    : people;

  // Group people by role level — lowest rank first (Helpers on top, PM at bottom)
  const roleGroupsByTrade = {
    Electrical: [
      { level: 0, label: 'Helpers', icon: '🔧' },
      { level: 1, label: 'Journeymen', icon: '⚡' },
      { level: 2, label: 'Foremen', icon: '🔶' },
      { level: 3, label: 'General Foremen', icon: '👷' },
      { level: 4, label: 'Superintendents', icon: '🏗️' },
      { level: 5, label: 'Project Management', icon: '📋' },
      { level: -1, label: 'Other', icon: '📁' },
    ],
    Instrumentation: [
      { level: 0, label: 'Junior Techs', icon: '🔧' },
      { level: 1, label: 'Instrument Techs', icon: '🔧' },
      { level: 2, label: 'Senior Techs', icon: '🔶' },
      { level: 3, label: 'Instrument Leads', icon: '👷' },
      { level: 4, label: 'Instrument Supervisors', icon: '🏗️' },
      { level: 5, label: 'Project Management', icon: '📋' },
      { level: -1, label: 'Other', icon: '📁' },
    ],
    Safety: [
      { level: 0, label: 'Safety Assistants', icon: '🔧' },
      { level: 1, label: 'Safety Officers', icon: '⛑️' },
      { level: 2, label: 'Safety Supervisors', icon: '🔶' },
      { level: 3, label: 'Safety Managers', icon: '👷' },
      { level: 4, label: 'Safety Directors', icon: '🏗️' },
      { level: 5, label: 'Project Management', icon: '📋' },
      { level: -1, label: 'Other', icon: '📁' },
    ],
  };
  const roleGroups = roleGroupsByTrade[activeTrade] || roleGroupsByTrade.Electrical;

  // Sort within each group by name
  const sortedPeople = [...filteredPeople].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Map "Other" template people to level -1
  const getLevelForPerson = (p) => {
    const tmpl = templates.find(t => t.id === p.template_id);
    if (tmpl && tmpl.id && tmpl.id.includes('other')) return -1;
    return parseInt(p.role_level) || 0;
  };

  const renderPersonCard = (p) => {
    const tmpl = templates.find(t => t.id === p.template_id);
    const trade = tmpl ? tmpl.trade : '';
    const tradeIcon = trade === 'Safety' ? '⛑️' : trade === 'Electrical' ? '⚡' : trade === 'Instrumentation' ? '🔧' : trade === 'Pipe Fitting' ? '🔩' : trade === 'Industrial Erection' ? '🏗️' : '';
    return (
      <button key={p.id} className="report-card" onClick={() => viewPerson(p.id)} style={{marginBottom: '6px'}}>
        <div className="report-card-header">
          <span className="report-date" style={{ fontWeight: 700 }}>{tradeIcon} {p.name}</span>
          <span className={`status-pill ${p.status}`}>{p.status}</span>
        </div>
        <div className="report-preview">
          {p.role_title} — PIN: {p.pin}
          {p.supervisor_id && (() => {
            const sup = people.find(s => s.id === p.supervisor_id);
            return sup ? <span style={{color: 'var(--gray-500)', marginLeft: '8px'}}>→ {sup.name}</span> : null;
          })()}
          {!p.supervisor_id && parseInt(p.role_level || 0) <= 1 && <span style={{color: 'var(--primary)', marginLeft: '8px', fontSize: '12px'}}>⚠ Unassigned</span>}
        </div>
      </button>
    );
  };

  // Expanded category full-screen view — grouped by supervisor
  if (expandedCategory !== null) {
    const group = roleGroups.find(g => g.level === expandedCategory);
    const groupPeople = sortedPeople.filter(p => getLevelForPerson(p) === expandedCategory);

    // Group by supervisor
    const bySupervisor = {};
    const supervisorOrder = [];
    groupPeople.forEach(p => {
      const supId = p.supervisor_id || '_unassigned';
      if (!bySupervisor[supId]) { bySupervisor[supId] = []; supervisorOrder.push(supId); }
      bySupervisor[supId].push(p);
    });

    return (
      <div className="list-view">
        <button className="back-btn" onClick={() => setExpandedCategory(null)}>← Back to People</button>
        <div className="admin-header-row">
          <h1>{group?.icon} {group?.label} <span style={{color: 'var(--primary)', fontSize: '24px'}}>({groupPeople.length})</span></h1>
          <button className="btn btn-primary" style={{fontSize: '14px', padding: '10px 20px'}} onClick={startNew}>+ Add Person</button>
        </div>
        {groupPeople.length === 0 ? (
          <p style={{color: 'var(--gray-500)', fontSize: '14px', padding: '20px 0'}}>No {group?.label?.toLowerCase()} yet.</p>
        ) : supervisorOrder.map(supId => {
          const sup = people.find(s => s.id === supId);
          const supName = sup ? sup.name : 'Unassigned';
          const supRole = sup ? sup.role_title : '';
          const members = bySupervisor[supId];
          return (
            <div key={supId} style={{marginBottom: '20px'}}>
              <div style={{background: 'var(--charcoal)', color: 'var(--primary)', padding: '10px 18px', borderRadius: '10px 10px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                <div>
                  <span style={{fontWeight: 700, fontSize: '15px'}}>{supName}</span>
                  {supRole && <span style={{fontSize: '12px', color: 'var(--gray-400)', marginLeft: '8px'}}>{supRole}</span>}
                </div>
                <span style={{fontSize: '13px', color: 'var(--gray-400)'}}>{members.length}</span>
              </div>
              <div style={{border: '2px solid var(--gray-200)', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '8px 12px'}}>
                {members.map(renderPersonCard)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="list-view">
      <h1 style={{marginBottom: '24px'}}>People</h1>

      <div className="people-grid">
        {roleGroups
          .filter(group => {
            // For non-admin (crew view), hide empty categories
            if (!isAdmin) {
              const gp = sortedPeople.filter(p => getLevelForPerson(p) === group.level);
              return gp.length > 0;
            }
            return true;
          })
          .sort((a, b) => {
            // Other always last, then Journeymen/Techs first, Helpers second, then ascending
            if (a.level === -1) return 1;
            if (b.level === -1) return -1;
            if (a.level === 1 && b.level !== 1) return -1;
            if (b.level === 1 && a.level !== 1) return 1;
            if (a.level === 0 && b.level !== 0) return -1;
            if (b.level === 0 && a.level !== 0) return 1;
            return a.level - b.level;
          })
          .map(group => {
          const groupPeople = sortedPeople.filter(p => getLevelForPerson(p) === group.level);
          return (
            <div key={group.level} className="people-category-bubble">
              <div className="people-category-header">
                <span className="people-category-title" onClick={() => setExpandedCategory(group.level)} style={{display: 'flex', alignItems: 'center', gap: '10px', flex: 1, cursor: 'pointer'}}>
                  <span>{group.icon}</span>
                  <span className="people-category-label">{group.label}</span>
                  <span className="people-category-count">{groupPeople.length}</span>
                </span>
                <button className="people-add-btn" onClick={(e) => { e.stopPropagation(); startNew(); }}>+</button>
              </div>
              <div className="people-category-body">
                {groupPeople.length === 0 ? (
                  <p style={{color: 'var(--gray-400)', fontSize: '13px', padding: '8px 0', margin: 0}}>No {group.label.toLowerCase()} yet</p>
                ) : groupPeople.map(renderPersonCard)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Team Assignment Component
// ============================================================
function TeamAssignment({ person, allPeople, onUpdate }) {
  const [showPicker, setShowPicker] = useState(false);

  // Find direct reports — people whose supervisor_id matches this person
  const directReports = allPeople.filter(p => p.supervisor_id === person.id);

  // Find assignable people — one level below, not already assigned to someone, not this person
  const personLevel = person.role_level || 2;
  const assignable = allPeople.filter(p =>
    (p.role_level || 1) === personLevel - 1 &&
    !p.supervisor_id &&
    p.id !== person.id &&
    p.status === 'active'
  );

  const assignPerson = async (subordinateId) => {
    const sub = allPeople.find(p => p.id === subordinateId);
    if (!sub) return;
    sub.supervisor_id = person.id;
    await fetch(`/api/people/${subordinateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    onUpdate();
    setShowPicker(false);
  };

  const unassignPerson = async (subordinateId) => {
    if (!window.confirm('Remove this person from the team?')) return;
    const sub = allPeople.find(p => p.id === subordinateId);
    if (!sub) return;
    sub.supervisor_id = null;
    await fetch(`/api/people/${subordinateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    onUpdate();
  };

  const levelBelow = personLevel === 2 ? 'Journeymen' : personLevel === 3 ? 'Foremen' : personLevel === 4 ? 'General Foremen' : 'Direct Reports';

  return (
    <div className="person-bubble">
      <div className="person-bubble-header">Team ({levelBelow})</div>
      <div className="person-bubble-body">
        {directReports.length === 0 ? (
          <p style={{fontSize: '13px', color: 'var(--gray-500)', marginBottom: '12px'}}>No {levelBelow.toLowerCase()} assigned yet.</p>
        ) : (
          <div style={{display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px'}}>
            {directReports.map(dr => (
              <div key={dr.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', background: 'var(--gray-50)', borderRadius: '8px',
                border: '1px solid var(--gray-200)'
              }}>
                <div>
                  <span style={{fontWeight: 600, fontSize: '14px'}}>{dr.name}</span>
                  <span style={{fontSize: '12px', color: 'var(--gray-500)', marginLeft: '8px'}}>{dr.role_title}</span>
                </div>
                <button
                  onClick={() => unassignPerson(dr.id)}
                  style={{
                    background: 'none', border: 'none', color: '#E8922A',
                    fontSize: '18px', cursor: 'pointer', padding: '4px 8px'
                  }}
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {showPicker ? (
          <div style={{border: '1px solid var(--primary)', borderRadius: '8px', padding: '12px', background: 'white'}}>
            <p style={{fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--gray-700)'}}>
              Select {levelBelow.toLowerCase()} to assign:
            </p>
            {assignable.length === 0 ? (
              <p style={{fontSize: '13px', color: 'var(--gray-500)'}}>No unassigned {levelBelow.toLowerCase()} available.</p>
            ) : (
              <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                {assignable.map(p => (
                  <button
                    key={p.id}
                    onClick={() => assignPerson(p.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '8px 12px', background: 'var(--gray-50)', border: '1px solid var(--gray-200)',
                      borderRadius: '6px', cursor: 'pointer', textAlign: 'left', fontSize: '14px'
                    }}
                  >
                    <span style={{color: 'var(--primary)', fontWeight: 700}}>+</span>
                    <span>{p.name}</span>
                    <span style={{fontSize: '12px', color: 'var(--gray-500)'}}>{p.role_title}</span>
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowPicker(false)}
              style={{marginTop: '8px', fontSize: '13px', color: 'var(--gray-500)', background: 'none', border: 'none', cursor: 'pointer'}}
            >Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setShowPicker(true)}
            style={{
              fontSize: '13px', color: 'var(--primary)', fontWeight: 600,
              background: 'none', border: '1px solid var(--primary)',
              borderRadius: '6px', padding: '8px 16px', cursor: 'pointer'
            }}
          >+ Assign Team Member</button>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Admin: Templates View — Grouped by Trade
// ============================================================
const TRADES = ['Electrical', 'Instrumentation', 'Pipe Fitting', 'Industrial Erection', 'Safety'];

function TemplatesView() {
  const [allTemplates, setAllTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [addingToTrade, setAddingToTrade] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetch('/api/templates').then(r => r.json()).then(t => {
      Promise.all(t.map(tmpl => fetch(`/api/templates/${tmpl.id}`).then(r => r.json())))
        .then(full => { setAllTemplates(full); setLoading(false); });
    });
  };
  useEffect(load, []);

  const startNew = (trade) => {
    setForm({
      template_name: '', trade, role_level: 1, role_level_title: '',
      role_description: '', report_focus: '',
      output_sections: ['Work Completed', 'Issues', 'Safety Observations', 'Notes'],
      vocabulary: { terms: [] }, language_notes: '',
    });
    setEditing('new');
    setAddingToTrade(trade);
  };

  const startEdit = (template) => { setForm({ ...template }); setEditing(template.id); };

  const save = async () => {
    const method = editing === 'new' ? 'POST' : 'PUT';
    const url = editing === 'new' ? '/api/templates' : `/api/templates/${editing}`;
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setEditing(null);
    setAddingToTrade(null);
    setLoading(true);
    load();
  };

  if (loading) return <div className="loading">Loading...</div>;

  if (editing !== null) {
    return (
      <div className="admin-form">
        <button className="back-btn" onClick={() => { setEditing(null); setAddingToTrade(null); }}>&larr; Back to Templates</button>
        <h1>{editing === 'new' ? `New ${addingToTrade} Role` : `Edit: ${form.template_name}`}</h1>
        <label className="admin-label">Role Name<input value={form.template_name || ''} onChange={e => setForm(f => ({ ...f, template_name: e.target.value }))} placeholder="e.g. Foreman, Helper" /></label>
        <label className="admin-label">Trade<input value={form.trade || ''} readOnly className="readonly" style={{ background: '#f5f3f0', color: '#7c7568' }} /></label>
        <label className="admin-label">Role Level<input type="number" min={1} value={form.role_level || 1} onChange={e => setForm(f => ({ ...f, role_level: parseInt(e.target.value) }))} /></label>
        <label className="admin-label">Role Level Title<input value={form.role_level_title || ''} onChange={e => setForm(f => ({ ...f, role_level_title: e.target.value }))} /></label>
        <label className="admin-label">Role Description<textarea rows={4} value={form.role_description || ''} onChange={e => setForm(f => ({ ...f, role_description: e.target.value }))} /></label>
        <label className="admin-label">Report Focus<textarea rows={3} value={form.report_focus || ''} onChange={e => setForm(f => ({ ...f, report_focus: e.target.value }))} /></label>
        <label className="admin-label">Output Sections (one per line)
          <textarea rows={6} value={(form.output_sections || []).join('\n')} onChange={e => setForm(f => ({ ...f, output_sections: e.target.value.split('\n').filter(s => s.trim()) }))} />
        </label>
        <label className="admin-label">Vocabulary Terms (comma-separated)
          <textarea rows={4} value={form.vocabulary?.terms?.join(', ') || ''} onChange={e => setForm(f => ({ ...f, vocabulary: { ...f.vocabulary, terms: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } }))} />
        </label>
        <label className="admin-label">Language Notes<textarea rows={3} value={form.language_notes || ''} onChange={e => setForm(f => ({ ...f, language_notes: e.target.value }))} /></label>

        <h2 className="admin-section-title">Safety Basics</h2>
        <label className="admin-label">Safety Rules (one per line)
          <textarea rows={6} value={(form.safety_rules || []).join('\n')} onChange={e => setForm(f => ({ ...f, safety_rules: e.target.value.split('\n').filter(s => s.trim()) }))} placeholder="PPE required at all times&#10;LOTO before any electrical work&#10;Fall protection above 6 feet..." />
        </label>
        <label className="admin-label">Safety Vocabulary (comma-separated)
          <textarea rows={3} value={(form.safety_vocabulary || []).join(', ')} onChange={e => setForm(f => ({ ...f, safety_vocabulary: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} placeholder="PPE, LOTO, JSA, confined space, hot work..." />
        </label>
        <label className="admin-label">Tools & Equipment Safety (one per line)
          <textarea rows={4} value={(form.tools_and_equipment || []).join('\n')} onChange={e => setForm(f => ({ ...f, tools_and_equipment: e.target.value.split('\n').filter(s => s.trim()) }))} placeholder="Inspect tools before use&#10;Scaffolds must be tagged&#10;Ground all portable equipment..." />
        </label>

        <div className="action-row"><button className="btn btn-primary btn-lg" onClick={save}>Save Template</button></div>
      </div>
    );
  }

  return (
    <div className="list-view">
      <h1>Templates</h1>
      {TRADES.map(trade => {
        const tradeTemplates = allTemplates.filter(t => t.trade === trade);
        return (
          <div key={trade} className="trade-group">
            <div className="trade-header">
              <h2 className="trade-title">{trade}</h2>
              <button className="btn btn-sm trade-add-btn" onClick={() => startNew(trade)}>+ Add Role</button>
            </div>
            {tradeTemplates.length === 0 ? (
              <p className="trade-empty">No roles yet</p>
            ) : (
              <div className="report-list">
                {tradeTemplates.map(t => (
                  <button key={t.id} className="report-card" onClick={() => startEdit(t)}>
                    <div className="report-card-header">
                      <span className="report-date" style={{ fontWeight: 700 }}>{t.template_name}</span>
                      <span className="report-duration">{t.role_level_title} (Level {t.role_level})</span>
                    </div>
                    <div className="report-preview">{t.output_sections ? t.output_sections.join(' · ') : ''}</div>
                    <div className="template-stats">{t.vocabulary?.terms?.length || 0} vocabulary terms</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Shared: Tab View
// ============================================================
function TabView({ tabs }) {
  const [active, setActive] = useState(0);
  const tab = tabs[active];

  return (
    <div className="tab-view">
      <div className="tab-buttons">
        {tabs.map((t, i) => (
          <button key={i} className={`tab-btn ${i === active ? 'active' : ''}`} onClick={() => setActive(i)}>{t.label}</button>
        ))}
      </div>
      <div className="tab-content">
        {tab.isAudio ? (
          <div className="audio-player">
            {tab.audioFile ? <audio controls src={`/api/audio/${tab.audioFile}`} style={{ width: '100%' }} /> : <p>No audio</p>}
          </div>
        ) : tab.isPlain ? (
          <div className="markdown-content plain">{tab.content || 'No content'}</div>
        ) : (
          <div className="markdown-content" dangerouslySetInnerHTML={{ __html: tab.content ? safeMarkdown(tab.content) : '<p>No content available</p>' }} />
        )}
      </div>
    </div>
  );
}

// ============================================================
// VoiceInput — Mic button for any text field
// ============================================================
function VoiceInput({ value, onChange, placeholder, rows }) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showAiVersion, setShowAiVersion] = useState(false);
  const [aiText, setAiText] = useState('');
  const [originalText, setOriginalText] = useState('');
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  const startVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let recorder;
      const mimeTypes = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      let selectedMime = '';
      for (const mime of mimeTypes) {
        try { if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime)) { selectedMime = mime; break; } } catch(e) {}
      }
      try { recorder = selectedMime ? new MediaRecorder(stream, { mimeType: selectedMime }) : new MediaRecorder(stream); } catch(e) { recorder = new MediaRecorder(stream); }
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => stream.getTracks().forEach(t => t.stop());
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording(true);
    } catch (e) {
      alert('Microphone access needed. Make sure you are using HTTPS.');
    }
  };

  const stopVoice = async () => {
    setRecording(false);
    setProcessing(true);
    if (recorderRef.current?.state !== 'inactive') recorderRef.current.stop();

    setTimeout(async () => {
      try {
        const mimeType = recorderRef.current?.mimeType || 'audio/webm';
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const formData = new FormData();
        formData.append('audio', blob, `field_recording.${ext}`);
        formData.append('report_id', 'field_' + Date.now());

        const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          const spoken = data.transcript;
          setOriginalText(spoken);

          // Ask Claude to clean it up
          try {
            const aiRes = await fetch('/api/structure', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                transcript: spoken,
                field_cleanup: true,
              }),
            });
            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const cleaned = aiData.cleaned || spoken;
              if (cleaned !== spoken) {
                setAiText(cleaned);
                setShowAiVersion(true);
              } else {
                onChange(spoken);
              }
            } else {
              onChange(spoken);
            }
          } catch(e) {
            onChange(spoken);
          }
        }
      } catch(e) {
        alert('Recording failed. Try again.');
      }
      setProcessing(false);
    }, 500);
  };

  const acceptAi = () => { onChange(aiText); setShowAiVersion(false); setAiText(''); };
  const keepOriginal = () => { onChange(originalText); setShowAiVersion(false); setAiText(''); };

  return (
    <div className="voice-input-wrapper">
      <textarea
        className="form-input form-textarea"
        rows={rows || 3}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <button
        className={`voice-field-btn ${recording ? 'voice-field-recording' : ''} ${processing ? 'voice-field-processing' : ''}`}
        onClick={recording ? stopVoice : startVoice}
        disabled={processing}
        type="button"
      >
        {processing ? (
          <div className="spinner-small"></div>
        ) : recording ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        )}
      </button>
      {showAiVersion && (
        <div className="voice-ai-review">
          <div className="voice-ai-columns">
            <div className="voice-ai-cleaned">
              <span className="voice-ai-label">AI Version</span>
              <p>{aiText}</p>
            </div>
            <div className="voice-ai-original">
              <span className="voice-ai-label">Your Words</span>
              <p>{originalText}</p>
            </div>
          </div>
          <div className="voice-ai-actions">
            <button className="btn-primary" onClick={acceptAi} style={{padding:'12px', fontSize:'14px'}}>Use AI Version</button>
            <button className="btn-secondary" onClick={keepOriginal} style={{padding:'12px', fontSize:'14px', background:'white'}}>Keep Original</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================
function safeMarkdown(text) {
  try {
    if (typeof marked !== 'undefined' && marked.parse) return marked.parse(text);
    return text.replace(/\n/g, '<br>');
  } catch (e) { return text.replace(/\n/g, '<br>'); }
}

function getSupportedMimeType() {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'audio/webm';
}

// ============================================================
// VoiceRefinePanel — Dialogue-first AI voice conversation
// ============================================================
function VoiceRefinePanel({ contextType, teamContext, onAccept, onCancel, personId, defaultVoiceMode }) {
  // Stages: idle, recording, processing, talking, listening, finalizing, review
  // Flow mode adds: flow-listening (continuous Speech Recognition with silence detection)
  const [stage, setStageRaw] = useState('idle');
  const [chatHistory, setChatHistory] = useState([]); // [{role: 'user'|'ai', text: string}]
  const [conversation, setConversation] = useState([]); // API conversation format
  const [round, setRound] = useState(0);
  const [currentFields, setCurrentFields] = useState(null);
  const [keyPoints, setKeyPoints] = useState([]);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [recordTime, setRecordTime] = useState(0);
  const [error, setError] = useState('');
  const [voiceMode, setVoiceMode] = useState(defaultVoiceMode || 'flow'); // 'flow' is default — walkie-talkie is escape hatch
  const [flowBannerPulse, setFlowBannerPulse] = useState(false);
  const stageRef = React.useRef('idle'); // mirror of stage for closure-safe access

  const recorderRef = React.useRef(null);
  const chunksRef = React.useRef([]);
  const flowRecogRef = React.useRef(null);
  const flowSilenceTimerRef = React.useRef(null);
  const flowTimeoutRef = React.useRef(null);
  const flowTranscriptRef = React.useRef('');
  const flowLastSpeechRef = React.useRef(Date.now());

  // Analytics: track stage transitions
  const funnelIdRef = React.useRef('funnel_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  const stageTimeRef = React.useRef(Date.now());
  const prevStageRef = React.useRef('idle');
  const setStage = (newStage) => {
    const now = Date.now();
    const duration = now - stageTimeRef.current;
    AnalyticsTracker.track('refine_funnel', newStage, {
      funnel_id: funnelIdRef.current, from_stage: prevStageRef.current,
      context_type: contextType, round, duration_ms: duration,
    });
    prevStageRef.current = newStage;
    stageTimeRef.current = now;
    stageRef.current = newStage;
    setStageRaw(newStage);
  };
  const ttsAudioRef = React.useRef(null);
  const ttsCacheRef = React.useRef({});
  const timerRef = React.useRef(null);
  const recognitionRef = React.useRef(null);
  const fullTranscriptRef = React.useRef('');
  const chatEndRef = React.useRef(null);

  // Auto-scroll chat
  React.useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, liveText, stage]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) {} }
      stopFlowListening();
    };
  }, []);

  // No auto-start — user taps the mic to begin, then conversation flows naturally from there

  // ─── FLOW MODE: Continuous Speech Recognition — conversation stays OPEN ───
  // The conversation never closes on its own. It's a back-and-forth dialogue.
  // 3s pause with speech = AI's turn. 15s total silence = AI checks in but keeps listening.
  const flowRetryCountRef = React.useRef(0);

  const startFlowListening = () => {
    stopFlowListening();
    setError('');
    setLiveText('');
    flowTranscriptRef.current = '';
    flowLastSpeechRef.current = Date.now();
    flowRetryCountRef.current = 0;
    setFlowBannerPulse(true);

    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { setError('Speech recognition not supported. Switching to walkie-talkie mode.'); setVoiceMode('walkie'); return; }

      // Create and start a fresh recognition instance
      const createRecognition = () => {
        const recog = new SR();
        recog.continuous = true;
        recog.interimResults = true;
        recog.lang = 'en-US';

        recog.onresult = (event) => {
          flowRetryCountRef.current = 0; // Reset retry count on any speech
          let final = '';
          let interim = '';
          for (let i = 0; i < event.results.length; i++) {
            const r = event.results[i];
            if (r.isFinal) {
              final += r[0].transcript + ' ';
            } else {
              interim += r[0].transcript;
            }
          }
          if (final) {
            // Append final text to accumulated transcript
            flowTranscriptRef.current += final;
            flowLastSpeechRef.current = Date.now();
          }
          if (interim) {
            flowLastSpeechRef.current = Date.now();
          }
          setLiveText(flowTranscriptRef.current + interim);
        };

        recog.onerror = (e) => {
          if (e.error === 'no-speech' || e.error === 'aborted') {
            // Browser killed recognition due to silence — this is normal, onend will restart
            return;
          }
          if (e.error === 'not-allowed') {
            setError('Microphone access denied. Please allow microphone access and try again.');
            stopFlowListening();
            setStage('idle');
          }
          if (e.error === 'network') {
            // Network issue — retry silently
            return;
          }
        };

        recog.onend = () => {
          // Browser stopped recognition — restart if we're still in flow-listening
          if (stageRef.current === 'flow-listening') {
            flowRetryCountRef.current++;
            if (flowRetryCountRef.current > 50) {
              // Too many restarts — something is wrong
              setError('Microphone connection lost. Tap the mic to restart.');
              stopFlowListening();
              setStage('listening');
              return;
            }
            // Small delay before restart to prevent rapid cycling
            setTimeout(() => {
              if (stageRef.current === 'flow-listening') {
                try {
                  const newRecog = createRecognition();
                  newRecog.start();
                  flowRecogRef.current = newRecog;
                } catch(ex) {
                  // If start fails, try again after a longer delay
                  setTimeout(() => {
                    if (stageRef.current === 'flow-listening') {
                      try {
                        const retry = createRecognition();
                        retry.start();
                        flowRecogRef.current = retry;
                      } catch(ex2) {}
                    }
                  }, 1000);
                }
              }
            }, 200);
          }
        };

        return recog;
      };

      const recog = createRecognition();
      recog.start();
      flowRecogRef.current = recog;

      // 3-second pause with speech = AI's turn to respond
      flowSilenceTimerRef.current = setInterval(() => {
        const silenceDuration = Date.now() - flowLastSpeechRef.current;
        const currentText = flowTranscriptRef.current.trim();

        if (currentText.length > 0 && silenceDuration > 3000) {
          // User paused for 3 seconds after saying something — AI's turn
          clearInterval(flowSilenceTimerRef.current);
          flowSilenceTimerRef.current = null;
          stopFlowListening();
          processFlowTranscript(currentText);
        }
      }, 500);

      // 15s total silence (no speech detected at all) — AI checks in but conversation stays open
      const startSilenceTimeout = () => {
        if (flowTimeoutRef.current) clearTimeout(flowTimeoutRef.current);
        flowTimeoutRef.current = setTimeout(async () => {
          if (stageRef.current !== 'flow-listening') return;
          const hasText = flowTranscriptRef.current.trim().length > 0;
          if (!hasText) {
            // No speech for 15 seconds — AI checks in
            const prompt = round === 0
              ? "I'm here and listening. Go ahead and tell me what you need — I'm ready."
              : "Hey, I'm still here. Just say something when you're ready to keep going.";
            setChatHistory(prev => [...prev, { role: 'ai', text: prompt }]);
            // Speak but keep listening — don't stop the flow
            speakText(prompt);
            // Reset the timeout for another round
            flowLastSpeechRef.current = Date.now();
            startSilenceTimeout();
          }
        }, 15000);
      };
      startSilenceTimeout();

      setStage('flow-listening');
    } catch(e) {
      setError('Could not start flow mode: ' + e.message);
      setVoiceMode('walkie');
    }
  };

  const stopFlowListening = () => {
    setFlowBannerPulse(false);
    if (flowRecogRef.current) {
      const recog = flowRecogRef.current;
      recog.onend = null; // Prevent restart
      recog.onerror = null;
      recog.onresult = null;
      flowRecogRef.current = null;
      try { recog.stop(); } catch(e) {}
    }
    if (flowSilenceTimerRef.current) { clearInterval(flowSilenceTimerRef.current); flowSilenceTimerRef.current = null; }
    if (flowTimeoutRef.current) { clearTimeout(flowTimeoutRef.current); flowTimeoutRef.current = null; }
  };

  // Play audio from base64 data (used by combined refine-speak endpoint)
  const playBase64Audio = (base64, mime, onDone) => {
    if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
    const byteChars = atob(base64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArray], { type: mime });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    ttsAudioRef.current = audio;
    setAiSpeaking(true);
    audio.onended = () => { setAiSpeaking(false); ttsAudioRef.current = null; URL.revokeObjectURL(url); if (onDone) onDone(); };
    audio.onerror = () => { setAiSpeaking(false); ttsAudioRef.current = null; URL.revokeObjectURL(url); if (onDone) onDone(); };
    audio.play().catch(() => { setAiSpeaking(false); if (onDone) onDone(); });
  };

  const processFlowTranscript = async (transcript) => {
    if (!transcript) { setStage('listening'); return; }
    setStage('processing');
    try {
      setChatHistory(prev => [...prev, { role: 'user', text: transcript }]);
      setLiveText('');

      const currentConv = [...conversation];
      // Use combined refine-speak endpoint — AI thinking + TTS in one round-trip (saves 2-3s)
      const refineRes = await fetch('/api/refine-speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context_type: contextType,
          raw_transcript: transcript,
          conversation: currentConv,
          round,
          team_context: teamContext || '',
          phase: 'dialogue',
          person_id: personId || '',
        }),
      });
      const data = await refineRes.json();
      if (data.error) { setStage('idle'); setError(data.error); return; }

      const newConv = [...currentConv,
        { role: 'user', content: transcript },
        { role: 'assistant', content: data.spoken_response || '' },
      ];
      setConversation(newConv);
      setRound(r => r + 1);
      if (data.key_points) setKeyPoints(data.key_points);

      const aiText = data.spoken_response || '';
      setChatHistory(prev => [...prev, { role: 'ai', text: aiText }]);

      const afterSpeak = data.ready_to_finalize
        ? () => { finalizeTask(newConv); }
        : () => { voiceMode === 'flow' ? startFlowListening() : setStage('listening'); };

      setStage('talking');
      // If combined endpoint returned audio, play it directly (no extra TTS fetch needed)
      if (data.audio_base64) {
        playBase64Audio(data.audio_base64, data.audio_mime || 'audio/mpeg', afterSpeak);
      } else {
        // Fallback to separate TTS call
        await speakText(aiText, afterSpeak);
      }
    } catch (e) {
      console.error('Flow process error:', e);
      setStage('idle');
      setError('Something went wrong. Try again.');
    }
  };

  // Handle tap-to-stop in flow mode
  const stopFlowAndProcess = () => {
    const text = flowTranscriptRef.current.trim();
    stopFlowListening();
    if (text) {
      processFlowTranscript(text);
    } else {
      setStage('listening');
    }
  };

  const startRecording = async () => {
    try {
      setError('');
      setLiveText('');
      fullTranscriptRef.current = '';
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) {} }
        if (timerRef.current) clearInterval(timerRef.current);
        processRecording();
      };
      recorder.start(100);
      recorderRef.current = recorder;
      setRecordTime(0);
      timerRef.current = setInterval(() => setRecordTime(t => t + 1), 1000);

      // Live speech preview
      try {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
          const recog = new SpeechRecognition();
          recog.continuous = true;
          recog.interimResults = true;
          recog.lang = 'en-US';
          recog.onresult = (event) => {
            let interim = '';
            for (let i = 0; i < event.results.length; i++) {
              if (event.results[i].isFinal) {
                fullTranscriptRef.current += event.results[i][0].transcript + ' ';
              } else {
                interim += event.results[i][0].transcript;
              }
            }
            setLiveText(fullTranscriptRef.current + interim);
          };
          recog.onerror = () => {};
          recog.start();
          recognitionRef.current = recog;
        }
      } catch(e) {}

      setStage('recording');
    } catch (e) {
      if (e.name === 'NotAllowedError') setError('Microphone access denied.');
      else setError('Microphone error: ' + e.message);
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) {} }
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const processRecording = async () => {
    setStage('processing');
    try {
      const mimeType = recorderRef.current?.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (blob.size < 1000) { setStage('idle'); setError('Recording too short.'); return; }

      // OPTIMIZATION: Use Web Speech API transcript immediately if available,
      // and send Whisper transcription in background for accuracy logging
      const liveTranscript = fullTranscriptRef.current?.trim();
      let transcript;

      if (liveTranscript && liveTranscript.length > 10) {
        // Use instant live transcript — skip the 2-3s Whisper wait
        transcript = liveTranscript;
        // Fire-and-forget Whisper in background for accuracy comparison (analytics)
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const bgFd = new window.FormData();
        bgFd.append('audio', blob, `refine_voice.${ext}`);
        fetch('/api/transcribe', { method: 'POST', body: bgFd }).catch(() => {});
      } else {
        // No live transcript available — fall back to Whisper
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const fd = new window.FormData();
        fd.append('audio', blob, `refine_voice.${ext}`);
        const transRes = await fetch('/api/transcribe', { method: 'POST', body: fd });
        const transData = await transRes.json();
        if (!transData.transcript) { setStage('idle'); setError('Could not transcribe audio.'); return; }
        transcript = transData.transcript;
      }

      // Add user message to chat
      setChatHistory(prev => [...prev, { role: 'user', text: transcript }]);

      // OPTIMIZATION: Use combined refine-speak endpoint (Claude + TTS in one round-trip)
      const currentConv = [...conversation];
      const refineRes = await fetch('/api/refine-speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context_type: contextType,
          raw_transcript: transcript,
          conversation: currentConv,
          round,
          team_context: teamContext || '',
          phase: 'dialogue',
          person_id: personId || '',
        }),
      });
      const data = await refineRes.json();

      if (data.error) { setStage('idle'); setError(data.error); return; }

      // Update conversation history for API
      const newConv = [...currentConv,
        { role: 'user', content: transcript },
        { role: 'assistant', content: data.spoken_response || '' },
      ];
      setConversation(newConv);
      setRound(r => r + 1);
      if (data.key_points) setKeyPoints(data.key_points);

      // Add AI message to chat
      const aiText = data.spoken_response || '';
      setChatHistory(prev => [...prev, { role: 'ai', text: aiText }]);

      const afterSpeak = data.ready_to_finalize
        ? () => { finalizeTask(newConv); }
        : () => { voiceMode === 'flow' ? startFlowListening() : setStage('listening'); };

      setStage('talking');
      // Play audio directly from combined response if available
      if (data.audio_base64) {
        playBase64Audio(data.audio_base64, data.audio_mime || 'audio/mpeg', afterSpeak);
      } else {
        await speakText(aiText, afterSpeak);
      }
    } catch (e) {
      console.error('Refine process error:', e);
      setStage('idle');
      setError('Something went wrong. Try again.');
    }
  };

  const finalizeTask = async (conv) => {
    setStage('finalizing');
    try {
      const res = await fetch('/api/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context_type: contextType,
          raw_transcript: '',
          conversation: conv || conversation,
          round: round + 1,
          team_context: teamContext || '',
          phase: 'finalize',
          person_id: personId || '',
        }),
      });
      const data = await res.json();

      if (data.fields) setCurrentFields(data.fields);

      const aiText = data.spoken_response || 'Here is your task. Ready to approve?';
      setChatHistory(prev => [...prev, { role: 'ai', text: aiText }]);

      setStage('review');
      speakText(aiText);
    } catch(e) {
      console.error('Finalize error:', e);
      setError('Could not finalize. Try again.');
      setStage('listening');
    }
  };

  const speakText = async (text, onDone) => {
    try {
      setAiSpeaking(true);
      if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
      let audioUrl = ttsCacheRef.current[text];
      if (!audioUrl) {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, speed: 1.15 }),
        });
        if (res.ok) {
          const blob = await res.blob();
          audioUrl = URL.createObjectURL(blob);
          ttsCacheRef.current[text] = audioUrl;
        }
      }
      if (audioUrl) {
        const audio = new Audio(audioUrl);
        ttsAudioRef.current = audio;
        audio.onended = () => { setAiSpeaking(false); ttsAudioRef.current = null; if (onDone) onDone(); };
        audio.onerror = () => { setAiSpeaking(false); ttsAudioRef.current = null; if (onDone) onDone(); };
        await audio.play();
      } else {
        setAiSpeaking(false);
        if (onDone) onDone();
      }
    } catch(e) {
      setAiSpeaking(false);
      if (onDone) onDone();
    }
  };

  const stopSpeaking = () => {
    if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
    setAiSpeaking(false);
  };

  const handleAccept = () => {
    stopSpeaking();
    AnalyticsTracker.track('refine_funnel', 'accepted', { funnel_id: funnelIdRef.current, context_type: contextType, round });
    if (currentFields) onAccept(currentFields);
  };

  const handleMakeBetter = () => {
    stopSpeaking();
    AnalyticsTracker.track('feature_use', 'make_it_better', { funnel_id: funnelIdRef.current, context_type: contextType, round });
    const prompt = "Sure thing! Tell me what you'd like to change.";
    setChatHistory(prev => [...prev, { role: 'ai', text: prompt }]);
    speakText(prompt, () => setStage('listening'));
  };

  const handleCancel = () => {
    stopSpeaking();
    AnalyticsTracker.track('refine_funnel', 'cancelled', { funnel_id: funnelIdRef.current, context_type: contextType, round });
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    onCancel();
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const priorityLabels = { low: 'Low', normal: 'Normal', high: 'High', critical: 'Critical' };
  const priorityColors = { critical: '#d32f2f', high: '#F99440', normal: 'var(--charcoal)', low: '#999' };

  const fieldLabels = contextType === 'daily_task'
    ? { title: 'Task', description: 'Details', assigned_to: 'Assigned To', priority: 'Priority' }
    : { title: 'Issue', description: 'Details', location: 'Location', priority: 'Priority' };

  return (
    <div className="refine-panel">
      {error && <p style={{color: '#d32f2f', fontSize: '14px', textAlign: 'center', marginBottom: '12px'}}>{error}</p>}

      {/* FLOW MODE BANNER — persistent pulsing indicator */}
      {stage === 'flow-listening' && (
        <div className="flow-banner">
          <span className="flow-banner-dot" />
          Listening... tap when done
        </div>
      )}

      {/* VOICE MODE TOGGLE — switch between walkie-talkie and flow */}
      {(stage === 'idle' || stage === 'listening') && (
        <div className="voice-mode-toggle">
          <button
            className={`voice-mode-btn ${voiceMode === 'walkie' ? 'active' : ''}`}
            onClick={() => { setVoiceMode('walkie'); AnalyticsTracker.track('feature_use', 'voice_mode_switch', { mode: 'walkie' }); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="3"/><circle cx="12" cy="18" r="1"/><line x1="9" y1="6" x2="15" y2="6"/></svg>
            Walkie-Talkie
          </button>
          <button
            className={`voice-mode-btn ${voiceMode === 'flow' ? 'active' : ''}`}
            onClick={() => { setVoiceMode('flow'); AnalyticsTracker.track('feature_use', 'voice_mode_switch', { mode: 'flow' }); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12h4l3-9 4 18 3-9h6"/></svg>
            Flow
          </button>
        </div>
      )}

      {/* IDLE — Initial mic button */}
      {stage === 'idle' && chatHistory.length === 0 && (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '20px 0'}}>
          <button onClick={voiceMode === 'flow' ? startFlowListening : startRecording} className="refine-mic-btn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--primary)" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/></svg>
            {voiceMode === 'flow' ? 'Start talking' : (contextType === 'daily_task' ? 'Speak your task' : 'Describe the issue')}
          </button>
        </div>
      )}

      {/* CHAT HISTORY — conversation bubbles */}
      {chatHistory.length > 0 && (
        <div className="refine-chat" style={{maxHeight: '300px', overflowY: 'auto', marginBottom: '12px'}}>
          {chatHistory.map((msg, i) => (
            <div key={i} className={`refine-bubble refine-bubble-${msg.role}`}>
              <p style={{margin: 0, fontSize: '14px', lineHeight: 1.5}}>{msg.text}</p>
              {msg.role === 'ai' && (
                <button onClick={() => aiSpeaking ? stopSpeaking() : speakText(msg.text)}
                  className={`refine-read-btn ${aiSpeaking ? 'refine-reading' : ''}`}
                  style={{marginTop: '6px', fontSize: '12px'}}>
                  {aiSpeaking ? '⏹ Stop' : '🔊 Listen'}
                </button>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      )}

      {/* RECORDING — walkie-talkie mode */}
      {stage === 'recording' && (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '12px 0'}}>
          <button onClick={stopRecording} className="refine-mic-btn refine-mic-recording">
            <span className="refine-pulse-dot" />
            Stop — {formatTime(recordTime)}
          </button>
          {liveText && <p className="refine-live-text">{liveText}</p>}
        </div>
      )}

      {/* FLOW-LISTENING — continuous listening mode */}
      {stage === 'flow-listening' && (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '12px 0'}}>
          <div className="flow-waveform">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
          {liveText && <p className="refine-live-text" style={{minHeight: '40px'}}>{liveText}</p>}
          {!liveText && <p style={{color: 'var(--gray-400)', fontSize: '14px', fontStyle: 'italic'}}>Speak naturally... I'm listening</p>}
          <button onClick={stopFlowAndProcess} className="btn btn-primary" style={{
            padding: '12px 28px', fontSize: '15px', fontWeight: 700, borderRadius: '12px',
            marginTop: '8px', opacity: 0.85
          }}>
            Your turn, AI
          </button>
        </div>
      )}

      {/* PROCESSING */}
      {stage === 'processing' && (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '16px 0'}}>
          <div className="spinner" />
          <p style={{color: 'var(--gray-500)', fontSize: '14px', fontWeight: 600}}>AI is thinking...</p>
        </div>
      )}

      {/* TALKING — AI is speaking, show speaker animation */}
      {stage === 'talking' && (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '16px 0'}}>
          <div className="refine-speaking-indicator">
            <span /><span /><span /><span /><span />
          </div>
          <p style={{color: 'var(--gray-500)', fontSize: '14px', fontWeight: 600}}>AI is talking...</p>
          <button onClick={() => { stopSpeaking(); setStage('listening'); }} className="refine-cancel-btn" style={{fontSize: '13px'}}>Skip</button>
        </div>
      )}

      {/* FINALIZING */}
      {stage === 'finalizing' && (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '16px 0'}}>
          <div className="spinner" />
          <p style={{color: 'var(--gray-500)', fontSize: '14px', fontWeight: 600}}>Preparing your {contextType === 'daily_task' ? 'task' : 'punch item'}...</p>
        </div>
      )}

      {/* LISTENING — Ready for worker to respond (walkie-talkie mode fallback) */}
      {stage === 'listening' && (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '12px 0'}}>
          <button onClick={voiceMode === 'flow' ? startFlowListening : startRecording} className="refine-mic-btn refine-mic-listening">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--primary)" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/></svg>
            {voiceMode === 'flow' ? 'Continue talking' : 'Your turn — tap to respond'}
          </button>
          <button onClick={() => finalizeTask()} className="refine-cancel-btn" style={{fontSize: '13px'}}>That's enough, finalize it</button>
        </div>
      )}

      {/* REVIEW — Final task preview with approve/change */}
      {stage === 'review' && currentFields && (
        <div className="refine-preview">
          <div className="refine-fields">
            {Object.entries(fieldLabels).map(([key, label]) => {
              if (!currentFields[key] && key !== 'priority') return null;
              const value = key === 'priority'
                ? (priorityLabels[currentFields[key]] || currentFields[key])
                : currentFields[key];
              return (
                <div key={key} className="refine-field-row">
                  <span className="refine-field-label">{label}</span>
                  <span className="refine-field-value" style={key === 'priority' ? {color: priorityColors[currentFields[key]] || 'inherit', fontWeight: 700} : {}}>
                    {value || '—'}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="refine-actions">
            <button onClick={handleAccept} className="btn btn-primary refine-accept-btn">Approve</button>
            <button onClick={handleMakeBetter} className="refine-better-btn">Change Something</button>
            <button onClick={handleCancel} className="refine-cancel-btn">Cancel</button>
          </div>
        </div>
      )}

      {/* IDLE with existing chat (error recovery) */}
      {stage === 'idle' && chatHistory.length > 0 && (
        <div style={{display: 'flex', justifyContent: 'center', gap: '8px', padding: '12px 0'}}>
          <button onClick={startRecording} className="refine-mic-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--primary)" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/></svg>
            Try again
          </button>
          <button onClick={handleCancel} className="refine-cancel-btn">Cancel</button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Daily Plan View
// ============================================================
function DailyPlanView({ user, initialTab }) {
  const [activeTab, setActiveTab] = useState(initialTab || 'plan'); // 'plan' or 'punch'
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', assigned_to: '', priority: 'normal' });
  const [taskAttachments, setTaskAttachments] = useState([]); // [{name, type, preview}]
  const taskPhotoRef = React.useRef(null);
  const taskGalleryRef = React.useRef(null);
  const taskFileRef = React.useRef(null);
  const [showTaskPhotoChoice, setShowTaskPhotoChoice] = React.useState(false);
  const [team, setTeam] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const isSupervisor = (user.role_level || 1) >= 2;
  const personId = user.person_id;

  useEffect(() => { loadTasks(); loadTeam(); }, [selectedDate]);

  const loadTasks = async () => {
    try {
      const url = isSupervisor
        ? `/api/daily-plans/${personId}?date=${selectedDate}`
        : `/api/daily-plans/my-tasks/${personId}?date=${selectedDate}`;
      const res = await fetch(url);
      const data = await res.json();
      setTasks(isSupervisor ? (data.tasks || []) : data);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  const loadTeam = async () => {
    if (!isSupervisor) return;
    try {
      const res = await fetch('/api/people');
      const all = await res.json();
      setTeam(all.filter(p => p.supervisor_id === personId));
    } catch(e) {}
  };

  // Voice refinement panel state
  const [showVoiceRefine, setShowVoiceRefine] = useState(false);

  const handleTaskAttachment = (e, type) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const att = { name: file.name, type: type, size: file.size };
      if (type === 'photo' && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          att.preview = ev.target.result;
          setTaskAttachments(prev => [...prev, att]);
        };
        reader.readAsDataURL(file);
      } else {
        setTaskAttachments(prev => [...prev, att]);
      }
    });
    e.target.value = '';
  };

  const removeAttachment = (index) => {
    setTaskAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const addTask = async () => {
    if (!newTask.title.trim()) return;
    await fetch(`/api/daily-plans/${personId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newTask, date: selectedDate, trade: user.trade, attachments: taskAttachments }),
    });
    setNewTask({ title: '', description: '', assigned_to: '', priority: 'normal' });
    setTaskAttachments([]);
    setShowAddTask(false);
    loadTasks();
  };

  const updateTaskStatus = async (taskId, status) => {
    await fetch(`/api/daily-plans/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, completed_at: status === 'completed' ? new Date().toISOString() : null }),
    });
    loadTasks();
  };

  const deleteTask = async (taskId) => {
    if (!confirm('Delete this task?')) return;
    await fetch(`/api/daily-plans/tasks/${taskId}`, { method: 'DELETE' });
    loadTasks();
  };

  const statusColors = { pending: '#F99440', in_progress: '#48484A', completed: '#4CAF50', cancelled: '#999' };
  const statusLabels = { pending: 'Pending', in_progress: 'In Progress', completed: 'Done', cancelled: 'Cancelled' };
  const priorityColors = { critical: '#d32f2f', high: '#F99440', normal: 'var(--charcoal)', low: '#999' };

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const totalCount = tasks.length;

  // If punch tab is active, render PunchListView
  if (activeTab === 'punch') {
    return (
      <div className="list-view">
        <div style={{display: 'flex', gap: '0', marginBottom: '28px', border: '2px solid var(--charcoal)', borderRadius: '10px', overflow: 'hidden'}}>
          <button onClick={() => setActiveTab('plan')} style={{flex: 1, padding: '14px', border: 'none', fontSize: '16px', fontWeight: 700, cursor: 'pointer', background: 'white', color: 'var(--primary)'}}>Daily Plan</button>
          <button style={{flex: 1, padding: '14px', border: 'none', fontSize: '16px', fontWeight: 700, background: 'var(--charcoal)', color: 'var(--primary)', borderLeft: '2px solid var(--charcoal)'}}>Punch List</button>
        </div>
        <PunchListView user={user} embedded={true} />
      </div>
    );
  }

  return (
    <div className="list-view">
      {/* Tab switcher */}
      <div style={{display: 'flex', gap: '0', marginBottom: '28px', border: '2px solid var(--charcoal)', borderRadius: '10px', overflow: 'hidden'}}>
        <button style={{flex: 1, padding: '14px', border: 'none', fontSize: '16px', fontWeight: 700, background: 'var(--charcoal)', color: 'var(--primary)'}}>Daily Plan</button>
        <button onClick={() => setActiveTab('punch')} style={{flex: 1, padding: '14px', border: 'none', fontSize: '16px', fontWeight: 700, cursor: 'pointer', background: 'white', color: 'var(--primary)', borderLeft: '2px solid var(--charcoal)'}}>Punch List</button>
      </div>

      {/* Tasks header: title + date on left, add button on right */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
          <h1 style={{fontWeight: 800, margin: 0, fontSize: '20px'}}>Tasks</h1>
          {totalCount > 0 && (
            <span style={{fontSize: '13px', fontWeight: 600, color: completedCount === totalCount ? '#4CAF50' : 'var(--charcoal)'}}>
              {completedCount}/{totalCount}
            </span>
          )}
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            style={{padding: '8px 10px', border: '2px solid var(--primary)', borderRadius: '8px', fontSize: '14px', fontWeight: 600, background: 'white', color: 'var(--charcoal)'}} />
        </div>
        <button className="btn btn-primary" style={{padding: '8px 16px', fontWeight: 700, fontSize: '14px'}} onClick={() => { setShowAddTask(!showAddTask); setShowVoiceRefine(true); }}>
          + Add Task
        </button>
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div style={{height: '6px', background: '#e0e0e0', borderRadius: '3px', marginBottom: '16px', overflow: 'hidden'}}>
          <div style={{height: '100%', width: (completedCount / totalCount * 100) + '%', background: '#4CAF50', borderRadius: '3px', transition: 'width 0.3s'}} />
        </div>
      )}

      {/* Add task form */}
      {showAddTask && (
        <div style={{background: 'white', border: '2px solid var(--primary)', borderRadius: '12px', padding: '16px', marginBottom: '16px'}}>
          {/* Voice Refine Panel */}
          {showVoiceRefine ? (
            <VoiceRefinePanel
              contextType="daily_task"
              teamContext={team.map(p => `${p.name} (${p.id})`).join(', ')}
              personId={personId}
              defaultVoiceMode={(user.role_level || 1) >= 2 ? 'flow' : 'walkie'}
              onAccept={(fields) => {
                setNewTask(t => ({ ...t, ...fields }));
                setShowVoiceRefine(false);
              }}
              onCancel={() => setShowVoiceRefine(false)}
            />
          ) : (
            <div style={{display: 'flex', justifyContent: 'center', marginBottom: '12px'}}>
              <button onClick={() => setShowVoiceRefine(true)} className="refine-mic-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--primary)" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/></svg>
                Speak your task
              </button>
            </div>
          )}
          <input type="text" placeholder="Task title..." value={newTask.title} onChange={e => setNewTask(t => ({...t, title: e.target.value}))}
            style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', boxSizing: 'border-box'}} />
          <textarea placeholder="Description (optional)..." value={newTask.description} onChange={e => setNewTask(t => ({...t, description: e.target.value}))}
            rows={2} style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', resize: 'none', boxSizing: 'border-box'}} />
          <select value={newTask.assigned_to} onChange={e => setNewTask(t => ({...t, assigned_to: e.target.value}))}
            style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', boxSizing: 'border-box'}}>
            <option value="">Assign to...</option>
            {team.map(p => <option key={p.id} value={p.id}>{p.name} — {p.role_title}</option>)}
          </select>
          <select value={newTask.priority} onChange={e => setNewTask(t => ({...t, priority: e.target.value}))}
            style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '12px', boxSizing: 'border-box'}}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          {/* Attachment previews */}
          <input ref={taskPhotoRef} type="file" accept="image/*" capture="environment" style={{display: 'none'}} onChange={e => handleTaskAttachment(e, 'photo')} />
          <input ref={taskGalleryRef} type="file" accept="image/*" style={{display: 'none'}} onChange={e => handleTaskAttachment(e, 'photo')} />
          <input ref={taskFileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.dwg,.txt" multiple style={{display: 'none'}} onChange={e => handleTaskAttachment(e, 'file')} />
          {taskAttachments.length > 0 && (
            <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px'}}>
              {taskAttachments.map((att, i) => (
                <div key={i} style={{position: 'relative', background: '#f0ece8', borderRadius: '8px', padding: '6px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px'}}>
                  {att.preview ? <img src={att.preview} style={{width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover'}} alt="" /> : <span>📎</span>}
                  <span style={{maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{att.name}</span>
                  <button onClick={() => removeAttachment(i)} style={{background: 'none', border: 'none', color: '#d32f2f', fontSize: '14px', cursor: 'pointer', padding: '0 2px'}}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Action row: Photo, File, Form, Add, Cancel */}
          <div style={{display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap'}}>
            <div style={{position: 'relative', flex: 1, minWidth: '80px'}}>
              <button onClick={() => setShowTaskPhotoChoice(!showTaskPhotoChoice)} style={{
                padding: '10px 16px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
                fontSize: '14px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0, minWidth: '18px'}}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Photo
              </button>
              {showTaskPhotoChoice && (
                <React.Fragment>
                  <div onClick={() => setShowTaskPhotoChoice(false)} style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9}} />
                  <div style={{position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px', background: 'white', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 10, overflow: 'hidden', minWidth: '140px'}}>
                    <button onClick={() => { taskPhotoRef.current?.click(); setShowTaskPhotoChoice(false); }} style={{display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #eee'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Camera</span>
                    </button>
                    <button onClick={() => { taskGalleryRef.current?.click(); setShowTaskPhotoChoice(false); }} style={{display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>Gallery</span>
                    </button>
                  </div>
                </React.Fragment>
              )}
            </div>
            <button onClick={() => taskFileRef.current?.click()} style={{
              padding: '10px 16px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
              fontSize: '14px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '80px',
            }}>
              📎 File
            </button>
            <button style={{
              padding: '10px 16px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
              fontSize: '14px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '80px',
            }} onClick={() => alert('Forms coming soon')}>
              📝 Form
            </button>
            <button className="btn btn-primary" style={{padding: '10px 20px', fontWeight: 700, fontSize: '14px'}} onClick={addTask}>Add</button>
            <button className="btn btn-secondary" style={{padding: '10px 20px', fontSize: '14px'}} onClick={() => { setShowAddTask(false); setTaskAttachments([]); setShowTaskPhotoChoice(false); }}>Cancel</button>
          </div>
        </div>
      )}

      {loading && <p style={{color: 'var(--gray-500)'}}>Loading...</p>}

      {!loading && tasks.length === 0 && (
        <div style={{textAlign: 'center', padding: '40px 0', color: 'var(--gray-500)'}}>
          <p style={{fontSize: '16px'}}>No tasks for this day</p>
          <p style={{fontSize: '14px'}}>Tap "+ Add Task" to assign work</p>
        </div>
      )}

      {/* Task list */}
      {tasks.map(task => (
        <div key={task.id} style={{
          background: 'white', borderRadius: '12px', padding: '14px 16px', marginBottom: '8px',
          borderLeft: `4px solid ${statusColors[task.status] || '#999'}`,
          opacity: task.status === 'completed' ? 0.7 : 1,
        }}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
            <div style={{flex: 1}}>
              <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px'}}>
                <button onClick={() => updateTaskStatus(task.id, task.status === 'completed' ? 'pending' : 'completed')}
                  style={{width: '24px', height: '24px', borderRadius: '6px', border: `2px solid ${statusColors[task.status]}`, background: task.status === 'completed' ? '#4CAF50' : 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'white', fontSize: '14px', padding: 0}}>
                  {task.status === 'completed' ? '✓' : ''}
                </button>
                <span style={{fontSize: '15px', fontWeight: 700, color: 'var(--charcoal)', textDecoration: task.status === 'completed' ? 'line-through' : 'none'}}>{task.title}</span>
              </div>
              {task.description && <p style={{fontSize: '13px', color: 'var(--gray-500)', margin: '4px 0 4px 32px'}}>{task.description}</p>}
              <div style={{display: 'flex', gap: '8px', marginLeft: '32px', flexWrap: 'wrap'}}>
                {task.assigned_to_name && <span style={{fontSize: '12px', background: '#f0ece8', borderRadius: '4px', padding: '2px 8px', fontWeight: 600}}>👤 {task.assigned_to_name}</span>}
                <span style={{fontSize: '12px', color: priorityColors[task.priority], fontWeight: 600}}>{task.priority !== 'normal' ? task.priority.toUpperCase() : ''}</span>
              </div>
            </div>
            {isSupervisor && (
              <div style={{display: 'flex', gap: '4px', flexShrink: 0}}>
                {task.status !== 'completed' && task.status !== 'in_progress' && (
                  <button onClick={() => updateTaskStatus(task.id, 'in_progress')} style={{background: '#48484A', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer'}} title="Start">Start</button>
                )}
                <button onClick={() => deleteTask(task.id)} style={{background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', padding: '4px', color: '#d32f2f'}} title="Delete">✕</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Punch List View
// ============================================================
function PunchListView({ user, embedded }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ title: '', description: '', location: '', priority: 'normal', trade: user.trade || 'Electrical' });
  const [punchAttachments, setPunchAttachments] = useState([]);
  const punchPhotoRef = React.useRef(null);
  const punchGalleryRef = React.useRef(null);
  const punchFileRef = React.useRef(null);
  const [showPunchPhotoChoice, setShowPunchPhotoChoice] = React.useState(false);
  const [filter, setFilter] = useState('open');
  const [stats, setStats] = useState({ open: 0, in_progress: 0, ready_recheck: 0, closed: 0 });
  const [showPunchVoiceRefine, setShowPunchVoiceRefine] = useState(false);
  const personId = user.person_id;
  const isSupervisor = (user.role_level || 1) >= 2;

  useEffect(() => { loadItems(); loadStats(); }, [filter]);

  const loadItems = async () => {
    try {
      const url = user.is_admin ? `/api/punch-list?status=${filter}` : `/api/punch-list/person/${personId}`;
      const res = await fetch(url);
      let data = await res.json();
      if (!user.is_admin && filter !== 'all') data = data.filter(i => i.status === filter);
      setItems(data);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  const loadStats = async () => {
    try {
      const res = await fetch('/api/punch-list/stats');
      setStats(await res.json());
    } catch(e) {}
  };

  const addItem = async () => {
    if (!newItem.title.trim()) return;
    await fetch('/api/punch-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newItem, created_by: personId }),
    });
    setNewItem({ title: '', description: '', location: '', priority: 'normal', trade: user.trade || 'Electrical' });
    setShowAdd(false);
    loadItems();
    loadStats();
  };

  const updateStatus = async (id, status) => {
    const body = { status };
    if (status === 'closed') { body.closed_by = personId; body.closed_at = new Date().toISOString(); }
    await fetch(`/api/punch-list/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    loadItems();
    loadStats();
  };

  const statusColors = { open: '#E6B800', in_progress: '#F99440', ready_recheck: '#48484A', closed: '#4CAF50' };
  const statusLabels = { open: 'Open', in_progress: 'In Progress', ready_recheck: 'Recheck', closed: 'Closed' };
  const priorityIcons = { critical: '🔴', high: '🟠', normal: '', low: '⚪' };


  const handlePunchAttachment = (e, type) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const att = { name: file.name, type };
      if (type === 'photo' && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => { att.preview = ev.target.result; setPunchAttachments(prev => [...prev, att]); };
        reader.readAsDataURL(file);
      } else {
        setPunchAttachments(prev => [...prev, att]);
      }
    });
    e.target.value = '';
  };

  const content = (
    <React.Fragment>
      {/* Header row: title (if standalone) */}
      {!embedded && <h1 style={{fontWeight: 800, marginBottom: '16px'}}>Punch List</h1>}

      {/* Status filters + Add button: same line on tablet+, stacked on phone */}
      <div className="punch-filter-row">
        <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
          {['open', 'in_progress', 'ready_recheck', 'closed'].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{
              padding: '6px 12px', borderRadius: '20px', border: 'none', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
              background: filter === s ? statusColors[s] : 'white',
              color: filter === s ? 'white' : statusColors[s],
              boxShadow: filter === s ? 'none' : `inset 0 0 0 2px ${statusColors[s]}`,
            }}>
              {statusLabels[s]} ({stats[s] || 0})
            </button>
          ))}
        </div>
        <button className="btn btn-primary" style={{padding: '8px 16px', fontWeight: 700, fontSize: '14px', flexShrink: 0}} onClick={() => { setShowAdd(!showAdd); setShowPunchVoiceRefine(true); }}>
          + New
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{background: 'white', border: '2px solid var(--primary)', borderRadius: '12px', padding: '16px', marginBottom: '16px'}}>
          {/* Voice Refine Panel */}
          {showPunchVoiceRefine ? (
            <VoiceRefinePanel
              contextType="punch_item"
              personId={personId}
              defaultVoiceMode={(user.role_level || 1) >= 2 ? 'flow' : 'walkie'}
              onAccept={(fields) => {
                setNewItem(t => ({ ...t, ...fields }));
                setShowPunchVoiceRefine(false);
              }}
              onCancel={() => setShowPunchVoiceRefine(false)}
            />
          ) : (
            <div style={{display: 'flex', justifyContent: 'center', marginTop: '4px', marginBottom: '16px'}}>
              <button onClick={() => setShowPunchVoiceRefine(true)} className="refine-mic-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--primary)" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/></svg>
                Describe the issue
              </button>
            </div>
          )}
          <input type="text" placeholder="What's the issue?..." value={newItem.title} onChange={e => setNewItem(t => ({...t, title: e.target.value}))}
            style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', boxSizing: 'border-box'}} />
          <textarea placeholder="Details..." value={newItem.description} onChange={e => setNewItem(t => ({...t, description: e.target.value}))}
            rows={2} style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', resize: 'none', boxSizing: 'border-box'}} />
          <input type="text" placeholder="Location (e.g., Area 5, JB-501)..." value={newItem.location} onChange={e => setNewItem(t => ({...t, location: e.target.value}))}
            style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', boxSizing: 'border-box'}} />
          <select value={newItem.priority} onChange={e => setNewItem(t => ({...t, priority: e.target.value}))}
            style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', boxSizing: 'border-box'}}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <select value={newItem.trade} onChange={e => setNewItem(t => ({...t, trade: e.target.value}))}
            style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '12px', boxSizing: 'border-box'}}>
            <option value="Electrical">Electrical</option>
            <option value="Instrumentation">Instrumentation</option>
            <option value="Safety">Safety</option>
          </select>
          {/* Attachment previews */}
          <input ref={punchPhotoRef} type="file" accept="image/*" capture="environment" style={{display: 'none'}} onChange={e => handlePunchAttachment(e, 'photo')} />
          <input ref={punchGalleryRef} type="file" accept="image/*" style={{display: 'none'}} onChange={e => handlePunchAttachment(e, 'photo')} />
          <input ref={punchFileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.dwg,.txt" multiple style={{display: 'none'}} onChange={e => handlePunchAttachment(e, 'file')} />
          {punchAttachments.length > 0 && (
            <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px'}}>
              {punchAttachments.map((att, i) => (
                <div key={i} style={{position: 'relative', background: '#f0ece8', borderRadius: '8px', padding: '6px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px'}}>
                  {att.preview ? <img src={att.preview} style={{width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover'}} alt="" /> : <span>📎</span>}
                  <span style={{maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{att.name}</span>
                  <button onClick={() => setPunchAttachments(prev => prev.filter((_, idx) => idx !== i))} style={{background: 'none', border: 'none', color: '#d32f2f', fontSize: '14px', cursor: 'pointer', padding: '0 2px'}}>✕</button>
                </div>
              ))}
            </div>
          )}
          {/* Action row: Photo, File, Form, Add, Cancel */}
          <div style={{display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap'}}>
            <div style={{position: 'relative', flex: 1, minWidth: '80px'}}>
              <button onClick={() => setShowPunchPhotoChoice(!showPunchPhotoChoice)} style={{
                padding: '10px 16px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
                fontSize: '14px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0, minWidth: '18px'}}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Photo
              </button>
              {showPunchPhotoChoice && (
                <React.Fragment>
                  <div onClick={() => setShowPunchPhotoChoice(false)} style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9}} />
                  <div style={{position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px', background: 'white', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 10, overflow: 'hidden', minWidth: '140px'}}>
                    <button onClick={() => { punchPhotoRef.current?.click(); setShowPunchPhotoChoice(false); }} style={{display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #eee'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Camera</span>
                    </button>
                    <button onClick={() => { punchGalleryRef.current?.click(); setShowPunchPhotoChoice(false); }} style={{display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>Gallery</span>
                    </button>
                  </div>
                </React.Fragment>
              )}
            </div>
            <button onClick={() => punchFileRef.current?.click()} style={{
              padding: '10px 16px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
              fontSize: '14px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '80px',
            }}>
              📎 File
            </button>
            <button style={{
              padding: '10px 16px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
              fontSize: '14px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '80px',
            }} onClick={() => alert('Forms coming soon')}>
              📝 Form
            </button>
            <button className="btn btn-primary" style={{padding: '10px 20px', fontWeight: 700, fontSize: '14px'}} onClick={addItem}>Add</button>
            <button className="btn btn-secondary" style={{padding: '10px 20px', fontSize: '14px'}} onClick={() => { setShowAdd(false); setPunchAttachments([]); setShowPunchPhotoChoice(false); }}>Cancel</button>
          </div>
        </div>
      )}

      {loading && <p style={{color: 'var(--gray-500)'}}>Loading...</p>}

      {!loading && items.length === 0 && (
        <div style={{textAlign: 'center', padding: '40px 0', color: 'var(--gray-500)'}}>
          <p style={{fontSize: '16px'}}>No {statusLabels[filter]?.toLowerCase()} punch items</p>
        </div>
      )}

      {/* Items list */}
      {items.map(item => (
        <div key={item.id} style={{
          background: 'white', borderRadius: '12px', padding: '14px 16px', marginBottom: '8px',
          borderLeft: `4px solid ${statusColors[item.status]}`,
        }}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
            <div style={{flex: 1}}>
              <div style={{fontSize: '15px', fontWeight: 700, color: 'var(--charcoal)', marginBottom: '4px'}}>
                {priorityIcons[item.priority]} {item.title}
              </div>
              {item.description && <p style={{fontSize: '13px', color: 'var(--gray-500)', margin: '0 0 6px'}}>{item.description}</p>}
              <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '12px'}}>
                {item.location && <span style={{background: '#f0ece8', borderRadius: '4px', padding: '2px 8px'}}>📍 {item.location}</span>}
                <span style={{background: '#f0ece8', borderRadius: '4px', padding: '2px 8px'}}>{item.trade}</span>
                {item.created_by_name && <span style={{color: 'var(--gray-500)'}}>by {item.created_by_name}</span>}
                {item.assigned_to_name && <span style={{fontWeight: 600}}>→ {item.assigned_to_name}</span>}
              </div>
            </div>
            {/* Status actions */}
            <div style={{display: 'flex', gap: '4px', flexShrink: 0, marginLeft: '8px'}}>
              {item.status === 'open' && <button onClick={() => updateStatus(item.id, 'in_progress')} style={{background: '#F99440', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer'}}>Start</button>}
              {item.status === 'in_progress' && <button onClick={() => updateStatus(item.id, 'ready_recheck')} style={{background: '#48484A', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer'}}>Done</button>}
              {item.status === 'ready_recheck' && isSupervisor && <button onClick={() => updateStatus(item.id, 'closed')} style={{background: '#4CAF50', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer'}}>Close</button>}
              {item.status === 'ready_recheck' && isSupervisor && <button onClick={() => updateStatus(item.id, 'open')} style={{background: '#d32f2f', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer'}}>Reject</button>}
            </div>
          </div>
        </div>
      ))}
    </React.Fragment>
  );

  if (embedded) return content;
  return <div className="list-view">{content}</div>;
}

// ============================================================
// Error Boundary + Mount
// ============================================================
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return React.createElement('div', { style: { padding: 40, textAlign: 'center' } },
        React.createElement('h2', null, 'Something went wrong'),
        React.createElement('p', { style: { color: '#666' } }, String(this.state.error?.message || this.state.error || 'Unknown error')),
        React.createElement('button', {
          onClick: () => { this.setState({ hasError: false }); window.location.reload(); },
          style: { padding: '12px 24px', background: '#F99440', color: 'white', border: 'none', borderRadius: 8, fontSize: 16, marginTop: 16, cursor: 'pointer' }
        }, 'Reload App')
      );
    }
    return this.props.children;
  }
}

// ============================================================
// Safety Hub — Safety tools for everyone
// ============================================================
function SafetyHub({ user, goHome }) {
  const [activeView, setActiveView] = useState(null);
  const [savedFormId, setSavedFormId] = useState(null);

  if (savedFormId) {
    return (
      <div className="forms-hub">
        <div className="form-saved-banner">
          <span className="form-saved-icon">✅</span>
          <h3>Saved Successfully</h3>
          <div className="form-saved-actions">
            <button className="btn-primary" onClick={() => { setSavedFormId(null); setActiveView(null); }}>Back to Safety</button>
            <button className="btn-secondary" onClick={goHome}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  if (activeView === 'observation') {
    return <SafetyObservationForm user={user} onBack={() => setActiveView(null)} onSaved={(id) => setSavedFormId(id)} />;
  }

  if (activeView === 'ppe') {
    return <PPERequestForm user={user} onBack={() => setActiveView(null)} onSaved={(id) => setSavedFormId(id)} />;
  }

  return (
    <div className="forms-hub">
      <h2 className="section-heading">⛑️ Safety</h2>
      <p style={{color: 'var(--gray-500)', marginBottom: '16px', fontSize: '14px'}}>Safety tools, observations, and requests.</p>

      <div className="forms-list">
        <button className="form-card" onClick={() => setActiveView('observation')}>
          <div className="form-card-icon">⛑️</div>
          <div className="form-card-info">
            <span className="form-card-title">Safety Observation</span>
            <span className="form-card-desc">Report safe or at-risk behaviors</span>
          </div>
        </button>
        <button className="form-card" onClick={() => setActiveView('ppe')}>
          <div className="form-card-icon">🥽</div>
          <div className="form-card-info">
            <span className="form-card-title">Request PPE</span>
            <span className="form-card-desc">Request safety equipment</span>
          </div>
        </button>
        <button className="form-card" disabled>
          <div className="form-card-icon">⚠️</div>
          <div className="form-card-info">
            <span className="form-card-title">Report Concern</span>
            <span className="form-card-desc">Flag a safety concern to the safety team</span>
          </div>
          <span className="tile-badge" style={{position:'static', marginLeft:'auto'}}>Soon</span>
        </button>
        <button className="form-card" disabled>
          <div className="form-card-icon">📞</div>
          <div className="form-card-info">
            <span className="form-card-title">Safety Contacts</span>
            <span className="form-card-desc">Emergency numbers and safety team</span>
          </div>
          <span className="tile-badge" style={{position:'static', marginLeft:'auto'}}>Soon</span>
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Forms Hub — List of Available Form Types
// ============================================================
function FormsHub({ user, goHome }) {
  const [activeForm, setActiveForm] = useState(null);
  const [savedFormId, setSavedFormId] = useState(null);

  // Define available forms based on role level
  const ALL_TRADES = ['Electrical', 'Instrumentation', 'Pipe Fitting', 'Industrial Erection', 'Safety'];
  const allForms = [
    { id: 'foreman_daily', title: 'Foreman Daily Report', icon: '📊', description: 'Crew status, work accomplished, materials, safety', minLevel: 2, trades: ['Electrical', 'Instrumentation', 'Pipe Fitting', 'Industrial Erection'] },
    { id: 'safety_observation', title: 'Safety Observation', icon: '⛑️', description: 'BBS observation card — safe/at-risk behaviors', minLevel: 1, trades: ALL_TRADES },
    { id: 'safety_inspection', title: 'Daily Safety Inspection', icon: '🔍', description: 'Area walkthrough checklist', minLevel: 1, trades: ['Safety'] },
    { id: 'incident_report', title: 'Incident / Near-Miss', icon: '⚠️', description: 'Document incidents, near-misses, corrective actions', minLevel: 1, trades: ALL_TRADES },
    { id: 'toolbox_talk', title: 'Toolbox Talk', icon: '🗣️', description: 'Safety meeting documentation with attendance', minLevel: 2, trades: ALL_TRADES },
    { id: 'pre_task_plan', title: 'Pre-Task Plan (PTP)', icon: '📋', description: 'Hazard identification and mitigation for the day', minLevel: 2, trades: ['Electrical', 'Instrumentation', 'Pipe Fitting', 'Industrial Erection'] },
    { id: 'dcr', title: 'Daily Construction Report', icon: '🏗️', description: 'Weather, manpower, work performed, delays', minLevel: 4, trades: ALL_TRADES },
    { id: 'weld_log', title: 'Weld Log / Fit-Up Report', icon: '🔥', description: 'Welds completed, NDE status, fit-up inspections', minLevel: 1, trades: ['Pipe Fitting'] },
    { id: 'hydro_test', title: 'Hydrostatic Test Report', icon: '💧', description: 'Pressure test documentation with readings and hold times', minLevel: 2, trades: ['Pipe Fitting'] },
    { id: 'lift_plan', title: 'Lift Plan / Rigging Report', icon: '🏗️', description: 'Crane lifts, rigging details, equipment set', minLevel: 2, trades: ['Industrial Erection'] },
    { id: 'bolt_torque', title: 'Bolt Torque Report', icon: '🔩', description: 'Flange bolt-up torque documentation', minLevel: 1, trades: ['Pipe Fitting'] },
  ];

  // Filter forms by role level AND trade (admin sees all)
  const userTrade = user.trade || '';
  const availableForms = user.is_admin
    ? allForms
    : allForms.filter(f =>
        (user.role_level || 1) >= f.minLevel &&
        f.trades.includes(userTrade)
      );

  if (savedFormId) {
    return (
      <div className="forms-hub">
        <div className="form-saved-banner">
          <span className="form-saved-icon">✅</span>
          <h3>Form Saved Successfully</h3>
          <p>Your form has been saved to your Office folder.</p>
          <div className="form-saved-actions">
            <button className="btn-primary" onClick={() => { setSavedFormId(null); setActiveForm(null); }}>Back to Forms</button>
            <button className="btn-secondary" onClick={goHome}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  if (activeForm === 'foreman_daily') {
    return <ForemanDailyForm user={user} onBack={() => setActiveForm(null)} onSaved={(id) => setSavedFormId(id)} />;
  }
  if (activeForm === 'safety_observation') {
    return <SafetyObservationForm user={user} onBack={() => setActiveForm(null)} onSaved={(id) => setSavedFormId(id)} />;
  }

  // Forms list
  return (
    <div className="forms-hub">
      <h2 className="section-heading">Forms</h2>
      <p style={{color: 'var(--gray-500)', marginBottom: '16px', fontSize: '14px'}}>Select a form to fill out manually, or use Voice Report for AI-assisted filling.</p>

      <div className="forms-list">
        {availableForms.map(form => (
          <button key={form.id} className="form-card" onClick={() => setActiveForm(form.id)} disabled={!['foreman_daily', 'safety_observation'].includes(form.id)}>
            <div className="form-card-icon">{form.icon}</div>
            <div className="form-card-info">
              <span className="form-card-title">{form.title}</span>
              <span className="form-card-desc">{form.description}</span>
            </div>
            {!['foreman_daily', 'safety_observation'].includes(form.id) && <span className="tile-badge" style={{position:'static', marginLeft:'auto'}}>Soon</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Foreman Daily Report — Manual Fill Form
// ============================================================
function ForemanDailyForm({ user, onBack, onSaved }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    shift: 'Day',
    area: '',
    crew: [{ name: '', craft: '', hours_st: '8', hours_ot: '0' }],
    work_accomplished: '',
    work_quantities: '',
    materials_used: '',
    materials_needed: '',
    equipment_used: '',
    equipment_needed: '',
    ptp_completed: 'Yes',
    toolbox_topic: '',
    safety_observations: '',
    hazards_corrected: '',
    incidents: 'None',
    schedule_notes: '',
    plan_tomorrow: '',
    additional_manpower: '',
  });
  const [saving, setSaving] = useState(false);

  const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const addCrewMember = () => {
    setForm(prev => ({ ...prev, crew: [...prev.crew, { name: '', craft: '', hours_st: '8', hours_ot: '0' }] }));
  };

  const updateCrew = (index, field, value) => {
    setForm(prev => {
      const crew = [...prev.crew];
      crew[index] = { ...crew[index], [field]: value };
      return { ...prev, crew };
    });
  };

  const removeCrew = (index) => {
    if (form.crew.length <= 1) return;
    setForm(prev => ({ ...prev, crew: prev.crew.filter((_, i) => i !== index) }));
  };

  const totalHours = form.crew.reduce((sum, c) => sum + (parseFloat(c.hours_st) || 0) + (parseFloat(c.hours_ot) || 0), 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      const reportData = {
        person_id: user.person_id || 'admin',
        person_name: user.name,
        role_title: user.role_title || 'Administrator',
        form_type: 'foreman_daily',
        form_title: 'Foreman Daily Report',
        form_data: form,
        created_at: new Date().toISOString(),
      };

      const res = await fetch('/api/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData),
      });

      if (res.ok) {
        const result = await res.json();
        onSaved(result.id);
      } else {
        alert('Failed to save form. Please try again.');
      }
    } catch (e) {
      alert('Error saving form: ' + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="form-fill-view">
      <button className="office-back" onClick={onBack}>← Back to Forms</button>
      <h2 className="section-heading">📊 Foreman Daily Report</h2>
      <p className="form-subtitle">{user.name} — {form.date}</p>

      {/* Header */}
      <div className="form-section">
        <h3 className="form-section-title">Report Info</h3>
        <div className="form-row">
          <label className="form-label">
            Date
            <input type="date" className="form-input" value={form.date} onChange={e => updateField('date', e.target.value)} />
          </label>
          <label className="form-label">
            Shift
            <select className="form-input" value={form.shift} onChange={e => updateField('shift', e.target.value)}>
              <option>Day</option>
              <option>Night</option>
              <option>Swing</option>
            </select>
          </label>
        </div>
        <label className="form-label">
          Area / Unit
          <input type="text" className="form-input" placeholder="e.g., Unit 400, Area C" value={form.area} onChange={e => updateField('area', e.target.value)} />
        </label>
      </div>

      {/* Crew */}
      <div className="form-section">
        <h3 className="form-section-title">Crew ({form.crew.length} members — {totalHours} total hours)</h3>
        {form.crew.map((member, i) => (
          <div key={i} className="crew-row">
            <input type="text" className="form-input crew-name" placeholder="Name" value={member.name} onChange={e => updateCrew(i, 'name', e.target.value)} />
            <input type="text" className="form-input crew-craft" placeholder="Craft" value={member.craft} onChange={e => updateCrew(i, 'craft', e.target.value)} />
            <input type="number" className="form-input crew-hours" placeholder="ST" value={member.hours_st} onChange={e => updateCrew(i, 'hours_st', e.target.value)} />
            <input type="number" className="form-input crew-hours" placeholder="OT" value={member.hours_ot} onChange={e => updateCrew(i, 'hours_ot', e.target.value)} />
            {form.crew.length > 1 && <button className="crew-remove" onClick={() => removeCrew(i)}>✕</button>}
          </div>
        ))}
        <button className="btn-add-row" onClick={addCrewMember}>+ Add Crew Member</button>
      </div>

      {/* Work Accomplished */}
      <div className="form-section">
        <h3 className="form-section-title">Work Accomplished</h3>
        <div className="form-label">
          Description of work performed
          <VoiceInput value={form.work_accomplished} onChange={v => updateField('work_accomplished', v)} placeholder="Describe work completed today..." rows={4} />
        </div>
        <label className="form-label">
          Quantities (feet, welds, etc.)
          <input type="text" className="form-input" placeholder="e.g., 200 ft conduit, 15 terminations" value={form.work_quantities} onChange={e => updateField('work_quantities', e.target.value)} />
        </label>
      </div>

      {/* Materials */}
      <div className="form-section">
        <h3 className="form-section-title">Materials</h3>
        <div className="form-label">
          Materials used today
          <VoiceInput value={form.materials_used} onChange={v => updateField('materials_used', v)} placeholder="List materials consumed..." rows={2} />
        </div>
        <div className="form-label">
          Materials needed for tomorrow
          <VoiceInput value={form.materials_needed} onChange={v => updateField('materials_needed', v)} placeholder="Pre-staging requests..." rows={2} />
        </div>
      </div>

      {/* Equipment */}
      <div className="form-section">
        <h3 className="form-section-title">Equipment</h3>
        <label className="form-label">
          Equipment used
          <input type="text" className="form-input" placeholder="e.g., Boom lift 60ft, Megger" value={form.equipment_used} onChange={e => updateField('equipment_used', e.target.value)} />
        </label>
        <label className="form-label">
          Equipment needed for tomorrow
          <input type="text" className="form-input" placeholder="Request equipment..." value={form.equipment_needed} onChange={e => updateField('equipment_needed', e.target.value)} />
        </label>
      </div>

      {/* Safety */}
      <div className="form-section">
        <h3 className="form-section-title">Safety</h3>
        <div className="form-row">
          <label className="form-label">
            PTP Completed?
            <select className="form-input" value={form.ptp_completed} onChange={e => updateField('ptp_completed', e.target.value)}>
              <option>Yes</option>
              <option>No</option>
            </select>
          </label>
          <label className="form-label">
            Toolbox Talk Topic
            <input type="text" className="form-input" placeholder="Today's safety topic" value={form.toolbox_topic} onChange={e => updateField('toolbox_topic', e.target.value)} />
          </label>
        </div>
        <div className="form-label">
          Safety Observations
          <VoiceInput value={form.safety_observations} onChange={v => updateField('safety_observations', v)} placeholder="Positive and at-risk observations..." rows={2} />
        </div>
        <div className="form-label">
          Hazards Identified & Corrected
          <VoiceInput value={form.hazards_corrected} onChange={v => updateField('hazards_corrected', v)} placeholder="Any hazards found and fixed..." rows={2} />
        </div>
        <label className="form-label">
          Incidents / Near-Misses
          <input type="text" className="form-input" value={form.incidents} onChange={e => updateField('incidents', e.target.value)} />
        </label>
      </div>

      {/* Schedule */}
      <div className="form-section">
        <h3 className="form-section-title">Schedule & Planning</h3>
        <div className="form-label">
          Schedule Notes / Constraints
          <VoiceInput value={form.schedule_notes} onChange={v => updateField('schedule_notes', v)} placeholder="Delays, coordination needs, hold points..." rows={2} />
        </div>
        <div className="form-label">
          Plan for Tomorrow
          <VoiceInput value={form.plan_tomorrow} onChange={v => updateField('plan_tomorrow', v)} placeholder="Work planned, prerequisites, requests..." rows={3} />
        </div>
        <label className="form-label">
          Additional Manpower Request
          <input type="text" className="form-input" placeholder="e.g., Need 2 more journeyman electricians" value={form.additional_manpower} onChange={e => updateField('additional_manpower', e.target.value)} />
        </label>
      </div>

      {/* Submit */}
      <button className="btn-primary btn-full" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save Report'}
      </button>
    </div>
  );
}

// ============================================================
// Safety Observation Form — BBS Card
// ============================================================
function SafetyObservationForm({ user, onBack, onSaved }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    location: '',
    observation_type: 'Planned',
    category: '',
    safe_behaviors: '',
    at_risk_behaviors: '',
    corrective_action: '',
    follow_up_required: 'No',
    persons_observed_craft: '',
    supervisor_notified: 'No',
    severity: 'Low',
    additional_notes: '',
  });
  const [saving, setSaving] = useState(false);

  const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const categories = [
    'PPE Compliance',
    'Body Position / Line of Fire',
    'Tools & Equipment',
    'Housekeeping',
    'Fall Protection',
    'Scaffolding',
    'Electrical Safety',
    'Confined Space',
    'Hot Work',
    'Excavation / Trenching',
    'Crane / Rigging',
    'Chemical / Hazmat',
    'Fire Protection',
    'Procedures / Permits',
    'Communication',
    'Other',
  ];

  const handleSave = async () => {
    setSaving(true);
    try {
      const reportData = {
        person_id: user.person_id || 'admin',
        person_name: user.name,
        role_title: user.role_title || 'Administrator',
        form_type: 'safety_observation',
        form_title: 'Safety Observation Card',
        form_data: form,
        created_at: new Date().toISOString(),
      };

      const res = await fetch('/api/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData),
      });

      if (res.ok) {
        const result = await res.json();
        onSaved(result.id);
      } else {
        alert('Failed to save form.');
      }
    } catch (e) {
      alert('Error saving: ' + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="form-fill-view">
      <button className="office-back" onClick={onBack}>← Back to Forms</button>
      <h2 className="section-heading">⛑️ Safety Observation Card</h2>
      <p className="form-subtitle">{user.name} — {form.date}</p>

      {/* Header */}
      <div className="form-section">
        <h3 className="form-section-title">Observation Info</h3>
        <div className="form-row">
          <label className="form-label">
            Date
            <input type="date" className="form-input" value={form.date} onChange={e => updateField('date', e.target.value)} />
          </label>
          <label className="form-label">
            Time
            <input type="time" className="form-input" value={form.time} onChange={e => updateField('time', e.target.value)} />
          </label>
        </div>
        <label className="form-label">
          Location / Area
          <input type="text" className="form-input" placeholder="e.g., Unit 400, Level 2" value={form.location} onChange={e => updateField('location', e.target.value)} />
        </label>
        <div className="form-row">
          <label className="form-label">
            Type
            <select className="form-input" value={form.observation_type} onChange={e => updateField('observation_type', e.target.value)}>
              <option>Planned</option>
              <option>Unplanned</option>
            </select>
          </label>
          <label className="form-label">
            Potential Severity
            <select className="form-input" value={form.severity} onChange={e => updateField('severity', e.target.value)}>
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
            </select>
          </label>
        </div>
      </div>

      {/* Category */}
      <div className="form-section">
        <h3 className="form-section-title">Category</h3>
        <div className="category-grid">
          {categories.map(cat => (
            <button key={cat} className={`category-chip ${form.category === cat ? 'chip-active' : ''}`} onClick={() => updateField('category', cat)}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Observations */}
      <div className="form-section">
        <h3 className="form-section-title">Observations</h3>
        <div className="form-label">
          ✅ Safe Behaviors Observed
          <VoiceInput value={form.safe_behaviors} onChange={v => updateField('safe_behaviors', v)} placeholder="Describe positive/safe behaviors observed..." rows={3} />
        </div>
        <div className="form-label">
          ⚠️ At-Risk Behaviors Observed
          <VoiceInput value={form.at_risk_behaviors} onChange={v => updateField('at_risk_behaviors', v)} placeholder="Describe at-risk or unsafe behaviors observed..." rows={3} />
        </div>
      </div>

      {/* Actions */}
      <div className="form-section">
        <h3 className="form-section-title">Corrective Actions</h3>
        <label className="form-label">
          Immediate Corrective Action Taken
          <VoiceInput value={form.corrective_action} onChange={v => updateField('corrective_action', v)} placeholder="What was done to correct the issue..." rows={2} />
        </label>
        <div className="form-row">
          <label className="form-label">
            Follow-Up Required?
            <select className="form-input" value={form.follow_up_required} onChange={e => updateField('follow_up_required', e.target.value)}>
              <option>No</option>
              <option>Yes</option>
            </select>
          </label>
          <label className="form-label">
            Supervisor Notified?
            <select className="form-input" value={form.supervisor_notified} onChange={e => updateField('supervisor_notified', e.target.value)}>
              <option>No</option>
              <option>Yes</option>
            </select>
          </label>
        </div>
        <label className="form-label">
          Craft / Trade of Person(s) Observed
          <input type="text" className="form-input" placeholder="e.g., Electrician, Pipefitter" value={form.persons_observed_craft} onChange={e => updateField('persons_observed_craft', e.target.value)} />
        </label>
      </div>

      {/* Notes */}
      <div className="form-section">
        <h3 className="form-section-title">Additional Notes</h3>
        <VoiceInput value={form.additional_notes} onChange={v => updateField('additional_notes', v)} placeholder="Any additional observations or context..." rows={3} />
      </div>

      {/* Submit */}
      <button className="btn-primary btn-full" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save Observation'}
      </button>
    </div>
  );
}

// ============================================================
// Error Boundary (keep at bottom)
// ============================================================

ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(ErrorBoundary, null, React.createElement(App))
);
