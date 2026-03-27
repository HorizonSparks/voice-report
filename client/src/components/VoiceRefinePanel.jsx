import { useState, useEffect, useRef } from 'react';
import AnalyticsTracker from '../utils/AnalyticsTracker.js';

export default function VoiceRefinePanel({ contextType, teamContext, onAccept, onCancel, personId, defaultVoiceMode, autoStart, taskContext }) {
  // Stages: idle, recording, processing, talking, listening, finalizing, review
  // Flow mode adds: flow-listening (continuous Speech Recognition with silence detection)
  const [stage, setStageRaw] = useState('idle');
  const [chatHistory, setChatHistory] = useState([]); // [{role: 'user'|'ai', text: string}]
  const [conversation, setConversation] = useState([]); // API conversation format
  const [round, setRound] = useState(0);
  const [currentFields, setCurrentFields] = useState(null);
  const [keyPoints, setKeyPoints] = useState([]);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [speakingMsgIndex, setSpeakingMsgIndex] = useState(null);
  const [liveText, setLiveText] = useState('');
  const [recordTime, setRecordTime] = useState(0);
  const [error, setError] = useState('');
  const [voiceMode, setVoiceMode] = useState('walkie'); // walkie-talkie default until Flow mode is production-ready
  const [flowBannerPulse, setFlowBannerPulse] = useState(false);
  const [chatText, setChatText] = useState('');
  const chatPhotoRef = useRef(null);
  const stageRef = useRef('idle'); // mirror of stage for closure-safe access

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const flowRecogRef = useRef(null);
  const flowSilenceTimerRef = useRef(null);
  const flowTimeoutRef = useRef(null);
  const flowTranscriptRef = useRef('');
  const flowLastSpeechRef = useRef(Date.now());

  // Analytics: track stage transitions
  const funnelIdRef = useRef('funnel_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  const stageTimeRef = useRef(Date.now());
  const prevStageRef = useRef('idle');
  const setStage = (newStage) => {
    const now = Date.now();
    const duration = now - stageTimeRef.current;
    AnalyticsTracker.track('refine_funnel', newStage, {
      funnel_id: funnelIdRef.current, from_stage: prevStageRef.current,
      context_type: contextType, round, duration_ms: duration,
    });
    prevStageRef.current = newStage;
    stageTimeRef.current = now;
    stageRef.current = newStage;
    setStageRaw(newStage);
  };
  const ttsAudioRef = useRef(null);
  const ttsCacheRef = useRef({});
  const timerRef = useRef(null);
  const recognitionRef = useRef(null);
  const fullTranscriptRef = useRef('');
  const chatEndRef = useRef(null);

  // Auto-scroll chat
  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, liveText, stage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) {} }
      stopFlowListening();
    };
  }, []);

  // Auto-start recording when panel opens (user already tapped "Speak your task" — that's the gesture)
  useEffect(() => {
    if (autoStart && stage === 'idle') {
      // Small delay to let the panel render first so the user sees the UI before mic prompt
      const timer = setTimeout(() => {
        if (voiceMode === 'flow') startFlowListening();
        else startRecording();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── FLOW MODE: Continuous Speech Recognition — conversation stays OPEN ───
  // The conversation never closes on its own. It's a back-and-forth dialogue.
  // 3s pause with speech = AI's turn. 15s total silence = AI checks in but keeps listening.
  const flowRetryCountRef = useRef(0);

  const startFlowListening = () => {
    stopFlowListening();
    setError('');
    setLiveText('');
    flowTranscriptRef.current = '';
    flowLastSpeechRef.current = Date.now();
    flowRetryCountRef.current = 0;
    setFlowBannerPulse(true);

    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { setError('Speech recognition not supported. Switching to walkie-talkie mode.'); setVoiceMode('walkie'); return; }

      // Create and start a fresh recognition instance
      const createRecognition = () => {
        const recog = new SR();
        recog.continuous = true;
        recog.interimResults = true;
        recog.lang = 'en-US';

        recog.onresult = (event) => {
          flowRetryCountRef.current = 0; // Reset retry count on any speech
          let final = '';
          let interim = '';
          for (let i = 0; i < event.results.length; i++) {
            const r = event.results[i];
            if (r.isFinal) {
              final += r[0].transcript + ' ';
            } else {
              interim += r[0].transcript;
            }
          }
          if (final) {
            // Append final text to accumulated transcript
            flowTranscriptRef.current += final;
            flowLastSpeechRef.current = Date.now();
          }
          if (interim) {
            flowLastSpeechRef.current = Date.now();
          }
          setLiveText(flowTranscriptRef.current + interim);
        };

        recog.onerror = (e) => {
          if (e.error === 'no-speech' || e.error === 'aborted') {
            // Browser killed recognition due to silence — this is normal, onend will restart
            return;
          }
          if (e.error === 'not-allowed') {
            setError('Microphone access denied. Please allow microphone access and try again.');
            stopFlowListening();
            setStage('idle');
          }
          if (e.error === 'network') {
            // Network issue — retry silently
            return;
          }
        };

        recog.onend = () => {
          // Browser stopped recognition — silently restart if we're still in flow-listening
          // This is NORMAL browser behavior (Chrome/Safari stop after silence)
          // The key is to restart WITHOUT any UI state changes — no setStage, no visual disruption
          if (stageRef.current === 'flow-listening') {
            flowRetryCountRef.current++;
            if (flowRetryCountRef.current > 100) {
              // Too many restarts in a row without speech — don't error, just pause gracefully
              stopFlowListening();
              setStage('listening');
              return;
            }
            // Restart silently — no UI changes, no state updates, just reconnect the mic
            const restartDelay = flowRetryCountRef.current > 10 ? 500 : 100;
            setTimeout(() => {
              if (stageRef.current === 'flow-listening') {
                try {
                  const newRecog = createRecognition();
                  newRecog.start();
                  flowRecogRef.current = newRecog;
                } catch(ex) {
                  // Browser might need more time — retry once more
                  setTimeout(() => {
                    if (stageRef.current === 'flow-listening') {
                      try {
                        const retry = createRecognition();
                        retry.start();
                        flowRecogRef.current = retry;
                      } catch(ex2) {
                        // Give up gracefully — pause to listening state
                        stopFlowListening();
                        setStage('listening');
                      }
                    }
                  }, 1000);
                }
              }
            }, restartDelay);
          }
        };

        return recog;
      };

      const recog = createRecognition();
      recog.start();
      flowRecogRef.current = recog;

      // 3-second pause with speech = AI's turn to respond
      flowSilenceTimerRef.current = setInterval(() => {
        const silenceDuration = Date.now() - flowLastSpeechRef.current;
        const currentText = flowTranscriptRef.current.trim();

        if (currentText.length > 0 && silenceDuration > 3000) {
          // User paused for 3 seconds after saying something — AI's turn
          clearInterval(flowSilenceTimerRef.current);
          flowSilenceTimerRef.current = null;
          stopFlowListening();
          processFlowTranscript(currentText);
        }
      }, 500);

      // 10s total silence (no speech detected at all) — AI checks in, conversation stays open
      const silenceCheckCountRef = { current: 0 };
      const startSilenceTimeout = () => {
        if (flowTimeoutRef.current) clearTimeout(flowTimeoutRef.current);
        flowTimeoutRef.current = setTimeout(async () => {
          if (stageRef.current !== 'flow-listening') return;
          const hasText = flowTranscriptRef.current.trim().length > 0;
          if (!hasText) {
            silenceCheckCountRef.current++;
            if (silenceCheckCountRef.current >= 3) {
              // 3 check-ins with no response — pause the conversation (not close)
              setChatHistory(prev => [...prev, { role: 'ai', text: "I'll be right here when you're ready. Just tap the mic to continue." }]);
              speakText("I'll be right here when you're ready. Just tap the mic to continue.", () => {
                stopFlowListening();
                setStage('listening'); // Paused state — user taps to resume
              });
              return;
            }
            // AI checks in but keeps listening
            const prompt = round === 0
              ? "I'm here and listening. Go ahead and tell me what you need."
              : "Hey, I'm still here. Just say something when you're ready.";
            setChatHistory(prev => [...prev, { role: 'ai', text: prompt }]);
            // Speak the check-in, then restart listening
            speakText(prompt, () => {
              if (stageRef.current === 'talking' || stageRef.current === 'flow-listening') {
                flowLastSpeechRef.current = Date.now();
                if (stageRef.current !== 'flow-listening') startFlowListening();
                else startSilenceTimeout();
              }
            });
          }
        }, 10000);
      };
      startSilenceTimeout();

      setStage('flow-listening');
    } catch(e) {
      setError('Could not start flow mode: ' + e.message);
      setVoiceMode('walkie');
    }
  };

  const stopFlowListening = () => {
    setFlowBannerPulse(false);
    if (flowRecogRef.current) {
      const recog = flowRecogRef.current;
      recog.onend = null; // Prevent restart
      recog.onerror = null;
      recog.onresult = null;
      flowRecogRef.current = null;
      try { recog.stop(); } catch(e) {}
    }
    if (flowSilenceTimerRef.current) { clearInterval(flowSilenceTimerRef.current); flowSilenceTimerRef.current = null; }
    if (flowTimeoutRef.current) { clearTimeout(flowTimeoutRef.current); flowTimeoutRef.current = null; }
  };

  // Play audio from base64 data (used by combined refine-speak endpoint)
  const playBase64Audio = (base64, mime, onDone) => {
    if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
    const byteChars = atob(base64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArray], { type: mime });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    ttsAudioRef.current = audio;
    setAiSpeaking(true);
    audio.onended = () => { setAiSpeaking(false); ttsAudioRef.current = null; URL.revokeObjectURL(url); if (onDone) onDone(); };
    audio.onerror = () => { setAiSpeaking(false); ttsAudioRef.current = null; URL.revokeObjectURL(url); if (onDone) onDone(); };
    audio.play().catch(() => { setAiSpeaking(false); if (onDone) onDone(); });
  };

  const processFlowTranscript = async (transcript) => {
    if (!transcript) { setStage('listening'); return; }
    setStage('processing');
    try {
      setChatHistory(prev => [...prev, { role: 'user', text: transcript }]);
      setLiveText('');

      const currentConv = [...conversation];
      // Use combined refine-speak endpoint — AI thinking + TTS in one round-trip (saves 2-3s)
      const refineRes = await fetch('/api/refine-speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context_type: contextType,
          raw_transcript: transcript,
          conversation: currentConv,
          round,
          team_context: teamContext || '',
          phase: 'dialogue',
          person_id: personId || '',
          task_context: taskContext || undefined,
        }),
      });
      const data = await refineRes.json();
      if (data.error) { setStage('idle'); setError(data.error); return; }

      const newConv = [...currentConv,
        { role: 'user', content: transcript },
        { role: 'assistant', content: data.spoken_response || '' },
      ];
      setConversation(newConv);
      setRound(r => r + 1);
      if (data.key_points) setKeyPoints(data.key_points);

      const aiText = data.spoken_response || '';
      setChatHistory(prev => [...prev, { role: 'ai', text: aiText }]);

      const afterSpeak = data.ready_to_finalize
        ? () => { finalizeTask(newConv); }
        : () => {
          if (voiceMode === 'flow') {
            // Small delay before restarting flow listening — lets the audio system settle
            // and prevents the mic from picking up the tail end of TTS playback
            setTimeout(() => {
              if (stageRef.current === 'talking' || stageRef.current === 'listening') {
                startFlowListening();
              }
            }, 300);
          } else {
            setStage('listening');
          }
        };

      setStage('talking');
      // If combined endpoint returned audio, play it directly (no extra TTS fetch needed)
      if (data.audio_base64) {
        playBase64Audio(data.audio_base64, data.audio_mime || 'audio/mpeg', afterSpeak);
      } else {
        // Fallback to separate TTS call
        await speakText(aiText, afterSpeak);
      }
    } catch (e) {
      console.error('Flow process error:', e);
      setStage('idle');
      setError('Something went wrong. Try again.');
    }
  };

  // Handle tap-to-stop in flow mode
  const stopFlowAndProcess = () => {
    const text = flowTranscriptRef.current.trim();
    stopFlowListening();
    if (text) {
      processFlowTranscript(text);
    } else {
      setStage('listening');
    }
  };

  const startRecording = async () => {
    try {
      setError('');
      setLiveText('');
      fullTranscriptRef.current = '';
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) {} }
        if (timerRef.current) clearInterval(timerRef.current);
        processRecording();
      };
      recorder.start(100);
      recorderRef.current = recorder;
      setRecordTime(0);
      timerRef.current = setInterval(() => setRecordTime(t => t + 1), 1000);

      // Live speech preview
      try {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
          const recog = new SpeechRecognition();
          recog.continuous = true;
          recog.interimResults = true;
          recog.lang = 'en-US';
          recog.onresult = (event) => {
            let interim = '';
            for (let i = 0; i < event.results.length; i++) {
              if (event.results[i].isFinal) {
                fullTranscriptRef.current += event.results[i][0].transcript + ' ';
              } else {
                interim += event.results[i][0].transcript;
              }
            }
            setLiveText(fullTranscriptRef.current + interim);
          };
          recog.onerror = () => {};
          recog.start();
          recognitionRef.current = recog;
        }
      } catch(e) {}

      setStage('recording');
    } catch (e) {
      if (e.name === 'NotAllowedError') setError('Microphone access denied.');
      else setError('Microphone error: ' + e.message);
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) {} }
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const processRecording = async () => {
    setStage('processing');
    try {
      const mimeType = recorderRef.current?.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (blob.size < 1000) { setStage('idle'); setError('Recording too short.'); return; }

      // ALWAYS use Whisper for accurate transcription — Web Speech API produces duplicates on mobile
      const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
      const fd = new window.FormData();
      fd.append('audio', blob, `refine_voice.${ext}`);
      const transRes = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const transData = await transRes.json();
      if (!transData.transcript) { setStage('idle'); setError('Could not transcribe audio.'); return; }
      const transcript = transData.transcript;

      // Add user message to chat
      setChatHistory(prev => [...prev, { role: 'user', text: transcript }]);

      // OPTIMIZATION: Use combined refine-speak endpoint (Claude + TTS in one round-trip)
      const currentConv = [...conversation];
      const refineRes = await fetch('/api/refine-speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context_type: contextType,
          raw_transcript: transcript,
          conversation: currentConv,
          round,
          team_context: teamContext || '',
          phase: 'dialogue',
          person_id: personId || '',
          task_context: taskContext || undefined,
        }),
      });
      const data = await refineRes.json();

      if (data.error) { setStage('idle'); setError(data.error); return; }

      // Update conversation history for API
      const newConv = [...currentConv,
        { role: 'user', content: transcript },
        { role: 'assistant', content: data.spoken_response || '' },
      ];
      setConversation(newConv);
      setRound(r => r + 1);
      if (data.key_points) setKeyPoints(data.key_points);

      // Add AI message to chat
      const aiText = data.spoken_response || '';
      setChatHistory(prev => [...prev, { role: 'ai', text: aiText }]);

      const afterSpeak = data.ready_to_finalize
        ? () => { finalizeTask(newConv); }
        : () => {
          if (voiceMode === 'flow') {
            setTimeout(() => {
              if (stageRef.current === 'talking' || stageRef.current === 'listening') {
                startFlowListening();
              }
            }, 300);
          } else {
            setStage('listening');
          }
        };

      setStage('talking');
      // Play audio directly from combined response if available
      if (data.audio_base64) {
        playBase64Audio(data.audio_base64, data.audio_mime || 'audio/mpeg', afterSpeak);
      } else {
        await speakText(aiText, afterSpeak);
      }
    } catch (e) {
      console.error('Refine process error:', e);
      setStage('idle');
      setError('Something went wrong. Try again.');
    }
  };

  const finalizeTask = async (conv) => {
    setStage('finalizing');
    try {
      const res = await fetch('/api/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context_type: contextType,
          raw_transcript: '',
          conversation: conv || conversation,
          round: round + 1,
          team_context: teamContext || '',
          phase: 'finalize',
          person_id: personId || '',
          task_context: taskContext || undefined,
        }),
      });
      const data = await res.json();

      if (data.fields) setCurrentFields(data.fields);

      const aiText = data.spoken_response || 'Here is your task. Ready to approve?';
      setChatHistory(prev => [...prev, { role: 'ai', text: aiText }]);

      setStage('review');
      speakText(aiText);
    } catch(e) {
      console.error('Finalize error:', e);
      setError('Could not finalize. Try again.');
      setStage('listening');
    }
  };

  const speakText = async (text, onDone) => {
    try {
      setAiSpeaking(true);
      if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
      let audioUrl = ttsCacheRef.current[text];
      if (!audioUrl) {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, speed: 1.15 }),
        });
        if (res.ok) {
          const blob = await res.blob();
          audioUrl = URL.createObjectURL(blob);
          ttsCacheRef.current[text] = audioUrl;
        }
      }
      if (audioUrl) {
        const audio = new Audio(audioUrl);
        ttsAudioRef.current = audio;
        audio.onended = () => { setAiSpeaking(false); ttsAudioRef.current = null; if (onDone) onDone(); };
        audio.onerror = () => { setAiSpeaking(false); ttsAudioRef.current = null; if (onDone) onDone(); };
        await audio.play();
      } else {
        setAiSpeaking(false);
        if (onDone) onDone();
      }
    } catch(e) {
      setAiSpeaking(false);
      if (onDone) onDone();
    }
  };

  const sendTextMessage = () => {
    const text = chatText.trim();
    if (!text) return;
    setChatText('');
    processFlowTranscript(text);
  };

  const handleChatPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Add photo as a user message with preview
    const reader = new FileReader();
    reader.onload = (ev) => {
      setChatHistory(prev => [...prev, { role: 'user', text: '📷 Photo attached', photo: ev.target.result }]);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const stopSpeaking = () => {
    if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
    setAiSpeaking(false);
  };

  const handleAccept = () => {
    stopSpeaking();
    AnalyticsTracker.track('refine_funnel', 'accepted', { funnel_id: funnelIdRef.current, context_type: contextType, round });
    if (currentFields) onAccept(currentFields);
  };

  const handleMakeBetter = () => {
    stopSpeaking();
    AnalyticsTracker.track('feature_use', 'make_it_better', { funnel_id: funnelIdRef.current, context_type: contextType, round });
    const prompt = "Sure thing! Tell me what you'd like to change.";
    setChatHistory(prev => [...prev, { role: 'ai', text: prompt }]);
    speakText(prompt, () => setStage('listening'));
  };

  const handleCancel = () => {
    stopSpeaking();
    AnalyticsTracker.track('refine_funnel', 'cancelled', { funnel_id: funnelIdRef.current, context_type: contextType, round });
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    onCancel();
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const priorityLabels = { low: 'Low', normal: 'Normal', high: 'High', critical: 'Critical' };
  const priorityColors = { critical: '#C45500', high: '#F99440', normal: 'var(--charcoal)', low: '#999' };

  const fieldLabels = contextType === 'daily_task'
    ? { title: 'Task', description: 'Details', assigned_to: 'Assigned To', priority: 'Priority' }
    : contextType === 'shift_update'
    ? { shift_summary: 'Summary', work_completed: 'Work Done', issues: 'Issues', hours_worked: 'Hours', tomorrow_plan: 'Tomorrow', safety_notes: 'Safety' }
    : { title: 'Issue', description: 'Details', location: 'Location', priority: 'Priority' };

  return (
    <div className="refine-panel" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'var(--bg, #f5f5f5)', zIndex: 1000,
      display: 'flex', flexDirection: 'column',
      padding: '16px', paddingTop: '60px', paddingBottom: '0',
    }}>
      {/* Close button */}
      <button onClick={handleCancel} style={{
        position: 'fixed', top: '16px', right: '16px', zIndex: 1001,
        background: 'var(--charcoal, #333)', color: 'white', border: 'none',
        borderRadius: '50%', width: '36px', height: '36px', fontSize: '18px',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>✕</button>

      {/* Title */}
      <h3 style={{textAlign: 'center', color: 'var(--charcoal, #333)', margin: '0 0 16px', fontSize: '18px', fontWeight: 700}}>
        {contextType === 'daily_task' ? 'New Task' : contextType === 'shift_update' ? 'Daily Report' : 'New Punch Item'}
      </h3>

      {error && <p style={{color: '#C45500', fontSize: '14px', textAlign: 'center', marginBottom: '12px'}}>{error}</p>}

      {/* FLOW MODE BANNER — persistent pulsing indicator */}
      {stage === 'flow-listening' && (
        <div className="flow-banner">
          <span className="flow-banner-dot" />
          Listening... tap when done
        </div>
      )}

      {/* VOICE MODE TOGGLE — hidden for now. Flow mode will be enabled when production-ready.
      {(stage === 'idle' || stage === 'listening') && (
        <div className="voice-mode-toggle">
          <button className={`voice-mode-btn ${voiceMode === 'walkie' ? 'active' : ''}`} onClick={() => { setVoiceMode('walkie'); }}>Walkie-Talkie</button>
          <button className={`voice-mode-btn ${voiceMode === 'flow' ? 'active' : ''}`} onClick={() => { setVoiceMode('flow'); }}>Flow</button>
        </div>
      )} */}

      {/* IDLE — Initial mic button */}
      {stage === 'idle' && chatHistory.length === 0 && (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', padding: '40px 0'}}>
          <p style={{color: 'var(--charcoal)', fontSize: '15px', textAlign: 'center', margin: 0}}>
            Tap the mic and describe your {contextType === 'daily_task' ? 'task' : contextType === 'shift_update' ? 'work today' : 'issue'}
          </p>
          <button onClick={voiceMode === 'flow' ? startFlowListening : startRecording} className="refine-mic-btn" style={{padding: '20px 36px', fontSize: '17px'}}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="var(--primary)" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/></svg>
            {contextType === 'daily_task' ? 'Speak your task' : contextType === 'shift_update' ? 'Tell me about your day' : 'Describe the issue'}
          </button>
        </div>
      )}

      {/* CHAT HISTORY — conversation bubbles */}
      {chatHistory.length > 0 && (
        <div className="refine-chat" style={{flex: 1, overflowY: 'auto', marginBottom: '8px'}}>
          {chatHistory.map((msg, i) => (
            <div key={i} className={`refine-bubble refine-bubble-${msg.role}`}>
              {msg.photo && (
                <img src={msg.photo} alt="Attached" style={{width: '100%', maxWidth: '200px', borderRadius: '8px', marginBottom: '6px'}} />
              )}
              <p style={{margin: 0, fontSize: '16px', lineHeight: 1.6, fontWeight: 600}}>{msg.text}</p>
              {msg.role === 'ai' && (
                <button onClick={() => {
                  if (aiSpeaking && speakingMsgIndex === i) { stopSpeaking(); setSpeakingMsgIndex(null); }
                  else { setSpeakingMsgIndex(i); speakText(msg.text, () => setSpeakingMsgIndex(null)); }
                }}
                  className={`refine-read-btn ${aiSpeaking && speakingMsgIndex === i ? 'refine-reading' : ''}`}
                  style={{marginTop: '8px', fontSize: '15px', padding: '10px 20px', fontWeight: 700}}>
                  {aiSpeaking && speakingMsgIndex === i ? '⏹ Stop' : '🔊 Listen'}
                </button>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      )}

      {/* RECORDING — walkie-talkie mode */}
      {stage === 'recording' && (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '12px 0'}}>
          <button onClick={stopRecording} className="refine-mic-btn refine-mic-recording">
            <span className="refine-pulse-dot" />
            Stop — {formatTime(recordTime)}
          </button>
          {liveText && <p className="refine-live-text">{liveText}</p>}
        </div>
      )}

      {/* FLOW-LISTENING — continuous listening mode */}
      {stage === 'flow-listening' && (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '12px 0'}}>
          <div className="flow-waveform">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
          {liveText && <p className="refine-live-text" style={{minHeight: '40px'}}>{liveText}</p>}
          {!liveText && <p style={{color: 'var(--gray-400)', fontSize: '14px', fontStyle: 'italic'}}>Speak naturally... I'm listening</p>}
          <button onClick={stopFlowAndProcess} className="btn btn-primary" style={{
            padding: '12px 28px', fontSize: '15px', fontWeight: 700, borderRadius: '12px',
            marginTop: '8px', opacity: 0.85
          }}>
            Your turn, AI
          </button>
        </div>
      )}

      {/* PROCESSING */}
      {stage === 'processing' && (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '16px 0'}}>
          <div className="spinner" />
          <p style={{color: 'var(--charcoal)', fontSize: '14px', fontWeight: 600}}>AI is thinking...</p>
        </div>
      )}

      {/* TALKING — AI is speaking, show speaker animation */}
      {stage === 'talking' && (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '16px 0'}}>
          <div className="refine-speaking-indicator">
            <span /><span /><span /><span /><span />
          </div>
          <p style={{color: 'var(--charcoal)', fontSize: '14px', fontWeight: 600}}>AI is talking...</p>
          <button onClick={() => { stopSpeaking(); setStage('listening'); }} className="refine-cancel-btn" style={{fontSize: '13px'}}>Skip</button>
        </div>
      )}

      {/* FINALIZING */}
      {stage === 'finalizing' && (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '16px 0'}}>
          <div className="spinner" />
          <p style={{color: 'var(--charcoal)', fontSize: '14px', fontWeight: 600}}>Preparing your {contextType === 'daily_task' ? 'task' : 'punch item'}...</p>
        </div>
      )}

      {/* LISTENING — WhatsApp-like input bar pinned to bottom */}
      {stage === 'listening' && (
        <div style={{flexShrink: 0, padding: '8px 0 16px', borderTop: '1px solid #e0e0e0', background: 'var(--bg, #f5f5f5)'}}>
          {/* Hidden photo input */}
          <input ref={chatPhotoRef} type="file" accept="image/*" capture="environment" style={{display: 'none'}} onChange={handleChatPhoto} />

          {/* Input bar row: camera | text input | mic button */}
          <div style={{display: 'flex', alignItems: 'flex-end', gap: '8px', marginBottom: '10px'}}>
            {/* Camera button */}
            <button onClick={() => chatPhotoRef.current?.click()} style={{
              width: '48px', height: '48px', borderRadius: '50%', border: '2px solid #ccc',
              background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--charcoal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
              </svg>
            </button>

            {/* Text input — smaller to encourage voice */}
            <div style={{flex: 1, position: 'relative'}}>
              <input
                type="text"
                value={chatText}
                onChange={e => setChatText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && chatText.trim()) sendTextMessage(); }}
                placeholder="Type a message..."
                style={{
                  width: '100%', padding: '12px 14px', border: '2px solid #e0e0e0', borderRadius: '24px',
                  fontSize: '14px', color: 'var(--charcoal)', background: 'white', boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
              {chatText.trim() && (
                <button onClick={sendTextMessage} style={{
                  position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
                  width: '32px', height: '32px', borderRadius: '50%', border: 'none',
                  background: 'var(--primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
              )}
            </div>

            {/* Mic button — big and prominent */}
            {!chatText.trim() && (
              <button onClick={voiceMode === 'flow' ? startFlowListening : startRecording} style={{
                height: '48px', borderRadius: '24px', border: 'none', background: 'var(--charcoal)',
                color: 'var(--primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                padding: '0 20px', fontWeight: 700, fontSize: '15px', flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--primary)" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/></svg>
                Tap to respond
              </button>
            )}
          </div>

          {/* Save / Cancel — small, centered */}
          <div style={{display: 'flex', gap: '10px', justifyContent: 'center'}}>
            <button onClick={() => finalizeTask()} style={{padding: '8px 24px', fontSize: '13px', fontWeight: 700, borderRadius: '20px', border: 'none', background: 'var(--primary)', color: 'var(--charcoal)', cursor: 'pointer'}}>
              Save it
            </button>
            <button onClick={handleCancel} style={{padding: '8px 24px', fontSize: '13px', fontWeight: 700, borderRadius: '20px', background: 'none', border: '1px solid #ccc', color: 'var(--charcoal)', cursor: 'pointer'}}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* REVIEW — Final task preview with approve/change */}
      {stage === 'review' && currentFields && (
        <div className="refine-preview">
          <div className="refine-fields">
            {Object.entries(fieldLabels).map(([key, label]) => {
              if (!currentFields[key] && key !== 'priority') return null;
              const raw = currentFields[key];
              const value = key === 'priority'
                ? (priorityLabels[raw] || raw)
                : Array.isArray(raw) ? raw.join(', ') : raw;
              return (
                <div key={key} className="refine-field-row">
                  <span className="refine-field-label">{label}</span>
                  <span className="refine-field-value" style={key === 'priority' ? {color: priorityColors[raw] || 'inherit', fontWeight: 700} : {}}>
                    {value || '—'}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="refine-actions">
            <button onClick={handleAccept} className="btn btn-primary refine-accept-btn">Approve</button>
            <button onClick={handleMakeBetter} className="refine-better-btn">Change Something</button>
            <button onClick={handleCancel} className="refine-cancel-btn">Cancel</button>
          </div>
        </div>
      )}

      {/* IDLE with existing chat (error recovery) */}
      {stage === 'idle' && chatHistory.length > 0 && (
        <div style={{display: 'flex', justifyContent: 'center', gap: '8px', padding: '12px 0'}}>
          <button onClick={startRecording} className="refine-mic-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--primary)" stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round"/></svg>
            Try again
          </button>
          <button onClick={handleCancel} className="refine-cancel-btn">Cancel</button>
        </div>
      )}
    </div>
  );
}
