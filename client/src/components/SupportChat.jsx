import { useState, useEffect, useRef } from 'react';
import { Box, Typography, IconButton, TextField, Button, Paper, Fab, Badge } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';

/**
 * SupportChat — Floating chat bubble
 *
 * FOR CUSTOMERS: Send messages to Sparks support, saved to database
 * FOR SPARKS ADMIN: Shows active support conversation when viewing a customer's ticket
 *
 * The bubble persists across all views — it follows you everywhere.
 */
export default function SupportChat({ user, simulatingCompany, externalOpen, onExternalOpenChange, activeConversation, onConversationChange }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (val) => { setInternalOpen(val); if (onExternalOpenChange) onExternalOpenChange(val); };
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const pollRef = useRef(null);

  const isSparksUser = !!user?.sparks_role;

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

  // Load conversation on open
  useEffect(() => {
    if (!open) return;

    if (isSparksUser && activeConversation) {
      // Sparks admin viewing a specific customer conversation
      loadSparksConversation(activeConversation);
    } else if (!isSparksUser) {
      // Customer loading their own conversation
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
      if (data.messages && data.messages.length > 0) {
        setMessages(data.messages.map(m => ({
          id: m.id,
          role: m.sender_type === 'customer' ? 'user' : 'support',
          text: m.content,
          time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        })));
      } else if (messages.length === 0) {
        setMessages([{
          id: 'welcome',
          role: 'support',
          text: 'Hi! How can we help you today? Describe your issue and our team will get back to you.',
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
      if (data.messages) {
        setMessages(data.messages.map(m => ({
          id: m.id,
          role: m.sender_type === 'customer' ? 'user' : 'support',
          text: m.content,
          name: m.person_name,
          time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        })));
      }
    } catch {}
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const newMsg = {
      id: 'temp_' + Date.now(),
      role: 'user',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, newMsg]);
    setInput('');
    setSending(true);

    try {
      if (isSparksUser && conversationId) {
        // Sparks admin replying to customer
        const r = await fetch(`/api/support/reply/${conversationId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text }),
        });
        if (!r.ok) throw new Error('Failed to send');
      } else {
        // Customer sending to support
        const r = await fetch('/api/support/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text }),
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
        text: 'Failed to send message. Please try again.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    }

    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const headerTitle = isSparksUser ? 'Support Chat' : 'Horizon Sparks Support';
  const headerSub = isSparksUser && activeConversation ? (messages[0]?.name || 'Customer') : (simulatingCompany?.name || user?.company_name || '');

  return (
    <>
      {/* Floating Bubble — always visible except when chat is open */}
      {!open && (
        <Fab onClick={() => setOpen(true)} title="Support Chat"
          sx={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 900,
            bgcolor: 'secondary.main', border: '3px solid', borderColor: 'primary.main',
            color: 'primary.main', fontSize: 24,
            '&:hover': { bgcolor: 'secondary.dark' },
          }}>
          💬
        </Fab>
      )}

      {/* Chat Panel */}
      {open && (
        <Paper elevation={8} sx={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          width: 360, maxWidth: 'calc(100vw - 48px)',
          height: 480, maxHeight: 'calc(100vh - 120px)',
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
            {messages.map(msg => (
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
                  {msg.text}
                </Paper>
                <Typography sx={{
                  fontSize: 10, color: 'text.secondary', mt: 0.375,
                  textAlign: msg.role === 'user' ? 'right' : 'left',
                  px: 0.5,
                }}>
                  {msg.time}
                </Typography>
              </Box>
            ))}
            <div ref={chatEndRef} />
          </Box>

          {/* Input */}
          <Box sx={{
            px: 1.5, py: 1.25, borderTop: '1px solid', borderColor: 'divider',
            display: 'flex', gap: 1, bgcolor: 'background.paper',
          }}>
            <TextField
              inputRef={inputRef}
              fullWidth
              size="small"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isSparksUser ? "Reply to customer..." : "Type your message..."}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 5 } }}
            />
            <Button
              variant="contained"
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              sx={{ borderRadius: 5, minWidth: 'auto', px: 2, fontWeight: 700, fontSize: 13 }}
            >
              <SendIcon fontSize="small" />
            </Button>
          </Box>
        </Paper>
      )}
    </>
  );
}
