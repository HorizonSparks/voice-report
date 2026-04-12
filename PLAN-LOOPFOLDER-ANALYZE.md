# Loop Folder Analyze Button — Documentation Completeness Analysis

## Context

The Table view has an Analyze button that catches **tag errors** (OCR mistakes). We need a second Analyze button in the **Loop Folder view** that catches **documentation errors** — missing documents, wrong connections, incomplete loops.

Ellery's insight: an LG (Level Gauge) appeared with Cable Schedule data in Gillis. That's normally wrong (LG is mechanical, no cable), but Shannon confirmed 8 tower gauges actually DO have remote cables. The system should flag this as unusual — not wrong — and let the operator decide.

## Architecture Decision: Programmatic, Not AI

Basic connection checks are deterministic lookups — no need to call Opus for "does FV need a Cable Schedule?" That's a yes/no from the rules file. This makes it:
- **Fast** (~200ms for 100 loops, no AI latency)
- **Free** (no token cost)
- **Deterministic** (same input = same output)

The Project Intelligence Agent (Opus) stays available through the Sparks AI chat for deep cross-loop reasoning.

## Files to Create

### 1. `PIDS-app/src/app/api/projects/[id]/analyze-folders/route.js` (NEW)
Next.js API route. Programmatic analysis using connection rules.

**Logic:**
1. Auth via `getUserRoleAndPermissions` (same pattern as `loopfolder/route.js`)
2. Query all loop folders + file_folders (box types) via Hasura
3. For each loop folder:
   - Extract instrument type from `loop_number` (e.g., `221A-FV-2131-01` → `FV`)
   - Classify: `never_has_cable` / `always_has_cable` / `context_dependent`
   - Check `folder_values` for each box: does it have data?
   - Compare expectation vs reality → generate finding if mismatch
4. Return structured findings array

**Response shape:**
```json
{
  "findings": [{
    "loop_number": "221A-FV-2131-01",
    "instrument_type": "FV",
    "box_name": "Cable_Schedule",
    "box_id": "<uuid>",
    "severity": "error",
    "message": "Control valve (FV) requires Cable Schedule — none found"
  }],
  "summary": { "total_analyzed": 76, "findings": 12, "errors": 5, "warnings": 4, "info": 3 }
}
```

### 2. `PIDS-app/knowledge/instrumentation_connection_rules.json` (COPY)
Copy from Voice Report. Static reference data for the API route.

## Files to Modify

### 3. `PIDS-app/src/sections/project/project-loopfolder-table.jsx` (MODIFY)

**A. New state:**
- `analysisFindings` — Map of `loop_number → { box_id → finding }`
- `analyzing` — loading state

**B. Analyze button** in CardHeader (near existing collapse/expand buttons):
- Outlined button, turns orange with count when findings exist: `Analyze (12)`
- Same pattern as Table view's Analyze button

**C. Finding indicators** on table cells:
- Orange dot on the specific cell (loop_number × box column) where the mismatch is
- Severity colors: red=error (missing required doc), orange=warning (unusual presence), blue=info
- Tooltip shows finding message + two action buttons

**D. Action buttons in tooltip:**
- **Dismiss** — removes the dot (client-side). Operator says "I checked, this is fine."
- **Flag** — calls existing `PATCH /api/projects/:id/loopfolder` with `action: 'flag'` and finding message as comment. Row gets the existing red flag indicator.

**E. No "Apply" button** — documentation gaps can't be auto-fixed. Only Dismiss or Flag.

## Instrument Type Extraction

```
221A-FV-2131-01 → split by '-' → ["221A", "FV", "2131", "01"] → type = "FV"
201C-PSHH-2131-01 → type = "PSHH"
```

Validate against all known tags from `quick_lookup` arrays. Unknown types → skip (no finding).

## Connection Rules Logic

| Instrument Category | Missing Cable Schedule | Has Cable Schedule |
|---|---|---|
| `never_has_cable` (LG, PG, TG, FE, PSV...) | Normal — no finding | **Warning**: unusual, could be remote indicator |
| `always_has_cable` (FIT, FV, XV, PSH...) | **Error**: real gap | Normal — no finding |
| `context_dependent` (PI, TI, ZI, TE...) | Skip — can't determine | Skip — can't determine |
| `no_separate_cable` (PAH, PAHH, alarms) | Normal | **Info**: unusual for software alarm |

Same logic applies to I/O_List column.

## What the Operator Sees

1. Click **Analyze** → button spins briefly → `Analyze (12)` turns orange
2. Orange/red dots appear on specific cells in the table
3. Hover a dot → tooltip: "Control valve (FV) requires Cable Schedule — none found" + [Dismiss] [Flag]
4. **Dismiss** → dot disappears. Operator confirmed it's fine.
5. **Flag** → row gets flagged (existing red flag), finding comment saved. For follow-up.
6. Re-click Analyze → re-runs analysis on current data. Previously dismissed items reappear (dismiss is session-only for now).

## Key Design Decisions

- **Per-cell findings, not per-row** — the dot appears on the exact Cable_Schedule column for that specific loop
- **No AI call** — pure lookup. Fast and free.
- **context_dependent instruments skipped** — can't determine programmatically, use Sparks AI chat for those
- **Dismiss is session-only** — re-running Analyze will re-show dismissed items. Future: persist dismissals.
- **Flag reuses existing infrastructure** — the loop folder already has a flag/unflag toggle with comment field

## Verification

1. Build PIDS-app: `docker compose build web`
2. Open a project with loop folders (Gillis)
3. Click Analyze in the Loop Folder table header
4. Verify orange dots appear on cells where documentation mismatches exist
5. Verify LG loops do NOT show "missing cable" errors (they're mechanical)
6. Verify FV/FIT loops DO show "missing cable" errors if Cable_Schedule is empty
7. Click Dismiss → dot disappears
8. Click Flag → row gets flagged with the finding message
9. Verify no AI calls are made (check network tab — no calls to Voice Report)
