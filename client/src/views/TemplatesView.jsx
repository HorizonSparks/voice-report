import { useState, useEffect } from 'react';
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

  if (loading) return <div className="loading">Loading...</div>;

  if (editing !== null) {
    return (
      <div className="admin-form">
        <button className="back-btn" onClick={() => { setEditing(null); setAddingToTrade(null); }}>← Back</button>
        <h1>{editing === 'new' ? `New ${addingToTrade} Role` : `Edit: ${form.template_name}`}</h1>
        <label className="admin-label">Role Name<input value={form.template_name || ''} onChange={e => setForm(f => ({ ...f, template_name: e.target.value }))} placeholder="e.g. Foreman, Helper" /></label>
        <label className="admin-label">Trade<input value={form.trade || ''} readOnly className="readonly" style={{ background: '#f5f3f0', color: '#7c7568' }} /></label>
        <label className="admin-label">Role Level<input type="number" min={1} value={form.role_level || 1} onChange={e => setForm(f => ({ ...f, role_level: parseInt(e.target.value) }))} /></label>
        <label className="admin-label">Role Level Title<input value={form.role_level_title || ''} onChange={e => setForm(f => ({ ...f, role_level_title: e.target.value }))} /></label>
        <label className="admin-label">Role Description<textarea rows={4} value={form.role_description || ''} onChange={e => setForm(f => ({ ...f, role_description: e.target.value }))} /></label>
        <label className="admin-label">Report Focus<textarea rows={3} value={form.report_focus || ''} onChange={e => setForm(f => ({ ...f, report_focus: e.target.value }))} /></label>
        <label className="admin-label">Output Sections (one per line)
          <textarea rows={6} value={(form.output_sections || []).join('\n')} onChange={e => setForm(f => ({ ...f, output_sections: e.target.value.split('\n').filter(s => s.trim()) }))} />
        </label>
        <label className="admin-label">Vocabulary Terms (comma-separated)
          <textarea rows={4} value={form.vocabulary?.terms?.join(', ') || ''} onChange={e => setForm(f => ({ ...f, vocabulary: { ...f.vocabulary, terms: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } }))} />
        </label>
        <label className="admin-label">Language Notes<textarea rows={3} value={form.language_notes || ''} onChange={e => setForm(f => ({ ...f, language_notes: e.target.value }))} /></label>

        <h2 className="admin-section-title">Safety Basics</h2>
        <label className="admin-label">Safety Rules (one per line)
          <textarea rows={6} value={(form.safety_rules || []).join('\n')} onChange={e => setForm(f => ({ ...f, safety_rules: e.target.value.split('\n').filter(s => s.trim()) }))} placeholder="PPE required at all times&#10;LOTO before any electrical work&#10;Fall protection above 6 feet..." />
        </label>
        <label className="admin-label">Safety Vocabulary (comma-separated)
          <textarea rows={3} value={(form.safety_vocabulary || []).join(', ')} onChange={e => setForm(f => ({ ...f, safety_vocabulary: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} placeholder="PPE, LOTO, JSA, confined space, hot work..." />
        </label>
        <label className="admin-label">Tools & Equipment Safety (one per line)
          <textarea rows={4} value={(form.tools_and_equipment || []).join('\n')} onChange={e => setForm(f => ({ ...f, tools_and_equipment: e.target.value.split('\n').filter(s => s.trim()) }))} placeholder="Inspect tools before use&#10;Scaffolds must be tagged&#10;Ground all portable equipment..." />
        </label>

        <div className="action-row"><button className="btn btn-primary btn-lg" onClick={save}>Save Template</button></div>
      </div>
    );
  }

  return (
    <div className="list-view">
      <h1>Templates</h1>
      {TRADES.map(trade => {
        const tradeTemplates = allTemplates.filter(t => t.trade === trade);
        return (
          <div key={trade} className="trade-group">
            <div className="trade-header">
              <h2 className="trade-title">{trade}</h2>
              <button className="btn btn-sm trade-add-btn" onClick={() => startNew(trade)}>+ Add Role</button>
            </div>
            {tradeTemplates.length === 0 ? (
              <p className="trade-empty">No roles yet</p>
            ) : (
              <div className="report-list">
                {tradeTemplates.map(t => (
                  <button key={t.id} className="report-card" onClick={() => startEdit(t)}>
                    <div className="report-card-header">
                      <span className="report-date" style={{ fontWeight: 700 }}>{t.template_name}</span>
                      <span className="report-duration">{t.role_level_title} (Level {t.role_level})</span>
                    </div>
                    <div className="report-preview">{t.output_sections ? t.output_sections.join(' · ') : ''}</div>
                    <div className="template-stats">{t.vocabulary?.terms?.length || 0} vocabulary terms</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
