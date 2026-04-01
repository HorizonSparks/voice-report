1. **High:** `SparksCommandCenter` is mounted without `onEnterCompany`, so company simulation actions in Control Center are disabled.
- Component expects it: [SparksCommandCenter.jsx:13](/home/horizonsparks/voice-report/client/src/views/SparksCommandCenter.jsx:13)
- Buttons are gated by it: [SparksCommandCenter.jsx:506](/home/horizonsparks/voice-report/client/src/views/SparksCommandCenter.jsx:506)
- App does not pass it in control-center render: [App.jsx:603](/home/horizonsparks/voice-report/client/src/App.jsx:603)

Everything else you asked checks out in this merge scope:
- `SparksCommandCenter` import itself is valid in [App.jsx:32](/home/horizonsparks/voice-report/client/src/App.jsx:32).
- `sparks.js` and `billing.js` are properly mounted in [server/index.js:79](/home/horizonsparks/voice-report/server/index.js:79) and [server/index.js:80](/home/horizonsparks/voice-report/server/index.js:80), with auth/role middleware inside both routers.
- No duplicate route paths found between `sparks.js` and `billing.js`; no merge-time middleware collision found there.
- Hamburger navigation is internal state navigation (`setView('control-center')`) at [App.jsx:428](/home/horizonsparks/voice-report/client/src/App.jsx:428), not external URL navigation.
- No external `horizonsparks.com` runtime link found (only an internal comment in `App.jsx`).
- No `3080` or `sparks-hub` runtime references found; only a stale mention in [CODEX_AUDIT_APRIL_2026.md:134](/home/horizonsparks/voice-report/CODEX_AUDIT_APRIL_2026.md:134).
- Security fixes are intact:
  - rate limiting: [server/index.js:5](/home/horizonsparks/voice-report/server/index.js:5), [server/index.js:14](/home/horizonsparks/voice-report/server/index.js:14), [server/index.js:23](/home/horizonsparks/voice-report/server/index.js:23)
  - `resolvePersonId`: [server/routes/ai.js:20](/home/horizonsparks/voice-report/server/routes/ai.js:20)
  - edit mode guards: [server/middleware/sessionAuth.js:305](/home/horizonsparks/voice-report/server/middleware/sessionAuth.js:305)
  - self-promotion block: [server/routes/people.js:82](/home/horizonsparks/voice-report/server/routes/people.js:82)
  - session expiry for edit mode: [server/middleware/sessionAuth.js:262](/home/horizonsparks/voice-report/server/middleware/sessionAuth.js:262)