import { useState, useRef } from 'react';

export default function VoiceInput({ value, onChange, placeholder, rows }) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showAiVersion, setShowAiVersion] = useState(false);
  const [aiText, setAiText] = useState('');
  const [originalText, setOriginalText] = useState('');
  const recorderRef = useRef(null);
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
      alert('Microphone access needed. Make sure you are using HTTPS.');
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
        alert('Recording failed. Try again.');
      }
      setProcessing(false);
    }, 500);
  };

  const acceptAi = () => { onChange(aiText); setShowAiVersion(false); setAiText(''); };
  const keepOriginal = () => { onChange(originalText); setShowAiVersion(false); setAiText(''); };

  return (
    <div className="voice-input-wrapper">
      <textarea
        className="form-input form-textarea"
        rows={rows || 3}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <button
        className={`voice-field-btn ${recording ? 'voice-field-recording' : ''} ${processing ? 'voice-field-processing' : ''}`}
        onClick={recording ? stopVoice : startVoice}
        disabled={processing}
        type="button"
      >
        {processing ? (
          <div className="spinner-small"></div>
        ) : recording ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        )}
      </button>
      {showAiVersion && (
        <div className="voice-ai-review">
          <div className="voice-ai-columns">
            <div className="voice-ai-cleaned">
              <span className="voice-ai-label">AI Version</span>
              <p>{aiText}</p>
            </div>
            <div className="voice-ai-original">
              <span className="voice-ai-label">Your Words</span>
              <p>{originalText}</p>
            </div>
          </div>
          <div className="voice-ai-actions">
            <button className="btn-primary" onClick={acceptAi} style={{padding:'12px', fontSize:'14px'}}>Use AI Version</button>
            <button className="btn-secondary" onClick={keepOriginal} style={{padding:'12px', fontSize:'14px', background:'white'}}>Keep Original</button>
          </div>
        </div>
      )}
    </div>
  );
}
