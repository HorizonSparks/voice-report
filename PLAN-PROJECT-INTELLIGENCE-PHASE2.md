# Project Intelligence Agent — Phase 2: Tool-Use Drill-Down

## What This Is
The "Master" agent. Claude Opus with bird's-eye project view AND the ability to 
drill down into specific loop folders, P&IDs, and Excel data using tools.

**Agent ID**: `loopfolders.projectIntelligence.v1`  
**Model**: Claude Opus (worth the cost — this is project-level reasoning)  
**Endpoint**: `POST /api/projects/:id/intelligence`  
**Location**: Voice Report server (same agent runtime as all other agents)

## Architecture Decision: Lives in Voice Report, Not LoopFolders

RD2 stays in Voice Report. The Project Intelligence Agent is a NEW agent definition
using the existing `defineAgent()`/`runAgent()` runtime. LoopFolders frontend calls 
the Voice Report API endpoint. One brain, many interfaces.

Why:
- Agent runtime (defineAgent, runAgent, callClaude, metrics, rate limiting) already exists
- Same `horizon` database — Voice Report already queries `horizonsparks.*` schema
- No infrastructure duplication in LoopFolders (Next.js + Hasura)

---

## Files to Create/Modify

### 1. NEW: `server/services/ai/agents/projectIntelligence.js`
Agent definition with 5 tools + dynamic system prompt.

### 2. MODIFY: `server/services/ai/agents/index.js`
Add `projectIntelligence` to the registry.

### 3. MODIFY: `server/routes/projects.js`
Add `POST /api/projects/:id/intelligence` endpoint.

---

## The 4 Steps (How It Works)

### STEP 1 — Bird's Eye View (auto-loaded into system prompt)
`buildProjectSummary(projectId)` runs 4 queries and builds a compact summary:

```
Project Gillis: 76 loop folders, 12 Excels (10 enhanced), 4 P&IDs processed.
68 folders complete, 8 folders missing Cable Schedule matches.
Area 201C: 45 loops. Area 509A: 31 loops.
Box coverage: P&ID 100%, EXCELs 95%, Cable_Schedule 72%, I/O_List 60%.
```

This goes into the system prompt so Opus can see everything at once.

### STEP 2 — Agent Reasons
Opus reads the summary + user question. It decides what to investigate.
"8 folders missing Cable Schedule matches. Let me check those."

### STEP 3 — Agent Uses Tools
Opus calls tools in a loop until it has enough data:
```
→ get_folder_details(loop_number: "2131")
→ get_pid_tags(file_id: "79b4d881-...")
→ compare_excel_vs_pid(loop_number: "2131")
→ get_missing_documents(project_id: "xxx")
```

### STEP 4 — Agent Reports
Natural language like a senior engineer briefing a PM:
"Loop 2131 has FE, FIT, FIC, FV in the Instrument List but the Cable Schedule
only has circuits for FIT and FIC. The FE and FV cables are missing."

---

## Tool Definitions

### Tool 1: `get_folder_details`
**Purpose**: Full deep-dive on a single loop folder  
**Input**: `{ loop_number: string, project_id: string }`  
**Returns**: folder_values JSONB (Excel matches, per-box mappings), associated files, status, lock state  

**SQL**:
```sql
-- Main folder
SELECT lf.*, f.name as source_file 
FROM horizonsparks.loopfolder lf
LEFT JOIN horizonsparks.files f ON f.id = lf.file_id
WHERE lf.loop_number = $1 AND lf.project_id = $2;

-- Associated files  
SELECT laf.*, f.name as file_name, f.folder, f.status as file_status
FROM horizonsparks.loopfolder_associate_files laf
JOIN horizonsparks.files f ON f.id = laf.file_id
WHERE laf.loop_number = $1 AND laf.project_id = $2;
```

**Post-processing**: Parse folder_values JSONB. For each box (P&ID, Cable_Schedule, etc.), 
extract the mappings and matched files. Return structured: which boxes have data, which are empty.

---

### Tool 2: `get_pid_tags`
**Purpose**: All extracted tags from a specific P&ID file  
**Input**: `{ file_id: string }`  
**Returns**: Parsed tag list with loop_number, tag type, coordinates  

**SQL**:
```sql
SELECT fcl.result, fcl.status, fcl.checked_at, m.name as model_name
FROM horizonsparks.file_check_logs_result_ia fcl
JOIN horizonsparks.model m ON m.id = fcl.model_id
WHERE fcl.file_id = $1 AND fcl.status = 'success'
ORDER BY fcl.checked_at DESC;
```

**Post-processing**: Parse `result` JSON → extract `data[]` array → return each instrument 
with `{ tag, loopNumber, box_type, coordinates }`. Group by loop_number for easy reading.

---

