import { useState } from 'react';
import { safeMarkdown } from '../utils/helpers.js';

export default function TabView({ tabs }) {
  const [active, setActive] = useState(0);
  const tab = tabs[active];

  return (
    <div className="tab-view">
      <div className="tab-buttons">
        {tabs.map((t, i) => (
          <button key={i} className={`tab-btn ${i === active ? 'active' : ''}`} onClick={() => setActive(i)}>{t.label}</button>
        ))}
      </div>
      <div className="tab-content">
        {tab.isAudio ? (
          <div className="audio-player">
            {tab.audioFile ? <audio controls src={`/api/audio/${tab.audioFile}`} style={{ width: '100%' }} /> : <p>No audio</p>}
          </div>
        ) : tab.isPlain ? (
          <div className="markdown-content plain">{tab.content || 'No content'}</div>
        ) : (
          <div className="markdown-content" dangerouslySetInnerHTML={{ __html: tab.content ? safeMarkdown(tab.content) : '<p>No content available</p>' }} />
        )}
      </div>
    </div>
  );
}
