import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, Typography, Avatar, Menu, MenuItem, ListItemText,
  Card, CardContent, CardActionArea, alpha, Chip
} from '@mui/material';

export default function HomeView({ user, setView, logout, activeTrade, setActiveTrade, starredTrades, allTrades, onSafetyOpen, simulatingCompany, onEnterCompany, onSupportOpen }) {
  const { t } = useTranslation();
  const isSimulating = !!simulatingCompany;
  const isAdmin = isSimulating ? true : user.is_admin;
  const isSupervisor = isSimulating ? true : (user.role_level || 1) >= 2;
  const isOperator = !!user.sparks_role;

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

  const [anchorEl, setAnchorEl] = useState(null);
  const [companiesList, setCompaniesList] = useState([]);

  const handleCompaniesOpen = (event) => {
    setAnchorEl(event.currentTarget);
    if (companiesList.length === 0) {
      fetch('/api/sparks/companies').then(r => r.ok ? r.json() : []).then(setCompaniesList).catch(() => {});
    }
  };

  const visibleTrades = simulatingCompany?.trades?.length
    ? (allTrades || []).filter(t => simulatingCompany.trades.includes(t.key))
    : (allTrades || []).filter(t => (starredTrades || []).includes(t.key));

  const handleTradeSelect = (tradeKey) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setActiveTrade(tradeKey);
    // Double rAF to ensure scroll reset happens after browser focus/paint cycle
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }));
  };

  const getActionTiles = () => {
    const tiles = [];
    if (user.sparks_role && !isSimulating) {
    }
    if (isAdmin) {
      if ((user.role_level || 0) >= 5 || user.is_admin) tiles.push({ id: 'projects', icon: '📁', label: 'Projects', view: 'projects' });
      const crewLabel = (user.role_level || 0) <= 4 && !user.sparks_role ? t('home.myCrew') : t('home.peopleCrew');
      tiles.push({ id: 'crew', icon: '👥', label: crewLabel, view: 'people' });
      tiles.push({ id: 'dailyplan', icon: '📌', label: t('home.dailyPlanPunchList'), view: 'dailyplan' });
      tiles.push({ id: 'reports', icon: '📋', label: t('home.reports'), view: 'reports' });
      tiles.push({ id: 'messages', icon: '💬', label: t('home.messages'), view: 'messages' });
      tiles.push({ id: 'forms', icon: '📝', label: t('home.forms'), view: 'forms' });
    } else {
      if (isSupervisor) {
        const crewLabel2 = (user.role_level || 0) <= 4 ? t('home.myCrew') : t('home.peopleCrew');
        tiles.push({ id: 'crew', icon: '👥', label: crewLabel2, view: 'people' });
      }
      tiles.push({ id: 'dailyplan', icon: '📌', label: t('home.dailyPlanPunchList'), view: 'dailyplan' });
      tiles.push({ id: 'reports', icon: '📋', label: t('home.reports'), view: 'reports' });
      tiles.push({ id: 'messages', icon: '💬', label: t('home.messages'), view: 'messages' });
      tiles.push({ id: 'forms', icon: '📝', label: t('home.forms'), view: 'forms' });
    }
    return tiles;
  };

  const actionTiles = getActionTiles();

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const jsaColor = jsaStatus === 'approved' ? 'success' : jsaStatus === 'pending' ? 'warning' : 'error';
  const jsaLabel = jsaStatus === 'approved' ? 'JSA Active' : jsaStatus === 'pending' ? 'JSA Pending' : 'No JSA';

  return (
    <Box className="home-view" sx={{ pb: 4 }}>
      {/* Welcome banner */}
      <Card sx={{
        mx: 2, mt: 2, mb: 3,
        background: (theme) => `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 100%)`,
        color: '#fff',
        borderRadius: 4,
      }}>
        <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar
                src={user.photo ? `/api/photos/${user.photo}` : undefined}
                sx={{
                  width: 56, height: 56,
                  bgcolor: alpha('#fff', 0.24),
                  fontSize: 24, fontWeight: 700,
                  border: '2px solid',
                  borderColor: alpha('#fff', 0.48),
                }}
              >
                {!user.photo && (user.name?.charAt(0) || 'U')}
              </Avatar>
              <Box>
                <Typography variant="h5" sx={{ color: '#fff', fontWeight: 800, mb: 0.25 }}>
                  {getGreeting()},
                </Typography>
                <Typography variant="h4" sx={{ color: '#fff', fontWeight: 800 }}>
                  {user.name}
                </Typography>
                <Typography variant="body2" sx={{ color: alpha('#fff', 0.72), mt: 0.5 }}>
                  {user.role_title || t('common.administrator')}
                </Typography>
                {simulatingCompany && (
                  <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: 22, mt: 1 }}>
                    {simulatingCompany.name}
                  </Typography>
                )}
              </Box>
            </Box>
            {isOperator && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  onClick={handleCompaniesOpen}
                  sx={{
                    bgcolor: alpha('#fff', 0.16),
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 13,
                    px: 2, py: 0.75,
                    borderRadius: 2,
                    '&:hover': { bgcolor: alpha('#fff', 0.32) },
                    boxShadow: 'none',
                  }}
                >
                  Companies
                </Button>
                <Button
                  variant="contained"
                  onClick={() => setView('analytics')}
                  sx={{
                    bgcolor: alpha('#fff', 0.16),
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 13,
                    px: 2, py: 0.75,
                    borderRadius: 2,
                    '&:hover': { bgcolor: alpha('#fff', 0.32) },
                    boxShadow: 'none',
                  }}
                >
                  Analytics
                </Button>
                <Menu
                  anchorEl={anchorEl}
                  open={Boolean(anchorEl)}
                  onClose={() => setAnchorEl(null)}
                  slotProps={{
                    paper: {
                      sx: {
                        minWidth: 260, maxHeight: 320, borderRadius: 3,
                        boxShadow: (theme) => theme.shadows[8],
                        mt: 1,
                      }
                    }
                  }}
                >
                  <Typography sx={{ px: 2.5, py: 1.5, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.1, color: 'text.secondary' }}>
                    Switch Company
                  </Typography>
                  {companiesList.map(c => (
                    <MenuItem key={c.id} onClick={() => { setAnchorEl(null); onEnterCompany({ id: c.id, name: c.name, mode: 'customer', trades: (c.trades || []).filter(Boolean) }); }}
                      sx={{ borderRadius: 1, mx: 1, mb: 0.5 }}>
                      <ListItemText primary={c.name} secondary={`${c.people_count} people`} />
                    </MenuItem>
                  ))}
                  {companiesList.length === 0 && (
                    <Typography sx={{ p: 2.5, textAlign: 'center', color: 'text.secondary', fontSize: 13 }}>Loading...</Typography>
                  )}
                </Menu>
              </Box>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Trade selector */}
      <Box sx={{ px: 2.5, mb: 3 }}>
        {(isAdmin || isSupervisor) ? (
          <>
            <Typography variant="overline" sx={{ color: 'text.secondary', mb: 1.5, display: 'block' }}>
              {t('home.yourTrades')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {visibleTrades.map(trade => {
                const isActive = activeTrade === trade.key;
                return (
                  <Chip
                    key={trade.key}
                    label={trade.label}
                    onClick={() => handleTradeSelect(trade.key)}
                    onMouseDown={(e) => e.preventDefault()}
                    color={isActive ? 'primary' : 'default'}
                    variant={isActive ? 'filled' : 'outlined'}
                    sx={{
                      fontSize: 14,
                      fontWeight: 700,
                      px: 1,
                      py: 2.5,
                      borderRadius: 2,
                      ...(isActive && {
                        boxShadow: (theme) => `0 8px 16px 0 ${alpha(theme.palette.primary.main, 0.24)}`,
                      }),
                    }}
                  />
                );
              })}
            </Box>
            {visibleTrades.length === 0 && (
              <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', py: 3 }}>
                {t('home.noTradesSelected')}
              </Typography>
            )}
          </>
        ) : (
          <Chip
            label={(allTrades || []).find(t => t.key === activeTrade)?.label || activeTrade}
            color="primary"
            sx={{
              fontSize: 16, fontWeight: 800, px: 2, py: 3, borderRadius: 2,
              boxShadow: (theme) => `0 8px 16px 0 ${alpha(theme.palette.primary.main, 0.24)}`,
            }}
          />
        )}
      </Box>

      {/* Action tiles */}
      {activeTrade && (
        <>
          <Box sx={{ px: 2.5, mb: 2 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              {(allTrades || []).find(t => t.key === activeTrade)?.label || activeTrade}
            </Typography>
          </Box>

          <Box sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 2,
            px: 2.5,
          }}>
            {actionTiles.map(tile => (
              <Card
                key={tile.id}
                sx={{
                  ...(tile.accent === 'primary' && {
                    gridColumn: '1 / -1',
                    background: (theme) => `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
                    color: '#fff',
                  }),
                  transition: 'box-shadow 0.25s ease, transform 0.25s ease',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: (theme) => theme.shadows[8],
                  },
                }}
              >
                <CardActionArea
                  onClick={() => !tile.disabled && setView(tile.view)}
                  disabled={tile.disabled}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    py: tile.accent === 'primary' ? 2.5 : 3,
                    px: 2,
                    gap: 1,
                  }}
                >
                  <Box sx={{
                    width: 48, height: 48,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 24,
                    bgcolor: tile.accent === 'primary' ? alpha('#fff', 0.16) : (theme) => alpha(theme.palette.primary.main, 0.08),
                  }}>
                    {tile.icon}
                  </Box>
                  <Typography
                    variant="subtitle2"
                    sx={{
                      textAlign: 'center',
                      color: tile.accent === 'primary' ? '#fff' : 'text.primary',
                    }}
                  >
                    {tile.label}
                  </Typography>
                </CardActionArea>
              </Card>
            ))}
          </Box>

          {/* Safety card — compact, centered */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Card
              sx={{
                cursor: 'pointer',
                bgcolor: '#ffffff',
                border: '1px solid',
                borderColor: (theme) => alpha(theme.palette[jsaColor].main, 0.24),
                borderRadius: 3,
                transition: 'box-shadow 0.25s ease, transform 0.25s ease',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  boxShadow: (theme) => theme.shadows[4],
                },
              }}
              onClick={() => onSafetyOpen && onSafetyOpen()}
            >
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography sx={{ fontSize: 22 }}>⛑️</Typography>
                <Typography sx={{ fontWeight: 700, fontSize: 14, color: 'text.primary' }}>
                  {t('home.safetyFirst')}
                </Typography>
                <Chip
                  label={jsaLabel}
                  color={jsaColor}
                  size="small"
                  sx={{ fontWeight: 700, fontSize: 11 }}
                />
              </CardContent>
            </Card>
          </Box>
        </>
      )}
    </Box>
  );
}