### Tool 3: `compare_excel_vs_pid` (THE KEY TOOL)
**Purpose**: Cross-reference what Excels say about a loop vs what P&ID extraction found  
**Input**: `{ loop_number: string, project_id: string }`  
**Returns**: Side-by-side comparison, highlighting mismatches  

**Logic**:
1. Get folder_values from loopfolder → parse _excelMatches → list of Excel-referenced tags
2. Get folder_values per-box mappings → what each Excel says about this loop (cable_type, service, junction_box, I/O, etc.)
3. Query file_check_logs_result_ia for all P&IDs in this project → filter for tags matching this loop_number
4. Compare:
   - Tags in Excel but NOT in P&ID extraction = **missing from drawing**
   - Tags in P&ID but NOT in Excel = **undocumented instrument**
   - Tags in both = **matched** (with any value mismatches)

**Output shape**:
```json
{
  "loop_number": "2131",
  "excel_tags": ["FE-2131", "FIT-2131", "FIC-2131", "FV-2131"],
  "pid_tags": ["FIT-2131", "FIC-2131"],
  "matched": ["FIT-2131", "FIC-2131"],
  "in_excel_not_pid": ["FE-2131", "FV-2131"],
  "in_pid_not_excel": [],
  "cable_schedule_coverage": {
    "FIT-2131": true,
    "FIC-2131": true,
    "FE-2131": false,
    "FV-2131": false
  },
  "data_quality": {
    "FIT-2131": { "service": "...", "cable_type": "...", "junction_box": "..." },
    "FIC-2131": { "service": "...", "cable_type": "...", "junction_box": "..." }
  }
}
```

---

### Tool 4: `get_missing_documents`
**Purpose**: Find all loop folders in a project where expected boxes are empty  
**Input**: `{ project_id: string, box_name?: string }`  
**Returns**: List of loops and which boxes they're missing  

**SQL**:
```sql
-- Get all loop folders with their folder_values
SELECT lf.loop_number, lf.folder_values, lf.status
FROM horizonsparks.loopfolder lf
WHERE lf.project_id = $1
ORDER BY lf.loop_number;

-- Get all box types (file_folders)
SELECT ff.id, ff.name, ff.is_creator_folder, ff.tag_loop_folder
FROM horizonsparks.file_folders ff
WHERE ff.active = true AND ff.tag_loop_folder = true
ORDER BY ff.position;
```

**Post-processing**: For each loop folder, check folder_values for each box ID.
If a box has no mappings or empty files array, it's "missing." Optionally filter by box_name.

**Output**: `{ missing: [{ loop_number, missing_boxes: ["Cable_Schedule", "I/O_List"] }], summary: { total_loops: 76, fully_covered: 68, partially_covered: 8 } }`

---

### Tool 5: `get_completeness_map`
**Purpose**: Heatmap of all loops in a project — which are complete, which need attention  
**Input**: `{ project_id: string }`  
**Returns**: Per-loop scoring + project-level stats  

**Logic**: For each loop folder, score based on:
- Has P&ID source file? (+1)
- Has Excel matches? (+1 per match, up to 3)
- Has Cable Schedule data? (+1)
- Has I/O data? (+1)
- All expected boxes filled? (+2)
- Is locked (QC approved)? (+2)

**Output**:
```json
{
  "total_loops": 76,
  "score_distribution": { "complete": 52, "partial": 16, "minimal": 8 },
  "by_prefix": { "221A": { "total": 45, "complete": 38 }, "509A": { "total": 31, "complete": 14 } },
  "attention_needed": [
    { "loop_number": "509A-FV-5015", "score": 2, "missing": ["Cable_Schedule", "I/O_List"] }
  ]
}
```

---

## System Prompt Architecture

Dynamic function `(context) => string` that:
1. Calls `buildProjectSummary(context.projectId)` — 4 parallel DB queries
2. Loads ISA instrument knowledge (tag naming conventions, instrument types)
3. Builds prompt:

```
You are the Project Intelligence Agent for Horizon Sparks.

You see the ENTIRE commissioning project at a glance. Your job is to find 
mismatches, gaps, orphaned instruments, missing documents, and incomplete loops.

You have 5 tools to drill down. ALWAYS start with the summary, then investigate.

CURRENT PROJECT SUMMARY:
{summary}

ISA KNOWLEDGE:
{isa_tag_rules}

RULES:
- Report like a senior engineer briefing a PM
- Be specific: "Loop 2131 is missing FE and FV cables" not "some loops have gaps"
- When you find a mismatch, explain WHY it matters
- Prioritize: safety-critical instruments first (ESD, PSV, relief valves)
- Group findings by area/prefix when presenting
```

---

## Agent Definition

