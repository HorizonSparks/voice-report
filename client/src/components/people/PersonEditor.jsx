/**
 * PersonEditor Component
 * Handles the add/edit person form.
 * Extracted from PeopleView.jsx for maintainability.
 *
 * Props:
 *   editing: string ('new' or person ID)
 *   form: object (person form state)
 *   setForm: function
 *   templates: array (all role templates)
 *   people: array (all people — for supervisor dropdown)
 *   openSections: object (collapsible section state)
 *   toggleSection: function
 *   onSave: function
 *   onDelete: function
 *   onUploadPhoto: function(event)
 *   onUploadCert: function(file)
 *   onRemoveCert: function(filename)
 *   onRegisterFaceId: function
 *   onGeneratePin: function
 *   messages: array (legacy messages for this person)
 *   messageText: string
 *   setMessageText: function
 *   onSendMessage: function
 *   showMessages: boolean
 *   setShowMessages: function
 *   setPeople: function (for team assignment refresh)
 *   t: function (i18n translate)
 */
import { useState, useEffect } from 'react';
import { Box, Typography, Button, TextField, Select, MenuItem } from '@mui/material';
import TeamAssignment from '../TeamAssignment.jsx';
import { TRADES } from '../../utils/helpers.js';

export default function PersonEditor({
  editing, form, setForm, templates, people, openSections, toggleSection,
  onSave, onDelete, onUploadPhoto, onUploadCert, onRemoveCert,
  onRegisterFaceId, onGeneratePin,
  messages, messageText, setMessageText, onSendMessage, showMessages, setShowMessages,
  setPeople, t,
}) {
  const pc = form.personal_context || {};
  const updateCtx = (key, val) => setForm(f => ({ ...f, personal_context: { ...f.personal_context, [key]: val } }));

  return (
    <Box className="admin-form">
      <Typography variant="h1">{editing === 'new' ? 'Add Person' : 'Edit Person'}</Typography>

      {/* Photo */}
      <Box className="photo-section">
        <Box className="photo-circle" sx={{ cursor: 'pointer', position: 'relative' }} onClick={() => { if (editing === 'new') return; document.getElementById('photo-input')?.click(); }}>
          {form.photo ? (
            <img src={`/api/photos/${form.photo}`} alt={form.name} />
          ) : form._pendingPhotoPreview ? (
            <img src={form._pendingPhotoPreview} alt="Preview" />
          ) : (
            <svg width="40" height="40" viewBox="0 0 24 24" fill="#48484A"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
          )}
        </Box>
        <label className="btn btn-sm photo-upload-btn">
          {form.photo || form._pendingPhotoPreview ? 'Change Photo' : 'Upload Photo'}
          <input id="photo-input" type="file" accept="image/*" onChange={(e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (editing !== 'new') {
              onUploadPhoto(e);
            } else {
              const reader = new FileReader();
              reader.onload = (ev) => setForm(f => ({ ...f, _pendingPhotoPreview: ev.target.result, _pendingPhotoFile: file }));
              reader.readAsDataURL(file);
            }
          }} hidden />
        </label>
      </Box>

      <label className="admin-label">Name
        <TextField fullWidth size="small" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} sx={{ '& input': { minHeight: 'unset', padding: '8px 12px' } }} />
      </label>
      <Box className="form-row-2col">
        <label className="admin-label" style={{flex:1}}>PIN (4 digits)
          <TextField fullWidth size="small" slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 4 }, input: { endAdornment: <Button type="button" onClick={onGeneratePin} sx={{ bgcolor: 'primary.main', color: 'secondary.main', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', minWidth: 'auto', ml: 1, '&:hover': { bgcolor: 'primary.dark' } }}>Auto</Button> } }} value={form.pin || ''} onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))} sx={{ '& input': { minHeight: 'unset', padding: '8px 12px' } }} />
        </label>
        <label className="admin-label" style={{flex:1}}>Status
          <Select fullWidth size="small" value={form.status || 'active'} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
          </Select>
        </label>
      </Box>
      <Box className="form-row-2col">
        <label className="admin-label" style={{flex:1}}>Trade
          <Select fullWidth size="small" value={form._selectedTrade || (form.template_id ? (templates.find(t => t.id === form.template_id)?.trade || '') : '')} onChange={e => {
            const trade = e.target.value;
            setForm(f => ({ ...f, _selectedTrade: trade, template_id: '' }));
          }} displayEmpty>
            <MenuItem value="" disabled>— Select a trade —</MenuItem>
            {TRADES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </Select>
        </label>
        <label className="admin-label" style={{flex:1}}>Role
          <Select fullWidth size="small" value={form.template_id || ''} disabled={!form._selectedTrade && !form.template_id} onChange={e => {
            const tmplId = e.target.value;
            setForm(f => ({ ...f, template_id: tmplId }));
            fetch(`/api/templates/${tmplId}`).then(r => r.ok ? r.json() : null).then(fullTmpl => {
              if (!fullTmpl) return;
              setForm(f => ({
                ...f,
                template_id: tmplId,
                role_title: fullTmpl.template_name,
                role_level: fullTmpl.role_level,
                personal_context: {
                  ...f.personal_context,
                  role_description: fullTmpl.role_description || '',
                  report_focus: fullTmpl.report_focus || '',
                  output_sections: fullTmpl.output_sections || [],
                  language_preference: fullTmpl.language_notes || '',
                  safety_rules: fullTmpl.safety_rules || [],
                  safety_vocabulary: fullTmpl.safety_vocabulary || [],
                  tools_and_equipment: fullTmpl.tools_and_equipment || [],
                }
              }));
            });
          }} displayEmpty>
            <MenuItem value="" disabled>— Select a role —</MenuItem>
            {templates
              .filter(tmpl => tmpl.trade === (form._selectedTrade || (form.template_id ? (templates.find(tt => tt.id === form.template_id)?.trade) : '')))
              .map(tmpl => <MenuItem key={tmpl.id} value={tmpl.id}>{tmpl.template_name}</MenuItem>)}
          </Select>
        </label>
      </Box>
      <label className="admin-label">Reports To (optional)
        <Select fullWidth size="small" value={form.supervisor_id || ''} onChange={e => setForm(f => ({ ...f, supervisor_id: e.target.value || null }))}>
          <MenuItem value="">{t('common.noneTopOfChain')}</MenuItem>
          {people.filter(p => p.id !== editing && (parseInt(p.role_level) || 1) > (parseInt(form.role_level) || 1)).sort((a,b) => (b.role_level || 1) - (a.role_level || 1)).map(p => (
            <MenuItem key={p.id} value={p.id}>{p.name} — {p.role_title}</MenuItem>
          ))}
        </Select>
      </label>

      {/* Face ID */}
      {editing !== 'new' && (
        <Box className="face-id-section">
          <Button className="btn btn-secondary" onClick={onRegisterFaceId} sx={{ width: '100%' }}>
            {form.webauthn_credential_id ? '✓ Face ID Registered — Re-register' : 'Enable Face ID / Touch ID'}
          </Button>
        </Box>
      )}

      {/* Knowledge Files / Resume */}
      <Box className="section-dropdown">
        <Button className="section-dropdown-header" onClick={() => toggleSection('resume')}>
          <Typography component="span">Knowledge Files</Typography>
          <Typography component="span" className="section-arrow">{openSections.resume ? '▼' : '▶'}</Typography>
        </Button>
        {openSections.resume && <Box className="section-dropdown-body">
          <Typography sx={{ fontSize: '13px', color: 'text.primary', mb: '12px', opacity: 0.7 }}>
            Upload resumes, knowledge papers, technical docs. The AI will learn from these files.
          </Typography>
          <Box sx={{ display: 'flex', gap: '8px', mb: '16px' }}>
            <label className="btn btn-orange" style={{fontSize:'13px', cursor:'pointer', flex:1, textAlign:'center'}}>
              Upload File
              <input type="file" accept="*/*" onChange={async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                if (editing === 'new') { alert('Save the person first, then upload files.'); return; }
                const fd = new FormData();
                fd.append('file', file);
                fd.append('title', file.name);
                fd.append('source_type', 'upload');
                fd.append('uploaded_by', '');
                try {
                  const res = await fetch('/api/people/' + editing + '/knowledge', { method: 'POST', body: fd });
                  if (!res.ok) throw new Error('Upload failed');
                  const data = await res.json();
                  if (data.success) {
                    setForm(f => ({ ...f, _knowledgeFiles: [...(f._knowledgeFiles || []), data.file] }));
                  } else { alert('Upload failed: ' + (data.error || 'Unknown error')); }
                } catch (err) { alert('Upload error: ' + err.message); }
                e.target.value = '';
              }} hidden />
            </label>
          </Box>
          {(form._knowledgeFiles || []).length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(form._knowledgeFiles || []).map(kf => (
                <Box key={kf.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', bgcolor: 'grey.50', borderRadius: '8px', border: '1px solid', borderColor: 'grey.200' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kf.original_name || kf.title}</Typography>
                    <Typography sx={{ fontSize: '11px', color: 'text.primary', opacity: 0.6, mt: '2px' }}>
                      {kf.token_estimate ? '~' + kf.token_estimate + ' tokens' : ''} {kf.source_type || 'upload'} • {new Date(kf.created_at).toLocaleDateString()}
                    </Typography>
                  </Box>
                  <Button onClick={async () => {
                    if (!confirm('Remove this file?')) return;
                    try {
                      await fetch('/api/people/' + editing + '/knowledge/' + kf.id, { method: 'DELETE' });
                      setForm(f => ({ ...f, _knowledgeFiles: (f._knowledgeFiles || []).filter(f2 => f2.id !== kf.id) }));
                    } catch (err) { alert('Delete failed: ' + err.message); }
                  }} sx={{ background: 'none', border: 'none', color: 'var(--red, #c00)', fontSize: '18px', cursor: 'pointer', padding: '4px 8px', minWidth: 'auto' }}>&times;</Button>
                </Box>
              ))}
            </Box>
          ) : (
            <Typography sx={{ fontSize: '13px', color: 'text.primary', opacity: 0.5, textAlign: 'center', py: '16px' }}>No files uploaded yet</Typography>
          )}
          {editing === 'new' && <Typography sx={{ fontSize: '12px', color: 'text.primary', opacity: 0.6, mt: '8px' }}>Save person first to upload files.</Typography>}
        </Box>}
      </Box>

      {/* Role Configuration */}
      <Box className="section-dropdown">
        <Button className="section-dropdown-header" onClick={() => toggleSection('role')}>
          <Typography component="span">Role Configuration</Typography>
          <Typography component="span" className="section-arrow">{openSections.role ? '▼' : '▶'}</Typography>
        </Button>
        {openSections.role && <Box className="section-dropdown-body">
          <Typography sx={{ fontSize: '13px', color: 'grey.500', mb: '12px' }}>Pre-filled from template. Customize for this person if needed.</Typography>
          <label className="admin-label">Role Description
            <TextField fullWidth size="small" multiline rows={3} value={pc.role_description || ''} onChange={e => updateCtx('role_description', e.target.value)} placeholder="What this person does on the job..." />
          </label>
          <label className="admin-label">Report Focus (what AI looks for)
            <TextField fullWidth size="small" multiline rows={3} value={pc.report_focus || ''} onChange={e => updateCtx('report_focus', e.target.value)} placeholder="Work completed, equipment issues, safety observations..." />
          </label>
          <label className="admin-label">Output Sections (one per line)
            <TextField fullWidth size="small" multiline rows={5} value={Array.isArray(pc.output_sections) ? pc.output_sections.join('\n') : (pc.output_sections || '')} onChange={e => updateCtx('output_sections', e.target.value.split('\n').filter(s => s.trim()))} placeholder={'Work Completed\nEquipment Issues\nSafety Observations\nPlan for Tomorrow'} />
          </label>
          <label className="admin-label">Language Notes
            <TextField fullWidth size="small" multiline rows={2} value={pc.language_preference || ''} onChange={e => updateCtx('language_preference', e.target.value)} placeholder="English, Spanish, bilingual, etc." />
          </label>
        </Box>}
      </Box>

      {/* Personal Context */}
      <Box className="section-dropdown">
        <Button className="section-dropdown-header" onClick={() => toggleSection('personal')}>
          <Typography component="span">Personal Context</Typography>
          <Typography component="span" className="section-arrow">{openSections.personal ? '▼' : '▶'}</Typography>
        </Button>
        {openSections.personal && <Box className="section-dropdown-body">
          <label className="admin-label">Experience
            <TextField fullWidth size="small" multiline rows={3} value={pc.experience || ''} onChange={e => updateCtx('experience', e.target.value)} placeholder="Years of experience, past projects, background..." />
          </label>
          <label className="admin-label">Specialties
            <TextField fullWidth size="small" multiline rows={2} value={pc.specialties || ''} onChange={e => updateCtx('specialties', e.target.value)} placeholder="What they're especially good at or focused on..." />
          </label>
          <label className="admin-label">Notes for AI
            <TextField fullWidth size="small" multiline rows={3} value={pc.notes || ''} onChange={e => updateCtx('notes', e.target.value)} placeholder="Anything that helps the AI understand this person's reports better..." />
          </label>
          <label className="admin-label">Certifications</label>
          <Box className="cert-box">
            <TextField fullWidth size="small" multiline rows={4} value={pc.certifications || ''} onChange={e => updateCtx('certifications', e.target.value)} placeholder="Licenses, OSHA, NFPA 70E, TWIC, etc." className="cert-textarea" />
            <Box className="cert-upload-row">
              <Button className="btn btn-charcoal cert-upload-btn" onClick={() => {
                const inp = document.createElement('input');
                inp.type = 'file'; inp.accept = 'image/*,.pdf'; inp.capture = 'environment';
                inp.onchange = e => { if (e.target.files[0]) onUploadCert(e.target.files[0]); };
                inp.click();
              }}>Camera</Button>
              <Button className="btn btn-orange cert-upload-btn" onClick={() => {
                const inp = document.createElement('input');
                inp.type = 'file'; inp.accept = 'image/*,.pdf';
                inp.onchange = e => { if (e.target.files[0]) onUploadCert(e.target.files[0]); };
                inp.click();
              }}>Upload File</Button>
            </Box>
            {(form.certifications_files || []).length > 0 && (
              <Box className="cert-file-list">
                {(form.certifications_files || []).map(cf => (
                  <Box key={cf.filename} className="cert-file-item">
                    {cf.type && cf.type.startsWith('image/') ? (
                      <img src={`/api/certs/${cf.filename}`} className="cert-thumb" onClick={() => window.open(`/api/certs/${cf.filename}`, '_blank')} alt={cf.original_name} />
                    ) : (
                      <Box className="cert-file-icon" onClick={() => window.open(`/api/certs/${cf.filename}`, '_blank')}>PDF</Box>
                    )}
                    <Typography component="span" className="cert-file-name" onClick={() => window.open(`/api/certs/${cf.filename}`, '_blank')}>{cf.original_name}</Typography>
                    <Button className="cert-remove-btn" onClick={() => onRemoveCert(cf.filename)}>&times;</Button>
                  </Box>
                ))}
              </Box>
            )}
            {editing === 'new' && <Typography className="cert-hint">Save person first to upload certification files.</Typography>}
          </Box>
        </Box>}
      </Box>

      {/* Safety Knowledge */}
      <Box className="section-dropdown">
        <Button className="section-dropdown-header" onClick={() => toggleSection('safety')}>
          <Typography component="span">Safety Knowledge</Typography>
          <Typography component="span" className="section-arrow">{openSections.safety ? '▼' : '▶'}</Typography>
        </Button>
        {openSections.safety && <Box className="section-dropdown-body">
          <Typography sx={{ fontSize: '13px', color: 'grey.500', mb: '12px' }}>Pre-filled from template. Add personal safety focus if needed.</Typography>
          <label className="admin-label">Safety Rules (one per line)
            <TextField fullWidth size="small" multiline rows={5} value={Array.isArray(pc.safety_rules) ? pc.safety_rules.join('\n') : (pc.safety_rules || '')} onChange={e => updateCtx('safety_rules', e.target.value.split('\n').filter(s => s.trim()))} placeholder={'PPE required at all times\nLOTO before electrical work...'} />
          </label>
          <label className="admin-label">Safety Vocabulary (comma-separated)
            <TextField fullWidth size="small" multiline rows={2} value={Array.isArray(pc.safety_vocabulary) ? pc.safety_vocabulary.join(', ') : (pc.safety_vocabulary || '')} onChange={e => updateCtx('safety_vocabulary', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="PPE, LOTO, JSA, confined space..." />
          </label>
          <label className="admin-label">Tools & Equipment Safety (one per line)
            <TextField fullWidth size="small" multiline rows={3} value={Array.isArray(pc.tools_and_equipment) ? pc.tools_and_equipment.join('\n') : (pc.tools_and_equipment || '')} onChange={e => updateCtx('tools_and_equipment', e.target.value.split('\n').filter(s => s.trim()))} placeholder={'Inspect tools before use\nGround portable equipment...'} />
          </label>
          <label className="admin-label">Personal Safety Notes
            <TextField fullWidth size="small" multiline rows={2} value={pc.safety_notes || ''} onChange={e => updateCtx('safety_notes', e.target.value)} placeholder="Past incidents, specific hazard focus areas..." />
          </label>
        </Box>}
      </Box>

      {/* Team Assignment */}
      {editing !== 'new' && parseInt(form.role_level || 1) >= 2 && (
        <TeamAssignment person={form} allPeople={people} onUpdate={() => {
          fetch('/api/people').then(r => r.ok ? r.json() : []).then(setPeople);
        }} />
      )}

      {/* Messages */}
      {editing !== 'new' && (
        <>
          <Typography variant="h2" className="admin-section-title" onClick={() => setShowMessages(!showMessages)} sx={{ cursor: 'pointer' }}>
            Messages ({messages.filter(m => !m.addressed_in_report).length} pending) {showMessages ? '▼' : '▶'}
          </Typography>
          {showMessages && (
            <Box className="messages-section">
              <Box className="message-compose">
                <TextField fullWidth size="small" multiline rows={2} value={messageText} onChange={e => setMessageText(e.target.value)}
                  placeholder={`Leave a message for ${form.name}... (AI will deliver it during their next report)`} />
                <Button className="btn btn-primary btn-sm" variant="contained" onClick={onSendMessage} disabled={!messageText.trim()}>Send</Button>
              </Box>
              {messages.length > 0 && (
                <Box className="messages-list">
                  {messages.slice().reverse().map(m => (
                    <Box key={m.id} className={`message-item ${m.addressed_in_report ? 'addressed' : 'pending'}`}>
                      <Box className="message-meta">
                        <Typography component="span" className="message-from">{m.from} ({m.from_role})</Typography>
                        <Typography component="span" className="message-date">{new Date(m.created_at).toLocaleString()}</Typography>
                      </Box>
                      <Box className="message-text">{m.text}</Box>
                      {m.addressed_in_report && <Box className="message-status">✓ Addressed in report</Box>}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </>
      )}

      <Box className="action-row">
        <Button className="btn btn-primary btn-lg" variant="contained" onClick={onSave}>Save</Button>
      </Box>
    </Box>
  );
}
