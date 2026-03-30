import { useState, useRef, useEffect } from 'react';

export default function PinModal({ visible, companyName, onSubmit, onCancel, error }) {
  const [pin, setPin] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (visible && inputRef.current) {
      setPin('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  if (!visible) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (pin.length >= 4) onSubmit(pin);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }} onClick={onCancel}>
      <div style={{
        background: 'white', borderRadius: '16px', padding: '28px', maxWidth: '380px', width: '100%',
        boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 8px', color: 'var(--charcoal)', fontSize: '18px', fontWeight: 800 }}>
          Enable Edit Mode
        </h3>
        <p style={{ margin: '0 0 20px', color: 'var(--charcoal)', fontSize: '13px', lineHeight: 1.5, opacity: 0.7 }}>
          You are about to enable editing for <strong>{companyName}</strong>. All changes will be logged under your operator account.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="Enter your PIN"
            style={{
              width: '100%', padding: '14px 16px', fontSize: '18px', fontWeight: 700,
              borderRadius: '12px', border: error ? '2px solid #dc2626' : '2px solid var(--charcoal)',
              textAlign: 'center', letterSpacing: '8px', boxSizing: 'border-box',
            }}
          />
          {error && (
            <p style={{ color: '#dc2626', fontSize: '12px', fontWeight: 600, margin: '8px 0 0', textAlign: 'center' }}>
              {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button type="button" onClick={onCancel} style={{
              flex: 1, padding: '12px', borderRadius: '12px', border: '2px solid var(--charcoal)',
              background: 'white', color: 'var(--charcoal)', fontWeight: 700, fontSize: '14px', cursor: 'pointer',
            }}>Cancel</button>
            <button type="submit" disabled={pin.length < 4} style={{
              flex: 1, padding: '12px', borderRadius: '12px', border: 'none',
              background: pin.length >= 4 ? '#dc2626' : '#ccc',
              color: 'white', fontWeight: 700, fontSize: '14px', cursor: pin.length >= 4 ? 'pointer' : 'default',
            }}>Enable Editing</button>
          </div>
        </form>
      </div>
    </div>
  );
}
