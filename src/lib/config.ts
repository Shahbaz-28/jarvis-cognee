export const WORKER_URL =
  "https://jarvis-vo-proxy.shahbaz-khans976.workers.dev";

// For local Worker testing, change to: "http://127.0.0.1:8787"
export const WORKER_CHAT_ENDPOINT = `${WORKER_URL}/chat`;
export const WORKER_TTS_ENDPOINT = `${WORKER_URL}/tts`;

// ElevenLabs model used for reading answers aloud (fast + cheap)
export const ELEVENLABS_TTS_MODEL = "eleven_flash_v2_5";

// Cheapest vision-capable model (~3x cheaper than Sonnet)
export const CLAUDE_MODEL = "claude-haiku-4-5";

// Short answers only — keeps output token cost low
export const CLAUDE_MAX_TOKENS = 300;

// Higher limit for tool-use agent steps (tool calls need more output room)
export const CLAUDE_AGENT_MAX_TOKENS = 600;

// Pause between chained page actions so menus/animations can settle
export const ORCHESTRATOR_STEP_DELAY_MS = 350;

// Lower quality + smaller width = fewer vision tokens (biggest cost saver)
export const SCREENSHOT_JPEG_QUALITY = 50;
export const SCREENSHOT_MAX_WIDTH_PX = 1280;

// Free-tier guardrail — resets daily in local storage
export const DAILY_QUESTION_LIMIT = 30;
