# Jarvis VO — Worker setup

## Local dev

```bash
cd jarvis-vo/worker
cp .dev.vars.example .dev.vars   # add your API keys
npm install
npm run dev
```

Dev server: `http://127.0.0.1:8787`

Set `WORKER_URL` in `src/lib/config.ts` to that URL while testing locally.

## Deploy

```bash
cd jarvis-vo/worker
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy
```

After deploy, copy the `*.workers.dev` URL into `src/lib/config.ts` as `WORKER_URL`.

## Routes

| Route | Purpose |
|-------|---------|
| `POST /chat` | Claude API (streaming + tools) |
| `POST /tts` | ElevenLabs text-to-speech |
| `POST /transcribe-token` | AssemblyAI websocket token |

## Secrets (`.dev.vars` / Wrangler)

- `ANTHROPIC_API_KEY` — required
- `ELEVENLABS_API_KEY` — optional (read aloud)
- `ELEVENLABS_VOICE_ID` — optional
- `ASSEMBLYAI_API_KEY` — optional (streaming voice)
- `COGNEE_API_KEY` — required for memory (from [platform.cognee.ai](https://platform.cognee.ai/) → API Keys)
- `COGNEE_BASE_URL` — tenant URL from dashboard
- `COGNEE_TENANT_ID` — tenant UUID from dashboard
- `COGNEE_DATASET_NAME` — `jarvis_vo` (default)

## Memory routes (Phase 1)

| Route | Cognee API |
|-------|------------|
| `POST /memory/remember` | `POST /api/v1/remember/entry` |
| `POST /memory/recall` | `POST /api/v1/recall` |

After updating `.dev.vars`, deploy secrets:

```bash
cd jarvis-vo/worker
npx wrangler secret put COGNEE_API_KEY
npm run deploy
```
