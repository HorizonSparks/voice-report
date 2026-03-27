import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export default function HomeView({ user, setView, logout, activeTrade, setActiveTrade, starredTrades, allTrades, onSafetyOpen }) {
  const { t } = useTranslation();
  const isAdmin = user.is_admin;
  const isSupervisor = (user.role_level || 1) >= 2;

  // JSA status for the Safety First button dot
  const [jsaStatus, setJsaStatus] = useState('none'); // 'none' | 'pending' | 'approved'
  useEffect(() => {
    if (!user?.id) return;
    fetch(`/api/jsa?person_id=${user.id}`, { credentials: 'include' })
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
  }, [user?.id]);

  // Filter to only starred trades
  const visibleTrades = (allTrades || []).filter(t => (starredTrades || []).includes(t.key));

  const handleTradeSelect = (tradeKey) => {
    setActiveTrade(tradeKey);
  };

  // Build action tiles based on the selected trade
  const getActionTiles = () => {
    const tiles = [];
    if (isAdmin) {
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
      {/* Welcome */}
      <div className="home-welcome">
        <div className="home-welcome-row">
          {user.photo && <img src={`/api/photos/${user.photo}`} className="home-avatar" alt="" />}
          <div>
            <h2 className="home-greeting">{t('home.welcome')}, {user.name}</h2>
            <p className="home-role">{user.role_title || t('common.administrator')}</p>
          </div>
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
              <span style={{fontSize: '22px', fontWeight: 800, textAlign: 'center', lineHeight: 1.2, letterSpacing: '0.5px'}}>{activeTrade}</span>
            </div>
          </div>
        )}
      </div>

      {/* Action tiles — shown when a trade is selected */}
      {activeTrade && (
        <>
          <div style={{padding: '0 16px', marginBottom: '16px'}}>
            <p style={{fontSize: '12px', fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0'}}>
              {activeTrade}
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
