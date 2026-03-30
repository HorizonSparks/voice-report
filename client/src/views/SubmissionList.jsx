import { useState, useEffect } from 'react';
import { Box, Typography, Button, Paper, CircularProgress } from '@mui/material';
import StatusBadge from '../components/forms/StatusBadge.jsx';

export default function SubmissionList({ onViewSubmission, onBack }) {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/forms/submissions')
      .then(r => r.json())
      .then(data => { setSubs(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <Box className="loading" sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px 0' }}>
      <CircularProgress />
    </Box>
  );

  return (
    <Box className="submission-list">
      <Button className="back-btn" onClick={onBack} sx={{ mb: '12px' }}>&larr; Back</Button>
      <Typography variant="h4">Completed Forms</Typography>

      {subs.length === 0 ? (
        <Typography sx={{ color: 'text.primary', textAlign: 'center', padding: '40px 0' }}>No forms submitted yet.</Typography>
      ) : (
        <Box className="report-list">
          {subs.map(s => (
            <Paper
              key={s.id}
              className="report-card"
              component="button"
              onClick={() => onViewSubmission(s.id)}
              sx={{ width: '100%', textAlign: 'left', mb: '8px', cursor: 'pointer' }}
            >
              <Box className="report-card-header">
                <Typography component="span" className="report-date" sx={{ fontWeight: 700 }}>{s.form_code}</Typography>
                <StatusBadge status={s.status} />
              </Box>
              <Box className="report-preview">
                {s.form_title} - {s.technician_name}
                {s.submitted_at && <Typography component="span" sx={{ color: 'text.primary', ml: '8px' }}>{new Date(s.submitted_at).toLocaleDateString()}</Typography>}
              </Box>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}
