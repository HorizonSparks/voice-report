/**
 * PeopleListSection Component
 * Renders the grouped people list with category bubbles.
 * Extracted from PeopleView.jsx — purely presentational.
 */
import { useTranslation } from 'react-i18next';
import { Box, Typography, Button } from '@mui/material';

// Role group definitions by trade
const ROLE_GROUPS_BY_TRADE = {
  Electrical: [
    { level: 0, labelKey: 'people.helpers' },
    { level: 1, labelKey: 'people.journeymen' },
    { level: 2, labelKey: 'people.foremen' },
    { level: 3, labelKey: 'people.generalForemen' },
    { level: 4, labelKey: 'people.superintendents' },
    { level: 5, label: 'Project Management' },
    { level: -1, label: 'Other' },
  ],
  Instrumentation: [
    { level: 0, label: 'Junior Techs' },
    { level: 1, label: 'Instrument Techs' },
    { level: 2, label: 'Senior Techs' },
    { level: 3, label: 'Instrument Leads' },
    { level: 4, label: 'Instrument Supervisors' },
    { level: 5, label: 'Project Management' },
    { level: -1, label: 'Other' },
  ],
  'Pipe Fitting': [
    { level: 0, label: 'Helpers' },
    { level: 1, label: 'Journeymen' },
    { level: 2, label: 'Foremen' },
    { level: 3, label: 'General Foremen' },
    { level: 4, label: 'Superintendents' },
    { level: 5, label: 'Project Management' },
    { level: -1, label: 'Other' },
  ],
  'Industrial Erection': [
    { level: 0, label: 'Helpers' },
    { level: 1, label: 'Journeymen' },
    { level: 2, label: 'Foremen' },
    { level: 3, label: 'General Foremen' },
    { level: 4, label: 'Superintendents' },
    { level: 5, label: 'Project Management' },
    { level: -1, label: 'Other' },
  ],
  Safety: [
    { level: 2, label: 'Safety Coordinators' },
    { level: 3, label: 'Safety Officers' },
    { level: 4, label: 'HSE Managers' },
    { level: 5, label: 'Site Safety Directors' },
    { level: -1, label: 'Other' },
  ],
  Millwright: [
    { level: 0, label: 'Millwright Helpers' },
    { level: 1, label: 'Journeyman Millwrights' },
    { level: 2, label: 'Millwright Foremen' },
    { level: 3, label: 'Millwright General Foremen' },
    { level: 4, label: 'Millwright Superintendents' },
    { level: 5, label: 'Project Management' },
    { level: -1, label: 'Other' },
  ],
};

