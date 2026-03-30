import { useState } from 'react';

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

  const sectionHeaderStyle = {
    fontWeight: 700, background: '#f5f0eb', color: '#e8922a',
    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', padding: '6px 8px'
  };

  const inputStyle = { fontSize: '16px', padding: '8px 10px', width: '100%', minWidth: '80px', textAlign: 'center' };

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
    <div className="cal-table-wrapper">
      {/* Unit selector — prominent, matching voltage selector style */}
      <div style={{
        display: 'flex', gap: '12px', marginBottom: '14px', alignItems: 'center', flexWrap: 'wrap',
        padding: '10px 14px', background: '#f9f7f5', borderRadius: '8px', border: '1px solid #e0dbd5'
      }}>
        <label style={{fontSize: '14px', fontWeight: 700, color: '#555'}}>📏 Reading Unit:</label>
        <select
          value={unit}
          onChange={e => setUnit(e.target.value)}
          disabled={disabled}
          style={{
            padding: '8px 14px', borderRadius: '6px', border: '2px solid #e8922a',
            fontSize: '15px', fontWeight: 700, color: '#2d2d2d', background: '#fff',
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        >
          <option value="MΩ">Megaohms (MΩ)</option>
          <option value="GΩ">Gigaohms (GΩ)</option>
        </select>
        <span style={{fontSize: '12px', color: 'var(--charcoal)', fontStyle: 'italic'}}>
          {unit === 'MΩ' ? 'Typical: 100-5,000+ MΩ for new cable' : 'Typical: 0.1-5+ GΩ for new cable'}
        </span>
      </div>

      {/* Megger readings table */}
      <table className="cal-table megger-table">
        <thead>
          <tr>
            <th style={{minWidth: '130px'}}>Test</th>
            <th style={{minWidth: '120px'}}>Reading ({unit})</th>
            <th style={{minWidth: '90px'}}>Pass/Fail</th>
          </tr>
        </thead>
        <tbody>
          {meggerTests.map(section => (
            <>
              <tr key={`hdr-${section.section}`} className="megger-section-header">
                <td colSpan={3} style={sectionHeaderStyle}>{section.section}</td>
              </tr>
              {section.items.map(item => (
                <tr key={item.key}>
                  <td className="row-label" style={{fontWeight: 600, fontSize: '14px'}}>{item.label}</td>
                  <td>
                    <input
                      type="number"
                      step={unit === 'GΩ' ? '0.1' : '1'}
                      min="0"
                      value={rows[item.idx]?.megger || ''}
                      onChange={e => update(item.idx, 'megger', e.target.value)}
                      placeholder="—"
                      readOnly={disabled}
                      className={disabled ? 'readonly' : ''}
                      style={inputStyle}
                    />
                  </td>
                  <td>
                    <select
                      value={rows[item.idx]?.result || ''}
                      onChange={e => update(item.idx, 'result', e.target.value)}
                      disabled={disabled}
                      style={{padding: '8px', fontSize: '14px', width: '100%'}}
                    >
                      <option value="">—</option>
                      <option value="Pass">Pass</option>
                      <option value="Fail">Fail</option>
                    </select>
                  </td>
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>

      {/* Continuity and Conductor Color table */}
      <div style={{display: 'flex', gap: '12px', marginTop: '16px', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap'}}>
        <label style={{fontSize: '13px', fontWeight: 600, color: 'var(--charcoal)'}}>Voltage System:</label>
        <select
          value={voltageSystem}
          onChange={e => setVoltageSystem(e.target.value)}
          disabled={disabled}
          style={{padding: '6px 12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px'}}
        >
          <option value="480V">480Y/277V (Brown/Orange/Yellow)</option>
          <option value="208V">208Y/120V (Black/Red/Blue)</option>
        </select>
        <button
          type="button"
          onClick={applyStandardColors}
          disabled={disabled}
          style={{
            padding: '6px 14px', borderRadius: '6px', border: '1px solid #e8922a',
            background: 'transparent', color: '#e8922a', fontSize: '13px', fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1
          }}
        >
          Apply Standard Colors
        </button>
      </div>

      <table className="cal-table megger-table">
        <thead>
          <tr>
            <th style={{minWidth: '130px'}}>Conductor</th>
            <th style={{minWidth: '90px'}}>Continuity</th>
            <th style={{minWidth: '140px'}}>Color</th>
          </tr>
        </thead>
        <tbody>
          {conductors.map(item => {
            const stdColor = colorMap[item.label];
            const currentColor = rows[item.idx]?.color || '';
            const isOther = currentColor && !COLOR_OPTIONS.slice(0, -1).includes(currentColor);

            return (
              <tr key={item.key}>
                <td className="row-label" style={{fontWeight: 600, fontSize: '14px'}}>
                  {stdColor && (
                    <span style={{
                      display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%',
                      background: stdColor.hex, border: '1px solid #ccc', marginRight: '8px', verticalAlign: 'middle'
                    }} />
                  )}
                  {item.label}
                </td>
                <td>
                  <select
                    value={rows[item.idx]?.continuity || ''}
                    onChange={e => update(item.idx, 'continuity', e.target.value)}
                    disabled={disabled}
                    style={{padding: '8px', fontSize: '14px', width: '100%'}}
                  >
                    <option value="">—</option>
                    <option value="Pass">Pass</option>
                    <option value="Fail">Fail</option>
                  </select>
                </td>
                <td>
                  <div style={{display: 'flex', gap: '6px', alignItems: 'center'}}>
                    <select
                      value={isOther ? 'Other' : currentColor}
                      onChange={e => {
                        if (e.target.value === 'Other') {
                          update(item.idx, 'color', '');
                        } else {
                          update(item.idx, 'color', e.target.value);
                        }
                      }}
                      disabled={disabled}
                      style={{padding: '8px', fontSize: '14px', flex: 1}}
                    >
                      <option value="">— Select —</option>
                      {COLOR_OPTIONS.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    {(isOther || currentColor === '') && rows[item.idx]?.color !== '' && (
                      <input
                        type="text"
                        value={currentColor}
                        onChange={e => update(item.idx, 'color', e.target.value)}
                        placeholder="Type color..."
                        readOnly={disabled}
                        className={disabled ? 'readonly' : ''}
                        style={{...inputStyle, textAlign: 'left', flex: 1}}
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
