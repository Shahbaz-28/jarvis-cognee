export type VoiceCommandType = "stop" | "end" | "question";

const STOP_PHRASES = ["stop", "wait", "be quiet", "pause", "shh", "quiet"];

const END_PHRASES = [
  "thanks",
  "thank you",
  "bye",
  "goodbye",
  "done",
  "that's all",
  "thats all",
  "that is all",
];

const VOICE_COMMAND_FILLER_WORDS = new Set(["please", "now", "just"]);

function normalizeVoiceTranscript(transcript: string): string {
  return transcript
    .toLowerCase()
    .trim()
    .replace(/[^\w\s']/g, "")
    .replace(/\s+/g, " ");
}

function transcriptMatchesCommandPhrase(
  normalizedTranscript: string,
  commandPhrase: string
): boolean {
  if (normalizedTranscript === commandPhrase) {
    return true;
  }

  for (const fillerWord of VOICE_COMMAND_FILLER_WORDS) {
    if (normalizedTranscript === `${fillerWord} ${commandPhrase}`) {
      return true;
    }

    if (normalizedTranscript === `${commandPhrase} ${fillerWord}`) {
      return true;
    }
  }

  return false;
}

function transcriptMatchesAnyCommandPhrase(
  normalizedTranscript: string,
  commandPhrases: string[]
): boolean {
  return commandPhrases.some((commandPhrase) =>
    transcriptMatchesCommandPhrase(normalizedTranscript, commandPhrase)
  );
}

export function classifyVoiceCommand(transcript: string): VoiceCommandType {
  const normalizedTranscript = normalizeVoiceTranscript(transcript);

  if (!normalizedTranscript) {
    return "question";
  }

  if (transcriptMatchesAnyCommandPhrase(normalizedTranscript, STOP_PHRASES)) {
    return "stop";
  }

  if (transcriptMatchesAnyCommandPhrase(normalizedTranscript, END_PHRASES)) {
    return "end";
  }

  return "question";
}

export function voiceCommandStatusMessage(
  commandType: VoiceCommandType
): string | null {
  if (commandType === "stop") {
    return "Stopped speaking — still listening";
  }

  if (commandType === "end") {
    return "Conversation ended";
  }

  return null;
}
