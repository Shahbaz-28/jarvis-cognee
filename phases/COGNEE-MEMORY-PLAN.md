# Jarvis VO — Cognee Memory Plan

> **Goal:** Turn Jarvis VO from a tab copilot into a friend that remembers what you do, recalls context across sessions, and acts on multi-step instructions.

**Status:** Planning document. Implementation starts when Phase 1 begins.

**Hackathon:** [WeMakeDevs Cognee — Jun 29 – Jul 5, 2026](https://www.wemakedevs.org/hackathons/cognee)

**Docs:**
- [Cognee Cloud](https://docs.cognee.ai/cognee-cloud/overview.md)
- [API Reference](https://docs.cognee.ai/api-reference/introduction.md)
- [Platform](https://platform.cognee.ai/)

---

## Architecture (fixed decisions)

```
Extension  →  jarvis-vo Worker  →  https://api.cognee.ai/api/v1/*
                ↑                      ↑
         COGNEE_API_KEY          X-Api-Key header
         (never in extension)
```

| Setting | Value |
|---------|--------|
| **Auth** | `X-Api-Key: YOUR_KEY` from [platform.cognee.ai](https://platform.cognee.ai/) |
| **Base URL** | `https://api.cognee.ai` |
| **API prefix** | `/api/v1/...` (required on every request) |
| **Dataset** | `jarvis_vo` — one permanent knowledge graph |
| **Session** | `session_id` — one active task/conversation (stored in `chrome.storage`) |

### What we store per turn

Use `POST /api/v1/remember/entry` with entry type `qa`:

- User question + Jarvis answer
- Page URL + title
- Actions performed
- Timestamp

Ref: [Remember endpoint parameters](https://docs.cognee.ai/api-reference/introduction.md)

### What we fetch before answering

Use `POST /api/v1/recall`:

- Query = user question **or** `"what was I doing?"`
- Pass `session_id` → searches session cache first, then permanent graph

Ref: [Recall](https://docs.cognee.ai/core-concepts/main-operations/recall)

### Cognee lifecycle (hackathon scoring)

| Operation | HTTP | When |
|-----------|------|------|
| **remember** | `POST /api/v1/remember/entry` | After each Q&A turn |
| **recall** | `POST /api/v1/recall` | Before answering + "What was I doing?" |
| **improve** | `POST /api/v1/improve` | End session, after 👍 feedback |
| **forget** | `DELETE /api/v1/datasets/{id}` | User marks task done |

Ref: [Improve](https://docs.cognee.ai/core-concepts/main-operations/improve)

---

## Phase 1 — Memory plumbing

**Duration:** ~1 day  
**Goal:** Cognee works end-to-end through the Cloudflare worker.

### Worker — new routes

| Jarvis route | Cognee API | Purpose |
|--------------|------------|---------|
| `POST /memory/remember` | `POST /api/v1/remember/entry` | Save Q&A + page context |
| `POST /memory/recall` | `POST /api/v1/recall` | Fetch relevant memory |
| `POST /memory/improve` | `POST /api/v1/improve` | Promote session → graph |
| `POST /memory/forget` | `DELETE /api/v1/datasets/...` | Archive / clear task |

**Secrets:** add `COGNEE_API_KEY` to `worker/.dev.vars` and Wrangler secrets.

**Swagger (live testing):** [https://api.cognee.ai/docs](https://api.cognee.ai/docs)

### Extension

| Task | File / area |
|------|-------------|
| Memory client | New `src/lib/memory.ts` — calls worker only |
| Save after answer | Hook in background `handleAskWithContext` |
| Session ID | Generate + persist in `chrome.storage` per active task |
| Config | `WORKER_MEMORY_*` endpoints in `src/lib/config.ts` |

### Tasks

- [x] Add Cognee env vars to worker `.dev.vars`
- [x] Implement `/memory/remember` proxy
- [x] Implement `/memory/recall` proxy
- [ ] Deploy worker + `wrangler secret put COGNEE_API_KEY`
- [ ] Test both with `curl` against worker
- [x] Create `src/lib/memory.ts`
- [x] Call `remember()` after each successful orchestrator turn
- [ ] Verify data appears in Cognee Cloud UI

### Done when

- [ ] Ask a question → memory saved to Cognee
- [ ] New browser session → `recall("what was I doing?")` returns prior context
- [ ] No Cognee API key in extension code or repo

---

## Phase 2 — Friend behavior

**Duration:** ~2 days  
**Depends on:** Phase 1  
**Goal:** Jarvis feels like it knows you — not just a chat log.

### Inject memory into the brain

Before the orchestrator runs:

1. Call `recall(session_id + user question)`
2. Inject results into system prompt as **"What you know about this user/task…"**
3. Then run normal Jarvis tool loop

### Friend UX

| Feature | Behavior |
|---------|----------|
| **On panel open** | Auto-recall → banner: *"Last time you were on NiftyPulse checking PE trade…"* |
| **"What was I doing?"** | Button → dedicated recall query |
| **Task label** | Optional name: "Hackathon signup" → stored in memory |
| **Continue** | Recall last step + resume conversation |

### Session lifecycle

| Event | Cognee call |
|-------|-------------|
| End live conversation | `improve({ sessionIds: [current] })` — bridge session into graph |
| 👍 thumbs up | `remember/entry` type `feedback` → then `improve` |
| **Task done** | `forget` — clear session / archive dataset slice |

Ref: [Improve — session bridging](https://docs.cognee.ai/core-concepts/main-operations/improve)

### Tasks

- [ ] Recall before orchestrator in `jarvis-orchestrator.ts` or background handler
- [ ] Update `prompts.ts` with memory injection block
- [ ] UI: "What was I doing?" button in side panel
- [ ] UI: memory status banner on panel open
- [ ] UI: 👍 / 👎 → feedback + improve
- [ ] UI: "Mark task done" → forget
- [ ] Optional: task name input

### Done when

- [ ] Close browser → reopen → Jarvis remembers what you were doing
- [ ] Feedback loop runs `improve` successfully
- [ ] "Mark done" clears active task from memory

---

## Phase 3 — Action Jarvis + hackathon demo

**Duration:** ~2 days  
**Depends on:** Phase 2  
**Goal:** Multi-step instructions work reliably; demo is rehearsed.

### New tools

| Tool | Purpose |
|------|---------|
| `open_url` | Open new tab or navigate current tab |
| `switch_tab` | Move between tabs Jarvis opened |
| `wait_for_page` | Short wait after navigation before read/act |

Add to `src/lib/tools.ts` + content/background handlers.

### Orchestrator prompt rules

- Break 3–4 line instructions into discrete steps
- After each action → `read_page_text` or `capture_screen` to verify
- Max 5–8 tool steps per user turn
- Friend tone: *"Opening GitHub now…"* / *"Done — scrolling down."*

### Hackathon demo script (~2 min)

1. Browse a site, ask questions, scroll
2. Close browser (or simulate "next day")
3. Open Jarvis → **"What was I doing?"**
4. **"Continue"** — picks up the task
5. 👍 → `improve()`
6. **"Mark done"** → `forget()`
7. Show README + mention all four Cognee APIs

**Pick 2 sites that always work** — do not demo on login/CAPTCHA pages.

### Tasks

- [ ] Implement `open_url` tool
- [ ] Implement `switch_tab` tool
- [ ] Implement `wait_for_page` helper
- [ ] Update orchestrator prompt for multi-step + verify loop
- [ ] Rehearse demo script twice
- [ ] Record demo video
- [ ] Update README with architecture + Cognee usage
- [ ] Final git commits through submission day

### Done when

- [ ] *"Open X, scroll down, tell me about it"* works on 2 fixed demo sites
- [ ] All four Cognee APIs demonstrated live
- [ ] Submission ready (repo + video + README)

---

## Build order (do not skip)

```
Phase 1  →  Worker Cognee routes + remember/recall wired
Phase 2  →  Prompt injection + friend UI + improve/forget
Phase 3  →  open_url/switch_tab + multi-step prompt + demo
```

---

## What NOT to do

- Put `COGNEE_API_KEY` in the extension
- Call Cognee directly from the browser (CORS + security)
- Use only `chrome.storage` for hackathon memory (judges want Cognee depth)
- Build `open_url` before remember/recall works
- Demo on random sites without rehearsal

---

## Phase 1 — start checklist (day one)

1. Get API key from [platform.cognee.ai](https://platform.cognee.ai/)
2. Add to `worker/.dev.vars`: `COGNEE_API_KEY=...`
3. Implement `POST /memory/remember` + `POST /memory/recall` in worker
4. Test with `curl`
5. Hook extension after each answer

---

## References

| Topic | Link |
|-------|------|
| Cognee Cloud overview | https://docs.cognee.ai/cognee-cloud/overview.md |
| API introduction | https://docs.cognee.ai/api-reference/introduction.md |
| Recall | https://docs.cognee.ai/core-concepts/main-operations/recall |
| Improve | https://docs.cognee.ai/core-concepts/main-operations/improve |
| Search & recall (Cloud) | https://docs.cognee.ai/cognee-cloud/functionality/search-and-recall |
| Interactive API docs | https://api.cognee.ai/docs |
