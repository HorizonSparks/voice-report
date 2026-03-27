import { useState, useEffect, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceRefinePanel from '../components/VoiceRefinePanel.jsx';

export default function PunchListView({ user, embedded, onNavigate, goBack }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ title: '', description: '', location: '', priority: 'normal', trade: user.trade || 'Electrical', assigned_to: [] });
  const [punchAttachments, setPunchAttachments] = useState([]);
  const punchPhotoRef = useRef(null);
  const punchGalleryRef = useRef(null);
  const punchFileRef = useRef(null);
  const [showPunchPhotoChoice, setShowPunchPhotoChoice] = useState(false);
  const [filter, setFilter] = useState('open');
  const [stats, setStats] = useState({ open: 0, in_progress: 0, ready_recheck: 0, closed: 0 });
  const [showPunchVoiceRefine, setShowPunchVoiceRefine] = useState(false);
  const [team, setTeam] = useState([]);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const personId = user.person_id;
  const isSupervisor = (user.role_level || 1) >= 2;

  useEffect(() => { loadItems(); loadStats(); loadTeam(); }, [filter]);

  const loadTeam = async () => {
    try {
      const res = await fetch('/api/people');
      const all = await res.json();
      const people = Array.isArray(all) ? all : (all.people || []);
      const me = people.find(p => p.id === personId);
      if (!me) return;
      const mySuper = me.supervisor_id;
      const myTrade = me.trade;
      // Show people in same crew (same supervisor + same trade) OR direct reports
      const crewmates = people.filter(p =>
        p.id !== personId &&
        p.trade === myTrade &&
        (p.supervisor_id === mySuper || p.supervisor_id === personId || p.id === mySuper)
      );
      setTeam(crewmates);
    } catch(e) { console.error(e); }
  };

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
    setNewItem({ title: '', description: '', location: '', priority: 'normal', trade: user.trade || 'Electrical', assigned_to: [] });
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
  const statusLabels = { open: t('punchList.open'), in_progress: t('punchList.inProgress'), ready_recheck: t('punchList.recheck'), closed: t('punchList.closed') };
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
    <Fragment>
      {/* Header row: title (if standalone) */}
      {!embedded && <h1 style={{fontWeight: 800, marginBottom: '16px'}}>{t('punchList.title')}</h1>}

      {/* Status filters + Add button: same line on tablet+, stacked on phone */}
      <div className="punch-filter-row">
        <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
          {['open', 'in_progress', 'ready_recheck', 'closed'].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{
              padding: '6px 12px', borderRadius: '20px', border: 'none', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
              background: filter === s ? statusColors[s] : 'white',
              color: filter === s ? 'white' : statusColors[s],
              boxShadow: filter === s ? 'none' : `inset 0 0 0 2px ${statusColors[s]}`,
            }}>
              {statusLabels[s]} ({stats[s] || 0})
            </button>
          ))}
        </div>
        {!showAdd && (
          <button className="btn btn-primary" style={{padding: '8px 16px', fontWeight: 700, fontSize: '14px', flexShrink: 0}} onClick={() => { setShowAdd(true); }}>
            {t('punchList.new')}
          </button>
        )}
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
              autoStart
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
                {t('punchList.describeIssue')}
              </button>
            </div>
          )}
          <input type="text" placeholder={t('punchList.whatsIssue')} value={newItem.title} onChange={e => setNewItem(t => ({...t, title: e.target.value}))}
            style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', boxSizing: 'border-box'}} />
          <textarea placeholder={t('punchList.details')} value={newItem.description} onChange={e => setNewItem(t => ({...t, description: e.target.value}))}
            rows={2} style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', resize: 'none', boxSizing: 'border-box'}} />
          <input type="text" placeholder={t('punchList.location')} value={newItem.location} onChange={e => setNewItem(t => ({...t, location: e.target.value}))}
            style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', marginBottom: '8px', boxSizing: 'border-box'}} />
          {/* Assign To + Priority */}
          <div style={{display: 'flex', gap: '8px', marginBottom: '8px'}}>
            <div style={{flex: 3, position: 'relative'}}>
              <button type="button" onClick={() => setShowAssignDropdown(!showAssignDropdown)}
                style={{width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: newItem.assigned_to.length ? 'var(--charcoal)' : '#999', boxSizing: 'border-box', minHeight: '48px', background: 'white', textAlign: 'left', cursor: 'pointer', fontWeight: newItem.assigned_to.length ? 700 : 400}}>
                {newItem.assigned_to.length ? team.filter(p => newItem.assigned_to.includes(p.id)).map(p => p.name).join(', ') : t('dailyPlan.assignTo')}
              </button>
              {showAssignDropdown && (
                <div style={{position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '2px solid #ccc', borderRadius: '8px', marginTop: '4px', zIndex: 10, maxHeight: '250px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'}}>
                  {team.map(p => {
                    const isChecked = newItem.assigned_to.includes(p.id);
                    return (
                      <label key={p.id} style={{display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontSize: '14px', fontWeight: 600, background: isChecked ? '#f9f5f0' : 'white'}}>
                        <input type="checkbox" checked={isChecked} onChange={() => {
                          setNewItem(t => ({...t, assigned_to: isChecked ? t.assigned_to.filter(id => id !== p.id) : [...t.assigned_to, p.id]}));
                        }} style={{width: '20px', height: '20px', accentColor: 'var(--primary)', flexShrink: 0}} />
                        <span>{p.name}</span>
                        <span style={{fontSize: '12px', color: 'var(--charcoal)', marginLeft: 'auto'}}>{p.role_title}</span>
                      </label>
                    );
                  })}
                  <button onClick={() => setShowAssignDropdown(false)} style={{width: '100%', padding: '10px', border: 'none', background: 'var(--charcoal)', color: 'var(--primary)', fontSize: '14px', fontWeight: 700, cursor: 'pointer', borderRadius: '0 0 6px 6px'}}>{t('common.done')}</button>
                </div>
              )}
            </div>
            <select value={newItem.priority} onChange={e => setNewItem(t => ({...t, priority: e.target.value}))}
              style={{flex: 1, padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', boxSizing: 'border-box', minHeight: '48px', maxWidth: '120px', WebkitAppearance: 'none', appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M6 8L1 3h10z\' fill=\'%23999\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center'}}>
              <option value="normal">{t('dailyPlan.normal')}</option>
              <option value="low">{t('dailyPlan.low')}</option>
              <option value="high">{t('dailyPlan.high')}</option>
              <option value="critical">{t('dailyPlan.critical')}</option>
            </select>
          </div>
          {/* Trade selector */}
          <div style={{marginBottom: '12px'}}>
            <select value={newItem.trade} onChange={e => setNewItem(t => ({...t, trade: e.target.value}))}
              style={{flex: 3, padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: 'var(--charcoal)', boxSizing: 'border-box', minHeight: '48px', WebkitAppearance: 'none', appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M6 8L1 3h10z\' fill=\'%23999\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center'}}>
              <option value="Electrical">{t('trades.electrical')}</option>
              <option value="Instrumentation">{t('trades.instrumentation')}</option>
              <option value="Pipe Fitting">{t('trades.pipeFitting')}</option>
              <option value="Industrial Erection">{t('trades.erection')}</option>
              <option value="Safety">{t('trades.safety')}</option>
            </select>
          </div>
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
                  <button onClick={() => setPunchAttachments(prev => prev.filter((_, idx) => idx !== i))} style={{background: 'none', border: 'none', color: 'var(--charcoal)', fontSize: '14px', cursor: 'pointer', padding: '0 2px'}}>✕</button>
                </div>
              ))}
            </div>
          )}
          {/* Action row: Photo, File, Form, Add, Cancel */}
          <div style={{display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap'}}>
            <div style={{position: 'relative', flex: 1, minWidth: '80px'}}>
              <button onClick={() => setShowPunchPhotoChoice(!showPunchPhotoChoice)} style={{
                padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0, minWidth: '18px'}}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                {t('common.photo')}
              </button>
              {showPunchPhotoChoice && (
                <Fragment>
                  <div onClick={() => setShowPunchPhotoChoice(false)} style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9}} />
                  <div style={{position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px', background: 'white', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 10, overflow: 'hidden', minWidth: '140px'}}>
                    <button onClick={() => { punchPhotoRef.current?.click(); setShowPunchPhotoChoice(false); }} style={{display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #eee'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>{t('common.camera')}</span>
                    </button>
                    <button onClick={() => { punchGalleryRef.current?.click(); setShowPunchPhotoChoice(false); }} style={{display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>{t('common.gallery')}</span>
                    </button>
                  </div>
                </Fragment>
              )}
            </div>
            <button onClick={() => punchFileRef.current?.click()} style={{
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
          {/* Cancel / Add row — separate line */}
          <div style={{display: 'flex', gap: '8px', marginTop: '8px'}}>
            <button className="btn btn-secondary" style={{flex: 1, padding: '14px', fontSize: '15px', fontWeight: 700, minWidth: '120px'}} onClick={() => { setShowAdd(false); setPunchAttachments([]); setShowPunchPhotoChoice(false); }}>{t('common.cancel')}</button>
            <button className="btn btn-primary" style={{flex: 1, padding: '14px', fontWeight: 700, fontSize: '15px', minWidth: '120px'}} onClick={addItem}>{t('common.add')}</button>
          </div>
        </div>
      )}

      {loading && <p style={{color: 'var(--charcoal)'}}>{t('common.loading')}</p>}

      {!loading && items.length === 0 && (
        <div style={{textAlign: 'center', padding: '40px 0', color: 'var(--charcoal)'}}>
          <p style={{fontSize: '16px'}}>{statusLabels[filter]}</p>
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
              {item.description && <p style={{fontSize: '13px', color: 'var(--charcoal)', margin: '0 0 6px'}}>{item.description}</p>}
              <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '12px'}}>
                {item.location && <span style={{background: '#f0ece8', borderRadius: '4px', padding: '2px 8px'}}>📍 {item.location}</span>}
                <span style={{background: '#f0ece8', borderRadius: '4px', padding: '2px 8px'}}>{item.trade}</span>
                {item.created_by_name && <span style={{color: 'var(--charcoal)'}}>by {item.created_by_name}</span>}
                {item.assigned_to_name && <span style={{fontWeight: 600}}>→ {item.assigned_to_name}</span>}
              </div>
            </div>
            {/* Status actions */}
            <div style={{display: 'flex', gap: '4px', flexShrink: 0, marginLeft: '8px'}}>
              {item.status === 'open' && <button onClick={() => updateStatus(item.id, 'in_progress')} style={{background: '#F99440', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer'}}>{t('common.start')}</button>}
              {item.status === 'in_progress' && <button onClick={() => updateStatus(item.id, 'ready_recheck')} style={{background: '#48484A', color: 'var(--primary)', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer'}}>{t('common.done')}</button>}
              {item.status === 'ready_recheck' && isSupervisor && <button onClick={() => updateStatus(item.id, 'closed')} style={{background: '#4CAF50', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer'}}>{t('common.close')}</button>}
              {item.status === 'ready_recheck' && isSupervisor && <button onClick={() => updateStatus(item.id, 'open')} style={{background: '#999', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer'}}>{t('common.reject')}</button>}
            </div>
          </div>
        </div>
      ))}
    </Fragment>
  );

  if (embedded) return content;
  return <div className="list-view">
    {content}
  </div>;
}
