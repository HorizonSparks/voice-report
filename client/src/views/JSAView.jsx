import { useState, useEffect, Fragment } from 'react';
import { useTranslation } from 'react-i18next';

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

  // Shared input style
  const inputStyle = { width: '100%', padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', boxSizing: 'border-box', minHeight: '48px' };
  const selectStyle = { ...inputStyle, background: 'white', color: 'var(--charcoal)' };
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--charcoal)', marginBottom: '4px' };

  // (Individual acknowledgment removed — simplified to group signatures)

  // ============================================================
  // VIEWING a JSA detail with acknowledgment progress
  // ============================================================
  if (viewingJSA) {
    const acks = viewingJSA.acknowledgments || [];
    const completed = acks.filter(a => a.status === 'completed').length;
    return (
      <div style={{padding: '20px', maxWidth: '800px', margin: '0 auto'}}>
        <button className="back-btn" onClick={() => setViewingJSA(null)}>&larr; Back</button>
        <h1 style={{fontSize: '24px', fontWeight: 800, color: 'var(--charcoal)', marginBottom: '4px'}}>{t('jsa.detail')}</h1>
        <p style={{color: 'var(--charcoal)', fontSize: '14px', marginBottom: '16px'}}>
          {viewingJSA.person_name} — {new Date(viewingJSA.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>

        {/* Status */}
        <div style={{display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center'}}>
          <span style={{fontSize: '13px', fontWeight: 700, padding: '6px 14px', borderRadius: '20px',
            background: statusColors[viewingJSA.status] + '20', color: statusColors[viewingJSA.status]}}>
            {statusLabels[viewingJSA.status]}
          </span>
          {viewingJSA.foreman_name && <span style={{fontSize: '12px', color: 'var(--charcoal)'}}>Foreman: {viewingJSA.foreman_name} ✓</span>}
          {viewingJSA.safety_name && <span style={{fontSize: '12px', color: 'var(--charcoal)'}}>Safety: {viewingJSA.safety_name} ✓</span>}
        </div>

        {/* Task description */}
        <fieldset style={{border: '2px solid #e0e0e0', borderRadius: '12px', padding: '16px', marginBottom: '16px'}}>
          <legend style={{fontSize: '13px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', padding: '0 8px'}}>{t('common.task')}</legend>
          <p style={{fontSize: '15px', color: 'var(--charcoal)', margin: 0}}>{viewingJSA.form_data?.task_description || t('common.noDescription')}</p>
          <p style={{fontSize: '13px', color: 'var(--charcoal)', marginTop: '8px'}}>
            Area: {viewingJSA.form_data?.work_area || 'TBD'} | Risk: {viewingJSA.form_data?.risk_level || 'TBD'}
          </p>
        </fieldset>

        {/* Crew signatures progress */}
        {acks.length > 0 && (
          <fieldset style={{border: '2px solid #e0e0e0', borderRadius: '12px', padding: '16px', marginBottom: '16px'}}>
            <legend style={{fontSize: '13px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', padding: '0 8px'}}>
              {t('jsa.crewSignatures')} ({completed} / {acks.length})
            </legend>
            {/* Progress bar */}
            <div style={{height: '8px', background: '#e0e0e0', borderRadius: '4px', marginBottom: '12px', overflow: 'hidden'}}>
              <div style={{height: '100%', width: `${acks.length > 0 ? (completed / acks.length * 100) : 0}%`, background: completed === acks.length ? '#4CAF50' : 'var(--primary)', borderRadius: '4px', transition: 'width 0.3s'}} />
            </div>
            {acks.map(ack => (
              <div key={ack.id} style={{display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: '1px solid #f0f0f0'}}>
                <span style={{fontSize: '20px'}}>{ack.status === 'signed' ? '✅' : '⏳'}</span>
                <div style={{flex: 1}}>
                  <div style={{fontWeight: 700, fontSize: '14px', color: 'var(--charcoal)'}}>{ack.person_name}</div>
                  {ack.signed_on_device === 'foreman' && ack.status === 'signed' && (
                    <div style={{fontSize: '11px', color: 'var(--charcoal)'}}>{t('jsa.signedOnForemanDevice')}</div>
                  )}
                </div>
                <span style={{fontSize: '12px', color: ack.status === 'signed' ? '#4CAF50' : '#999', fontWeight: 600}}>
                  {ack.status === 'signed' ? `${t('jsa.signed')} ✓` : t('jsa.pending')}
                </span>
              </div>
            ))}
            {/* Foreman: sign for someone without a phone */}
            {isForeman && (
              <button onClick={() => {
                const name = prompt(t('jsa.enterNameToSign'));
                if (name && name.trim()) signForSomeone(viewingJSA.id, name.trim());
              }}
                style={{marginTop: '10px', width: '100%', padding: '10px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '14px', fontWeight: 600, background: 'white', color: 'var(--charcoal)', cursor: 'pointer'}}>
                {t('jsa.signForSomeone')}
              </button>
            )}
          </fieldset>
        )}

        {/* Actions */}
        {viewingJSA.status === 'draft' && viewingJSA.person_id === personId && (
          <button onClick={() => submitForApproval(viewingJSA.id)}
            style={{width: '100%', padding: '14px 10px', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, background: 'var(--primary)', color: 'var(--charcoal)', cursor: 'pointer'}}>
            {t('jsa.submitForApproval')}
          </button>
        )}
      </div>
    );
  }

  // ============================================================
  // CREATING new JSA
  // ============================================================
  if (creating) {
    return (
      <div style={{padding: '20px', maxWidth: '800px', margin: '0 auto'}}>
        <button className="back-btn" onClick={() => setCreating(false)}>&larr; Back</button>
        <h1 style={{fontSize: '28px', fontWeight: 800, color: 'var(--charcoal)', marginBottom: '2px'}}>{t('jsa.newJSA')}</h1>
        <p style={{fontSize: '13px', fontWeight: 600, color: 'var(--primary)', fontStyle: 'italic', marginBottom: '8px', marginTop: 0}}>{t('jsa.safetyFirst')}</p>
        <p style={{color: 'var(--charcoal)', fontSize: '14px', marginBottom: '20px'}}>
          {user.name} — {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>

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
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'end'}}>
                  {fields.filter(f => f.field_name !== 'crew_members' && f.field_name !== 'crew_count').map(f => (
                    <div key={f.field_name}>
                      <label style={labelStyle}>{f.field_label}</label>
                      <input type="text" value={formData[f.field_name] || (f.field_name === 'prepared_by' ? user.name : '')}
                        onChange={e => setFormData(d => ({...d, [f.field_name]: e.target.value}))}
                        style={inputStyle} />
                    </div>
                  ))}
                </div>
                {/* Crew picker */}
                <div style={{marginTop: '12px'}}>
                  <label style={labelStyle}>{t('jsa.crewMembers')} ({selectedCrew.length})</label>
                  <button type="button" onClick={() => setShowCrewPicker(!showCrewPicker)}
                    style={{...selectStyle, textAlign: 'left', cursor: 'pointer', fontWeight: selectedCrew.length ? 700 : 400, color: selectedCrew.length ? 'var(--charcoal)' : '#999'}}>
                    {selectedCrew.length ? `${selectedCrew.length} ${t('jsa.selected')}` : t('jsa.tapToAdd')}
                  </button>
                  {showCrewPicker && (
                    <div style={{border: '2px solid #ccc', borderRadius: '8px', marginTop: '4px', maxHeight: '250px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'}}>
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
                            <input type="checkbox" checked={isChecked} onChange={() => {
                              setSelectedCrew(prev => isChecked ? prev.filter(c => c.id !== p.id) : [...prev, { id: p.id, name: p.name, person_id: p.id, person_name: p.name, role_title: p.role_title }]);
                            }} style={{width: '20px', height: '20px', accentColor: 'var(--primary)'}} />
                            <span style={{fontWeight: 600, color: 'var(--charcoal)'}}>
                              {isForeperson ? '⭐ ' : ''}{p.name}{isSelfEntry ? ' (You)' : ''}
                            </span>
                            <span style={{fontSize: '12px', color: 'var(--charcoal)', marginLeft: 'auto'}}>
                              {p.role_title}
                            </span>
                          </label>
                        );
                      })}
                      <button onClick={() => {
                        const name = prompt(t('jsa.enterNameToSign'));
                        if (name && name.trim()) {
                          const manualId = 'manual_' + Date.now();
                          setSelectedCrew(prev => [...prev, { id: manualId, name: name.trim(), person_id: manualId, person_name: name.trim(), role_title: 'Manual Entry' }]);
                        }
                      }} style={{width: '100%', padding: '10px', border: 'none', borderBottom: '1px solid #e0e0e0', background: '#f9f7f5', color: 'var(--charcoal)', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', paddingLeft: '12px'}}>{t('jsa.addManually')}</button>
                      <button onClick={() => setShowCrewPicker(false)} style={{width: '100%', padding: '10px', border: 'none', background: 'var(--charcoal)', color: 'var(--primary)', fontSize: '14px', fontWeight: 700, cursor: 'pointer'}}>{t('jsa.done')}</button>
                    </div>
                  )}
                  {/* Show selected crew */}
                  {selectedCrew.length > 0 && (
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px'}}>
                      {selectedCrew.map(c => (
                        <span key={c.id} style={{background: '#f0ece8', borderRadius: '20px', padding: '4px 12px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px'}}>
                          {c.name}
                          <button onClick={() => setSelectedCrew(prev => prev.filter(x => x.id !== c.id))}
                            style={{background: 'none', border: 'none', color: 'var(--charcoal)', fontSize: '14px', cursor: 'pointer', padding: 0}}>✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
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
                  <div key={step.num} style={{background: '#f9f7f5', borderRadius: '10px', padding: '14px', marginBottom: '10px', border: '1px solid #e8e4e0'}}>
                    <div style={{fontSize: '14px', fontWeight: 800, color: 'var(--charcoal)', marginBottom: '10px'}}>{t('jsa.step')} {step.num}</div>
                    <div style={{marginBottom: '8px'}}>
                      <label style={{...labelStyle, fontSize: '12px'}}>{t('jsa.jobStep')}</label>
                      <input type="text" value={formData[step.task.field_name] || ''} onChange={e => setFormData(d => ({...d, [step.task.field_name]: e.target.value}))}
                        placeholder="What are you doing?" style={inputStyle} />
                    </div>
                    <div style={{display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', marginBottom: '8px'}}>
                      <div>
                        <label style={{...labelStyle, fontSize: '12px'}}>{t('jsa.potentialHazards')}</label>
                        <textarea value={formData[step.hazards?.field_name] || ''} onChange={e => setFormData(d => ({...d, [step.hazards.field_name]: e.target.value}))}
                          rows={2} placeholder="What could go wrong?" style={inputStyle} />
                      </div>
                      <div style={{minWidth: '80px'}}>
                        <label style={{...labelStyle, fontSize: '12px'}}>{t('jsa.risk')}</label>
                        <select value={formData[step.risk?.field_name] || ''} onChange={e => setFormData(d => ({...d, [step.risk.field_name]: e.target.value}))}
                          style={selectStyle}>
                          <option value="">--</option>
                          {(JSON.parse(step.risk?.select_options || '[]')).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label style={{...labelStyle, fontSize: '12px'}}>{t('jsa.controlMeasures')}</label>
                      <textarea value={formData[step.controls?.field_name] || ''} onChange={e => setFormData(d => ({...d, [step.controls.field_name]: e.target.value}))}
                        rows={2} placeholder="How do you prevent it?" style={inputStyle} />
                    </div>
                  </div>
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
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'end'}}>
                {fields.map(f => (
                  <div key={f.field_name} style={{gridColumn: f.field_type === 'textarea' ? '1 / -1' : undefined}}>
                    <label style={labelStyle}>{f.field_label}</label>
                    {f.field_type === 'select' ? (
                      <select value={formData[f.field_name] || f.default_value || ''} onChange={e => setFormData(d => ({...d, [f.field_name]: e.target.value}))} style={selectStyle}>
                        <option value="">-- Select --</option>
                        {(JSON.parse(f.select_options || '[]')).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : f.field_type === 'yesno' ? (
                      <select value={formData[f.field_name] || ''} onChange={e => setFormData(d => ({...d, [f.field_name]: e.target.value}))} style={selectStyle}>
                        <option value="">-- Select --</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    ) : f.field_type === 'textarea' ? (
                      <textarea value={formData[f.field_name] || ''} onChange={e => setFormData(d => ({...d, [f.field_name]: e.target.value}))}
                        rows={3} style={inputStyle} />
                    ) : f.field_name.includes('date') || f.field_label.toLowerCase().includes('date') ? (
                      <input type="date" value={formData[f.field_name] || ''} onChange={e => setFormData(d => ({...d, [f.field_name]: e.target.value}))}
                        style={{...inputStyle, WebkitAppearance: 'none', color: formData[f.field_name] ? 'var(--charcoal)' : '#999'}} />
                    ) : (
                      <input type={f.field_type === 'number' ? 'number' : 'text'} value={formData[f.field_name] || ''} onChange={e => setFormData(d => ({...d, [f.field_name]: e.target.value}))}
                        style={inputStyle} />
                    )}
                  </div>
                ))}
              </div>
            </fieldset>
          );
        })}

        {/* Action buttons */}
        <div style={{display: 'flex', gap: '10px', marginTop: '20px', marginBottom: '40px', flexWrap: 'wrap'}}>
          <button onClick={() => setCreating(false)}
            style={{flex: 1, padding: '14px 10px', border: '2px solid #ccc', borderRadius: '10px', fontSize: '14px', fontWeight: 700, background: 'white', color: 'var(--charcoal)', cursor: 'pointer', minWidth: '90px'}}>
            {t('common.cancel')}
          </button>
          <button onClick={() => createJSA(false)}
            style={{flex: 1, padding: '14px 10px', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, background: 'var(--charcoal)', color: 'var(--primary)', cursor: 'pointer', minWidth: '90px'}}>
            {t('forms.saveDraft')}
          </button>
          <button onClick={() => createJSA(true)}
            style={{flex: 1, padding: '14px 10px', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, background: 'var(--primary)', color: 'var(--charcoal)', cursor: 'pointer', minWidth: '90px'}}>
            {t('common.submit')}
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // JSA LIST & DASHBOARD
  // ============================================================
  return (
    <div style={{padding: '20px', maxWidth: '800px', margin: '0 auto'}}>
      {/* Home button removed — App.jsx sub-header handles it */}
      <h1 style={{fontSize: '28px', fontWeight: 800, color: 'var(--charcoal)', marginBottom: '4px'}}>{t('jsa.title')}</h1>
      <p style={{fontSize: '14px', fontWeight: 600, color: 'var(--primary)', fontStyle: 'italic', marginBottom: '16px', marginTop: 0}}>{t('jsa.safetyFirst')}</p>

      {/* Today's active JSA banner */}
      {activeJSA && (
        <div style={{background: '#e8f5e9', border: '2px solid #4CAF50', borderRadius: '12px', padding: '16px', marginBottom: '20px', cursor: 'pointer'}}
          onClick={() => setViewingJSA(activeJSA)}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
            <span style={{fontSize: '16px', fontWeight: 800, color: '#2e7d32'}}>✅ {t('jsa.todayActive')}</span>
          </div>
          <p style={{fontSize: '14px', color: 'var(--charcoal)', margin: '0 0 4px'}}>
            {activeJSA.form_data?.task_description || 'Daily task'}
          </p>
          <p style={{fontSize: '12px', color: 'var(--charcoal)', margin: 0}}>
            Tap to view details and crew acknowledgments
          </p>
        </div>
      )}

      {/* Pending signatures — JSAs shared with me that I haven't signed */}
      {pendingAcks.length > 0 && (
        <div style={{marginBottom: '20px'}}>
          <h2 style={{fontSize: '18px', fontWeight: 700, color: 'var(--primary)', marginBottom: '10px'}}>
            ✍️ {t('jsa.signJSA')} ({pendingAcks.length})
          </h2>
          {pendingAcks.map(ack => (
            <div key={ack.id} style={{background: '#fff8f0', border: '2px solid var(--primary)', borderRadius: '12px', padding: '14px', marginBottom: '10px'}}>
              <div style={{fontWeight: 700, fontSize: '15px', marginBottom: '4px'}}>JSA from {ack.creator_name}</div>
              <p style={{fontSize: '13px', color: 'var(--charcoal)', margin: '0 0 10px'}}>
                {t('jsa.reviewAndSign')}
              </p>
              <div style={{display: 'flex', gap: '8px'}}>
                <button onClick={() => setViewingJSA({ ...ack, id: ack.jsa_id, form_data: ack.jsa_form_data ? JSON.parse(ack.jsa_form_data) : {} })}
                  style={{flex: 1, padding: '12px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '15px', fontWeight: 700, background: 'white', color: 'var(--charcoal)', cursor: 'pointer'}}>
                  {t('jsa.viewJSA')}
                </button>
                <button onClick={() => signJSA(ack.id, ack.jsa_id)}
                  style={{flex: 1, padding: '12px', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 700, background: 'var(--primary)', color: 'var(--charcoal)', cursor: 'pointer'}}>
                  ✍️ {t('jsa.signNow')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending approvals for foremen/safety */}
      {pendingApprovals.length > 0 && (
        <div style={{marginBottom: '20px'}}>
          <h2 style={{fontSize: '18px', fontWeight: 700, color: 'var(--charcoal)', marginBottom: '10px'}}>
            {t('jsa.pendingApproval')} ({pendingApprovals.length})
          </h2>
          {pendingApprovals.map(jsa => (
            <div key={jsa.id} style={{background: 'white', border: '2px solid #e0e0e0', borderRadius: '12px', padding: '14px', marginBottom: '10px'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '6px'}}>
                <span style={{fontWeight: 700, fontSize: '15px'}}>{jsa.person_name}</span>
                <span style={{fontSize: '12px', color: 'var(--charcoal)'}}>{jsa.date}</span>
              </div>
              <p style={{fontSize: '14px', color: 'var(--charcoal)', margin: '0 0 4px'}}>{jsa.form_data?.task_description || 'Daily task'}</p>
              <p style={{fontSize: '12px', color: 'var(--charcoal)', margin: '0 0 4px'}}>Trade: {jsa.trade} | Area: {jsa.form_data?.work_area || 'TBD'}</p>
              {/* Show crew acknowledgment progress */}
              {jsa.acknowledgments && jsa.acknowledgments.length > 0 && (
                <p style={{fontSize: '12px', color: 'var(--primary)', fontWeight: 600, margin: '0 0 10px'}}>
                  Crew: {jsa.acknowledgments.filter(a => a.status === 'completed').length}/{jsa.acknowledgments.length} acknowledged
                </p>
              )}
              <div style={{display: 'flex', gap: '8px'}}>
                <button onClick={() => setViewingJSA(jsa)}
                  style={{flex: 1, padding: '10px', border: '2px solid #ccc', borderRadius: '8px', fontSize: '14px', fontWeight: 700, background: 'white', color: 'var(--charcoal)', cursor: 'pointer'}}>
                  {t('jsa.viewDetails')}
                </button>
                <button onClick={() => approveJSA(jsa.id, isSafety ? 'safety' : 'foreman')}
                  style={{flex: 1, padding: '10px', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, background: '#4CAF50', color: 'white', cursor: 'pointer'}}>
                  {t('jsa.approve')}
                </button>
                <button onClick={() => rejectJSA(jsa.id, isSafety ? 'safety' : 'foreman')}
                  style={{padding: '10px 14px', border: '2px solid #999', borderRadius: '8px', fontSize: '14px', fontWeight: 700, background: 'white', color: 'var(--charcoal)', cursor: 'pointer'}}>
                  ↩
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create new JSA button */}
      <button onClick={() => { setCreating(true); setFormData({ jsa_date: new Date().toISOString().split('T')[0], prepared_by: user.name, craft_trade: user.trade }); }}
        style={{
          width: '100%', padding: '18px', border: '2px solid var(--primary)', borderRadius: '12px',
          fontSize: '18px', fontWeight: 800, background: 'var(--charcoal)', color: 'var(--primary)',
          cursor: 'pointer', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px'
        }}>
        📋 {t('jsa.createToday')}
      </button>

      {/* JSA History */}
      <h2 style={{fontSize: '18px', fontWeight: 700, color: 'var(--charcoal)', marginBottom: '10px'}}>{t('jsa.recentJSAs')}</h2>
      {loading ? (
        <p style={{color: 'var(--charcoal)'}}>{t('common.loading')}</p>
      ) : jsaList.length === 0 ? (
        <p style={{color: 'var(--charcoal)', fontSize: '14px'}}>{t('jsa.noJSAs')}</p>
      ) : (
        jsaList.map(jsa => (
          <div key={jsa.id} onClick={() => setViewingJSA(jsa)} style={{
            background: 'white', border: '2px solid #e0e0e0', borderRadius: '10px',
            padding: '14px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'
          }}>
            <div>
              <div style={{fontWeight: 700, fontSize: '15px', color: 'var(--charcoal)'}}>
                {new Date(jsa.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
              <div style={{fontSize: '13px', color: 'var(--charcoal)', marginTop: '2px'}}>
                {jsa.form_data?.task_description || 'Daily task'}
              </div>
              {jsa.acknowledgments && jsa.acknowledgments.length > 0 && (
                <div style={{fontSize: '12px', color: 'var(--primary)', marginTop: '2px'}}>
                  {jsa.acknowledgments.filter(a => a.status === 'completed').length}/{jsa.acknowledgments.length} crew acknowledged
                </div>
              )}
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <span style={{
                fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '20px',
                background: statusColors[jsa.status] + '20', color: statusColors[jsa.status]
              }}>
                {statusLabels[jsa.status]}
              </span>
              {jsa.status === 'draft' && (
                <button onClick={(e) => { e.stopPropagation(); submitForApproval(jsa.id); }}
                  style={{padding: '6px 12px', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 700, background: 'var(--primary)', color: 'var(--charcoal)', cursor: 'pointer'}}>
                  {t('common.submit')}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
