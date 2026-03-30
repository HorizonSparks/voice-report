import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';

export default function FormHeader({ formCode, formTitle }) {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);

  const companyName = settings?.company_name || 'HORIZON SPARKS';
  const logoData = settings?.logo_data;

  return (
    <Box className="form-header-banner" sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, borderBottom: '2px solid', borderColor: 'primary.main' }}>
      <Box className="form-header-logo">
        {logoData ? (
          <img src={logoData} alt={companyName} className="header-logo-img" style={{ height: 40, objectFit: 'contain' }} />
        ) : (
          <Typography sx={{ fontWeight: 800, fontSize: 16, letterSpacing: 2, color: 'text.primary' }}>{companyName}</Typography>
        )}
      </Box>
      <Box className="form-header-info">
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 1 }}>{formCode}</Typography>
        <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary', lineHeight: 1.2 }}>{formTitle}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Quality Control Field Test Report</Typography>
      </Box>
    </Box>
  );
}
