import type { ConversationSession } from "./conversation-session";

export type PerceptionMode = "screenshot" | "dom" | "dom_diff";

export interface PageDomSnapshotPayload {
  url: string;
  title: string;
  snapshotText: string;
  snapshotHash: string;
}

export interface CapturePolicyInput {
  question: string;
  session: ConversationSession;
  currentPageUrl: string;
}

export interface CapturePolicyResult {
  perceptionMode: PerceptionMode;
  shouldCaptureScreenshot: boolean;
  shouldAttachDomSnapshot: boolean;
  shouldSendDomDiff: boolean;
}

const VISUAL_QUESTION_PATTERN =
  /\b(color|colour|chart|graph|image|picture|photo|screenshot|look like|looks like|layout|design|visual|font|icon|logo|what do you see|what does it look like|on screen)\b/i;

const STRUCTURAL_QUESTION_PATTERN =
  /\b(button|link|field|form|input|menu|heading|title|list|option|nav|tab|elements?|sections?|what('| i)?s on|what is on|what is this page|what's this page|summarize|summary|about this page)\b/i;

export function questionNeedsVisualPerception(question: string): boolean {
  return VISUAL_QUESTION_PATTERN.test(question);
}

export function questionNeedsStructuralPerception(question: string): boolean {
  return STRUCTURAL_QUESTION_PATTERN.test(question);
}

export function resolveCapturePolicy(
  input: CapturePolicyInput
): CapturePolicyResult {
  const { question, session, currentPageUrl } = input;
  const isFirstTurnInSession = session.turns.length === 0;
  const pageUrlChanged = session.pageUrl !== currentPageUrl;
  const afterPageAction = session.needsScreenshotAfterAction;
  const needsVisual = questionNeedsVisualPerception(question);
  const needsStructural =
    questionNeedsStructuralPerception(question) || !needsVisual;

  if (afterPageAction) {
    if (needsVisual) {
      return {
        perceptionMode: "screenshot",
        shouldCaptureScreenshot: true,
        shouldAttachDomSnapshot: true,
        shouldSendDomDiff: false,
      };
    }

    return {
      perceptionMode: "dom_diff",
      shouldCaptureScreenshot: false,
      shouldAttachDomSnapshot: true,
      shouldSendDomDiff: true,
    };
  }

  if (pageUrlChanged) {
    if (needsVisual) {
      return {
        perceptionMode: "screenshot",
        shouldCaptureScreenshot: true,
        shouldAttachDomSnapshot: true,
        shouldSendDomDiff: false,
      };
    }

    return {
      perceptionMode: "dom",
      shouldCaptureScreenshot: false,
      shouldAttachDomSnapshot: true,
      shouldSendDomDiff: false,
    };
  }

  if (isFirstTurnInSession) {
    if (needsVisual) {
      return {
        perceptionMode: "screenshot",
        shouldCaptureScreenshot: true,
        shouldAttachDomSnapshot: false,
        shouldSendDomDiff: false,
      };
    }

    return {
      perceptionMode: "dom",
      shouldCaptureScreenshot: false,
      shouldAttachDomSnapshot: true,
      shouldSendDomDiff: false,
    };
  }

  if (needsVisual) {
    return {
      perceptionMode: "screenshot",
      shouldCaptureScreenshot: true,
      shouldAttachDomSnapshot: false,
      shouldSendDomDiff: false,
    };
  }

  if (needsStructural && session.lastDomSnapshotSummary) {
    return {
      perceptionMode: "dom_diff",
      shouldCaptureScreenshot: false,
      shouldAttachDomSnapshot: true,
      shouldSendDomDiff: true,
    };
  }

  return {
    perceptionMode: "dom",
    shouldCaptureScreenshot: false,
    shouldAttachDomSnapshot: true,
    shouldSendDomDiff: false,
  };
}

export async function fetchDomSnapshotFromTab(
  tabId: number
): Promise<PageDomSnapshotPayload | null> {
  try {
    const tabResponse = await chrome.tabs.sendMessage(tabId, {
      type: "GET_DOM_SNAPSHOT",
    });

    if (
      tabResponse &&
      typeof tabResponse.snapshotText === "string" &&
      typeof tabResponse.snapshotHash === "string"
    ) {
      return tabResponse as PageDomSnapshotPayload;
    }
  } catch {
    // Content script may not be available on restricted pages.
  }

  return null;
}

export function buildDomContextForQuestion(params: {
  capturePolicy: CapturePolicyResult;
  currentSnapshot: PageDomSnapshotPayload | null;
  previousSnapshotText: string | null;
}): string | null {
  const { capturePolicy, currentSnapshot, previousSnapshotText } = params;

  if (!capturePolicy.shouldAttachDomSnapshot || !currentSnapshot) {
    return null;
  }

  if (
    capturePolicy.shouldSendDomDiff &&
    previousSnapshotText &&
    previousSnapshotText !== currentSnapshot.snapshotText
  ) {
    const previousHash = hashSnapshotText(previousSnapshotText);
    if (previousHash === currentSnapshot.snapshotHash) {
      return "Page structure unchanged since the last snapshot.";
    }

    return [
      "Page structure changed since the last snapshot.",
      "",
      "Current page snapshot:",
      currentSnapshot.snapshotText,
    ].join("\n");
  }

  if (
    capturePolicy.shouldSendDomDiff &&
    previousSnapshotText === currentSnapshot.snapshotText
  ) {
    return [
      "Page structure unchanged since the last snapshot.",
      "",
      "Current page snapshot:",
      currentSnapshot.snapshotText,
    ].join("\n");
  }

  return currentSnapshot.snapshotText;
}

function hashSnapshotText(snapshotText: string): string {
  let hash = 5381;

  for (let index = 0; index < snapshotText.length; index += 1) {
    hash = (hash * 33) ^ snapshotText.charCodeAt(index);
  }

  return (hash >>> 0).toString(16);
}

export function updateSessionDomSnapshot(
  session: ConversationSession,
  snapshot: PageDomSnapshotPayload | null
): ConversationSession {
  if (!snapshot) {
    return session;
  }

  return {
    ...session,
    lastDomSnapshotHash: snapshot.snapshotHash,
    lastDomSnapshotSummary: snapshot.snapshotText,
  };
}
