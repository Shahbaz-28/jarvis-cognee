import { useEffect, useRef, useState } from "react";
import { DAILY_QUESTION_LIMIT, MEMORY_LONG_TERM_RECALL_QUERY } from "../lib/config";
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
import {
  buildFriendMemoryContext,
  loadFriendMemoryEntries,
} from "../lib/friend-memory";
import { sendMessageToBackground, type ActionResult, type OrchestratorPhase } from "../lib/messaging";
import {
  loadAutoReadAloudEnabled,
  saveAutoReadAloudEnabled,
} from "../lib/settings";
import {
  isSpeechRecognitionSupported,
  startContinuousListening,
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

const LIVE_CONVERSATION_RESTART_DELAY_MS = 800;
const LIVE_CONVERSATION_ERROR_RESTART_DELAY_MS = 2000;

// Short pause before re-arming the mic during barge-in listening so the
// SpeechRecognition engine has time to release before we start it again.
const BARGE_IN_LISTEN_RESTART_DELAY_MS = 150;

// While the answer is being spoken aloud, the microphone also hears the AI's
// own voice from the speakers. Treat overlapping words as echo so we do not
// type the spoken answer back into the ask box.
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

  if (normalizedSpokenAnswer.includes(normalizedTranscript)) {
    return true;
  }

  const transcriptWords = normalizedTranscript.split(" ").filter(Boolean);
  if (transcriptWords.length === 0) {
    return true;
  }

  const spokenAnswerWords = new Set(normalizedSpokenAnswer.split(" ").filter(Boolean));
  const overlappingWordCount = transcriptWords.filter((word) =>
    spokenAnswerWords.has(word)
  ).length;

  return overlappingWordCount / transcriptWords.length >= 0.5;
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
  const [feedbackStatusMessage, setFeedbackStatusMessage] = useState<
    string | null
  >(null);
  const [isFeedbackPending, setIsFeedbackPending] = useState(false);

  const pendingVoiceSubmitRef = useRef<string | null>(null);
  const lastFailedQuestionRef = useRef<string | null>(null);
  const lastAnsweredQuestionRef = useRef<string | null>(null);
  const lastAnsweredAnswerRef = useRef<string | null>(null);
  const backgroundMemoryContextRef = useRef<string | null>(null);
  const liveConversationEnabledRef = useRef(false);
  const isLoadingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isListeningRef = useRef(false);
  const voiceInputPausedRef = useRef(false);
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

    void prefetchBackgroundMemory();

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

  async function prefetchBackgroundMemory(): Promise<void> {
    try {
      const friendMemoryEntries = await loadFriendMemoryEntries();
      const localFriendMemoryContext = buildFriendMemoryContext(
        friendMemoryEntries
      );

      if (localFriendMemoryContext) {
        backgroundMemoryContextRef.current = localFriendMemoryContext;
        return;
      }

      await sendMessageToBackground({ type: "PING" }).catch(() => {
        // Wake the service worker before recall.
      });

      const response = await sendMessageToBackground({
        type: "RECALL_MEMORY",
        query: MEMORY_LONG_TERM_RECALL_QUERY,
      });

      if (response.ok && response.kind === "memory") {
        const recalledText = response.recalledText.trim();
        backgroundMemoryContextRef.current =
          recalledText.length > 0 ? recalledText : null;
      }
    } catch {
      // Memory prefetch is silent — Jarvis still works without it.
    }
  }

  async function handleMarkTaskDoneSilently(): Promise<void> {
    try {
      await sendMessageToBackground({ type: "MARK_TASK_DONE" });
      setFeedbackStatusMessage(null);
      setAnswer(null);
      setError(null);
      void prefetchBackgroundMemory();
    } catch {
      // Best-effort — user can keep working either way.
    }
  }

  async function handleAnswerFeedback(rating: "positive" | "negative"): Promise<void> {
    const questionForFeedback = lastAnsweredQuestionRef.current;
    const answerForFeedback = lastAnsweredAnswerRef.current;

    if (!questionForFeedback || !answerForFeedback) {
      return;
    }

    setIsFeedbackPending(true);
    setFeedbackStatusMessage(null);

    try {
      const response = await sendMessageToBackground({
        type: "SUBMIT_ANSWER_FEEDBACK",
        question: questionForFeedback,
        answer: answerForFeedback,
        rating,
      });

      if (response.ok && response.kind === "memory_action") {
        setFeedbackStatusMessage(response.message);
      } else if (!response.ok) {
        setFeedbackStatusMessage(response.error);
      }
    } catch (feedbackError) {
      setFeedbackStatusMessage(
        feedbackError instanceof Error
          ? feedbackError.message
          : "Could not save feedback."
      );
    } finally {
      setIsFeedbackPending(false);
    }
  }

  async function bridgeMemorySessionOnConversationEnd(): Promise<void> {
    try {
      await sendMessageToBackground({ type: "IMPROVE_MEMORY_SESSION" });
    } catch {
      // Best-effort bridge when live conversation ends.
    }
  }

  useEffect(() => {
    return () => {
      stopLiveConversation();
    };
  }, []);

  function stopLiveConversation() {
    const wasLiveConversationEnabled = liveConversationEnabledRef.current;
    liveConversationEnabledRef.current = false;
    setLiveConversationEnabled(false);
    voiceInputPausedRef.current = false;
    stopListening();
    stopSpeaking();
    isListeningRef.current = false;
    isSpeakingRef.current = false;
    currentlySpokenAnswerRef.current = "";
    setIsListening(false);
    setIsSpeaking(false);

    if (wasLiveConversationEnabled) {
      void bridgeMemorySessionOnConversationEnd();
    }
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

    if (voiceCommand === "task_done") {
      interruptSpokenAnswer();
      setQuestion("");
      void handleMarkTaskDoneSilently();
      setVoiceStatusMessage(voiceCommandStatusMessage("task_done"));

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

  function pauseVoiceInput(): void {
    voiceInputPausedRef.current = true;
  }

  function resumeVoiceInput(): void {
    voiceInputPausedRef.current = false;
  }

  function handleVoiceTranscript(transcript: string, isFinal: boolean): void {
    const trimmedTranscript = transcript.trim();

    if (voiceInputPausedRef.current) {
      return;
    }

    // Live conversation: listen while Jarvis speaks so the user can interrupt.
    if (isSpeakingRef.current && liveConversationEnabledRef.current) {
      if (
        !trimmedTranscript ||
        transcriptLooksLikeSpokenAnswerEcho(
          trimmedTranscript,
          currentlySpokenAnswerRef.current
        )
      ) {
        return;
      }

      interruptSpokenAnswer();
      resumeVoiceInput();
      setQuestion(trimmedTranscript);

      if (isFinal) {
        handleClassifiedVoiceTranscript(trimmedTranscript);
      }

      return;
    }

    if (isSpeakingRef.current) {
      return;
    }

    setQuestion(transcript);

    if (!isFinal || !trimmedTranscript) {
      return;
    }

    if (liveConversationEnabledRef.current) {
      handleClassifiedVoiceTranscript(trimmedTranscript);
      return;
    }

    pendingVoiceSubmitRef.current = trimmedTranscript;
  }

  function beginLiveConversationListening(): void {
    if (!isVoiceSupported || isListeningRef.current) {
      return;
    }

    setVoiceStatusMessage(null);
    setError(null);
    pendingVoiceSubmitRef.current = null;
    resumeVoiceInput();
    isListeningRef.current = true;
    setIsListening(true);

    startContinuousListening({
      onTranscript: handleVoiceTranscript,
      onError: (message) => {
        if (message.includes("Didn't catch")) {
          return;
        }

        setVoiceStatusMessage(message);
      },
      onEnd: () => {
        if (!liveConversationEnabledRef.current) {
          isListeningRef.current = false;
          setIsListening(false);
        }
      },
    });
  }

  function beginListeningForQuestion() {
    if (!isVoiceSupported || isLoadingRef.current || isListeningRef.current) {
      return;
    }

    if (liveConversationEnabledRef.current) {
      beginLiveConversationListening();
      return;
    }

    setVoiceStatusMessage(null);
    setError(null);
    pendingVoiceSubmitRef.current = null;
    isListeningRef.current = true;
    setIsListening(true);

    startListening({
      onTranscript: handleVoiceTranscript,
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
          !liveConversationEnabledRef.current &&
          !transcriptLooksLikeSpokenAnswerEcho(
            finalTranscript,
            isSpeakingRef.current ? currentlySpokenAnswerRef.current : ""
          );

        if (isRealUserTranscript) {
          handleClassifiedVoiceTranscript(finalTranscript);
          return;
        }

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

  // Speak the answer aloud; mic stays active in live mode for barge-in interrupts.
  function startSpeakingWithBargeIn(answerText: string) {
    if (liveConversationEnabledRef.current) {
      resumeVoiceInput();
      if (!isListeningRef.current) {
        beginLiveConversationListening();
      }
    }

    setQuestion("");

    currentlySpokenAnswerRef.current = answerText;
    setReadAloudStatusMessage(null);
    isSpeakingRef.current = true;
    setIsSpeaking(true);

    void speakAnswerText(answerText, {
      onPlaybackEnded: () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        currentlySpokenAnswerRef.current = "";
        setQuestion("");
      },
      onPlaybackError: (message) => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        currentlySpokenAnswerRef.current = "";
        setReadAloudStatusMessage(message);
        setQuestion("");
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
    if (!liveConversationEnabledRef.current) {
      stopListening();
      isListeningRef.current = false;
      setIsListening(false);
    }

    setQuestion("");
    setReadAloudStatusMessage(null);
    isSpeakingRef.current = true;
    setIsSpeaking(true);

    try {
      await speakAnswerText(answerText, {
        onPlaybackEnded: () => {
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          setQuestion("");
        },
        onPlaybackError: (message) => {
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          setReadAloudStatusMessage(message);
          setQuestion("");
        },
      });
    } catch (speechError) {
      isSpeakingRef.current = false;
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
    beginLiveConversationListening();
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

    if (liveConversationEnabledRef.current) {
      pauseVoiceInput();
    } else {
      stopListening();
      isListeningRef.current = false;
      setIsListening(false);
    }

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
        prefetchedMemoryContext: backgroundMemoryContextRef.current,
      });

      if (response.ok && response.kind === "ask") {
        setAnswer(response.answer);
        setHighlightsApplied(response.highlightsApplied);
        setActionResults(response.actionResults);
        lastFailedQuestionRef.current = null;
        lastAnsweredQuestionRef.current = trimmedQuestion;
        lastAnsweredAnswerRef.current = response.answer;
        setFeedbackStatusMessage(null);
        void prefetchBackgroundMemory();

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

      if (liveConversationEnabledRef.current) {
        resumeVoiceInput();
      }
    } finally {
      setIsLoading(false);
      setOrchestratorPhase(null);

      if (shouldStartListeningAfter && liveConversationEnabledRef.current) {
        resumeVoiceInput();
      } else if (
        liveConversationEnabledRef.current &&
        !autoReadAloudEnabled &&
        !isLoadingRef.current
      ) {
        resumeVoiceInput();
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
      isListeningRef.current = false;
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
          onFeedbackPositive={() => {
            void handleAnswerFeedback("positive");
          }}
          onFeedbackNegative={() => {
            void handleAnswerFeedback("negative");
          }}
          feedbackStatusMessage={feedbackStatusMessage}
          isFeedbackPending={isFeedbackPending}
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
