import {
  appendFriendMemoryEntry,
  buildFriendMemoryContext,
  loadFriendMemoryEntries,
} from "../lib/friend-memory";
import { runJarvisOrchestrator } from "../lib/jarvis-orchestrator";
import {
  promoteMemoryTaskToLongTerm,
  improveMemorySession,
  isMemoryIntentQuestion,
  recallMemoryContext,
  recallMemoryContextForQuestion,
  recallLongTermMemoryContext,
  rememberAnswerFeedback,
  rememberConversationTurn,
} from "../lib/memory";
import {
  clearMemoryTaskLabel,
  getOrCreateMemorySessionId,
} from "../lib/memory-session";
import { MEMORY_LONG_TERM_RECALL_QUERY } from "../lib/config";
import type {
  ActionResult,
  ConversationTurn,
  ExtensionMessage,
  ExtensionResponse,
  HighlightTarget,
  PageAction,
} from "../lib/messaging";
import {
  assertCanAskQuestionToday,
  recordQuestionAsked,
} from "../lib/usage-limit";

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  void configureSidePanel();
});

async function configureSidePanel(): Promise<void> {
  try {
    // Let Chrome open the panel on icon click — avoids losing the user-gesture
    // if we await other work before sidePanel.open().
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await chrome.sidePanel.setOptions({ enabled: true });
  } catch (sidePanelConfigError) {
    console.warn("[Jarvis VO] Side panel setup failed:", sidePanelConfigError);
  }
}

/**
 * sidePanel.open() must run while the user-gesture is still active.
 * Do not await anything before calling open().
 */
function openSidePanelForWindowId(windowId: number): void {
  chrome.sidePanel.open({ windowId }).catch((sidePanelOpenError) => {
    console.error("[Jarvis VO] Failed to open side panel:", sidePanelOpenError);
  });
}

async function getActiveTabId(): Promise<number | null> {
  const focusedWindow = await chrome.windows.getLastFocused({
    windowTypes: ["normal"],
  });

  if (focusedWindow.id === undefined) {
    return null;
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId: focusedWindow.id,
  });

  return activeTab?.id ?? null;
}

async function getActiveWindowId(): Promise<number | null> {
  const focusedWindow = await chrome.windows.getLastFocused({
    windowTypes: ["normal"],
  });

  if (focusedWindow.id === undefined) {
    return null;
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId: focusedWindow.id,
  });

  return activeTab?.windowId ?? null;
}

async function sendMessageToTab(
  tabId: number,
  message: {
    type:
      | "SHOW_HIGHLIGHTS"
      | "CLEAR_HIGHLIGHTS"
      | "PERFORM_ACTIONS"
      | "READ_PAGE_TEXT"
      | "TYPE_TEXT";
    highlights?: HighlightTarget[];
    actions?: PageAction[];
    maxChars?: number;
    selector?: string;
    label?: string;
    text?: string;
  }
): Promise<{ actionResults?: ActionResult[]; count?: number; pageText?: string } | undefined> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return undefined;
  }
}

async function resolveTargetTabId(preferredTabId?: number): Promise<number | null> {
  if (preferredTabId !== undefined) {
    return preferredTabId;
  }

  return getActiveTabId();
}

function mergeMemoryContextSections(
  ...memorySections: Array<string | null | undefined>
): string | null {
  const nonEmptySections = memorySections
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section && section.length > 0));

  if (nonEmptySections.length === 0) {
    return null;
  }

  return nonEmptySections.join("\n\n");
}

async function recallCogneeMemorySafely(
  memorySessionId: string,
  question: string
): Promise<string | null> {
  try {
    if (isMemoryIntentQuestion(question)) {
      return await recallMemoryContextForQuestion(memorySessionId, question);
    }

    return await recallLongTermMemoryContext(
      memorySessionId,
      MEMORY_LONG_TERM_RECALL_QUERY
    );
  } catch (memoryRecallError) {
    const errorMessage =
      memoryRecallError instanceof Error
        ? memoryRecallError.message
        : String(memoryRecallError);

    if (
      errorMessage.includes("COGNEE_QUOTA_EXCEEDED") ||
      errorMessage.toLowerCase().includes("quota") ||
      errorMessage.toLowerCase().includes("credits")
    ) {
      console.warn(
        "[Jarvis VO] Cognee quota exceeded — using local friend memory only."
      );
      return null;
    }

    console.warn("[Jarvis VO] Cognee recall failed:", memoryRecallError);
    return null;
  }
}

