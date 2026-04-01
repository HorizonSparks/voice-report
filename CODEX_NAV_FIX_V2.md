Applied. I traced both files and fixed the actual navigation bugs in `App.jsx`.

**What I traced**
1. Back button logic in [App.jsx](/home/horizonsparks/voice-report/client/src/App.jsx#L571) is correct for `view === 'messages'` (it should render).
2. From Control Center, “Messages” in hamburger was not actually reachable because the entire menu-links block was gated by `view !== "control-center"` (old block around line ~537).
3. Header click no-op root cause: `goHome` checks `viewRef.current?.tryGoHome?.()` ([App.jsx](/home/horizonsparks/voice-report/client/src/App.jsx#L318)), but `SparksCommandCenter` was not wired to `ref`, so internal screen navigation handler never ran.
4. `goBack` fallback already matches requirement: admin/support -> `'control-center'`, others -> `'home'` ([App.jsx](/home/horizonsparks/voice-report/client/src/App.jsx#L207)).

**Fixes made**
- File changed: [App.jsx](/home/horizonsparks/voice-report/client/src/App.jsx)

1. Enabled menu links while in Control Center (so admin can actually navigate to `messages` and other App views from there).
- Before (old):
```jsx
{/* Menu links — hide in Control Center */}
{view !== "control-center" && (<> ... </>)}
```
- After: [App.jsx:536](/home/horizonsparks/voice-report/client/src/App.jsx#L536)
```jsx
{/* Menu links */}
<>
  ...
</>
```

2. Wired `SparksCommandCenter` to `viewRef` so `tryGoHome` / `tryGoBack` works.
- Before (old):
```jsx
{view === "control-center" && <SparksCommandCenter user={user} ... />}
```
- After: [App.jsx:635](/home/horizonsparks/voice-report/client/src/App.jsx#L635)
```jsx
{view === "control-center" && <SparksCommandCenter ref={viewRef} user={user} ... />}
```

**Answering your 3 points directly**
1. `Messages` sets `view` to `'messages'` via `navigateTo('messages')` ([App.jsx:545](/home/horizonsparks/voice-report/client/src/App.jsx#L545)). Back should show for that state. It wasn’t reachable directly from Control Center before because links were hidden there.
2. Header click “does nothing” was because `tryGoHome` integration path was broken (missing ref attachment), not z-index/click target. `SparksCommandCenter` exposes `tryGoHome` in [SparksCommandCenter.jsx:266](/home/horizonsparks/voice-report/client/src/views/SparksCommandCenter.jsx#L266), and it now gets called.
3. `goBack` empty-history fallback is already correct; no change required.

Build check passed (`npm run -s build`).