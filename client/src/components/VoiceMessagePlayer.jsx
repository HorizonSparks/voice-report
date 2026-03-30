import { useState, useRef } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import MicIcon from '@mui/icons-material/Mic';

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
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 200, py: 0.5 }}>
      <audio ref={audioRef} src={src} preload="metadata" onTimeUpdate={onTimeUpdate} onLoadedMetadata={onLoadedMetadata} onEnded={onEnded} />
      <IconButton onClick={toggle} size="small" sx={{
        width: 36, height: 36,
        bgcolor: isMine ? 'rgba(0,0,0,0.15)' : 'primary.main',
        color: isMine ? 'white' : 'secondary.main',
        '&:hover': { bgcolor: isMine ? 'rgba(0,0,0,0.25)' : 'primary.dark' },
      }}>
        {playing ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
      </IconButton>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box onClick={seekTo} sx={{ height: 4, bgcolor: 'rgba(0,0,0,0.15)', borderRadius: 1, cursor: 'pointer', position: 'relative' }}>
          <Box sx={{ height: '100%', width: progress + '%', bgcolor: isMine ? 'secondary.main' : 'primary.main', borderRadius: 1, transition: 'width 0.1s' }} />
        </Box>
        <Typography sx={{ fontSize: 11, color: isMine ? 'rgba(0,0,0,0.5)' : 'text.secondary' }}>
          {duration > 0 ? formatDur(duration) : '0:00'}
        </Typography>
      </Box>
      <MicIcon sx={{ fontSize: 18, color: isMine ? 'rgba(0,0,0,0.4)' : 'text.secondary' }} />
    </Box>
  );
}
