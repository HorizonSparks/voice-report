import { useState } from 'react';
import { Box, Tabs, Tab, Typography } from '@mui/material';
import { safeMarkdown } from '../utils/helpers.js';

export default function TabView({ tabs }) {
  const [active, setActive] = useState(0);
  const tab = tabs[active];

  return (
    <Box className="tab-view">
      <Tabs value={active} onChange={(_e, v) => setActive(v)} variant="scrollable" scrollButtons="auto"
        sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: 2 }}>
        {tabs.map((t, i) => (
          <Tab key={i} label={t.label} sx={{ fontWeight: i === active ? 700 : 400, textTransform: 'none' }} />
        ))}
      </Tabs>
      <Box className="tab-content">
        {tab.isAudio ? (
          <Box className="audio-player">
            {tab.audioFile ? <audio controls src={`/api/audio/${tab.audioFile}`} style={{ width: '100%' }} /> : <Typography>No audio</Typography>}
          </Box>
        ) : tab.isPlain ? (
          <Box className="markdown-content plain">{tab.content || 'No content'}</Box>
        ) : (
          <Box className="markdown-content" dangerouslySetInnerHTML={{ __html: tab.content ? safeMarkdown(tab.content) : '<p>No content available</p>' }} />
        )}
      </Box>
    </Box>
  );
}
