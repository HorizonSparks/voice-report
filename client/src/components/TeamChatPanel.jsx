import { useState, useEffect, useRef } from 'react';
import { Box, Typography, IconButton, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import MessagesView from '../views/MessagesView.jsx';

/**
 * WhatsApp Desktop-style 3-column Team Chat Panel
 * Left: icon sidebar (chats/profile/folders)
 * Middle: conversation list
 * Right: active chat or empty state
 * On mobile (<768px): full-screen list → full-screen chat
 */
export default function TeamChatPanel({ user, team, teamConversations, onRefreshConversations }) {
  const [selectedMember, setSelectedMember] = useState(null);
  const [sidebarTab, setSidebarTab] = useState('chats'); // chats | profile | folders
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [folders, setFolders] = useState([]);
  const [activeFolder, setActiveFolder] = useState(null); // folder detail with files
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showAddLink, setShowAddLink] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showCloudLink, setShowCloudLink] = useState(null); // 'gdrive' | 'icloud' | 'dropbox' | 'onedrive' | null
  const [newFolderName, setNewFolderName] = useState('');
  const [newLinkName, setNewLinkName] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [cloudLinkUrl, setCloudLinkUrl] = useState('');
  const [cloudLinkName, setCloudLinkName] = useState('');
  const fileInputRef = useRef(null);
  const importFolderRef = useRef(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Resolve admin sentinel to real person_id
  const adminEntry = team.find(m => m.sparks_role === 'admin');
  const myId = user.person_id === '__admin__' && adminEntry ? adminEntry.id : user.person_id;
  const chatUser = user.person_id === '__admin__' && adminEntry ? { ...user, person_id: adminEntry.id } : user;

  // Load folders when switching to folders tab
  useEffect(() => {
    if (sidebarTab === 'folders') loadFolders();
  }, [sidebarTab]);

  const loadFolders = async () => {
    try {
      const res = await fetch('/api/folders');
      if (res.ok) setFolders(await res.json());
    } catch(e) {}
  };

  const loadFolderDetail = async (folderId) => {
    try {
      const res = await fetch(`/api/folders/${folderId}`);
      if (res.ok) setActiveFolder(await res.json());
    } catch(e) {}
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const res = await fetch('/api/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName.trim() }),
      });
      if (res.ok) { setNewFolderName(''); setShowCreateFolder(false); loadFolders(); }
    } catch(e) {}
  };

  const addLink = async () => {
    if (!newLinkName.trim() || !newLinkUrl.trim() || !activeFolder) return;
    try {
      const res = await fetch(`/api/folders/${activeFolder.id}/links`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newLinkName.trim(), url: newLinkUrl.trim() }),
      });
      if (res.ok) { setNewLinkName(''); setNewLinkUrl(''); setShowAddLink(false); loadFolderDetail(activeFolder.id); }
    } catch(e) {}
  };

  const uploadFile = async (file) => {
    if (!file || !activeFolder) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await fetch(`/api/folders/${activeFolder.id}/files`, { method: 'POST', body: fd });
      loadFolderDetail(activeFolder.id);
    } catch(e) {}
  };

  const deleteFile = async (fileId) => {
    try {
      await fetch(`/api/folders/files/${fileId}`, { method: 'DELETE' });
      loadFolderDetail(activeFolder.id);
    } catch(e) {}
  };

  const deleteFolder = async (folderId) => {
    try {
      await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
      setActiveFolder(null);
      loadFolders();
    } catch(e) {}
  };

  const importFolder = async (files) => {
    if (!files || files.length === 0) return;
    // Create a folder named after the first file's path
    const folderName = files[0].webkitRelativePath?.split('/')[0] || 'Imported Folder';
    try {
      const res = await fetch('/api/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName }),
      });
      if (!res.ok) return;
      const folder = await res.json();
      // Upload all files
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        await fetch(`/api/folders/${folder.id}/files`, { method: 'POST', body: fd });
      }
      loadFolders();
      loadFolderDetail(folder.id);
    } catch(e) {}
  };

  const cloudServices = {
    gdrive: { name: 'Google Drive', icon: '🟢', placeholder: 'https://drive.google.com/drive/folders/...' },
    icloud: { name: 'iCloud', icon: '🔵', placeholder: 'https://www.icloud.com/iclouddrive/...' },
    dropbox: { name: 'Dropbox', icon: '🔷', placeholder: 'https://www.dropbox.com/sh/...' },
    onedrive: { name: 'OneDrive', icon: '☁️', placeholder: 'https://onedrive.live.com/...' },
  };

  const addCloudLink = async () => {
    if (!cloudLinkUrl.trim() || !showCloudLink) return;
    const service = cloudServices[showCloudLink];
    const name = cloudLinkName.trim() || `${service.name} Folder`;
    // Create a folder for this cloud link if no active folder
    try {
      let folderId;
      if (activeFolder) {
        folderId = activeFolder.id;
      } else {
        const res = await fetch('/api/folders', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) return;
        const folder = await res.json();
        folderId = folder.id;
      }
      await fetch(`/api/folders/${folderId}/links`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url: cloudLinkUrl.trim() }),
      });
      setCloudLinkUrl(''); setCloudLinkName(''); setShowCloudLink(null);
      loadFolders();
      if (folderId) loadFolderDetail(folderId);
    } catch(e) {}
  };

  // Sort: conversations first (by recency), then alphabetical
  const sorted = [...team].filter(m => m.id !== myId).sort((a, b) => {
    const convA = teamConversations[a.id];
    const convB = teamConversations[b.id];
    if (convA && convB) return new Date(convB.last_message_at) - new Date(convA.last_message_at);
    if (convA) return -1;
    if (convB) return 1;
    return a.name.localeCompare(b.name);
  });

  const formatConvTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (msgDay.getTime() === today.getTime()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const selectMember = (member) => {
    setSelectedMember({ id: member.id, name: member.name });
    setSidebarTab('chats');
  };

  // ---- MOBILE: full-screen list or full-screen chat ----
  if (isMobile) {
    if (selectedMember) {
      return (
        <MessagesView
          user={chatUser}
          initialContact={selectedMember}
          onBack={() => setSelectedMember(null)}
        />
      );
    }
    return (
      <Box>
        <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1 }}>
          Chats
        </Typography>
        <Box sx={{ mx: -2 }}>
          {sorted.map(member => <ChatListItem key={member.id} member={member} conv={teamConversations[member.id]} selected={false} onClick={() => selectMember(member)} formatConvTime={formatConvTime} />)}
        </Box>
      </Box>
    );
  }

  // ---- DESKTOP: 3-column split layout ----
  return (
    <Box sx={{ display: 'flex', overflow: 'hidden', position: 'fixed', top: 68, left: 0, right: 0, bottom: 0, zIndex: 50, bgcolor: 'background.default' }}>
      {/* Column 1: Icon sidebar */}
      <Box sx={{ width: 56, bgcolor: 'var(--charcoal)', display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1.5, gap: 0.5, flexShrink: 0 }}>
        <SidebarIcon icon="chats" active={sidebarTab === 'chats'} onClick={() => setSidebarTab('chats')} />
        <SidebarIcon icon="profile" active={sidebarTab === 'profile'} onClick={() => setSidebarTab('profile')} disabled={!selectedMember} />
        <SidebarIcon icon="folders" active={sidebarTab === 'folders'} onClick={() => setSidebarTab('folders')} />
        <Box sx={{ flex: 1 }} />
        <SidebarIcon icon="agent" active={false} onClick={() => {}} disabled />
      </Box>

      {/* Column 2: Middle panel (chat list / profile / folders) */}
      <Box sx={{ width: 320, bgcolor: 'background.paper', borderRight: '1px solid rgba(72,72,74,0.12)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {sidebarTab === 'chats' && (
          <>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid rgba(72,72,74,0.08)' }}>
              <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1 }}>Chats</Typography>
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto' }}>
              {sorted.map(member => (
                <ChatListItem
                  key={member.id}
                  member={member}
                  conv={teamConversations[member.id]}
                  selected={selectedMember?.id === member.id}
                  onClick={() => selectMember(member)}
                  formatConvTime={formatConvTime}
                />
              ))}
            </Box>
          </>
        )}

        {sidebarTab === 'profile' && selectedMember && (() => {
          const member = team.find(m => m.id === selectedMember.id);
          if (!member) return null;
          return (
            <>
              <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid rgba(72,72,74,0.08)' }}>
                <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1 }}>Profile</Typography>
              </Box>
              <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <Box sx={{ width: 80, height: 80, borderRadius: '50%', bgcolor: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 28, mt: 2 }}>
                  {member.name.split(' ').map(n => n[0]).join('').substring(0,2)}
                </Box>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography sx={{ fontWeight: 800, fontSize: 20, color: 'text.primary' }}>{member.name}</Typography>
                  <Typography sx={{ fontSize: 14, color: 'var(--primary)', fontWeight: 600 }}>{member.role_title}</Typography>
                </Box>
                <Box sx={{ width: '100%', mt: 1 }}>
                  <InfoRow label="Role" value={member.sparks_role} />
                  <InfoRow label="Trade" value={member.trade || 'Sparks'} />
                  <InfoRow label="Status" value={member.status || 'Active'} />
                </Box>
              </Box>
            </>
          );
        })()}

        {sidebarTab === 'folders' && (
          <>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid rgba(72,72,74,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1 }}>
                {activeFolder ? activeFolder.name : 'Folders'}
              </Typography>
              {activeFolder ? (
                <Button size="small" onClick={() => setActiveFolder(null)} sx={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', textTransform: 'none', minWidth: 'auto' }}>All Folders</Button>
              ) : (
                <Box sx={{ position: 'relative' }}>
                  <IconButton size="small" onClick={() => setShowPlusMenu(!showPlusMenu)} sx={{ color: 'var(--primary)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </IconButton>
                  {showPlusMenu && (
                    <>
                      <Box onClick={() => setShowPlusMenu(false)} sx={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} />
                      <Box sx={{ position: 'absolute', top: '100%', right: 0, mt: 0.5, bgcolor: 'background.paper', borderRadius: 2, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 100, minWidth: 200, overflow: 'hidden', border: '1px solid rgba(72,72,74,0.1)' }}>
                        <PlusMenuItem icon="📁" label="Create Folder" onClick={() => { setShowPlusMenu(false); setShowCreateFolder(true); }} />
                        <PlusMenuItem icon="📂" label="Import Folder" onClick={() => { setShowPlusMenu(false); importFolderRef.current?.click(); }} />
                        <Box sx={{ height: 1, bgcolor: 'rgba(72,72,74,0.08)', mx: 1 }} />
                        <PlusMenuItem icon="🟢" label="Link Google Drive" onClick={() => { setShowPlusMenu(false); setShowCloudLink('gdrive'); }} />
                        <PlusMenuItem icon="🔵" label="Link iCloud" onClick={() => { setShowPlusMenu(false); setShowCloudLink('icloud'); }} />
                        <PlusMenuItem icon="🔷" label="Link Dropbox" onClick={() => { setShowPlusMenu(false); setShowCloudLink('dropbox'); }} />
                        <PlusMenuItem icon="☁️" label="Link OneDrive" onClick={() => { setShowPlusMenu(false); setShowCloudLink('onedrive'); }} />
                      </Box>
                    </>
                  )}
                  <input ref={importFolderRef} type="file" webkitdirectory="" directory="" multiple style={{ display: 'none' }} onChange={e => { importFolder(e.target.files); e.target.value = ''; }} />
                </Box>
              )}
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto' }}>
              {!activeFolder ? (
                /* Folder list */
                <>
                  {folders.length === 0 && (
                    <Box sx={{ textAlign: 'center', py: 4, px: 2 }}>
                      <Typography sx={{ fontSize: 36, mb: 1 }}>📁</Typography>
                      <Typography sx={{ fontSize: 14, color: 'text.secondary', fontWeight: 600 }}>No folders yet</Typography>
                      <Button onClick={() => setShowCreateFolder(true)} sx={{ mt: 1.5, fontSize: 13, fontWeight: 700, color: 'var(--primary)', textTransform: 'none' }}>Create your first folder</Button>
                    </Box>
                  )}
                  {folders.map(f => (
                    <Box key={f.id} onClick={() => loadFolderDetail(f.id)} sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5,
                      cursor: 'pointer', borderBottom: '1px solid rgba(72,72,74,0.08)',
                      '&:hover': { bgcolor: 'rgba(249,148,64,0.04)' },
                    }}>
                      <Typography sx={{ fontSize: 28 }}>📁</Typography>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 700, fontSize: 14, color: 'text.primary' }}>{f.name}</Typography>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{f.file_count || 0} items</Typography>
                      </Box>
                    </Box>
                  ))}
                </>
              ) : (
                /* Folder detail — files and links */
                <>
                  <Box sx={{ px: 2, py: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button size="small" onClick={() => fileInputRef.current?.click()} sx={{ fontSize: 11, fontWeight: 700, bgcolor: 'var(--primary)', color: 'white', textTransform: 'none', borderRadius: 2, '&:hover': { bgcolor: 'var(--primary)', opacity: 0.9 } }}>Upload File</Button>
                    <Button size="small" onClick={() => setShowAddLink(true)} sx={{ fontSize: 11, fontWeight: 700, border: '1px solid var(--primary)', color: 'var(--primary)', textTransform: 'none', borderRadius: 2 }}>Add Link</Button>
                    <Button size="small" onClick={() => { const url = `${window.location.origin}/shared/${activeFolder.id}`; navigator.clipboard?.writeText(url); alert('Folder link copied!'); }} sx={{ fontSize: 11, fontWeight: 700, border: '1px solid rgba(72,72,74,0.2)', color: 'text.secondary', textTransform: 'none', borderRadius: 2, ml: 'auto' }}>Share</Button>
                    <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) uploadFile(e.target.files[0]); e.target.value = ''; }} />
                  </Box>
                  {(!activeFolder.files || activeFolder.files.length === 0) && (
                    <Box sx={{ textAlign: 'center', py: 3 }}>
                      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>No files yet. Upload a file or add a link.</Typography>
                    </Box>
                  )}
                  {(activeFolder.files || []).map(f => (
                    <Box key={f.id} sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25,
                      borderBottom: '1px solid rgba(72,72,74,0.06)',
                    }}>
                      <Typography sx={{ fontSize: 22 }}>{f.type === 'link' ? '🔗' : '📄'}</Typography>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        {f.type === 'link' ? (
                          <Typography component="a" href={f.url} target="_blank" rel="noopener" sx={{ fontWeight: 700, fontSize: 13, color: 'var(--primary)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', '&:hover': { textDecoration: 'underline' } }}>{f.name}</Typography>
                        ) : (
                          <Typography component="a" href={`/api/folders/download/${f.filename}`} download={f.original_name} sx={{ fontWeight: 700, fontSize: 13, color: 'text.primary', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', '&:hover': { color: 'var(--primary)' } }}>{f.name}</Typography>
                        )}
                        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                          {f.uploaded_by_name || 'Unknown'} {f.size_bytes ? `· ${(f.size_bytes / 1024).toFixed(0)} KB` : ''}
                        </Typography>
                      </Box>
                      <IconButton size="small" onClick={() => deleteFile(f.id)} sx={{ opacity: 0.4, '&:hover': { opacity: 1 } }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </IconButton>
                    </Box>
                  ))}
                </>
              )}
            </Box>
          </>
        )}

        {sidebarTab === 'profile' && !selectedMember && (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
            <Typography sx={{ fontSize: 14, color: 'text.secondary', textAlign: 'center' }}>Select a team member to view their profile</Typography>
          </Box>
        )}
      </Box>

      {/* Column 3: Active chat */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', bgcolor: '#ECE5DD' }}>
        {selectedMember ? (
          <MessagesView
            key={selectedMember.id}
            user={chatUser}
            initialContact={selectedMember}
            embedded
          />
        ) : (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <Box sx={{ width: 80, height: 80, borderRadius: '50%', bgcolor: 'rgba(249,148,64,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ fontSize: 36 }}>💬</Typography>
            </Box>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'text.primary' }}>Horizon Sparks</Typography>
            <Typography sx={{ fontSize: 14, color: 'text.secondary', textAlign: 'center', maxWidth: 300 }}>
              Select a team member to start chatting. Send text, voice messages, photos, and files.
            </Typography>
          </Box>
        )}
      </Box>

      {/* Create Folder Dialog */}
      <Dialog open={showCreateFolder} onClose={() => setShowCreateFolder(false)} PaperProps={{ sx: { borderRadius: 3, minWidth: 320 } }}>
        <DialogTitle sx={{ fontWeight: 800, fontSize: 18 }}>New Folder</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth placeholder="Folder name" value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && createFolder()}
            variant="outlined" size="small" sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCreateFolder(false)} sx={{ color: 'text.secondary', textTransform: 'none' }}>Cancel</Button>
          <Button onClick={createFolder} sx={{ bgcolor: 'var(--primary)', color: 'white', textTransform: 'none', fontWeight: 700, '&:hover': { bgcolor: 'var(--primary)', opacity: 0.9 } }}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Add Link Dialog */}
      <Dialog open={showAddLink} onClose={() => setShowAddLink(false)} PaperProps={{ sx: { borderRadius: 3, minWidth: 320 } }}>
        <DialogTitle sx={{ fontWeight: 800, fontSize: 18 }}>Add Link</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField autoFocus fullWidth placeholder="Link name (e.g. Project Docs)" value={newLinkName} onChange={e => setNewLinkName(e.target.value)}
            variant="outlined" size="small" sx={{ mt: 1 }} />
          <TextField fullWidth placeholder="URL (e.g. https://drive.google.com/...)" value={newLinkUrl} onChange={e => setNewLinkUrl(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && addLink()}
            variant="outlined" size="small" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddLink(false)} sx={{ color: 'text.secondary', textTransform: 'none' }}>Cancel</Button>
          <Button onClick={addLink} sx={{ bgcolor: 'var(--primary)', color: 'white', textTransform: 'none', fontWeight: 700, '&:hover': { bgcolor: 'var(--primary)', opacity: 0.9 } }}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Cloud Service Link Dialog */}
      <Dialog open={!!showCloudLink} onClose={() => setShowCloudLink(null)} PaperProps={{ sx: { borderRadius: 3, minWidth: 360 } }}>
        {showCloudLink && (
          <>
            <DialogTitle sx={{ fontWeight: 800, fontSize: 18, display: 'flex', alignItems: 'center', gap: 1 }}>
              <span>{cloudServices[showCloudLink]?.icon}</span> Link {cloudServices[showCloudLink]?.name}
            </DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                Paste a {cloudServices[showCloudLink]?.name} folder or file link. Your team will be able to access it directly.
              </Typography>
              <TextField autoFocus fullWidth placeholder={cloudServices[showCloudLink]?.placeholder} value={cloudLinkUrl} onChange={e => setCloudLinkUrl(e.target.value)}
                variant="outlined" size="small" sx={{ mt: 0.5 }} />
              <TextField fullWidth placeholder="Name (optional)" value={cloudLinkName} onChange={e => setCloudLinkName(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && addCloudLink()}
                variant="outlined" size="small" />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setShowCloudLink(null)} sx={{ color: 'text.secondary', textTransform: 'none' }}>Cancel</Button>
              <Button onClick={addCloudLink} disabled={!cloudLinkUrl.trim()} sx={{ bgcolor: 'var(--primary)', color: 'white', textTransform: 'none', fontWeight: 700, '&:hover': { bgcolor: 'var(--primary)', opacity: 0.9 } }}>Save</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}

// ---- Sub-components ----

function PlusMenuItem({ icon, label, onClick }) {
  return (
    <Box onClick={onClick} sx={{
      display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25,
      cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'text.primary',
      '&:hover': { bgcolor: 'rgba(249,148,64,0.06)' },
    }}>
      <Typography sx={{ fontSize: 16 }}>{icon}</Typography>
      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{label}</Typography>
    </Box>
  );
}

function ChatListItem({ member, conv, selected, onClick, formatConvTime }) {
  const hasUnread = conv && conv.unread_count > 0;
  return (
    <Box onClick={onClick} sx={{
      display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5,
      cursor: 'pointer', borderBottom: '1px solid rgba(72,72,74,0.08)',
      bgcolor: selected ? 'rgba(249,148,64,0.1)' : 'transparent',
      borderLeft: selected ? '3px solid var(--primary)' : '3px solid transparent',
      '&:hover': { bgcolor: selected ? 'rgba(249,148,64,0.1)' : 'rgba(249,148,64,0.04)' },
    }}>
      <Box sx={{ width: 48, height: 48, borderRadius: '50%', bgcolor: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
        {member.name.split(' ').map(n => n[0]).join('').substring(0,2)}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: hasUnread ? 800 : 700, color: 'text.primary', fontSize: 15, lineHeight: 1.3 }}>
          {member.name}
        </Typography>
        <Typography sx={{ fontSize: 13, color: hasUnread ? 'text.primary' : 'text.secondary', fontWeight: hasUnread ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.4 }}>
          {conv ? (
            <>
              {conv.last_message_is_mine && <span style={{ color: 'var(--primary)', marginRight: 4 }}>You: </span>}
              {conv.last_message_preview || member.role_title}
            </>
          ) : member.role_title}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
        <Typography sx={{ fontSize: 12, color: hasUnread ? 'var(--primary)' : 'text.secondary', fontWeight: hasUnread ? 700 : 400 }}>
          {conv ? formatConvTime(conv.last_message_at) : ''}
        </Typography>
        {hasUnread && (
          <Box sx={{ minWidth: 20, height: 20, borderRadius: '50%', bgcolor: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ fontSize: 11, fontWeight: 800, color: 'white', lineHeight: 1 }}>{conv.unread_count}</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function SidebarIcon({ icon, active, onClick, disabled }) {
  const icons = {
    chats: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#F99440' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    profile: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#F99440' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    folders: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#F99440' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
    agent: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>,
  };
  return (
    <IconButton
      onClick={onClick}
      disabled={disabled}
      sx={{
        width: 44, height: 44, borderRadius: 1.5,
        bgcolor: active ? 'rgba(249,148,64,0.15)' : 'transparent',
        '&:hover': { bgcolor: 'rgba(249,148,64,0.1)' },
        '&.Mui-disabled': { opacity: 0.3 },
      }}
    >
      {icons[icon]}
    </IconButton>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 1, borderBottom: '1px solid rgba(72,72,74,0.06)' }}>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', fontWeight: 600 }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, color: 'text.primary', fontWeight: 700, textTransform: 'capitalize' }}>{value}</Typography>
    </Box>
  );
}
