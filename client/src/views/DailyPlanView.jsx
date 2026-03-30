import { useState, useEffect, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceRefinePanel from '../components/VoiceRefinePanel.jsx';
import PunchListView from './PunchListView.jsx';

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

  const deleteTask = async (taskId) => {
    if (!confirm(t('common.deleteConfirm'))) return;
    await fetch(`/api/daily-plans/tasks/${taskId}`, { method: 'DELETE' });
    loadTasks();
  };

  const statusColors = { pending: '#F99440', in_progress: '#48484A', completed: '#4CAF50', cancelled: '#999' };
  const statusLabels = { pending: t('jsa.pending'), in_progress: t('punchList.inProgress'), completed: t('common.done'), cancelled: t('common.cancel') };
  const priorityColors = { critical: '#C45500', high: '#F99440', normal: 'var(--charcoal)', low: '#999' };

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const totalCount = tasks.length;

  // If in assign-only mode (came from person profile), show ONLY the task form
  if (assignOnlyMode) {
    return (
      <div className="list-view">
        <h1 style={{fontWeight: 800, fontSize: '22px', marginBottom: '6px'}}>Assign Task</h1>
        {assignPersonName && (
          <p style={{fontSize: '15px', fontWeight: 600, color: 'var(--primary)', marginBottom: '16px'}}>
            To: {assignPersonName}
          </p>
        )}
        <div style={{background: 'white', border: '2px solid var(--primary)', borderRadius: '12px', padding: '16px'}}>
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
            <div style={{display: 'flex', justifyContent: 'center', marginBottom: '12px'}}>
              <button onClick={() => setShowVoiceRefine(true)} className="refine-mic-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--primary)" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/></svg>
                {t('dailyPlan.speakTask')}
              </button>
            </div>
          )}
          <input type="text" placeholder={t('dailyPlan.taskTitle')} value={newTask.title} onChange={e => setNewTask(t => ({...t, title: e.target.value}))}
            style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', boxSizing: 'border-box'}} />
          <textarea placeholder={t('dailyPlan.description')} value={newTask.description} onChange={e => setNewTask(t => ({...t, description: e.target.value}))}
            rows={2} style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', resize: 'none', boxSizing: 'border-box'}} />
          <div style={{display: 'flex', gap: '8px', marginBottom: '12px'}}>
            {/* Assign To dropdown */}
            <div style={{flex: 3, position: 'relative'}}>
              <button type="button" onClick={() => setShowAssignDropdown(!showAssignDropdown)}
                style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: newTask.assigned_to.length ? 'var(--charcoal)' : '#999', boxSizing: 'border-box', minHeight: '48px', background: 'white', textAlign: 'left', cursor: 'pointer', fontWeight: newTask.assigned_to.length ? 700 : 400}}>
                {newTask.assigned_to.length ? team.filter(p => newTask.assigned_to.includes(p.id)).map(p => p.name).join(', ') : t('dailyPlan.assignTo')}
              </button>
              {showAssignDropdown && (
                <div style={{position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '2px solid #ccc', borderRadius: '8px', marginTop: '4px', zIndex: 10, maxHeight: '250px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'}}>
                  {team.map(p => {
                    const isChecked = newTask.assigned_to.includes(p.id);
                    return (
                      <label key={p.id} style={{display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontSize: '14px', fontWeight: 600, background: isChecked ? '#f9f5f0' : 'white'}}>
                        <input type="checkbox" checked={isChecked} onChange={() => {
                          setNewTask(t => ({...t, assigned_to: isChecked ? t.assigned_to.filter(id => id !== p.id) : [...t.assigned_to, p.id]}));
                        }} style={{width: '20px', height: '20px', accentColor: 'var(--primary)', flexShrink: 0}} />
                        <span>{p.name}</span>
                        <span style={{fontSize: '12px', color: 'var(--charcoal)', marginLeft: 'auto'}}>{p.role_title}</span>
                        {jsaStatuses[p.id] && (
                          <span style={{
                            width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
                            background: jsaStatuses[p.id].status === 'match' ? '#4CAF50'
                              : jsaStatuses[p.id].status === 'has_jsa' ? '#4CAF50'
                              : jsaStatuses[p.id].status === 'mismatch' ? '#E8922A'
                              : '#ccc',
                          }} title={jsaStatuses[p.id].status === 'no_jsa' ? 'No JSA' : jsaStatuses[p.id].jsa_number || 'JSA'} />
                        )}
                      </label>
                    );
                  })}
                  <button onClick={() => setShowAssignDropdown(false)} style={{width: '100%', padding: '10px', border: 'none', background: 'var(--charcoal)', color: 'var(--primary)', fontSize: '14px', fontWeight: 700, cursor: 'pointer', borderRadius: '0 0 6px 6px'}}>{t('common.done')}</button>
                </div>
              )}
            </div>
            {/* Priority */}
            <select value={newTask.priority} onChange={e => setNewTask(t => ({...t, priority: e.target.value}))}
              style={{flex: 0, width: '110px', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', boxSizing: 'border-box', minHeight: '48px'}}>
              <option value="normal">{t('dailyPlan.normal')}</option>
              <option value="low">{t('dailyPlan.low')}</option>
              <option value="high">{t('dailyPlan.high')}</option>
              <option value="critical">{t('dailyPlan.critical')}</option>
            </select>
          </div>
          <div style={{display: 'flex', gap: '10px'}}>
            <button className="btn btn-secondary" style={{padding: '12px 20px', fontSize: '15px', flex: 1}} onClick={() => { if (goBack) goBack(); }}>{t('common.cancel')}</button>
            <button className="btn btn-primary" style={{padding: '12px 20px', fontWeight: 700, fontSize: '15px', flex: 1}} onClick={addTask}>{t('dailyPlan.add')}</button>
          </div>
        </div>
      </div>
    );
  }

  // If punch tab is active, render PunchListView
  if (activeTab === 'punch') {
    return (
      <div className="list-view">
        <div style={{display: 'flex', gap: '0', marginBottom: '28px', border: '2px solid var(--charcoal)', borderRadius: '10px', overflow: 'hidden', maxWidth: '400px', margin: '0 auto 28px'}}>
          <button onClick={() => setActiveTab('plan')} style={{flex: 1, padding: '14px 8px', border: 'none', fontSize: '20px', fontWeight: 700, cursor: 'pointer', background: 'white', color: 'var(--primary)', whiteSpace: 'nowrap'}}>{t('dailyPlan.title')}</button>
          <button style={{flex: 1, padding: '14px 8px', border: 'none', fontSize: '20px', fontWeight: 700, background: 'var(--charcoal)', color: 'var(--primary)', borderLeft: '2px solid var(--charcoal)', whiteSpace: 'nowrap'}}>{t('dailyPlan.punchList')}</button>
        </div>
        <PunchListView user={user} embedded={true} onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <div className="list-view">
      {/* Tab switcher */}
      <div style={{display: 'flex', gap: '0', marginBottom: '28px', border: '2px solid var(--charcoal)', borderRadius: '10px', overflow: 'hidden', maxWidth: '400px', margin: '0 auto 28px'}}>
        <button style={{flex: 1, padding: '14px 8px', border: 'none', fontSize: '20px', fontWeight: 700, background: 'var(--charcoal)', color: 'var(--primary)', whiteSpace: 'nowrap'}}>{t('dailyPlan.title')}</button>
        <button onClick={() => setActiveTab('punch')} style={{flex: 1, padding: '14px 8px', border: 'none', fontSize: '20px', fontWeight: 700, cursor: 'pointer', background: 'white', color: 'var(--primary)', borderLeft: '2px solid var(--charcoal)', whiteSpace: 'nowrap'}}>{t('dailyPlan.punchList')}</button>
      </div>

      {/* Tasks header: title + active toggle + search/date + add button */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
          <h1 style={{fontWeight: 800, margin: 0, fontSize: '20px'}}>{t('dailyPlan.tasks')}</h1>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
          {/* Date — always visible, charcoal color */}
          <span style={{fontSize: '15px', fontWeight: 600, color: 'var(--charcoal)'}}>
            {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'})}
          </span>
          {/* Calendar icon — opens date picker directly */}
          <div style={{position: 'relative', display: 'inline-flex'}}>
            <button onClick={() => {
              const dateInput = document.getElementById('task-date-picker');
              if (dateInput) { dateInput.showPicker ? dateInput.showPicker() : dateInput.click(); }
            }} style={{
              width: '36px', height: '36px', borderRadius: '8px', border: '2px solid #ccc', background: 'white',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </button>
            <input id="task-date-picker" type="date" value={selectedDate} onChange={e => { setSelectedDate(e.target.value); setViewMode('date'); }}
              style={{position: 'absolute', top: 0, left: 0, width: '36px', height: '36px', opacity: 0, cursor: 'pointer'}} />
          </div>
          {!showAddTask && (
            <button className="btn btn-primary" style={{padding: '8px 16px', fontWeight: 700, fontSize: '14px'}} onClick={() => { setShowAddTask(true); setShowVoiceRefine(false); }}>
              {t('dailyPlan.addTask')}
            </button>
          )}
        </div>
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
              autoStart
              onAccept={(fields) => {
                setNewTask(t => {
                  const updated = { ...t, ...fields };
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
            <div style={{display: 'flex', justifyContent: 'center', marginBottom: '12px'}}>
              <button onClick={() => setShowVoiceRefine(true)} className="refine-mic-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--primary)" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/></svg>
                {t('dailyPlan.speakTask')}
              </button>
            </div>
          )}
          <input type="text" placeholder={t('dailyPlan.taskTitle')} value={newTask.title} onChange={e => setNewTask(t => ({...t, title: e.target.value}))}
            style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', boxSizing: 'border-box'}} />
          <textarea placeholder={t('dailyPlan.description')} value={newTask.description} onChange={e => setNewTask(t => ({...t, description: e.target.value}))}
            rows={2} style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', resize: 'none', boxSizing: 'border-box'}} />
          <div style={{display: 'flex', gap: '8px', marginBottom: '12px'}}>
            {/* Multi-select Assign To — takes most space */}
            <div style={{flex: 3, position: 'relative'}}>
              <button type="button" onClick={() => setShowAssignDropdown(!showAssignDropdown)}
                style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: newTask.assigned_to.length ? 'var(--charcoal)' : '#999', boxSizing: 'border-box', minHeight: '48px', background: 'white', textAlign: 'left', cursor: 'pointer', fontWeight: newTask.assigned_to.length ? 700 : 400}}>
                {newTask.assigned_to.length ? team.filter(p => newTask.assigned_to.includes(p.id)).map(p => p.name).join(', ') : t('dailyPlan.assignTo')}
              </button>
              {showAssignDropdown && (
                <div style={{position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '2px solid #ccc', borderRadius: '8px', marginTop: '4px', zIndex: 10, maxHeight: '250px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'}}>
                  {team.map(p => {
                    const isChecked = newTask.assigned_to.includes(p.id);
                    return (
                      <label key={p.id} style={{display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontSize: '14px', fontWeight: 600, background: isChecked ? '#f9f5f0' : 'white'}}>
                        <input type="checkbox" checked={isChecked} onChange={() => {
                          setNewTask(t => ({...t, assigned_to: isChecked ? t.assigned_to.filter(id => id !== p.id) : [...t.assigned_to, p.id]}));
                        }} style={{width: '20px', height: '20px', accentColor: 'var(--primary)', flexShrink: 0}} />
                        <span>{p.name}</span>
                        <span style={{fontSize: '12px', color: 'var(--charcoal)', marginLeft: 'auto'}}>{p.role_title}</span>
                        {jsaStatuses[p.id] && (
                          <span style={{
                            width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
                            background: jsaStatuses[p.id].status === 'match' ? '#4CAF50'
                              : jsaStatuses[p.id].status === 'has_jsa' ? '#4CAF50'
                              : jsaStatuses[p.id].status === 'mismatch' ? '#E8922A'
                              : '#ccc',
                          }} title={jsaStatuses[p.id].status === 'no_jsa' ? 'No JSA' : jsaStatuses[p.id].jsa_number || 'JSA'} />
                        )}
                      </label>
                    );
                  })}
                  <button onClick={() => setShowAssignDropdown(false)} style={{width: '100%', padding: '10px', border: 'none', background: 'var(--charcoal)', color: 'var(--primary)', fontSize: '14px', fontWeight: 700, cursor: 'pointer', borderRadius: '0 0 6px 6px'}}>{t('common.done')}</button>
                </div>
              )}
            </div>
            {/* Priority — same height as Assign To but narrower */}
            <select value={newTask.priority} onChange={e => setNewTask(t => ({...t, priority: e.target.value}))}
              style={{flex: 0, width: '110px', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', boxSizing: 'border-box', minHeight: '48px'}}>
              <option value="normal">{t('dailyPlan.normal')}</option>
              <option value="low">{t('dailyPlan.low')}</option>
              <option value="high">{t('dailyPlan.high')}</option>
              <option value="critical">{t('dailyPlan.critical')}</option>
            </select>
          </div>
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
                  <button onClick={() => removeAttachment(i)} style={{background: 'none', border: 'none', color: 'var(--charcoal)', fontSize: '14px', cursor: 'pointer', padding: '0 2px'}}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Attachments row: Photo, File, Form */}
          <div style={{display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap'}}>
            <div style={{position: 'relative', flex: 1, minWidth: '80px'}}>
              <button onClick={() => setShowTaskPhotoChoice(!showTaskPhotoChoice)} style={{
                padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0, minWidth: '18px'}}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                {t('common.photo')}
              </button>
              {showTaskPhotoChoice && (
                <Fragment>
                  <div onClick={() => setShowTaskPhotoChoice(false)} style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9}} />
                  <div style={{position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px', background: 'white', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 10, overflow: 'hidden', minWidth: '140px'}}>
                    <button onClick={() => { taskPhotoRef.current?.click(); setShowTaskPhotoChoice(false); }} style={{display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #eee'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>{t('common.camera')}</span>
                    </button>
                    <button onClick={() => { taskGalleryRef.current?.click(); setShowTaskPhotoChoice(false); }} style={{display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>{t('common.gallery')}</span>
                    </button>
                  </div>
                </Fragment>
              )}
            </div>
            <button onClick={() => taskFileRef.current?.click()} style={{
              padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
              fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '80px',
            }}>
              📎 {t('common.file')}
            </button>
            <button style={{
              padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
              fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '80px',
            }} onClick={() => { if (onNavigate) onNavigate('forms'); }}>
              📝 {t('dailyPlan.form')}
            </button>
          </div>
          {/* Add / Cancel row */}
          <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
            <button className="btn btn-secondary" style={{padding: '12px 20px', fontSize: '15px', flex: 1, minWidth: '120px'}} onClick={() => { setShowAddTask(false); setTaskAttachments([]); setShowTaskPhotoChoice(false); }}>{t('common.cancel')}</button>
            <button className="btn btn-primary" style={{padding: '12px 20px', fontWeight: 700, fontSize: '15px', flex: 1, minWidth: '120px'}} onClick={addTask}>{t('dailyPlan.add')}</button>
          </div>
        </div>
      )}

      {loading && <p style={{color: 'var(--charcoal)'}}>{t('common.loading')}</p>}

      {!loading && tasks.length === 0 && !showAddTask && (
        <div style={{textAlign: 'center', padding: '40px 0', color: 'var(--charcoal)'}}>
          <p style={{fontSize: '16px'}}>{t('dailyPlan.noTasks')}</p>
          <p style={{fontSize: '14px', cursor: 'pointer'}} onClick={() => setShowAddTask(true)}>{t('dailyPlan.addTask')}</p>
        </div>
      )}

      {/* Task list — bubble pattern grouped by person */}
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
          <div key={task.id} onClick={() => { if (onNavigate) onNavigate('taskdetail', { taskId: task.id }); }} style={{
            background: 'white', borderRadius: '8px', padding: '10px 12px', marginBottom: '6px',
            borderLeft: `4px solid ${statusColors[task.status] || '#999'}`,
            opacity: task.status === 'completed' ? 0.7 : 1,
            cursor: 'pointer', borderBottom: '1px solid #f0f0f0',
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px'}}>
              <button onClick={(e) => { e.stopPropagation(); updateTaskStatus(task.id, task.status === 'completed' ? 'pending' : 'completed'); }}
                style={{width: '22px', height: '22px', borderRadius: '6px', border: `2px solid ${statusColors[task.status]}`, background: task.status === 'completed' ? '#4CAF50' : 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'white', fontSize: '13px', padding: 0}}>
                {task.status === 'completed' ? '✓' : ''}
              </button>
              <span style={{fontSize: '14px', fontWeight: 700, color: 'var(--charcoal)', textDecoration: task.status === 'completed' ? 'line-through' : 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{task.title}</span>
              <span style={{fontSize: '12px', color: priorityColors[task.priority], fontWeight: 600, flexShrink: 0}}>{task.priority !== 'normal' ? task.priority.toUpperCase() : ''}</span>
            </div>
            {task.description && <p style={{fontSize: '12px', color: 'var(--charcoal)', margin: '0 0 0 30px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{task.description}</p>}
          </div>
        );

        // Expanded bubble view — full screen for one person
        if (selectedBubble !== null) {
          const group = byPerson[selectedBubble];
          if (!group) { setSelectedBubble(null); return null; }
          return (
            <div>
              <button onClick={() => setSelectedBubble(null)} style={{background: 'none', border: 'none', fontSize: '15px', fontWeight: 700, color: 'var(--primary)', cursor: 'pointer', marginBottom: '16px', padding: 0}}>
                ← Back to all
              </button>
              <div style={{background: 'var(--charcoal)', color: 'var(--primary)', padding: '14px 20px', borderRadius: '16px 16px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                <span style={{fontWeight: 700, fontSize: '16px'}}>{group.name}</span>
                <span style={{background: 'var(--primary)', color: 'white', borderRadius: '14px', padding: '2px 12px', fontSize: '14px', fontWeight: 700, minWidth: '28px', textAlign: 'center'}}>{group.tasks.length}</span>
              </div>
              <div style={{border: '2px solid var(--gray-200)', borderTop: 'none', borderRadius: '0 0 16px 16px', padding: '12px 16px'}}>
                {group.tasks.map(renderTaskCard)}
              </div>
            </div>
          );
        }

        // Bubble grid view
        return (
          <div className="people-grid">
            {personOrder.map(key => {
              const group = byPerson[key];
              const preview = group.tasks.slice(0, 4);
              const remaining = group.tasks.length - preview.length;
              return (
                <div key={key} className="people-category-bubble">
                  <div className="people-category-header" onClick={() => setSelectedBubble(key)} style={{cursor: 'pointer'}}>
                    <span className="people-category-label" style={{flex: 1}}>{group.name}</span>
                    <span className="people-category-count">{group.tasks.length}</span>
                    <span style={{fontSize: '14px', marginLeft: '4px', color: 'white'}}>▶</span>
                  </div>
                  <div className="people-category-body" style={{maxHeight: '280px', overflowY: 'auto'}}>
                    {preview.map(renderTaskCard)}
                    {remaining > 0 && (
                      <div onClick={() => setSelectedBubble(key)} style={{fontSize: '13px', color: 'var(--primary)', textAlign: 'center', padding: '8px', cursor: 'pointer', fontWeight: 600}}>
                        +{remaining} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
