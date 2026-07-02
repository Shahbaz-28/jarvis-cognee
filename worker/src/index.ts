/**
 * Jarvis VO proxy worker
 *
 * API keys live here as secrets — not in the extension.
 *
 * Routes:
 *   POST /chat               → Anthropic Claude API (streaming)
 *   POST /tts                → ElevenLabs TTS API
 *   POST /transcribe-token   → AssemblyAI websocket token
 *   POST /memory/remember    → Cognee remember/entry
 *   POST /memory/recall      → Cognee recall
 *   POST /memory/improve     → Cognee improve (bridge session → graph)
 *   POST /memory/feedback    → Cognee remember/entry (feedback)
 */

import {
  improveMemorySession,
  recallMemory,
  rememberAnswerFeedback,
  rememberConversationTurn,
  type CogneeWorkerEnv,
  type FeedbackEntryRequestBody,
  type ImproveSessionRequestBody,
  type RecallRequestBody,
  type RememberTurnRequestBody,
} from "./cognee";

interface Env extends CogneeWorkerEnv {
  ANTHROPIC_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
  ASSEMBLYAI_API_KEY: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(headers: Record<string, string> = {}): Record<string, string> {
  return { ...CORS_HEADERS, ...headers };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: withCors(),
      });
    }

    try {
      if (url.pathname === "/chat") {
        return await handleChat(request, env);
      }

      if (url.pathname === "/tts") {
        return await handleTTS(request, env);
      }

      if (url.pathname === "/transcribe-token") {
        return await handleTranscribeToken(env);
      }

      if (url.pathname === "/memory/remember") {
        return await handleMemoryRemember(request, env);
      }

      if (url.pathname === "/memory/recall") {
        return await handleMemoryRecall(request, env);
      }

      if (url.pathname === "/memory/improve") {
        return await handleMemoryImprove(request, env);
      }

      if (url.pathname === "/memory/feedback") {
        return await handleMemoryFeedback(request, env);
      }
    } catch (error) {
      console.error(`[${url.pathname}] Unhandled error:`, error);
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: withCors({ "content-type": "application/json" }),
      });
    }

    return new Response("Not found", { status: 404, headers: withCors() });
  },
};

async function handleChat(request: Request, env: Env): Promise<Response> {
  const body = await request.text();

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[/chat] Anthropic API error ${response.status}: ${errorBody}`);
    return new Response(errorBody, {
      status: response.status,
      headers: withCors({ "content-type": "application/json" }),
    });
  }

  return new Response(response.body, {
    status: response.status,
    headers: withCors({
      "content-type": response.headers.get("content-type") || "text/event-stream",
      "cache-control": "no-cache",
    }),
  });
}

async function handleTranscribeToken(env: Env): Promise<Response> {
  const response = await fetch(
    "https://streaming.assemblyai.com/v3/token?expires_in_seconds=480",
    {
      method: "GET",
      headers: {
        authorization: env.ASSEMBLYAI_API_KEY,
      },
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[/transcribe-token] AssemblyAI token error ${response.status}: ${errorBody}`
    );
    return new Response(errorBody, {
      status: response.status,
      headers: withCors({ "content-type": "application/json" }),
    });
  }

  const data = await response.text();
  return new Response(data, {
    status: 200,
    headers: withCors({ "content-type": "application/json" }),
  });
}

async function handleTTS(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const voiceId = env.ELEVENLABS_VOICE_ID;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body,
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[/tts] ElevenLabs API error ${response.status}: ${errorBody}`);
    return new Response(errorBody, {
      status: response.status,
      headers: withCors({ "content-type": "application/json" }),
    });
  }

  return new Response(response.body, {
    status: response.status,
    headers: withCors({
      "content-type": response.headers.get("content-type") || "audio/mpeg",
    }),
  });
}

async function handleMemoryRemember(
  request: Request,
  env: Env
): Promise<Response> {
  const requestBody = (await request.json()) as RememberTurnRequestBody;
  const cogneeResult = await rememberConversationTurn(env, requestBody);

  return new Response(JSON.stringify(cogneeResult), {
    status: 200,
    headers: withCors({ "content-type": "application/json" }),
  });
}

async function handleMemoryRecall(
  request: Request,
  env: Env
): Promise<Response> {
  const requestBody = (await request.json()) as RecallRequestBody;
  const cogneeResult = await recallMemory(env, requestBody);

  return new Response(JSON.stringify(cogneeResult), {
    status: 200,
    headers: withCors({ "content-type": "application/json" }),
  });
}

async function handleMemoryImprove(
  request: Request,
  env: Env
): Promise<Response> {
  const requestBody = (await request.json()) as ImproveSessionRequestBody;
  const cogneeResult = await improveMemorySession(env, requestBody);

  return new Response(JSON.stringify(cogneeResult), {
    status: 200,
    headers: withCors({ "content-type": "application/json" }),
  });
}

async function handleMemoryFeedback(
  request: Request,
  env: Env
): Promise<Response> {
  const requestBody = (await request.json()) as FeedbackEntryRequestBody;
  const cogneeResult = await rememberAnswerFeedback(env, requestBody);

  return new Response(JSON.stringify(cogneeResult), {
    status: 200,
    headers: withCors({ "content-type": "application/json" }),
  });
}
