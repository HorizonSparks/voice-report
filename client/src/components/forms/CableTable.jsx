import { Table, TableHead, TableBody, TableRow, TableCell, TextField, Button, Box, ToggleButton, ToggleButtonGroup } from '@mui/material';

export default function CableTable({ rows, onChange, disabled }) {
  const update = (idx, field, value) => {
    if (disabled) return;
    const next = [...rows];
    next[idx] = { ...next[idx], [field]: value };
    onChange(next);
  };

  const addRow = () => {
    if (disabled) return;
    onChange([...rows, { tag_number: '', color_code: '', continuity: '', cable_landed: '' }]);
  };

  const YnaButtons = ({ idx, field, value }) => (
    <ToggleButtonGroup value={value} exclusive size="small"
      onChange={(_e, val) => { if (val !== null && !disabled) update(idx, field, val); }}>
      {['Y', 'N', 'N/A'].map(opt => (
        <ToggleButton key={opt} value={opt} disabled={disabled} sx={{ px: 1.5, py: 0.5, fontSize: 12, fontWeight: 700 }}>
          {opt}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );

  return (
    <Box className="cable-table-wrapper" sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ '& td, & th': { borderColor: 'grey.200' } }}>
        <TableHead>
          <TableRow sx={{ bgcolor: 'grey.100' }}>
            <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 40 }}>#</TableCell>
            <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Tag Number</TableCell>
            <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Color Code / Number</TableCell>
            <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Continuity Check</TableCell>
            <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Correct Cable Pulled & Landed</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              <TableCell sx={{ fontWeight: 600, fontSize: 13, color: 'text.secondary' }}>{i + 1}</TableCell>
              <TableCell>
                <TextField size="small" value={row.tag_number} onChange={e => update(i, 'tag_number', e.target.value)}
                  placeholder="Tag #" slotProps={{ htmlInput: { readOnly: disabled } }}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1.5 } }} />
              </TableCell>
              <TableCell>
                <TextField size="small" value={row.color_code} onChange={e => update(i, 'color_code', e.target.value)}
                  placeholder="Color/No." slotProps={{ htmlInput: { readOnly: disabled } }}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1.5 } }} />
              </TableCell>
              <TableCell><YnaButtons idx={i} field="continuity" value={row.continuity} /></TableCell>
              <TableCell><YnaButtons idx={i} field="cable_landed" value={row.cable_landed} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!disabled && (
        <Button variant="outlined" size="small" onClick={addRow} sx={{ mt: 1.5, fontSize: 12, fontWeight: 600 }}>
          + Add Row
        </Button>
      )}
    </Box>
  );
}
