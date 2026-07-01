export type VoiceListenCallbacks = {
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onEnd: () => void;
  onError: (message: string) => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognition;

let activeRecognition: SpeechRecognition | null = null;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const browserWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return (
    browserWindow.SpeechRecognition ??
    browserWindow.webkitSpeechRecognition ??
    null
  );
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

export function startListening(callbacks: VoiceListenCallbacks): void {
  const SpeechRecognitionClass = getSpeechRecognitionConstructor();
  if (!SpeechRecognitionClass) {
    callbacks.onError("Voice input requires Google Chrome.");
    return;
  }

  stopListening();

  const recognition = new SpeechRecognitionClass();
  activeRecognition = recognition;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let transcript = "";
    for (
      let resultIndex = event.resultIndex;
      resultIndex < event.results.length;
      resultIndex += 1
    ) {
      transcript += event.results[resultIndex][0]?.transcript ?? "";
    }

    const latestResult = event.results[event.results.length - 1];
    const isFinal = latestResult?.isFinal ?? false;
    callbacks.onTranscript(transcript.trim(), isFinal);
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (event.error === "not-allowed") {
      callbacks.onError(
        "Microphone access denied. Open chrome://settings/content/microphone and allow access."
      );
      return;
    }

    if (event.error === "no-speech") {
      callbacks.onError("Didn't catch that — try again.");
      return;
    }

    if (event.error === "aborted") {
      return;
    }

    callbacks.onError(`Voice error: ${event.error}`);
  };

  recognition.onend = () => {
    activeRecognition = null;
    callbacks.onEnd();
  };

  try {
    recognition.start();
  } catch {
    callbacks.onError("Could not start voice input. Try again.");
    activeRecognition = null;
  }
}

export function stopListening(): void {
  if (!activeRecognition) {
    return;
  }

  activeRecognition.stop();
  activeRecognition = null;
}
