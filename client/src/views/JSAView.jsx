import { useState, useEffect, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Typography, Button, TextField, Paper, CircularProgress,
  Select, MenuItem, Checkbox, Chip
} from '@mui/material';

export default function JSAView({ user, goHome, activeTrade, readOnly }) {
  const { t } = useTranslation();
  const [team, setTeam] = useState([]);
  const [jsaList, setJsaList] = useState([]);
  const [sharedWithMe, setSharedWithMe] = useState([]);
  const [pendingAcks, setPendingAcks] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [activeJSA, setActiveJSA] = useState(null);
  const [creating, setCreating] = useState(false);
  const [signing, setSigning] = useState(null); // JSA being signed
  const [viewingJSA, setViewingJSA] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({});
  const [formFields, setFormFields] = useState([]);
  const [selectedCrew, setSelectedCrew] = useState([]);
  const [showCrewPicker, setShowCrewPicker] = useState(false);
  const [addingSignature, setAddingSignature] = useState(false); // foreman adding signature for someone without phone

  const personId = user.person_id;
  const roleLevel = parseInt(user.role_level || 0);
  const isForeman = roleLevel >= 2;
  const isSafety = (user.trade === 'Safety') || user.is_admin;

  useEffect(() => { loadJSAs(); loadFormFields(); loadTeam(); }, []);

  const loadTeam = async () => {
    try {
      const res = await fetch('/api/people');
      const data = await res.json();
      const allPeople = Array.isArray(data) ? data : (data.people || []);

      // First filter to same trade
      const myTrade = user.trade || activeTrade || '';
      const sameTrade = allPeople.filter(p => p.trade === myTrade);
      const myLevel = parseInt(user.role_level || 0);
      const mySupervisorId = user.supervisor_id;

      // JSA crew logic:
      // - Your direct supervisor (one level up)
      // - People at your level or below who share your supervisor (crew mates + helpers)
      // - People you directly supervise (if you're a foreman)
      const myCrew = sameTrade.filter(p => {
        if (p.id === personId) return false;

        // My direct supervisor
        if (mySupervisorId && p.id === mySupervisorId) return true;

        // Same supervisor as me (crew mates + helpers)
        if (mySupervisorId && p.supervisor_id === mySupervisorId) return true;

        // People I directly supervise
        if (p.supervisor_id === personId) return true;

        return false;
      });

      // Sort: supervisor first, then by level descending, then alphabetical
      myCrew.sort((a, b) => {
        if (a.id === mySupervisorId) return -1;
        if (b.id === mySupervisorId) return 1;
        const levelDiff = parseInt(b.role_level || 0) - parseInt(a.role_level || 0);
        if (levelDiff !== 0) return levelDiff;
        return (a.name || '').localeCompare(b.name || '');
      });

      // Add self to the list
      const selfEntry = { id: personId, name: user.name, role_title: user.role_title || '', role_level: myLevel, supervisor_id: mySupervisorId, isSelf: true };
      const allCrew = [selfEntry, ...myCrew];
      // Sort: foreman first, then self, then by level desc, then alpha
      allCrew.sort((a, b) => {
        if (a.id === mySupervisorId && b.id !== mySupervisorId) return -1;
        if (b.id === mySupervisorId && a.id !== mySupervisorId) return 1;
        if (a.isSelf && !b.isSelf) return -1;
        if (b.isSelf && !a.isSelf) return 1;
        const levelDiff = parseInt(b.role_level || 0) - parseInt(a.role_level || 0);
        if (levelDiff !== 0) return levelDiff;
        return (a.name || '').localeCompare(b.name || '');
      });
      setTeam(allCrew);
    } catch (err) { console.error('Failed to load team:', err); }
  };

  const loadJSAs = async () => {
    try {
      const res = await fetch(`/api/jsa?person_id=${personId}`);
      const data = await res.json();
      setJsaList(data.jsas || []);
      setSharedWithMe(data.shared_with_me || []);
      setPendingAcks(data.pending_acknowledgments || []);

      const today = new Date().toISOString().split('T')[0];
      const todayActive = (data.jsas || []).find(j => j.date === today && j.status === 'active');
      if (todayActive) setActiveJSA(todayActive);

      if (isForeman || isSafety) {
        const pendRes = await fetch(`/api/jsa/pending?approver_id=${personId}&role=${isSafety ? 'safety' : 'foreman'}`);
        const pendData = await pendRes.json();
        setPendingApprovals(pendData.pending || []);
      }
    } catch (err) { console.error('Failed to load JSAs:', err); }
    finally { setLoading(false); }
  };

  const loadFormFields = async () => {
    try {
      const res = await fetch('/api/forms/templates');
      const data = await res.json();
      const templates = Array.isArray(data) ? data : (data.templates || []);
      const jsaTemplate = templates.find(t => t.form_code === 'HS-SF-001');
      if (jsaTemplate) {
        const fieldsRes = await fetch(`/api/forms/templates/${jsaTemplate.id}`);
        const fieldsData = await fieldsRes.json();
        setFormFields(fieldsData.fields || []);
      }
    } catch (err) { console.error('Failed to load form fields:', err); }
  };

  const createJSA = async (submitAfter = false) => {
    const today = new Date().toISOString().split('T')[0];
    const jsaData = {
      person_id: personId, person_name: user.name || 'Unknown',
      trade: user.trade || '', date: today,
      status: submitAfter ? 'pending_foreman' : 'draft',
      form_data: formData, supervisor_id: user.supervisor_id || null,
      crew_members: selectedCrew, mode: selectedCrew.length > 0 ? 'shared' : 'individual',
    };
    try {
      const res = await fetch('/api/jsa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jsaData) });
      const data = await res.json();
      if (data.success) { setCreating(false); setFormData({}); setSelectedCrew([]); loadJSAs(); }
    } catch (err) { console.error('Failed to create JSA:', err); }
  };

  const submitForApproval = async (jsaId) => {
    try { await fetch(`/api/jsa/${jsaId}/submit`, { method: 'POST' }); loadJSAs(); }
    catch (err) { console.error(err); }
  };

  const approveJSA = async (jsaId, role) => {
    try {
      await fetch(`/api/jsa/${jsaId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approver_id: personId, approver_name: user.name, role }) });
      loadJSAs();
    } catch (err) { console.error(err); }
  };

  const rejectJSA = async (jsaId, role) => {
    const reason = prompt('Reason for sending back:');
    if (!reason) return;
    try {
      await fetch(`/api/jsa/${jsaId}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approver_id: personId, role, reason }) });
      loadJSAs();
    } catch (err) { console.error(err); }
  };

  const signJSA = async (ackId, jsaId) => {
    try {
      await fetch('/api/jsa/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ack_id: ackId, jsa_id: jsaId, person_id: personId, person_name: user.name, signature: 'signed', signed_on_device: 'own' })
      });
      setSigning(null); loadJSAs();
    } catch (err) { console.error(err); }
  };

  const signForSomeone = async (jsaId, name) => {
    try {
      await fetch('/api/jsa/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsa_id: jsaId, person_name: name, signature: 'signed', signed_on_device: 'foreman' })
      });
      setAddingSignature(false); loadJSAs();
    } catch (err) { console.error(err); }
  };

  const statusColors = { draft: '#999', pending_foreman: '#F99440', pending_safety: '#F99440', active: '#4CAF50', rejected: '#C45500' };
  const statusLabels = { draft: t('jsa.draft'), pending_foreman: t('jsa.pendingForeman'), pending_safety: t('jsa.pendingSafety'), active: t('jsa.active'), rejected: t('jsa.rejected') };

  // Group form fields
  const groupedFields = {};
  const groupOrder = [];
  const groupLabels = {
    job_identification: t('jsa.jobIdentification'), crew_supervision: t('jsa.crewSupervision'),
    task_description: t('jsa.taskDescription'), permits_conditions: t('jsa.permitsConditions'),
    hazard_analysis: t('jsa.hazardAnalysis'), ppe_required: t('jsa.requiredPPE'),
    emergency_info: t('jsa.emergencyInfo'), crew_acknowledgment: t('jsa.crewAcknowledgment'),
    signatures: t('jsa.approvalSignatures'),
  };
  formFields.forEach(f => {
    const g = f.field_group || 'other';
    if (!groupedFields[g]) { groupedFields[g] = []; groupOrder.push(g); }
    groupedFields[g].push(f);
  });

  // Shared input sx
  const inputSx = { width: '100%', '& .MuiInputBase-root': { fontSize: '15px', minHeight: '48px' } };
  const selectSx = { width: '100%', fontSize: '15px', minHeight: '48px', background: 'white', color: 'text.primary' };
  const labelSx = { display: 'block', fontSize: '13px', fontWeight: 600, color: 'text.primary', mb: '4px' };

  // (Individual acknowledgment removed — simplified to group signatures)

  // ============================================================
  // VIEWING a JSA detail with acknowledgment progress
  // ============================================================
  if (viewingJSA) {
    const acks = viewingJSA.acknowledgments || [];
    const completed = acks.filter(a => a.status === 'completed').length;
    return (
      <Box sx={{ p: '20px', maxWidth: '800px', mx: 'auto' }}>
        <Button className="back-btn" onClick={() => setViewingJSA(null)}>&larr; Back</Button>
        <Typography variant="h1" sx={{ fontSize: '24px', fontWeight: 800, color: 'text.primary', mb: '4px' }}>{t('jsa.detail')}</Typography>
        <Typography sx={{ color: 'text.primary', fontSize: '14px', mb: '16px' }}>
          {viewingJSA.person_name} — {new Date(viewingJSA.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </Typography>

        {/* Status */}
        <Box sx={{ display: 'flex', gap: '8px', mb: '16px', alignItems: 'center' }}>
          <Chip label={statusLabels[viewingJSA.status]} sx={{
            fontSize: '13px', fontWeight: 700, px: '14px', borderRadius: '20px',
            backgroundColor: statusColors[viewingJSA.status] + '20', color: statusColors[viewingJSA.status]
          }} />
          {viewingJSA.foreman_name && <Typography sx={{ fontSize: '12px', color: 'text.primary' }}>Foreman: {viewingJSA.foreman_name} ✓</Typography>}
          {viewingJSA.safety_name && <Typography sx={{ fontSize: '12px', color: 'text.primary' }}>Safety: {viewingJSA.safety_name} ✓</Typography>}
        </Box>

        {/* Task description */}
        <fieldset style={{border: '2px solid #e0e0e0', borderRadius: '12px', padding: '16px', marginBottom: '16px'}}>
          <legend style={{fontSize: '13px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', padding: '0 8px'}}>{t('common.task')}</legend>
          <Typography sx={{ fontSize: '15px', color: 'text.primary', m: 0 }}>{viewingJSA.form_data?.task_description || t('common.noDescription')}</Typography>
          <Typography sx={{ fontSize: '13px', color: 'text.primary', mt: '8px' }}>
            Area: {viewingJSA.form_data?.work_area || 'TBD'} | Risk: {viewingJSA.form_data?.risk_level || 'TBD'}
          </Typography>
        </fieldset>

        {/* Crew signatures progress */}
        {acks.length > 0 && (
          <fieldset style={{border: '2px solid #e0e0e0', borderRadius: '12px', padding: '16px', marginBottom: '16px'}}>
            <legend style={{fontSize: '13px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', padding: '0 8px'}}>
              {t('jsa.crewSignatures')} ({completed} / {acks.length})
            </legend>
            {/* Progress bar */}
            <Box sx={{ height: '8px', background: '#e0e0e0', borderRadius: '4px', mb: '12px', overflow: 'hidden' }}>
              <Box sx={{ height: '100%', width: `${acks.length > 0 ? (completed / acks.length * 100) : 0}%`, bgcolor: completed === acks.length ? 'success.main' : 'primary.main', borderRadius: '4px', transition: 'width 0.3s' }} />
            </Box>
            {acks.map(ack => (
              <Box key={ack.id} sx={{ display: 'flex', alignItems: 'center', gap: '10px', py: '10px', borderBottom: '1px solid #f0f0f0' }}>
                <Typography sx={{ fontSize: '20px' }}>{ack.status === 'signed' ? '✅' : '⏳'}</Typography>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '14px', color: 'text.primary' }}>{ack.person_name}</Typography>
                  {ack.signed_on_device === 'foreman' && ack.status === 'signed' && (
                    <Typography sx={{ fontSize: '11px', color: 'text.primary' }}>{t('jsa.signedOnForemanDevice')}</Typography>
                  )}
                </Box>
                <Typography sx={{ fontSize: '12px', color: ack.status === 'signed' ? 'success.main' : '#999', fontWeight: 600 }}>
                  {ack.status === 'signed' ? `${t('jsa.signed')} ✓` : t('jsa.pending')}
                </Typography>
              </Box>
            ))}
            {/* Foreman: sign for someone without a phone */}
            {isForeman && (
              <Button onClick={() => {
                const name = prompt(t('jsa.enterNameToSign'));
                if (name && name.trim()) signForSomeone(viewingJSA.id, name.trim());
              }}
                sx={{ mt: '10px', width: '100%', p: '10px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '14px', fontWeight: 600, background: 'white', color: 'text.primary', cursor: 'pointer', textTransform: 'none' }}>
                {t('jsa.signForSomeone')}
              </Button>
            )}
          </fieldset>
        )}

        {/* Actions */}
        {viewingJSA.status === 'draft' && viewingJSA.person_id === personId && (
          <Button onClick={() => submitForApproval(viewingJSA.id)}
            sx={{ width: '100%', p: '14px 10px', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, background: 'primary.main', color: 'text.primary', cursor: 'pointer', textTransform: 'none' }}>
            {t('jsa.submitForApproval')}
          </Button>
        )}
      </Box>
    );
  }

  // ============================================================
  // CREATING new JSA
  // ============================================================
  if (creating) {
    return (
      <Box sx={{ p: '20px', maxWidth: '800px', mx: 'auto' }}>
        <Button className="back-btn" onClick={() => setCreating(false)}>&larr; Back</Button>
        <Typography variant="h1" sx={{ fontSize: '28px', fontWeight: 800, color: 'text.primary', mb: '2px' }}>{t('jsa.newJSA')}</Typography>
        <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'primary.main', fontStyle: 'italic', mb: '8px', mt: 0 }}>{t('jsa.safetyFirst')}</Typography>
        <Typography sx={{ color: 'text.primary', fontSize: '14px', mb: '20px' }}>
          {user.name} — {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </Typography>

        {groupOrder.map(group => {
          const fields = groupedFields[group];
          if (!fields || fields.length === 0) return null;
          if (group === 'signatures') return null; // handled in approval flow

          // Crew supervision — add crew picker
          if (group === 'crew_supervision') {
            return (
              <fieldset key={group} style={{border: '2px solid #e0e0e0', borderRadius: '12px', padding: '16px', marginBottom: '16px'}}>
                <legend style={{fontSize: '13px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', padding: '0 8px'}}>
                  {groupLabels[group]}
                </legend>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'end' }}>
                  {fields.filter(f => f.field_name !== 'crew_members' && f.field_name !== 'crew_count').map(f => (
                    <Box key={f.field_name}>
                      <Typography sx={labelSx}>{f.field_label}</Typography>
                      <TextField size="small" value={formData[f.field_name] || (f.field_name === 'prepared_by' ? user.name : '')}
                        onChange={e => setFormData(d => ({...d, [f.field_name]: e.target.value}))}
                        sx={inputSx} />
                    </Box>
                  ))}
                </Box>
                {/* Crew picker */}
                <Box sx={{ mt: '12px' }}>
                  <Typography sx={labelSx}>{t('jsa.crewMembers')} ({selectedCrew.length})</Typography>
                  <Button type="button" onClick={() => setShowCrewPicker(!showCrewPicker)}
                    sx={{ ...selectSx, textAlign: 'left', cursor: 'pointer', fontWeight: selectedCrew.length ? 700 : 400, color: selectedCrew.length ? 'text.primary' : '#999', border: '2px solid #ccc', borderRadius: '8px', p: '12px', textTransform: 'none', justifyContent: 'flex-start' }}>
                    {selectedCrew.length ? `${selectedCrew.length} ${t('jsa.selected')}` : t('jsa.tapToAdd')}
                  </Button>
                  {showCrewPicker && (
                    <Paper sx={{ border: '2px solid #ccc', borderRadius: '8px', mt: '4px', maxHeight: '250px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                      {team.map(p => {
                        const isChecked = selectedCrew.some(c => c.id === p.id);
                        const isForeperson = p.id === user.supervisor_id;
                        const isSelfEntry = p.isSelf;
                        return (
                          <label key={p.id} style={{
                            display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', cursor: 'pointer',
                            borderBottom: '1px solid #f0f0f0',
                            background: isChecked ? '#f9f5f0' : 'white',
                          }}>
                            <Checkbox checked={isChecked} onChange={() => {
                              setSelectedCrew(prev => isChecked ? prev.filter(c => c.id !== p.id) : [...prev, { id: p.id, name: p.name, person_id: p.id, person_name: p.name, role_title: p.role_title }]);
                            }} sx={{ width: '20px', height: '20px', color: 'primary.main', '&.Mui-checked': { color: 'primary.main' } }} />
                            <Typography sx={{ fontWeight: 600, color: 'text.primary' }}>
                              {isForeperson ? '⭐ ' : ''}{p.name}{isSelfEntry ? ' (You)' : ''}
                            </Typography>
                            <Typography sx={{ fontSize: '12px', color: 'text.primary', ml: 'auto' }}>
                              {p.role_title}
                            </Typography>
                          </label>
                        );
                      })}
                      <Button onClick={() => {
                        const name = prompt(t('jsa.enterNameToSign'));
                        if (name && name.trim()) {
                          const manualId = 'manual_' + Date.now();
                          setSelectedCrew(prev => [...prev, { id: manualId, name: name.trim(), person_id: manualId, person_name: name.trim(), role_title: 'Manual Entry' }]);
                        }
                      }} sx={{ width: '100%', p: '10px', border: 'none', borderBottom: '1px solid #e0e0e0', background: '#f9f7f5', color: 'text.primary', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', pl: '12px', textTransform: 'none', justifyContent: 'flex-start', borderRadius: 0 }}>{t('jsa.addManually')}</Button>
                      <Button onClick={() => setShowCrewPicker(false)} sx={{ width: '100%', p: '10px', border: 'none', background: 'var(--charcoal)', color: 'primary.main', fontSize: '14px', fontWeight: 700, cursor: 'pointer', textTransform: 'none', borderRadius: 0 }}>{t('jsa.done')}</Button>
                    </Paper>
                  )}
                  {/* Show selected crew */}
                  {selectedCrew.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', mt: '8px' }}>
                      {selectedCrew.map(c => (
                        <Chip key={c.id} label={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {c.name}
                            <Button onClick={() => setSelectedCrew(prev => prev.filter(x => x.id !== c.id))}
                              sx={{ background: 'none', border: 'none', color: 'text.primary', fontSize: '14px', cursor: 'pointer', p: 0, minWidth: 'auto' }}>✕</Button>
                          </Box>
                        } sx={{ background: '#f0ece8', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }} />
                      ))}
                    </Box>
                  )}
                </Box>
              </fieldset>
            );
          }

          // Hazard analysis — render as step cards
          if (group === 'hazard_analysis') {
            const steps = [];
            for (let i = 1; i <= 5; i++) {
              const task = fields.find(f => f.field_name === `step_${i}_task`);
              const hazards = fields.find(f => f.field_name === `step_${i}_hazards`);
              const risk = fields.find(f => f.field_name === `step_${i}_risk`);
              const controls = fields.find(f => f.field_name === `step_${i}_controls`);
              if (task) steps.push({ num: i, task, hazards, risk, controls });
            }
            return (
              <fieldset key={group} style={{border: '2px solid #e0e0e0', borderRadius: '12px', padding: '16px', marginBottom: '16px'}}>
                <legend style={{fontSize: '13px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', padding: '0 8px'}}>
                  {groupLabels[group]}
                </legend>
                {steps.map(step => (
                  <Paper key={step.num} sx={{ background: '#f9f7f5', borderRadius: '10px', p: '14px', mb: '10px', border: '1px solid #e8e4e0' }} elevation={0}>
                    <Typography sx={{ fontSize: '14px', fontWeight: 800, color: 'text.primary', mb: '10px' }}>{t('jsa.step')} {step.num}</Typography>
                    <Box sx={{ mb: '8px' }}>
                      <Typography sx={{ ...labelSx, fontSize: '12px' }}>{t('jsa.jobStep')}</Typography>
                      <TextField size="small" value={formData[step.task.field_name] || ''} onChange={e => setFormData(d => ({...d, [step.task.field_name]: e.target.value}))}
                        placeholder="What are you doing?" sx={inputSx} />
                    </Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', mb: '8px' }}>
                      <Box>
                        <Typography sx={{ ...labelSx, fontSize: '12px' }}>{t('jsa.potentialHazards')}</Typography>
                        <TextField size="small" multiline value={formData[step.hazards?.field_name] || ''} onChange={e => setFormData(d => ({...d, [step.hazards.field_name]: e.target.value}))}
                          rows={2} placeholder="What could go wrong?" sx={inputSx} />
                      </Box>
                      <Box sx={{ minWidth: '80px' }}>
                        <Typography sx={{ ...labelSx, fontSize: '12px' }}>{t('jsa.risk')}</Typography>
                        <Select size="small" value={formData[step.risk?.field_name] || ''} onChange={e => setFormData(d => ({...d, [step.risk.field_name]: e.target.value}))}
                          sx={selectSx} displayEmpty>
                          <MenuItem value="">--</MenuItem>
                          {(JSON.parse(step.risk?.select_options || '[]')).map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                        </Select>
                      </Box>
                    </Box>
                    <Box>
                      <Typography sx={{ ...labelSx, fontSize: '12px' }}>{t('jsa.controlMeasures')}</Typography>
                      <TextField size="small" multiline value={formData[step.controls?.field_name] || ''} onChange={e => setFormData(d => ({...d, [step.controls.field_name]: e.target.value}))}
                        rows={2} placeholder="How do you prevent it?" sx={inputSx} />
                    </Box>
                  </Paper>
                ))}
              </fieldset>
            );
          }

          // Crew acknowledgment section — skip in create form (handled after sharing)
          if (group === 'crew_acknowledgment') return null;

          // Regular sections
          return (
            <fieldset key={group} style={{border: '2px solid #e0e0e0', borderRadius: '12px', padding: '16px', marginBottom: '16px'}}>
              <legend style={{fontSize: '13px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', padding: '0 8px'}}>
                {groupLabels[group] || group}
              </legend>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'end' }}>
                {fields.map(f => (
                  <Box key={f.field_name} sx={{ gridColumn: f.field_type === 'textarea' ? '1 / -1' : undefined }}>
                    <Typography sx={labelSx}>{f.field_label}</Typography>
                    {f.field_type === 'select' ? (
                      <Select size="small" value={formData[f.field_name] || f.default_value || ''} onChange={e => setFormData(d => ({...d, [f.field_name]: e.target.value}))} sx={selectSx} displayEmpty>
                        <MenuItem value="">-- Select --</MenuItem>
                        {(JSON.parse(f.select_options || '[]')).map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                      </Select>
                    ) : f.field_type === 'yesno' ? (
                      <Select size="small" value={formData[f.field_name] || ''} onChange={e => setFormData(d => ({...d, [f.field_name]: e.target.value}))} sx={selectSx} displayEmpty>
                        <MenuItem value="">-- Select --</MenuItem>
                        <MenuItem value="Yes">Yes</MenuItem>
                        <MenuItem value="No">No</MenuItem>
                      </Select>
                    ) : f.field_type === 'textarea' ? (
                      <TextField size="small" multiline value={formData[f.field_name] || ''} onChange={e => setFormData(d => ({...d, [f.field_name]: e.target.value}))}
                        rows={3} sx={inputSx} />
                    ) : f.field_name.includes('date') || f.field_label.toLowerCase().includes('date') ? (
                      <TextField size="small" type="date" value={formData[f.field_name] || ''} onChange={e => setFormData(d => ({...d, [f.field_name]: e.target.value}))}
                        sx={{ ...inputSx, '& .MuiInputBase-input': { WebkitAppearance: 'none', color: formData[f.field_name] ? 'text.primary' : '#999' } }} />
                    ) : (
                      <TextField size="small" type={f.field_type === 'number' ? 'number' : 'text'} value={formData[f.field_name] || ''} onChange={e => setFormData(d => ({...d, [f.field_name]: e.target.value}))}
                        sx={inputSx} />
                    )}
                  </Box>
                ))}
              </Box>
            </fieldset>
          );
        })}

        {/* Action buttons */}
        <Box sx={{ display: 'flex', gap: '10px', mt: '20px', mb: '40px', flexWrap: 'wrap' }}>
          <Button onClick={() => setCreating(false)}
            sx={{ flex: 1, p: '14px 10px', border: '2px solid #ccc', borderRadius: '10px', fontSize: '14px', fontWeight: 700, background: 'white', color: 'text.primary', cursor: 'pointer', minWidth: '90px', textTransform: 'none' }}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => createJSA(false)}
            sx={{ flex: 1, p: '14px 10px', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, background: 'var(--charcoal)', color: 'primary.main', cursor: 'pointer', minWidth: '90px', textTransform: 'none' }}>
            {t('forms.saveDraft')}
          </Button>
          <Button onClick={() => createJSA(true)}
            sx={{ flex: 1, p: '14px 10px', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, background: 'primary.main', color: 'text.primary', cursor: 'pointer', minWidth: '90px', textTransform: 'none' }}>
            {t('common.submit')}
          </Button>
        </Box>
      </Box>
    );
  }

  // ============================================================
  // JSA LIST & DASHBOARD
  // ============================================================
  return (
    <Box sx={{ p: '20px', maxWidth: '800px', mx: 'auto' }}>
      {/* Home button removed — App.jsx sub-header handles it */}
      <Typography variant="h1" sx={{ fontSize: '28px', fontWeight: 800, color: 'text.primary', mb: '4px' }}>{t('jsa.title')}</Typography>
      <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'primary.main', fontStyle: 'italic', mb: '16px', mt: 0 }}>{t('jsa.safetyFirst')}</Typography>

      {/* Today's active JSA banner */}
      {activeJSA && (
        <Paper sx={{ background: '#e8f5e9', border: '2px solid', borderColor: 'success.main', borderRadius: '12px', p: '16px', mb: '20px', cursor: 'pointer' }}
          elevation={0} onClick={() => setViewingJSA(activeJSA)}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '8px' }}>
            <Typography sx={{ fontSize: '16px', fontWeight: 800, color: '#2e7d32' }}>✅ {t('jsa.todayActive')}</Typography>
          </Box>
          <Typography sx={{ fontSize: '14px', color: 'text.primary', m: '0 0 4px' }}>
            {activeJSA.form_data?.task_description || 'Daily task'}
          </Typography>
          <Typography sx={{ fontSize: '12px', color: 'text.primary', m: 0 }}>
            Tap to view details and crew acknowledgments
          </Typography>
        </Paper>
      )}

      {/* Pending signatures — JSAs shared with me that I haven't signed */}
      {pendingAcks.length > 0 && (
        <Box sx={{ mb: '20px' }}>
          <Typography variant="h2" sx={{ fontSize: '18px', fontWeight: 700, color: 'primary.main', mb: '10px' }}>
            ✍️ {t('jsa.signJSA')} ({pendingAcks.length})
          </Typography>
          {pendingAcks.map(ack => (
            <Paper key={ack.id} sx={{ background: '#fff8f0', border: '2px solid', borderColor: 'primary.main', borderRadius: '12px', p: '14px', mb: '10px' }} elevation={0}>
              <Typography sx={{ fontWeight: 700, fontSize: '15px', mb: '4px' }}>JSA from {ack.creator_name}</Typography>
              <Typography sx={{ fontSize: '13px', color: 'text.primary', m: '0 0 10px' }}>
                {t('jsa.reviewAndSign')}
              </Typography>
              <Box sx={{ display: 'flex', gap: '8px' }}>
                <Button onClick={() => setViewingJSA({ ...ack, id: ack.jsa_id, form_data: ack.jsa_form_data ? JSON.parse(ack.jsa_form_data) : {} })}
                  sx={{ flex: 1, p: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', fontWeight: 700, background: 'white', color: 'text.primary', cursor: 'pointer', textTransform: 'none' }}>
                  {t('jsa.viewJSA')}
                </Button>
                <Button onClick={() => signJSA(ack.id, ack.jsa_id)}
                  sx={{ flex: 1, p: '12px', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 700, background: 'primary.main', color: 'text.primary', cursor: 'pointer', textTransform: 'none' }}>
                  ✍️ {t('jsa.signNow')}
                </Button>
              </Box>
            </Paper>
          ))}
        </Box>
      )}

      {/* Pending approvals for foremen/safety */}
      {pendingApprovals.length > 0 && (
        <Box sx={{ mb: '20px' }}>
          <Typography variant="h2" sx={{ fontSize: '18px', fontWeight: 700, color: 'text.primary', mb: '10px' }}>
            {t('jsa.pendingApproval')} ({pendingApprovals.length})
          </Typography>
          {pendingApprovals.map(jsa => (
            <Paper key={jsa.id} sx={{ background: 'white', border: '2px solid #e0e0e0', borderRadius: '12px', p: '14px', mb: '10px' }} elevation={0}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: '6px' }}>
                <Typography sx={{ fontWeight: 700, fontSize: '15px' }}>{jsa.person_name}</Typography>
                <Typography sx={{ fontSize: '12px', color: 'text.primary' }}>{jsa.date}</Typography>
              </Box>
              <Typography sx={{ fontSize: '14px', color: 'text.primary', m: '0 0 4px' }}>{jsa.form_data?.task_description || 'Daily task'}</Typography>
              <Typography sx={{ fontSize: '12px', color: 'text.primary', m: '0 0 4px' }}>Trade: {jsa.trade} | Area: {jsa.form_data?.work_area || 'TBD'}</Typography>
              {/* Show crew acknowledgment progress */}
              {jsa.acknowledgments && jsa.acknowledgments.length > 0 && (
                <Typography sx={{ fontSize: '12px', color: 'primary.main', fontWeight: 600, m: '0 0 10px' }}>
                  Crew: {jsa.acknowledgments.filter(a => a.status === 'completed').length}/{jsa.acknowledgments.length} acknowledged
                </Typography>
              )}
              <Box sx={{ display: 'flex', gap: '8px' }}>
                <Button onClick={() => setViewingJSA(jsa)}
                  sx={{ flex: 1, p: '10px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '14px', fontWeight: 700, background: 'white', color: 'text.primary', cursor: 'pointer', textTransform: 'none' }}>
                  {t('jsa.viewDetails')}
                </Button>
                <Button onClick={() => approveJSA(jsa.id, isSafety ? 'safety' : 'foreman')}
                  sx={{ flex: 1, p: '10px', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, bgcolor: 'success.main', color: 'white', cursor: 'pointer', textTransform: 'none' }}>
                  {t('jsa.approve')}
                </Button>
                <Button onClick={() => rejectJSA(jsa.id, isSafety ? 'safety' : 'foreman')}
                  sx={{ p: '10px 14px', border: '2px solid #999', borderRadius: '8px', fontSize: '14px', fontWeight: 700, background: 'white', color: 'text.primary', cursor: 'pointer', textTransform: 'none' }}>
                  ↩
                </Button>
              </Box>
            </Paper>
          ))}
        </Box>
      )}

      {/* Create new JSA button */}
      <Button onClick={() => { setCreating(true); setFormData({ date: new Date().toISOString().split('T')[0], prepared_by: user.name, trade_craft: user.trade }); }}
        sx={{
          width: '100%', p: '18px', border: '2px solid', borderColor: 'primary.main', borderRadius: '12px',
          fontSize: '18px', fontWeight: 800, background: 'var(--charcoal)', color: 'primary.main',
          cursor: 'pointer', mb: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', textTransform: 'none'
        }}>
        📋 {t('jsa.createToday')}
      </Button>

      {/* JSA History */}
      <Typography variant="h2" sx={{ fontSize: '18px', fontWeight: 700, color: 'text.primary', mb: '10px' }}>{t('jsa.recentJSAs')}</Typography>
      {loading ? (
        <CircularProgress />
      ) : jsaList.length === 0 ? (
        <Typography sx={{ color: 'text.primary', fontSize: '14px' }}>{t('jsa.noJSAs')}</Typography>
      ) : (
        jsaList.map(jsa => (
          <Paper key={jsa.id} onClick={() => setViewingJSA(jsa)} sx={{
            background: 'white', border: '2px solid #e0e0e0', borderRadius: '10px',
            p: '14px', mb: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'
          }} elevation={0}>
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: '15px', color: 'text.primary' }}>
                {new Date(jsa.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </Typography>
              <Typography sx={{ fontSize: '13px', color: 'text.primary', mt: '2px' }}>
                {jsa.form_data?.task_description || 'Daily task'}
              </Typography>
              {jsa.acknowledgments && jsa.acknowledgments.length > 0 && (
                <Typography sx={{ fontSize: '12px', color: 'primary.main', mt: '2px' }}>
                  {jsa.acknowledgments.filter(a => a.status === 'completed').length}/{jsa.acknowledgments.length} crew acknowledged
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Chip label={statusLabels[jsa.status]} sx={{
                fontSize: '11px', fontWeight: 700, borderRadius: '20px',
                backgroundColor: statusColors[jsa.status] + '20', color: statusColors[jsa.status]
              }} size="small" />
              {jsa.status === 'draft' && (
                <Button onClick={(e) => { e.stopPropagation(); submitForApproval(jsa.id); }}
                  sx={{ p: '6px 12px', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 700, background: 'primary.main', color: 'text.primary', cursor: 'pointer', textTransform: 'none', minWidth: 'auto' }}>
                  {t('common.submit')}
                </Button>
              )}
            </Box>
          </Paper>
        ))
      )}
    </Box>
  );
}
