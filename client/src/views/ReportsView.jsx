import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography, Button, Paper, CircularProgress } from '@mui/material';

export default forwardRef(function ReportsView({ user, onOpenReport, reportsPersonId, setReportsPersonId, activeTrade, onNavigate, readOnly = false }, ref) {
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
      <Button
        key={report.id}
        className="report-card"
        sx={{ mb: '6px', width: '100%', textAlign: 'left', textTransform: 'none', justifyContent: 'flex-start', display: 'block' }}
        onClick={() => onOpenReport(report.id)}
      >
        <Box className="report-card-header">
          <Typography component="span" className="report-date" sx={{ fontWeight: 700 }}>{person?.name || 'Unknown'}</Typography>
          <Typography component="span" sx={{ fontSize: '12px', color: 'text.primary' }}>{sd.main} · {sd.sub}</Typography>
        </Box>
        <Box className="report-preview">
          <Typography component="span" sx={{ color: 'primary.main', fontSize: '12px', mr: '6px' }}>{person?.role_title || ''}</Typography>
          {(report.preview || report.transcript_raw || '').substring(0, 60)}...
        </Box>
      </Button>
    );
  };

  if (loading) return (
    <Box className="loading" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress />
      <Typography sx={{ ml: 2 }}>{t('common.loading')}</Typography>
    </Box>
  );

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
  const roleGroups = activeTrade ? (roleGroupsByTrade[activeTrade] || roleGroupsByTrade.Electrical) : [];

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
      <Box className="office-view">
        <Typography variant="h2" className="office-title" sx={{ mb: '20px' }}>
          {group?.label} <Typography component="span" sx={{ color: 'primary.main', fontSize: '20px' }}>({groupReports.length} reports)</Typography>
        </Typography>

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
            <Box key={person.id} sx={{ mb: '24px' }}>
              <Box sx={{ background: 'var(--charcoal)', color: 'primary.main', p: '12px 18px', borderRadius: '10px 10px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography component="span" sx={{ fontWeight: 700, fontSize: '16px' }}>{person.name}</Typography>
                <Typography component="span" sx={{ fontSize: '13px', color: 'grey.400' }}>{personReports.length} reports</Typography>
              </Box>
              <Box sx={{ border: '2px solid', borderColor: 'grey.200', borderTop: 'none', borderRadius: '0 0 10px 10px', p: '12px 14px' }}>
                {personReports.length === 0 ? (
                  <Typography sx={{ color: 'grey.400', fontSize: '13px', m: 0 }}>{t('reports.noReports')}</Typography>
                ) : groupOrder.map(key => {
                  const isThisWeek = key === 'this_week';
                  const folderKey = 'oc_' + person.id + '_' + key;
                  const isOpen = isThisWeek || expandedFolders[folderKey];
                  return (
                    <Box key={key} sx={{ mb: '8px' }}>
                      <Box
                        onClick={() => !isThisWeek && toggleFolder(folderKey)}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: '8px', p: '8px 10px',
                          background: isThisWeek ? 'transparent' : 'grey.100',
                          borderRadius: isThisWeek ? 0 : '8px',
                          cursor: isThisWeek ? 'default' : 'pointer',
                          fontWeight: 600, fontSize: '14px', color: 'text.primary',
                          borderBottom: isThisWeek ? '2px solid' : 'none',
                          borderBottomColor: isThisWeek ? 'primary.main' : undefined,
                        }}
                      >
                        {!isThisWeek && <Typography component="span" sx={{ fontSize: '13px' }}>📁</Typography>}
                        <Typography component="span" sx={{ flex: 1 }}>{getWeekLabel2(key)}</Typography>
                        <Typography component="span" sx={{ fontSize: '12px', color: 'primary.main', fontWeight: 600 }}>{groups[key].length}</Typography>
                        {!isThisWeek && <Typography component="span" sx={{ fontSize: '11px' }}>{isOpen ? '▼' : '▶'}</Typography>}
                      </Box>
                      {isOpen && (
                        <Box sx={{ p: isThisWeek ? '4px 0' : '4px 8px' }}>
                          {groups[key].map(renderReportCard)}
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Box>
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
    <Box className="office-view">
      <Typography variant="h2" className="office-title" sx={{ fontWeight: 800 }}>{t('reports.title')}</Typography>

      {/* Voice Report button — hidden in read-only contexts (Sparks operator
          simulating a customer company) since recording would attribute audio
          to the wrong person and is intentionally non-functional there. */}
      {!readOnly && onNavigate && (
        <Box sx={{ textAlign: 'center', mb: '20px' }}>
          <Button
            onClick={() => onNavigate('record')}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              p: '10px 20px',
              background: 'white', border: '2px solid var(--charcoal)',
              borderRadius: '10px', cursor: 'pointer',
              fontSize: '16px', fontWeight: 700, color: 'primary.main',
              textTransform: 'none',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--primary)">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
            {t('reports.voiceReport')}
          </Button>
        </Box>
      )}

      {/* Tab switcher */}
      <Box sx={{ display: 'flex', gap: '0', mb: '20px', border: '2px solid var(--charcoal)', borderRadius: '10px', overflow: 'hidden', maxWidth: '400px', margin: '0 auto 20px' }}>
        <Button onClick={() => setTab('category')} sx={{ flex: 1, p: '14px 8px', border: 'none', fontSize: '20px', fontWeight: 700, cursor: 'pointer', background: tab === 'category' ? 'var(--charcoal)' : 'white', color: 'primary.main', whiteSpace: 'nowrap', textTransform: 'none', borderRadius: 0 }}>{t('reports.category')}</Button>
        <Button onClick={() => setTab('timeline')} sx={{ flex: 1, p: '14px 8px', border: 'none', fontSize: '20px', fontWeight: 700, cursor: 'pointer', background: tab === 'timeline' ? 'var(--charcoal)' : 'white', color: 'primary.main', borderLeft: '2px solid var(--charcoal)', whiteSpace: 'nowrap', textTransform: 'none', borderRadius: 0 }}>{t('reports.timeline')}</Button>
      </Box>

      {/* CATEGORY VIEW — bubbles navigate to full-screen */}
      {tab === 'category' && (
        <Box className="people-grid">
          {/* My Reports — for non-admin, shown first in the grid */}
          {!user.is_admin && (() => {
            const myReports = allReports.filter(r => r.person_id === user.person_id);
            if (myReports.length === 0) return null;
            const sorted = [...myReports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            const preview = sorted.slice(0, 4);
            return (
              <Paper className="people-category-bubble" elevation={0}>
                <Box className="people-category-header" onClick={() => setSelectedCategory('mine')} sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Typography component="span" className="people-category-label" sx={{ flex: 1 }}>{t('reports.myReports')}</Typography>
                  <Typography component="span" className="people-category-count">{myReports.length}</Typography>
                  <Typography component="span" sx={{ fontSize: '14px' }}>▶</Typography>
                </Box>
                {preview.length > 0 && (
                  <Box className="people-category-body" sx={{ maxHeight: '220px', overflowY: 'auto' }}>
                    {preview.map(r => {
                      const sd = formatSmartDate(r.created_at);
                      return (
                        <Box key={r.id} className="report-card" sx={{ mb: '4px', cursor: 'pointer', p: '8px 10px', borderBottom: '1px solid #f0f0f0' }} onClick={() => onOpenReport && onOpenReport(r.id)}>
                          <Typography sx={{ fontSize: '13px', color: 'text.primary' }}>{sd.main} · {sd.sub}</Typography>
                          <Typography sx={{ fontSize: '13px', color: 'text.primary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(r.transcript_raw || r.structured_report || '').substring(0, 60)}...</Typography>
                        </Box>
                      );
                    })}
                    {myReports.length > 4 && <Typography sx={{ fontSize: '13px', color: 'primary.main', textAlign: 'center', p: '6px', cursor: 'pointer' }} onClick={() => setSelectedCategory('mine')}>+{myReports.length - 4} more</Typography>}
                  </Box>
                )}
              </Paper>
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
              <Paper key={group.level} className="people-category-bubble" elevation={0}>
                <Box className="people-category-header" onClick={() => setSelectedCategory(group.level)} sx={{ cursor: 'pointer' }}>
                  <Typography component="span" className="people-category-label">{group.label}</Typography>
                  <Typography component="span" className="people-category-count">{groupReports.length}</Typography>
                  <Typography component="span" sx={{ fontSize: '14px', ml: '4px' }}>▶</Typography>
                </Box>
                {preview.length > 0 && (
                  <Box className="people-category-body" sx={{ maxHeight: '220px', overflowY: 'auto' }}>
                    {preview.map(r => {
                      const person = groupPeople.find(p => p.id === r.person_id);
                      const sd = formatSmartDate(r.created_at);
                      return (
                        <Box key={r.id} className="report-card" sx={{ mb: '4px', cursor: 'pointer', p: '8px 10px', borderBottom: '1px solid #f0f0f0' }} onClick={() => onOpenReport && onOpenReport(r.id)}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography component="span" sx={{ fontSize: '13px', fontWeight: 600, color: 'text.primary' }}>{person?.name || 'Unknown'}</Typography>
                            <Typography component="span" sx={{ fontSize: '12px', color: 'text.primary' }}>{sd.main}</Typography>
                          </Box>
                          <Typography sx={{ fontSize: '13px', color: 'text.primary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(r.transcript_raw || r.structured_report || '').substring(0, 50)}...</Typography>
                        </Box>
                      );
                    })}
                    {groupReports.length > 4 && <Typography sx={{ fontSize: '13px', color: 'primary.main', textAlign: 'center', p: '6px', cursor: 'pointer' }} onClick={() => setSelectedCategory(group.level)}>+{groupReports.length - 4} more</Typography>}
                  </Box>
                )}
              </Paper>
            );
          })}
          {allReports.length === 0 && <Typography className="office-empty">{t('reports.getStarted')}</Typography>}
        </Box>
      )}

      {/* TIMELINE VIEW */}
      {tab === 'timeline' && (
        <Box>
          {(() => {
            // Group reports by week/month
            const groups = {};
            const groupOrder = [];
            allReports.forEach(r => {
              const key = getWeekKey(r.created_at);
              if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
              groups[key].push(r);
            });

            if (groupOrder.length === 0) return <Typography className="office-empty">{t('reports.noReports')}</Typography>;

            return groupOrder.map(key => {
              const isThisWeek = key === 'this_week';
              const isOpen = isThisWeek || expandedFolders['tl_' + key];
              return (
                <Box key={key} sx={{ mb: '16px' }}>
                  <Box
                    onClick={() => !isThisWeek && toggleFolder('tl_' + key)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: '10px', p: '12px 16px',
                      background: isThisWeek ? 'transparent' : 'grey.100',
                      borderRadius: isThisWeek ? 0 : '10px',
                      cursor: isThisWeek ? 'default' : 'pointer',
                      fontWeight: 700, fontSize: '16px', color: 'text.primary',
                      borderBottom: isThisWeek ? '2px solid' : 'none',
                      borderBottomColor: isThisWeek ? 'primary.main' : undefined,
                    }}
                  >
                    {!isThisWeek && <Typography component="span">📁</Typography>}
                    <Typography component="span" sx={{ flex: 1 }}>{getWeekLabel(key)}</Typography>
                    <Typography component="span" sx={{ fontSize: '13px', color: 'primary.main', fontWeight: 600 }}>{groups[key].length} report{groups[key].length !== 1 ? 's' : ''}</Typography>
                    {!isThisWeek && <Typography component="span" sx={{ fontSize: '12px' }}>{isOpen ? '▼' : '▶'}</Typography>}
                  </Box>
                  {isOpen && (
                    <Box sx={{ p: isThisWeek ? '8px 0' : '8px 16px' }}>
                      {groups[key].map(renderReportCard)}
                    </Box>
                  )}
                </Box>
              );
            });
          })()}
        </Box>
      )}
    </Box>
  );
})
