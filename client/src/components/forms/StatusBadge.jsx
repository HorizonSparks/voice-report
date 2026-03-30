import { Chip } from '@mui/material';

const statusConfig = {
  not_started: { label: 'START', color: 'default' },
  draft: { label: 'Draft', color: 'warning' },
  submitted: { label: 'Submitted', color: 'info' },
  approved: { label: 'Approved', color: 'success' },
  rejected: { label: 'Rejected', color: 'error' },
};

export default function StatusBadge({ status }) {
  const config = statusConfig[status] || { label: status, color: 'default' };
  return <Chip label={config.label} color={config.color} size="small" sx={{ fontWeight: 700 }} />;
}
