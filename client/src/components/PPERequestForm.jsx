import { useState } from 'react';
import { Box, Typography, Button, TextField, Chip, Stack, Dialog, DialogContent, DialogActions } from '@mui/material';
import VoiceInput from './VoiceInput.jsx';

/**
 * PPERequestForm — request safety equipment.
 *
 * Posts to POST /api/ppe (real DB-backed route, not the legacy /api/forms
 * JSON-file path used by SafetyObservationForm). The Sparks safety queue
 * picks up new requests via GET /api/ppe.
 *
 * Common items are clickable chips that append to the items textarea so
 * non-typers can compose a request fast; the textarea stays the source of
 * truth so anything typed (or dictated via VoiceInput) is preserved.
 */
const COMMON_ITEMS = [
  'Hard hat',
  'Safety glasses',
  'Work gloves',
  'Cut-resistant gloves',
  'Steel-toe boots (size __)',
  'Hi-vis vest',
  'Hearing protection',
  'Respirator (N95)',
  'Face shield',
  'Arc-flash suit',
  'Fall harness',
  'Knee pads',
];

export default function PPERequestForm({ user, onBack, onSaved }) {
  const [items, setItems] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [dialogMsg, setDialogMsg] = useState(null);

  const appendItem = (item) => {
    setItems(prev => {
      const trimmed = prev.trim();
      if (!trimmed) return item;
      // Avoid duplicates if user double-taps
      if (trimmed.split(/\n|,/).map(s => s.trim()).includes(item)) return prev;
      return trimmed + (trimmed.endsWith(',') ? ' ' : '\n') + item;
    });
  };

  const handleSave = async () => {
    if (!items.trim()) {
      setDialogMsg('Please list at least one item to request.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ppe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.trim(), notes: notes.trim() || null }),
      });
      if (res.ok) {
        const result = await res.json();
        onSaved(result.id);
      } else {
        const err = await res.json().catch(() => ({}));
        setDialogMsg('Failed to submit: ' + (err.error || res.status));
      }
    } catch (e) {
      setDialogMsg('Error: ' + e.message);
    }
    setSaving(false);
  };

  return (
    <Box className="form-fill-view">
      <Button className="office-back" onClick={onBack}>← Back</Button>

      <Typography variant="h2" sx={{ fontWeight: 800, color: 'text.primary', mt: 2, mb: 1 }}>
        🥽 Request PPE
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: 13, mb: 2 }}>
        Tap a common item to add it, type your own, or use the mic.
      </Typography>

      {/* Common-items chip rail */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mb: 2 }}>
        {COMMON_ITEMS.map(item => (
          <Chip
            key={item}
            label={item}
            onClick={() => appendItem(item)}
            sx={{
              fontWeight: 600,
              cursor: 'pointer',
              '@media (pointer: coarse)': { minHeight: 36, fontSize: 13 },
            }}
          />
        ))}
      </Stack>

      {/* Items textarea — source of truth */}
      <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5, color: 'text.primary' }}>
        Items requested *
      </Typography>
      <VoiceInput
        value={items}
        onChange={setItems}
        placeholder="e.g. size 10 steel-toe boots, new hardhat (mine cracked), 2x cut-resistant gloves..."
        rows={4}
      />

      {/* Notes */}
      <Typography sx={{ fontWeight: 700, fontSize: 13, mt: 2, mb: 0.5, color: 'text.primary' }}>
        Notes (optional)
      </Typography>
      <TextField
        fullWidth
        multiline
        rows={3}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Where to deliver, urgency, replacement vs new, etc."
        sx={{
          '& .MuiOutlinedInput-root': {
            '@media (pointer: coarse)': { minHeight: 44 },
          },
        }}
      />

      {/* Submit */}
      <Box sx={{ mt: 3, display: 'flex', gap: 1 }}>
        <Button
          className="btn-primary"
          variant="contained"
          onClick={handleSave}
          disabled={saving || !items.trim()}
          sx={{ minHeight: 44, fontWeight: 700 }}
        >
          {saving ? 'Submitting...' : 'Submit Request'}
        </Button>
        <Button onClick={onBack} sx={{ minHeight: 44 }}>Cancel</Button>
      </Box>

      {/* Error dialog */}
      <Dialog open={!!dialogMsg} onClose={() => setDialogMsg(null)}>
        <DialogContent>
          <Typography>{dialogMsg}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogMsg(null)}>OK</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
