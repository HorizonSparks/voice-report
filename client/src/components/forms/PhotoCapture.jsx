import { useRef, useState } from 'react';
import { Box, Typography, Button, IconButton, Dialog } from '@mui/material';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import CloseIcon from '@mui/icons-material/Close';

export default function PhotoCapture({ photos = [], onChange, disabled }) {
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const [viewingIdx, setViewingIdx] = useState(null);

  const handleCapture = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxW = 1200;
          const maxH = 1200;
          let w = img.width;
          let h = img.height;
          if (w > maxW) { h = h * maxW / w; w = maxW; }
          if (h > maxH) { w = w * maxH / h; h = maxH; }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          onChange([...photos, dataUrl]);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  };

  const removePhoto = (idx) => {
    const updated = photos.filter((_, i) => i !== idx);
    onChange(updated);
    if (viewingIdx === idx) setViewingIdx(null);
  };

  return (
    <Box className="photo-capture">
      {/* Hidden file inputs */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleCapture} style={{ display: 'none' }} />
      <input ref={galleryRef} type="file" accept="image/*" multiple onChange={handleCapture} style={{ display: 'none' }} />

      {/* Photo box */}
      <Box sx={{
        border: '2px dashed', borderColor: 'grey.300', borderRadius: 3,
        p: 2, mb: 1.5, minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {photos.length === 0 ? (
          <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
            <CameraAltIcon sx={{ fontSize: 40, opacity: 0.4, mb: 1 }} />
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Tap below to add photo evidence</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {photos.map((src, i) => (
              <Box key={i} sx={{ position: 'relative', width: 80, height: 80 }}>
                <img src={src} alt={`Photo ${i + 1}`}
                  onClick={() => setViewingIdx(viewingIdx === i ? null : i)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, cursor: 'pointer' }} />
                {!disabled && (
                  <IconButton size="small" onClick={() => removePhoto(i)}
                    sx={{ position: 'absolute', top: -6, right: -6, bgcolor: 'error.main', color: 'white', width: 20, height: 20,
                      '&:hover': { bgcolor: 'error.dark' } }}>
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                )}
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Action buttons */}
      {!disabled && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<CameraAltIcon />} onClick={() => cameraRef.current?.click()}
            sx={{ flex: 1, borderRadius: 2, fontWeight: 600, fontSize: 13 }}>
            Camera
          </Button>
          <Button variant="outlined" startIcon={<PhotoLibraryIcon />} onClick={() => galleryRef.current?.click()}
            sx={{ flex: 1, borderRadius: 2, fontWeight: 600, fontSize: 13 }}>
            Gallery
          </Button>
        </Box>
      )}

      {/* Full-size viewer */}
      <Dialog open={viewingIdx !== null && !!photos[viewingIdx]} onClose={() => setViewingIdx(null)} maxWidth="md">
        {viewingIdx !== null && photos[viewingIdx] && (
          <Box onClick={() => setViewingIdx(null)} sx={{ p: 1, cursor: 'pointer' }}>
            <img src={photos[viewingIdx]} alt="Full size" style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
            <Typography sx={{ textAlign: 'center', mt: 1, fontSize: 12, color: 'text.secondary' }}>Tap to close</Typography>
          </Box>
        )}
      </Dialog>
    </Box>
  );
}
