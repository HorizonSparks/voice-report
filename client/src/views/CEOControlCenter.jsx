import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, TextField, Paper, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, Select,
  Stack,
} from '@mui/material';
import { apiGet, apiPost, apiPatch, apiDelete } from '../lib/apiClient.js';

// Company role ladder (authz.js). The CEO Control Center lets a CEO set anyone in their company
// from 1..7; the backend (ceoGuards.sanitizePersonChange) enforces the walls (no self-lockout, no
// sparks escalation, clamp 1..7) — the UI just surfaces the friendly error if a guard trips.
const ROLE_LABELS = { 1: 'Helper', 2: 'Journeyman', 3: 'Foreman', 4: 'General Foreman', 5: 'Superintendent', 6: 'Project Manager', 7: 'CEO' };
const ROLE_OPTIONS = [1, 2, 3, 4, 5, 6, 7];
const STATUS_OPTIONS = ['active', 'inactive', 'suspended'];

const ORANGE = 'primary.main';

/**
 * CEO Control Center — the per-company administrator window (walled, role_level >= 7).
 * Distinct from the Sparks Command Center. Talks to:
 *   GET   /api/ceo/overview      — the portfolio glance
 *   PATCH /api/ceo/people/:id    — set a person's role / permissions / status (guarded)
 *   /api/projects (+ /members)   — create projects, assign/remove people
 */
