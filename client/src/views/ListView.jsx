import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Typography, Card, CardActionArea, CardContent, CircularProgress, Chip
} from '@mui/material';

export default function ListView({ user, onOpen }) {
  const { t } = useTranslation();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = user.is_admin ? '/api/reports' : `/api/reports?person_id=${user.person_id}`;
    fetch(url).then(r => r.json()).then(data => { setReports(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
      <CircularProgress color="primary" />
    </Box>
  );

  return (
    <Box className="list-view" sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 2, color: 'text.primary' }}>
        {user.is_admin ? t('common.allReports') : t('common.myReports')}
      </Typography>
      {reports.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Typography sx={{ color: 'text.secondary' }}>{t('common.noReportsYet')}</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {reports.map(r => (
            <Card key={r.id} variant="outlined" sx={{ borderRadius: 2.5 }}>
              <CardActionArea onClick={() => onOpen(r.id)} sx={{ p: 0 }}>
                <CardContent sx={{ py: 1.5, px: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.secondary' }}>
                      {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </Typography>
                    {r.duration_seconds && (
                      <Chip label={`${Math.floor(r.duration_seconds / 60)}m ${r.duration_seconds % 60}s`} size="small" variant="outlined" />
                    )}
                  </Box>
                  {user.is_admin && r.person_name && (
                    <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
                      {r.person_name} — {r.role_title}
                    </Typography>
                  )}
                  <Typography sx={{ fontSize: 13, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.preview || t('common.noTranscript')}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}
