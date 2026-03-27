import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import TabView from '../components/TabView.jsx';
import { safeMarkdown } from '../utils/helpers.js';

export default function RecordView({ user, onSaved }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState('idle'); // idle, recording, processing, conversation, structuring, done
  const [elapsed, setElapsed] = useState(0);
  const [turns, setTurns] = useState([]); // [{role:'user',text:''},{role:'ai',text:''}]
  const [liveText, setLiveText] = useState('');
  const [verbatim, setVerbatim] = useState('');
  const [structured, setStructured] = useState('');
  const [audioFilenames, setAudioFilenames] = useState([]);
  const [error, setError] = useState('');
  const [reportId, setReportId] = useState('');
  const [contextPackage, setContextPackage] = useState(null);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState(-1); // which turn index is being read
  const [pendingMessages, setPendingMessages] = useState([]);
  const [totalDuration, setTotalDuration] = useState(0);

  const [reportPhotos, setReportPhotos] = useState([]); // [{file, preview}]
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);
  const timerRef = useRef(null);
  const startTime = useRef(null);
  const recognition = useRef(null);
  const fullTranscript = useRef('');
  const audioFilenamesRef = useRef([]);
  const ttsAudio = useRef(null);
  const ttsCache = useRef({}); // {text: blobUrl} cache for pre-fetched audio
  const audioUnlocked = useRef(false); // track if iOS audio context is unlocked
  const chatEndRef = useRef(null);

  // Load messages for this person on mount
  useEffect(() => {
    if (user.person_id) {
      fetch(`/api/messages/${user.person_id}`).then(r => r.json()).then(msgs => {
        const unaddressed = msgs.filter(m => !m.addressed_in_report);
        setPendingMessages(unaddressed);
      }).catch(() => {});
    }
    setReportId(new Date().toISOString().replace(/[:.]/g, '-').replace('Z', ''));
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [turns, liveText]);

  const startRecording = async () => {
    try {
      setError('');
      setLiveText('');
      fullTranscript.current = '';
      audioUnlocked.current = true;

      // Step 1: Get microphone access
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micErr) {
        if (micErr.name === 'NotAllowedError' || micErr.name === 'PermissionDeniedError') {
          setError(t('common.micDenied'));
        } else if (micErr.name === 'NotFoundError') {
          setError(t('common.micNotFound'));
        } else if (micErr.name === 'NotSupportedError') {
          setError(t('common.micNotSupported'));
        } else {
          setError('Microphone error: ' + micErr.message);
        }
        return;
      }

      // Step 2: Create MediaRecorder with best supported format
      let recorder;
      const mimeTypes = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
      let selectedMime = '';

      for (const mime of mimeTypes) {
        try {
          if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime)) {
            selectedMime = mime;
            break;
          }
        } catch(e) {}
      }

      try {
        recorder = selectedMime
          ? new MediaRecorder(stream, { mimeType: selectedMime })
          : new MediaRecorder(stream);
      } catch (recErr) {
        setError('Recording not supported on this browser. Try Safari or Chrome.');
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      audioChunks.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      recorder.onstop = () => stream.getTracks().forEach(t => t.stop());
      recorder.start(1000);
      mediaRecorder.current = recorder;

      // Step 3: Live speech preview (optional — not all browsers support this)
      try {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SR) {
          const recog = new SR();
          recog.continuous = true;
          recog.interimResults = true;
          recog.lang = 'en-US';
          recog.onresult = (event) => {
            let interim = '', final = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const text = event.results[i][0].transcript;
              if (event.results[i].isFinal) final += text + ' ';
              else interim = text;
            }
            if (final) { fullTranscript.current += final; }
            setLiveText(fullTranscript.current + interim);
          };
          recog.onerror = () => {};
          recog.onend = () => {
            if (mediaRecorder.current?.state === 'recording') try { recog.start(); } catch(e) {}
          };
          recog.start();
          recognition.current = recog;
        }
      } catch(e) {
        // Speech recognition not available — recording still works, just no live text
      }

      startTime.current = Date.now();
      setStage('recording');
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 500);
    } catch (err) {
      setError('Recording error: ' + (err.message || 'Unknown error. Make sure you are using HTTPS.'));
    }
  };

  const cancelRecording = () => {
    if (recognition.current) { recognition.current.onend = null; try { recognition.current.stop(); } catch(e) {} }
    if (mediaRecorder.current?.state !== 'inactive') try { mediaRecorder.current.stop(); } catch(e) {}
    clearInterval(timerRef.current);
    stopSpeaking();
    setStage('idle');
    setElapsed(0);
    setTurns([]);
    setLiveText('');
    setVerbatim('');
    setStructured('');
    setAudioFilenames([]);
    audioFilenamesRef.current = [];
    fullTranscript.current = '';
    setReportPhotos([]);
    setTotalDuration(0);
    setError('');
    setReportId(new Date().toISOString().replace(/[:.]/g, '-').replace('Z', ''));
  };

  const takeReportPhoto = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.capture = 'environment';
    inp.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setReportPhotos(prev => [...prev, { file, preview: ev.target.result, name: file.name }]);
      };
      reader.readAsDataURL(file);
    };
    inp.click();
  };

  const stopRecording = async () => {
    if (recognition.current) { recognition.current.onend = null; recognition.current.stop(); }
    if (mediaRecorder.current?.state !== 'inactive') mediaRecorder.current.stop();
    clearInterval(timerRef.current);
    setTotalDuration(d => d + elapsed);
    setStage('processing');

    setTimeout(async () => {
      try {
        const mimeType = mediaRecorder.current?.mimeType || 'audio/webm';
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(audioChunks.current, { type: mimeType });
        const formData = new FormData();
        formData.append('audio', blob, `recording.${ext}`);
        formData.append('report_id', reportId + '_turn' + turns.length);

        const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
        let transcriptText = '';

        if (res.ok) {
          const data = await res.json();
          transcriptText = data.transcript;
          audioFilenamesRef.current = [...audioFilenamesRef.current, data.audio_file];
          setAudioFilenames(audioFilenamesRef.current);
        } else {
          transcriptText = fullTranscript.current.trim();
        }

        if (!transcriptText) {
          setError(t('common.noSpeechDetected'));
          setStage(turns.length > 0 ? 'conversation' : 'idle');
          return;
        }

        // Add user turn
        const newTurns = [...turns, { role: 'user', text: transcriptText }];
        setTurns(newTurns);
        setLiveText('');

        // Get AI follow-up
        await getAiResponse(newTurns);
      } catch (e) {
        const fallbackText = fullTranscript.current.trim();
        if (fallbackText) {
          const newTurns = [...turns, { role: 'user', text: fallbackText }];
          setTurns(newTurns);
          await getAiResponse(newTurns);
        } else {
          setError('Recording failed. Try again.');
          setStage(turns.length > 0 ? 'conversation' : 'idle');
        }
      }
    }, 500);
  };

  const getAiResponse = async (currentTurns) => {
    try {
      // Send the FULL conversation (user + AI turns) so Claude has full context
      const conversationHistory = currentTurns.map(t => ({
        role: t.role === 'user' ? 'user' : 'assistant',
        content: t.text
      }));

      const res = await fetch('/api/converse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person_id: user.person_id,
          conversation: conversationHistory,
          transcript_so_far: currentTurns.filter(t => t.role === 'user').map(t => t.text).join('\n\n'),
          messages_for_person: currentTurns.length <= 1 ? pendingMessages : [],
        }),
      });

      if (!res.ok) throw new Error('AI response failed');
      const data = await res.json();
      const aiText = data.response;

      const newTurns = [...currentTurns, { role: 'ai', text: aiText }];
      setTurns(newTurns);
      setStage('conversation');

      // Pre-fetch OpenAI TTS so Read button is instant
      prefetchTTS(aiText);
    } catch (err) {
      setTurns([...currentTurns, { role: 'ai', text: "I couldn't process that. You can try recording again or finalize your report." }]);
      setStage('conversation');
    }
  };

  // Pre-fetch TTS audio in background (called when AI responds)
  const prefetchTTS = async (text) => {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, speed: 1.15 }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        ttsCache.current[text] = url;
      }
    } catch (e) { /* silent fail — user can still tap Read and it will fetch then */ }
  };

  // Play TTS — OpenAI only. Uses cache if available, otherwise fetches.
  const speakText = async (text, index) => {
    try {
      setAiSpeaking(true);
      setSpeakingIndex(index !== undefined ? index : -1);
      if (ttsAudio.current) { ttsAudio.current.pause(); ttsAudio.current = null; }

      let audioUrl = ttsCache.current[text];

      // If not cached, fetch now
      if (!audioUrl) {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, speed: 1.15 }),
        });
        if (res.ok) {
          const blob = await res.blob();
          audioUrl = URL.createObjectURL(blob);
          ttsCache.current[text] = audioUrl;
        }
      }

      if (audioUrl) {
        const audio = new Audio(audioUrl);
        ttsAudio.current = audio;
        audio.onended = () => { setAiSpeaking(false); setSpeakingIndex(-1); ttsAudio.current = null; };
        audio.onerror = () => { setAiSpeaking(false); setSpeakingIndex(-1); ttsAudio.current = null; };
        await audio.play();
      } else {
        setAiSpeaking(false);
        setSpeakingIndex(-1);
      }
    } catch (e) {
      setAiSpeaking(false);
      setSpeakingIndex(-1);
    }
  };

  const stopSpeaking = () => {
    if (ttsAudio.current) { ttsAudio.current.pause(); ttsAudio.current = null; }
    setAiSpeaking(false);
    setSpeakingIndex(-1);
  };

  const finalizeReport = async () => {
    stopSpeaking();
    setStage('structuring');

    try {
      const allText = turns.filter(t => t.role === 'user').map(t => t.text).join('\n\n');
      const body = { transcript: allText };
      if (user.person_id) body.person_id = user.person_id;

      const res = await fetch('/api/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Structuring failed');
      const data = await res.json();
      setVerbatim(data.verbatim);
      setStructured(data.structured);
      setContextPackage(data.context_package);
      setStage('done');
    } catch (err) {
      setError('Structuring failed. Saving with transcript only.');
      setStage('done');
    }
  };

  const saveReport = async () => {
    const allText = turns.filter(t => t.role === 'user').map(t => t.text).join('\n\n');
    const report = {
      id: reportId,
      person_id: user.person_id || null,
      person_name: user.name,
      role_title: user.role_title,
      template_id: user.template_id || null,
      project_id: 'default',
      created_at: new Date().toISOString(),
      audio_file: audioFilenamesRef.current[0] || audioFilenames[0] || null,
      audio_files: audioFilenamesRef.current.length > 0 ? audioFilenamesRef.current : audioFilenames,
      duration_seconds: totalDuration,
      transcript_raw: allText,
      conversation_turns: turns,
      markdown_verbatim: verbatim || null,
      markdown_structured: structured || null,
      context_package_snapshot: contextPackage || null,
      messages_addressed: pendingMessages.map(m => m.id),
      status: verbatim && structured ? 'complete' : 'partial',
    };

    try {
      await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });

      // Mark messages as addressed
      if (pendingMessages.length > 0 && user.person_id) {
        await fetch(`/api/messages/${user.person_id}/mark-addressed`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_ids: pendingMessages.map(m => m.id), report_id: reportId }),
        });
      }

      reset();
      onSaved();
    } catch (err) { setError('Failed to save report'); }
  };

  const reset = () => {
    stopSpeaking();
    if (recognition.current) { recognition.current.onend = null; recognition.current.stop(); }
    if (mediaRecorder.current?.state !== 'inactive') try { mediaRecorder.current.stop(); } catch(e) {}
    clearInterval(timerRef.current);
    setStage('idle'); setTurns([]); setVerbatim(''); setStructured('');
    setElapsed(0); setError(''); setAudioFilenames([]); setLiveText('');
    setContextPackage(null); setTotalDuration(0); fullTranscript.current = ''; audioFilenamesRef.current = [];
    setReportId(new Date().toISOString().replace(/[:.]/g, '-').replace('Z', ''));
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const DeleteConfirmModal = () => showDeleteConfirm ? (
    <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999}}>
      <div style={{background: 'white', borderRadius: '16px', padding: '28px', maxWidth: '320px', width: '90%', textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.2)'}}>
        <p style={{fontSize: '17px', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 8px'}}>{t('common.deleteRecording')}</p>
        <p style={{fontSize: '14px', color: 'var(--charcoal)', margin: '0 0 24px'}}>This will discard everything and start over.</p>
        <div style={{display: 'flex', gap: '10px'}}>
          <button onClick={() => setShowDeleteConfirm(false)} style={{flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--gray-300)', background: 'white', color: 'var(--charcoal)', fontSize: '15px', fontWeight: 600, cursor: 'pointer'}}>Cancel</button>
          <button onClick={confirmDelete} style={{flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: '#E8922A', color: 'var(--charcoal)', fontSize: '15px', fontWeight: 700, cursor: 'pointer'}}>Delete</button>
        </div>
      </div>
    </div>
  ) : null;

  // Idle — big mic button
  if (stage === 'idle') {
    return (
      <div className="record-view">
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}>&times;</button></div>}
        {pendingMessages.length > 0 && (
          <div className="messages-banner">
            <span className="messages-icon">💬</span>
            <span>You have {pendingMessages.length} message{pendingMessages.length > 1 ? 's' : ''} from your team</span>
          </div>
        )}
        <div className="record-center">
          <button className="record-btn-main" onClick={startRecording}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </button>
          <p className="record-label">{t('common.tapToRecord')}</p>
          <p className="record-sublabel">{t('common.startDailyVoiceReport')}</p>
        </div>
      </div>
    );
  }

  // Recording (first time, no turns yet) — big mic button
  if (stage === 'recording' && turns.length === 0) {
    return (
      <div className="record-view">

        <div className="record-center">
          <button className="record-btn-main recording-main" onClick={stopRecording}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button>
          <p className="record-timer">{formatTime(elapsed)}</p>
          <p className="record-label">{t('common.recordingTapToStop')}</p>
          {liveText && <div className="live-transcript"><span className="live-final">{liveText}</span></div>}
          <button className="btn btn-delete" style={{fontSize: '14px', padding: '10px 20px', marginTop: '20px'}} onClick={cancelRecording}>✕ Cancel</button>
        </div>
      </div>
    );
  }

  // Processing (first time, no turns yet) — spinner
  if (stage === 'processing' && turns.length === 0) {
    return (
      <div className="record-view">
        <div className="record-center"><div className="spinner"></div><p className="record-label">{t('common.processing')}</p></div>
      </div>
    );
  }

  // Conversation — stays on this page for recording, processing, and chatting
  if (stage === 'conversation' || stage === 'recording' || stage === 'processing') {
    return (
      <div className="conversation-view">

        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}>&times;</button></div>}

        <div className="chat-container">
          {turns.map((turn, i) => (
            <div key={i} className={`chat-bubble ${turn.role}`}>
              <div className="chat-role">{turn.role === 'user' ? user.name.split(' ')[0] : 'AI ASSISTANT'}</div>
              <div className="chat-text">{turn.text}</div>
              {turn.role === 'ai' && (
                (aiSpeaking && speakingIndex === i) ? (
                  <button className="read-btn reading-active" onClick={stopSpeaking}>
                    ⏸ Pause
                  </button>
                ) : (
                  <button className="read-btn" onClick={() => speakText(turn.text, i)} disabled={aiSpeaking && speakingIndex !== i}>
                    🔊 Read
                  </button>
                )
              )}
            </div>
          ))}
          {/* Show live transcript while recording in conversation */}
          {stage === 'recording' && liveText && (
            <div className="chat-bubble user recording-live">
              <div className="chat-role">{t('common.recording')}</div>
              <div className="chat-text">{liveText}</div>
            </div>
          )}
          {stage === 'processing' && (
            <div className="chat-bubble processing-bubble">
              <div className="spinner-small"></div>
              <span>{t('common.processing')}</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {reportPhotos.length > 0 && (
          <div style={{display: 'flex', gap: '6px', padding: '8px 16px', flexWrap: 'wrap', background: 'var(--gray-50)', borderTop: '1px solid var(--gray-200)'}}>
            {reportPhotos.map((p, i) => (
              <div key={i} style={{position: 'relative'}}>
                <img src={p.preview} style={{width: '44px', height: '44px', borderRadius: '6px', objectFit: 'cover', border: '2px solid var(--primary)'}} alt="" />
                <button onClick={() => setReportPhotos(prev => prev.filter((_, j) => j !== i))} style={{position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px', borderRadius: '50%', background: '#E8922A', color: 'var(--charcoal)', border: 'none', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="conversation-actions">
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '10px'}}>
            <button onClick={cancelRecording} style={{background: '#E8922A', color: 'var(--charcoal)', border: 'none', borderRadius: '10px', padding: '10px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap'}}>Delete</button>
            <button className="btn btn-primary finalize-btn" onClick={finalizeReport} disabled={stage !== 'conversation'} style={{flex: 1, padding: '14px', fontSize: '16px'}}>
              {t('common.finalizeReport')}
            </button>
          </div>
          <div style={{display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', marginTop: '8px'}}>
            <button className="record-btn-conv" onClick={takeReportPhoto} style={{background: 'var(--gray-100)', color: 'var(--charcoal)', border: '2px solid var(--gray-300)'}} title="Take Photo">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/><path d="M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>
            </button>
            {stage === 'recording' ? (
              <button className="record-btn-conv recording-conv" onClick={stopRecording}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                <span>{formatTime(elapsed)}</span>
              </button>
            ) : stage === 'processing' ? (
              <div className="record-btn-conv processing-conv">
                <div className="spinner-small"></div>
              </div>
            ) : (
              <button className="record-btn-conv" onClick={() => { stopSpeaking(); startRecording(); }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Structuring — spinner
  if (stage === 'structuring') {
    return (
      <div className="record-view">
        <div className="record-center"><div className="spinner"></div><p className="record-label">{t('common.buildingReport')}</p></div>
      </div>
    );
  }

  // Done — show structured report
  if (stage === 'done') {
    const now = new Date();
    return (
      <div className="result-section">
        <div className="report-header-info">
          <h3>{user.name}</h3>
          <span className="report-meta">{user.role_title || 'Administrator'}</span>
          <span className="report-meta">{now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
        </div>
        <TabView tabs={[
          { label: 'Report', content: structured },
          { label: 'Original', content: verbatim },
          { label: 'Conversation', content: turns.map(t => `**${t.role === 'user' ? user.name : 'AI'}:** ${t.text}`).join('\n\n'), isPlain: false },
        ]} />
        <div className="action-row">
          <button className="btn btn-primary btn-lg" onClick={saveReport}>Save Report</button>
          <button className="btn btn-secondary" onClick={reset}>Discard</button>
        </div>
      </div>
    );
  }

  return null;
}
