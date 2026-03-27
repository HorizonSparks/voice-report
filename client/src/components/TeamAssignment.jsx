import { useState } from 'react';

export default function TeamAssignment({ person, allPeople, onUpdate }) {
  const [showPicker, setShowPicker] = useState(false);

  const directReports = allPeople.filter(p => p.supervisor_id === person.id);
  const personLevel = person.role_level || 2;
  const assignable = allPeople.filter(p =>
    (p.role_level || 1) === personLevel - 1 &&
    !p.supervisor_id &&
    p.id !== person.id &&
    p.status === 'active'
  );

  const assignPerson = async (subordinateId) => {
    const sub = allPeople.find(p => p.id === subordinateId);
    if (!sub) return;
    sub.supervisor_id = person.id;
    await fetch(`/api/people/${subordinateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    onUpdate();
    setShowPicker(false);
  };

  const unassignPerson = async (subordinateId) => {
    if (!window.confirm('Remove this person from the team?')) return;
    const sub = allPeople.find(p => p.id === subordinateId);
    if (!sub) return;
    sub.supervisor_id = null;
    await fetch(`/api/people/${subordinateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    onUpdate();
  };

  const levelBelow = personLevel === 2 ? 'Journeymen' : personLevel === 3 ? 'Foremen' : personLevel === 4 ? 'General Foremen' : 'Direct Reports';

  return (
    <div className="person-bubble">
      <div className="person-bubble-header">Team ({levelBelow})</div>
      <div className="person-bubble-body">
        {directReports.length === 0 ? (
          <p style={{fontSize: '13px', color: 'var(--charcoal)', marginBottom: '12px'}}>No {levelBelow.toLowerCase()} assigned yet.</p>
        ) : (
          <div style={{display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px'}}>
            {directReports.map(dr => (
              <div key={dr.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', background: 'var(--gray-50)', borderRadius: '8px',
                border: '1px solid var(--gray-200)'
              }}>
                <div>
                  <span style={{fontWeight: 600, fontSize: '14px'}}>{dr.name}</span>
                  <span style={{fontSize: '12px', color: 'var(--charcoal)', marginLeft: '8px'}}>{dr.role_title}</span>
                </div>
                <button
                  onClick={() => unassignPerson(dr.id)}
                  style={{
                    background: 'none', border: 'none', color: '#E8922A',
                    fontSize: '18px', cursor: 'pointer', padding: '4px 8px'
                  }}
                >&times;</button>
              </div>
            ))}
          </div>
        )}

        {showPicker ? (
          <div style={{border: '1px solid var(--primary)', borderRadius: '8px', padding: '12px', background: 'white'}}>
            <p style={{fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--gray-700)'}}>
              Select {levelBelow.toLowerCase()} to assign:
            </p>
            {assignable.length === 0 ? (
              <p style={{fontSize: '13px', color: 'var(--charcoal)'}}>No unassigned {levelBelow.toLowerCase()} available.</p>
            ) : (
              <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                {assignable.map(p => (
                  <button
                    key={p.id}
                    onClick={() => assignPerson(p.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '8px 12px', background: 'var(--gray-50)', border: '1px solid var(--gray-200)',
                      borderRadius: '6px', cursor: 'pointer', textAlign: 'left', fontSize: '14px'
                    }}
                  >
                    <span style={{color: 'var(--primary)', fontWeight: 700}}>+</span>
                    <span>{p.name}</span>
                    <span style={{fontSize: '12px', color: 'var(--charcoal)'}}>{p.role_title}</span>
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowPicker(false)}
              style={{marginTop: '8px', fontSize: '13px', color: 'var(--charcoal)', background: 'none', border: 'none', cursor: 'pointer'}}
            >Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setShowPicker(true)}
            style={{
              fontSize: '13px', color: 'var(--primary)', fontWeight: 600,
              background: 'none', border: '1px solid var(--primary)',
              borderRadius: '6px', padding: '8px 16px', cursor: 'pointer'
            }}
          >+ Assign Team Member</button>
        )}
      </div>
    </div>
  );
}
