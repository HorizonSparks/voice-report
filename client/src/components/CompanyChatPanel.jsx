import { useState, useEffect } from 'react';
import { Box, Typography, IconButton, Chip } from '@mui/material';
import MessagesView from '../views/MessagesView.jsx';

/**
 * Customer/Company Chat Panel — same 3-column WhatsApp layout as TeamChatPanel
 * but with company-specific sidebar tabs:
 * - Chats (people in the company)
 * - Company Info (name, tier, products, trades)
 * - Analytics (AI usage, costs)
 * - Agent (disabled — coming soon)
 */
export default function CompanyChatPanel({ user, company, companyDetail, companyBilling, companyAnalytics, onBack }) {
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [sidebarTab, setSidebarTab] = useState('chats'); // chats | info | analytics | agent
  const [people, setPeople] = useState([]);
  const [conversations, setConversations] = useState({});

  // Resolve admin ID
  const myId = user.person_id === '__admin__' ? null : user.person_id;
  const chatUser = user;

  useEffect(() => {
    if (company?.id) loadPeople();
  }, [company?.id]);

  const loadPeople = async () => {
    try {
      const res = await fetch(`/api/people?company_id=${encodeURIComponent(company.id)}`);
      if (res.ok) setPeople(await res.json());
    } catch(e) {}
  };

  const selectPerson = (p) => {
    setSelectedPerson({ id: p.id, name: p.name });
    setSidebarTab('chats');
  };

  const statusColors = { active: '#4CAF50', trial: 'var(--primary)', suspended: '#F44336', churned: '#9E9E9E' };
  const fmtCost = (cents) => cents != null ? '$' + (cents / 100).toFixed(2) : '$0.00';

  return (
    <Box sx={{ display: 'flex', overflow: 'hidden', position: 'fixed', top: 68, left: 0, right: 0, bottom: 0, zIndex: 50, bgcolor: 'background.default' }}>
      {/* Column 1: Icon sidebar */}
      <Box sx={{ width: 56, bgcolor: 'var(--charcoal)', display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1.5, gap: 0.5, flexShrink: 0 }}>
        <SidebarIcon icon="chats" active={sidebarTab === 'chats'} onClick={() => setSidebarTab('chats')} />
        <SidebarIcon icon="info" active={sidebarTab === 'info'} onClick={() => setSidebarTab('info')} />
        <SidebarIcon icon="analytics" active={sidebarTab === 'analytics'} onClick={() => setSidebarTab('analytics')} />
        <Box sx={{ flex: 1 }} />
        <SidebarIcon icon="agent" active={false} onClick={() => {}} disabled />
        <SidebarIcon icon="back" active={false} onClick={onBack} />
      </Box>

      {/* Column 2: Middle panel */}
      <Box sx={{ width: 320, bgcolor: 'background.paper', borderRight: '1px solid rgba(72,72,74,0.12)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

        {/* CHATS TAB — people in this company */}
        {sidebarTab === 'chats' && (
          <>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid rgba(72,72,74,0.08)' }}>
              <Typography sx={{ fontSize: 16, fontWeight: 800, color: 'text.primary' }}>{company.name}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{people.length} people</Typography>
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto' }}>
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
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>No people in this company yet</Typography>
                </Box>
              )}
            </Box>
          </>
        )}

        {/* INFO TAB — company details */}
        {sidebarTab === 'info' && (
          <>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid rgba(72,72,74,0.08)' }}>
              <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1 }}>Company</Typography>
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
              <Typography sx={{ fontWeight: 800, fontSize: 20, color: 'text.primary', mb: 0.5 }}>{company.name}</Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <Chip label={company.status} size="small" sx={{ bgcolor: statusColors[company.status] || '#ccc', color: 'white', fontWeight: 700, fontSize: 11 }} />
                <Chip label={company.tier} size="small" variant="outlined" sx={{ fontWeight: 700, fontSize: 11 }} />
              </Box>

              <InfoSection title="Products">
                {(companyDetail?.products || []).filter(p => p.status === 'active').map(p => (
                  <Chip key={p.product} label={p.product === 'voice_report' ? 'Voice Report' : 'LoopFolders'} size="small"
                    sx={{ bgcolor: 'var(--primary)', color: 'white', fontWeight: 700, fontSize: 11, mr: 0.5, mb: 0.5 }} />
                ))}
              </InfoSection>

              <InfoSection title="Trades">
                {(companyDetail?.trades || []).filter(t => t.status === 'active').map(t => (
                  <Chip key={t.trade} label={t.trade} size="small" variant="outlined"
                    sx={{ fontWeight: 600, fontSize: 11, mr: 0.5, mb: 0.5, textTransform: 'capitalize' }} />
                ))}
              </InfoSection>

              <InfoSection title="Team">
                <InfoRow label="People" value={`${company.people_count || people.length}`} />
                <InfoRow label="Reports" value={`${company.report_count || companyDetail?.total_reports || 0}`} />
              </InfoSection>

              {companyBilling?.subscription && (
                <InfoSection title="Subscription">
                  <InfoRow label="Plan" value={companyBilling.subscription.plan_name} />
                  <InfoRow label="Status" value={companyBilling.subscription.status} />
                  <InfoRow label="Price" value={fmtCost(companyBilling.subscription.price_cents) + '/mo'} />
                </InfoSection>
              )}

              {company.notes && (
                <InfoSection title="Notes">
                  <Typography sx={{ fontSize: 13, color: 'text.primary' }}>{company.notes}</Typography>
                </InfoSection>
              )}
            </Box>
          </>
        )}

        {/* ANALYTICS TAB */}
        {sidebarTab === 'analytics' && (
          <>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid rgba(72,72,74,0.08)' }}>
              <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary', textTransform: 'uppercase', letterSpacing: 1 }}>Analytics</Typography>
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
              {companyAnalytics ? (
                <>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2 }}>
                    <StatCard label="API Calls" value={companyAnalytics.summary?.total_api_calls || 0} />
                    <StatCard label="AI Cost" value={fmtCost(companyAnalytics.summary?.total_ai_cost_cents)} />
                    <StatCard label="Users" value={companyAnalytics.summary?.unique_users || 0} />
                    <StatCard label="Reports" value={companyDetail?.total_reports || 0} />
                  </Box>
                  {(companyAnalytics.costs?.by_person || []).length > 0 && (
                    <InfoSection title="Top Users">
                      {companyAnalytics.costs.by_person.slice(0, 5).map((p, i) => (
                        <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75 }}>
                          <Typography sx={{ fontSize: 12, color: 'text.primary', fontWeight: 600 }}>{p.person_name || 'Unknown'}</Typography>
                          <Typography sx={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700 }}>{fmtCost(p.total_cost_cents)}</Typography>
                        </Box>
                      ))}
                    </InfoSection>
                  )}
                </>
              ) : (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Loading analytics...</Typography>
                </Box>
              )}
            </Box>
          </>
        )}

        {/* AGENT TAB — disabled */}
        {sidebarTab === 'agent' && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 2, gap: 1.5 }}>
            <Typography sx={{ fontSize: 36 }}>🤖</Typography>
            <Typography sx={{ fontSize: 16, fontWeight: 800, color: 'text.primary' }}>AI Agent</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', textAlign: 'center' }}>Coming soon. Your AI assistant for this company.</Typography>
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
              <Typography sx={{ fontSize: 36 }}>🏢</Typography>
            </Box>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: 'text.primary' }}>{company.name}</Typography>
            <Typography sx={{ fontSize: 14, color: 'text.secondary', textAlign: 'center', maxWidth: 300 }}>
              Select a person to start chatting. View company info, analytics, and documents from the sidebar.
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
    chats: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#F99440' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    info: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#F99440' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
    analytics: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#F99440' : 'rgba(255,255,255,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
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

function InfoSection({ title, children }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 1, mb: 0.75 }}>{title}</Typography>
      {children}
    </Box>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', fontWeight: 600 }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, color: 'text.primary', fontWeight: 700, textTransform: 'capitalize' }}>{value}</Typography>
    </Box>
  );
}

function StatCard({ label, value }) {
  return (
    <Box sx={{ bgcolor: 'rgba(249,148,64,0.06)', borderRadius: 2, p: 1.5, textAlign: 'center' }}>
      <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }}>{value}</Typography>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600 }}>{label}</Typography>
    </Box>
  );
}
