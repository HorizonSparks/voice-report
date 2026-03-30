import { useState, useEffect, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceRefinePanel from '../components/VoiceRefinePanel.jsx';
import PunchListView from './PunchListView.jsx';
import {
  Box, Typography, Button, TextField, Paper, CircularProgress,
  Select, MenuItem, Checkbox, LinearProgress, IconButton,
  Dialog, DialogContent, DialogActions
} from '@mui/material';

export default function DailyPlanView({ user, initialTab, onNavigate, goBack, readOnly }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(initialTab || 'plan'); // 'plan' or 'punch'
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', assigned_to: [], priority: 'normal' });
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const [taskAttachments, setTaskAttachments] = useState([]); // [{name, type, preview}]
  const taskPhotoRef = useRef(null);
  const taskGalleryRef = useRef(null);
  const taskFileRef = useRef(null);
  const [showTaskPhotoChoice, setShowTaskPhotoChoice] = useState(false);
  const [team, setTeam] = useState([]);
  const [viewMode, setViewMode] = useState('active'); // 'active' or 'date'
  const [jsaStatuses, setJsaStatuses] = useState({}); // { personId: { status, jsa_id, jsa_number } }
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [assignOnlyMode, setAssignOnlyMode] = useState(false); // true when came from Assign Task button
  const [assignPersonName, setAssignPersonName] = useState('');
  const [selectedBubble, setSelectedBubble] = useState(null); // person id for expanded bubble view
  const [dialogConfig, setDialogConfig] = useState(null);

  const showConfirmDialog = (message, onConfirm) => setDialogConfig({ message, onConfirm, showCancel: true });

  const isSupervisor = (user.role_level || 1) >= 2;
  const personId = user.person_id;

  // Check if we came from "Assign Task" button with a pre-selected person
  useEffect(() => {
    try {
      const preAssign = sessionStorage.getItem('preAssignPerson');
      if (preAssign) {
        const person = JSON.parse(preAssign);
        sessionStorage.removeItem('preAssignPerson');
        setNewTask(t => ({ ...t, assigned_to: [person.id] }));
        setShowAddTask(true);
        setAssignOnlyMode(true);
        setAssignPersonName(person.name || '');
      }
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => { loadTasks(); loadTeam(); }, [selectedDate, viewMode]);

  const loadTasks = async () => {
    setLoading(true);
    try {
      let url;
      if (viewMode === 'date') {
        url = isSupervisor
          ? `/api/daily-plans/${personId}?date=${selectedDate}`
          : `/api/daily-plans/my-tasks/${personId}?date=${selectedDate}`;
      } else {
        // 'active' or 'all' — both use active endpoint, 'all' shows completed too
        url = `/api/tasks/active/${personId}${viewMode === 'all' ? '?include_completed=true' : ''}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      if (viewMode === 'date') {
        setTasks(isSupervisor ? (data.tasks || []) : data);
      } else {
        setTasks(Array.isArray(data) ? data : []);
      }
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

  // Load JSA statuses when assign dropdown opens
  useEffect(() => {
    if (showAssignDropdown && team.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      fetch('/api/jsa/status/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person_ids: team.map(p => p.id),
          date: today,
          task_title: newTask.title || '',
          task_description: newTask.description || '',
        }),
      })
        .then(r => r.json())
        .then(data => setJsaStatuses(data))
        .catch(() => {});
    }
  }, [showAssignDropdown, team.length]);

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
    setNewTask({ title: '', description: '', assigned_to: [], priority: 'normal' });
    setShowAssignDropdown(false);
    setTaskAttachments([]);
    setShowAddTask(false);
    if (assignOnlyMode && goBack) { goBack(); return; }
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

  const deleteTask = (taskId) => {
    showConfirmDialog(t('common.deleteConfirm'), async () => {
      await fetch(`/api/daily-plans/tasks/${taskId}`, { method: 'DELETE' });
      loadTasks();
    });
  };

  const statusColors = { pending: '#F99440', in_progress: '#48484A', completed: '#4CAF50', cancelled: '#999' };
  const statusLabels = { pending: t('jsa.pending'), in_progress: t('punchList.inProgress'), completed: t('common.done'), cancelled: t('common.cancel') };
  const priorityColors = { critical: '#C45500', high: '#F99440', normal: 'var(--charcoal)', low: '#999' };

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const totalCount = tasks.length;

  // Helper to render the assign dropdown content (reused in both assign-only and main form)
  const renderAssignDropdown = () => (
    <Box sx={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '2px solid #ccc', borderRadius: '8px', mt: '4px', zIndex: 10, maxHeight: '250px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
      {team.map(p => {
        const isChecked = newTask.assigned_to.includes(p.id);
        return (
          <Box
            component="label"
            key={p.id}
            sx={{ display: 'flex', alignItems: 'center', gap: '10px', p: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontSize: '14px', fontWeight: 600, background: isChecked ? '#f9f5f0' : 'white' }}
          >
            <Checkbox
              checked={isChecked}
              onChange={() => {
                setNewTask(t => ({ ...t, assigned_to: isChecked ? t.assigned_to.filter(id => id !== p.id) : [...t.assigned_to, p.id] }));
              }}
              sx={{ width: '20px', height: '20px', flexShrink: 0, color: 'primary.main', '&.Mui-checked': { color: 'primary.main' }, p: 0 }}
            />
            <Typography component="span">{p.name}</Typography>
            <Typography component="span" sx={{ fontSize: '12px', color: 'text.primary', ml: 'auto' }}>{p.role_title}</Typography>
            {jsaStatuses[p.id] && (
              <Box
                component="span"
                sx={{
                  width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
                  background: jsaStatuses[p.id].status === 'match' ? 'success.main'
                    : jsaStatuses[p.id].status === 'has_jsa' ? 'success.main'
                    : jsaStatuses[p.id].status === 'mismatch' ? '#E8922A'
                    : 'grey.400',
                }}
                title={jsaStatuses[p.id].status === 'no_jsa' ? 'No JSA' : jsaStatuses[p.id].jsa_number || 'JSA'}
              />
            )}
          </Box>
        );
      })}
      <Button
        onClick={() => setShowAssignDropdown(false)}
        sx={{ width: '100%', p: '10px', border: 'none', background: 'var(--charcoal)', color: 'primary.main', fontSize: '14px', fontWeight: 700, cursor: 'pointer', borderRadius: '0 0 6px 6px', textTransform: 'none', '&:hover': { background: 'var(--charcoal)' } }}
      >
        {t('common.done')}
      </Button>
    </Box>
  );

  // Helper to render the task form fields (reused in both assign-only and main form)
  const renderTaskForm = () => (
    <>
      {/* Voice Refine Panel */}
      {showVoiceRefine ? (
        <VoiceRefinePanel
          contextType="daily_task"
          teamContext={team.map(p => `${p.name} (${p.id})`).join(', ')}
          personId={personId}
          defaultVoiceMode={(user.role_level || 1) >= 2 ? 'flow' : 'walkie'}
          autoStart
          onAccept={(fields) => {
            setNewTask(t => {
              const updated = { ...t, ...fields };
              // Preserve pre-assigned person + merge any AI-suggested people
              if (t.assigned_to && t.assigned_to.length > 0) {
                const aiAssigned = Array.isArray(fields.assigned_to) ? fields.assigned_to : [];
                updated.assigned_to = [...new Set([...t.assigned_to, ...aiAssigned])];
              }
              return updated;
            });
            setShowVoiceRefine(false);
          }}
          onCancel={() => setShowVoiceRefine(false)}
        />
      ) : (
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: '12px' }}>
          <Button onClick={() => setShowVoiceRefine(true)} className="refine-mic-btn" sx={{ textTransform: 'none' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--primary)" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/></svg>
            {t('dailyPlan.speakTask')}
          </Button>
        </Box>
      )}
      <TextField
        placeholder={t('dailyPlan.taskTitle')}
        value={newTask.title}
        onChange={e => setNewTask(t => ({ ...t, title: e.target.value }))}
        fullWidth
        size="small"
        sx={{ mb: '8px', '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '15px', color: 'text.primary' }, '& .MuiOutlinedInput-notchedOutline': { borderWidth: '2px', borderColor: 'grey.400' } }}
      />
      <TextField
        placeholder={t('dailyPlan.description')}
        value={newTask.description}
        onChange={e => setNewTask(t => ({ ...t, description: e.target.value }))}
        multiline
        rows={2}
        fullWidth
        size="small"
        sx={{ mb: '8px', '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '15px', color: 'text.primary', resize: 'none' }, '& .MuiOutlinedInput-notchedOutline': { borderWidth: '2px', borderColor: 'grey.400' } }}
      />
      <Box sx={{ display: 'flex', gap: '8px', mb: '12px' }}>
        {/* Assign To dropdown */}
        <Box sx={{ flex: 3, position: 'relative' }}>
          <Button
            type="button"
            onClick={() => setShowAssignDropdown(!showAssignDropdown)}
            sx={{
              width: '100%', p: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px',
              color: newTask.assigned_to.length ? 'text.primary' : 'grey.500',
              boxSizing: 'border-box', minHeight: '48px', background: 'white', textAlign: 'left', cursor: 'pointer',
              fontWeight: newTask.assigned_to.length ? 700 : 400, textTransform: 'none', justifyContent: 'flex-start',
              '&:hover': { background: 'white' },
            }}
          >
            {newTask.assigned_to.length ? team.filter(p => newTask.assigned_to.includes(p.id)).map(p => p.name).join(', ') : t('dailyPlan.assignTo')}
          </Button>
          {showAssignDropdown && renderAssignDropdown()}
        </Box>
        {/* Priority */}
        <Select
          value={newTask.priority}
          onChange={e => setNewTask(t => ({ ...t, priority: e.target.value }))}
          sx={{ flex: 0, width: '110px', borderRadius: '8px', fontSize: '15px', color: 'text.primary', boxSizing: 'border-box', minHeight: '48px', '& .MuiOutlinedInput-notchedOutline': { borderWidth: '2px', borderColor: 'grey.400' } }}
        >
          <MenuItem value="normal">{t('dailyPlan.normal')}</MenuItem>
          <MenuItem value="low">{t('dailyPlan.low')}</MenuItem>
          <MenuItem value="high">{t('dailyPlan.high')}</MenuItem>
          <MenuItem value="critical">{t('dailyPlan.critical')}</MenuItem>
        </Select>
      </Box>
    </>
  );

  // If in assign-only mode (came from person profile), show ONLY the task form
  if (assignOnlyMode) {
    return (
      <Box className="list-view">
        <Typography variant="h1" sx={{ fontWeight: 800, fontSize: '22px', mb: '6px' }}>Assign Task</Typography>
        {assignPersonName && (
          <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'primary.main', mb: '16px' }}>
            To: {assignPersonName}
          </Typography>
        )}
        <Paper sx={{ border: '2px solid var(--primary)', borderRadius: '12px', p: '16px' }}>
          {renderTaskForm()}
          <Box sx={{ display: 'flex', gap: '10px' }}>
            <Button className="btn btn-secondary" sx={{ p: '12px 20px', fontSize: '15px', flex: 1, textTransform: 'none' }} onClick={() => { if (goBack) goBack(); }}>{t('common.cancel')}</Button>
            <Button className="btn btn-primary" sx={{ p: '12px 20px', fontWeight: 700, fontSize: '15px', flex: 1, textTransform: 'none' }} onClick={addTask}>{t('dailyPlan.add')}</Button>
          </Box>
        </Paper>
      </Box>
    );
  }

  // If punch tab is active, render PunchListView
  if (activeTab === 'punch') {
    return (
      <Box className="list-view">
        <Box sx={{ display: 'flex', gap: '0', mb: '28px', border: '2px solid var(--charcoal)', borderRadius: '10px', overflow: 'hidden', maxWidth: '400px', margin: '0 auto 28px' }}>
          <Button onClick={() => setActiveTab('plan')} sx={{ flex: 1, p: '14px 8px', border: 'none', fontSize: '20px', fontWeight: 700, cursor: 'pointer', background: 'white', color: 'primary.main', whiteSpace: 'nowrap', textTransform: 'none', '&:hover': { background: 'white' } }}>{t('dailyPlan.title')}</Button>
          <Button sx={{ flex: 1, p: '14px 8px', border: 'none', fontSize: '20px', fontWeight: 700, background: 'var(--charcoal)', color: 'primary.main', borderLeft: '2px solid var(--charcoal)', whiteSpace: 'nowrap', textTransform: 'none', '&:hover': { background: 'var(--charcoal)' } }}>{t('dailyPlan.punchList')}</Button>
        </Box>
        <PunchListView user={user} embedded={true} onNavigate={onNavigate} />
      </Box>
    );
  }

  return (
    <Box className="list-view">
      {/* Tab switcher */}
      <Box sx={{ display: 'flex', gap: '0', mb: '28px', border: '2px solid var(--charcoal)', borderRadius: '10px', overflow: 'hidden', maxWidth: '400px', margin: '0 auto 28px' }}>
        <Button sx={{ flex: 1, p: '14px 8px', border: 'none', fontSize: '20px', fontWeight: 700, background: 'var(--charcoal)', color: 'primary.main', whiteSpace: 'nowrap', textTransform: 'none', '&:hover': { background: 'var(--charcoal)' } }}>{t('dailyPlan.title')}</Button>
        <Button onClick={() => setActiveTab('punch')} sx={{ flex: 1, p: '14px 8px', border: 'none', fontSize: '20px', fontWeight: 700, cursor: 'pointer', background: 'white', color: 'primary.main', borderLeft: '2px solid var(--charcoal)', whiteSpace: 'nowrap', textTransform: 'none', '&:hover': { background: 'white' } }}>{t('dailyPlan.punchList')}</Button>
      </Box>

      {/* Tasks header: title + active toggle + search/date + add button */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '16px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Typography variant="h1" sx={{ fontWeight: 800, m: 0, fontSize: '20px' }}>{t('dailyPlan.tasks')}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Date -- always visible, charcoal color */}
          <Typography component="span" sx={{ fontSize: '15px', fontWeight: 600, color: 'text.primary' }}>
            {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </Typography>
          {/* Calendar icon -- opens date picker directly */}
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <IconButton
              onClick={() => {
                const dateInput = document.getElementById('task-date-picker');
                if (dateInput) { dateInput.showPicker ? dateInput.showPicker() : dateInput.click(); }
              }}
              sx={{
                width: '36px', height: '36px', borderRadius: '8px', border: '2px solid #ccc', background: 'white',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 0,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </IconButton>
            <input id="task-date-picker" type="date" value={selectedDate} onChange={e => { setSelectedDate(e.target.value); setViewMode('date'); }}
              style={{ position: 'absolute', top: 0, left: 0, width: '36px', height: '36px', opacity: 0, cursor: 'pointer' }} />
          </Box>
          {!showAddTask && (
            <Button className="btn btn-primary" sx={{ p: '8px 16px', fontWeight: 700, fontSize: '14px', textTransform: 'none' }} onClick={() => { setShowAddTask(true); setShowVoiceRefine(false); }}>
              {t('dailyPlan.addTask')}
            </Button>
          )}
        </Box>
      </Box>

      {/* Progress bar */}
      {totalCount > 0 && (
        <LinearProgress
          variant="determinate"
          value={completedCount / totalCount * 100}
          sx={{ height: '6px', borderRadius: '3px', mb: '16px', backgroundColor: '#e0e0e0', '& .MuiLinearProgress-bar': { backgroundColor: 'success.main', borderRadius: '3px', transition: 'width 0.3s' } }}
        />
      )}

      {/* Add task form */}
      {showAddTask && (
        <Paper sx={{ border: '2px solid var(--primary)', borderRadius: '12px', p: '16px', mb: '16px' }}>
          {renderTaskForm()}
          {/* Attachment previews */}
          <input ref={taskPhotoRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => handleTaskAttachment(e, 'photo')} />
          <input ref={taskGalleryRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleTaskAttachment(e, 'photo')} />
          <input ref={taskFileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.dwg,.txt" multiple style={{ display: 'none' }} onChange={e => handleTaskAttachment(e, 'file')} />
          {taskAttachments.length > 0 && (
            <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', mb: '12px' }}>
              {taskAttachments.map((att, i) => (
                <Box key={i} sx={{ position: 'relative', background: '#f0ece8', borderRadius: '8px', p: '6px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {att.preview ? <Box component="img" src={att.preview} sx={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover' }} alt="" /> : <Typography component="span">{'\u{1F4CE}'}</Typography>}
                  <Typography component="span" sx={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</Typography>
                  <Button onClick={() => removeAttachment(i)} sx={{ background: 'none', border: 'none', color: 'text.primary', fontSize: '14px', cursor: 'pointer', p: '0 2px', minWidth: 'auto', textTransform: 'none' }}>{'\u2715'}</Button>
                </Box>
              ))}
            </Box>
          )}

          {/* Attachments row: Photo, File, Form */}
          <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center', mb: '10px', flexWrap: 'wrap' }}>
            <Box sx={{ position: 'relative', flex: 1, minWidth: '80px' }}>
              <Button
                onClick={() => setShowTaskPhotoChoice(!showTaskPhotoChoice)}
                sx={{
                  p: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
                  fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
                  textTransform: 'none', '&:hover': { background: 'white' },
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, minWidth: '18px' }}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                {t('common.photo')}
              </Button>
              {showTaskPhotoChoice && (
                <Fragment>
                  <Box onClick={() => setShowTaskPhotoChoice(false)} sx={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9 }} />
                  <Paper sx={{ position: 'absolute', bottom: '100%', left: 0, mb: '4px', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 10, overflow: 'hidden', minWidth: '140px' }}>
                    <Button
                      onClick={() => { taskPhotoRef.current?.click(); setShowTaskPhotoChoice(false); }}
                      sx={{ display: 'block', width: '100%', p: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #eee', textTransform: 'none', '&:hover': { background: '#f5f5f5' } }}
                    >
                      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>{t('common.camera')}</Box>
                    </Button>
                    <Button
                      onClick={() => { taskGalleryRef.current?.click(); setShowTaskPhotoChoice(false); }}
                      sx={{ display: 'block', width: '100%', p: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', textTransform: 'none', '&:hover': { background: '#f5f5f5' } }}
                    >
                      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>{t('common.gallery')}</Box>
                    </Button>
                  </Paper>
                </Fragment>
              )}
            </Box>
            <Button
              onClick={() => taskFileRef.current?.click()}
              sx={{
                p: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '80px',
                textTransform: 'none', '&:hover': { background: 'white' },
              }}
            >
              {'\u{1F4CE}'} {t('common.file')}
            </Button>
            <Button
              sx={{
                p: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '80px',
                textTransform: 'none', '&:hover': { background: 'white' },
              }}
              onClick={() => { if (onNavigate) onNavigate('forms'); }}
            >
              {'\u{1F4DD}'} {t('dailyPlan.form')}
            </Button>
          </Box>
          {/* Add / Cancel row */}
          <Box sx={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Button className="btn btn-secondary" sx={{ p: '12px 20px', fontSize: '15px', flex: 1, minWidth: '120px', textTransform: 'none' }} onClick={() => { setShowAddTask(false); setTaskAttachments([]); setShowTaskPhotoChoice(false); }}>{t('common.cancel')}</Button>
            <Button className="btn btn-primary" sx={{ p: '12px 20px', fontWeight: 700, fontSize: '15px', flex: 1, minWidth: '120px', textTransform: 'none' }} onClick={addTask}>{t('dailyPlan.add')}</Button>
          </Box>
        </Paper>
      )}

      {loading && <CircularProgress sx={{ display: 'block', mx: 'auto', color: 'text.primary' }} />}

      {!loading && tasks.length === 0 && !showAddTask && (
        <Box sx={{ textAlign: 'center', p: '40px 0', color: 'text.primary' }}>
          <Typography sx={{ fontSize: '16px' }}>{t('dailyPlan.noTasks')}</Typography>
          <Typography sx={{ fontSize: '14px', cursor: 'pointer' }} onClick={() => setShowAddTask(true)}>{t('dailyPlan.addTask')}</Typography>
        </Box>
      )}

      {/* Task list -- bubble pattern grouped by person */}
      {!loading && tasks.length > 0 && (() => {
        // Group tasks by assigned person
        const byPerson = {};
        const personOrder = [];
        tasks.forEach(task => {
          const key = task.assigned_to || task.created_by || '_unassigned';
          const name = task.assigned_to_name || task.created_by_name || 'Unassigned';
          if (!byPerson[key]) {
            byPerson[key] = { name, tasks: [] };
            personOrder.push(key);
          }
          byPerson[key].tasks.push(task);
        });

        // Render task card (reused in bubble and expanded view)
        const renderTaskCard = (task) => (
          <Paper key={task.id} onClick={() => { if (onNavigate) onNavigate('taskdetail', { taskId: task.id }); }} elevation={0} sx={{
            borderRadius: '8px', p: '10px 12px', mb: '6px',
            borderLeft: `4px solid ${statusColors[task.status] || '#999'}`,
            opacity: task.status === 'completed' ? 0.7 : 1,
            cursor: 'pointer', borderBottom: '1px solid #f0f0f0',
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: '2px' }}>
              <Button
                onClick={(e) => { e.stopPropagation(); updateTaskStatus(task.id, task.status === 'completed' ? 'pending' : 'completed'); }}
                sx={{
                  width: '22px', height: '22px', minWidth: '22px', borderRadius: '6px',
                  border: `2px solid ${statusColors[task.status]}`,
                  background: task.status === 'completed' ? 'success.main' : 'white',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, color: 'white', fontSize: '13px', p: 0, textTransform: 'none',
                  '&:hover': { background: task.status === 'completed' ? 'success.main' : 'white' },
                }}
              >
                {task.status === 'completed' ? '\u2713' : ''}
              </Button>
              <Typography component="span" sx={{ fontSize: '14px', fontWeight: 700, color: 'text.primary', textDecoration: task.status === 'completed' ? 'line-through' : 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</Typography>
              <Typography component="span" sx={{ fontSize: '12px', color: priorityColors[task.priority], fontWeight: 600, flexShrink: 0 }}>{task.priority !== 'normal' ? task.priority.toUpperCase() : ''}</Typography>
            </Box>
            {task.description && <Typography sx={{ fontSize: '12px', color: 'text.primary', m: '0 0 0 30px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.description}</Typography>}
          </Paper>
        );

        // Expanded bubble view -- full screen for one person
        if (selectedBubble !== null) {
          const group = byPerson[selectedBubble];
          if (!group) { setSelectedBubble(null); return null; }
          return (
            <Box>
              <Button onClick={() => setSelectedBubble(null)} sx={{ background: 'none', border: 'none', fontSize: '15px', fontWeight: 700, color: 'primary.main', cursor: 'pointer', mb: '16px', p: 0, textTransform: 'none' }}>
                {'\u2190'} Back to all
              </Button>
              <Box sx={{ background: 'var(--charcoal)', color: 'primary.main', p: '14px 20px', borderRadius: '16px 16px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography component="span" sx={{ fontWeight: 700, fontSize: '16px' }}>{group.name}</Typography>
                <Typography component="span" sx={{ background: 'var(--primary)', color: 'white', borderRadius: '14px', p: '2px 12px', fontSize: '14px', fontWeight: 700, minWidth: '28px', textAlign: 'center' }}>{group.tasks.length}</Typography>
              </Box>
              <Box sx={{ border: '2px solid var(--gray-200)', borderTop: 'none', borderRadius: '0 0 16px 16px', p: '12px 16px' }}>
                {group.tasks.map(renderTaskCard)}
              </Box>
            </Box>
          );
        }

        // Bubble grid view
        return (
          <Box className="people-grid">
            {personOrder.map(key => {
              const group = byPerson[key];
              const preview = group.tasks.slice(0, 4);
              const remaining = group.tasks.length - preview.length;
              return (
                <Box key={key} className="people-category-bubble">
                  <Box className="people-category-header" onClick={() => setSelectedBubble(key)} sx={{ cursor: 'pointer' }}>
                    <Typography component="span" className="people-category-label" sx={{ flex: 1 }}>{group.name}</Typography>
                    <Typography component="span" className="people-category-count">{group.tasks.length}</Typography>
                    <Typography component="span" sx={{ fontSize: '14px', ml: '4px', color: 'white' }}>{'\u25B6'}</Typography>
                  </Box>
                  <Box className="people-category-body" sx={{ maxHeight: '280px', overflowY: 'auto' }}>
                    {preview.map(renderTaskCard)}
                    {remaining > 0 && (
                      <Box onClick={() => setSelectedBubble(key)} sx={{ fontSize: '13px', color: 'primary.main', textAlign: 'center', p: '8px', cursor: 'pointer', fontWeight: 600 }}>
                        +{remaining} more
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        );
      })()}

      <Dialog open={!!dialogConfig} onClose={() => setDialogConfig(null)}>
        <DialogContent>
          <Typography>{dialogConfig?.message}</Typography>
        </DialogContent>
        <DialogActions>
          {dialogConfig?.showCancel && (
            <Button onClick={() => setDialogConfig(null)}>{t('common.cancel')}</Button>
          )}
          <Button onClick={() => { setDialogConfig(null); if (dialogConfig?.onConfirm) dialogConfig.onConfirm(); }}>OK</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
