import { useState } from 'react';
import { Box, Typography, Button, Paper, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';

export default function TeamAssignment({ person, allPeople, onUpdate }) {
  const [showPicker, setShowPicker] = useState(false);

  const directReports = allPeople.filter(p => p.supervisor_id === person.id);
  const personLevel = person.role_level || 2;
  const assignable = allPeople.filter(p =>
    (p.role_level || 1) === personLevel - 1 &&
    !p.supervisor_id &&
    p.id !== person.id &&
    p.status === 'active'
  );

  const assignPerson = async (subordinateId) => {
    const sub = allPeople.find(p => p.id === subordinateId);
    if (!sub) return;
    sub.supervisor_id = person.id;
    await fetch(`/api/people/${subordinateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    onUpdate();
    setShowPicker(false);
  };

  const unassignPerson = async (subordinateId) => {
    if (!window.confirm('Remove this person from the team?')) return;
    const sub = allPeople.find(p => p.id === subordinateId);
    if (!sub) return;
    sub.supervisor_id = null;
    await fetch(`/api/people/${subordinateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    onUpdate();
  };

  const levelBelow = personLevel === 2 ? 'Journeymen' : personLevel === 3 ? 'Foremen' : personLevel === 4 ? 'General Foremen' : 'Direct Reports';

  return (
    <Paper className="person-bubble" variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
      <Box className="person-bubble-header" sx={{ px: 2, py: 1.5, bgcolor: 'grey.100', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Team ({levelBelow})</Typography>
      </Box>
      <Box className="person-bubble-body" sx={{ p: 2 }}>
        {directReports.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.primary', mb: 1.5 }}>No {levelBelow.toLowerCase()} assigned yet.</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1.5 }}>
            {directReports.map(dr => (
              <Paper key={dr.id} variant="outlined" sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                px: 1.5, py: 1.25, borderRadius: 2,
              }}>
                <Box>
                  <Typography component="span" sx={{ fontWeight: 600, fontSize: 14 }}>{dr.name}</Typography>
                  <Typography component="span" sx={{ fontSize: 12, color: 'text.primary', ml: 1 }}>{dr.role_title}</Typography>
                </Box>
                <IconButton size="small" onClick={() => unassignPerson(dr.id)} sx={{ color: 'warning.main' }}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Paper>
            ))}
          </Box>
        )}

        {showPicker ? (
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, borderColor: 'primary.main' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1, color: 'text.primary' }}>
              Select {levelBelow.toLowerCase()} to assign:
            </Typography>
            {assignable.length === 0 ? (
              <Typography sx={{ fontSize: 13, color: 'text.primary' }}>No unassigned {levelBelow.toLowerCase()} available.</Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {assignable.map(p => (
                  <Button key={p.id} variant="outlined" onClick={() => assignPerson(p.id)} startIcon={<AddIcon />}
                    sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 14, borderRadius: 1.5, py: 1, color: 'text.primary', borderColor: 'grey.200' }}>
                    {p.name} <Typography component="span" sx={{ fontSize: 12, color: 'text.primary', ml: 1 }}>{p.role_title}</Typography>
                  </Button>
                ))}
              </Box>
            )}
            <Button size="small" onClick={() => setShowPicker(false)} sx={{ mt: 1, fontSize: 13, color: 'text.primary' }}>
              Cancel
            </Button>
          </Paper>
        ) : (
          <Button variant="outlined" onClick={() => setShowPicker(true)} startIcon={<AddIcon />}
            sx={{ fontSize: 13, fontWeight: 600, borderRadius: 1.5, px: 2, py: 1, borderColor: 'primary.main', color: 'primary.main' }}>
            Assign Team Member
          </Button>
        )}
      </Box>
    </Paper>
  );
}
