import { useState, useEffect, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography, Button, TextField, Paper, CircularProgress, IconButton, Dialog, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import VoiceMessagePlayer from '../components/VoiceMessagePlayer.jsx';

export default function MessagesView({ user, readOnly, initialContact, onBack, embedded }) {
  const { t } = useTranslation();
  const [contacts, setContacts] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeChat, setActiveChat] = useState(null); // contact_id
  const [activeChatName, setActiveChatName] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showContacts, setShowContacts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const chatEndRef = useRef(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceRecordingTime, setVoiceRecordingTime] = useState(0);
  const voiceRecorderRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceTimerRef = useRef(null);
  const personId = user.person_id;
  const [dialogConfig, setDialogConfig] = useState(null);
  const showAlert = (message) => setDialogConfig({ message });
  const showConfirm = (message, onConfirm) => setDialogConfig({ message, onConfirm, showCancel: true });
  const closeDialog = () => setDialogConfig(null);

  // Load contacts on mount to know who the supervisor is
  useEffect(() => {
    if (personId) loadContacts();
  }, [personId]);

  // Load conversations on mount
  useEffect(() => {
    if (!personId) return;
    loadConversations();
  }, [personId]);

  // Auto-open chat when initialContact is provided (from Team screen)
  const initialOpenedRef = useRef(null);
  useEffect(() => {
    if (initialContact && initialContact.id !== initialOpenedRef.current) {
      initialOpenedRef.current = initialContact.id;
      openChat(initialContact.id, initialContact.name);
    }
  }, [initialContact]);

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Poll for new messages every 5 seconds when in a chat
  useEffect(() => {
    if (!activeChat) return;
    const interval = setInterval(() => {
      loadChat(activeChat, false);
    }, 5000);
    return () => clearInterval(interval);
  }, [activeChat]);

  const loadConversations = async () => {
    try {
      const res = await fetch(`/api/v2/conversations/${personId}`);
      const data = await res.json();
      setConversations(data);
      setLoading(false);
    } catch(e) { setLoading(false); }
  };

  const loadContacts = async () => {
    try {
      const res = await fetch(`/api/v2/contacts/${personId}`);
      const data = await res.json();
      setContacts(data);
    } catch(e) {}
  };

  const loadChat = async (contactId, showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch(`/api/v2/messages/${personId}/${contactId}`);
      const data = await res.json();
      setChatMessages(data);
      if (showLoading) setLoading(false);
      // Refresh conversation list to update unread counts
      loadConversations();
    } catch(e) { if (showLoading) setLoading(false); }
  };

  const openChat = (contactId, contactName) => {
    setActiveChat(contactId);
    setActiveChatName(contactName);
    setShowContacts(false);
    loadChat(contactId);
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeChat) return;
    try {
      await fetch('/api/v2/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_id: personId,
          to_id: activeChat,
          content: newMessage.trim(),
          type: 'text',
        }),
      });
      setNewMessage('');
      loadChat(activeChat, false);
    } catch(e) { showAlert(t('messages.sendFailed')); }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4' });
      voiceChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) voiceChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(voiceChunksRef.current, { type: mimeType });
        if (blob.size < 1000) return; // Too short, ignore
        // Upload
        const ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'webm';
        const formData = new window.FormData();
        formData.append('audio', blob, `voice_msg.${ext}`);
        formData.append('from_id', personId);
        formData.append('to_id', activeChat);
        try {
          await fetch('/api/v2/messages/voice', { method: 'POST', body: formData });
          loadChat(activeChat, false);
        } catch(e) { showAlert('Failed to send voice message'); }
      };
      recorder.start(100);
      voiceRecorderRef.current = recorder;
      setIsRecordingVoice(true);
      setVoiceRecordingTime(0);
      voiceTimerRef.current = setInterval(() => setVoiceRecordingTime(t => t + 1), 1000);
    } catch(e) { showAlert('Microphone access denied'); }
  };

  const stopVoiceRecording = () => {
    if (voiceRecorderRef.current && voiceRecorderRef.current.state !== 'inactive') {
      voiceRecorderRef.current.stop();
    }
    clearInterval(voiceTimerRef.current);
    setIsRecordingVoice(false);
    setVoiceRecordingTime(0);
  };

  const cancelVoiceRecording = () => {
    if (voiceRecorderRef.current) {
      voiceRecorderRef.current.ondataavailable = null;
      voiceRecorderRef.current.onstop = null;
      if (voiceRecorderRef.current.state !== 'inactive') voiceRecorderRef.current.stop();
      voiceRecorderRef.current.stream?.getTracks().forEach(t => t.stop());
    }
    clearInterval(voiceTimerRef.current);
    setIsRecordingVoice(false);
    setVoiceRecordingTime(0);
    voiceChunksRef.current = [];
  };

  const formatTime = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (msgDay.getTime() === today.getTime()) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (msgDay.getTime() === yesterday.getTime()) {
      return 'Yesterday ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  // Track keyboard height for mobile
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const inputBarRef = useRef(null);

  useEffect(() => {
    if (!activeChat) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const offset = window.innerHeight - vv.height;
      setKeyboardOffset(offset);
      // Scroll to bottom when keyboard opens
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    return () => { vv.removeEventListener('resize', onResize); vv.removeEventListener('scroll', onResize); };
  }, [activeChat]);

  // Photo upload for messages
  const chatPhotoRef = useRef(null);
  const chatGalleryRef = useRef(null);
  const [showChatPhotoChoice, setShowChatPhotoChoice] = useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);

  const deleteMessage = (msgId) => {
    showConfirm('Delete this message?', async () => {
      try {
        const res = await fetch('/api/v2/messages/' + msgId, { method: 'DELETE' });
        if (res.ok) {
          setChatMessages(prev => prev.filter(m => m.id !== msgId));
        } else { showAlert('Failed to delete message'); }
      } catch (err) { showAlert('Delete error: ' + err.message); }
    });
  };

  const sendFile = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('from_id', personId);
    fd.append('to_id', activeChat);
    try {
      const res = await fetch('/api/v2/messages/file', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) {
        setChatMessages(prev => [...prev, data.message]);
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    } catch (err) { console.error('File send failed:', err); }
  };

  const chatFileRef = useRef(null);

  const sendPhoto = async (file) => {
    if (!file || !activeChat) return;
    setSendingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      formData.append('from_id', personId);
      formData.append('to_id', activeChat);
      const res = await fetch('/api/v2/messages/photo', { method: 'POST', body: formData });
      if (res.ok) loadChat(activeChat, false);
    } catch(e) { showAlert('Failed to send photo'); }
    setSendingPhoto(false);
  };

  // ---- CHAT VIEW ----
  if (activeChat) {
    // Find contact info for role display
    const chatContact = contacts.find(c => c.id === activeChat) || conversations.find(c => c.contact_id === activeChat);
    const chatRole = chatContact?.role_title || '';

    return (
      <Box sx={embedded
        ? { display: 'flex', flexDirection: 'column', background: '#ECE5DD', height: '100%', width: '100%' }
        : { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', background: '#ECE5DD', zIndex: 1200 }
      }>
        {/* Chat header -- WhatsApp style */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--charcoal)', flexShrink: 0 }}>
          {!embedded && <Button onClick={() => { if (initialContact && onBack) { onBack(); } else { setActiveChat(null); setKeyboardOffset(0); loadConversations(); } }} sx={{ background: 'none', border: 'none', color: 'primary.main', fontSize: '22px', cursor: 'pointer', padding: '4px 8px', minWidth: 'auto', textTransform: 'none' }}>←</Button>}
          <Box sx={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.primary', fontWeight: 700, fontSize: '16px', flexShrink: 0 }}>
            {activeChatName.split(' ').map(n => n[0]).join('').substring(0,2)}
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 700, fontSize: '16px', color: 'primary.main' }}>{activeChatName}</Typography>
            {chatRole && <Typography sx={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>{chatRole}</Typography>}
          </Box>
        </Box>

        {/* Messages area -- WhatsApp wallpaper style */}
        <Box sx={{ flex: 1, overflowY: 'auto', padding: '12px 16px', paddingBottom: embedded ? '12px' : '80px' }}>
          {chatMessages.length === 0 && (
            <Box sx={{ textAlign: 'center', marginTop: '40px' }}>
              <Typography component="span" sx={{ background: 'rgba(255,255,255,0.9)', display: 'inline-block', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', color: 'text.primary' }}>{t('messages.noMessages')}</Typography>
            </Box>
          )}
          {chatMessages.map((m, i) => {
            const isMine = m.from_id === personId;
            // Show date separator
            const showDate = i === 0 || new Date(m.created_at).toDateString() !== new Date(chatMessages[i-1].created_at).toDateString();
            return (
              <Fragment key={m.id}>
                {showDate && (
                  <Box sx={{ textAlign: 'center', margin: '12px 0' }}>
                    <Typography component="span" sx={{ background: 'rgba(255,255,255,0.9)', padding: '4px 12px', borderRadius: '6px', fontSize: '12px', color: 'text.primary', fontWeight: 600 }}>
                      {(() => {
                        const d = new Date(m.created_at);
                        const now = new Date();
                        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                        const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
                        if (msgDay.getTime() === today.getTime()) return 'Today';
                        const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
                        if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
                        return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                      })()}
                    </Typography>
                  </Box>
                )}
                <Box sx={{
                  display: 'flex',
                  justifyContent: isMine ? 'flex-end' : 'flex-start',
                  marginBottom: '4px',
                }}>
                  <Paper
                    elevation={0}
                    sx={{
                      maxWidth: '80%',
                      padding: '8px 12px',
                      borderRadius: isMine ? '8px 8px 2px 8px' : '8px 8px 8px 2px',
                      background: isMine ? '#F99440' : 'white',
                      color: 'text.primary',
                      boxShadow: '0 1px 1px rgba(0,0,0,0.1)',
                      position: 'relative',
                    }}
                    onContextMenu={(e) => { if (isMine) { e.preventDefault(); deleteMessage(m.id); } }}
                    onTouchStart={(e) => {
                      if (!isMine) return;
                      const timer = setTimeout(() => deleteMessage(m.id), 800);
                      e.target._longPress = timer;
                    }}
                    onTouchEnd={(e) => { if (e.target._longPress) clearTimeout(e.target._longPress); }}
                    onTouchMove={(e) => { if (e.target._longPress) clearTimeout(e.target._longPress); }}
                  >
                    {m.type === 'safety_alert' && (
                      <Typography sx={{ fontSize: '11px', fontWeight: 700, color: '#C45500', marginBottom: '4px' }}>⚠ SAFETY ALERT</Typography>
                    )}
                    {m.metadata && m.metadata.group && (
                      <Typography sx={{ fontSize: '11px', fontWeight: 700, color: 'primary.main', marginBottom: '4px' }}>📢 Group</Typography>
                    )}
                    {m.photo && (
                      <Box component="img" src={`/api/message-photos/${m.photo}`} alt="" sx={{ maxWidth: '100%', borderRadius: '6px', marginBottom: '4px', cursor: 'pointer' }} onClick={() => setLightboxPhoto(`/api/message-photos/${m.photo}`)} />
                    )}
                    {m.type === 'file' && m.metadata && (
                      <Box component="a" href={`/api/message-files/${m.metadata.filename}`} download={m.metadata.original_name || m.content} sx={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: isMine ? 'rgba(255,255,255,0.2)' : 'grey.50', borderRadius: '8px', textDecoration: 'none', color: 'text.primary', marginBottom: '4px' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontSize: '13px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.metadata.original_name || m.content}</Typography>
                          <Typography sx={{ fontSize: '11px', opacity: 0.7 }}>{m.metadata.size ? (m.metadata.size / 1024).toFixed(0) + ' KB' : 'File'}</Typography>
                        </Box>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      </Box>
                    )}
                    {m.type === 'voice' && m.audio_file ? (
                      <VoiceMessagePlayer src={`/api/message-audio/${m.audio_file}`} isMine={isMine} />
                    ) : (
                      <Typography sx={{ fontSize: '15px', lineHeight: '1.4', whiteSpace: 'pre-wrap', fontWeight: 600 }}>{typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}</Typography>
                    )}
                    <Box sx={{ fontSize: '11px', marginTop: '2px', color: 'text.primary', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                      {formatTime(m.created_at)}
                      {isMine && <Typography component="span" sx={{ fontSize: '14px', color: 'text.primary' }}>✓✓</Typography>}
                    </Box>
                  </Paper>
                </Box>
              </Fragment>
            );
          })}
          <Box ref={chatEndRef} />
        </Box>

        {/* Hidden photo/file inputs */}
        <input ref={chatPhotoRef} type="file" accept="image/*" capture="environment" style={{display: 'none'}} onChange={e => { if (e.target.files[0]) sendPhoto(e.target.files[0]); e.target.value = ''; }} />
        <input ref={chatGalleryRef} type="file" accept="image/*" style={{display: 'none'}} onChange={e => { if (e.target.files[0]) sendPhoto(e.target.files[0]); e.target.value = ''; }} />
        <input ref={chatFileRef} type="file" style={{display: 'none'}} onChange={e => { if (e.target.files[0]) sendFile(e.target.files[0]); e.target.value = ''; }} />

        {/* Message input -- WhatsApp style */}
        <Box ref={inputBarRef} sx={embedded
          ? { padding: '6px 8px', display: 'flex', gap: '6px', alignItems: 'flex-end', background: '#ECE5DD', flexShrink: 0 }
          : { position: 'fixed', left: 0, right: 0, bottom: keyboardOffset + 'px', padding: '6px 8px', display: 'flex', gap: '6px', alignItems: 'flex-end', background: '#ECE5DD', paddingBottom: Math.max(6, keyboardOffset > 0 ? 6 : 16) + 'px' }
        }>
          {isRecordingVoice ? (
            /* Voice recording mode */
            <Fragment>
              <IconButton onClick={cancelVoiceRecording} sx={{
                width: '40px', height: '40px', borderRadius: '50%', border: 'none',
                background: '#999', color: 'white', fontSize: '16px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                '&:hover': { background: '#888' },
              }}>✕</IconButton>
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', background: 'white', borderRadius: '24px', padding: '10px 16px' }}>
                <Box component="span" sx={{ width: '10px', height: '10px', borderRadius: '50%', background: '#E8922A', animation: 'pulse 1s infinite' }} />
                <Typography component="span" sx={{ fontSize: '15px', fontWeight: 600, color: 'text.primary' }}>
                  {Math.floor(voiceRecordingTime / 60)}:{String(voiceRecordingTime % 60).padStart(2, '0')}
                </Typography>
                <Typography component="span" sx={{ fontSize: '13px', color: 'text.primary', flex: 1 }}>Recording...</Typography>
              </Box>
              <IconButton onClick={stopVoiceRecording} sx={{
                width: '44px', height: '44px', borderRadius: '50%', border: 'none',
                background: 'var(--primary)', color: 'text.primary', fontSize: '20px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                '&:hover': { background: 'var(--primary)', opacity: 0.9 },
              }}>➤</IconButton>
            </Fragment>
          ) : (
            /* Normal input mode */
            <Fragment>
              <Box sx={{ position: 'relative', flexShrink: 0 }}>
                <IconButton
                  onClick={() => setShowChatPhotoChoice(!showChatPhotoChoice)}
                  disabled={sendingPhoto}
                  sx={{
                    width: '40px', height: '40px', borderRadius: '50%', border: 'none',
                    background: 'grey.500', color: 'white', fontSize: '18px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    '&:hover': { background: 'grey.600' },
                  }}
                ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></IconButton>
                {showChatPhotoChoice && (
                  <Fragment>
                    <Box onClick={() => setShowChatPhotoChoice(false)} sx={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9 }} />
                    <Paper sx={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px', background: 'white', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 10, overflow: 'hidden', minWidth: '140px' }}>
                      <Button onClick={() => { chatPhotoRef.current?.click(); setShowChatPhotoChoice(false); }} sx={{ display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #eee', textTransform: 'none', color: 'text.primary', borderRadius: 0, justifyContent: 'flex-start' }}>
                        <Typography component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Camera</Typography>
                      </Button>
                      <Button onClick={() => { chatGalleryRef.current?.click(); setShowChatPhotoChoice(false); }} sx={{ display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', textTransform: 'none', color: 'text.primary', borderRadius: 0, justifyContent: 'flex-start' }}>
                        <Typography component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>Gallery</Typography>
                      </Button>
                      <Button onClick={() => { chatFileRef.current?.click(); setShowChatPhotoChoice(false); }} sx={{ display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', borderTop: '1px solid #eee', textTransform: 'none', color: 'text.primary', borderRadius: 0, justifyContent: 'flex-start' }}>
                        <Typography component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>File</Typography>
                      </Button>
                    </Paper>
                  </Fragment>
                )}
              </Box>
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'flex-end', background: 'white', borderRadius: '24px', padding: '2px 4px' }}>
                <TextField
                  multiline
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  onFocus={() => setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 300)}
                  placeholder={t('messages.typeMessage')}
                  rows={1}
                  variant="standard"
                  slotProps={{ input: { disableUnderline: true } }}
                  sx={{
                    flex: 1,
                    '& .MuiInputBase-root': {
                      padding: '10px 14px',
                      fontSize: '16px',
                      fontFamily: 'inherit',
                    },
                    '& .MuiInputBase-input': {
                      resize: 'none',
                      maxHeight: '100px',
                      overflow: 'auto',
                    },
                  }}
                />
              </Box>
              {newMessage.trim() ? (
                <IconButton onClick={sendMessage} sx={{
                  width: '44px', height: '44px', borderRadius: '50%', border: 'none',
                  background: 'var(--primary)', color: 'text.primary', fontSize: '20px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  '&:hover': { background: 'var(--primary)', opacity: 0.9 },
                }}>➤</IconButton>
              ) : (
                <IconButton onClick={startVoiceRecording} sx={{
                  width: '44px', height: '44px', borderRadius: '50%', border: 'none',
                  background: 'var(--primary)', color: 'text.primary', fontSize: '20px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  '&:hover': { background: 'var(--primary)', opacity: 0.9 },
                }}><svg width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg></IconButton>
              )}
            </Fragment>
          )}
        </Box>
        {lightboxPhoto && (
          <Box onClick={() => setLightboxPhoto(null)} sx={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.9)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}>
            <IconButton onClick={() => setLightboxPhoto(null)} sx={{
              position: 'absolute', top: '16px', right: '16px',
              background: 'none', border: 'none', color: 'white', fontSize: '32px', cursor: 'pointer', zIndex: 10000,
            }}>✕</IconButton>
            <Box component="img" src={lightboxPhoto} alt="" sx={{ maxWidth: '95%', maxHeight: '90vh', objectFit: 'contain', borderRadius: '4px' }} onClick={e => e.stopPropagation()} />
          </Box>
        )}
        {/* Reusable Dialog for alerts and confirmations */}
        <Dialog open={Boolean(dialogConfig)} onClose={closeDialog}>
          <DialogContent>
            <DialogContentText sx={{ color: 'text.primary', fontSize: '15px' }}>
              {dialogConfig?.message}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            {dialogConfig?.showCancel && (
              <Button onClick={closeDialog} sx={{ textTransform: 'none' }}>Cancel</Button>
            )}
            <Button
              onClick={() => {
                if (dialogConfig?.onConfirm) dialogConfig.onConfirm();
                closeDialog();
              }}
              variant="contained"
              sx={{ textTransform: 'none' }}
              autoFocus
            >
              OK
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  // ---- CONTACTS LIST (new conversation) -- WhatsApp style ----
  if (showContacts) {
    // Separate supervisor from peers
    const supervisorContacts = contacts.filter(c => c.role_level > (user.role_level || 1));
    const peerContacts = contacts.filter(c => c.role_level <= (user.role_level || 1));

    return (
      <Box className="list-view">
        <Button className="back-btn" onClick={() => setShowContacts(false)} sx={{ textTransform: 'none' }}>← Back</Button>
        <Typography variant="h1" className="view-title">{t('messages.title')}</Typography>

        {contacts.length === 0 && <Typography sx={{ color: 'text.primary' }}>Loading contacts...</Typography>}

        {/* Supervisor section */}
        {supervisorContacts.length > 0 && (
          <Box sx={{ marginBottom: '16px' }}>
            <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'primary.main', padding: '8px 0', textTransform: 'uppercase', letterSpacing: '1px' }}>Supervisor</Typography>
            {supervisorContacts.map(c => {
              const initials = c.name.split(' ').map(n => n[0]).join('').substring(0,2);
              return (
                <Button key={c.id} sx={{
                  display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
                  padding: '12px 14px', background: 'white', border: 'none',
                  borderBottom: '1px solid #f0ece8', cursor: 'pointer',
                  borderLeft: '4px solid var(--primary)', textTransform: 'none', borderRadius: 0,
                  justifyContent: 'flex-start',
                }}
                  onClick={() => openChat(c.id, c.name)}>
                  <Box sx={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--charcoal)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'primary.main', fontWeight: 700, fontSize: '16px', flexShrink: 0 }}>
                    {initials}
                  </Box>
                  <Box>
                    <Typography sx={{ fontWeight: 700, fontSize: '16px', color: 'text.primary' }}>{c.name}</Typography>
                    <Typography sx={{ fontSize: '13px', color: 'primary.main', fontWeight: 600 }}>{c.role_title}</Typography>
                  </Box>
                </Button>
              );
            })}
          </Box>
        )}

        {/* Crew / Peers section */}
        {peerContacts.length > 0 && (
          <Box>
            <Typography sx={{ fontSize: '13px', fontWeight: 700, color: 'text.primary', padding: '8px 0', textTransform: 'uppercase', letterSpacing: '1px' }}>Crew</Typography>
            {peerContacts.map(c => {
              const initials = c.name.split(' ').map(n => n[0]).join('').substring(0,2);
              return (
                <Button key={c.id} sx={{
                  display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
                  padding: '10px 14px', background: 'white', border: 'none',
                  borderBottom: '1px solid #f0ece8', cursor: 'pointer', textTransform: 'none', borderRadius: 0,
                  justifyContent: 'flex-start',
                }}
                  onClick={() => openChat(c.id, c.name)}>
                  <Box sx={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.primary', fontWeight: 700, fontSize: '14px', flexShrink: 0 }}>
                    {initials}
                  </Box>
                  <Box>
                    <Typography sx={{ fontWeight: 600, fontSize: '15px', color: 'text.primary' }}>{c.name}</Typography>
                    <Typography sx={{ fontSize: '13px', color: 'text.primary' }}>{c.role_title}</Typography>
                  </Box>
                </Button>
              );
            })}
          </Box>
        )}
      </Box>
    );
  }

  // ---- CONVERSATION LIST (main view) -- WhatsApp style ----
  // Ensure supervisor is always in the list even without messages
  const supervisorContact = contacts.find(c => c.role_level > (user.role_level || 1));
  const allConversations = [...conversations];
  if (supervisorContact && !allConversations.find(c => c.contact_id === supervisorContact.id)) {
    allConversations.unshift({
      contact_id: supervisorContact.id,
      contact_name: supervisorContact.name,
      role_title: supervisorContact.role_title,
      role_level: supervisorContact.role_level,
      photo: supervisorContact.photo,
      last_message_at: null,
      unread_count: 0,
      last_message_preview: 'Tap to start a conversation',
      last_message_is_mine: false,
    });
  }

  // Sort: supervisor first, lead man second, then by last message time
  const sortedConversations = allConversations.sort((a, b) => {
    const aIsSupervisor = a.role_level > (user.role_level || 1);
    const bIsSupervisor = b.role_level > (user.role_level || 1);
    if (aIsSupervisor && !bIsSupervisor) return -1;
    if (!aIsSupervisor && bIsSupervisor) return 1;
    const aIsLead = a.is_lead_man || 0;
    const bIsLead = b.is_lead_man || 0;
    if (aIsLead && !bIsLead) return -1;
    if (!aIsLead && bIsLead) return 1;
    if (!a.last_message_at) return 1;
    if (!b.last_message_at) return -1;
    return new Date(b.last_message_at) - new Date(a.last_message_at);
  });

  const toggleLeadMan = async (contactId, currentValue) => {
    await fetch(`/api/people/${contactId}/lead-man`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_lead_man: !currentValue }),
    });
    loadConversations();
    loadContacts();
  };

  return (
    <Box className="list-view">
      {/* Header bar */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <Typography variant="h1" className="view-title" sx={{ margin: 0 }}>{t('messages.title')}</Typography>
        <Box sx={{ display: 'flex', gap: '8px' }}>
          {(user.role_level || 1) >= 2 && (
            <Button
              className="btn btn-secondary"
              sx={{ padding: '10px 16px', fontSize: '13px', borderRadius: '20px', fontWeight: 800, textTransform: 'none' }}
              onClick={() => {
                const msg = prompt('Message to all your team:');
                if (!msg || !msg.trim()) return;
                fetch('/api/v2/messages/group', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ from_id: personId, content: msg.trim() }),
                }).then(r => r.json()).then(res => {
                  if (res.success) { showAlert(`Sent to ${res.sent_to} team members`); loadConversations(); }
                  else showAlert(res.error || 'Failed');
                }).catch(() => showAlert('Failed to send'));
              }}
            >📢 All</Button>
          )}
          <Button
            className="btn btn-primary"
            sx={{ padding: '10px 20px', fontSize: '14px', borderRadius: '20px', textTransform: 'none' }}
            onClick={() => { loadContacts(); setShowContacts(true); }}
          >+ New</Button>
        </Box>
      </Box>

      {loading && <CircularProgress sx={{ display: 'block', margin: '20px auto' }} />}

      {!loading && sortedConversations.length === 0 && (
        <Box sx={{ textAlign: 'center', padding: '40px 0', color: 'text.primary' }}>
          <Typography sx={{ fontSize: '16px', marginBottom: '8px' }}>{t('messages.noMessages')}</Typography>
          <Typography sx={{ fontSize: '14px' }}>Tap "+ New" to start a conversation</Typography>
        </Box>
      )}

      {sortedConversations.map(c => {
        const isSupervisor = c.role_level > (user.role_level || 1);
        const initials = c.contact_name.split(' ').map(n => n[0]).join('').substring(0,2);
        return (
          <Button key={c.contact_id} sx={{
            display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
            padding: '12px 14px', marginBottom: '2px', background: 'white', border: 'none',
            borderBottom: '1px solid #f0ece8', cursor: 'pointer',
            borderLeft: isSupervisor ? '4px solid var(--primary)' : '4px solid transparent',
            textTransform: 'none', borderRadius: 0, justifyContent: 'flex-start',
          }}
            onClick={() => openChat(c.contact_id, c.contact_name)}>
            {/* Avatar */}
            <Box sx={{
              width: isSupervisor ? '52px' : '48px', height: isSupervisor ? '52px' : '48px',
              borderRadius: '50%', flexShrink: 0,
              background: isSupervisor ? 'var(--charcoal)' : 'var(--primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: isSupervisor ? 'primary.main' : 'text.primary', fontWeight: 700, fontSize: isSupervisor ? '18px' : '16px',
            }}>
              {initials}
            </Box>
            {/* Content */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Typography component="span" sx={{ fontWeight: c.unread_count > 0 ? 800 : 600, fontSize: isSupervisor ? '17px' : '16px', color: 'text.primary' }}>
                  {c.contact_name}{c.is_lead_man ? ' ⭐' : ''}
                </Typography>
                {(user.role_level || 1) >= 2 && !isSupervisor && c.role_level < (user.role_level || 1) && (
                  <IconButton
                    onClick={(e) => { e.stopPropagation(); toggleLeadMan(c.contact_id, c.is_lead_man); }}
                    sx={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '2px 6px', marginLeft: '4px', opacity: c.is_lead_man ? 1 : 0.3 }}
                    title={c.is_lead_man ? 'Remove Lead Man' : 'Set as Lead Man'}
                  >{c.is_lead_man ? '⭐' : '☆'}</IconButton>
                )}
                <Typography component="span" sx={{ fontSize: '12px', color: c.unread_count > 0 ? 'primary.main' : 'grey.500', flexShrink: 0, marginLeft: '8px' }}>{formatTime(c.last_message_at)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: '13px', color: isSupervisor ? 'primary.main' : 'grey.500', fontWeight: isSupervisor ? 600 : 400, marginBottom: '1px' }}>{c.role_title}</Typography>
                  <Typography sx={{ fontSize: '14px', color: c.unread_count > 0 ? 'text.primary' : 'grey.500', fontWeight: c.unread_count > 0 ? 500 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.last_message_is_mine ? 'You: ' : ''}{c.last_message_preview || 'No messages yet'}
                  </Typography>
                </Box>
                {c.unread_count > 0 && (
                  <Typography component="span" sx={{
                    background: '#25D366', color: 'white', borderRadius: '50%',
                    width: '22px', height: '22px', fontSize: '12px', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: '8px',
                  }}>{c.unread_count}</Typography>
                )}
              </Box>
            </Box>
          </Button>
        );
      })}
      {/* Reusable Dialog for alerts and confirmations */}
      <Dialog open={Boolean(dialogConfig)} onClose={closeDialog}>
        <DialogContent>
          <DialogContentText sx={{ color: 'text.primary', fontSize: '15px' }}>
            {dialogConfig?.message}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          {dialogConfig?.showCancel && (
            <Button onClick={closeDialog} sx={{ textTransform: 'none' }}>Cancel</Button>
          )}
          <Button
            onClick={() => {
              if (dialogConfig?.onConfirm) dialogConfig.onConfirm();
              closeDialog();
            }}
            variant="contained"
            sx={{ textTransform: 'none' }}
            autoFocus
          >
            OK
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
