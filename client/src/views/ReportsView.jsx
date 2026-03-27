import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

export default forwardRef(function ReportsView({ user, onOpenReport, reportsPersonId, setReportsPersonId, activeTrade, onNavigate }, ref) {
  const { t } = useTranslation();
  const [people, setPeople] = useState([]);
  const [allReports, setAllReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('category'); // category, timeline
  const [expandedFolders, setExpandedFolders] = useState({});
  const [selectedCategory, setSelectedCategory] = useState(null); // role level for full-screen category view

  // Expose tryGoBack so app-level Back clears sub-views first
  useImperativeHandle(ref, () => ({
    tryGoBack: () => {
      if (selectedCategory !== null) { setSelectedCategory(null); return true; }
      return false;
    }
  }));

  useEffect(() => { loadReports(); }, []);

  const loadReports = async () => {
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
    } catch (e) { console.error('Failed to load reports:', e); }
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
          <span style={{fontSize: '12px', color: 'var(--charcoal)'}}>{sd.main} · {sd.sub}</span>
        </div>
        <div className="report-preview">
          <span style={{color: 'var(--primary)', fontSize: '12px', marginRight: '6px'}}>{person?.role_title || ''}</span>
          {(report.preview || report.transcript_raw || '').substring(0, 60)}...
        </div>
      </button>
    );
  };

  if (loading) return <div className="loading">{t('common.loading')}</div>;

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
    if (key === 'this_week') return t('reports.thisWeek');
    if (key === 'last_week') return t('reports.lastWeek');
    if (key === 'two_weeks_ago') return t('reports.twoWeeksAgo');
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
    const group = isMineCategory ? { label: t('reports.myReports') } : roleGroups.find(g => g.level === selectedCategory);
    const groupPeople = isMineCategory
      ? people.filter(p => p.id === user.person_id)
      : people.filter(p => (parseInt(p.role_level) || 0) === selectedCategory && p.id !== user.person_id).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const groupReports = allReports.filter(r => groupPeople.some(p => p.id === r.person_id));

    return (
      <div className="office-view">
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
                  <p style={{color: 'var(--gray-400)', fontSize: '13px', margin: 0}}>{t('reports.noReports')}</p>
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
    if (key === 'this_week') return t('reports.thisWeek');
    if (key === 'last_week') return t('reports.lastWeek');
    if (key === 'two_weeks_ago') return t('reports.twoWeeksAgo');
    if (key.startsWith('month_')) {
      const parts = key.split('_');
      const d = new Date(parseInt(parts[1]), parseInt(parts[2]), 1);
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    return key;
  };

  return (
    <div className="office-view">
      <h2 className="office-title" style={{fontWeight: 800}}>{t('reports.title')}</h2>

      {/* Voice Report button */}
      <div style={{textAlign: 'center', marginBottom: '20px'}}>
        <button
          onClick={() => onNavigate && onNavigate('record')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '10px 20px',
            background: 'white', border: '2px solid var(--charcoal)',
            borderRadius: '10px', cursor: 'pointer',
            fontSize: '16px', fontWeight: 700, color: 'var(--primary)'
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--primary)">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
          {t('reports.voiceReport')}
        </button>
      </div>

      {/* Tab switcher */}
      <div style={{display: 'flex', gap: '0', marginBottom: '20px', border: '2px solid var(--charcoal)', borderRadius: '10px', overflow: 'hidden', maxWidth: '400px', margin: '0 auto 20px'}}>
        <button onClick={() => setTab('category')} style={{flex: 1, padding: '14px 8px', border: 'none', fontSize: '20px', fontWeight: 700, cursor: 'pointer', background: tab === 'category' ? 'var(--charcoal)' : 'white', color: 'var(--primary)', whiteSpace: 'nowrap'}}>{t('reports.category')}</button>
        <button onClick={() => setTab('timeline')} style={{flex: 1, padding: '14px 8px', border: 'none', fontSize: '20px', fontWeight: 700, cursor: 'pointer', background: tab === 'timeline' ? 'var(--charcoal)' : 'white', color: 'var(--primary)', borderLeft: '2px solid var(--charcoal)', whiteSpace: 'nowrap'}}>{t('reports.timeline')}</button>
      </div>

      {/* CATEGORY VIEW — bubbles navigate to full-screen */}
      {tab === 'category' && (
        <div className="people-grid">
          {/* My Reports — for non-admin, shown first in the grid */}
          {!user.is_admin && (() => {
            const myReports = allReports.filter(r => r.person_id === user.person_id);
            if (myReports.length === 0) return null;
            const sorted = [...myReports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            const preview = sorted.slice(0, 4);
            return (
              <div className="people-category-bubble">
                <div className="people-category-header" onClick={() => setSelectedCategory('mine')} style={{cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px'}}>
                  <span className="people-category-label" style={{flex: 1}}>{t('reports.myReports')}</span>
                  <span className="people-category-count">{myReports.length}</span>
                  <span style={{fontSize: '14px'}}>▶</span>
                </div>
                {preview.length > 0 && (
                  <div className="people-category-body" style={{maxHeight: '220px', overflowY: 'auto'}}>
                    {preview.map(r => {
                      const sd = formatSmartDate(r.created_at);
                      return (
                        <div key={r.id} className="report-card" style={{marginBottom: '4px', cursor: 'pointer', padding: '8px 10px', borderBottom: '1px solid #f0f0f0'}} onClick={() => onOpenReport && onOpenReport(r.id)}>
                          <div style={{fontSize: '13px', color: 'var(--charcoal)'}}>{sd.main} · {sd.sub}</div>
                          <div style={{fontSize: '13px', color: 'var(--charcoal)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{(r.transcript_raw || r.structured_report || '').substring(0, 60)}...</div>
                        </div>
                      );
                    })}
                    {myReports.length > 4 && <div style={{fontSize: '13px', color: 'var(--primary)', textAlign: 'center', padding: '6px', cursor: 'pointer'}} onClick={() => setSelectedCategory('mine')}>+{myReports.length - 4} more</div>}
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
            const sorted = [...groupReports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            const preview = sorted.slice(0, 4);
            return (
              <div key={group.level} className="people-category-bubble">
                <div className="people-category-header" onClick={() => setSelectedCategory(group.level)} style={{cursor: 'pointer'}}>
                  <span className="people-category-label">{group.label}</span>
                  <span className="people-category-count">{groupReports.length}</span>
                  <span style={{fontSize: '14px', marginLeft: '4px'}}>▶</span>
                </div>
                {preview.length > 0 && (
                  <div className="people-category-body" style={{maxHeight: '220px', overflowY: 'auto'}}>
                    {preview.map(r => {
                      const person = groupPeople.find(p => p.id === r.person_id);
                      const sd = formatSmartDate(r.created_at);
                      return (
                        <div key={r.id} className="report-card" style={{marginBottom: '4px', cursor: 'pointer', padding: '8px 10px', borderBottom: '1px solid #f0f0f0'}} onClick={() => onOpenReport && onOpenReport(r.id)}>
                          <div style={{display: 'flex', justifyContent: 'space-between'}}>
                            <span style={{fontSize: '13px', fontWeight: 600, color: 'var(--charcoal)'}}>{person?.name || 'Unknown'}</span>
                            <span style={{fontSize: '12px', color: 'var(--charcoal)'}}>{sd.main}</span>
                          </div>
                          <div style={{fontSize: '13px', color: 'var(--charcoal)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{(r.transcript_raw || r.structured_report || '').substring(0, 50)}...</div>
                        </div>
                      );
                    })}
                    {groupReports.length > 4 && <div style={{fontSize: '13px', color: 'var(--primary)', textAlign: 'center', padding: '6px', cursor: 'pointer'}} onClick={() => setSelectedCategory(group.level)}>+{groupReports.length - 4} more</div>}
                  </div>
                )}
              </div>
            );
          })}
          {allReports.length === 0 && <p className="office-empty">{t('reports.getStarted')}</p>}
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

            if (groupOrder.length === 0) return <p className="office-empty">{t('reports.noReports')}</p>;

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
})
