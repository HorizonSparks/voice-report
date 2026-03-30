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

  const ynaBtns = (idx, field, value) => (
    <div className="yna-group">
      {['Y', 'N', 'N/A'].map(opt => (
        <button
          key={opt}
          type="button"
          className={`yna-btn ${value === opt ? 'active' : ''}`}
          onClick={() => update(idx, field, opt)}
          disabled={disabled}
        >
          {opt}
        </button>
      ))}
    </div>
  );

  return (
    <div className="cable-table-wrapper">
      <table className="cable-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Tag Number</th>
            <th>Color Code / Number</th>
            <th>Continuity Check</th>
            <th>Correct Cable Pulled & Landed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="row-num">{i + 1}</td>
              <td>
                <input
                  type="text"
                  value={row.tag_number}
                  onChange={e => update(i, 'tag_number', e.target.value)}
                  placeholder="Tag #"
                  readOnly={disabled}
                  className={disabled ? 'readonly' : ''}
                />
              </td>
              <td>
                <input
                  type="text"
                  value={row.color_code}
                  onChange={e => update(i, 'color_code', e.target.value)}
                  placeholder="Color/No."
                  readOnly={disabled}
                  className={disabled ? 'readonly' : ''}
                />
              </td>
              <td>{ynaBtns(i, 'continuity', row.continuity)}</td>
              <td>{ynaBtns(i, 'cable_landed', row.cable_landed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!disabled && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={addRow}>
          + Add Row
        </button>
      )}
    </div>
  );
}