async function fetchRecalledMemoryContext(
  memorySessionId: string,
  question: string,
  _priorTurns: ConversationTurn[],
  prefetchedMemoryContext?: string | null
): Promise<string | null> {
  const friendMemoryEntries = await loadFriendMemoryEntries();
  const localFriendMemoryContext = buildFriendMemoryContext(
    friendMemoryEntries,
    question
  );

  const cogneeMemoryContext = await recallCogneeMemorySafely(
    memorySessionId,
    question
  );

  return mergeMemoryContextSections(
    localFriendMemoryContext,
    prefetchedMemoryContext,
    cogneeMemoryContext
  );
}

async function handleAskWithContext(
  question: string,
  screenshotBase64: string | null,
  domContextText: string | null,
  tabId: number,
  windowId: number,
  pageUrl: string,
  priorTurns: ConversationTurn[],
  prefetchedMemoryContext?: string | null
): Promise<{
  answer: string;
  highlightsApplied: number;
  actionsPerformed: number;
  actionResults: ActionResult[];
  orchestratorSteps: number;
}> {
  await assertCanAskQuestionToday();
  await sendMessageToTab(tabId, { type: "CLEAR_HIGHLIGHTS" });

  const memorySessionId = await getOrCreateMemorySessionId();
  const recalledMemoryContext = await fetchRecalledMemoryContext(
    memorySessionId,
    question,
    priorTurns,
    prefetchedMemoryContext
  );

  const orchestratorResult = await runJarvisOrchestrator({
    question,
    screenshotBase64,
    domContextText,
    tabId,
    windowId,
    priorTurns,
    recalledMemoryContext,
    isMemoryIntentQuestion: isMemoryIntentQuestion(question),
  });

  await recordQuestionAsked();

  void rememberConversationTurn({
    sessionId: memorySessionId,
    question,
    answer: orchestratorResult.answer,
    pageUrl,
    pageTitle: (await chrome.tabs.get(tabId)).title ?? "Unknown page",
    actionResults: orchestratorResult.actionResults,
  }).catch((memoryRememberError) => {
    console.warn("[Jarvis VO] Memory remember failed:", memoryRememberError);
  });

  void appendFriendMemoryEntry({
    question,
    answer: orchestratorResult.answer,
    pageUrl,
    pageTitle: (await chrome.tabs.get(tabId)).title ?? "Unknown page",
  }).catch((friendMemoryError) => {
    console.warn("[Jarvis VO] Local friend memory save failed:", friendMemoryError);
  });

  return orchestratorResult;
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-jarvis-vo") {
    return;
  }

  chrome.windows.getLastFocused({ windowTypes: ["normal"] }, (focusedWindow) => {
    if (focusedWindow.id === undefined) {
      return;
    }

    openSidePanelForWindowId(focusedWindow.id);
  });
});

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender,
    sendResponse: (response: ExtensionResponse) => void
  ) => {
    if (message.type === "PING") {
      sendResponse({
        ok: true,
        kind: "ping",
        message: "Jarvis VO background is running",
      });
      return true;
    }

    if (message.type === "CLEAR_HIGHLIGHTS") {
      void (async () => {
        const tabId = await resolveTargetTabId(message.tabId);
        if (tabId !== null) {
          await sendMessageToTab(tabId, { type: "CLEAR_HIGHLIGHTS" });
        }
        sendResponse({ ok: true, kind: "clear" });
      })();

      return true;
    }

    if (message.type === "ASK_WITH_CONTEXT") {
      handleAskWithContext(
        message.question,
        message.screenshotBase64,
        message.domContextText,
        message.tabId,
        message.windowId,
        message.pageUrl,
        message.priorTurns,
        message.prefetchedMemoryContext
      )
        .then(
          ({
            answer,
            highlightsApplied,
            actionsPerformed,
            actionResults,
            orchestratorSteps,
          }) => {
            sendResponse({
              ok: true,
              kind: "ask",
              answer,
              highlightsApplied,
              actionsPerformed,
              actionResults,
              orchestratorSteps,
            });
          }
        )
        .catch((error: unknown) => {
          const errorMessage =
            error instanceof Error
              ? error.message
              : "Something went wrong while asking Claude.";
          sendResponse({ ok: false, error: errorMessage });
        });

      return true;
    }

    if (message.type === "RECALL_MEMORY") {
      void (async () => {
        try {
          const memorySessionId = await getOrCreateMemorySessionId();
          const recallQuery = message.query ?? MEMORY_LONG_TERM_RECALL_QUERY;

          const friendMemoryEntries = await loadFriendMemoryEntries();
          const localFriendMemoryContext = buildFriendMemoryContext(
            friendMemoryEntries,
            recallQuery
          );

          let cogneeRecalledText = "";
          try {
            cogneeRecalledText = await recallMemoryContext(
              memorySessionId,
              recallQuery
            );
          } catch {
            // Quota or network — local memory still works.
          }

          const recalledText =
            mergeMemoryContextSections(
              localFriendMemoryContext,
              cogneeRecalledText
            ) ?? "";

          sendResponse({
            ok: true,
            kind: "memory",
            recalledText,
          });
        } catch (recallError: unknown) {
          const errorMessage =
            recallError instanceof Error
              ? recallError.message
              : "Could not recall memory.";
          sendResponse({ ok: false, error: errorMessage });
        }
      })();

      return true;
    }

    if (message.type === "SUBMIT_ANSWER_FEEDBACK") {
      void (async () => {
        try {
          const memorySessionId = await getOrCreateMemorySessionId();

          await rememberAnswerFeedback({
            sessionId: memorySessionId,
            question: message.question,
            answer: message.answer,
            rating: message.rating,
          });

          if (message.rating === "positive") {
            await improveMemorySession(memorySessionId);
          }

          sendResponse({
            ok: true,
            kind: "memory_action",
            message:
              message.rating === "positive"
                ? "Thanks — saved to long-term memory."
                : "Got it — I'll do better next time.",
          });
        } catch (feedbackError: unknown) {
          const errorMessage =
            feedbackError instanceof Error
              ? feedbackError.message
              : "Could not save feedback.";
          sendResponse({ ok: false, error: errorMessage });
        }
      })();

      return true;
    }

    if (message.type === "IMPROVE_MEMORY_SESSION") {
      void (async () => {
        try {
          const memorySessionId = await getOrCreateMemorySessionId();
          await improveMemorySession(memorySessionId);

          sendResponse({
            ok: true,
            kind: "memory_action",
            message: "Session saved to long-term memory.",
          });
        } catch (improveError: unknown) {
          const errorMessage =
            improveError instanceof Error
              ? improveError.message
              : "Could not improve memory session.";
          sendResponse({ ok: false, error: errorMessage });
        }
      })();

      return true;
    }

    if (message.type === "MARK_TASK_DONE") {
      void (async () => {
        try {
          const memorySessionId = await getOrCreateMemorySessionId();
          const { improveFailed } = await promoteMemoryTaskToLongTerm(
            memorySessionId
          );
          await clearMemoryTaskLabel();

          sendResponse({
            ok: true,
            kind: "memory_action",
            message: improveFailed
              ? "Saved locally — long-term sync will catch up."
              : "Saved to long-term memory. Same Jarvis — still remembers you.",
          });
        } catch (markDoneError: unknown) {
          const errorMessage =
            markDoneError instanceof Error
              ? markDoneError.message
              : "Could not mark task done.";
          sendResponse({ ok: false, error: errorMessage });
        }
      })();

      return true;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
    return true;
  }
);
