import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, Typography, Paper, Avatar, Menu, MenuItem, ListItemText
} from '@mui/material';

export default function HomeView({ user, setView, logout, activeTrade, setActiveTrade, starredTrades, allTrades, onSafetyOpen, simulatingCompany, currentWorld, onEnterCompany, onSupportOpen }) {
  const { t } = useTranslation();
  const isSimulating = !!simulatingCompany;
  const isAdmin = isSimulating ? true : user.is_admin;
  const isSupervisor = isSimulating ? true : (user.role_level || 1) >= 2;
  const isOperator = !!user.sparks_role && currentWorld === 'voice-report';

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
  const [anchorEl, setAnchorEl] = useState(null);
  const [companiesList, setCompaniesList] = useState([]);

  const handleCompaniesOpen = (event) => {
    setAnchorEl(event.currentTarget);
    if (companiesList.length === 0) {
      fetch('/api/sparks/companies').then(r => r.ok ? r.json() : []).then(setCompaniesList).catch(() => {});
    }
  };

  const visibleTrades = (allTrades || []).filter(t => (starredTrades || []).includes(t.key));

  const handleTradeSelect = (tradeKey) => {
    setActiveTrade(tradeKey);
  };

  const getActionTiles = () => {
    const tiles = [];
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
    <Box className="home-view">
      {/* Welcome + Operator buttons */}
      <Box className="home-welcome">
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
          <Box className="home-welcome-row" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {user.photo && <Avatar src={`/api/photos/${user.photo}`} sx={{ width: 48, height: 48 }} />}
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 800, color: 'text.primary' }}>
                {t('home.welcome')}, {user.name}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {user.role_title || t('common.administrator')}
              </Typography>
            </Box>
          </Box>
          {isOperator && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Button variant="outlined" color="secondary" onClick={handleCompaniesOpen} sx={{ fontWeight: 700, fontSize: 14, borderRadius: 3, px: 2.5, py: 1.5 }}>
                Companies
              </Button>
              <Button variant="outlined" color="secondary" onClick={() => setView('analytics')} sx={{ fontWeight: 700, fontSize: 14, borderRadius: 3, px: 2.5, py: 1.5 }}>
                Analytics
              </Button>
              <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}
                PaperProps={{ sx: { minWidth: 250, maxHeight: 300, borderRadius: 3, border: '2px solid', borderColor: 'secondary.main' } }}>
                <Typography sx={{ px: 2, py: 1, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'text.secondary' }}>
                  Switch Company
                </Typography>
                {companiesList.map(c => (
                  <MenuItem key={c.id} onClick={() => { setAnchorEl(null); onEnterCompany({ id: c.id, name: c.name, mode: 'customer' }); }}>
                    <ListItemText primary={c.name} secondary={`${c.people_count} people`} />
                  </MenuItem>
                ))}
                {companiesList.length === 0 && (
                  <Typography sx={{ p: 2, textAlign: 'center', color: 'text.secondary', fontSize: 12 }}>Loading...</Typography>
                )}
              </Menu>
            </Box>
          )}
        </Box>
      </Box>

      {/* Trade Cards */}
      <Box sx={{ px: 2, mb: 3 }}>
        {(isAdmin || isSupervisor) ? (
          <>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1, mb: 1.5, textAlign: 'center' }}>
              {t('home.yourTrades')}
            </Typography>
            <Box className="trade-cards-container" sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', justifyContent: 'center' }}>
              {visibleTrades.map(trade => {
                const isActive = activeTrade === trade.key;
                return (
                  <Button
                    key={trade.key}
                    variant={isActive ? 'contained' : 'outlined'}
                    color={isActive ? 'secondary' : 'inherit'}
                    onClick={() => handleTradeSelect(trade.key)}
                    sx={{
                      px: 3, py: 2.5,
                      borderRadius: 4,
                      border: isActive ? '3px solid' : '2px solid',
                      borderColor: isActive ? 'primary.main' : 'grey.200',
                      bgcolor: isActive ? 'secondary.main' : 'background.paper',
                      color: isActive ? 'primary.main' : 'text.primary',
                      minHeight: 70,
                      fontSize: 22,
                      fontWeight: 800,
                      lineHeight: 1.2,
                      letterSpacing: 0.5,
                      '&:hover': {
                        bgcolor: isActive ? 'secondary.dark' : 'grey.100',
                        borderColor: isActive ? 'primary.main' : 'grey.300',
                      },
                    }}
                  >
                    {trade.label}
                  </Button>
                );
              })}
            </Box>
            {visibleTrades.length === 0 && (
              <Typography sx={{ color: 'text.primary', fontSize: 14, textAlign: 'center', py: 2.5 }}>
                {t('home.noTradesSelected')}
              </Typography>
            )}
          </>
        ) : (
          <Box sx={{ px: 2 }}>
            <Paper sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              px: 3, py: 2.5, borderRadius: 4,
              bgcolor: 'secondary.main', color: 'primary.main',
              border: '3px solid', borderColor: 'primary.main',
            }}>
              <Typography sx={{ fontSize: 22, fontWeight: 800, textAlign: 'center', lineHeight: 1.2, letterSpacing: 0.5 }}>
                {(allTrades || []).find(t => t.key === activeTrade)?.label || activeTrade}
              </Typography>
            </Paper>
          </Box>
        )}
      </Box>

      {/* Action tiles */}
      {activeTrade && (
        <>
          <Box sx={{ px: 2, mb: 2 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1 }}>
              {(allTrades || []).find(t => t.key === activeTrade)?.label || activeTrade}
            </Typography>
          </Box>
          <Box className="home-tiles" sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, px: 2 }}>
            {actionTiles.map(tile => (
              <Button
                key={tile.id}
                variant="outlined"
                disabled={tile.disabled}
                onClick={() => !tile.disabled && setView(tile.view)}
                sx={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', gap: 0.5,
                  py: 2, borderRadius: 3,
                  border: '2px solid', borderColor: 'grey.200',
                  bgcolor: tile.disabled ? 'grey.100' : 'background.paper',
                  color: 'text.primary',
                  opacity: tile.disabled ? 0.5 : 1,
                  ...(tile.fullWidth && { gridColumn: '1 / -1' }),
                  '&:hover': { bgcolor: 'grey.100', borderColor: 'primary.main' },
                }}
              >
                <Typography sx={{ fontSize: 28 }}>{tile.icon}</Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{tile.label}</Typography>
              </Button>
            ))}
          </Box>

          {/* Safety button */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3, px: 2 }}>
            <Button
              variant="outlined"
              onClick={() => onSafetyOpen && onSafetyOpen()}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 0.5, px: 2.5, py: 1.5, borderRadius: 3,
                border: '2px solid', borderColor: 'primary.main',
                outline: '2px solid', outlineColor: 'secondary.main',
                outlineOffset: 0,
                position: 'relative',
              }}
            >
              <Box sx={{
                position: 'absolute', top: 4, right: 4,
                width: 12, height: 12, borderRadius: '50%',
                bgcolor: jsaStatus === 'approved' ? '#4CAF50' : jsaStatus === 'pending' ? 'primary.main' : '#d32f2f',
                border: '2px solid white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
              <Typography sx={{ fontSize: 24 }}>⛑️</Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'text.primary' }}>{t('home.safetyFirst')}</Typography>
            </Button>
          </Box>
        </>
      )}

      <Box className="home-bottom-line" sx={{ mt: 4, borderBottom: '2px solid', borderColor: 'grey.200' }} />
    </Box>
  );
}
