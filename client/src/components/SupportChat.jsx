import { useState, useEffect, useRef } from 'react';

/**
 * Floating Support Chat Widget
 * Bottom-right bubble that opens a chat panel overlay.
 * For supervisors+ on desktop/iPad — not for phone field workers.
 * Separate from crew messaging — this is client ↔ Horizon Sparks support.
 */
export default function SupportChat({ user, simulatingCompany, externalOpen, onExternalOpenChange }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (val) => { setInternalOpen(val); if (onExternalOpenChange) onExternalOpenChange(val); };
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current.focus(), 100);
    }
  }, [open]);

  // Load support conversation on open
  useEffect(() => {
    if (open && messages.length === 0) {
      // Welcome message
      setMessages([{
        id: 'welcome',
        role: 'support',
        text: 'Hi! How can we help you today? Describe your issue and our team will get back to you.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    }
  }, [open]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const newMsg = {
      id: 'msg_' + Date.now(),
      role: 'user',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, newMsg]);
    setInput('');
    setSending(true);

    // TODO: Send to support backend endpoint
    // For now, auto-acknowledge
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: 'ack_' + Date.now(),
        role: 'support',
        text: 'Thanks! Your message has been received. Our team will respond shortly.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
      setSending(false);
    }, 800);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const companyName = simulatingCompany?.name || 'Horizon Sparks';

  return (
    <>
      {/* Floating Bubble */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', bottom: '24px', right: '24px', zIndex: 900,
            width: '56px', height: '56px', borderRadius: '50%',
            background: 'var(--charcoal)', border: '3px solid var(--primary)',
            color: 'var(--primary)', fontSize: '24px',
            cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Support Chat"
        >
          💬
        </button>
      )}

      {/* Chat Panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 1000,
          width: '360px', maxWidth: 'calc(100vw - 48px)',
          height: '480px', maxHeight: 'calc(100vh - 120px)',
          background: 'white', borderRadius: '16px',
          border: '2px solid var(--charcoal)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 16px', background: 'var(--charcoal)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <div style={{ color: 'var(--primary)', fontWeight: 700, fontSize: '14px' }}>
                Horizon Sparks Support
              </div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', marginTop: '2px' }}>
                {companyName}
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{
              background: 'none', border: 'none', color: 'white',
              fontSize: '20px', cursor: 'pointer', padding: '4px',
            }}>✕</button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '12px',
            display: 'flex', flexDirection: 'column', gap: '8px',
            background: '#f8f6f3',
          }}>
            {messages.map(msg => (
              <div key={msg.id} style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
              }}>
                <div style={{
                  padding: '10px 14px', borderRadius: '14px',
                  background: msg.role === 'user' ? 'var(--charcoal)' : 'white',
                  color: msg.role === 'user' ? 'var(--primary)' : 'var(--charcoal)',
                  fontSize: '13px', lineHeight: 1.4,
                  border: msg.role === 'support' ? '1px solid #e0e0e0' : 'none',
                  boxShadow: msg.role === 'support' ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
                }}>
                  {msg.text}
                </div>
                <div style={{
                  fontSize: '10px', color: '#999', marginTop: '3px',
                  textAlign: msg.role === 'user' ? 'right' : 'left',
                  padding: '0 4px',
                }}>
                  {msg.time}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '10px 12px', borderTop: '1px solid #eee',
            display: 'flex', gap: '8px', background: 'white',
          }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              style={{
                flex: 1, padding: '10px 14px', borderRadius: '20px',
                border: '2px solid #e0e0e0', fontSize: '13px',
                outline: 'none', color: 'var(--charcoal)',
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              style={{
                padding: '10px 16px', borderRadius: '20px',
                background: input.trim() ? 'var(--primary)' : '#e0e0e0',
                color: 'white', border: 'none', fontWeight: 700,
                fontSize: '13px', cursor: input.trim() ? 'pointer' : 'default',
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
