import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography, Button, TextField, Paper, CircularProgress } from '@mui/material';

export default function ProjectsView({ user, activeTrade, onSelectProject, navigateTo, readOnly }) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const isAdmin = user && (user.is_admin || parseInt(user.role_level || 0) >= 3);

  useEffect(() => {
    loadProjects();
  }, [activeTrade]);

  const loadProjects = async () => {
    try {
      const url = activeTrade ? `/api/projects?trade=${encodeURIComponent(activeTrade)}` : '/api/projects';
      const res = await fetch(url);
      if (!res.ok) { setProjects([]); return; }
      const data = await res.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch (err) { console.error('Failed to load projects:', err); }
    setLoading(false);
  };

  const createProject = async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), trade: activeTrade, description: newDesc.trim() }),
      });
      if (res.ok) {
        setNewName('');
        setNewDesc('');
        setShowCreate(false);
        loadProjects();
      }
    } catch (err) { alert('Failed to create project: ' + err.message); }
  };

  const deleteProject = async (id, name, e) => {
    e.stopPropagation();
    if (!confirm(t('projects.deleteConfirm', { name }))) return;
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      loadProjects();
    } catch (err) { alert('Delete failed: ' + err.message); }
  };

  if (loading) return (
    <Box sx={{ padding: '40px', textAlign: 'center', color: 'text.primary' }}>
      <CircularProgress />
      <Typography sx={{ mt: 2 }}>{t('common.loading')}</Typography>
    </Box>
  );

  return (
    <Box className="list-view">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Typography variant="h2" sx={{ color: 'text.primary', margin: 0, fontSize: '22px', fontWeight: 700 }}>{t('projects.title')}</Typography>
        {isAdmin && (
          <Button
            onClick={() => setShowCreate(!showCreate)}
            className="btn btn-orange"
            sx={{ fontSize: '14px', padding: '8px 16px' }}
          >
            {t('projects.newProject')}
          </Button>
        )}
      </Box>

      {showCreate && (
        <Paper sx={{ background: 'white', border: '2px solid', borderColor: 'primary.main', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <TextField
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={t('projects.projectName')}
            sx={{ width: '100%', marginBottom: '12px', '& .MuiInputBase-input': { padding: '12px', fontSize: '16px' }, '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
            autoFocus
          />
          <TextField
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder={t('projects.descriptionOptional')}
            multiline
            rows={2}
            sx={{ width: '100%', marginBottom: '12px', '& .MuiInputBase-input': { padding: '12px', fontSize: '14px', resize: 'none' }, '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
          />
          <Box sx={{ display: 'flex', gap: '8px' }}>
            <Button onClick={createProject} className="btn btn-orange" sx={{ flex: 1 }}>{t('projects.create')}</Button>
            <Button
              onClick={() => setShowCreate(false)}
              sx={{ flex: 1, padding: '10px', border: '1px solid rgba(72,72,74,0.2)', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: 600, textTransform: 'none' }}
            >
              {t('common.cancel')}
            </Button>
          </Box>
        </Paper>
      )}

      {projects.length === 0 ? (
        <Box sx={{ textAlign: 'center', padding: '60px 20px', color: 'text.primary', opacity: 0.6 }}>
          <Box sx={{ fontSize: '48px', marginBottom: '16px' }}>📁</Box>
          <Typography sx={{ fontSize: '16px', fontWeight: 600 }}>{t('projects.noProjects')}</Typography>
          <Typography sx={{ fontSize: '14px' }}>{t('projects.getStarted')}</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {projects.map(p => (
            <Paper
              key={p.id}
              onClick={() => onSelectProject(p)}
              sx={{
                background: 'white',
                border: '2px solid',
                borderColor: 'text.primary',
                borderRadius: '12px',
                padding: '20px',
                cursor: 'pointer',
                transition: 'transform 0.1s',
                position: 'relative',
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="h3" sx={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: 'text.primary' }}>{p.name}</Typography>
                  {p.description && <Typography sx={{ margin: '0 0 8px 0', fontSize: '14px', color: 'text.primary', opacity: 0.7 }}>{p.description}</Typography>}
                  <Box sx={{ display: 'flex', gap: '12px', fontSize: '12px', color: 'text.primary', opacity: 0.5 }}>
                    <Typography component="span" sx={{ fontSize: '12px' }}>{p.status || 'active'}</Typography>
                    {p.trade && <Typography component="span" sx={{ fontSize: '12px' }}>{p.trade}</Typography>}
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Typography component="span" sx={{ fontSize: '24px', color: 'primary.main' }}>→</Typography>
                  {isAdmin && (
                    <Button
                      onClick={(e) => deleteProject(p.id, p.name, e)}
                      sx={{ background: 'none', border: 'none', fontSize: '18px', color: '#c00', cursor: 'pointer', padding: '4px', minWidth: 'auto' }}
                    >&times;</Button>
                  )}
                </Box>
              </Box>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}
