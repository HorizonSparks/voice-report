import { Box, Typography, ToggleButton, ToggleButtonGroup } from '@mui/material';

export default function ChecklistGroup({ label, value, onChange }) {
  return (
    <Box className="checklist-group" sx={{ mb: 2 }}>
      <Typography className="field-label" sx={{ fontSize: 13, fontWeight: 600, color: 'text.primary', mb: 0.75 }}>{label}</Typography>
      <ToggleButtonGroup value={value} exclusive onChange={(_e, val) => { if (val !== null) onChange(val); }} size="small">
        <ToggleButton value="Yes" sx={{ px: 3, fontWeight: 700, color: value === 'Yes' ? 'success.main' : 'text.secondary',
          '&.Mui-selected': { bgcolor: 'success.light', color: 'success.main', borderColor: 'success.main' } }}>
          Yes
        </ToggleButton>
        <ToggleButton value="No" sx={{ px: 3, fontWeight: 700, color: value === 'No' ? 'error.main' : 'text.secondary',
          '&.Mui-selected': { bgcolor: 'error.light', color: 'error.main', borderColor: 'error.main' } }}>
          No
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}
