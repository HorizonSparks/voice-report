export default function ChecklistGroup({ label, value, onChange }) {
  const options = ['Yes', 'No'];

  return (
    <div className="checklist-group">
      <span className="field-label">{label}</span>
      <div className="checklist-buttons">
        {options.map(opt => (
          <button
            key={opt}
            type="button"
            className={`checklist-btn ${value === opt ? 'active' : ''} ${opt === 'Yes' ? 'btn-yes' : 'btn-no'}`}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
