import { useState, useRef } from 'react';

export default function VoiceMessagePlayer({ src, isMine }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = (e) => {
    e.stopPropagation();
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  const onTimeUpdate = () => {
    if (audioRef.current && audioRef.current.duration) {
      setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
    }
  };

  const onLoadedMetadata = () => {
    if (audioRef.current) setDuration(Math.round(audioRef.current.duration));
  };

  const onEnded = () => { setPlaying(false); setProgress(0); };

  const seekTo = (e) => {
    e.stopPropagation();
    if (!audioRef.current || !audioRef.current.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = pct * audioRef.current.duration;
    setProgress(pct * 100);
  };

  const formatDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{display: 'flex', alignItems: 'center', gap: '10px', minWidth: '200px', padding: '4px 0'}}>
      <audio ref={audioRef} src={src} preload="metadata" onTimeUpdate={onTimeUpdate} onLoadedMetadata={onLoadedMetadata} onEnded={onEnded} />
      <button onClick={toggle} style={{
        width: '36px', height: '36px', borderRadius: '50%', border: 'none',
        background: isMine ? 'rgba(0,0,0,0.15)' : 'var(--primary)',
        color: isMine ? 'white' : 'var(--charcoal)', fontSize: '14px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{playing ? '\u23F8' : '\u25B6'}</button>
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: '4px'}}>
        <div onClick={seekTo} style={{height: '4px', background: 'rgba(0,0,0,0.15)', borderRadius: '2px', cursor: 'pointer', position: 'relative'}}>
          <div style={{height: '100%', width: progress + '%', background: isMine ? 'var(--charcoal)' : 'var(--primary)', borderRadius: '2px', transition: 'width 0.1s'}} />
        </div>
        <span style={{fontSize: '11px', color: isMine ? 'rgba(0,0,0,0.5)' : 'var(--gray-500)'}}>{duration > 0 ? formatDur(duration) : '0:00'}</span>
      </div>
      <svg width="18" height="18" viewBox="0 0 24 24" fill={isMine ? 'rgba(0,0,0,0.4)' : 'var(--gray-500)'} stroke="none"><path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke={isMine ? 'rgba(0,0,0,0.4)' : 'var(--gray-500)'} strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="19" x2="12" y2="23" stroke={isMine ? 'rgba(0,0,0,0.4)' : 'var(--gray-500)'} strokeWidth="2" strokeLinecap="round"/></svg>
    </div>
  );
}
