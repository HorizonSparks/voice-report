import { useState } from 'react';
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  TextField, Select, MenuItem, Button
} from '@mui/material';

const VOLTAGE_COLORS_480 = {
  'ΦA': { color: 'Brown', hex: '#8B4513' },
  'ΦB': { color: 'Orange', hex: '#E8922A' },
  'ΦC': { color: 'Yellow', hex: '#DAA520' },
  'Neutral': { color: 'Gray', hex: '#808080' },
  'Ground': { color: 'Green', hex: '#228B22' },
};

const VOLTAGE_COLORS_208 = {
  'ΦA': { color: 'Black', hex: '#222222' },
  'ΦB': { color: 'Red', hex: '#CC3333' },
  'ΦC': { color: 'Blue', hex: '#3366CC' },
  'Neutral': { color: 'White', hex: '#EEEEEE' },
  'Ground': { color: 'Green', hex: '#228B22' },
};

const COLOR_OPTIONS = [
  'Brown', 'Orange', 'Yellow', 'Black', 'Red', 'Blue',
  'Gray', 'White', 'Green', 'Green/Yellow', 'Bare', 'Other'
];

export default function MeggerTable({ rows, onChange, disabled }) {
  const [unit, setUnit] = useState('MΩ');
  const [voltageSystem, setVoltageSystem] = useState('480V');

  const update = (idx, field, value) => {
    if (disabled) return;
    const next = [...rows];
    next[idx] = { ...next[idx], [field]: value };
    onChange(next);
  };

  const colorMap = voltageSystem === '480V' ? VOLTAGE_COLORS_480 : VOLTAGE_COLORS_208;

  const applyStandardColors = () => {
    if (disabled) return;
    const next = [...rows];
    const conductors = [
      { idx: 10, label: 'ΦA' },
      { idx: 11, label: 'ΦB' },
      { idx: 12, label: 'ΦC' },
      { idx: 13, label: 'Ground' },
      { idx: 14, label: 'Neutral' },
    ];
    conductors.forEach(c => {
      next[c.idx] = { ...next[c.idx], color: colorMap[c.label]?.color || '' };
    });
    onChange(next);
  };

  const meggerTests = [
    { section: 'Phase to Phase', items: [
      { key: 'ph_a_b', label: 'ΦA to ΦB', idx: 0 },
      { key: 'ph_b_c', label: 'ΦB to ΦC', idx: 1 },
      { key: 'ph_c_a', label: 'ΦC to ΦA', idx: 2 },
    ]},
    { section: 'Phase to Ground', items: [
      { key: 'ph_a_gnd', label: 'ΦA to Gnd', idx: 3 },
      { key: 'ph_b_gnd', label: 'ΦB to Gnd', idx: 4 },
      { key: 'ph_c_gnd', label: 'ΦC to Gnd', idx: 5 },
    ]},
    { section: 'Phase to Neutral', items: [
      { key: 'ph_a_neut', label: 'ΦA to Neut', idx: 6 },
      { key: 'ph_b_neut', label: 'ΦB to Neut', idx: 7 },
      { key: 'ph_c_neut', label: 'ΦC to Neut', idx: 8 },
    ]},
    { section: 'Neutral to Ground', items: [
      { key: 'neut_gnd', label: 'Neut to Gnd', idx: 9 },
    ]},
  ];

  const conductors = [
    { key: 'cont_a', label: 'ΦA', idx: 10 },
    { key: 'cont_b', label: 'ΦB', idx: 11 },
    { key: 'cont_c', label: 'ΦC', idx: 12 },
    { key: 'cont_gnd', label: 'Ground', idx: 13 },
    { key: 'cont_neut', label: 'Neutral', idx: 14 },
  ];

  return (
    <Box className="cal-table-wrapper" sx={{ overflowX: 'auto' }}>
      {/* Unit selector */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 1.75, alignItems: 'center', flexWrap: 'wrap', p: 1.5, bgcolor: 'grey.100', borderRadius: 2, border: '1px solid', borderColor: 'grey.200' }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'text.secondary' }}>📏 Reading Unit:</Typography>
        <Select value={unit} onChange={e => setUnit(e.target.value)} disabled={disabled} size="small"
          sx={{ fontWeight: 700, fontSize: 15, borderColor: 'primary.main', minWidth: 180 }}>
          <MenuItem value="MΩ">Megaohms (MΩ)</MenuItem>
          <MenuItem value="GΩ">Gigaohms (GΩ)</MenuItem>
        </Select>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', fontStyle: 'italic' }}>
          {unit === 'MΩ' ? 'Typical: 100-5,000+ MΩ for new cable' : 'Typical: 0.1-5+ GΩ for new cable'}
        </Typography>
      </Box>

      {/* Megger readings table */}
      <Table size="small" className="cal-table megger-table" sx={{ '& td, & th': { borderColor: 'grey.200' } }}>
        <TableHead>
          <TableRow sx={{ bgcolor: 'grey.100' }}>
            <TableCell sx={{ fontWeight: 700, fontSize: 12, minWidth: 130 }}>Test</TableCell>
            <TableCell sx={{ fontWeight: 700, fontSize: 12, minWidth: 120 }}>Reading ({unit})</TableCell>
            <TableCell sx={{ fontWeight: 700, fontSize: 12, minWidth: 90 }}>Pass/Fail</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {meggerTests.map(section => [
            <TableRow key={`hdr-${section.section}`}>
              <TableCell colSpan={3} sx={{ fontWeight: 700, bgcolor: '#f5f0eb', color: 'primary.main', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, py: 0.75 }}>
                {section.section}
              </TableCell>
            </TableRow>,
            ...section.items.map(item => (
              <TableRow key={item.key}>
                <TableCell sx={{ fontWeight: 600, fontSize: 14 }}>{item.label}</TableCell>
                <TableCell>
                  <TextField type="number" size="small"
                    slotProps={{ htmlInput: { step: unit === 'GΩ' ? '0.1' : '1', min: '0', readOnly: disabled, style: { textAlign: 'center', fontSize: 14 } } }}
                    value={rows[item.idx]?.megger || ''} onChange={e => update(item.idx, 'megger', e.target.value)}
                    placeholder="—" sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1.5 } }} />
                </TableCell>
                <TableCell>
                  <Select value={rows[item.idx]?.result || ''} onChange={e => update(item.idx, 'result', e.target.value)}
                    disabled={disabled} size="small" displayEmpty sx={{ fontSize: 14, minWidth: 80 }}>
                    <MenuItem value="">—</MenuItem>
                    <MenuItem value="Pass">Pass</MenuItem>
                    <MenuItem value="Fail">Fail</MenuItem>
                  </Select>
                </TableCell>
              </TableRow>
            )),
          ])}
        </TableBody>
      </Table>

      {/* Continuity and Conductor Color table */}
      <Box sx={{ display: 'flex', gap: 1.5, mt: 2, mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.primary' }}>Voltage System:</Typography>
        <Select value={voltageSystem} onChange={e => setVoltageSystem(e.target.value)} disabled={disabled} size="small" sx={{ fontSize: 14, minWidth: 240 }}>
          <MenuItem value="480V">480Y/277V (Brown/Orange/Yellow)</MenuItem>
          <MenuItem value="208V">208Y/120V (Black/Red/Blue)</MenuItem>
        </Select>
        <Button variant="outlined" size="small" onClick={applyStandardColors} disabled={disabled}
          sx={{ fontSize: 13, fontWeight: 600, borderColor: 'primary.main', color: 'primary.main' }}>
          Apply Standard Colors
        </Button>
      </Box>

      <Table size="small" className="cal-table megger-table" sx={{ '& td, & th': { borderColor: 'grey.200' } }}>
        <TableHead>
          <TableRow sx={{ bgcolor: 'grey.100' }}>
            <TableCell sx={{ fontWeight: 700, fontSize: 12, minWidth: 130 }}>Conductor</TableCell>
            <TableCell sx={{ fontWeight: 700, fontSize: 12, minWidth: 90 }}>Continuity</TableCell>
            <TableCell sx={{ fontWeight: 700, fontSize: 12, minWidth: 140 }}>Color</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {conductors.map(item => {
            const stdColor = colorMap[item.label];
            const currentColor = rows[item.idx]?.color || '';
            const isOther = currentColor && !COLOR_OPTIONS.slice(0, -1).includes(currentColor);

            return (
              <TableRow key={item.key}>
                <TableCell sx={{ fontWeight: 600, fontSize: 14 }}>
                  {stdColor && (
                    <Box component="span" sx={{
                      display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
                      bgcolor: stdColor.hex, border: '1px solid #ccc', mr: 1, verticalAlign: 'middle',
                    }} />
                  )}
                  {item.label}
                </TableCell>
                <TableCell>
                  <Select value={rows[item.idx]?.continuity || ''} onChange={e => update(item.idx, 'continuity', e.target.value)}
                    disabled={disabled} size="small" displayEmpty sx={{ fontSize: 14, minWidth: 80 }}>
                    <MenuItem value="">—</MenuItem>
                    <MenuItem value="Pass">Pass</MenuItem>
                    <MenuItem value="Fail">Fail</MenuItem>
                  </Select>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                    <Select value={isOther ? 'Other' : currentColor}
                      onChange={e => { update(item.idx, 'color', e.target.value === 'Other' ? '' : e.target.value); }}
                      disabled={disabled} size="small" displayEmpty sx={{ fontSize: 14, flex: 1 }}>
                      <MenuItem value="">— Select —</MenuItem>
                      {COLOR_OPTIONS.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                    </Select>
                    {(isOther || currentColor === '') && rows[item.idx]?.color !== '' && (
                      <TextField size="small" value={currentColor} onChange={e => update(item.idx, 'color', e.target.value)}
                        placeholder="Type color..." slotProps={{ htmlInput: { readOnly: disabled } }}
                        sx={{ flex: 1, '& .MuiOutlinedInput-root': { borderRadius: 1.5 } }} />
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
