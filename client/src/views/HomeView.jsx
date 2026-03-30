import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export default function HomeView({ user, setView, logout, activeTrade, setActiveTrade, starredTrades, allTrades, onSafetyOpen, simulatingCompany, currentWorld, onEnterCompany, onSupportOpen }) {
  const { t } = useTranslation();
  const isSimulating = !!simulatingCompany;
  const isAdmin = isSimulating ? true : user.is_admin;
  const isSupervisor = isSimulating ? true : (user.role_level || 1) >= 2;
  // Sparks operator buttons — visible in Voice Report mode, even when simulating a company
  const isOperator = !!user.sparks_role && currentWorld === 'voice-report';

  // JSA status for the Safety First button dot
  const [jsaStatus, setJsaStatus] = useState('none');
  useEffect(() => {
    if (!user?.person_id) return;
    fetch(`/api/jsa?person_id=${user.person_id}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.jsas) return;
        const today = new Date().toISOString().split('T')[0];
        const todayJSAs = (data.jsas || []).filter(j => j.date === today);
        if (todayJSAs.some(j => j.status === 'active')) {
          setJsaStatus('approved');
        } else if (todayJSAs.some(j => j.status === 'pending_foreman' || j.status === 'pending_safety')) {
          setJsaStatus('pending');
        } else {
          setJsaStatus('none');
        }
      })
      .catch(() => {});
  }, [user?.person_id]);

  // Companies dropdown for operators
  const companiesRef = useRef(null);
  const [showCompanies, setShowCompanies] = useState(false);
  const [companiesList, setCompaniesList] = useState([]);

  // Close companies dropdown on outside click
  useEffect(() => {
    if (!showCompanies) return;
    const handler = (e) => { if (companiesRef.current && !companiesRef.current.contains(e.target)) setShowCompanies(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCompanies]);

  // Load companies when dropdown opens
  useEffect(() => {
    if (showCompanies && companiesList.length === 0) {
      fetch('/api/sparks/companies').then(r => r.ok ? r.json() : []).then(setCompaniesList).catch(() => {});
    }
  }, [showCompanies]);

  // Filter to only starred trades
  const visibleTrades = (allTrades || []).filter(t => (starredTrades || []).includes(t.key));

  const handleTradeSelect = (tradeKey) => {
    setActiveTrade(tradeKey);
  };

  // Build action tiles based on the selected trade
  const getActionTiles = () => {
    const tiles = [];
    // Sparks Command Center tile — only for Sparks users, not in simulation mode
    if (user.sparks_role && !isSimulating) {
      tiles.push({ id: 'sparks', icon: '⚡', label: 'Command Center', view: 'sparks', fullWidth: true });
    }
    if (isAdmin) {
      tiles.push({ id: 'projects', icon: '📁', label: 'Projects', view: 'projects' });
      tiles.push({ id: 'crew', icon: '👥', label: t('home.peopleCrew'), view: 'people' });
      tiles.push({ id: 'dailyplan', icon: '📌', label: t('home.dailyPlanPunchList'), view: 'dailyplan' });
      tiles.push({ id: 'reports', icon: '📋', label: t('home.reports'), view: 'reports' });
      tiles.push({ id: 'messages', icon: '💬', label: t('home.messages'), view: 'messages' });
      tiles.push({ id: 'forms', icon: '📝', label: t('home.forms'), view: 'forms' });
    } else {
      if (isSupervisor) {
        tiles.push({ id: 'crew', icon: '👥', label: t('home.peopleCrew'), view: 'people' });
      }
      tiles.push({ id: 'dailyplan', icon: '📌', label: t('home.dailyPlanPunchList'), view: 'dailyplan' });
      tiles.push({ id: 'reports', icon: '📋', label: t('home.reports'), view: 'reports' });
      tiles.push({ id: 'messages', icon: '💬', label: t('home.messages'), view: 'messages' });
      tiles.push({ id: 'forms', icon: '📝', label: t('home.forms'), view: 'forms' });
    }
    return tiles;
  };

  const actionTiles = getActionTiles();

  return (
    <div className="home-view">
      {/* Welcome + Operator buttons */}
      <div className="home-welcome">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div className="home-welcome-row">
            {user.photo && <img src={`/api/photos/${user.photo}`} className="home-avatar" alt="" />}
            <div>
              <h2 className="home-greeting">{t('home.welcome')}, {user.name}</h2>
              <p className="home-role">{user.role_title || t('common.administrator')}</p>
            </div>
          </div>
          {isOperator && (
            <div ref={companiesRef} style={{ display: 'flex', gap: '8px', position: 'relative', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCompanies(!showCompanies)} style={{
                padding: '12px 20px', borderRadius: '12px', cursor: 'pointer',
                background: 'white', color: 'var(--charcoal)', border: '2px solid var(--charcoal)',
                fontWeight: 700, fontSize: '14px', whiteSpace: 'nowrap',
              }}>Companies</button>
              <button onClick={() => setView('analytics')} style={{
                padding: '12px 20px', borderRadius: '12px', cursor: 'pointer',
                background: 'white', color: 'var(--charcoal)', border: '2px solid var(--charcoal)',
                fontWeight: 700, fontSize: '14px', whiteSpace: 'nowrap',
              }}>Analytics</button>
              {showCompanies && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '8px',
                  background: 'white', borderRadius: '12px', border: '2px solid var(--charcoal)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 100, minWidth: '250px',
                  maxHeight: '300px', overflowY: 'auto',
                }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(45,45,45,0.1)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--charcoal)', opacity: 0.5 }}>
                    Switch Company
                  </div>
                  {companiesList.map(c => (
                    <button key={c.id} onClick={() => { setShowCompanies(false); onEnterCompany({ id: c.id, name: c.name, mode: 'customer' }); }} style={{
                      display: 'block', width: '100%', padding: '12px 16px', border: 'none',
                      background: 'none', cursor: 'pointer', textAlign: 'left',
                      borderBottom: '1px solid rgba(45,45,45,0.08)', fontSize: '14px', fontWeight: 600,
                      color: 'var(--charcoal)',
                    }}>
                      {c.name}
                      <div style={{ fontSize: '11px', opacity: 0.5, marginTop: '2px' }}>{c.people_count} people</div>
                    </button>
                  ))}
                  {companiesList.length === 0 && (
                    <div style={{ padding: '16px', textAlign: 'center', color: 'var(--charcoal)', fontSize: '12px' }}>Loading...</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Trade Cards — admin/superintendent see selector, workers see their trade */}
      <div style={{padding: '0 16px', marginBottom: '24px'}}>
        {(isAdmin || isSupervisor) ? (
          <>
            <p style={{fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px', textAlign: 'center'}}>
              {t('home.yourTrades')}
            </p>
            <div className="trade-cards-container">
              {visibleTrades.map(trade => {
                const isActive = activeTrade === trade.key;
                return (
                  <button
                    key={trade.key}
                    className="trade-card-btn"
                    onClick={() => handleTradeSelect(trade.key)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '20px 24px',
                      background: isActive
                        ? 'linear-gradient(145deg, var(--charcoal), var(--charcoal-dark))'
                        : 'linear-gradient(145deg, #ffffff, var(--gray-50))',
                      color: isActive ? 'var(--primary)' : 'var(--charcoal)',
                      border: isActive ? '3px solid var(--primary)' : '2px solid var(--gray-200)',
                      borderRadius: '16px', cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      minHeight: '70px',
                      boxShadow: 'none',
                      transform: 'none',
                    }}
                  >
                    <span style={{fontSize: '22px', fontWeight: 800, textAlign: 'center', lineHeight: 1.2, letterSpacing: '0.5px'}}>{trade.label}</span>
                  </button>
                );
              })}
            </div>
            {visibleTrades.length === 0 && (
              <p style={{color: 'var(--charcoal)', fontSize: '14px', textAlign: 'center', padding: '20px'}}>
                {t('home.noTradesSelected')}
              </p>
            )}
          </>
        ) : (
          /* Workers see their trade as a header — no switching */
          <div style={{padding: '0 16px'}}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '20px 24px',
              background: 'linear-gradient(145deg, var(--charcoal), var(--charcoal-dark))',
              color: 'var(--primary)',
              border: '3px solid var(--primary)',
              borderRadius: '16px',
            }}>
              <span style={{fontSize: '22px', fontWeight: 800, textAlign: 'center', lineHeight: 1.2, letterSpacing: '0.5px'}}>{(allTrades || []).find(t => t.key === activeTrade)?.label || activeTrade}</span>
            </div>
          </div>
        )}
      </div>

      {/* Action tiles — shown when a trade is selected */}
      {activeTrade && (
        <>
          <div style={{padding: '0 16px', marginBottom: '16px'}}>
            <p style={{fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0'}}>
              {(allTrades || []).find(t => t.key === activeTrade)?.label || activeTrade}
            </p>
          </div>
          <div className="home-tiles">
            {actionTiles.map(tile => (
              <button
                key={tile.id}
                className={`home-tile ${tile.disabled ? 'tile-disabled' : ''}`}
                onClick={() => !tile.disabled && setView(tile.view)}
                disabled={tile.disabled}
                style={tile.fullWidth ? {gridColumn: '1 / -1', justifyContent: 'center'} : undefined}
              >
                {tile.badge && <span className="tile-badge">{tile.badge}</span>}
                <span className="tile-icon">{tile.icon}</span>
                <span className="tile-label">{tile.label}</span>
              </button>
            ))}
          </div>

          {/* Safety button */}
          <div style={{display: 'flex', justifyContent: 'center', marginTop: '24px', padding: '0 16px'}}>
            <button
              onClick={() => onSafetyOpen && onSafetyOpen()}
              className="home-tile"
              style={{
                flex: '0 0 auto',
                width: 'auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                padding: '12px 20px',
                cursor: 'pointer',
                border: '2px solid var(--primary)',
                outline: '2px solid var(--charcoal)',
                outlineOffset: '0px',
                borderRadius: '12px',
                position: 'relative',
              }}
            >
              {/* JSA status dot — red=not done, orange=pending, green=approved */}
              <span style={{
                position: 'absolute',
                top: '4px',
                right: '4px',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: jsaStatus === 'approved' ? '#4CAF50' : jsaStatus === 'pending' ? 'var(--primary)' : '#d32f2f',
                border: '2px solid white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
              <span style={{fontSize: '24px'}}>⛑️</span>
              <span style={{fontSize: '14px', fontWeight: 700, color: 'var(--charcoal)'}}>{t('home.safetyFirst')}</span>
            </button>
          </div>
        </>
      )}

      <div className="home-bottom-line"></div>
    </div>
  );
}
