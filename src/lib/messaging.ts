export interface HighlightTarget {
  selector: string;
  label: string;
}

export type PageActionType = "click" | "scroll" | "highlight" | "type" | "read" | "capture";

export interface PageAction {
  actionType: PageActionType;
  selector: string;
  label: string;
}

export interface ActionResult {
  actionType: PageActionType;
  label: string;
  success: boolean;
  message: string;
  evidence?: string;
}

export type ConversationRole = "user" | "assistant";

export interface ConversationTurn {
  role: ConversationRole;
  content: string;
  pageUrl: string;
  hadScreenshot: boolean;
}

export type ExtensionMessage =
  | { type: "PING" }
  | {
      type: "ASK_WITH_CONTEXT";
      question: string;
      screenshotBase64: string | null;
      domContextText: string | null;
      tabId: number;
      windowId: number;
      pageUrl: string;
      priorTurns: ConversationTurn[];
      prefetchedMemoryContext?: string | null;
    }
  | { type: "CLEAR_HIGHLIGHTS"; tabId?: number }
  | { type: "RECALL_MEMORY"; query?: string }
  | {
      type: "SUBMIT_ANSWER_FEEDBACK";
      question: string;
      answer: string;
      rating: "positive" | "negative";
    }
  | { type: "MARK_TASK_DONE" }
  | { type: "IMPROVE_MEMORY_SESSION" };

export type OrchestratorPhase = "thinking" | "acting";

export type OrchestratorStatusMessage = {
  type: "ORCHESTRATOR_STATUS";
  phase: OrchestratorPhase;
  detail?: string;
};

export type ExtensionResponse =
  | { ok: true; kind: "ping"; message: string }
  | {
      ok: true;
      kind: "ask";
      answer: string;
      highlightsApplied: number;
      actionsPerformed: number;
      actionResults: ActionResult[];
      orchestratorSteps: number;
    }
  | { ok: true; kind: "clear" }
  | { ok: true; kind: "memory"; recalledText: string }
  | { ok: true; kind: "memory_action"; message: string }
  | { ok: false; error: string };

const BACKGROUND_MESSAGE_TIMEOUT_MS: Record<string, number> = {
  PING: 5000,
  RECALL_MEMORY: 40000,
  CLEAR_HIGHLIGHTS: 8000,
  SUBMIT_ANSWER_FEEDBACK: 30000,
  MARK_TASK_DONE: 30000,
  IMPROVE_MEMORY_SESSION: 30000,
  ASK_WITH_CONTEXT: 120000,
};

function getBackgroundMessageTimeoutMs(message: ExtensionMessage): number {
  return BACKGROUND_MESSAGE_TIMEOUT_MS[message.type] ?? 20000;
}

export function sendMessageToBackground(
  message: ExtensionMessage,
  timeoutMs?: number
): Promise<ExtensionResponse> {
  const resolvedTimeoutMs = timeoutMs ?? getBackgroundMessageTimeoutMs(message);

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("Jarvis background did not respond in time."));
    }, resolvedTimeoutMs);

    chrome.runtime.sendMessage(message, (response: ExtensionResponse) => {
      window.clearTimeout(timeoutId);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (response === undefined) {
        reject(
          new Error(
            "Jarvis background returned no response. Reload the extension and try again."
          )
        );
        return;
      }

      resolve(response);
    });
  });
}