```javascript
const projectIntelligence = defineAgent({
  name: 'loopfolders.projectIntelligence.v1',
  model: 'claude-opus-4-20250514',
  systemPrompt: buildProjectIntelligencePrompt, // async function
  tools: [
    { name: 'get_folder_details', description: '...', input_schema: {...} },
    { name: 'get_pid_tags', description: '...', input_schema: {...} },
    { name: 'compare_excel_vs_pid', description: '...', input_schema: {...} },
    { name: 'get_missing_documents', description: '...', input_schema: {...} },
    { name: 'get_completeness_map', description: '...', input_schema: {...} },
  ],
  guardrails: {
    enabled: true,
    maxTokens: 8000,
    timeoutMs: 120000,    // 2 minutes — Opus needs time for deep analysis
    costLimitPerCallCents: 5000,  // $50 cap per call
    blockPII: false,
  },
});
```

---

## API Endpoint

```javascript
// POST /api/projects/:id/intelligence
router.post('/:id/intelligence', requireAuth, requireRoleLevel(3), async (req, res) => {
  const { question } = req.body;
  const projectId = req.params.id;
  
  // Verify project exists and user has access
  // ...
  
  // Tool executor — handles the 5 tools
  const executeTool = async (toolName, toolInput) => {
    switch (toolName) {
      case 'get_folder_details': { /* ... */ }
      case 'get_pid_tags': { /* ... */ }
      case 'compare_excel_vs_pid': { /* ... */ }
      case 'get_missing_documents': { /* ... */ }
      case 'get_completeness_map': { /* ... */ }
    }
  };
  
  // Run agent with tool-use loop
  const result = await runAgentWithTools(projectIntelligence, {
    messages: [{ role: 'user', content: question || 'Analyze this project and report any issues.' }],
    context: { projectId, companyId: req.companyId },
    tracking: { personId: getActor(req).person_id, projectId },
    executeTool,
  });
  
  res.json({ analysis: result.text, usage: result.usage, agent: result.agent });
});
```

---

## Tool-Use Loop Enhancement

The current `runAgent()` returns after ONE Claude call. For tool-use, we need a loop:

```javascript
async function runAgentWithTools(agent, opts) {
  let messages = [...opts.messages];
  let iterations = 0;
  const MAX_ITERATIONS = 10;
  
  while (iterations < MAX_ITERATIONS) {
    const result = await runAgent(agent, { ...opts, messages });
    
    if (result.stop_reason !== 'tool_use') {
      return result; // Final text response
    }
    
    // Extract tool calls from response
    const toolCalls = result.content.filter(b => b.type === 'tool_use');
    
    // Execute tools and build tool_result messages
    const toolResults = await Promise.all(
      toolCalls.map(async (tc) => ({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: await opts.executeTool(tc.name, tc.input),
      }))
    );
    
    // Append assistant response + tool results to conversation
    messages.push({ role: 'assistant', content: result.content });
    messages.push({ role: 'user', content: toolResults });
    iterations++;
  }
}
```

**NOTE**: The existing `callClaude()` in `anthropicClient.js` already handles tool_use 
in the RD2 agent (agent.js line 1822+). But it does it inline. The `runAgent()` function 
does NOT loop — it returns raw. We need `runAgentWithTools()` as a wrapper that loops 
`runAgent()` calls until stop_reason is NOT tool_use.

This wrapper lives in `agentRuntime.js` so ALL future tool-using agents benefit.

---

## Guardrails & Security

- **Auth**: requireAuth + requireRoleLevel(3) — PM/admin only
- **Company isolation**: Project must belong to user's company
- **Cost cap**: $50 per call (Opus is expensive but this is high-value analysis)
- **Timeout**: 2 minutes
- **Iteration cap**: 10 tool calls max per request
- **Rate limit**: Reuse existing agent rate limits (30/5min, 200/hr)

---

## What This Finds (Real Examples from Gillis Data)

Based on the actual `folder_values` JSONB I analyzed:

1. **Missing Cable Schedule**: Loop 221A-PI-2221-03 has Instrument List match, P&ID match, 
   but Cable_Schedule box shows cable_type="PI" with no circuit data
   
2. **Excel cross-reference gaps**: Some loops have 5 Excel matches but 0 Cable Schedule 
   matches — agent reports exactly which loops and which cables are missing

3. **P&ID vs Excel tag conflicts**: If P&ID extraction found FV-2131 but no Excel mentions 
   it, that instrument exists on the drawing but has no documentation

4. **Coverage heatmap**: "Area 509A has 31 loops but only 14 are fully documented. 
   17 loops need Cable Schedule and I/O List data."

---

## Deployment Steps

1. Create `projectIntelligence.js` agent definition
2. Add `runAgentWithTools()` to `agentRuntime.js`
3. Add `buildProjectSummary()` as async system prompt builder
4. Implement 5 tool executors in `projects.js`
5. Register agent in `agents/index.js`
6. Test with Gillis project data
7. Codex review
8. Deploy to Spark
