import { useState, useEffect, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceMessagePlayer from '../components/VoiceMessagePlayer.jsx';

export default function MessagesView({ user, readOnly }) {
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

  // Load contacts on mount to know who the supervisor is
  useEffect(() => {
    if (personId) loadContacts();
  }, [personId]);

  // Load conversations on mount
  useEffect(() => {
    if (!personId) return;
    loadConversations();
  }, [personId]);

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
    } catch(e) { alert(t('messages.sendFailed')); }
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
        } catch(e) { alert('Failed to send voice message'); }
      };
      recorder.start(100);
      voiceRecorderRef.current = recorder;
      setIsRecordingVoice(true);
      setVoiceRecordingTime(0);
      voiceTimerRef.current = setInterval(() => setVoiceRecordingTime(t => t + 1), 1000);
    } catch(e) { alert('Microphone access denied'); }
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

  const deleteMessage = async (msgId) => {
    if (!confirm('Delete this message?')) return;
    try {
      const res = await fetch('/api/v2/messages/' + msgId, { method: 'DELETE' });
      if (res.ok) {
        setChatMessages(prev => prev.filter(m => m.id !== msgId));
      } else { alert('Failed to delete message'); }
    } catch (err) { alert('Delete error: ' + err.message); }
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
    } catch(e) { alert('Failed to send photo'); }
    setSendingPhoto(false);
  };

  // ---- CHAT VIEW ----
  if (activeChat) {
    // Find contact info for role display
    const chatContact = contacts.find(c => c.id === activeChat) || conversations.find(c => c.contact_id === activeChat);
    const chatRole = chatContact?.role_title || '';

    return (
      <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', background: '#ECE5DD', zIndex: 100}}>
        {/* Chat header — WhatsApp style */}
        <div style={{display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--charcoal)', flexShrink: 0}}>
          <button onClick={() => { setActiveChat(null); setKeyboardOffset(0); loadConversations(); }} style={{background: 'none', border: 'none', color: 'var(--primary)', fontSize: '22px', cursor: 'pointer', padding: '4px 8px'}}>←</button>
          <div style={{width: '40px', height: '40px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--charcoal)', fontWeight: 700, fontSize: '16px', flexShrink: 0}}>
            {activeChatName.split(' ').map(n => n[0]).join('').substring(0,2)}
          </div>
          <div style={{flex: 1}}>
            <div style={{fontWeight: 700, fontSize: '16px', color: 'var(--primary)'}}>{activeChatName}</div>
            {chatRole && <div style={{fontSize: '12px', color: 'rgba(255,255,255,0.7)'}}>{chatRole}</div>}
          </div>
        </div>

        {/* Messages area — WhatsApp wallpaper style */}
        <div style={{flex: 1, overflowY: 'auto', padding: '12px 16px', paddingBottom: '80px'}}>
          {chatMessages.length === 0 && (
            <div style={{textAlign: 'center', marginTop: '40px'}}>
              <div style={{background: 'rgba(255,255,255,0.9)', display: 'inline-block', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', color: 'var(--charcoal)'}}>{t('messages.noMessages')}</div>
            </div>
          )}
          {chatMessages.map((m, i) => {
            const isMine = m.from_id === personId;
            // Show date separator
            const showDate = i === 0 || new Date(m.created_at).toDateString() !== new Date(chatMessages[i-1].created_at).toDateString();
            return (
              <Fragment key={m.id}>
                {showDate && (
                  <div style={{textAlign: 'center', margin: '12px 0'}}>
                    <span style={{background: 'rgba(255,255,255,0.9)', padding: '4px 12px', borderRadius: '6px', fontSize: '12px', color: 'var(--charcoal)', fontWeight: 600}}>
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
                    </span>
                  </div>
                )}
                <div style={{
                  display: 'flex',
                  justifyContent: isMine ? 'flex-end' : 'flex-start',
                  marginBottom: '4px',
                }}>
                  <div style={{
                    maxWidth: '80%',
                    padding: '8px 12px',
                    borderRadius: isMine ? '8px 8px 2px 8px' : '8px 8px 8px 2px',
                    background: isMine ? '#F99440' : 'white',
                    color: 'var(--charcoal)',
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
                      <div style={{fontSize: '11px', fontWeight: 700, color: '#C45500', marginBottom: '4px'}}>⚠ SAFETY ALERT</div>
                    )}
                    {m.metadata && m.metadata.group && (
                      <div style={{fontSize: '11px', fontWeight: 700, color: 'var(--primary)', marginBottom: '4px'}}>📢 Group</div>
                    )}
                    {m.photo && (
                      <img src={`/api/message-photos/${m.photo}`} alt="" style={{maxWidth: '100%', borderRadius: '6px', marginBottom: '4px', cursor: 'pointer'}} onClick={() => setLightboxPhoto(`/api/message-photos/${m.photo}`)} />
                    )}
                    {m.type === 'file' && m.metadata && (
                      <a href={`/api/message-files/${m.metadata.filename}`} download={m.metadata.original_name || m.content} style={{display:'flex', alignItems:'center', gap:'8px', padding:'8px 12px', background: isMine ? 'rgba(255,255,255,0.2)' : 'var(--gray-50)', borderRadius:'8px', textDecoration:'none', color:'var(--charcoal)', marginBottom:'4px'}}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <div style={{flex:1, minWidth:0}}>
                          <div style={{fontSize:'13px', fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{m.metadata.original_name || m.content}</div>
                          <div style={{fontSize:'11px', opacity:0.7}}>{m.metadata.size ? (m.metadata.size / 1024).toFixed(0) + ' KB' : 'File'}</div>
                        </div>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      </a>
                    )}
                    {m.type === 'voice' && m.audio_file ? (
                      <VoiceMessagePlayer src={`/api/message-audio/${m.audio_file}`} isMine={isMine} />
                    ) : (
                      <div style={{fontSize: '15px', lineHeight: '1.4', whiteSpace: 'pre-wrap', fontWeight: 600}}>{typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}</div>
                    )}
                    <div style={{fontSize: '11px', marginTop: '2px', color: 'var(--charcoal)', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px'}}>
                      {formatTime(m.created_at)}
                      {isMine && <span style={{fontSize: '14px', color: 'var(--charcoal)'}}>✓✓</span>}
                    </div>
                  </div>
                </div>
              </Fragment>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        {/* Hidden photo input */}
        <input ref={chatPhotoRef} type="file" accept="image/*" capture="environment" style={{display: 'none'}} onChange={e => { if (e.target.files[0]) sendPhoto(e.target.files[0]); e.target.value = ''; }} />
        <input ref={chatGalleryRef} type="file" accept="image/*" style={{display: 'none'}} onChange={e => { if (e.target.files[0]) sendPhoto(e.target.files[0]); e.target.value = ''; }} />

        {/* Message input — WhatsApp style */}
        <div ref={inputBarRef} style={{
          position: 'fixed', left: 0, right: 0,
          bottom: keyboardOffset + 'px',
          padding: '6px 8px', display: 'flex', gap: '6px', alignItems: 'flex-end',
          background: '#ECE5DD',
          paddingBottom: Math.max(6, keyboardOffset > 0 ? 6 : 16) + 'px',
        }}>
          {isRecordingVoice ? (
            /* Voice recording mode */
            <Fragment>
              <button onClick={cancelVoiceRecording} style={{
                width: '40px', height: '40px', borderRadius: '50%', border: 'none',
                background: '#999', color: 'white', fontSize: '16px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>✕</button>
              <div style={{flex: 1, display: 'flex', alignItems: 'center', gap: '8px', background: 'white', borderRadius: '24px', padding: '10px 16px'}}>
                <span style={{width: '10px', height: '10px', borderRadius: '50%', background: '#E8922A', animation: 'pulse 1s infinite'}} />
                <span style={{fontSize: '15px', fontWeight: 600, color: 'var(--charcoal)'}}>
                  {Math.floor(voiceRecordingTime / 60)}:{String(voiceRecordingTime % 60).padStart(2, '0')}
                </span>
                <span style={{fontSize: '13px', color: 'var(--charcoal)', flex: 1}}>Recording...</span>
              </div>
              <button onClick={stopVoiceRecording} style={{
                width: '44px', height: '44px', borderRadius: '50%', border: 'none',
                background: 'var(--primary)', color: 'var(--charcoal)', fontSize: '20px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>➤</button>
            </Fragment>
          ) : (
            /* Normal input mode */
            <Fragment>
              <div style={{position: 'relative', flexShrink: 0}}>
                <button
                  onClick={() => setShowChatPhotoChoice(!showChatPhotoChoice)}
                  disabled={sendingPhoto}
                  style={{
                    width: '40px', height: '40px', borderRadius: '50%', border: 'none',
                    background: 'var(--gray-500)', color: 'white', fontSize: '18px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
                {showChatPhotoChoice && (
                  <Fragment>
                    <div onClick={() => setShowChatPhotoChoice(false)} style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9}} />
                    <div style={{position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px', background: 'white', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 10, overflow: 'hidden', minWidth: '140px'}}>
                      <button onClick={() => { chatPhotoRef.current?.click(); setShowChatPhotoChoice(false); }} style={{display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #eee'}}>
                        <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Camera</span>
                      </button>
                      <button onClick={() => { chatGalleryRef.current?.click(); setShowChatPhotoChoice(false); }} style={{display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left'}}>
                        <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>Gallery</span>
                      </button>
                      <button onClick={() => { chatFileRef.current?.click(); setShowChatPhotoChoice(false); }} style={{display: 'block', width: '100%', padding: '12px 16px', border: 'none', background: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', borderTop: '1px solid #eee'}}>
                        <span style={{display:'inline-flex',alignItems:'center',gap:'8px'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>File</span>
                      </button>
                    </div>
                  </Fragment>
                )}
              </div>
              <div style={{flex: 1, display: 'flex', alignItems: 'flex-end', background: 'white', borderRadius: '24px', padding: '2px 4px'}}>
                <textarea
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  onFocus={() => setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 300)}
                  placeholder={t('messages.typeMessage')}
                  rows={1}
                  style={{
                    flex: 1, padding: '10px 14px', border: 'none', borderRadius: '24px',
                    fontSize: '16px', resize: 'none', fontFamily: 'inherit', outline: 'none',
                    maxHeight: '100px', background: 'transparent',
                  }}
                />
              </div>
              {newMessage.trim() ? (
                <button onClick={sendMessage} style={{
                  width: '44px', height: '44px', borderRadius: '50%', border: 'none',
                  background: 'var(--primary)', color: 'var(--charcoal)', fontSize: '20px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>➤</button>
              ) : (
                <button onClick={startVoiceRecording} style={{
                  width: '44px', height: '44px', borderRadius: '50%', border: 'none',
                  background: 'var(--primary)', color: 'var(--charcoal)', fontSize: '20px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}><svg width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/><line x1="8" y1="23" x2="16" y2="23" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg></button>
              )}
            </Fragment>
          )}
        </div>
        {lightboxPhoto && (
          <div onClick={() => setLightboxPhoto(null)} style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.9)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}>
            <button onClick={() => setLightboxPhoto(null)} style={{
              position: 'absolute', top: '16px', right: '16px',
              background: 'none', border: 'none', color: 'white', fontSize: '32px', cursor: 'pointer', zIndex: 10000,
            }}>✕</button>
            <img src={lightboxPhoto} alt="" style={{maxWidth: '95%', maxHeight: '90vh', objectFit: 'contain', borderRadius: '4px'}} onClick={e => e.stopPropagation()} />
          </div>
        )}
      </div>
    );
  }

  // ---- CONTACTS LIST (new conversation) — WhatsApp style ----
  if (showContacts) {
    // Separate supervisor from peers
    const supervisorContacts = contacts.filter(c => c.role_level > (user.role_level || 1));
    const peerContacts = contacts.filter(c => c.role_level <= (user.role_level || 1));

    return (
      <div className="list-view">
        <button className="back-btn" onClick={() => setShowContacts(false)}>← Back</button>
        <h1 className="view-title">{t('messages.title')}</h1>

        {contacts.length === 0 && <p style={{color: 'var(--charcoal)'}}>Loading contacts...</p>}

        {/* Supervisor section */}
        {supervisorContacts.length > 0 && (
          <div style={{marginBottom: '16px'}}>
            <div style={{fontSize: '13px', fontWeight: 700, color: 'var(--primary)', padding: '8px 0', textTransform: 'uppercase', letterSpacing: '1px'}}>Supervisor</div>
            {supervisorContacts.map(c => {
              const initials = c.name.split(' ').map(n => n[0]).join('').substring(0,2);
              return (
                <button key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
                  padding: '12px 14px', background: 'white', border: 'none',
                  borderBottom: '1px solid #f0ece8', cursor: 'pointer',
                  borderLeft: '4px solid var(--primary)',
                }}
                  onClick={() => openChat(c.id, c.name)}>
                  <div style={{width: '48px', height: '48px', borderRadius: '50%', background: 'var(--charcoal)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', fontWeight: 700, fontSize: '16px', flexShrink: 0}}>
                    {initials}
                  </div>
                  <div>
                    <div style={{fontWeight: 700, fontSize: '16px', color: 'var(--charcoal)'}}>{c.name}</div>
                    <div style={{fontSize: '13px', color: 'var(--primary)', fontWeight: 600}}>{c.role_title}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Crew / Peers section */}
        {peerContacts.length > 0 && (
          <div>
            <div style={{fontSize: '13px', fontWeight: 700, color: 'var(--charcoal)', padding: '8px 0', textTransform: 'uppercase', letterSpacing: '1px'}}>Crew</div>
            {peerContacts.map(c => {
              const initials = c.name.split(' ').map(n => n[0]).join('').substring(0,2);
              return (
                <button key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
                  padding: '10px 14px', background: 'white', border: 'none',
                  borderBottom: '1px solid #f0ece8', cursor: 'pointer',
                }}
                  onClick={() => openChat(c.id, c.name)}>
                  <div style={{width: '40px', height: '40px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--charcoal)', fontWeight: 700, fontSize: '14px', flexShrink: 0}}>
                    {initials}
                  </div>
                  <div>
                    <div style={{fontWeight: 600, fontSize: '15px', color: 'var(--charcoal)'}}>{c.name}</div>
                    <div style={{fontSize: '13px', color: 'var(--charcoal)'}}>{c.role_title}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---- CONVERSATION LIST (main view) — WhatsApp style ----
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
    <div className="list-view">
      {/* Header bar */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px'}}>
        <h1 className="view-title" style={{margin: 0}}>{t('messages.title')}</h1>
        <div style={{display: 'flex', gap: '8px'}}>
          {(user.role_level || 1) >= 2 && (
            <button
              className="btn btn-secondary"
              style={{padding: '10px 16px', fontSize: '13px', borderRadius: '20px', fontWeight: 800}}
              onClick={() => {
                const msg = prompt('Message to all your team:');
                if (!msg || !msg.trim()) return;
                fetch('/api/v2/messages/group', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ from_id: personId, content: msg.trim() }),
                }).then(r => r.json()).then(res => {
                  if (res.success) { alert(`Sent to ${res.sent_to} team members`); loadConversations(); }
                  else alert(res.error || 'Failed');
                }).catch(() => alert('Failed to send'));
              }}
            >📢 All</button>
          )}
          <button
            className="btn btn-primary"
            style={{padding: '10px 20px', fontSize: '14px', borderRadius: '20px'}}
            onClick={() => { loadContacts(); setShowContacts(true); }}
          >+ New</button>
        </div>
      </div>

      {loading && <p style={{color: 'var(--charcoal)'}}>{t('common.loading')}</p>}

      {!loading && sortedConversations.length === 0 && (
        <div style={{textAlign: 'center', padding: '40px 0', color: 'var(--charcoal)'}}>
          <p style={{fontSize: '16px', marginBottom: '8px'}}>{t('messages.noMessages')}</p>
          <p style={{fontSize: '14px'}}>Tap "+ New" to start a conversation</p>
        </div>
      )}

      {sortedConversations.map(c => {
        const isSupervisor = c.role_level > (user.role_level || 1);
        const initials = c.contact_name.split(' ').map(n => n[0]).join('').substring(0,2);
        return (
          <button key={c.contact_id} style={{
            display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
            padding: '12px 14px', marginBottom: '2px', background: 'white', border: 'none',
            borderBottom: '1px solid #f0ece8', cursor: 'pointer',
            borderLeft: isSupervisor ? '4px solid var(--primary)' : '4px solid transparent',
          }}
            onClick={() => openChat(c.contact_id, c.contact_name)}>
            {/* Avatar */}
            <div style={{
              width: isSupervisor ? '52px' : '48px', height: isSupervisor ? '52px' : '48px',
              borderRadius: '50%', flexShrink: 0,
              background: isSupervisor ? 'var(--charcoal)' : 'var(--primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: isSupervisor ? 'var(--primary)' : 'var(--charcoal)', fontWeight: 700, fontSize: isSupervisor ? '18px' : '16px',
            }}>
              {initials}
            </div>
            {/* Content */}
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'}}>
                <span style={{fontWeight: c.unread_count > 0 ? 800 : 600, fontSize: isSupervisor ? '17px' : '16px', color: 'var(--charcoal)'}}>
                  {c.contact_name}{c.is_lead_man ? ' ⭐' : ''}
                </span>
                {(user.role_level || 1) >= 2 && !isSupervisor && c.role_level < (user.role_level || 1) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleLeadMan(c.contact_id, c.is_lead_man); }}
                    style={{background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '2px 6px', marginLeft: '4px', opacity: c.is_lead_man ? 1 : 0.3}}
                    title={c.is_lead_man ? 'Remove Lead Man' : 'Set as Lead Man'}
                  >{c.is_lead_man ? '⭐' : '☆'}</button>
                )}
                <span style={{fontSize: '12px', color: c.unread_count > 0 ? 'var(--primary)' : 'var(--gray-500)', flexShrink: 0, marginLeft: '8px'}}>{formatTime(c.last_message_at)}</span>
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px'}}>
                <div style={{minWidth: 0, flex: 1}}>
                  <div style={{fontSize: '13px', color: isSupervisor ? 'var(--primary)' : 'var(--gray-500)', fontWeight: isSupervisor ? 600 : 400, marginBottom: '1px'}}>{c.role_title}</div>
                  <div style={{fontSize: '14px', color: c.unread_count > 0 ? 'var(--charcoal)' : 'var(--gray-500)', fontWeight: c.unread_count > 0 ? 500 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                    {c.last_message_is_mine ? 'You: ' : ''}{c.last_message_preview || 'No messages yet'}
                  </div>
                </div>
                {c.unread_count > 0 && (
                  <span style={{
                    background: '#25D366', color: 'white', borderRadius: '50%',
                    width: '22px', height: '22px', fontSize: '12px', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: '8px',
                  }}>{c.unread_count}</span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
