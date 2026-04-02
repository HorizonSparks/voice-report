import { useState, useEffect } from 'react';
import { Box, Typography, IconButton, Chip } from '@mui/material';
import MessagesView from '../views/MessagesView.jsx';

/**
 * Messages Hub — WhatsApp 3-column layout for customer communication.
 * Left sidebar: icons (companies, folders, agent)
 * Middle panel: company list → people in selected company
 * Right panel: active chat
 */
export default function MessagesChatPanel({ user, companies, onLoadCompanyDetail, onBack }) {
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [sidebarTab, setSidebarTab] = useState('companies'); // companies | info | analytics | agent
  const [people, setPeople] = useState([]);
  const [companyDetail, setCompanyDetail] = useState(null);

  const chatUser = user;
  const statusColors = { active: '#4CAF50', trial: 'var(--primary)', suspended: '#F44336', churned: '#9E9E9E' };

  const selectCompany = async (company) => {
    setSelectedCompany(company);
    setSelectedPerson(null);
    setSidebarTab('companies');
    // Load people for this company
    try {
      const res = await fetch(`/api/people?company_id=${encodeURIComponent(company.id)}`);
      if (res.ok) setPeople(await res.json());
    } catch(e) {}
    // Load company detail
    try {
      const res = await fetch(`/api/sparks/companies/${company.id}`);
      if (res.ok) setCompanyDetail(await res.json());
    } catch(e) {}
  };

  const selectPerson = (p) => {
    setSelectedPerson({ id: p.id, name: p.name });
  };

  return (
    <Box sx={{ display: 'flex', overflow: 'hidden', position: 'fixed', top: 68, left: 0, right: 0, bottom: 0, zIndex: 50, bgcolor: 'background.default' }}>
      {/* Column 1: Icon sidebar */}
      <Box sx={{ width: 56, bgcolor: 'var(--charcoal)', display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1.5, gap: 0.5, flexShrink: 0 }}>
        <SidebarIcon icon="companies" active={sidebarTab === 'companies'} onClick={() => setSidebarTab('companies')} />
        <SidebarIcon icon="info" active={sidebarTab === 'info'} onClick={() => setSidebarTab('info')} disabled={!selectedCompany} />
        <SidebarIcon icon="analytics" active={sidebarTab === 'analytics'} onClick={() => setSidebarTab('analytics')} disabled={!selectedCompany} />
        <SidebarIcon icon="folders" active={sidebarTab === 'folders'} onClick={() => setSidebarTab('folders')} disabled={!selectedCompany} />
        <Box sx={{ flex: 1 }} />
        <SidebarIcon icon="agent" active={false} onClick={() => {}} disabled />
        <SidebarIcon icon="back" active={false} onClick={onBack} />
      </Box>

      {/* Column 2: Middle panel */}
      <Box sx={{ width: 320, bgcolor: 'background.paper', borderRight: '1px solid rgba(72,72,74,0.12)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

        {/* COMPANIES TAB — company list or people in selected company */}
        {sidebarTab === 'companies' && (
          <>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid rgba(72,72,74,0.08)', display: 'flex', alignItems: 'center', gap: 1 }}>
              {selectedCompany ? (
                <>
                  <IconButton size="small" onClick={() => { setSelectedCompany(null); setSelectedPerson(null); setPeople([]); }} sx={{ color: 'var(--primary)', mr: 0.5, p: 0.5 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                  </IconButton>
                  <Box>
                    <Typography sx={{ fontSize: 16, fontWeight: 800, color: 'text.primary' }}>{selectedCompany.name}</Typography>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{people.length} people</Typography>
                  </Box>
                </>
              ) : (
                <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1 }}>Messages</Typography>
              )}
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto' }}>
              {!selectedCompany ? (
                /* Company list */
                companies.map(c => (
                  <Box key={c.id} onClick={() => selectCompany(c)} sx={{
                    display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5,
                    cursor: 'pointer', borderBottom: '1px solid rgba(72,72,74,0.06)',
                    '&:hover': { bgcolor: 'rgba(249,148,64,0.04)' },
                  }}>
                    <Box sx={{ width: 48, height: 48, borderRadius: '50%', bgcolor: 'var(--charcoal)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                      {c.name.split(' ').map(n => n[0]).join('').substring(0,2)}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: 15, color: 'text.primary', lineHeight: 1.3 }}>{c.name}</Typography>
                      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{c.people_count || 0} people · {c.report_count || 0} reports</Typography>
                    </Box>
                    <Chip label={c.status} size="small" sx={{ bgcolor: statusColors[c.status] || '#ccc', color: 'white', fontWeight: 700, fontSize: 10, height: 20 }} />
                  </Box>
                ))
              ) : (
                /* People in selected company */
                <>
                  {people.map(p => (
                    <Box key={p.id} onClick={() => selectPerson(p)} sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25,
                      cursor: 'pointer', borderBottom: '1px solid rgba(72,72,74,0.06)',
                      bgcolor: selectedPerson?.id === p.id ? 'rgba(249,148,64,0.1)' : 'transparent',
                      borderLeft: selectedPerson?.id === p.id ? '3px solid var(--primary)' : '3px solid transparent',
                      '&:hover': { bgcolor: selectedPerson?.id === p.id ? 'rgba(249,148,64,0.1)' : 'rgba(249,148,64,0.04)' },
                    }}>
                      <Box sx={{ width: 42, height: 42, borderRadius: '50%', bgcolor: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                        {p.name.split(' ').map(n => n[0]).join('').substring(0,2)}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 700, fontSize: 14, color: 'text.primary', lineHeight: 1.3 }}>{p.name}</Typography>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.role_title}{p.trade ? ` · ${p.trade}` : ''}</Typography>
                      </Box>
                    </Box>
                  ))}
                  {people.length === 0 && (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>No people in this company</Typography>
                    </Box>
                  )}
                </>
              )}
            </Box>
          </>
        )}

        {/* INFO TAB */}
        {sidebarTab === 'info' && selectedCompany && (
          <>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid rgba(72,72,74,0.08)' }}>
              <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1 }}>Company</Typography>
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
              <Typography sx={{ fontWeight: 800, fontSize: 20, color: 'text.primary', mb: 0.5 }}>{selectedCompany.name}</Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <Chip label={selectedCompany.status} size="small" sx={{ bgcolor: statusColors[selectedCompany.status] || '#ccc', color: 'white', fontWeight: 700, fontSize: 11 }} />
                <Chip label={selectedCompany.tier || 'standard'} size="small" variant="outlined" sx={{ fontWeight: 700, fontSize: 11 }} />
              </Box>
              <InfoRow label="People" value={`${selectedCompany.people_count || people.length}`} />
              <InfoRow label="Reports" value={`${selectedCompany.report_count || 0}`} />
              {(companyDetail?.products || []).filter(p => p.status === 'active').length > 0 && (
                <Box sx={{ mt: 1.5, mb: 1 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 1, mb: 0.5 }}>Products</Typography>
                  {companyDetail.products.filter(p => p.status === 'active').map(p => (
                    <Chip key={p.product} label={p.product === 'voice_report' ? 'Voice Report' : 'LoopFolders'} size="small"
                      sx={{ bgcolor: 'var(--primary)', color: 'white', fontWeight: 700, fontSize: 11, mr: 0.5, mb: 0.5 }} />
                  ))}
                </Box>
              )}
              {(companyDetail?.trades || []).filter(t => t.status === 'active').length > 0 && (
                <Box sx={{ mt: 1, mb: 1 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 1, mb: 0.5 }}>Trades</Typography>
                  {companyDetail.trades.filter(t => t.status === 'active').map(t => (
                    <Chip key={t.trade} label={t.trade} size="small" variant="outlined"
                      sx={{ fontWeight: 600, fontSize: 11, mr: 0.5, mb: 0.5, textTransform: 'capitalize' }} />
                  ))}
                </Box>
              )}
            </Box>
          </>
        )}

        {/* ANALYTICS TAB */}
        {sidebarTab === 'analytics' && selectedCompany && (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', textAlign: 'center' }}>Analytics for {selectedCompany.name} — coming in next update</Typography>
          </Box>
        )}

        {/* FOLDERS TAB */}
        {sidebarTab === 'folders' && selectedCompany && (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', textAlign: 'center' }}>Shared folders for {selectedCompany.name} — coming in next update</Typography>
          </Box>
        )}

        {(sidebarTab === 'info' || sidebarTab === 'analytics' || sidebarTab === 'folders') && !selectedCompany && (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
            <Typography sx={{ fontSize: 14, color: 'text.secondary', textAlign: 'center' }}>Select a company first</Typography>
          </Box>
        )}
      </Box>

      {/* Column 3: Active chat */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', bgcolor: '#ECE5DD' }}>
        {selectedPerson ? (
          <MessagesView
            key={selectedPerson.id}
            user={chatUser}
            initialContact={selectedPerson}
            embedded
          />
        ) : (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <Box sx={{ width: 80, height: 80, borderRadius: '50%', bgcolor: 'rgba(249,148,64,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ fontSize: 36 }}>{selectedCompany ? '🏢' : '💬'}</Typography>
            </Box>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'text.primary' }}>
              {selectedCompany ? selectedCompany.name : 'Messages'}
            </Typography>
            <Typography sx={{ fontSize: 14, color: 'text.secondary', textAlign: 'center', maxWidth: 300 }}>
              {selectedCompany
                ? 'Select a person to start chatting.'
                : 'Select a company to see their team and start communicating.'}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ---- Sub-components ----

function SidebarIcon({ icon, active, onClick, disabled }) {
  const icons = {
    companies: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#F99440' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    info: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#F99440' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
    analytics: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#F99440' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    folders: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#F99440' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
    agent: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>,
    back: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
  };
  return (
    <IconButton onClick={onClick} disabled={disabled}
      sx={{
        width: 44, height: 44, borderRadius: 1.5,
        bgcolor: active ? 'rgba(249,148,64,0.15)' : 'transparent',
        '&:hover': { bgcolor: 'rgba(249,148,64,0.1)' },
        '&.Mui-disabled': { opacity: 0.3 },
      }}
    >{icons[icon]}</IconButton>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, borderBottom: '1px solid rgba(72,72,74,0.06)' }}>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', fontWeight: 600 }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, color: 'text.primary', fontWeight: 700 }}>{value}</Typography>
    </Box>
  );
}
