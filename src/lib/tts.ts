import { ELEVENLABS_TTS_MODEL, WORKER_TTS_ENDPOINT } from "./config";

export class TextToSpeechError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextToSpeechError";
  }
}

interface SpeakAnswerCallbacks {
  onPlaybackEnded?: () => void;
  onPlaybackError?: (message: string) => void;
}

// Only one answer is ever spoken at a time. These module-level handles let us
// stop the previous clip (and free its memory) before starting a new one.
let currentlyPlayingAudio: HTMLAudioElement | null = null;
let currentAudioObjectUrl: string | null = null;

export function stopSpeaking(): void {
  if (currentlyPlayingAudio) {
    currentlyPlayingAudio.onended = null;
    currentlyPlayingAudio.onerror = null;
    currentlyPlayingAudio.pause();
    currentlyPlayingAudio.src = "";
    currentlyPlayingAudio = null;
  }

  if (currentAudioObjectUrl) {
    URL.revokeObjectURL(currentAudioObjectUrl);
    currentAudioObjectUrl = null;
  }
}

async function extractTtsErrorMessage(response: Response): Promise<string> {
  let responseBody = "";
  try {
    responseBody = await response.text();
  } catch {
    return `Voice service error (${response.status}).`;
  }

  try {
    const parsed = JSON.parse(responseBody) as {
      error?: string | { message?: string };
      detail?: { message?: string };
    };

    if (typeof parsed.error === "string") {
      return parsed.error;
    }
    if (parsed.error?.message) {
      return parsed.error.message;
    }
    if (parsed.detail?.message) {
      return parsed.detail.message;
    }
  } catch {
    // Fall through to generic message.
  }

  return `Voice service error (${response.status}).`;
}

export async function speakAnswerText(
  answerText: string,
  callbacks: SpeakAnswerCallbacks = {}
): Promise<void> {
  stopSpeaking();

  const trimmedAnswerText = answerText.trim();
  if (!trimmedAnswerText) {
    return;
  }

  let response: Response;
  try {
    response = await fetch(WORKER_TTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: trimmedAnswerText,
        model_id: ELEVENLABS_TTS_MODEL,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });
  } catch {
    throw new TextToSpeechError(
      "Could not reach the voice service. Check your connection and try again."
    );
  }

  if (!response.ok) {
    throw new TextToSpeechError(await extractTtsErrorMessage(response));
  }

  const audioBlob = await response.blob();
  if (audioBlob.size === 0) {
    throw new TextToSpeechError("The voice service returned empty audio.");
  }

  const audioObjectUrl = URL.createObjectURL(audioBlob);

  return new Promise<void>((resolve, reject) => {
    const audioElement = new Audio(audioObjectUrl);

    currentlyPlayingAudio = audioElement;
    currentAudioObjectUrl = audioObjectUrl;

    audioElement.onended = () => {
      stopSpeaking();
      callbacks.onPlaybackEnded?.();
      resolve();
    };

    audioElement.onerror = () => {
      stopSpeaking();
      callbacks.onPlaybackError?.("Could not play the answer audio.");
      resolve();
    };

    void audioElement.play().catch(() => {
      stopSpeaking();
      reject(new TextToSpeechError("Could not start audio playback."));
    });
  });
}
