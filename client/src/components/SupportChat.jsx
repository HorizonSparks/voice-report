import { useState, useEffect, useRef } from 'react';
import { Box, Typography, IconButton, TextField, Button, Paper, Fab } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';

export default function SupportChat({ user, simulatingCompany, externalOpen, onExternalOpenChange }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (val) => { setInternalOpen(val); if (onExternalOpenChange) onExternalOpenChange(val); };
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        id: 'welcome',
        role: 'support',
        text: 'Hi! How can we help you today? Describe your issue and our team will get back to you.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    }
  }, [open]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const newMsg = {
      id: 'msg_' + Date.now(),
      role: 'user',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, newMsg]);
    setInput('');
    setSending(true);

    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: 'ack_' + Date.now(),
        role: 'support',
        text: 'Thanks! Your message has been received. Our team will respond shortly.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
      setSending(false);
    }, 800);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const companyName = simulatingCompany?.name || 'Horizon Sparks';

  return (
    <>
      {/* Floating Bubble */}
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
                Horizon Sparks Support
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, mt: 0.25 }}>
                {companyName}
              </Typography>
            </Box>
            <IconButton onClick={() => setOpen(false)} sx={{ color: 'white' }}>
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
              placeholder="Type your message..."
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
