import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import TeamAssignment from '../components/TeamAssignment.jsx';
import PersonEditor from '../components/people/PersonEditor.jsx';
import PersonDashboard from '../components/people/PersonDashboard.jsx';
import PeopleListSection from '../components/people/PeopleListSection.jsx';
import { TRADES } from '../utils/helpers.js';
import usePeopleData from '../hooks/usePeopleData.js';
import usePersonDashboard from '../hooks/usePersonDashboard.js';

export default forwardRef(function PeopleView({ activeTrade, activeRoleLevels, onOpenReport, persistedViewingId, setPeopleViewingId, user, setView, navigateTo, readOnly }, ref) {
  const { t } = useTranslation();
  // Data hooks
  const { people, setPeople, templates, loading, reload: reloadPeople } = usePeopleData({ user, activeTrade });
  const [viewing, setViewing] = useState(persistedViewingId || null);
  const dashboard = usePersonDashboard({ personId: viewing });
  const viewingPerson = dashboard.person;
  const viewingReports = dashboard.reports;
  const viewingTasks = dashboard.tasks;
  const [editing, setEditing] = useState(null);
  const [expandedPersonSection, setExpandedPersonSection] = useState(null); // 'tasks' or 'reports'
  const [form, setForm] = useState({});
  const [expandedCategory, setExpandedCategory] = useState(null);

  // Expose tryGoBack so app-level Back unwinds sub-views first
  useImperativeHandle(ref, () => ({
    tryGoBack: () => {
      if (editing) { setEditing(null); return true; }
      if (expandedPersonSection) { setExpandedPersonSection(null); return true; }
      if (viewing) { setViewing(null); setExpandedPersonSection(null); if (setPeopleViewingId) setPeopleViewingId(null); return true; }
      if (expandedCategory) { setExpandedCategory(null); return true; }
      return false;
    }
  }));
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState([]);
  const [showMessages, setShowMessages] = useState(false);
  const [openSections, setOpenSections] = useState({});
  const toggleSection = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }));

  const isAdmin = user && user.is_admin;
  const isSupervisor = user && parseInt(user.role_level || 0) >= 2;
  const myPersonId = user && user.person_id;

  // View person dashboard — just set viewing ID, hook handles loading
  const viewPerson = (id) => {
    setViewing(id);
    if (setPeopleViewingId) setPeopleViewingId(id);
  };

  // Refresh reports when returning from report detail
  useEffect(() => {
    if (viewing && viewingPerson) {
      dashboard.refreshReports();
    }
  }, [viewing]);

  const deletePerson2 = async () => {
    const id = viewing;
    const name = viewingPerson?.name || 'this person';
    if (!confirm(`Are you sure you want to delete ${name}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/people/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setViewing(null);
        reloadPeople();
      } else { alert('Failed to delete person.'); }
    } catch (err) { alert('Error: ' + err.message); }
  };

  const startNew = () => {
    setForm({ name: '', pin: '', template_id: '', role_title: '', role_level: 1, personal_context: {} });
    setEditing('new');
    setShowMessages(false);
  };

  const startEdit = async (id) => {
    const res = await fetch(`/api/people/${id}`);
    const p = await res.json();
    setEditing(id);

    // Auto-fill empty fields from template
    if (p.template_id) {
      try {
        const tmplRes = await fetch(`/api/templates/${p.template_id}`);
        const tmpl = await tmplRes.json();
        const pc = p.personal_context || {};
        p.personal_context = {
          ...pc,
          role_description: pc.role_description || tmpl.role_description || '',
          report_focus: pc.report_focus || tmpl.report_focus || '',
          output_sections: (pc.output_sections && pc.output_sections.length > 0) ? pc.output_sections : (tmpl.output_sections || []),
          language_preference: pc.language_preference || tmpl.language_notes || '',
          safety_rules: (pc.safety_rules && pc.safety_rules.length > 0) ? pc.safety_rules : (tmpl.safety_rules || []),
          safety_vocabulary: (pc.safety_vocabulary && pc.safety_vocabulary.length > 0) ? pc.safety_vocabulary : (tmpl.safety_vocabulary || []),
          tools_and_equipment: (pc.tools_and_equipment && pc.tools_and_equipment.length > 0) ? pc.tools_and_equipment : (tmpl.tools_and_equipment || []),
        };
      } catch (e) {}
    }

    setForm(p);
    // Load messages for this person
    const msgRes = await fetch(`/api/messages/${id}`);
    const msgs = await msgRes.json();
    setMessages(msgs);
    setShowMessages(false);
  };

  const save = async () => {
    const tmpl = templates.find(t => t.id === form.template_id);
    if (tmpl) { form.role_title = tmpl.template_name; form.role_level = tmpl.role_level; }
    // Clean up internal fields before saving
    const saveData = { ...form };
    delete saveData._pendingPhotoPreview;
    delete saveData._pendingPhotoFile;
    delete saveData._selectedTrade;

    const method = editing === 'new' ? 'POST' : 'PUT';
    const url = editing === 'new' ? '/api/people' : `/api/people/${editing}`;
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saveData) });
    const result = await res.json();

    // Upload pending photo for new person
    if (editing === 'new' && form._pendingPhotoFile && result.id) {
      const fd = new FormData();
      fd.append('photo', form._pendingPhotoFile);
      await fetch(`/api/people/${result.id}/photo`, { method: 'POST', body: fd });
    }

    const savedId = editing === 'new' ? result.id : editing;
    setEditing(null);
    reloadPeople();
    // Go back to dashboard if we were viewing someone
    if (savedId && savedId !== 'new') {
      setTimeout(() => viewPerson(savedId), 300);
    }
  };

  const deletePerson = async () => {
    if (!confirm(`Are you sure you want to delete ${form.name || 'this person'}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/people/${editing}`, { method: 'DELETE' });
      if (res.ok) {
        setEditing(null);
        setViewing(null);
        reloadPeople();
      } else {
        alert('Failed to delete person.');
      }
    } catch (err) { alert('Error deleting person: ' + err.message); }
  };

  const uploadPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file || editing === 'new') return;
    const fd = new FormData();
    fd.append('photo', file);
    const res = await fetch(`/api/people/${editing}/photo`, { method: 'POST', body: fd });
    if (res.ok) {
      const data = await res.json();
      setForm(f => ({ ...f, photo: data.photo }));
    }
  };

  const sendMessage = async () => {
    if (!messageText.trim() || editing === 'new') return;
    const res = await fetch(`/api/messages/${editing}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: messageText, from: 'Admin', from_role: 'Administrator' }),
    });
    if (res.ok) {
      const data = await res.json();
      setMessages(prev => [...prev, data.message]);
      setMessageText('');
    }
  };

  const registerFaceId = async () => {
    if (editing === 'new' || !window.PublicKeyCredential) return;
    try {
      const optRes = await fetch('/api/webauthn/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: editing }),
      });
      const options = await optRes.json();

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: Uint8Array.from(atob(options.challenge.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)),
          rp: options.rp,
          user: {
            id: Uint8Array.from(atob(options.user.id.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)),
            name: options.user.name,
            displayName: options.user.displayName,
          },
          pubKeyCredParams: options.pubKeyCredParams,
          authenticatorSelection: options.authenticatorSelection,
          timeout: options.timeout,
        }
      });

      const credId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
      await fetch('/api/webauthn/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: editing, credential: { id: credId, rawId: credId } }),
      });
      setForm(f => ({ ...f, webauthn_credential_id: credId }));
      alert('Face ID registered successfully!');
    } catch (e) {
      if (e.name !== 'NotAllowedError') alert('Face ID registration failed: ' + e.message);
    }
  };

  const generatePin = () => {
    const usedPins = people.map(p => p.pin);
    let pin;
    let attempts = 0;
    do {
      pin = String(Math.floor(1000 + Math.random() * 9000)); // 4 digits, 1000-9999
      attempts++;
    } while (usedPins.includes(pin) && attempts < 100);
    setForm(f => ({ ...f, pin }));
  };

  const updateCtx = (key, val) => setForm(f => ({ ...f, personal_context: { ...f.personal_context, [key]: val } }));

  const uploadCert = async (file) => {
    if (editing === 'new') { alert('Save the person first, then upload certifications.'); return; }
    const fd = new FormData();
    fd.append('cert', file);
    try {
      const res = await fetch(`/api/people/${editing}/certs`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) {
        setForm(f => ({ ...f, certifications_files: [...(f.certifications_files || []), data.file] }));
      }
    } catch (err) { console.error('Cert upload failed:', err); }
  };

  const removeCert = async (filename) => {
    if (!confirm('Remove this certification file?')) return;
    try {
      await fetch(`/api/people/${editing}/certs/${filename}`, { method: 'DELETE' });
      setForm(f => ({ ...f, certifications_files: (f.certifications_files || []).filter(c => c.filename !== filename) }));
    } catch (err) { console.error('Cert delete failed:', err); }
  };

  if (loading) return (
    <Box className="loading" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress size={24} sx={{ mr: 1 }} />
      {t('common.loading')}
    </Box>
  );

  if (editing !== null) {
    return (
      <PersonEditor
        editing={editing} form={form} setForm={setForm}
        templates={templates} people={people}
        openSections={openSections} toggleSection={toggleSection}
        onSave={save} onDelete={deletePerson}
        onUploadPhoto={uploadPhoto} onUploadCert={uploadCert} onRemoveCert={removeCert}
        onRegisterFaceId={registerFaceId} onGeneratePin={generatePin}
        messages={messages} messageText={messageText} setMessageText={setMessageText}
        onSendMessage={sendMessage} showMessages={showMessages} setShowMessages={setShowMessages}
        setPeople={setPeople} t={t}
      />
    );
  }

  // ============================================================
  // Person Dashboard View
  // ============================================================
  if (viewing && viewingPerson && !editing) {
    return (
      <PersonDashboard
        user={user}
        person={viewingPerson}
        reports={viewingReports}
        tasks={viewingTasks}
        people={people}
        expandedPersonSection={expandedPersonSection}
        setExpandedPersonSection={setExpandedPersonSection}
        onOpenReport={onOpenReport}
        onOpenTask={(taskId) => navigateTo('taskdetail', { taskId })}
        onEditPerson={() => startEdit(viewing)}
        onDeletePerson={deletePerson2}
        onAssignTask={(p) => {
          if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('preAssignPerson', JSON.stringify({id: p.id, name: p.name}));
          navigateTo('dailyplan');
        }}
        onViewPerson={viewPerson}
      />
    );
  }



  // People list view — extracted to PeopleListSection
  return (
    <PeopleListSection
      user={user}
      activeTrade={activeTrade}
      activeRoleLevels={activeRoleLevels}
      people={people}
      templates={templates}
      expandedCategory={expandedCategory}
      setExpandedCategory={setExpandedCategory}
      onSelectPerson={viewPerson}
      onCreatePerson={startNew}
    />
  );

})
