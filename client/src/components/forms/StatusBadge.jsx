export default function StatusBadge({ status }) {
  const labels = {
    not_started: 'START',
    draft: 'Draft',
    submitted: 'Submitted',
    approved: 'Approved',
    rejected: 'Rejected',
  };
  return <span className={`badge badge-${status}`}>{labels[status] || status}</span>;
}
