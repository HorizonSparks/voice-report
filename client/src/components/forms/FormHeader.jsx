import { useState, useEffect } from 'react';

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
    <div className="form-header-banner">
      <div className="form-header-logo">
        {logoData ? (
          <img src={logoData} alt={companyName} className="header-logo-img" />
        ) : (
          <span className="header-logo-text">{companyName}</span>
        )}
      </div>
      <div className="form-header-info">
        <div className="form-header-code">{formCode}</div>
        <h2 className="form-header-title">{formTitle}</h2>
        <div className="form-header-subtitle">Quality Control Field Test Report</div>
      </div>
    </div>
  );
}
