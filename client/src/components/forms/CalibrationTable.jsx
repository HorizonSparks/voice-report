export default function CalibrationTable({ points, onChange, disabled }) {
  const update = (idx, field, value) => {
    if (disabled) return;
    const next = [...points];
    next[idx] = { ...next[idx], [field]: value };
    onChange(next);
  };

  return (
    <div className="cal-table-wrapper">
      <table className="cal-table">
        <thead>
          <tr>
            <th>% of Range</th>
            <th>0</th>
            <th>25</th>
            <th>50</th>
            <th>75</th>
            <th>100</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="row-label">Input</td>
            {points.map((p, i) => (
              <td key={i}>
                <input
                  type="number"
                  step="any"
                  value={p.input_value}
                  onChange={e => update(i, 'input_value', e.target.value)}
                  placeholder="—"
                  readOnly={disabled}
                  className={disabled ? 'readonly' : ''}
                />
              </td>
            ))}
          </tr>
          <tr>
            <td className="row-label">As Found Output</td>
            {points.map((p, i) => (
              <td key={i}>
                <input
                  type="number"
                  step="any"
                  value={p.as_found_output}
                  onChange={e => update(i, 'as_found_output', e.target.value)}
                  placeholder="—"
                  readOnly={disabled}
                  className={disabled ? 'readonly' : ''}
                />
              </td>
            ))}
          </tr>
          <tr>
            <td className="row-label">Calibrated Output</td>
            {points.map((p, i) => (
              <td key={i}>
                <input
                  type="number"
                  step="any"
                  value={p.calibrated_output}
                  onChange={e => update(i, 'calibrated_output', e.target.value)}
                  placeholder="—"
                  readOnly={disabled}
                  className={disabled ? 'readonly' : ''}
                />
              </td>
            ))}
          </tr>
          <tr>
            <td className="row-label">DCS Reading</td>
            {points.map((p, i) => (
              <td key={i}>
                <input
                  type="number"
                  step="any"
                  value={p.dcs_reading}
                  onChange={e => update(i, 'dcs_reading', e.target.value)}
                  placeholder="—"
                  readOnly={disabled}
                  className={disabled ? 'readonly' : ''}
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
