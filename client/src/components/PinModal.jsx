import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Typography, Alert } from '@mui/material';

export default function PinModal({ visible, companyName, onSubmit, onCancel, error }) {
  const [pin, setPin] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (visible) {
      setPin('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (pin.length >= 4) onSubmit(pin);
  };

  return (
    <Dialog open={visible} onClose={onCancel}
      slotProps={{ paper: { sx: { borderRadius: 4, maxWidth: 380, width: '100%' } } }}>
      <form onSubmit={handleSubmit}>
        <DialogTitle sx={{ fontWeight: 800, fontSize: 18, color: 'text.primary', pb: 0 }}>
          Enable Edit Mode
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2.5, color: 'text.secondary', fontSize: 13, lineHeight: 1.5 }}>
            You are about to enable editing for <strong>{companyName}</strong>. All changes will be logged under your operator account.
          </Typography>
          <TextField
            inputRef={inputRef}
            type="password"
            fullWidth
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="Enter your PIN"
            error={!!error}
            slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*' } }}
            sx={{
              '& .MuiOutlinedInput-root': {
                fontSize: 18, fontWeight: 700, textAlign: 'center', letterSpacing: 8,
                borderRadius: 3,
              },
              '& input': { textAlign: 'center' },
            }}
          />
          {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1.25 }}>
          <Button variant="outlined" color="secondary" onClick={onCancel} fullWidth sx={{ borderRadius: 3, py: 1.5, fontWeight: 700, fontSize: 14 }}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" color="error" disabled={pin.length < 4} fullWidth sx={{ borderRadius: 3, py: 1.5, fontWeight: 700, fontSize: 14 }}>
            Enable Editing
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
