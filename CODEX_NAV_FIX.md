**Problem 1: Admin Home Navigation (`App.jsx`)**

`goBack` and `goHome` are here:
- [client/src/App.jsx:199](/home/horizonsparks/voice-report/client/src/App.jsx:199)
- [client/src/App.jsx:318](/home/horizonsparks/voice-report/client/src/App.jsx:318)

What they do now (exact behavior):

1. `goBack`:
- Calls `viewRef.current?.tryGoBack?.()` first and returns if handled by child view.
- If `viewHistory` has entries, pops one and `setView(prev)`.
- If history is empty, sets fallback view:
  - `control-center` for `sparks_role === 'admin' || 'support'`
  - otherwise `home`.

2. `goHome`:
- Calls `viewRef.current?.tryGoHome?.()` first and returns if handled by child view.
- Chooses home target:
  - `control-center` for `admin/support`
  - otherwise `home`.
- Then clears view/history/UI state (`setViewHistory([])`, close menu, clear person/report selections).

So in this checkout, Problem 1 is already fixed.  
If your deployed `App.jsx` is older, this is the exact fix to apply:

```jsx
// goBack empty-history fallback
const fallbackView = (user?.sparks_role === 'admin' || user?.sparks_role === 'support')
  ? 'control-center'
  : 'home';
setView(fallbackView);

// goHome destination
const homeView = (user?.sparks_role === 'admin' || user?.sparks_role === 'support')
  ? 'control-center'
  : 'home';
setView(homeView);
```

---

**Problem 2: PWA stale JS cache**

I made the exact code changes below.

### 1) Service worker: stop caching JS/CSS bundles, force network for them
Updated:
- [client/public/sw.js](/home/horizonsparks/voice-report/client/public/sw.js)
- [dist/sw.js](/home/horizonsparks/voice-report/dist/sw.js)

Key edits:
- `CACHE_NAME` bumped `voice-report-v3` -> `voice-report-v4`
- Added GET-only guard
- Added navigation handler using `fetch(..., { cache: 'no-store' })` with offline fallback to `/`
- Added rule: `.js` / `.css` are **never SW-cached** (`network only`, `no-store`)
- Removed `.js/.css` from cache write conditions

Before:
```js
const CACHE_NAME = 'voice-report-v3';
// ...
if (response.ok && (
  url.pathname.endsWith('.js') ||
  url.pathname.endsWith('.css') ||
  ...
)) {
  cache.put(event.request, clone);
}
```

After:
```js
const CACHE_NAME = 'voice-report-v4';
// ...
if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
  return;
}
```

### 2) Server static caching: make `sw.js` + HTML uncacheable
Updated:
- [server/index.js:91](/home/horizonsparks/voice-report/server/index.js:91)

Before:
```js
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(distPath, 'sw.js'));
});

app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
```

After:
```js
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(distPath, 'sw.js'));
});

app.use(express.static(distPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return;
    }
    if (filePath.includes(`${path.sep}assets${path.sep}`) && (filePath.endsWith('.js') || filePath.endsWith('.css'))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(distPath, 'index.html'));
});
```

Notes:
- `dist/sw.js` changed on disk too; in this repo it is not git-tracked (`git status` only shows `client/public/sw.js` and `server/index.js`).
- After deploy, clients should pull new JS immediately instead of stale SW-served bundles.