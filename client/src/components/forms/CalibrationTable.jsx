import { Table, TableHead, TableBody, TableRow, TableCell, TextField, Box } from '@mui/material';

export default function CalibrationTable({ points, onChange, disabled }) {
  const update = (idx, field, value) => {
    if (disabled) return;
    const next = [...points];
    next[idx] = { ...next[idx], [field]: value };
    onChange(next);
  };

  const rowLabels = ['Input', 'As Found Output', 'Calibrated Output', 'DCS Reading'];
  const fields = ['input_value', 'as_found_output', 'calibrated_output', 'dcs_reading'];

  return (
    <Box className="cal-table-wrapper" sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ '& td, & th': { borderColor: 'grey.200' } }}>
        <TableHead>
          <TableRow sx={{ bgcolor: 'grey.100' }}>
            <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>% of Range</TableCell>
            {['0', '25', '50', '75', '100'].map(v => (
              <TableCell key={v} align="center" sx={{ fontWeight: 700, fontSize: 12 }}>{v}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rowLabels.map((label, ri) => (
            <TableRow key={label}>
              <TableCell sx={{ fontWeight: 600, fontSize: 13, color: 'text.primary' }}>{label}</TableCell>
              {points.map((p, i) => (
                <TableCell key={i} align="center">
                  <TextField
                    type="number"
                    size="small"
                    slotProps={{ htmlInput: { step: 'any', readOnly: disabled, style: { textAlign: 'center', fontSize: 14, padding: '6px 8px' } } }}
                    value={p[fields[ri]]}
                    onChange={e => update(i, fields[ri], e.target.value)}
                    placeholder="—"
                    variant="outlined"
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1.5 } }}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
