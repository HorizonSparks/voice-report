import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import CircularProgress from '@mui/material/CircularProgress';
import StatusBadge from '../components/forms/StatusBadge.jsx';
import CalibrationTable from '../components/forms/CalibrationTable.jsx';

export default function SubmissionView({ id, onBack }) {
  const [sub, setSub] = useState(null);

  useEffect(() => {
    fetch(`/api/forms/submissions/${id}`)
      .then(r => r.json())
      .then(setSub)
      .catch(err => console.error('Failed to load submission:', err));
  }, [id]);

  if (!sub) {
    return (
      <Box className="loading" sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  const groups = {};
  if (sub.fields) {
    for (const f of sub.fields) {
      const g = f.field_group || 'other';
      if (!groups[g]) groups[g] = [];
      groups[g].push(f);
    }
  }

  const groupLabels = {
    header: 'Project / Loop Information', device_info: 'Device Information',
    cable_info: 'Cable Information', valve_info: 'Valve Information',
    positioner: 'Positioner', setpoint: 'Setpoint / Trip Settings',
    checks: 'Verification Checks', cable_check: 'Cable Continuity Check',
    calibration: 'Calibration Verification & Loop Check',
    leak_test: 'Leak / Continuity Test', loop_check: 'Loop Check with DCS',
    client_witness: 'Client / Owner Witness',
    site_conditions: 'Site Conditions',
    comments: 'Comments', test_equipment: 'Test Equipment', signatures: 'Sign-Off',
  };

  return (
    <Box className="submission-view">
      <Button className="back-btn" onClick={onBack} sx={{ mb: '12px' }}>&larr; Back</Button>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '16px' }}>
        <Box>
          <Typography variant="h2" sx={{ m: 0 }}>{sub.form_title || 'Form'}</Typography>
          <Typography sx={{ color: 'text.primary', my: '4px' }}>{sub.form_code}</Typography>
        </Box>
        <StatusBadge status={sub.status} />
      </Box>

      <Paper sx={{ borderRadius: '12px', p: '16px', mb: '16px' }}>
        <Box>
          <Typography component="span" sx={{ fontWeight: 700 }}>Technician:</Typography> {sub.technician_name}
        </Box>
        <Box>
          <Typography component="span" sx={{ fontWeight: 700 }}>Submitted:</Typography> {sub.submitted_at ? new Date(sub.submitted_at).toLocaleString() : 'Draft'}
        </Box>
        {sub.values?.tag_number && (
          <Box>
            <Typography component="span" sx={{ fontWeight: 700 }}>Tag:</Typography> {sub.values.tag_number}
          </Box>
        )}
      </Paper>

      {Object.entries(groups).map(([gKey, fields]) => (
        <Box key={gKey} sx={{ mb: '16px' }}>
          <Typography variant="h3" sx={{ fontSize: '16px', fontWeight: 700, color: 'text.primary', mb: '8px' }}>
            {groupLabels[gKey] || gKey}
          </Typography>
          {fields.map(field => {
            const val = sub.values?.[field.field_name];
            if (val === undefined || val === null || val === '') return null;
            if (field.field_type === 'signature' && val?.startsWith('data:')) {
              return (
                <Box key={field.field_name} sx={{ mb: '8px' }}>
                  <Typography sx={{ fontSize: '13px', color: 'text.primary' }}>{field.field_label}:</Typography>
                  <Box
                    component="img"
                    src={val}
                    alt="Signature"
                    sx={{ maxWidth: '200px', display: 'block', mt: '4px' }}
                  />
                </Box>
              );
            }
            return (
              <Box key={field.field_name} sx={{ display: 'flex', gap: '8px', mb: '4px', fontSize: '14px' }}>
                <Typography sx={{ color: 'text.primary', minWidth: '140px' }}>{field.field_label}:</Typography>
                <Typography sx={{ fontWeight: 500 }}>{String(val)}</Typography>
              </Box>
            );
          })}
        </Box>
      ))}

      {sub.calibration_points && sub.calibration_points.length > 0 && (
        <Box sx={{ mb: '16px' }}>
          <Typography variant="h3" sx={{ fontSize: '16px', fontWeight: 700, mb: '8px' }}>Calibration Data</Typography>
          <CalibrationTable points={sub.calibration_points} onChange={() => {}} disabled={true} />
        </Box>
      )}

      {sub.values?.photos && sub.values.photos.length > 0 && (
        <Box sx={{ mb: '16px' }}>
          <Typography variant="h3" sx={{ fontSize: '16px', fontWeight: 700, mb: '8px' }}>Photos</Typography>
          <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {sub.values.photos.map((src, i) => (
              <Box
                component="img"
                key={i}
                src={src}
                alt={`Photo ${i+1}`}
                sx={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '8px' }}
              />
            ))}
          </Box>
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: '8px', mt: '20px' }}>
        <Button className="btn btn-secondary" onClick={() => window.print()}>Print Form</Button>
      </Box>
    </Box>
  );
}
