import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography, IconButton, TextField, Button, Paper, Fab, Badge, Stack, Chip, Link } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import NotesIcon from '@mui/icons-material/Notes';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AttachFileIcon from '@mui/icons-material/AttachFile';

// Map a file_url (relative path returned by /api/support/upload) to a
// renderable URL + an "is this an image?" boolean for inline preview.
const IMAGE_RX = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
function resolveAttachment(file_url) {
  if (!file_url) return null;
  // Multer storage uses the filename; the GET /files/:filename endpoint
  // serves them back. Anything else (full URLs, etc.) is rendered as-is.
  const isAbs = /^https?:\/\//i.test(file_url);
  const href = isAbs ? file_url : `/api/support/files/${encodeURIComponent(file_url)}`;
  const filename = file_url.split('/').pop() || file_url;
  return { href, filename, isImage: IMAGE_RX.test(file_url) };
}

// Stoplight color band for AI self-rated confidence.
function confidenceColor(c) {
  if (c == null) return 'default';
  if (c >= 0.8) return 'success';
  if (c >= 0.5) return 'warning';
  return 'error';
}

/**
 * SupportChat — Floating chat bubble
 *
 * FOR CUSTOMERS: Send messages to Sparks support, saved to database.
 *   Also surfaces a CSAT 1-5 emoji rating once the conversation is resolved.
 * FOR SPARKS ADMIN: Shows active support conversation when viewing a customer's ticket.
 *   AI generates a suggested reply attached to each customer message when operators
 *   are online; the operator can Accept/Edit/Dismiss before sending.
 *   Also surfaces an internal-notes textarea (never visible to the customer).
 *
 * The bubble persists across all views — it follows you everywhere.
 */
