import { useRef, useState, useEffect } from 'react';
import { Box, Typography, Button } from '@mui/material';

export default function SignaturePad({ label, value, onChange }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight || 120;
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    if (value && value.startsWith('data:')) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = value;
      setHasContent(true);
    }
  }, []);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    setDrawing(true);
    setHasContent(true);
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const move = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const end = () => {
    setDrawing(false);
    if (canvasRef.current) {
      onChange(canvasRef.current.toDataURL('image/png'));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasContent(false);
    onChange('');
  };

  return (
    <Box className="signature-pad" sx={{ mb: 2 }}>
      <Typography className="field-label" sx={{ fontSize: 13, fontWeight: 600, color: 'text.primary', mb: 0.75 }}>{label}</Typography>
      <Box sx={{ position: 'relative', border: '2px solid', borderColor: 'grey.300', borderRadius: 2, overflow: 'hidden', mb: 1 }}>
        <canvas
          ref={canvasRef}
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
          style={{ display: 'block', width: '100%', height: 120, cursor: 'crosshair' }}
        />
        {!hasContent && (
          <Typography sx={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            color: 'text.secondary', fontSize: 14, pointerEvents: 'none',
          }}>
            Sign here
          </Typography>
        )}
      </Box>
      <Button variant="outlined" size="small" onClick={clear} color="secondary" sx={{ fontSize: 12, fontWeight: 600 }}>
        Clear Signature
      </Button>
    </Box>
  );
}
