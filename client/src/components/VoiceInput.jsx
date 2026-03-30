import { useState, useRef } from 'react';
import { Box, TextField, IconButton, Button, Typography, Paper, CircularProgress, Dialog, DialogContent, DialogActions } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';

export default function VoiceInput({ value, onChange, placeholder, rows }) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showAiVersion, setShowAiVersion] = useState(false);
  const [aiText, setAiText] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [dialogConfig, setDialogConfig] = useState(null);
  const recorderRef = useRef(null);

  const showAlert = (message) => setDialogConfig({ message });
  const chunksRef = useRef([]);

  const startVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let recorder;
      const mimeTypes = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      let selectedMime = '';
      for (const mime of mimeTypes) {
        try { if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime)) { selectedMime = mime; break; } } catch(e) {}
      }
      try { recorder = selectedMime ? new MediaRecorder(stream, { mimeType: selectedMime }) : new MediaRecorder(stream); } catch(e) { recorder = new MediaRecorder(stream); }
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => stream.getTracks().forEach(t => t.stop());
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording(true);
    } catch (e) {
      showAlert('Microphone access needed. Make sure you are using HTTPS.');
    }
  };

  const stopVoice = async () => {
    setRecording(false);
    setProcessing(true);
    if (recorderRef.current?.state !== 'inactive') recorderRef.current.stop();

    setTimeout(async () => {
      try {
        const mimeType = recorderRef.current?.mimeType || 'audio/webm';
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const formData = new FormData();
        formData.append('audio', blob, `field_recording.${ext}`);
        formData.append('report_id', 'field_' + Date.now());

        const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          const spoken = data.transcript;
          setOriginalText(spoken);

          try {
            const aiRes = await fetch('/api/structure', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ transcript: spoken, field_cleanup: true }),
            });
            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const cleaned = aiData.cleaned || spoken;
              if (cleaned !== spoken) {
                setAiText(cleaned);
                setShowAiVersion(true);
              } else {
                onChange(spoken);
              }
            } else {
              onChange(spoken);
            }
          } catch(e) {
            onChange(spoken);
          }
        }
      } catch(e) {
        showAlert('Recording failed. Try again.');
      }
      setProcessing(false);
    }, 500);
  };

  const acceptAi = () => { onChange(aiText); setShowAiVersion(false); setAiText(''); };
  const keepOriginal = () => { onChange(originalText); setShowAiVersion(false); setAiText(''); };

  return (
    <Box className="voice-input-wrapper" sx={{ position: 'relative' }}>
      <TextField
        fullWidth
        multiline
        rows={rows || 3}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        variant="outlined"
      />
      <IconButton
        onClick={recording ? stopVoice : startVoice}
        disabled={processing}
        sx={{
          position: 'absolute', right: 8, top: 8,
          bgcolor: recording ? 'error.main' : 'primary.main',
          color: 'white',
          '&:hover': { bgcolor: recording ? 'error.dark' : 'primary.dark' },
          width: 36, height: 36,
        }}
      >
        {processing ? (
          <CircularProgress size={18} color="inherit" />
        ) : recording ? (
          <StopIcon fontSize="small" />
        ) : (
          <MicIcon fontSize="small" />
        )}
      </IconButton>
      {showAiVersion && (
        <Paper variant="outlined" sx={{ mt: 1, p: 2, borderRadius: 2, borderColor: 'primary.main' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'primary.main', mb: 0.5 }}>AI Version</Typography>
              <Typography sx={{ fontSize: 13 }}>{aiText}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>Your Words</Typography>
              <Typography sx={{ fontSize: 13 }}>{originalText}</Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" onClick={acceptAi} sx={{ py: 1.5, fontSize: 14 }}>Use AI Version</Button>
            <Button variant="outlined" onClick={keepOriginal} sx={{ py: 1.5, fontSize: 14 }}>Keep Original</Button>
          </Box>
        </Paper>
      )}

      <Dialog open={!!dialogConfig} onClose={() => setDialogConfig(null)}>
        <DialogContent>
          <Typography>{dialogConfig?.message}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogConfig(null)}>OK</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