export default function SupportChat({ user, simulatingCompany, externalOpen, onExternalOpenChange, activeConversation, onConversationChange }) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (val) => { setInternalOpen(val); if (onExternalOpenChange) onExternalOpenChange(val); };
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [conversationStatus, setConversationStatus] = useState(null);
  const [customerRating, setCustomerRating] = useState(null);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiSuggestionMessageId, setAiSuggestionMessageId] = useState(null);
  const [aiConfidence, setAiConfidence] = useState(null);
  const [internalNotes, setInternalNotes] = useState('');
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [notesSaveStatus, setNotesSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const pollRef = useRef(null);
  const pingPollRef = useRef(null);
  const audioCtxRef = useRef(null);
  const lastUnreadRef = useRef(0);
  const notesSaveTimerRef = useRef(null);
  // Tracks which conversation's notes we've already seeded from the server.
  // Prevents stale poll responses from clobbering operator-edited text after
  // the textarea has been touched in this session.
  const notesSeededForConvId = useRef(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const isSparksUser = !!user?.sparks_role;

  // Lazy-init AudioContext on first user gesture (browsers require this).
  const playPingTone = () => {
    try {
      if (typeof window === 'undefined') return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(880, t0);
      o.frequency.exponentialRampToValueAtTime(660, t0 + 0.18);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.25);
    } catch {
      // sound is best-effort
    }
  };

  const warmAudioCtx = () => {
    try {
      if (typeof window === 'undefined') return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    } catch {
      // best-effort
    }
  };

  useEffect(() => () => {
    try {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    } catch {
      // best-effort
    }
  }, []);

  // Sparks-side: poll unread badge every 15s with chime on increase.
  useEffect(() => {
    if (!isSparksUser) return undefined;
    let mounted = true;
    let firstPoll = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/support/unread-count');
        if (!r.ok || !mounted) return;
        const data = await r.json();
        const next = Number(data.unread || 0);
        if (next > lastUnreadRef.current && !firstPoll) {
          playPingTone();
        }
        lastUnreadRef.current = next;
        firstPoll = false;
        setUnreadCount(next);
      } catch {
        // network blips — next tick retries
      }
    };
    tick();
    pingPollRef.current = setInterval(tick, 15000);
    return () => {
      mounted = false;
      if (pingPollRef.current) clearInterval(pingPollRef.current);
    };
  }, [isSparksUser]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current.focus(), 100);
    }
  }, [open]);

  // Reset per-conversation state when the active conversation changes.
  useEffect(() => {
    setAiSuggestion(null);
    setAiSuggestionMessageId(null);
    setAiConfidence(null);
    setInternalNotes('');
    setNotesExpanded(false);
    setConversationStatus(null);
    setCustomerRating(null);
    notesSeededForConvId.current = null;
  }, [activeConversation]);

  // Load conversation on open
  useEffect(() => {
    if (!open) return;
    if (isSparksUser && activeConversation) {
      loadSparksConversation(activeConversation);
    } else if (!isSparksUser) {
      loadCustomerConversation();
    }
  }, [open, activeConversation]);

  // Poll for new messages every 5 seconds when open
  useEffect(() => {
    if (!open || !conversationId) return;
    pollRef.current = setInterval(() => {
      if (isSparksUser && conversationId) {
        loadSparksConversation(conversationId);
      } else if (!isSparksUser) {
        loadCustomerConversation();
      }
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open, conversationId]);

  const loadCustomerConversation = async () => {
    try {
      const r = await fetch('/api/support/my-conversation');
      if (!r.ok) return;
      const data = await r.json();
      if (data.conversation_id) setConversationId(data.conversation_id);
      if (data.status !== undefined) setConversationStatus(data.status);
      if (data.customer_rating !== undefined) setCustomerRating(data.customer_rating);
      if (data.messages && data.messages.length > 0) {
        setMessages(data.messages.map(m => ({
          id: m.id,
          role: m.sender_type === 'customer' ? 'user' : 'support',
          text: m.content,
          fileUrl: m.file_url,
          time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        })));
      } else if (messages.length === 0) {
        setMessages([{
          id: 'welcome',
          role: 'support',
          text: t('support.chat.welcome'),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }]);
      }
    } catch {}
  };

  const loadSparksConversation = async (convId) => {
    try {
      const r = await fetch(`/api/support/conversation/${convId}`);
      if (!r.ok) return;
      const data = await r.json();
      setConversationId(convId);
      if (data.conversation) {
        setConversationStatus(data.conversation.status);
        // Seed notes from server only ONCE per conversation. After the
        // operator has interacted with the textarea, polling can never
        // overwrite their local edits (even if they deliberately cleared).
        if (notesSeededForConvId.current !== convId) {
          setInternalNotes(data.conversation.internal_notes || '');
          notesSeededForConvId.current = convId;
        }
      }
      if (data.messages) {
        setMessages(data.messages.map(m => ({
          id: m.id,
          role: m.sender_type === 'customer' ? 'user' : 'support',
          text: m.content,
          name: m.person_name,
          fileUrl: m.file_url,
          time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        })));
        // Find the most recent customer message that still carries an AI draft.
        // Iterate backwards — only the latest unanswered suggestion is relevant.
        let foundSuggestion = null;
        let foundMessageId = null;
        let foundConfidence = null;
        for (let i = data.messages.length - 1; i >= 0; i--) {
          const m = data.messages[i];
          if (m.sender_type === 'customer' && m.ai_suggested_reply) {
            foundSuggestion = m.ai_suggested_reply;
            foundMessageId = m.id;
            foundConfidence = (typeof m.ai_confidence === 'number') ? m.ai_confidence : null;
            break;
          }
        }
        setAiSuggestion(foundSuggestion);
        setAiSuggestionMessageId(foundMessageId);
        setAiConfidence(foundConfidence);
      }
    } catch {}
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (isSparksUser && !conversationId) {
      console.warn('SupportChat: Sparks user has no active conversation; refusing send');
      return;
    }

    const newMsg = {
      id: 'temp_' + Date.now(),
      role: 'user',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, newMsg]);
    setInput('');
    setSending(true);

    const current_route = (typeof window !== 'undefined')
      ? (window.location.pathname + window.location.hash + window.location.search).slice(0, 500)
      : '';

    try {
      if (isSparksUser && conversationId) {
        const r = await fetch(`/api/support/reply/${conversationId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text }),
        });
        if (!r.ok) throw new Error('Failed to send');
        // Manually sending wipes any pending AI suggestion (operator chose their own words).
        setAiSuggestion(null);
        setAiSuggestionMessageId(null);
        setAiConfidence(null);
      } else {
        const r = await fetch('/api/support/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: text,
            app_origin: 'voicereport',
            current_route,
          }),
        });
        if (!r.ok) throw new Error('Failed to send');
        const data = await r.json();
        if (data.conversation_id) setConversationId(data.conversation_id);
      }
    } catch (err) {
      console.error('Support send error:', err);
      setMessages(prev => [...prev, {
        id: 'err_' + Date.now(),
        role: 'support',
        text: t('support.chat.sendFailed'),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    }

    setSending(false);
  };

  // Operator accepts the AI draft as-is (no edits) and sends it.
  const acceptAiSuggestion = async () => {
    if (!aiSuggestionMessageId || sending) return;
    setSending(true);
    try {
      const r = await fetch(`/api/support/accept-suggestion/${aiSuggestionMessageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error('Failed to accept');
      setAiSuggestion(null);
      setAiSuggestionMessageId(null);
      setAiConfidence(null);
      await loadSparksConversation(conversationId);
    } catch (err) {
      console.error('Accept suggestion error:', err);
    }
    setSending(false);
  };

  // Operator wants to edit the draft — pop it into the input and clear the
  // banner. The operator then sends via the normal sendMessage() path.
  // We ALSO clear the DB-side suggestion so the next 5s poll doesn't
  // resurrect the banner while the operator is mid-edit.
  const editAiSuggestion = async () => {
    if (!aiSuggestion) return;
    const idToDismiss = aiSuggestionMessageId;
    setInput(aiSuggestion);
    setAiSuggestion(null);
    setAiSuggestionMessageId(null);
    setAiConfidence(null);
    if (inputRef.current) inputRef.current.focus();
    try {
      await fetch(`/api/support/dismiss-suggestion/${idToDismiss}`, { method: 'POST' });
    } catch (err) {
      console.error('Edit (DB clear) error:', err);
    }
  };

  // Operator dismisses the draft without sending. Backend clears the column.
  const dismissAiSuggestion = async () => {
    if (!aiSuggestionMessageId) return;
    const idToDismiss = aiSuggestionMessageId;
    // Optimistic UI — clear local state immediately.
    setAiSuggestion(null);
    setAiSuggestionMessageId(null);
    setAiConfidence(null);
    try {
      await fetch(`/api/support/dismiss-suggestion/${idToDismiss}`, { method: 'POST' });
    } catch (err) {
      console.error('Dismiss suggestion error:', err);
    }
  };

  // Customer rates a resolved conversation. One-shot — backend rejects re-rates.
  const rateConversation = async (rating) => {
    if (!conversationId) return;
    try {
      const r = await fetch(`/api/support/rate/${conversationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      });
      if (r.ok) setCustomerRating(rating);
    } catch (err) {
      console.error('Rate error:', err);
    }
  };

  // Auto-save internal notes 800ms after the operator stops typing.
  const onInternalNotesChange = (value) => {
    setInternalNotes(value);
    if (!conversationId) return;
    setNotesSaveStatus('saving');
    if (notesSaveTimerRef.current) clearTimeout(notesSaveTimerRef.current);
    notesSaveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/support/notes/${conversationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: value }),
        });
        setNotesSaveStatus('saved');
        setTimeout(() => setNotesSaveStatus('idle'), 1500);
      } catch (err) {
        console.error('Notes save error:', err);
        setNotesSaveStatus('idle');
      }
    }, 800);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const headerTitle = isSparksUser ? t('support.chat.titleOperator') : t('support.chat.title');
  const headerSub = isSparksUser && activeConversation ? (messages[0]?.name || '') : (simulatingCompany?.name || user?.company_name || '');

  // CSAT prompt is shown to the customer once the conversation is resolved
  // and not yet rated. After rating, a thank-you takes its place.
  const showCsatPrompt = !isSparksUser && conversationStatus === 'resolved' && customerRating == null;
  const showCsatThanks = !isSparksUser && conversationStatus === 'resolved' && customerRating != null;
  const csatEmojis = [
    { v: 1, glyph: '😞', label: t('support.csat.veryDissatisfied') },
    { v: 2, glyph: '🙁', label: t('support.csat.dissatisfied') },
    { v: 3, glyph: '😐', label: t('support.csat.neutral') },
    { v: 4, glyph: '🙂', label: t('support.csat.satisfied') },
    { v: 5, glyph: '😀', label: t('support.csat.verySatisfied') },
  ];

  return (
    <>
      {/* Floating Bubble */}
      {!open && (
        <Badge
          badgeContent={isSparksUser ? unreadCount : 0}
          color="error"
          overlap="circular"
          sx={{
            position: 'fixed',
            bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
            right: 'calc(24px + env(safe-area-inset-right, 0px))',
            zIndex: 900,
            '& .MuiBadge-badge': { fontWeight: 800, minWidth: 22, height: 22 },
          }}
        >
        <Fab
          onClick={() => { warmAudioCtx(); setOpen(true); }}
          onMouseDown={warmAudioCtx}
          onTouchStart={warmAudioCtx}
          title={t('support.chat.titleOperator')}
          sx={{
            width: 56, height: 56,
            bgcolor: 'secondary.main', border: '3px solid', borderColor: 'primary.main',
            color: 'primary.main', fontSize: 24,
            '&:hover': { bgcolor: 'secondary.dark' },
          }}>
          💬
        </Fab>
        </Badge>
      )}

      {/* Chat Panel */}
      {open && (
        <Paper elevation={8} sx={{
          position: 'fixed',
          bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
          right: 'calc(24px + env(safe-area-inset-right, 0px))',
          zIndex: 1000,
          width: 360, maxWidth: 'calc(100vw - 48px)',
          height: 560, maxHeight: 'calc(100vh - 120px)',
          borderRadius: 4, border: '2px solid', borderColor: 'secondary.main',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Header */}
          <Box sx={{
            px: 2, py: 1.75, bgcolor: 'secondary.main',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <Box>
              <Typography sx={{ color: 'primary.main', fontWeight: 700, fontSize: 14 }}>
                {headerTitle}
              </Typography>
              {headerSub && (
                <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, mt: 0.25 }}>
                  {headerSub}
                </Typography>
              )}
            </Box>
            <IconButton onClick={() => { setOpen(false); if (onConversationChange) onConversationChange(null); }} sx={{ color: 'white' }}>
              <CloseIcon />
            </IconButton>
          </Box>

          {/* Messages */}
          <Box sx={{
            flex: 1, overflowY: 'auto', p: 1.5,
            display: 'flex', flexDirection: 'column', gap: 1,
            bgcolor: 'grey.100',
          }}>
            {messages.map(msg => {
              const att = resolveAttachment(msg.fileUrl);
              return (
              <Box key={msg.id} sx={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
              }}>
                {msg.name && msg.role === 'user' && (
                  <Typography sx={{ fontSize: 10, color: 'text.secondary', px: 0.5, mb: 0.25 }}>{msg.name}</Typography>
                )}
                <Paper elevation={msg.role === 'support' ? 1 : 0} sx={{
                  px: 1.75, py: 1.25, borderRadius: 3.5,
                  bgcolor: msg.role === 'user' ? 'secondary.main' : 'background.paper',
                  color: msg.role === 'user' ? 'primary.main' : 'text.primary',
                  fontSize: 13, lineHeight: 1.4,
                  border: msg.role === 'support' ? '1px solid' : 'none',
                  borderColor: 'divider',
                }}>
                  {msg.text && <Box sx={{ whiteSpace: 'pre-wrap' }}>{msg.text}</Box>}
                  {att && att.isImage && (
                    <Box sx={{ mt: msg.text ? 0.75 : 0 }}>
                      <Link href={att.href} target="_blank" rel="noopener noreferrer">
                        <Box
                          component="img"
                          src={att.href}
                          alt={att.filename}
                          sx={{
                            display: 'block',
                            maxWidth: '100%', maxHeight: 200,
                            borderRadius: 2, border: '1px solid',
                            borderColor: 'divider',
                          }}
                        />
                      </Link>
                    </Box>
                  )}
                  {att && !att.isImage && (
                    <Box sx={{ mt: msg.text ? 0.75 : 0 }}>
                      <Chip
                        icon={<AttachFileIcon />}
                        label={att.filename}
                        component={Link}
                        href={att.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        clickable
                        size="small"
                        sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                        title={t('support.attachment.downloadFile')}
                      />
                    </Box>
                  )}
                </Paper>
                <Typography sx={{
                  fontSize: 10, color: 'text.secondary', mt: 0.375,
                  textAlign: msg.role === 'user' ? 'right' : 'left',
                  px: 0.5,
                }}>
                  {msg.time}
                </Typography>
              </Box>
              );
            })}

            {/* CSAT prompt (customer only, resolved conversations not yet rated) */}
            {showCsatPrompt && (
              <Box sx={{
                mt: 1, p: 1.5,
                bgcolor: 'success.light', color: 'success.contrastText',
                borderRadius: 2, textAlign: 'center',
              }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1 }}>
                  {t('support.csat.prompt')}
                </Typography>
                <Stack direction="row" spacing={0.5} justifyContent="center">
                  {csatEmojis.map(e => (
                    <IconButton
                      key={e.v}
                      onClick={() => rateConversation(e.v)}
                      title={e.label}
                      sx={{ fontSize: 24, p: 0.5 }}
                    >
                      {e.glyph}
                    </IconButton>
                  ))}
                </Stack>
              </Box>
            )}
            {showCsatThanks && (
              <Box sx={{
                mt: 1, p: 1.25,
                bgcolor: 'success.light', color: 'success.contrastText',
                borderRadius: 2, textAlign: 'center',
              }}>
                <Typography sx={{ fontSize: 12 }}>
                  {t('support.csat.thanks')} {csatEmojis.find(e => e.v === customerRating)?.glyph}
                </Typography>
              </Box>
            )}

            <div ref={chatEndRef} />
          </Box>

          {/* Operator: AI suggestion banner */}
          {isSparksUser && aiSuggestion && (
            <Box sx={{
              px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider',
              bgcolor: 'info.light',
            }}>
              <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.5 }}>
                <AutoAwesomeIcon sx={{ fontSize: 14, color: 'info.dark' }} />
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'info.dark' }}>
                  {t('support.aiSuggestion.label')}
                </Typography>
                {aiConfidence != null && (
                  <Chip
                    size="small"
                    color={confidenceColor(aiConfidence)}
                    label={`${t('support.aiSuggestion.confidence')}: ${Math.round(aiConfidence * 100)}%`}
                    sx={{ height: 18, fontSize: 10, fontWeight: 700 }}
                  />
                )}
              </Stack>
              <Typography sx={{
                fontSize: 12, lineHeight: 1.45, color: 'text.primary',
                mb: 1, whiteSpace: 'pre-wrap',
                maxHeight: 96, overflowY: 'auto',
              }}>
                {aiSuggestion}
              </Typography>
              <Stack direction="row" spacing={0.75}>
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  startIcon={<CheckIcon fontSize="small" />}
                  onClick={acceptAiSuggestion}
                  disabled={sending}
                  sx={{ fontSize: 11, py: 0.5 }}
                >
                  {t('support.aiSuggestion.accept')}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<EditIcon fontSize="small" />}
                  onClick={editAiSuggestion}
                  sx={{ fontSize: 11, py: 0.5 }}
                >
                  {t('support.aiSuggestion.edit')}
                </Button>
                <Button
                  size="small"
                  variant="text"
                  onClick={dismissAiSuggestion}
                  sx={{ fontSize: 11, py: 0.5 }}
                >
                  {t('support.aiSuggestion.dismiss')}
                </Button>
              </Stack>
            </Box>
          )}

          {/* Operator: internal notes (collapsible, never visible to customer) */}
          {isSparksUser && conversationId && (
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'grey.50' }}>
              <Button
                fullWidth
                onClick={() => setNotesExpanded(v => !v)}
                startIcon={<NotesIcon fontSize="small" />}
                sx={{
                  justifyContent: 'flex-start',
                  textTransform: 'none',
                  fontSize: 11, color: 'text.secondary',
                  py: 0.75,
                }}
              >
                {t('support.notes.label')}
                {notesSaveStatus === 'saving' && <Typography component="span" sx={{ ml: 1, fontSize: 10, opacity: 0.6 }}>{t('support.notes.saving')}</Typography>}
                {notesSaveStatus === 'saved' && <Typography component="span" sx={{ ml: 1, fontSize: 10, color: 'success.main' }}>{t('support.notes.saved')}</Typography>}
              </Button>
              {notesExpanded && (
                <Box sx={{ px: 1.5, pb: 1 }}>
                  <TextField
                    fullWidth
                    multiline
                    rows={3}
                    size="small"
                    placeholder={t('support.notes.placeholder')}
                    value={internalNotes}
                    onChange={e => onInternalNotesChange(e.target.value)}
                    sx={{ '& .MuiOutlinedInput-root': { fontSize: 12 } }}
                  />
                </Box>
              )}
            </Box>
          )}

          {/* Reply input */}
          {isSparksUser && !conversationId && (
            <Box sx={{ px: 2, py: 1, bgcolor: 'warning.light', color: 'warning.contrastText', fontSize: 12 }}>
              {t('support.chat.openFromInbox')}
            </Box>
          )}
          <Box sx={{
            px: 1.5, py: 1.25, borderTop: '1px solid', borderColor: 'divider',
            display: 'flex', gap: 1, bgcolor: 'background.paper',
          }}>
            <TextField
              inputRef={inputRef}
              fullWidth
              size="small"
              disabled={isSparksUser && !conversationId}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isSparksUser ? (conversationId ? t('support.chat.replyCustomer') : t('support.chat.openConvToReply')) : t('support.chat.typeMessage')}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 5,
                  '@media (pointer: coarse)': { minHeight: 44 },
                },
              }}
            />
            <Button
              variant="contained"
              onClick={sendMessage}
              disabled={!input.trim() || sending || (isSparksUser && !conversationId)}
              sx={{
                borderRadius: 5, minWidth: 44, px: 2,
                fontWeight: 700, fontSize: 13,
                '@media (pointer: coarse)': { minHeight: 44 },
              }}
            >
              <SendIcon fontSize="small" />
            </Button>
          </Box>
        </Paper>
      )}
    </>
  );
}
