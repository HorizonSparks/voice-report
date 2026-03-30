import { useState, useEffect, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Paper from '@mui/material/Paper';
import CircularProgress from '@mui/material/CircularProgress';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import VoiceRefinePanel from '../components/VoiceRefinePanel.jsx';

export default function PunchListView({ user, embedded, onNavigate, goBack, readOnly }) {
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
      {!embedded && <Typography variant="h1" sx={{ fontWeight: 800, mb: '16px' }}>{t('punchList.title')}</Typography>}

      {/* Status filters + Add button: same line on tablet+, stacked on phone */}
      <Box className="punch-filter-row">
        <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {['open', 'in_progress', 'ready_recheck', 'closed'].map(s => (
            <Button key={s} onClick={() => setFilter(s)} sx={{
              padding: '6px 12px', borderRadius: '20px', border: 'none', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
              background: filter === s ? statusColors[s] : 'white',
              color: filter === s ? 'white' : statusColors[s],
              boxShadow: filter === s ? 'none' : `inset 0 0 0 2px ${statusColors[s]}`,
              textTransform: 'none',
              minWidth: 'auto',
              '&:hover': {
                background: filter === s ? statusColors[s] : 'white',
              },
            }}>
              {statusLabels[s]} ({stats[s] || 0})
            </Button>
          ))}
        </Box>
        {!showAdd && (
          <Button className="btn btn-primary" sx={{ padding: '8px 16px', fontWeight: 700, fontSize: '14px', flexShrink: 0, textTransform: 'none' }} onClick={() => { setShowAdd(true); }}>
            {t('punchList.new')}
          </Button>
        )}
      </Box>

      {/* Add form */}
      {showAdd && (
        <Box sx={{ background: 'white', border: '2px solid', borderColor: 'primary.main', borderRadius: '12px', padding: '16px', mb: '16px' }}>
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
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: '4px', mb: '16px' }}>
              <Button onClick={() => setShowPunchVoiceRefine(true)} className="refine-mic-btn" sx={{ textTransform: 'none' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--primary)" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/></svg>
                {t('punchList.describeIssue')}
              </Button>
            </Box>
          )}
          <TextField placeholder={t('punchList.whatsIssue')} value={newItem.title} onChange={e => setNewItem(t => ({...t, title: e.target.value}))}
            fullWidth
            sx={{ mb: '8px', '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '15px', color: 'text.primary' }, '& .MuiOutlinedInput-notchedOutline': { borderWidth: '2px', borderColor: '#ccc' } }} />
          <TextField placeholder={t('punchList.details')} value={newItem.description} onChange={e => setNewItem(t => ({...t, description: e.target.value}))}
            multiline rows={2} fullWidth
            sx={{ mb: '8px', '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '15px', color: 'text.primary' }, '& .MuiOutlinedInput-notchedOutline': { borderWidth: '2px', borderColor: '#ccc' }, '& textarea': { resize: 'none' } }} />
          <TextField placeholder={t('punchList.location')} value={newItem.location} onChange={e => setNewItem(t => ({...t, location: e.target.value}))}
            fullWidth
            sx={{ mb: '8px', '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '15px', color: 'text.primary' }, '& .MuiOutlinedInput-notchedOutline': { borderWidth: '2px', borderColor: '#ccc' } }} />
          {/* Assign To + Priority */}
          <Box sx={{ display: 'flex', gap: '8px', mb: '8px' }}>
            <Box sx={{ flex: 3, position: 'relative' }}>
              <Button type="button" onClick={() => setShowAssignDropdown(!showAssignDropdown)}
                sx={{ width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', color: newItem.assigned_to.length ? 'text.primary' : '#999', boxSizing: 'border-box', minHeight: '48px', background: 'white', textAlign: 'left', cursor: 'pointer', fontWeight: newItem.assigned_to.length ? 700 : 400, textTransform: 'none', justifyContent: 'flex-start', '&:hover': { background: 'white' } }}>
                {newItem.assigned_to.length ? team.filter(p => newItem.assigned_to.includes(p.id)).map(p => p.name).join(', ') : t('dailyPlan.assignTo')}
              </Button>
              {showAssignDropdown && (
                <Box sx={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '2px solid #ccc', borderRadius: '8px', mt: '4px', zIndex: 10, maxHeight: '250px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                  {team.map(p => {
                    const isChecked = newItem.assigned_to.includes(p.id);
                    return (
                      <Box component="label" key={p.id} sx={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontSize: '14px', fontWeight: 600, background: isChecked ? '#f9f5f0' : 'white' }}>
                        <Checkbox checked={isChecked} onChange={() => {
                          setNewItem(t => ({...t, assigned_to: isChecked ? t.assigned_to.filter(id => id !== p.id) : [...t.assigned_to, p.id]}));
                        }} sx={{ width: '20px', height: '20px', color: 'primary.main', '&.Mui-checked': { color: 'primary.main' }, flexShrink: 0, padding: 0 }} />
                        <Typography component="span">{p.name}</Typography>
                        <Typography component="span" sx={{ fontSize: '12px', color: 'text.primary', ml: 'auto' }}>{p.role_title}</Typography>
                      </Box>
                    );
                  })}
                  <Button onClick={() => setShowAssignDropdown(false)} sx={{ width: '100%', padding: '10px', border: 'none', background: 'text.primary', bgcolor: 'text.primary', color: 'primary.main', fontSize: '14px', fontWeight: 700, cursor: 'pointer', borderRadius: '0 0 6px 6px', textTransform: 'none', '&:hover': { bgcolor: 'text.primary' } }}>{t('common.done')}</Button>
                </Box>
              )}
            </Box>
            <Select value={newItem.priority} onChange={e => setNewItem(t => ({...t, priority: e.target.value}))}
              sx={{ flex: 1, maxWidth: '120px', '& .MuiOutlinedInput-notchedOutline': { borderWidth: '2px', borderColor: '#ccc', borderRadius: '8px' }, fontSize: '15px', color: 'text.primary', minHeight: '48px' }}>
              <MenuItem value="normal">{t('dailyPlan.normal')}</MenuItem>
              <MenuItem value="low">{t('dailyPlan.low')}</MenuItem>
              <MenuItem value="high">{t('dailyPlan.high')}</MenuItem>
              <MenuItem value="critical">{t('dailyPlan.critical')}</MenuItem>
            </Select>
          </Box>
          {/* Trade selector */}
          <Box sx={{ mb: '12px' }}>
            <Select value={newItem.trade} onChange={e => setNewItem(t => ({...t, trade: e.target.value}))}
              sx={{ flex: 3, '& .MuiOutlinedInput-notchedOutline': { borderWidth: '2px', borderColor: '#ccc', borderRadius: '8px' }, fontSize: '15px', color: 'text.primary', minHeight: '48px' }}>
              <MenuItem value="Electrical">{t('trades.electrical')}</MenuItem>
              <MenuItem value="Instrumentation">{t('trades.instrumentation')}</MenuItem>
              <MenuItem value="Pipe Fitting">{t('trades.pipeFitting')}</MenuItem>
              <MenuItem value="Industrial Erection">{t('trades.erection')}</MenuItem>
              <MenuItem value="Safety">{t('trades.safety')}</MenuItem>
            </Select>
          </Box>
          {/* Attachment previews */}
          <input ref={punchPhotoRef} type="file" accept="image/*" capture="environment" style={{display: 'none'}} onChange={e => handlePunchAttachment(e, 'photo')} />
          <input ref={punchGalleryRef} type="file" accept="image/*" style={{display: 'none'}} onChange={e => handlePunchAttachment(e, 'photo')} />
          <input ref={punchFileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.dwg,.txt" multiple style={{display: 'none'}} onChange={e => handlePunchAttachment(e, 'file')} />
          {punchAttachments.length > 0 && (
            <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', mb: '12px' }}>
              {punchAttachments.map((att, i) => (
                <Box key={i} sx={{ position: 'relative', background: '#f0ece8', borderRadius: '8px', padding: '6px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {att.preview ? <Box component="img" src={att.preview} sx={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover' }} alt="" /> : <Typography component="span">📎</Typography>}
                  <Typography component="span" sx={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</Typography>
                  <Button onClick={() => setPunchAttachments(prev => prev.filter((_, idx) => idx !== i))} sx={{ background: 'none', border: 'none', color: 'text.primary', fontSize: '14px', cursor: 'pointer', padding: '0 2px', minWidth: 'auto' }}>✕</Button>
                </Box>
              ))}
            </Box>
          )}
          {/* Action row: Photo, File, Form, Add, Cancel */}
          <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <Box sx={{ position: 'relative', flex: 1, minWidth: '80px' }}>
              <Button onClick={() => setShowPunchPhotoChoice(!showPunchPhotoChoice)} sx={{
                padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
                textTransform: 'none', '&:hover': { background: 'white' },
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0, minWidth: '18px'}}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                {t('common.photo')}
              </Button>
              {showPunchPhotoChoice && (
                <Fragment>
                  <Box onClick={() => setShowPunchPhotoChoice(false)} sx={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9 }} />
                  <Paper sx={{ position: 'absolute', bottom: '100%', left: 0, mb: '4px', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 10, overflow: 'hidden', minWidth: '140px' }}>
                    <Button onClick={() => { punchPhotoRef.current?.click(); setShowPunchPhotoChoice(false); }} sx={{ display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #eee', textTransform: 'none', '&:hover': { background: '#f5f5f5' } }}>
                      <Typography component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>{t('common.camera')}</Typography>
                    </Button>
                    <Button onClick={() => { punchGalleryRef.current?.click(); setShowPunchPhotoChoice(false); }} sx={{ display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', textTransform: 'none', '&:hover': { background: '#f5f5f5' } }}>
                      <Typography component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>{t('common.gallery')}</Typography>
                    </Button>
                  </Paper>
                </Fragment>
              )}
            </Box>
            <Button onClick={() => punchFileRef.current?.click()} sx={{
              padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
              fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '80px',
              textTransform: 'none', '&:hover': { background: 'white' },
            }}>
              📎 {t('common.file')}
            </Button>
            <Button sx={{
              padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', background: 'white',
              fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '80px',
              textTransform: 'none', '&:hover': { background: 'white' },
            }} onClick={() => { if (onNavigate) onNavigate('forms'); }}>
              📝 {t('dailyPlan.form')}
            </Button>
          </Box>
          {/* Cancel / Add row — separate line */}
          <Box sx={{ display: 'flex', gap: '8px', mt: '8px' }}>
            <Button className="btn btn-secondary" sx={{ flex: 1, padding: '14px', fontSize: '15px', fontWeight: 700, minWidth: '120px', textTransform: 'none' }} onClick={() => { setShowAdd(false); setPunchAttachments([]); setShowPunchPhotoChoice(false); }}>{t('common.cancel')}</Button>
            <Button className="btn btn-primary" sx={{ flex: 1, padding: '14px', fontWeight: 700, fontSize: '15px', minWidth: '120px', textTransform: 'none' }} onClick={addItem}>{t('common.add')}</Button>
          </Box>
        </Box>
      )}

      {loading && <CircularProgress sx={{ display: 'block', mx: 'auto', my: 2 }} />}

      {!loading && items.length === 0 && (
        <Box sx={{ textAlign: 'center', padding: '40px 0', color: 'text.primary' }}>
          <Typography sx={{ fontSize: '16px' }}>{statusLabels[filter]}</Typography>
        </Box>
      )}

      {/* Items list */}
      {items.map(item => (
        <Paper key={item.id} sx={{
          borderRadius: '12px', padding: '14px 16px', mb: '8px',
          borderLeft: `4px solid ${statusColors[item.status]}`,
        }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: '15px', fontWeight: 700, color: 'text.primary', mb: '4px' }}>
                {priorityIcons[item.priority]} {item.title}
              </Typography>
              {item.description && <Typography sx={{ fontSize: '13px', color: 'text.primary', margin: '0 0 6px' }}>{item.description}</Typography>}
              <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '12px' }}>
                {item.location && <Typography component="span" sx={{ background: '#f0ece8', borderRadius: '4px', padding: '2px 8px' }}>📍 {item.location}</Typography>}
                <Typography component="span" sx={{ background: '#f0ece8', borderRadius: '4px', padding: '2px 8px' }}>{item.trade}</Typography>
                {item.created_by_name && <Typography component="span" sx={{ color: 'text.primary' }}>by {item.created_by_name}</Typography>}
                {item.assigned_to_name && <Typography component="span" sx={{ fontWeight: 600 }}>→ {item.assigned_to_name}</Typography>}
              </Box>
            </Box>
            {/* Status actions */}
            <Box sx={{ display: 'flex', gap: '4px', flexShrink: 0, ml: '8px' }}>
              {item.status === 'open' && <Button onClick={() => updateStatus(item.id, 'in_progress')} sx={{ background: 'primary.main', bgcolor: '#F99440', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', textTransform: 'none', minWidth: 'auto', '&:hover': { bgcolor: '#e0853a' } }}>{t('common.start')}</Button>}
              {item.status === 'in_progress' && <Button onClick={() => updateStatus(item.id, 'ready_recheck')} sx={{ bgcolor: '#48484A', color: 'primary.main', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', textTransform: 'none', minWidth: 'auto', '&:hover': { bgcolor: '#3a3a3c' } }}>{t('common.done')}</Button>}
              {item.status === 'ready_recheck' && isSupervisor && <Button onClick={() => updateStatus(item.id, 'closed')} sx={{ bgcolor: 'success.main', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', textTransform: 'none', minWidth: 'auto', '&:hover': { bgcolor: '#43a047' } }}>{t('common.close')}</Button>}
              {item.status === 'ready_recheck' && isSupervisor && <Button onClick={() => updateStatus(item.id, 'open')} sx={{ bgcolor: '#999', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', textTransform: 'none', minWidth: 'auto', '&:hover': { bgcolor: '#888' } }}>{t('common.reject')}</Button>}
            </Box>
          </Box>
        </Paper>
      ))}
    </Fragment>
  );

  if (embedded) return content;
  return <Box className="list-view">
    {content}
  </Box>;
}
