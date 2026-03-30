import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceRefinePanel from '../components/VoiceRefinePanel.jsx';

const statusColors = { pending: '#F99440', in_progress: '#48484A', completed: '#4CAF50', cancelled: '#48484A' };
const statusLabels = { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' };
const priorityColors = { critical: '#C45500', high: '#F99440' };

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
      <div style={{ padding: '24px', textAlign: 'center', color: '#48484A', fontSize: '16px', fontWeight: 600 }}>
        {t('common.loading')}
      </div>
    );
  }

  if (!task) {
    return (
      <div style={{ padding: '24px' }}>
        <div style={{ textAlign: 'center', color: '#48484A', fontSize: '16px', fontWeight: 600, marginTop: '40px' }}>
          {t('common.taskNotFound')}
        </div>
      </div>
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
      <div style={{ padding: '16px', background: '#f5f5f0', minHeight: '100vh' }}>
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
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 16px 80px', background: '#f5f5f0', minHeight: '100vh' }}>
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

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0, flex: 1, color: '#48484A' }}>
          {task.title}
        </h1>
      </div>
      {/* ── Status + Controls inline ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <span style={{
          padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
          color: 'white', background: statusColors[task.status] || '#48484A',
        }}>
          {statusLabels[task.status] || task.status}
        </span>
        {task.status === 'pending' && (
          <button onClick={() => updateStatus('in_progress')} style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, border: 'none', cursor: 'pointer', background: '#48484A', color: 'var(--primary)' }}>
            Start
          </button>
        )}
        {task.status === 'in_progress' && (
          <>
            <button onClick={() => updateStatus('pending')} style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, border: 'none', cursor: 'pointer', background: '#E8922A', color: 'var(--charcoal)' }}>
              Pause
            </button>
            <button onClick={() => updateStatus('completed')} style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, border: 'none', cursor: 'pointer', background: '#4CAF50', color: 'white' }}>
              Complete
            </button>
          </>
        )}
        {task.status === 'completed' && (
          <button onClick={() => updateStatus('in_progress')} style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, border: 'none', cursor: 'pointer', background: '#48484A', color: 'white' }}>
            Reopen
          </button>
        )}
      </div>

      {/* ── Task Info Card ── */}
      <div style={styles.card}>
        <h2 style={{ fontSize: '17px', fontWeight: 700, margin: '0 0 6px', color: '#48484A' }}>
          {task.title}
        </h2>
        {task.description && (
          <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 12px', lineHeight: 1.4 }}>
            {task.description}
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {task.assigned_to_name && (
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Assigned to</span>
              <span style={styles.infoValue}>{task.assigned_to_name}{task.assigned_to_role ? ` (${task.assigned_to_role})` : ''}</span>
            </div>
          )}
          {task.created_by_name && (
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Created by</span>
              <span style={styles.infoValue}>{task.created_by_name}</span>
            </div>
          )}
          {task.start_date && (
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Start date</span>
              <span style={styles.infoValue}>{formatDate(task.start_date)}</span>
            </div>
          )}
          {task.target_end_date && (
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Target end</span>
              <span style={styles.infoValue}>{formatDate(task.target_end_date)}</span>
            </div>
          )}
          {task.location && (
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Location</span>
              <span style={styles.infoValue}>{task.location}</span>
            </div>
          )}
          {task.priority && task.priority !== 'normal' && (
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Priority</span>
              <span style={{
                ...styles.infoValue,
                color: 'white',
                background: priorityColors[task.priority] || '#48484A',
                padding: '2px 10px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 700,
                display: 'inline-block',
              }}>
                {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
              </span>
            </div>
          )}
        </div>
      </div>


      {/* ── Today's Entry ── */}
      <div style={{
        ...styles.card,
        border: '2px solid #E8922A',
        marginBottom: '20px',
      }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 16px', color: '#48484A' }}>
          Today — {todayFormatted}
        </h3>

        {/* JSA Row */}
        <div style={{ ...styles.entryRow, flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#48484A' }}>JSA</span>
            {todayEntry?.jsa_id ? (
              <button
                onClick={() => onNavigate('jsa', { viewJsaId: todayEntry.jsa_id })}
                style={{
                  background: '#4CAF50', color: 'white', border: 'none', borderRadius: '8px',
                  padding: '8px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                }}
              >
                {todayEntry.jsa_number || 'JSA'} ✓
              </button>
            ) : (
              <button
                onClick={() => { setShowJsaOptions(!showJsaOptions); if (!showJsaOptions) loadMyTodayJSAs(); }}
                style={{
                  background: '#E8922A', color: 'var(--charcoal)', border: 'none', borderRadius: '8px',
                  padding: '8px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                }}
              >
                JSA
              </button>
            )}
          </div>
          {/* JSA Options — Create or Link */}
          {showJsaOptions && !todayEntry?.jsa_id && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: '#f5f3f0', borderRadius: '8px', padding: '12px' }}>
              <button
                onClick={() => { setShowJsaOptions(false); onNavigate('jsa', { taskId: task.id, taskTitle: task.title, taskDescription: task.description }); }}
                style={{
                  background: '#E8922A', color: 'var(--charcoal)', border: 'none', borderRadius: '8px',
                  padding: '10px 14px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'center',
                }}
              >
                {t('jsa.createNew') || 'Create New JSA'}
              </button>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#48484A', textAlign: 'center' }}>— or —</div>
              {loadingJSAs ? (
                <div style={{ textAlign: 'center', color: 'var(--charcoal)', fontSize: '13px', padding: '8px' }}>Loading...</div>
              ) : myTodayJSAs.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--charcoal)', fontSize: '13px', padding: '8px' }}>
                  {t('jsa.noExistingToday') || 'No existing JSAs for today'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#48484A' }}>{t('jsa.linkExisting') || 'Link Existing JSA'}:</div>
                  {myTodayJSAs.map(jsa => (
                    <button
                      key={jsa.id}
                      onClick={() => linkJsaToTask(jsa.id)}
                      disabled={linkingJsa}
                      style={{
                        background: 'white', border: '2px solid #E8922A', borderRadius: '8px',
                        padding: '10px 12px', cursor: 'pointer', textAlign: 'left',
                        opacity: linkingJsa ? 0.6 : 1,
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '13px', color: '#48484A' }}>{jsa.jsa_number}</div>
                      <div style={{ fontSize: '12px', color: 'var(--charcoal)', marginTop: '2px' }}>
                        {(jsa.form_data?.task_description || '').slice(0, 80)}{(jsa.form_data?.task_description || '').length > 80 ? '...' : ''}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Daily Report Row */}
        <div style={{ ...styles.entryRow, flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#48484A' }}>{t('common.dailyReport')}</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {todayEntry?.shift_structured && (
                <button
                  onClick={() => setShowAddNote(!showAddNote)}
                  style={{
                    background: 'white', color: '#48484A', border: '2px solid #48484A', borderRadius: '8px',
                    padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {t('common.addNote')}
                </button>
              )}
              {todayEntry?.shift_structured ? (
                <button
                  onClick={() => setExpandedDay(expandedDay === 'today' ? null : 'today')}
                  style={{
                    background: '#48484A', color: 'var(--primary)', border: 'none', borderRadius: '8px',
                    padding: '6px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {expandedDay === 'today' ? 'Collapse' : 'View'}
                </button>
              ) : (
                <button
                  onClick={() => setShowShiftUpdate(true)}
                  style={{
                    background: '#E8922A', color: 'var(--charcoal)', border: 'none', borderRadius: '8px',
                    padding: '8px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {t('common.recordDailyReport')}
                </button>
              )}
            </div>
          </div>
          {todayEntry?.shift_structured && (
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--charcoal)', margin: 0, lineHeight: 1.4 }}>
              {expandedDay === 'today'
                ? todayEntry.shift_structured
                : todayEntry.shift_structured.slice(0, 150) + (todayEntry.shift_structured.length > 150 ? '...' : '')}
            </p>
          )}
          {todayEntry?.hours_worked != null && (
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#48484A' }}>
              Hours worked: {todayEntry.hours_worked}
            </span>
          )}
          {/* Notes list */}
          {todayEntry?.notes?.length > 0 && (
            <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {todayEntry.notes.map((note, i) => (
                <div key={i} style={{ fontSize: '13px', color: '#48484A', background: '#f5f3f0', borderRadius: '6px', padding: '8px 10px', lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--charcoal)', fontSize: '11px' }}>
                    {note.time ? new Date(note.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                  {' '}{note.text}
                </div>
              ))}
            </div>
          )}
          {/* Add Note form */}
          {showAddNote && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Add a note..."
                rows={2}
                style={{
                  flex: 1, padding: '10px', border: '2px solid #48484A', borderRadius: '8px',
                  fontSize: '14px', resize: 'none', fontFamily: 'inherit', color: '#48484A',
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <button
                  onClick={saveNote}
                  disabled={savingNote || !noteText.trim()}
                  style={{
                    background: '#E8922A', color: 'var(--charcoal)', border: 'none', borderRadius: '8px',
                    padding: '8px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                    opacity: savingNote || !noteText.trim() ? 0.5 : 1,
                  }}
                >
                  {savingNote ? '...' : 'Save'}
                </button>
                <button
                  onClick={() => { setShowAddNote(false); setNoteText(''); }}
                  style={{
                    background: 'white', color: 'var(--charcoal)', border: '1px solid #48484A', borderRadius: '8px',
                    padding: '6px 10px', fontSize: '12px', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Photos Row */}
        <div style={{ ...styles.entryRow, flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#48484A' }}>
              Photos {todayEntry?.photos?.length ? `(${todayEntry.photos.length})` : ''}
            </span>
            <button
              onClick={() => photoRef.current?.click()}
              disabled={uploading}
              style={{
                background: '#E8922A', color: 'var(--charcoal)', border: 'none', borderRadius: '8px',
                padding: '8px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                opacity: uploading ? 0.6 : 1,
              }}
            >
              {uploading ? 'Uploading...' : 'Add Photo'}
            </button>
          </div>
          {todayEntry?.photos?.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {todayEntry.photos.map((photo, i) => (
                <img
                  key={i}
                  src={`/photos/${typeof photo === 'string' ? photo : photo.filename}`}
                  alt={`Photo ${i + 1}`}
                  style={{
                    width: '64px', height: '64px', objectFit: 'cover',
                    borderRadius: '8px', border: '2px solid #e0e0e0',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Previous Days removed — history lives on the person's profile page */}
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const styles = {
  backBtn: {
    background: 'none', border: 'none', color: '#E8922A', fontSize: '15px',
    fontWeight: 700, cursor: 'pointer', padding: '8px 4px',
  },
  card: {
    background: 'white', borderRadius: '12px', padding: '16px',
    marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    cursor: 'default',
  },
  infoRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  infoLabel: {
    fontSize: '13px', fontWeight: 700, color: 'var(--charcoal)',
  },
  infoValue: {
    fontSize: '14px', fontWeight: 600, color: '#48484A',
  },
  entryRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 0', borderTop: '1px solid rgba(72,72,74,0.15)',
  },
  actionBtn: {
    border: 'none', borderRadius: '10px', padding: '12px 24px',
    fontSize: '15px', fontWeight: 700, cursor: 'pointer',
    minHeight: '48px', flex: 1,
  },
};
