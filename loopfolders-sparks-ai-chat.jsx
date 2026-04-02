import { useState, useRef, useEffect } from 'react';

import { Box, Typography, TextField, IconButton } from '@mui/material';

/**
 * Sparks AI Chat — embedded in the Edit Tag panel of the P&ID viewer.
 * Calls Voice Report Agent API with instrument context.
 * LAZY: Zero AI tokens until user sends a message.
 *
 * Auth: Uses X-Integration-Key header (not cookies) for cross-origin calls.
 * Set NEXT_PUBLIC_VOICE_REPORT_URL and NEXT_PUBLIC_INTEGRATION_KEY in .env.local
 */

const VOICE_REPORT_URL = process.env.NEXT_PUBLIC_VOICE_REPORT_URL || 'https://horizonsparks.com';
const INTEGRATION_KEY = process.env.NEXT_PUBLIC_INTEGRATION_KEY || '';

export default function SparksAIChat({ tagForm, compact = false }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const messagesRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, loading]);

  const instrumentContext = [
    tagForm?.tag && ('Instrument: ' + tagForm.tag),
    tagForm?.prefix && ('Prefix: ' + tagForm.prefix),
    tagForm?.type && ('Type: ' + tagForm.type),
    tagForm?.loop && ('Loop: ' + tagForm.loop),
    tagForm?.suffix && ('Suffix: ' + tagForm.suffix),
    tagForm?.loopNumber && ('Tag Loop Number: ' + tagForm.loopNumber),
    tagForm?.pAndId && ('P&ID: ' + tagForm.pAndId),
  ].filter(Boolean).join(', ');

  const sendMessage = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: msg }]);
    setLoading(true);

    try {
      const contextMsg = '[Context: Looking at ' + instrumentContext + '] ' + msg;
      const res = await fetch(VOICE_REPORT_URL + '/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Integration-Key': INTEGRATION_KEY,
        },
        body: JSON.stringify({
          message: contextMsg,
          contactName: tagForm?.tag || 'Unknown Instrument',
          contactRole: tagForm?.type || 'Instrument',
          currentWorld: 'loopfolders',
          currentScreen: 'pid-viewer',
        }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.response || data.error || 'No response', model: data.model, tools: data.tool_calls },
      ]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Cannot reach Sparks AI: ' + err.message, error: true }]);
    }
    setLoading(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        if (blob.size < 1000) return;
        setLoading(true);
        try {
          const form = new FormData();
          form.append('audio', blob, 'voice.' + (recorder.mimeType.includes('webm') ? 'webm' : 'm4a'));
          const res = await fetch(VOICE_REPORT_URL + '/api/transcribe', {
            method: 'POST',
            body: form,
            headers: { 'X-Integration-Key': INTEGRATION_KEY },
          });
          const data = await res.json();
          if (data.text?.trim()) sendMessage(data.text.trim());
          else setLoading(false);
        } catch { setLoading(false); }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err) { console.error('Mic denied:', err); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    setRecording(false);
  };

  const fs = compact ? 12 : 13;

  // Track when tag changes — show context update in real time
  const [lastTag, setLastTag] = useState(tagForm?.tag || '');
  useEffect(() => {
    if (tagForm?.tag && tagForm.tag !== lastTag) {
      setLastTag(tagForm.tag);
      if (messages.length > 0) {
        setMessages((prev) => [...prev, { role: 'system', content: 'Switched to ' + tagForm.tag + (tagForm.pAndId ? ' on P&ID ' + tagForm.pAndId : '') }]);
      }
    }
  }, [tagForm?.tag]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: '#FFF8F0', borderRadius: 1 }}>
      {/* Header */}
      <Box sx={{ px: 1.5, py: 1, bgcolor: '#F0F0F0', borderBottom: '1px solid #E0E0E0', flexShrink: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#E8822A' }}>
          Sparks AI
        </Typography>
        <Typography sx={{ fontSize: 10, color: '#999' }}>Relation Data Intelligence</Typography>
      </Box>

      {/* Live context bar — always shows current instrument */}
      {tagForm?.tag && (
        <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'rgba(232,130,42,0.08)', borderBottom: '1px solid #E8E8E8', flexShrink: 0 }}>
          <Typography sx={{ fontSize: 11, color: '#E8822A', fontWeight: 700 }}>
            {tagForm.tag}
            <span style={{ color: '#888', fontWeight: 400, marginLeft: 8 }}>
              {[tagForm.type, tagForm.pAndId ? 'P&ID ' + tagForm.pAndId : ''].filter(Boolean).join(' \u00B7 ')}
            </span>
          </Typography>
        </Box>
      )}

      {/* Messages */}
      <Box ref={messagesRef} sx={{
        flex: 1, overflowY: 'auto', px: 1.5, py: 1.5,
        display: 'flex', flexDirection: 'column', gap: 1.5,
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(0,0,0,0.15)', borderRadius: 2 },
      }}>
        {messages.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 3, px: 1 }}>
            <Typography sx={{ fontSize: 11, color: '#888', lineHeight: 1.6 }}>
              Ask about <span style={{ color: '#E8822A', fontWeight: 700 }}>{tagForm?.tag || 'this instrument'}</span>
              {tagForm?.pAndId ? (' on P&ID ' + tagForm.pAndId) : ''}.
              I trace loop folders, associated files, reports, and calibration data. Zero cost until you ask.
            </Typography>
          </Box>
        )}
        {messages.map((msg, i) => (
          <Box key={i} sx={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : msg.role === 'system' ? 'center' : 'flex-start' }}>
            {msg.role === 'system' ? (
              <Typography sx={{ fontSize: 10, color: 'rgba(232,130,42,0.6)', fontStyle: 'italic', py: 0.5 }}>{msg.content}</Typography>
            ) : msg.role === 'user' ? (
              <Box sx={{ maxWidth: '85%', px: 1.5, py: 0.75, borderRadius: '14px 14px 4px 14px', bgcolor: '#E8822A', color: '#fff' }}>
                <Typography sx={{ fontSize: fs, lineHeight: 1.5 }}>{msg.content}</Typography>
              </Box>
            ) : (
              <Box sx={{ maxWidth: '95%', width: '100%' }}>
                <Typography component="div" sx={{
                  fontSize: fs, lineHeight: 1.6, color: '#3C3C3C', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  '& strong': { color: '#E8822A', fontWeight: 700 },
                }} dangerouslySetInnerHTML={{ __html: msg.content
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  .replace(/^### (.*$)/gm, '<div style="font-size:13px;font-weight:800;margin:8px 0 2px;color:#3C3C3C">$1</div>')
                  .replace(/^## (.*$)/gm, '<div style="font-size:14px;font-weight:800;margin:10px 0 4px;color:#3C3C3C">$1</div>')
                  .replace(/^- (.*$)/gm, '<div style="padding-left:8px;margin:1px 0">&#8226; $1</div>')
                  .replace(/\n/g, '<br/>')
                }} />
                {msg.model && <Typography sx={{ fontSize: 9, color: '#999', mt: 0.5 }}>{msg.model}{msg.tools ? (' \u00B7 ' + msg.tools + ' tools') : ''}</Typography>}
              </Box>
            )}
          </Box>
        ))}
        {loading && (
          <Box sx={{ display: 'flex', gap: 0.75, py: 1 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#E8822A', animation: 'pulse 1s infinite' }} />
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#E8822A', animation: 'pulse 1s infinite', animationDelay: '0.2s' }} />
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#E8822A', animation: 'pulse 1s infinite', animationDelay: '0.4s' }} />
          </Box>
        )}
      </Box>

      {/* Input */}
      <Box sx={{ px: 1.5, py: 1, bgcolor: '#E8E8E8', borderTop: '1px solid #D0D0D0' }}>
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-end', bgcolor: '#FFFFFF', border: '1px solid #D0D0D0', borderRadius: '20px', px: 1.5, py: 0.5 }}>
          <TextField
            multiline maxRows={3} placeholder="Ask about this instrument..."
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            variant="standard" size="small"
            slotProps={{ input: { disableUnderline: true } }}
            sx={{ flex: 1, '& .MuiInputBase-root': { py: 0.25, fontSize: fs, color: '#3C3C3C' }, '& .MuiInputBase-input': { resize: 'none', '&::placeholder': { color: '#999', opacity: 1 } } }}
          />
          {input.trim() ? (
            <IconButton size="small" onClick={() => sendMessage()} disabled={loading} sx={{ width: 30, height: 30, bgcolor: '#E8822A', color: '#fff', '&:hover': { bgcolor: '#C45500' } }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2" fill="white" stroke="white"/></svg>
            </IconButton>
          ) : (
            <IconButton size="small"
              onMouseDown={startRecording} onMouseUp={stopRecording} onMouseLeave={stopRecording}
              onTouchStart={startRecording} onTouchEnd={stopRecording}
              sx={{ width: 30, height: 30, bgcolor: recording ? '#ef5350' : 'transparent', color: recording ? '#fff' : '#888', animation: recording ? 'pulse 1s infinite' : 'none' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            </IconButton>
          )}
        </Box>
      </Box>
    </Box>
  );
}
