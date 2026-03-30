import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import VoiceRefinePanel from '../components/VoiceRefinePanel.jsx';

const statusColors = { pending: 'primary.main', in_progress: 'secondary.main', completed: 'success.main', cancelled: 'secondary.main' };
const statusLabels = { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' };
const priorityColors = { critical: '#C45500', high: 'primary.main' };

export default function TaskDetailView({ user, taskId, goBack, onNavigate, activeTrade, readOnly }) {
  const { t } = useTranslation();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showShiftUpdate, setShowShiftUpdate] = useState(false);
  const [expandedDay, setExpandedDay] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [showJsaOptions, setShowJsaOptions] = useState(false);
  const [myTodayJSAs, setMyTodayJSAs] = useState([]);
  const [loadingJSAs, setLoadingJSAs] = useState(false);
  const [linkingJsa, setLinkingJsa] = useState(false);
  const photoRef = useRef(null);

  const today = new Date().toISOString().split('T')[0];
  const personId = user.person_id;

  useEffect(() => { loadTask(); }, [taskId]);

  const loadTask = async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      setTask(data);
    } catch (e) {
      console.error('Failed to load task:', e);
    }
    setLoading(false);
  };

  const updateStatus = async (status) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      loadTask();
    } catch (e) {
      console.error('Failed to update status:', e);
    }
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('photo', file);
        const res = await fetch(`/api/tasks/${taskId}/days/${today}/photos`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) throw new Error(`Upload failed ${res.status}`);
      }
      loadTask();
    } catch (e) {
      console.error('Failed to upload photo:', e);
    }
    setUploading(false);
    e.target.value = '';
  };

  const saveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteText.trim(), date: today, person_id: personId }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setNoteText('');
      setShowAddNote(false);
      loadTask();
    } catch (e) {
      console.error('Failed to save note:', e);
    }
    setSavingNote(false);
  };

  const loadMyTodayJSAs = async () => {
    setLoadingJSAs(true);
    try {
      const res = await fetch(`/api/jsa/person/${personId}/today?date=${today}`);
      if (!res.ok) { setMyTodayJSAs([]); return; }
      const jsas = await res.json();
      setMyTodayJSAs(Array.isArray(jsas) ? jsas : []);
    } catch (e) { console.error('Failed to load JSAs:', e); }
    setLoadingJSAs(false);
  };

  const linkJsaToTask = async (jsaId) => {
    setLinkingJsa(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/days/${today}/link-jsa`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsa_id: jsaId }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setShowJsaOptions(false);
      setMyTodayJSAs([]);
      loadTask();
    } catch (e) { console.error('Failed to link JSA:', e); }
    setLinkingJsa(false);
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <CircularProgress size={32} sx={{ color: 'warning.main' }} />
        <Typography sx={{ color: 'text.primary', fontSize: '16px', fontWeight: 600, mt: 2 }}>
          {t('common.loading')}
        </Typography>
      </Box>
    );
  }

  if (!task) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography sx={{ textAlign: 'center', color: 'text.primary', fontSize: '16px', fontWeight: 600, mt: 5 }}>
          {t('common.taskNotFound')}
        </Typography>
      </Box>
    );
  }

  const days = task.days || [];
  const todayEntry = days.find(d => d.date === today);
  const previousDays = days.filter(d => d.date !== today).sort((a, b) => b.date.localeCompare(a.date));

  const todayFormatted = new Date(today + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // Build context for VoiceRefinePanel
  const todayJsaSummary = todayEntry?.jsa_form_data
    ? (typeof todayEntry.jsa_form_data === 'string' ? todayEntry.jsa_form_data : JSON.stringify(todayEntry.jsa_form_data))
    : '';
  const recentUpdates = previousDays.slice(0, 3).map(d => ({
    date: d.date,
    summary: d.shift_structured || '',
  }));

  // Shift update recording overlay
  if (showShiftUpdate) {
    return (
      <Box sx={{ p: 2, bgcolor: 'grey.100', minHeight: '100vh' }}>
        <VoiceRefinePanel
          contextType="shift_update"
          personId={personId}
          defaultVoiceMode={(user.role_level || 1) >= 2 ? 'flow' : 'walkie'}
          autoStart
          taskContext={{
            task_title: task.title,
            task_description: task.description,
            task_location: task.location,
            jsa_summary: todayJsaSummary,
            previous_updates: recentUpdates,
          }}
          onAccept={async (fields) => {
            const res = await fetch(`/api/tasks/${taskId}/days/${today}/shift`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                person_id: personId,
                shift_structured: fields.shift_summary,
                shift_notes: JSON.stringify(fields),
                hours_worked: fields.hours_worked,
              }),
            });
            if (!res.ok) console.error('Shift update failed:', res.status);
            setShowShiftUpdate(false);
            loadTask();
          }}
          onCancel={() => setShowShiftUpdate(false)}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, pb: 10, bgcolor: 'grey.100', minHeight: '100vh' }}>
      {/* Hidden photo input */}
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        style={{ display: 'none' }}
        onChange={handlePhotoUpload}
      />

      {/* -- Header -- */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <Typography variant="h1" sx={{ fontSize: '20px', fontWeight: 700, m: 0, flex: 1, color: 'text.primary' }}>
          {task.title}
        </Typography>
      </Box>

      {/* -- Status + Controls inline -- */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.5, flexWrap: 'wrap' }}>
        <Chip
          label={statusLabels[task.status] || task.status}
          size="small"
          sx={{
            fontSize: '12px',
            fontWeight: 700,
            color: 'white',
            bgcolor: statusColors[task.status] || 'secondary.main',
          }}
        />
        {task.status === 'pending' && (
          <Button
            onClick={() => updateStatus('in_progress')}
            size="small"
            sx={{
              px: 1.5, py: 0.5, borderRadius: '20px', fontSize: '12px', fontWeight: 700,
              textTransform: 'none', bgcolor: 'secondary.main', color: 'warning.main',
              '&:hover': { bgcolor: 'secondary.dark' },
            }}
          >
            Start
          </Button>
        )}
        {task.status === 'in_progress' && (
          <>
            <Button
              onClick={() => updateStatus('pending')}
              size="small"
              sx={{
                px: 1.5, py: 0.5, borderRadius: '20px', fontSize: '12px', fontWeight: 700,
                textTransform: 'none', bgcolor: 'warning.main', color: 'text.primary',
                '&:hover': { bgcolor: 'warning.dark' },
              }}
            >
              Pause
            </Button>
            <Button
              onClick={() => updateStatus('completed')}
              size="small"
              sx={{
                px: 1.5, py: 0.5, borderRadius: '20px', fontSize: '12px', fontWeight: 700,
                textTransform: 'none', bgcolor: 'success.main', color: 'white',
                '&:hover': { bgcolor: 'success.dark' },
              }}
            >
              Complete
            </Button>
          </>
        )}
        {task.status === 'completed' && (
          <Button
            onClick={() => updateStatus('in_progress')}
            size="small"
            sx={{
              px: 1.5, py: 0.5, borderRadius: '20px', fontSize: '12px', fontWeight: 700,
              textTransform: 'none', bgcolor: 'secondary.main', color: 'white',
              '&:hover': { bgcolor: 'secondary.dark' },
            }}
          >
            Reopen
          </Button>
        )}
      </Box>

      {/* -- Task Info Card -- */}
      <Paper elevation={1} sx={{ borderRadius: '12px', p: 2, mb: 1.5, cursor: 'default' }}>
        <Typography variant="h2" sx={{ fontSize: '17px', fontWeight: 700, m: 0, mb: 0.75, color: 'text.primary' }}>
          {task.title}
        </Typography>
        {task.description && (
          <Typography sx={{ fontSize: '15px', fontWeight: 600, color: 'text.primary', m: 0, mb: 1.5, lineHeight: 1.4 }}>
            {task.description}
          </Typography>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {task.assigned_to_name && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'text.primary' }}>Assigned to</Typography>
              <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'text.primary' }}>
                {task.assigned_to_name}{task.assigned_to_role ? ` (${task.assigned_to_role})` : ''}
              </Typography>
            </Box>
          )}
          {task.created_by_name && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'text.primary' }}>Created by</Typography>
              <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'text.primary' }}>{task.created_by_name}</Typography>
            </Box>
          )}
          {task.start_date && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'text.primary' }}>Start date</Typography>
              <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'text.primary' }}>{formatDate(task.start_date)}</Typography>
            </Box>
          )}
          {task.target_end_date && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'text.primary' }}>Target end</Typography>
              <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'text.primary' }}>{formatDate(task.target_end_date)}</Typography>
            </Box>
          )}
          {task.location && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'text.primary' }}>Location</Typography>
              <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'text.primary' }}>{task.location}</Typography>
            </Box>
          )}
          {task.priority && task.priority !== 'normal' && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'text.primary' }}>Priority</Typography>
              <Chip
                label={task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                size="small"
                sx={{
                  color: 'white',
                  bgcolor: priorityColors[task.priority] || 'secondary.main',
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              />
            </Box>
          )}
        </Box>
      </Paper>

      {/* -- Today's Entry -- */}
      <Paper
        elevation={1}
        sx={{
          borderRadius: '12px',
          p: 2,
          mb: 2.5,
          border: '2px solid',
          borderColor: 'warning.main',
        }}
      >
        <Typography variant="h3" sx={{ fontSize: '16px', fontWeight: 700, m: 0, mb: 2, color: 'text.primary' }}>
          Today — {todayFormatted}
        </Typography>

        {/* JSA Row */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 1, justifyContent: 'space-between', py: 1.5, borderTop: '1px solid rgba(72,72,74,0.15)' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: '14px', fontWeight: 700, color: 'text.primary' }}>JSA</Typography>
            {todayEntry?.jsa_id ? (
              <Button
                onClick={() => onNavigate('jsa', { viewJsaId: todayEntry.jsa_id })}
                sx={{
                  bgcolor: 'success.main', color: 'white', borderRadius: '8px',
                  px: 1.75, py: 1, fontSize: '13px', fontWeight: 700, textTransform: 'none',
                  '&:hover': { bgcolor: 'success.dark' },
                }}
              >
                {todayEntry.jsa_number || 'JSA'} ✓
              </Button>
            ) : (
              <Button
                onClick={() => { setShowJsaOptions(!showJsaOptions); if (!showJsaOptions) loadMyTodayJSAs(); }}
                sx={{
                  bgcolor: 'warning.main', color: 'text.primary', borderRadius: '8px',
                  px: 1.75, py: 1, fontSize: '13px', fontWeight: 700, textTransform: 'none',
                  '&:hover': { bgcolor: 'warning.dark' },
                }}
              >
                JSA
              </Button>
            )}
          </Box>

          {/* JSA Options -- Create or Link */}
          {showJsaOptions && !todayEntry?.jsa_id && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, bgcolor: 'grey.100', borderRadius: '8px', p: 1.5 }}>
              <Button
                onClick={() => { setShowJsaOptions(false); onNavigate('jsa', { taskId: task.id, taskTitle: task.title, taskDescription: task.description }); }}
                sx={{
                  bgcolor: 'warning.main', color: 'text.primary', borderRadius: '8px',
                  px: 1.75, py: 1.25, fontSize: '14px', fontWeight: 700, textTransform: 'none',
                  textAlign: 'center',
                  '&:hover': { bgcolor: 'warning.dark' },
                }}
              >
                {t('jsa.createNew') || 'Create New JSA'}
              </Button>
              <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'text.primary', textAlign: 'center' }}>— or —</Typography>
              {loadingJSAs ? (
                <Box sx={{ textAlign: 'center', p: 1 }}>
                  <CircularProgress size={20} sx={{ color: 'warning.main' }} />
                </Box>
              ) : myTodayJSAs.length === 0 ? (
                <Typography sx={{ textAlign: 'center', color: 'text.primary', fontSize: '13px', p: 1 }}>
                  {t('jsa.noExistingToday') || 'No existing JSAs for today'}
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'text.primary' }}>{t('jsa.linkExisting') || 'Link Existing JSA'}:</Typography>
                  {myTodayJSAs.map(jsa => (
                    <Button
                      key={jsa.id}
                      onClick={() => linkJsaToTask(jsa.id)}
                      disabled={linkingJsa}
                      sx={{
                        bgcolor: 'white', border: '2px solid', borderColor: 'warning.main', borderRadius: '8px',
                        px: 1.5, py: 1.25, textAlign: 'left', textTransform: 'none',
                        opacity: linkingJsa ? 0.6 : 1,
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                        '&:hover': { bgcolor: 'grey.50' },
                      }}
                    >
                      <Typography sx={{ fontWeight: 700, fontSize: '13px', color: 'text.primary' }}>{jsa.jsa_number}</Typography>
                      <Typography sx={{ fontSize: '12px', color: 'text.primary', mt: 0.25 }}>
                        {(jsa.form_data?.task_description || '').slice(0, 80)}{(jsa.form_data?.task_description || '').length > 80 ? '...' : ''}
                      </Typography>
                    </Button>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>

        {/* Daily Report Row */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 1, justifyContent: 'space-between', py: 1.5, borderTop: '1px solid rgba(72,72,74,0.15)' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: '14px', fontWeight: 700, color: 'text.primary' }}>{t('common.dailyReport')}</Typography>
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              {todayEntry?.shift_structured && (
                <Button
                  onClick={() => setShowAddNote(!showAddNote)}
                  variant="outlined"
                  size="small"
                  sx={{
                    color: 'text.primary', borderColor: 'secondary.main', borderWidth: 2, borderRadius: '8px',
                    px: 1.5, py: 0.75, fontSize: '12px', fontWeight: 700, textTransform: 'none',
                  }}
                >
                  {t('common.addNote')}
                </Button>
              )}
              {todayEntry?.shift_structured ? (
                <Button
                  onClick={() => setExpandedDay(expandedDay === 'today' ? null : 'today')}
                  size="small"
                  sx={{
                    bgcolor: 'secondary.main', color: 'warning.main', borderRadius: '8px',
                    px: 1.75, py: 0.75, fontSize: '13px', fontWeight: 700, textTransform: 'none',
                    '&:hover': { bgcolor: 'secondary.dark' },
                  }}
                >
                  {expandedDay === 'today' ? 'Collapse' : 'View'}
                </Button>
              ) : (
                <Button
                  onClick={() => setShowShiftUpdate(true)}
                  size="small"
                  sx={{
                    bgcolor: 'warning.main', color: 'text.primary', borderRadius: '8px',
                    px: 1.75, py: 1, fontSize: '13px', fontWeight: 700, textTransform: 'none',
                    '&:hover': { bgcolor: 'warning.dark' },
                  }}
                >
                  {t('common.recordDailyReport')}
                </Button>
              )}
            </Box>
          </Box>
          {todayEntry?.shift_structured && (
            <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'text.primary', m: 0, lineHeight: 1.4 }}>
              {expandedDay === 'today'
                ? todayEntry.shift_structured
                : todayEntry.shift_structured.slice(0, 150) + (todayEntry.shift_structured.length > 150 ? '...' : '')}
            </Typography>
          )}
          {todayEntry?.hours_worked != null && (
            <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'text.primary' }}>
              Hours worked: {todayEntry.hours_worked}
            </Typography>
          )}
          {/* Notes list */}
          {todayEntry?.notes?.length > 0 && (
            <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {todayEntry.notes.map((note, i) => (
                <Box key={i} sx={{ fontSize: '13px', color: 'text.primary', bgcolor: 'grey.100', borderRadius: '6px', p: '8px 10px', lineHeight: 1.4 }}>
                  <Typography component="span" sx={{ fontWeight: 600, color: 'text.primary', fontSize: '11px' }}>
                    {note.time ? new Date(note.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </Typography>
                  {' '}{note.text}
                </Box>
              ))}
            </Box>
          )}
          {/* Add Note form */}
          {showAddNote && (
            <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
              <TextField
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Add a note..."
                multiline
                rows={2}
                fullWidth
                slotProps={{
                  htmlInput: {
                    style: { fontSize: '14px', fontFamily: 'inherit', color: '#48484A' },
                  },
                }}
                sx={{
                  flex: 1,
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                    '& fieldset': { borderWidth: 2, borderColor: 'secondary.main' },
                  },
                }}
              />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Button
                  onClick={saveNote}
                  disabled={savingNote || !noteText.trim()}
                  size="small"
                  sx={{
                    bgcolor: 'warning.main', color: 'text.primary', borderRadius: '8px',
                    px: 1.75, py: 1, fontSize: '13px', fontWeight: 700, textTransform: 'none',
                    opacity: savingNote || !noteText.trim() ? 0.5 : 1,
                    '&:hover': { bgcolor: 'warning.dark' },
                  }}
                >
                  {savingNote ? '...' : 'Save'}
                </Button>
                <Button
                  onClick={() => { setShowAddNote(false); setNoteText(''); }}
                  variant="outlined"
                  size="small"
                  sx={{
                    color: 'text.primary', borderColor: 'secondary.main', borderRadius: '8px',
                    px: 1.25, py: 0.75, fontSize: '12px', textTransform: 'none',
                  }}
                >
                  Cancel
                </Button>
              </Box>
            </Box>
          )}
        </Box>

        {/* Photos Row */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 1.25, justifyContent: 'space-between', py: 1.5, borderTop: '1px solid rgba(72,72,74,0.15)' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ fontSize: '14px', fontWeight: 700, color: 'text.primary' }}>
              Photos {todayEntry?.photos?.length ? `(${todayEntry.photos.length})` : ''}
            </Typography>
            <Button
              onClick={() => photoRef.current?.click()}
              disabled={uploading}
              size="small"
              sx={{
                bgcolor: 'warning.main', color: 'text.primary', borderRadius: '8px',
                px: 1.75, py: 1, fontSize: '13px', fontWeight: 700, textTransform: 'none',
                opacity: uploading ? 0.6 : 1,
                '&:hover': { bgcolor: 'warning.dark' },
              }}
            >
              {uploading ? 'Uploading...' : 'Add Photo'}
            </Button>
          </Box>
          {todayEntry?.photos?.length > 0 && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {todayEntry.photos.map((photo, i) => (
                <Box
                  key={i}
                  component="img"
                  src={`/photos/${typeof photo === 'string' ? photo : photo.filename}`}
                  alt={`Photo ${i + 1}`}
                  sx={{
                    width: '64px', height: '64px', objectFit: 'cover',
                    borderRadius: '8px', border: '2px solid #e0e0e0',
                  }}
                />
              ))}
            </Box>
          )}
        </Box>
      </Paper>

      {/* Previous Days removed -- history lives on the person's profile page */}
    </Box>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
