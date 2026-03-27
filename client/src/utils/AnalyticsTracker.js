const AnalyticsTracker = {
  sessionId: 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
  queue: [],
  personId: null,
  lastScreen: null,
  lastScreenTime: Date.now(),

  track(eventType, eventName, data = {}) {
    this.queue.push({
      event_type: eventType,
      event_name: eventName,
      event_data: Object.keys(data).length ? JSON.stringify(data) : null,
      screen: data.screen || this.lastScreen || null,
      duration_ms: data.duration_ms || null,
    });
    if (this.queue.length >= 10) this.flush();
  },

  trackScreen(screenName) {
    const now = Date.now();
    const duration = this.lastScreen ? (now - this.lastScreenTime) : null;
    this.track('screen_view', screenName, { screen: screenName, duration_ms: duration });
    this.lastScreen = screenName;
    this.lastScreenTime = now;
  },

  flush() {
    if (!this.queue.length) return;
    const events = this.queue.splice(0);
    try {
      const blob = new Blob([JSON.stringify({
        session_id: this.sessionId,
        person_id: this.personId,
        events,
      })], { type: 'application/json' });
      navigator.sendBeacon('/api/analytics/events', blob);
    } catch(e) { /* silent */ }
  },
};

setInterval(() => AnalyticsTracker.flush(), 5000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') AnalyticsTracker.flush();
});
window.onerror = (msg, src, line) => {
  AnalyticsTracker.track('error', 'js_error', { message: String(msg).substring(0, 200), source: src, line });
};
window.onunhandledrejection = (e) => {
  AnalyticsTracker.track('error', 'promise_rejection', { message: String(e.reason).substring(0, 200) });
};

export default AnalyticsTracker;
