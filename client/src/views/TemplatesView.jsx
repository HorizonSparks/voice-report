import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Paper,
  CircularProgress,
  Chip,
} from '@mui/material';
import { TRADES } from '../utils/helpers.js';

// TRADES imported from helpers
// const TRADES = ['Electrical', 'Instrumentation', 'Pipe Fitting', 'Industrial Erection', 'Safety'];

export default function TemplatesView() {
  const [allTemplates, setAllTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [addingToTrade, setAddingToTrade] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetch('/api/templates').then(r => r.json()).then(t => {
      Promise.all(t.map(tmpl => fetch(`/api/templates/${tmpl.id}`).then(r => r.json())))
        .then(full => { setAllTemplates(full); setLoading(false); });
    });
  };
  useEffect(load, []);

  const startNew = (trade) => {
    setForm({
      template_name: '', trade, role_level: 1, role_level_title: '',
      role_description: '', report_focus: '',
      output_sections: ['Work Completed', 'Issues', 'Safety Observations', 'Notes'],
      vocabulary: { terms: [] }, language_notes: '',
    });
    setEditing('new');
    setAddingToTrade(trade);
  };

  const startEdit = (template) => { setForm({ ...template }); setEditing(template.id); };

  const save = async () => {
    const method = editing === 'new' ? 'POST' : 'PUT';
    const url = editing === 'new' ? '/api/templates' : `/api/templates/${editing}`;
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setEditing(null);
    setAddingToTrade(null);
    setLoading(true);
    load();
  };

  if (loading) {
    return (
      <Box className="loading" sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (editing !== null) {
    return (
      <Box className="admin-form">
        <Button className="back-btn" onClick={() => { setEditing(null); setAddingToTrade(null); }}>
          ← Back
        </Button>
        <Typography variant="h4" component="h1">
          {editing === 'new' ? `New ${addingToTrade} Role` : `Edit: ${form.template_name}`}
        </Typography>

        <TextField
          className="admin-label"
          label="Role Name"
          fullWidth
          value={form.template_name || ''}
          onChange={e => setForm(f => ({ ...f, template_name: e.target.value }))}
          placeholder="e.g. Foreman, Helper"
          margin="normal"
        />
        <TextField
          className="admin-label"
          label="Trade"
          fullWidth
          value={form.trade || ''}
          slotProps={{ htmlInput: { readOnly: true } }}
          sx={{ '& .MuiInputBase-input': { bgcolor: 'grey.100', color: 'text.secondary' } }}
          margin="normal"
        />
        <TextField
          className="admin-label"
          label="Role Level"
          fullWidth
          type="number"
          slotProps={{ htmlInput: { min: 1 } }}
          value={form.role_level || 1}
          onChange={e => setForm(f => ({ ...f, role_level: parseInt(e.target.value) }))}
          margin="normal"
        />
        <TextField
          className="admin-label"
          label="Role Level Title"
          fullWidth
          value={form.role_level_title || ''}
          onChange={e => setForm(f => ({ ...f, role_level_title: e.target.value }))}
          margin="normal"
        />
        <TextField
          className="admin-label"
          label="Role Description"
          fullWidth
          multiline
          rows={4}
          value={form.role_description || ''}
          onChange={e => setForm(f => ({ ...f, role_description: e.target.value }))}
          margin="normal"
        />
        <TextField
          className="admin-label"
          label="Report Focus"
          fullWidth
          multiline
          rows={3}
          value={form.report_focus || ''}
          onChange={e => setForm(f => ({ ...f, report_focus: e.target.value }))}
          margin="normal"
        />
        <TextField
          className="admin-label"
          label="Output Sections (one per line)"
          fullWidth
          multiline
          rows={6}
          value={(form.output_sections || []).join('\n')}
          onChange={e => setForm(f => ({ ...f, output_sections: e.target.value.split('\n').filter(s => s.trim()) }))}
          margin="normal"
        />
        <TextField
          className="admin-label"
          label="Vocabulary Terms (comma-separated)"
          fullWidth
          multiline
          rows={4}
          value={form.vocabulary?.terms?.join(', ') || ''}
          onChange={e => setForm(f => ({ ...f, vocabulary: { ...f.vocabulary, terms: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } }))}
          margin="normal"
        />
        <TextField
          className="admin-label"
          label="Language Notes"
          fullWidth
          multiline
          rows={3}
          value={form.language_notes || ''}
          onChange={e => setForm(f => ({ ...f, language_notes: e.target.value }))}
          margin="normal"
        />

        <Typography variant="h5" component="h2" className="admin-section-title" sx={{ mt: 3, mb: 1 }}>
          Safety Basics
        </Typography>
        <TextField
          className="admin-label"
          label="Safety Rules (one per line)"
          fullWidth
          multiline
          rows={6}
          value={(form.safety_rules || []).join('\n')}
          onChange={e => setForm(f => ({ ...f, safety_rules: e.target.value.split('\n').filter(s => s.trim()) }))}
          placeholder={"PPE required at all times\nLOTO before any electrical work\nFall protection above 6 feet..."}
          margin="normal"
        />
        <TextField
          className="admin-label"
          label="Safety Vocabulary (comma-separated)"
          fullWidth
          multiline
          rows={3}
          value={(form.safety_vocabulary || []).join(', ')}
          onChange={e => setForm(f => ({ ...f, safety_vocabulary: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
          placeholder="PPE, LOTO, JSA, confined space, hot work..."
          margin="normal"
        />
        <TextField
          className="admin-label"
          label="Tools & Equipment Safety (one per line)"
          fullWidth
          multiline
          rows={4}
          value={(form.tools_and_equipment || []).join('\n')}
          onChange={e => setForm(f => ({ ...f, tools_and_equipment: e.target.value.split('\n').filter(s => s.trim()) }))}
          placeholder={"Inspect tools before use\nScaffolds must be tagged\nGround all portable equipment..."}
          margin="normal"
        />

        <Box className="action-row" sx={{ mt: 2 }}>
          <Button className="btn btn-primary btn-lg" variant="contained" size="large" onClick={save}>
            Save Template
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box className="list-view">
      <Typography variant="h4" component="h1">Templates</Typography>
      {TRADES.map(trade => {
        const tradeTemplates = allTemplates.filter(t => t.trade === trade);
        return (
          <Box key={trade} className="trade-group" sx={{ mb: 3 }}>
            <Box className="trade-header" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="h5" component="h2" className="trade-title">{trade}</Typography>
              <Button className="btn btn-sm trade-add-btn" size="small" onClick={() => startNew(trade)}>
                + Add Role
              </Button>
            </Box>
            {tradeTemplates.length === 0 ? (
              <Typography className="trade-empty" sx={{ color: 'text.secondary' }}>No roles yet</Typography>
            ) : (
              <Box className="report-list">
                {tradeTemplates.map(t => (
                  <Paper
                    key={t.id}
                    className="report-card"
                    component="button"
                    onClick={() => startEdit(t)}
                    sx={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      cursor: 'pointer',
                      p: 2,
                      mb: 1,
                      border: 'none',
                      background: 'inherit',
                    }}
                    elevation={1}
                  >
                    <Box className="report-card-header" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography className="report-date" sx={{ fontWeight: 700, color: 'text.primary' }}>
                        {t.template_name}
                      </Typography>
                      <Typography className="report-duration" sx={{ color: 'text.secondary' }}>
                        {t.role_level_title} (Level {t.role_level})
                      </Typography>
                    </Box>
                    <Typography className="report-preview" sx={{ color: 'text.secondary', mt: 0.5 }}>
                      {t.output_sections ? t.output_sections.join(' · ') : ''}
                    </Typography>
                    <Box className="template-stats" sx={{ mt: 1 }}>
                      <Chip
                        label={`${t.vocabulary?.terms?.length || 0} vocabulary terms`}
                        size="small"
                        variant="outlined"
                      />
                    </Box>
                  </Paper>
                ))}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
