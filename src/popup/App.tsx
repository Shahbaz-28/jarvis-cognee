import { useEffect, useRef, useState } from "react";
import { DAILY_QUESTION_LIMIT } from "../lib/config";
import {
  captureActiveTabScreenshot,
  getActiveBrowserTab,
  ScreenshotCaptureError,
} from "../lib/capture";
import {
  buildDomContextForQuestion,
  fetchDomSnapshotFromTab,
  resolveCapturePolicy,
  updateSessionDomSnapshot,
} from "../lib/capture-policy";
import {
  appendConversationTurn,
  clearConversationSession,
  clearScreenshotAfterActionFlag,
  createEmptyConversationSession,
  loadConversationSession,
  markActionPerformed,
  saveConversationSession,
  type ConversationSession,
} from "../lib/conversation-session";
import {
  addConversationEntry,
  clearConversationHistory,
  loadConversationHistory,
  type HistoryEntry,
} from "../lib/history";
import { sendMessageToBackground, type ActionResult, type OrchestratorPhase } from "../lib/messaging";
import {
  loadAutoReadAloudEnabled,
  saveAutoReadAloudEnabled,
} from "../lib/settings";
import {
  isSpeechRecognitionSupported,
  startListening,
  stopListening,
} from "../lib/speech";
import { speakAnswerText, stopSpeaking } from "../lib/tts";
import { getRemainingQuestionsToday } from "../lib/usage-limit";
import {
  classifyVoiceCommand,
  voiceCommandStatusMessage,
} from "../lib/voice-commands";
import AnswerPanel from "./components/AnswerPanel";
import AskInput from "./components/AskInput";
import ConversationModeBar from "./components/ConversationModeBar";
import HistoryPanel from "./components/HistoryPanel";
import Waveform from "./components/Waveform";

interface AppProps {
  layout?: "popup" | "sidepanel";
}

const LIVE_CONVERSATION_RESTART_DELAY_MS = 400;
const LIVE_CONVERSATION_ERROR_RESTART_DELAY_MS = 2000;

// Short pause before re-arming the mic during barge-in listening so the
// SpeechRecognition engine has time to release before we start it again.
const BARGE_IN_LISTEN_RESTART_DELAY_MS = 150;

// While the answer is being spoken aloud, the microphone also hears the AI's
// own voice from the speakers. If the words we transcribe are already part of
// the answer being read, treat them as that echo and do NOT count them as the
// user interrupting. Only genuinely new words should trigger a barge-in.
function transcriptLooksLikeSpokenAnswerEcho(
  transcript: string,
  spokenAnswerText: string
): boolean {
  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const normalizedTranscript = normalize(transcript);
  if (!normalizedTranscript) {
    return true;
  }

  const normalizedSpokenAnswer = normalize(spokenAnswerText);
  if (!normalizedSpokenAnswer) {
    return false;
  }

  return normalizedSpokenAnswer.includes(normalizedTranscript);
}