export default function PeopleListSection({
  user, activeTrade, activeRoleLevels, people, templates,
  expandedCategory, setExpandedCategory,
  onSelectPerson, onCreatePerson,
}) {
  const { t } = useTranslation();
  const isAdmin = user && user.is_admin;
  const isSupervisor = user && parseInt(user.role_level || 0) >= 2;

  // No trade selected = show nothing
  if (!activeTrade) {
    return (
      <Box className="list-view">
        <Typography sx={{ color: 'text.primary', fontSize: '15px', textAlign: 'center', padding: '40px 20px' }}>
          Select a trade to view people.
        </Typography>
      </Box>
    );
  }

  // Filter by active trade
  const filteredPeople = people.filter(p => {
    const tmpl = templates.find(tp => tp.id === p.template_id);
    return tmpl && tmpl.trade === activeTrade;
  });

  // Build role groups with translated labels
  const rawGroups = ROLE_GROUPS_BY_TRADE[activeTrade] || ROLE_GROUPS_BY_TRADE.Electrical;
  const roleGroups = rawGroups.map(g => ({
    ...g,
    label: g.labelKey ? t(g.labelKey) : g.label,
  }));

  const sortedPeople = [...filteredPeople].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const getLevelForPerson = (p) => {
    const tmpl = templates.find(tp => tp.id === p.template_id);
    if (tmpl && tmpl.id && tmpl.id.includes('other')) return -1;
    return parseInt(p.role_level) || 0;
  };

  const renderPersonCard = (p) => {
    const tmpl = templates.find(tp => tp.id === p.template_id);
    const trade = tmpl ? tmpl.trade : '';
    const tradeIcon = trade === 'Safety' ? '⛑️' : trade === 'Electrical' ? '⚡' : trade === 'Instrumentation' ? '🔧' : trade === 'Pipe Fitting' ? '🔩' : trade === 'Industrial Erection' ? '🏗️' : '';
    return (
      <Button key={p.id} className="report-card" onClick={() => onSelectPerson(p.id)} sx={{ mb: '6px' }}>
        <Box className="report-card-header">
          <Typography component="span" className="report-date" sx={{ fontWeight: 700 }}>{tradeIcon} {p.name}</Typography>
          <Typography component="span" className={`status-pill ${p.status}`}>{p.status}</Typography>
        </Box>
        <Box className="report-preview">
          {p.role_title} — PIN: {p.pin}
          {p.supervisor_id && (() => {
            const sup = people.find(s => s.id === p.supervisor_id);
            return sup ? <Typography component="span" sx={{ color: 'text.primary', ml: '8px' }}>→ {sup.name}</Typography> : null;
          })()}
          {!p.supervisor_id && parseInt(p.role_level || 0) <= 1 && <Typography component="span" sx={{ color: 'primary.main', ml: '8px', fontSize: '12px' }}>⚠ Unassigned</Typography>}
        </Box>
      </Button>
    );
  };

  // Expanded category full-screen view — grouped by supervisor
  if (expandedCategory !== null) {
    const group = roleGroups.find(g => g.level === expandedCategory);
    const groupPeople = sortedPeople.filter(p => getLevelForPerson(p) === expandedCategory);

    const bySupervisor = {};
    const supervisorOrder = [];
    groupPeople.forEach(p => {
      const supId = p.supervisor_id || '_unassigned';
      if (!bySupervisor[supId]) { bySupervisor[supId] = []; supervisorOrder.push(supId); }
      bySupervisor[supId].push(p);
    });

    return (
      <Box className="list-view">
        <Box className="admin-header-row">
          <Typography variant="h1">{group?.label} <Box component="span" sx={{ color: 'primary.main', fontSize: '24px' }}>({groupPeople.length})</Box></Typography>
          <Button className="btn btn-primary" variant="contained" sx={{ fontSize: '14px', padding: '10px 20px' }} onClick={onCreatePerson}>+ Add Person</Button>
        </Box>
        {groupPeople.length === 0 ? (
          <Typography sx={{ color: 'text.primary', fontSize: '14px', py: '20px' }}>No {group?.label?.toLowerCase()} yet.</Typography>
        ) : supervisorOrder.map(supId => {
          const sup = people.find(s => s.id === supId);
          const supName = sup ? sup.name : 'Unassigned';
          const supRole = sup ? sup.role_title : '';
          const members = bySupervisor[supId];
          return (
            <Box key={supId} sx={{ mb: '20px' }}>
              <Box sx={{ bgcolor: 'secondary.main', color: 'primary.main', padding: '10px 18px', borderRadius: '10px 10px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography component="span" sx={{ fontWeight: 700, fontSize: '15px' }}>{supName}</Typography>
                  {supRole && <Typography component="span" sx={{ fontSize: '12px', color: 'var(--gray-400)', ml: '8px' }}>{supRole}</Typography>}
                </Box>
                <Typography component="span" sx={{ fontSize: '13px', color: 'var(--gray-400)' }}>{members.length}</Typography>
              </Box>
              <Box sx={{ border: '2px solid', borderColor: 'grey.200', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '8px 12px' }}>
                {members.map(renderPersonCard)}
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  }

  // Main list view with category bubbles
  // Filter by active role levels — unchecked levels don't show as bubbles
  const configuredLevels = activeRoleLevels && activeRoleLevels[activeTrade];
  const visibleGroups = roleGroups
    .filter(group => {
      // If admin configured specific levels for this trade, hide unchecked ones
      if (configuredLevels && group.level !== -1 && !configuredLevels.includes(group.level)) {
        return false;
      }
      if (!isAdmin) {
        const gp = sortedPeople.filter(p => getLevelForPerson(p) === group.level);
        return gp.length > 0;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.level === -1) return 1;
      if (b.level === -1) return -1;
      if (a.level === 1 && b.level !== 1) return -1;
      if (b.level === 1 && a.level !== 1) return 1;
      if (a.level === 0 && b.level !== 0) return -1;
      if (b.level === 0 && a.level !== 0) return 1;
      return a.level - b.level;
    });

  return (
    <Box className="list-view">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '24px' }}>
        <Typography variant="h1" sx={{ m: 0 }}>{t('people.title')}</Typography>
        {(isAdmin || isSupervisor) && (
          <Button onClick={onCreatePerson} sx={{
            padding: '8px 16px', bgcolor: 'primary.main', color: 'secondary.main',
            border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap',
            '&:hover': { bgcolor: 'primary.dark' },
          }}>+ {t('people.addPerson')}</Button>
        )}
      </Box>

      <Box className="people-grid">
        {visibleGroups.map(group => {
          const groupPeople = sortedPeople.filter(p => getLevelForPerson(p) === group.level);
          return (
            <Box key={group.level} className="people-category-bubble">
              <Box className="people-category-header">
                <Box component="span" className="people-category-title" onClick={() => setExpandedCategory(group.level)} sx={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, cursor: 'pointer' }}>
                  <Typography component="span" className="people-category-label">{group.label}</Typography>
                  <Typography component="span" className="people-category-count">{groupPeople.length}</Typography>
                </Box>
                <Button className="people-add-btn" onClick={(e) => { e.stopPropagation(); onCreatePerson(); }}>+</Button>
              </Box>
              <Box className="people-category-body" sx={{ maxHeight: '280px', overflowY: 'auto' }}>
                {groupPeople.length === 0 ? (
                  <Typography sx={{ color: 'var(--gray-400)', fontSize: '13px', py: '8px', m: 0 }}>No {group.label.toLowerCase()} yet</Typography>
                ) : groupPeople.map(renderPersonCard)}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
