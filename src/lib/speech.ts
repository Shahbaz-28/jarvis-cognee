export type VoiceListenCallbacks = {
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onEnd: () => void;
  onError: (message: string) => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognition;

let activeRecognition: SpeechRecognition | null = null;
let continuousListeningEnabled = false;
let continuousListeningCallbacks: VoiceListenCallbacks | null = null;

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

function attachRecognitionHandlers(
  recognition: SpeechRecognition,
  callbacks: VoiceListenCallbacks,
  continuous: boolean
): void {
  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let interimTranscript = "";
    let finalTranscript = "";

    for (
      let resultIndex = event.resultIndex;
      resultIndex < event.results.length;
      resultIndex += 1
    ) {
      const resultTranscript = event.results[resultIndex][0]?.transcript ?? "";

      if (event.results[resultIndex]?.isFinal) {
        finalTranscript += resultTranscript;
      } else {
        interimTranscript += resultTranscript;
      }
    }

    if (finalTranscript.trim()) {
      callbacks.onTranscript(finalTranscript.trim(), true);
      return;
    }

    if (interimTranscript.trim()) {
      callbacks.onTranscript(interimTranscript.trim(), false);
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (event.error === "not-allowed") {
      callbacks.onError(
        "Microphone access denied. Open chrome://settings/content/microphone and allow access."
      );
      return;
    }

    if (event.error === "no-speech") {
      if (continuous) {
        // Continuous mode restarts on end — silence is normal between turns.
        return;
      }
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

    if (continuous && continuousListeningEnabled && continuousListeningCallbacks) {
      startRecognitionSession(continuousListeningCallbacks, true);
      return;
    }

    callbacks.onEnd();
  };
}

function startRecognitionSession(
  callbacks: VoiceListenCallbacks,
  continuous: boolean
): void {
  const SpeechRecognitionClass = getSpeechRecognitionConstructor();
  if (!SpeechRecognitionClass) {
    callbacks.onError("Voice input requires Google Chrome.");
    return;
  }

  if (activeRecognition) {
    activeRecognition.onend = null;
    activeRecognition.stop();
    activeRecognition = null;
  }

  const recognition = new SpeechRecognitionClass();
  activeRecognition = recognition;
  recognition.continuous = continuous;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  attachRecognitionHandlers(recognition, callbacks, continuous);

  try {
    recognition.start();
  } catch {
    activeRecognition = null;
    callbacks.onError("Could not start voice input. Try again.");
  }
}

export function startListening(callbacks: VoiceListenCallbacks): void {
  continuousListeningEnabled = false;
  continuousListeningCallbacks = null;
  startRecognitionSession(callbacks, false);
}

/** Keeps the mic open across turns — used for live conversation mode. */
export function startContinuousListening(callbacks: VoiceListenCallbacks): void {
  continuousListeningEnabled = true;
  continuousListeningCallbacks = callbacks;
  startRecognitionSession(callbacks, true);
}

export function stopListening(): void {
  continuousListeningEnabled = false;
  continuousListeningCallbacks = null;

  if (!activeRecognition) {
    return;
  }

  activeRecognition.onend = null;
  activeRecognition.stop();
  activeRecognition = null;
}

export function isContinuousListeningActive(): boolean {
  return continuousListeningEnabled;
}
