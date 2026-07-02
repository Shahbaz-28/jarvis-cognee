export const WORKER_URL =
  "https://jarvis-vo-proxy.shahbaz-khans976.workers.dev";

// For local Worker testing, change to: "http://127.0.0.1:8787"
export const WORKER_CHAT_ENDPOINT = `${WORKER_URL}/chat`;
export const WORKER_TTS_ENDPOINT = `${WORKER_URL}/tts`;
export const WORKER_MEMORY_REMEMBER_ENDPOINT = `${WORKER_URL}/memory/remember`;
export const WORKER_MEMORY_RECALL_ENDPOINT = `${WORKER_URL}/memory/recall`;
export const WORKER_MEMORY_IMPROVE_ENDPOINT = `${WORKER_URL}/memory/improve`;
export const WORKER_MEMORY_FEEDBACK_ENDPOINT = `${WORKER_URL}/memory/feedback`;

/** Recall query for "what was I doing?" style questions */
export const MEMORY_WHAT_WAS_I_DOING_QUERY = "what was I doing?";

/** Broader recall for cross-day Jarvis memory on panel open */
export const MEMORY_LONG_TERM_RECALL_QUERY =
  "What has this user been doing across recent browsing sessions? Include pages visited, tasks, topics, and when they happened if known.";

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
export const DAILY_QUESTION_LIMIT = 500;
