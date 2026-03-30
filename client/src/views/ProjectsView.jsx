import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

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

  if (loading) return <div style={{padding: '40px', textAlign: 'center', color: 'var(--charcoal)'}}>{t('common.loading')}</div>;

  return (
    <div className="list-view">
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
        <h2 style={{color: 'var(--charcoal)', margin: 0, fontSize: '22px', fontWeight: 700}}>{t('projects.title')}</h2>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn btn-orange"
            style={{fontSize: '14px', padding: '8px 16px'}}
          >
            {t('projects.newProject')}
          </button>
        )}
      </div>

      {showCreate && (
        <div style={{background: 'white', border: '2px solid var(--primary)', borderRadius: '12px', padding: '20px', marginBottom: '20px'}}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={t('projects.projectName')}
            style={{width: '100%', padding: '12px', fontSize: '16px', border: '1px solid rgba(72,72,74,0.2)', borderRadius: '8px', marginBottom: '12px', boxSizing: 'border-box'}}
            autoFocus
          />
          <textarea
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder={t('projects.descriptionOptional')}
            rows={2}
            style={{width: '100%', padding: '12px', fontSize: '14px', border: '1px solid rgba(72,72,74,0.2)', borderRadius: '8px', marginBottom: '12px', resize: 'none', boxSizing: 'border-box'}}
          />
          <div style={{display: 'flex', gap: '8px'}}>
            <button onClick={createProject} className="btn btn-orange" style={{flex: 1}}>{t('projects.create')}</button>
            <button onClick={() => setShowCreate(false)} style={{flex: 1, padding: '10px', border: '1px solid rgba(72,72,74,0.2)', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: 600}}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <div style={{textAlign: 'center', padding: '60px 20px', color: 'var(--charcoal)', opacity: 0.6}}>
          <div style={{fontSize: '48px', marginBottom: '16px'}}>📁</div>
          <p style={{fontSize: '16px', fontWeight: 600}}>{t('projects.noProjects')}</p>
          <p style={{fontSize: '14px'}}>{t('projects.getStarted')}</p>
        </div>
      ) : (
        <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
          {projects.map(p => (
            <div
              key={p.id}
              onClick={() => onSelectProject(p)}
              style={{
                background: 'white',
                border: '2px solid var(--charcoal)',
                borderRadius: '12px',
                padding: '20px',
                cursor: 'pointer',
                transition: 'transform 0.1s',
                position: 'relative',
              }}
            >
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
                <div style={{flex: 1}}>
                  <h3 style={{margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: 'var(--charcoal)'}}>{p.name}</h3>
                  {p.description && <p style={{margin: '0 0 8px 0', fontSize: '14px', color: 'var(--charcoal)', opacity: 0.7}}>{p.description}</p>}
                  <div style={{display: 'flex', gap: '12px', fontSize: '12px', color: 'var(--charcoal)', opacity: 0.5}}>
                    <span>{p.status || 'active'}</span>
                    {p.trade && <span>{p.trade}</span>}
                  </div>
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                  <span style={{fontSize: '24px', color: 'var(--primary)'}}>→</span>
                  {isAdmin && (
                    <button
                      onClick={(e) => deleteProject(p.id, p.name, e)}
                      style={{background: 'none', border: 'none', fontSize: '18px', color: '#c00', cursor: 'pointer', padding: '4px'}}
                    >&times;</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
