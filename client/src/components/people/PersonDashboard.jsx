/**
 * PersonDashboard Component
 * Renders the selected person's dashboard view.
 * Extracted from PeopleView.jsx — purely presentational.
 *
 * No fetching inside — receives all data and callbacks as props.
 */
import { useTranslation } from 'react-i18next';
import { Box, Typography, Button, Chip } from '@mui/material';

// Smart date formatting

function formatSmartDate(dateStr) {
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
}

const STATUS_COLORS = { pending: '#F99440', in_progress: '#48484A', completed: '#4CAF50', cancelled: '#999' };
const PRIORITY_COLORS = { critical: '#C45500', high: '#F99440', normal: '#48484A', low: '#999' };

export default function PersonDashboard({
  user, person, reports, tasks, people,
  expandedPersonSection, setExpandedPersonSection,
  onOpenReport, onOpenTask, onEditPerson, onDeletePerson,
  onAssignTask, onViewPerson, onCreatePerson,
}) {
  const { t } = useTranslation();
  const isAdmin = user && user.is_admin;
  const isSupervisor = user && parseInt(user.role_level || 0) >= 2;
  const roleLevel = parseInt(person.role_level || 1);
  const teamMembers = people.filter(p => p.supervisor_id === person.id);
  const supervisor = person.supervisor_id ? people.find(p => p.id === person.supervisor_id) : null;
  const statusLabels = { pending: t('jsa.pending'), in_progress: t('punchList.inProgress'), completed: t('common.done') };
  const activeTasks = tasks.filter(tk => tk.status === 'in_progress' || tk.status === 'pending');
  const completedTasks = tasks.filter(tk => tk.status === 'completed');

  // Expanded tasks full-page view
  if (expandedPersonSection === 'tasks') {
    return (
      <Box className="list-view">
        <Typography variant="h1" sx={{ mb: '6px' }}>{t('common.activeTasks')} <Box component="span" sx={{ color: 'primary.main', fontSize: '24px' }}>({activeTasks.length})</Box></Typography>
        <Typography sx={{ color: 'text.primary', fontSize: '14px', mb: '16px' }}>{person.name} — {person.role_title}</Typography>
        {activeTasks.length === 0 ? (
          <Typography sx={{ color: 'text.primary', fontSize: '14px', py: '20px' }}>{t('common.noActiveTasks')}.</Typography>
        ) : activeTasks.map(task => (
          <Box key={task.id} onClick={() => onOpenTask(task.id)} sx={{
            background: 'white', borderRadius: '12px', padding: '14px 16px', mb: '8px',
            borderLeft: `5px solid ${STATUS_COLORS[task.status] || '#999'}`, cursor: 'pointer',
          }}>
            <Typography sx={{ fontWeight: 700, fontSize: '15px', color: 'text.primary', mb: '4px' }}>{task.title}</Typography>
            {task.description && <Typography sx={{ fontSize: '13px', color: 'text.primary', lineHeight: 1.3, mb: '6px' }}>{task.description}</Typography>}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <Chip label={statusLabels[task.status]} size="small" sx={{ fontSize: '11px', fontWeight: 700, color: 'white', bgcolor: STATUS_COLORS[task.status] }} />
              {task.priority && task.priority !== 'normal' && <Typography component="span" sx={{ fontSize: '11px', fontWeight: 700, color: PRIORITY_COLORS[task.priority], textTransform: 'uppercase' }}>{task.priority}</Typography>}
              {task.jsa_status && (
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: task.jsa_status === 'no_jsa' ? '#999' : task.jsa_status === 'mismatch' ? '#E8922A' : '#4CAF50' }}>
                  <Box component="span" sx={{ width: '8px', height: '8px', borderRadius: '50%', background: task.jsa_status === 'match' || task.jsa_status === 'has_jsa' ? '#4CAF50' : task.jsa_status === 'mismatch' ? '#E8922A' : '#ccc' }} />
                  {task.jsa_status === 'no_jsa' ? t('jsa.statusNone') : task.jsa_status === 'mismatch' ? t('jsa.statusMismatch') : 'JSA ✓'}
                </Box>
              )}
            </Box>
          </Box>
        ))}
        {completedTasks.length > 0 && (
          <>
            <Typography variant="h2" sx={{ fontSize: '18px', fontWeight: 700, color: 'text.primary', mt: '20px', mb: '12px' }}>{t('common.completed')} <Box component="span" sx={{ color: '#4CAF50', fontSize: '14px' }}>({completedTasks.length})</Box></Typography>
            {completedTasks.map(task => (
              <Box key={task.id} onClick={() => onOpenTask(task.id)} sx={{
                background: 'white', borderRadius: '10px', padding: '10px 14px', mb: '6px',
                borderLeft: '4px solid #4CAF50', cursor: 'pointer', opacity: 0.85,
              }}>
                <Typography sx={{ fontWeight: 700, fontSize: '14px', color: 'text.primary' }}>{task.title}</Typography>
                <Typography component="span" sx={{ fontSize: '11px', color: '#4CAF50', fontWeight: 700 }}>{t('common.completed')}</Typography>
                {task.completed_at && <Typography component="span" sx={{ fontSize: '11px', color: 'text.primary', ml: '8px' }}>{new Date(task.completed_at).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}</Typography>}
              </Box>
            ))}
          </>
        )}
      </Box>
    );
  }

  // Expanded reports full-page view
  if (expandedPersonSection === 'reports') {
    const sorted = [...reports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return (
      <Box className="list-view">
        <Typography variant="h1" sx={{ mb: '6px' }}>Reports <Box component="span" sx={{ color: 'primary.main', fontSize: '24px' }}>({reports.length})</Box></Typography>
        <Typography sx={{ color: 'text.primary', fontSize: '14px', mb: '16px' }}>{person.name} — {person.role_title}</Typography>
        {sorted.length === 0 ? (
          <Typography sx={{ color: 'text.primary', fontSize: '14px', py: '20px' }}>{t('common.noReportsYet')}</Typography>
        ) : sorted.map(r => {
          const sd = formatSmartDate(r.created_at);
          return (
            <Button key={r.id} className="report-card" sx={{ mb: '6px', cursor: 'pointer', width: '100%', textAlign: 'left' }} onClick={() => onOpenReport(r.id)}>
              <Box className="report-card-header">
                <Typography component="span" className="report-date">{sd.main}</Typography>
                <Typography component="span" sx={{ fontSize: '12px', color: 'text.primary' }}>{sd.sub}</Typography>
              </Box>
              <Box className="report-preview">{(r.preview || r.transcript_raw || '').substring(0, 80)}...</Box>
            </Button>
          );
        })}
      </Box>
    );
  }

  // Main dashboard view
  return (
    <Box className="list-view">
      {/* Person header */}
      <Box sx={{ textAlign: 'center', mb: '20px' }}>
        {person.photo && (
          <img src={`/api/photos/${person.photo}`} style={{width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--primary)', marginBottom: '8px'}} alt="" />
        )}
        <Typography variant="h1" sx={{ m: '4px 0', fontSize: '24px' }}>{person.name}</Typography>
        <Typography sx={{ color: 'primary.main', fontWeight: 600, fontSize: '18px', m: '4px 0' }}>{person.role_title}</Typography>
        {supervisor && <Typography sx={{ color: 'text.primary', fontSize: '14px', m: '4px 0' }}>Reports to: {supervisor.name}</Typography>}
        <Typography sx={{ color: 'text.primary', fontSize: '13px' }}>PIN: {person.pin}</Typography>
      </Box>

      {/* Quick stats */}
      <Box sx={{ display: 'flex', gap: '10px', mb: '12px', justifyContent: 'center' }}>
        <Box sx={{ background: 'white', border: '2px solid', borderColor: 'primary.main', borderRadius: '12px', padding: '10px 24px', textAlign: 'center', cursor: reports.length > 0 ? 'pointer' : 'default', minWidth: '100px' }} onClick={() => { if (reports.length > 0) setExpandedPersonSection('reports'); }}>
          <Typography sx={{ fontSize: '22px', fontWeight: 700, color: 'text.primary' }}>{reports.length}</Typography>
          <Typography sx={{ fontSize: '12px', color: 'text.primary', fontWeight: 600 }}>Reports</Typography>
        </Box>
        {roleLevel >= 2 && (
          <Box sx={{ background: 'white', border: '2px solid', borderColor: 'primary.main', borderRadius: '12px', padding: '10px 24px', textAlign: 'center', minWidth: '100px' }}>
            <Typography sx={{ fontSize: '22px', fontWeight: 700, color: 'text.primary' }}>{teamMembers.length}</Typography>
            <Typography sx={{ fontSize: '12px', color: 'text.primary', fontWeight: 600 }}>Team</Typography>
          </Box>
        )}
      </Box>

      {/* Assign Task */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: '20px' }}>
        <Button onClick={() => onAssignTask(person)} sx={{
          padding: '10px 28px', bgcolor: 'secondary.main', color: 'primary.main',
          border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 700, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          '&:hover': { bgcolor: 'secondary.dark' },
        }}>
          {t('people.assignTask')}
        </Button>
      </Box>

      {/* Active Tasks + Reports — side by side */}
      <Box className="people-grid">
        {/* Active Tasks bubble */}
        <Box className="people-category-bubble">
          <Box className="people-category-header">
            <Box component="span" className="people-category-title" onClick={() => setExpandedPersonSection('tasks')} sx={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, cursor: 'pointer' }}>
              <Typography component="span" className="people-category-label">{t('common.activeTasks')}</Typography>
              <Typography component="span" className="people-category-count">{activeTasks.length}</Typography>
            </Box>
            <Typography component="span" onClick={() => setExpandedPersonSection('tasks')} sx={{ fontSize: '14px', color: 'white', cursor: 'pointer' }}>▶</Typography>
          </Box>
          <Box className="people-category-body" sx={{ maxHeight: '280px', overflowY: 'auto' }}>
            {activeTasks.length === 0 ? (
              <Typography sx={{ color: 'var(--gray-400)', fontSize: '13px', py: '8px', m: 0 }}>{t('common.noActiveTasks')}</Typography>
            ) : activeTasks.slice(0, 4).map(task => (
              <Box key={task.id} onClick={() => onOpenTask(task.id)} sx={{
                background: 'white', borderRadius: '8px', padding: '10px 12px', mb: '6px',
                borderLeft: `4px solid ${STATUS_COLORS[task.status] || '#999'}`, cursor: 'pointer',
                borderBottom: '1px solid #f0f0f0',
              }}>
                <Typography sx={{ fontWeight: 700, fontSize: '14px', color: 'text.primary' }}>{task.title}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mt: '4px' }}>
                  <Chip label={statusLabels[task.status]} size="small" sx={{ px: '6px', fontSize: '10px', fontWeight: 700, color: 'white', bgcolor: STATUS_COLORS[task.status] }} />
                  {task.priority && task.priority !== 'normal' && <Typography component="span" sx={{ fontSize: '10px', fontWeight: 700, color: PRIORITY_COLORS[task.priority], textTransform: 'uppercase' }}>{task.priority}</Typography>}
                </Box>
              </Box>
            ))}
            {activeTasks.length > 4 && (
              <Typography onClick={() => setExpandedPersonSection('tasks')} sx={{ fontSize: '13px', color: 'primary.main', textAlign: 'center', padding: '8px', cursor: 'pointer', fontWeight: 600 }}>
                +{activeTasks.length - 4} more
              </Typography>
            )}
          </Box>
        </Box>

        {/* Reports bubble */}
        <Box className="people-category-bubble">
          <Box className="people-category-header">
            <Box component="span" className="people-category-title" onClick={() => setExpandedPersonSection('reports')} sx={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, cursor: 'pointer' }}>
              <Typography component="span" className="people-category-label">Reports</Typography>
              <Typography component="span" className="people-category-count">{reports.length}</Typography>
            </Box>
            <Typography component="span" onClick={() => setExpandedPersonSection('reports')} sx={{ fontSize: '14px', color: 'white', cursor: 'pointer' }}>▶</Typography>
          </Box>
          <Box className="people-category-body" sx={{ maxHeight: '280px', overflowY: 'auto' }}>
            {reports.length === 0 ? (
              <Typography sx={{ color: 'var(--gray-400)', fontSize: '13px', py: '8px', m: 0 }}>No reports yet</Typography>
            ) : (() => {
              const sorted = [...reports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
              return sorted.slice(0, 4).map(r => {
                const sd = formatSmartDate(r.created_at);
                return (
                  <Button key={r.id} className="report-card" sx={{ mb: '6px', cursor: 'pointer', width: '100%', textAlign: 'left' }} onClick={() => onOpenReport(r.id)}>
                    <Box className="report-card-header">
                      <Typography component="span" className="report-date">{sd.main}</Typography>
                      <Typography component="span" sx={{ fontSize: '12px', color: 'text.primary' }}>{sd.sub}</Typography>
                    </Box>
                    <Box className="report-preview">{(r.preview || r.transcript_raw || '').substring(0, 80)}...</Box>
                  </Button>
                );
              });
            })()}
            {reports.length > 4 && (
              <Typography onClick={() => setExpandedPersonSection('reports')} sx={{ fontSize: '13px', color: 'primary.main', textAlign: 'center', padding: '8px', cursor: 'pointer', fontWeight: 600 }}>
                +{reports.length - 4} more
              </Typography>
            )}
          </Box>
        </Box>
      </Box>

      {/* Team section */}
      {roleLevel >= 2 && (
        <Box sx={{ mb: '20px' }}>
          <Typography variant="h2" sx={{ fontSize: '22px', mb: '12px', color: 'text.primary', fontWeight: 700 }}>Team</Typography>
          {teamMembers.length === 0 ? (
            <Typography sx={{ color: 'text.primary', fontSize: '14px' }}>{t('common.noTeamMembers')}</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {teamMembers.map(tm => (
                <Button key={tm.id} onClick={() => onViewPerson(tm.id)} sx={{
                  background: 'white', border: '2px solid', borderColor: 'grey.200',
                  borderRadius: '10px', padding: '10px 16px', cursor: 'pointer', textAlign: 'left',
                  minWidth: '140px', flex: '1 1 calc(33.33% - 8px)', maxWidth: 'calc(50% - 4px)',
                  transition: 'border-color 0.15s',
                  '&:hover': { borderColor: 'primary.main' },
                }}>
                  <Box>
                    <Typography sx={{ fontWeight: 700, fontSize: '14px', color: 'text.primary' }}>{tm.name}</Typography>
                    <Typography sx={{ fontSize: '12px', color: 'text.primary' }}>{tm.role_title}</Typography>
                  </Box>
                </Button>
              ))}
            </Box>
          )}
          <Button className="btn btn-secondary" sx={{ mt: '8px', fontSize: '13px', padding: '8px 16px' }} onClick={() => onCreatePerson ? onCreatePerson() : onEditPerson()}>
            + Assign Team Member
          </Button>
        </Box>
      )}

      {/* Edit/Delete */}
      {(isAdmin || isSupervisor) && (
        <Box sx={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', mt: '16px' }}>
          {isAdmin && (
            <Button onClick={onDeletePerson} sx={{ padding: '10px 24px', fontSize: '14px', fontWeight: 700, border: '2px solid #999', borderRadius: '8px', background: 'white', color: 'text.primary', cursor: 'pointer' }}>Delete</Button>
          )}
          <Button className="btn btn-primary" variant="contained" sx={{ padding: '10px 24px', fontSize: '14px' }} onClick={onEditPerson}>Edit</Button>
        </Box>
      )}
    </Box>
  );
}