export default function CEOControlCenter({ user, goBack }) {
  const [screen, setScreen] = useState('overview'); // overview | people | projects
  const [data, setData] = useState(null);           // { company, counts, projects, people }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);       // { title, message }

  // create project
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // edit person (role/permissions/status)
  const [editPerson, setEditPerson] = useState(null);
  const [editRole, setEditRole] = useState(1);
  const [editTitle, setEditTitle] = useState('');
  const [editStatus, setEditStatus] = useState('active');
  const [saving, setSaving] = useState(false);

  // manage project members
  const [manageProject, setManageProject] = useState(null); // { ...project, members }
  const [addPersonId, setAddPersonId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/ceo/overview');
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load the Control Center');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createProject = async () => {
    if (!newName.trim()) return;
    try {
      await apiPost('/api/projects', { name: newName.trim(), description: newDesc.trim() });
      setNewName(''); setNewDesc(''); setShowCreate(false);
      load();
    } catch (e) { setDialog({ title: 'Could not create project', message: e.message }); }
  };

  const openEditPerson = (p) => {
    setEditPerson(p);
    setEditRole(parseInt(p.role_level || 1, 10));
    setEditTitle(p.role_title || '');
    setEditStatus(p.status || 'active');
  };

  const savePerson = async () => {
    if (!editPerson) return;
    setSaving(true);
    try {
      await apiPatch(`/api/ceo/people/${editPerson.id}`, {
        role_level: editRole,
        role_title: editTitle,
        status: editStatus,
      });
      setEditPerson(null);
      load();
    } catch (e) {
      setDialog({ title: 'Could not update', message: e.message });
    } finally { setSaving(false); }
  };

  const openProject = async (proj) => {
    setAddPersonId('');
    try {
      const full = await apiGet(`/api/projects/${proj.id}`);
      setManageProject({ ...proj, members: full.members || [] });
    } catch (e) { setDialog({ title: 'Could not open project', message: e.message }); }
  };

  const refreshProjectMembers = async (projectId) => {
    const full = await apiGet(`/api/projects/${projectId}`);
    setManageProject((p) => (p ? { ...p, members: full.members || [] } : p));
    load();
  };

  const assignMember = async (projectId) => {
    if (!addPersonId) return;
    try {
      await apiPost(`/api/projects/${projectId}/members`, { person_id: addPersonId, role: 'member' });
      setAddPersonId('');
      await refreshProjectMembers(projectId);
    } catch (e) { setDialog({ title: 'Could not assign', message: e.message }); }
  };

  const removeMember = async (projectId, personId) => {
    try {
      await apiDelete(`/api/projects/${projectId}/members/${personId}`);
      await refreshProjectMembers(projectId);
    } catch (e) { setDialog({ title: 'Could not remove', message: e.message }); }
  };

  if (loading) {
    return (
      <Box sx={{ p: '40px', textAlign: 'center', color: 'text.primary' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading your Control Center…</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: '40px', textAlign: 'center', color: 'text.primary' }}>
        <Typography sx={{ fontWeight: 700, mb: 1 }}>Could not open the Control Center</Typography>
        <Typography sx={{ opacity: 0.7, mb: 2 }}>{error}</Typography>
        <Button onClick={load} className="btn btn-orange">Retry</Button>
      </Box>
    );
  }

  const company = data?.company || {};
  const counts = data?.counts || { projects: 0, people: 0, active_people: 0 };
  const projects = data?.projects || [];
  const people = data?.people || [];

  const Tab = ({ id, label }) => (
    <Button
      onClick={() => setScreen(id)}
      sx={{
        textTransform: 'none', fontWeight: 700, fontSize: 14, borderRadius: '8px', px: 2, py: 0.75,
        color: screen === id ? '#fff' : 'text.primary',
        bgcolor: screen === id ? ORANGE : 'transparent',
        border: '2px solid', borderColor: screen === id ? ORANGE : 'rgba(72,72,74,0.15)',
        '&:hover': { bgcolor: screen === id ? 'primary.dark' : 'rgba(249,148,64,0.08)' },
      }}
    >{label}</Button>
  );

  const CountCard = ({ value, label }) => (
    <Paper sx={{ flex: 1, textAlign: 'center', p: '16px 12px', border: '2px solid', borderColor: ORANGE, borderRadius: '12px', boxShadow: 'none' }}>
      <Typography sx={{ fontSize: 26, fontWeight: 800, color: 'text.primary', lineHeight: 1 }}>{value}</Typography>
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.primary', opacity: 0.7, mt: 0.5 }}>{label}</Typography>
    </Paper>
  );

  return (
    <Box className="list-view" sx={{ pb: 4 }}>
      {/* Header */}
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: ORANGE, letterSpacing: 0.5 }}>CONTROL CENTER</Typography>
        <Typography variant="h2" sx={{ color: 'text.primary', m: 0, fontSize: 24, fontWeight: 800 }}>
          {company.name || 'My Company'}
        </Typography>
      </Box>

      {/* Tabs */}
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Tab id="overview" label="Overview" />
        <Tab id="people" label="People" />
        <Tab id="projects" label="Projects" />
      </Stack>

      {/* ---- OVERVIEW ---- */}
      {screen === 'overview' && (
        <Box>
          <Stack direction="row" spacing={1.5} sx={{ mb: 2.5 }}>
            <CountCard value={counts.projects} label="Projects" />
            <CountCard value={counts.people} label="People" />
            <CountCard value={counts.active_people} label="Active" />
          </Stack>

          <Typography sx={{ fontWeight: 800, fontSize: 16, color: 'text.primary', mb: 1 }}>Projects</Typography>
          {projects.length === 0 ? (
            <Typography sx={{ opacity: 0.6, fontSize: 14 }}>No projects yet — create one in the Projects tab.</Typography>
          ) : (
            <Stack spacing={1}>
              {projects.slice(0, 6).map((p) => (
                <Paper key={p.id} onClick={() => { setScreen('projects'); openProject(p); }}
                  sx={{ p: '14px 18px', border: '2px solid', borderColor: 'text.primary', borderRadius: '12px', cursor: 'pointer', boxShadow: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography sx={{ fontWeight: 700, fontSize: 16, color: 'text.primary' }}>{p.name}</Typography>
                    <Typography sx={{ fontSize: 12, opacity: 0.6 }}>{p.member_count} {p.member_count === 1 ? 'person' : 'people'} · {p.status || 'active'}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: 22, color: ORANGE }}>→</Typography>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {/* ---- PEOPLE ---- */}
      {screen === 'people' && (
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 16, color: 'text.primary', mb: 1 }}>People & permissions</Typography>
          {people.length === 0 ? (
            <Typography sx={{ opacity: 0.6, fontSize: 14 }}>No people in your company yet.</Typography>
          ) : (
            <Stack spacing={1}>
              {people.map((p) => (
                <Paper key={p.id} onClick={() => openEditPerson(p)}
                  sx={{ p: '14px 18px', border: '2px solid', borderColor: 'text.primary', borderRadius: '12px', cursor: 'pointer', boxShadow: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: p.status === 'active' ? 1 : 0.55 }}>
                  <Box>
                    <Typography sx={{ fontWeight: 700, fontSize: 16, color: 'text.primary' }}>{p.name}</Typography>
                    <Typography sx={{ fontSize: 12, opacity: 0.65 }}>
                      {ROLE_LABELS[p.role_level] || `Role ${p.role_level}`}{p.role_title ? ` · ${p.role_title}` : ''}{p.status !== 'active' ? ` · ${p.status}` : ''}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 700, color: ORANGE }}>Edit</Typography>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {/* ---- PROJECTS ---- */}
      {screen === 'projects' && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 16, color: 'text.primary' }}>Projects</Typography>
            <Button onClick={() => setShowCreate(!showCreate)} className="btn btn-orange" sx={{ fontSize: 14, px: 2, py: 1 }}>New Project</Button>
          </Box>

          {showCreate && (
            <Paper sx={{ background: 'white', border: '2px solid', borderColor: ORANGE, borderRadius: '12px', p: '20px', mb: 2, boxShadow: 'none' }}>
              <TextField value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Project name" autoFocus
                sx={{ width: '100%', mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: '8px' } }} />
              <TextField value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description (optional)" multiline rows={2}
                sx={{ width: '100%', mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: '8px' } }} />
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button onClick={createProject} className="btn btn-orange" sx={{ flex: 1 }}>Save</Button>
                <Button onClick={() => setShowCreate(false)} sx={{ flex: 1, border: '1px solid rgba(72,72,74,0.2)', borderRadius: '8px', textTransform: 'none', fontWeight: 600 }}>Cancel</Button>
              </Box>
            </Paper>
          )}

          {projects.length === 0 ? (
            <Typography sx={{ opacity: 0.6, fontSize: 14 }}>No projects yet.</Typography>
          ) : (
            <Stack spacing={1}>
              {projects.map((p) => (
                <Paper key={p.id} onClick={() => openProject(p)}
                  sx={{ p: '14px 18px', border: '2px solid', borderColor: 'text.primary', borderRadius: '12px', cursor: 'pointer', boxShadow: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography sx={{ fontWeight: 700, fontSize: 16, color: 'text.primary' }}>{p.name}</Typography>
                    <Typography sx={{ fontSize: 12, opacity: 0.6 }}>{p.member_count} {p.member_count === 1 ? 'person' : 'people'} · {p.status || 'active'}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 700, color: ORANGE }}>Manage</Typography>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {/* ---- EDIT PERSON DIALOG ---- */}
      <Dialog open={Boolean(editPerson)} onClose={() => setEditPerson(null)} fullWidth maxWidth="xs">
        {editPerson && (
          <>
            <DialogTitle sx={{ fontWeight: 800 }}>{editPerson.name}</DialogTitle>
            <DialogContent>
              <Typography sx={{ fontSize: 12, fontWeight: 700, opacity: 0.6, mt: 1, mb: 0.5 }}>ROLE / PERMISSIONS</Typography>
              <Select fullWidth value={editRole} onChange={(e) => setEditRole(e.target.value)} sx={{ mb: 2, borderRadius: '8px' }}>
                {ROLE_OPTIONS.map((r) => <MenuItem key={r} value={r}>{r} — {ROLE_LABELS[r]}</MenuItem>)}
              </Select>
              <Typography sx={{ fontSize: 12, fontWeight: 700, opacity: 0.6, mb: 0.5 }}>TITLE</Typography>
              <TextField fullWidth value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="e.g. Lead Superintendent"
                sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: '8px' } }} />
              <Typography sx={{ fontSize: 12, fontWeight: 700, opacity: 0.6, mb: 0.5 }}>STATUS</Typography>
              <Select fullWidth value={editStatus} onChange={(e) => setEditStatus(e.target.value)} sx={{ borderRadius: '8px' }}>
                {STATUS_OPTIONS.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button onClick={() => setEditPerson(null)} sx={{ textTransform: 'none', fontWeight: 600 }}>Cancel</Button>
              <Button onClick={savePerson} disabled={saving} className="btn btn-orange">{saving ? 'Saving…' : 'Save'}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* ---- MANAGE PROJECT MEMBERS DIALOG ---- */}
      <Dialog open={Boolean(manageProject)} onClose={() => setManageProject(null)} fullWidth maxWidth="sm">
        {manageProject && (
          <>
            <DialogTitle sx={{ fontWeight: 800 }}>{manageProject.name}</DialogTitle>
            <DialogContent>
              <Typography sx={{ fontSize: 12, fontWeight: 700, opacity: 0.6, mt: 1, mb: 1 }}>TEAM</Typography>
              {(manageProject.members || []).length === 0 ? (
                <Typography sx={{ fontSize: 14, opacity: 0.6, mb: 2 }}>No one assigned yet.</Typography>
              ) : (
                <Stack spacing={0.75} sx={{ mb: 2 }}>
                  {manageProject.members.map((m) => (
                    <Box key={m.person_id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(72,72,74,0.15)', borderRadius: '8px', px: 1.5, py: 1 }}>
                      <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{m.name}{m.role ? ` · ${m.role}` : ''}</Typography>
                      <Button onClick={() => removeMember(manageProject.id, m.person_id)} sx={{ minWidth: 'auto', textTransform: 'none', color: 'text.primary', opacity: 0.6, fontWeight: 700 }}>Remove</Button>
                    </Box>
                  ))}
                </Stack>
              )}
              <Typography sx={{ fontSize: 12, fontWeight: 700, opacity: 0.6, mb: 0.5 }}>ADD PERSON</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Select fullWidth displayEmpty value={addPersonId} onChange={(e) => setAddPersonId(e.target.value)} sx={{ borderRadius: '8px' }}>
                  <MenuItem value=""><em>Select a person…</em></MenuItem>
                  {people
                    .filter((p) => p.status === 'active' && !(manageProject.members || []).some((m) => m.person_id === p.id))
                    .map((p) => <MenuItem key={p.id} value={p.id}>{p.name} — {ROLE_LABELS[p.role_level] || p.role_level}</MenuItem>)}
                </Select>
                <Button onClick={() => assignMember(manageProject.id)} disabled={!addPersonId} className="btn btn-orange" sx={{ whiteSpace: 'nowrap' }}>Add</Button>
              </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button onClick={() => setManageProject(null)} sx={{ textTransform: 'none', fontWeight: 700 }}>Done</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* ---- INFO/ERROR DIALOG ---- */}
      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)}>
        {dialog && (
          <>
            <DialogTitle sx={{ fontWeight: 800 }}>{dialog.title}</DialogTitle>
            <DialogContent><Typography>{dialog.message}</Typography></DialogContent>
            <DialogActions><Button onClick={() => setDialog(null)} className="btn btn-orange">OK</Button></DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
