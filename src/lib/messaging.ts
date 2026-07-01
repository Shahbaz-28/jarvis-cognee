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
    }
  | { type: "CLEAR_HIGHLIGHTS"; tabId?: number };

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
  | { ok: false; error: string };

export function sendMessageToBackground(
  message: ExtensionMessage
): Promise<ExtensionResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: ExtensionResponse) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}