export default function App({ layout = "popup" }: AppProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceStatusMessage, setVoiceStatusMessage] = useState<string | null>(
    null
  );
  const [orchestratorPhase, setOrchestratorPhase] =
    useState<OrchestratorPhase | null>(null);
  const [highlightsApplied, setHighlightsApplied] = useState(0);
  const [actionResults, setActionResults] = useState<ActionResult[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [readAloudStatusMessage, setReadAloudStatusMessage] = useState<
    string | null
  >(null);
  const [autoReadAloudEnabled, setAutoReadAloudEnabled] = useState(true);
  const [liveConversationEnabled, setLiveConversationEnabled] = useState(false);
  const [remainingQuestions, setRemainingQuestions] = useState(
    DAILY_QUESTION_LIMIT
  );
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);

  const pendingVoiceSubmitRef = useRef<string | null>(null);
  const lastFailedQuestionRef = useRef<string | null>(null);
  const liveConversationEnabledRef = useRef(false);
  const isLoadingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isListeningRef = useRef(false);
  const currentlySpokenAnswerRef = useRef("");
  const conversationSessionRef = useRef<ConversationSession | null>(null);

  const isVoiceSupported = isSpeechRecognitionSupported();
  const isSidePanelLayout = layout === "sidepanel";

  useEffect(() => {
    liveConversationEnabledRef.current = liveConversationEnabled;
  }, [liveConversationEnabled]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    getRemainingQuestionsToday()
      .then(setRemainingQuestions)
      .catch(() => {
        // Keep default limit if storage is unavailable.
      });

    loadConversationHistory()
      .then(setHistoryEntries)
      .catch(() => {
        // History is optional.
      });

    loadAutoReadAloudEnabled()
      .then(setAutoReadAloudEnabled)
      .catch(() => {
        // Keep default enabled.
      });

    loadConversationSession()
      .then((storedSession) => {
        conversationSessionRef.current = storedSession;
      })
      .catch(() => {
        // Session restore is optional.
      });

    function handleOrchestratorStatusMessage(
      message: unknown
    ): void {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "ORCHESTRATOR_STATUS" &&
        "phase" in message
      ) {
        const phase = message.phase;
        if (phase === "thinking" || phase === "acting") {
          setOrchestratorPhase(phase);
        }
      }
    }

    chrome.runtime.onMessage.addListener(handleOrchestratorStatusMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleOrchestratorStatusMessage);
    };
  }, []);

  useEffect(() => {
    return () => {
      stopLiveConversation();
    };
  }, []);

  function stopLiveConversation() {
    liveConversationEnabledRef.current = false;
    setLiveConversationEnabled(false);
    stopListening();
    stopSpeaking();
    isListeningRef.current = false;
    isSpeakingRef.current = false;
    currentlySpokenAnswerRef.current = "";
    setIsListening(false);
    setIsSpeaking(false);
  }

  function scheduleLiveConversationListening(delayMs: number) {
    if (!liveConversationEnabledRef.current) {
      return;
    }

    window.setTimeout(() => {
      if (liveConversationEnabledRef.current && !isLoadingRef.current) {
        beginListeningForQuestion();
      }
    }, delayMs);
  }

  function interruptSpokenAnswer() {
    stopSpeaking();
    isSpeakingRef.current = false;
    setIsSpeaking(false);
    currentlySpokenAnswerRef.current = "";
  }

  function handleClassifiedVoiceTranscript(finalTranscript: string) {
    const voiceCommand = classifyVoiceCommand(finalTranscript);

    if (voiceCommand === "stop") {
      interruptSpokenAnswer();
      setQuestion("");
      setVoiceStatusMessage(voiceCommandStatusMessage("stop"));

      if (liveConversationEnabledRef.current) {
        scheduleLiveConversationListening(LIVE_CONVERSATION_RESTART_DELAY_MS);
      }

      return;
    }

    if (voiceCommand === "end") {
      interruptSpokenAnswer();
      setQuestion("");

      if (liveConversationEnabledRef.current) {
        stopLiveConversation();
        setVoiceStatusMessage(voiceCommandStatusMessage("end"));
        return;
      }

      setVoiceStatusMessage(voiceCommandStatusMessage("end"));
      return;
    }

    interruptSpokenAnswer();
    void handleAsk(finalTranscript, { fromVoice: true });
  }

  function beginListeningForQuestion() {
    if (!isVoiceSupported || isLoadingRef.current || isListeningRef.current) {
      return;
    }

    setVoiceStatusMessage(null);
    setError(null);
    pendingVoiceSubmitRef.current = null;
    isListeningRef.current = true;
    setIsListening(true);

    startListening({
      onTranscript: (transcript, isFinal) => {
        // While the answer is being spoken, decide whether this transcript is
        // the user interrupting (barge-in) or just the AI's own voice echoing
        // back into the mic.
        if (isSpeakingRef.current) {
          const isEcho = transcriptLooksLikeSpokenAnswerEcho(
            transcript,
            currentlySpokenAnswerRef.current
          );

          if (isEcho) {
            return;
          }

          // Genuine barge-in — stop talking immediately and capture the user.
          interruptSpokenAnswer();
        }

        setQuestion(transcript);
        if (isFinal && transcript) {
          pendingVoiceSubmitRef.current = transcript;
        }
      },
      onError: (message) => {
        const isNoSpeechError = message.includes("Didn't catch");
        isListeningRef.current = false;
        setIsListening(false);

        // No speech while the answer is still playing just means the user
        // stayed quiet — keep listening for a possible interruption.
        if (isSpeakingRef.current && isNoSpeechError) {
          scheduleLiveConversationListening(BARGE_IN_LISTEN_RESTART_DELAY_MS);
          return;
        }

        if (liveConversationEnabledRef.current && isNoSpeechError) {
          scheduleLiveConversationListening(LIVE_CONVERSATION_RESTART_DELAY_MS);
          return;
        }

        setVoiceStatusMessage(message);

        if (liveConversationEnabledRef.current) {
          scheduleLiveConversationListening(
            LIVE_CONVERSATION_ERROR_RESTART_DELAY_MS
          );
        }
      },
      onEnd: () => {
        isListeningRef.current = false;
        setIsListening(false);

        const finalTranscript = pendingVoiceSubmitRef.current;
        pendingVoiceSubmitRef.current = null;

        const isRealUserTranscript =
          !!finalTranscript &&
          !transcriptLooksLikeSpokenAnswerEcho(
            finalTranscript,
            isSpeakingRef.current ? currentlySpokenAnswerRef.current : ""
          );

        if (isRealUserTranscript) {
          handleClassifiedVoiceTranscript(finalTranscript);
          return;
        }

        // Still speaking and we only heard echo (or silence) — keep the mic
        // armed so the user can still interrupt later in the answer.
        if (isSpeakingRef.current) {
          scheduleLiveConversationListening(BARGE_IN_LISTEN_RESTART_DELAY_MS);
          return;
        }

        if (liveConversationEnabledRef.current) {
          scheduleLiveConversationListening(LIVE_CONVERSATION_RESTART_DELAY_MS);
        }
      },
    });
  }

  // Speak the answer aloud while keeping the microphone open so the user can
  // interrupt (barge-in). TTS is started without awaiting it so listening can
  // run in parallel.
  function startSpeakingWithBargeIn(answerText: string) {
    currentlySpokenAnswerRef.current = answerText;
    setReadAloudStatusMessage(null);
    isSpeakingRef.current = true;
    setIsSpeaking(true);

    void speakAnswerText(answerText, {
      onPlaybackEnded: () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        currentlySpokenAnswerRef.current = "";

        if (liveConversationEnabledRef.current && !isListeningRef.current) {
          scheduleLiveConversationListening(LIVE_CONVERSATION_RESTART_DELAY_MS);
        }
      },
      onPlaybackError: (message) => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        currentlySpokenAnswerRef.current = "";
        setReadAloudStatusMessage(message);

        if (liveConversationEnabledRef.current && !isListeningRef.current) {
          scheduleLiveConversationListening(LIVE_CONVERSATION_RESTART_DELAY_MS);
        }
      },
    }).catch((speechError: unknown) => {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      currentlySpokenAnswerRef.current = "";
      setReadAloudStatusMessage(
        speechError instanceof Error
          ? speechError.message
          : "Could not read the answer aloud."
      );
    });

    // Arm the microphone alongside playback to catch interruptions.
    beginListeningForQuestion();
  }

  async function handleClearHighlights() {
    try {
      await sendMessageToBackground({ type: "CLEAR_HIGHLIGHTS" });
      setHighlightsApplied(0);
    } catch {
      // Ignore clear failures silently.
    }
  }

  async function handleNewConversation() {
    stopLiveConversation();
    setReadAloudStatusMessage(null);
    setQuestion("");
    setAnswer(null);
    setError(null);
    setHighlightsApplied(0);
    setActionResults([]);
    setVoiceStatusMessage(null);
    lastFailedQuestionRef.current = null;
    await clearConversationHistory();
    await clearConversationSession();
    conversationSessionRef.current = null;
    setHistoryEntries([]);
    await handleClearHighlights();
  }

  async function startReadingAnswer(answerText: string): Promise<void> {
    setReadAloudStatusMessage(null);
    setIsSpeaking(true);

    try {
      await speakAnswerText(answerText, {
        onPlaybackEnded: () => {
          setIsSpeaking(false);
        },
        onPlaybackError: (message) => {
          setIsSpeaking(false);
          setReadAloudStatusMessage(message);
        },
      });
    } catch (speechError) {
      setIsSpeaking(false);
      setReadAloudStatusMessage(
        speechError instanceof Error
          ? speechError.message
          : "Could not read the answer aloud."
      );
    }
  }

  async function handleToggleReadAloud() {
    if (isSpeaking) {
      interruptSpokenAnswer();
      return;
    }

    if (!answer) {
      return;
    }

    await startReadingAnswer(answer);
  }

  async function handleAutoReadAloudToggle() {
    const nextAutoReadAloudEnabled = !autoReadAloudEnabled;
    setAutoReadAloudEnabled(nextAutoReadAloudEnabled);
    await saveAutoReadAloudEnabled(nextAutoReadAloudEnabled);

    if (!nextAutoReadAloudEnabled && isSpeaking) {
      interruptSpokenAnswer();
    }
  }

  function handleToggleLiveConversation() {
    if (liveConversationEnabled) {
      stopLiveConversation();
      setVoiceStatusMessage(null);
      return;
    }

    if (!isVoiceSupported) {
      setVoiceStatusMessage("Voice input requires Google Chrome.");
      return;
    }

    setLiveConversationEnabled(true);
    liveConversationEnabledRef.current = true;
    setVoiceStatusMessage(null);
    setError(null);
    beginListeningForQuestion();
  }

  function handleSelectHistoryEntry(entry: HistoryEntry) {
    stopLiveConversation();
    setReadAloudStatusMessage(null);
    setQuestion(entry.question);
    setAnswer(entry.answer);
    setError(null);
    setHighlightsApplied(0);
    setActionResults([]);
  }

  async function handleAsk(
    questionOverride?: string,
    options?: { fromVoice?: boolean }
  ) {
    const trimmedQuestion = (questionOverride ?? question).trim();
    const blockedByListening = isListening && !options?.fromVoice;

    if (!trimmedQuestion || isLoading || blockedByListening) {
      return;
    }

    interruptSpokenAnswer();
    stopListening();
    isListeningRef.current = false;
    setIsListening(false);
    setReadAloudStatusMessage(null);
    setQuestion(trimmedQuestion);
    setIsLoading(true);
    setOrchestratorPhase("thinking");
    setError(null);
    setAnswer(null);
    setHighlightsApplied(0);
    setActionResults([]);
    setVoiceStatusMessage(null);
    lastFailedQuestionRef.current = trimmedQuestion;

    let shouldStartListeningAfter = false;

    try {
      const activeTab = await getActiveBrowserTab();
      if (!activeTab) {
        throw new ScreenshotCaptureError(
          "No active browser tab found. Click the website tab first, then ask again."
        );
      }

      const currentSession =
        conversationSessionRef.current ??
        createEmptyConversationSession(activeTab.url);

      const capturePolicy = resolveCapturePolicy({
        question: trimmedQuestion,
        session: currentSession,
        currentPageUrl: activeTab.url,
      });

      const shouldCaptureScreenshot = capturePolicy.shouldCaptureScreenshot;

      const screenshotBase64 = shouldCaptureScreenshot
        ? await captureActiveTabScreenshot(activeTab)
        : null;

      let currentDomSnapshot = null;
      if (capturePolicy.shouldAttachDomSnapshot) {
        currentDomSnapshot = await fetchDomSnapshotFromTab(activeTab.tabId);
      }

      const domContextText = buildDomContextForQuestion({
        capturePolicy,
        currentSnapshot: currentDomSnapshot,
        previousSnapshotText: currentSession.lastDomSnapshotSummary ?? null,
      });

      const response = await sendMessageToBackground({
        type: "ASK_WITH_CONTEXT",
        question: trimmedQuestion,
        screenshotBase64,
        domContextText,
        tabId: activeTab.tabId,
        windowId: activeTab.windowId,
        pageUrl: activeTab.url,
        priorTurns: currentSession.turns,
      });

      if (response.ok && response.kind === "ask") {
        setAnswer(response.answer);
        setHighlightsApplied(response.highlightsApplied);
        setActionResults(response.actionResults);
        lastFailedQuestionRef.current = null;

        let updatedSession = appendConversationTurn(currentSession, {
          role: "user",
          content: trimmedQuestion,
          pageUrl: activeTab.url,
          hadScreenshot: shouldCaptureScreenshot,
        });
        updatedSession = appendConversationTurn(updatedSession, {
          role: "assistant",
          content: response.answer,
          pageUrl: activeTab.url,
          hadScreenshot: false,
        });

        if (currentSession.needsScreenshotAfterAction) {
          updatedSession = clearScreenshotAfterActionFlag(
            updatedSession,
            activeTab.url
          );
        }

        if (response.actionsPerformed > 0) {
          updatedSession = markActionPerformed(updatedSession);
        }

        let snapshotForSession = currentDomSnapshot;
        if (response.actionsPerformed > 0 && !snapshotForSession) {
          snapshotForSession = await fetchDomSnapshotFromTab(activeTab.tabId);
        }

        updatedSession = updateSessionDomSnapshot(
          updatedSession,
          snapshotForSession
        );

        conversationSessionRef.current = updatedSession;
        await saveConversationSession(updatedSession);

        const updatedHistory = await addConversationEntry(
          trimmedQuestion,
          response.answer
        );
        setHistoryEntries(updatedHistory);
        const updatedRemaining = await getRemainingQuestionsToday();
        setRemainingQuestions(updatedRemaining);

        if (liveConversationEnabledRef.current && autoReadAloudEnabled) {
          // Speak + keep mic open for barge-in. This already re-arms listening.
          setIsLoading(false);
          isLoadingRef.current = false;
          startSpeakingWithBargeIn(response.answer);
          return;
        }

        if (autoReadAloudEnabled) {
          await startReadingAnswer(response.answer);
        } else if (liveConversationEnabledRef.current) {
          shouldStartListeningAfter = true;
        }
      } else if (!response.ok) {
        setError(response.error);
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Failed to reach the background worker.";
      setError(message);
    } finally {
      setIsLoading(false);
      setOrchestratorPhase(null);

      if (shouldStartListeningAfter && liveConversationEnabledRef.current) {
        scheduleLiveConversationListening(LIVE_CONVERSATION_RESTART_DELAY_MS);
      }
    }
  }

  function handleRetry() {
    const questionToRetry = lastFailedQuestionRef.current ?? question;
    if (questionToRetry.trim()) {
      void handleAsk(questionToRetry);
    }
  }

  function handleVoiceToggle() {
    if (liveConversationEnabled) {
      return;
    }

    if (isLoading) {
      return;
    }

    if (isListening) {
      stopListening();
      setIsListening(false);
      return;
    }

    beginListeningForQuestion();
  }

  return (
    <div
      className={`flex flex-col bg-[#f6f7fb] text-slate-800 ${
        isSidePanelLayout
          ? "min-h-screen w-full"
          : "min-h-120 w-[320px]"
      }`}
    >
      <header className="px-4 pt-4 pb-2">
        <div className="atb-card flex items-center gap-3 px-4 py-3">
          <div className="atb-gradient flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M12 2.5 13.7 8l5.5 1.7-5.5 1.7L12 17l-1.7-5.6L4.8 9.7 10.3 8 12 2.5ZM5 15l.8 2.5L8.3 18l-2.5.8L5 21.2 4.2 18.8 1.7 18l2.5-.8L5 15Z" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900">Jarvis VO</h1>
            <p className="text-xs text-slate-500">
              Your friend in this tab
              {isSidePanelLayout ? " · Side panel" : ""}
            </p>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        <ConversationModeBar
          liveConversationEnabled={liveConversationEnabled}
          isListening={isListening}
          isLoading={isLoading}
          isSpeaking={isSpeaking}
          isVoiceSupported={isVoiceSupported}
          orchestratorPhase={orchestratorPhase}
          onToggleLiveConversation={handleToggleLiveConversation}
        />

        <HistoryPanel
          historyEntries={historyEntries}
          onSelectEntry={handleSelectHistoryEntry}
          onNewConversation={() => {
            void handleNewConversation();
          }}
        />

        <AskInput
          question={question}
          isLoading={isLoading}
          isListening={isListening}
          isVoiceSupported={isVoiceSupported}
          liveConversationEnabled={liveConversationEnabled}
          voiceStatusMessage={voiceStatusMessage}
          orchestratorPhase={orchestratorPhase}
          onQuestionChange={setQuestion}
          onSubmit={() => {
            void handleAsk();
          }}
          onVoiceToggle={handleVoiceToggle}
        />

        <AnswerPanel
          answer={answer}
          error={error}
          isLoading={isLoading}
          orchestratorPhase={orchestratorPhase}
          highlightsApplied={highlightsApplied}
          actionResults={actionResults}
          isSpeaking={isSpeaking}
          readAloudStatusMessage={readAloudStatusMessage}
          onClearHighlights={() => {
            void handleClearHighlights();
          }}
          onToggleReadAloud={() => {
            void handleToggleReadAloud();
          }}
          onRetry={error ? handleRetry : undefined}
        />
      </main>

      <footer className="border-t border-[#e7e9f2] bg-white/60 px-4 py-3 text-xs text-slate-500">
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-600">
            <input
              type="checkbox"
              checked={autoReadAloudEnabled}
              onChange={() => {
                void handleAutoReadAloudToggle();
              }}
              className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Auto read answers aloud
          </label>
          <Waveform isActive={isSpeaking} />
        </div>
        <p className="mt-2">
          {remainingQuestions} questions left today · Shortcut: Alt+Shift+A
        </p>
      </footer>
    </div>
  );
}
