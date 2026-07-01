import { runJarvisOrchestrator } from "../lib/jarvis-orchestrator";
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
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

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

async function handleAskWithContext(
  question: string,
  screenshotBase64: string | null,
  domContextText: string | null,
  tabId: number,
  windowId: number,
  priorTurns: ConversationTurn[]
): Promise<{
  answer: string;
  highlightsApplied: number;
  actionsPerformed: number;
  actionResults: ActionResult[];
  orchestratorSteps: number;
}> {
  await assertCanAskQuestionToday();
  await sendMessageToTab(tabId, { type: "CLEAR_HIGHLIGHTS" });

  const orchestratorResult = await runJarvisOrchestrator({
    question,
    screenshotBase64,
    domContextText,
    tabId,
    windowId,
    priorTurns,
  });

  await recordQuestionAsked();

  return orchestratorResult;
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-jarvis-vo") {
    return;
  }

  void (async () => {
    const activeWindowId = await getActiveWindowId();
    if (activeWindowId !== null) {
      await chrome.sidePanel.open({ windowId: activeWindowId });
    }
  })();
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
        message.priorTurns
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

    sendResponse({ ok: false, error: "Unknown message type" });
    return true;
  }
);
