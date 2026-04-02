import { useState, useEffect } from 'react';
import { Box, Typography, IconButton } from '@mui/material';
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

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Resolve admin sentinel to real person_id
  const adminEntry = team.find(m => m.sparks_role === 'admin');
  const myId = user.person_id === '__admin__' && adminEntry ? adminEntry.id : user.person_id;
  const chatUser = user.person_id === '__admin__' && adminEntry ? { ...user, person_id: adminEntry.id } : user;

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
        <SidebarIcon icon="folders" active={sidebarTab === 'folders'} onClick={() => setSidebarTab('folders')} disabled={!selectedMember} />
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

        {sidebarTab === 'folders' && selectedMember && (
          <>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid rgba(72,72,74,0.08)' }}>
              <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1 }}>Shared Files</Typography>
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography sx={{ fontSize: 40, mb: 1 }}>📁</Typography>
                <Typography sx={{ fontSize: 14, color: 'text.secondary', fontWeight: 600 }}>Shared files with {selectedMember.name}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>Photos, documents, and files shared in your conversation will appear here.</Typography>
              </Box>
            </Box>
          </>
        )}

        {(sidebarTab === 'profile' || sidebarTab === 'folders') && !selectedMember && (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
            <Typography sx={{ fontSize: 14, color: 'text.secondary', textAlign: 'center' }}>Select a team member to view their {sidebarTab}</Typography>
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
    </Box>
  );
}

// ---- Sub-components ----

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
