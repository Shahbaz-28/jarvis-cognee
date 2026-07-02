export type ConversationRole = "user" | "assistant";

export interface ConversationTurn {
  role: ConversationRole;
  content: string;
  pageUrl: string;
  hadScreenshot: boolean;
}

export interface ConversationSession {
  pageUrl: string;
  turns: ConversationTurn[];
  needsScreenshotAfterAction: boolean;
  lastDomSnapshotHash?: string;
  lastDomSnapshotSummary?: string;
}

export const MAX_CONVERSATION_TURNS = 6;

const SESSION_STORAGE_KEY = "conversationSession";

export function createEmptyConversationSession(
  pageUrl: string
): ConversationSession {
  return {
    pageUrl,
    turns: [],
    needsScreenshotAfterAction: false,
  };
}

export function shouldCaptureScreenshotForTurn(
  session: ConversationSession,
  currentPageUrl: string
): boolean {
  if (session.turns.length === 0) {
    return true;
  }

  if (session.pageUrl !== currentPageUrl) {
    return true;
  }

  if (session.needsScreenshotAfterAction) {
    return true;
  }

  return false;
}

export function trimConversationTurns(
  turns: ConversationTurn[]
): ConversationTurn[] {
  if (turns.length <= MAX_CONVERSATION_TURNS) {
    return turns;
  }

  return turns.slice(-MAX_CONVERSATION_TURNS);
}

export function appendConversationTurn(
  session: ConversationSession,
  turn: ConversationTurn
): ConversationSession {
  return {
    ...session,
    pageUrl: turn.pageUrl,
    turns: trimConversationTurns([...session.turns, turn]),
  };
}

export function markActionPerformed(
  session: ConversationSession
): ConversationSession {
  return {
    ...session,
    needsScreenshotAfterAction: true,
  };
}

export function clearScreenshotAfterActionFlag(
  session: ConversationSession,
  currentPageUrl: string
): ConversationSession {
  return {
    ...session,
    pageUrl: currentPageUrl,
    needsScreenshotAfterAction: false,
  };
}

export async function loadConversationSession(): Promise<ConversationSession | null> {
  const storedValues = await chrome.storage.session.get(SESSION_STORAGE_KEY);
  const storedSession = storedValues[SESSION_STORAGE_KEY] as
    | ConversationSession
    | undefined;

  if (!storedSession) {
    return null;
  }

  return storedSession;
}

export async function saveConversationSession(
  session: ConversationSession
): Promise<void> {
  await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: session });
}

export async function clearConversationSession(): Promise<void> {
  await chrome.storage.session.remove(SESSION_STORAGE_KEY);
}

/** Summarize pages and questions from the current panel session for navigation-style recall. */
export function buildRecentPanelActivitySummary(
  priorTurns: ConversationTurn[]
): string {
  if (priorTurns.length === 0) {
    return "";
  }

  const pageActivityLines: string[] = [];
  const seenPageUrls = new Set<string>();

  for (let turnIndex = 0; turnIndex < priorTurns.length; turnIndex += 1) {
    const turn = priorTurns[turnIndex];

    if (turn.role !== "user") {
      continue;
    }

    const pageUrlLabel = turn.pageUrl.trim() || "unknown page";
    const questionPreview = turn.content.trim().slice(0, 120);

    if (!seenPageUrls.has(pageUrlLabel)) {
      seenPageUrls.add(pageUrlLabel);
      pageActivityLines.push(
        `- ${pageUrlLabel}${questionPreview ? ` (asked: "${questionPreview}")` : ""}`
      );
    }
  }

  if (pageActivityLines.length === 0) {
    return "";
  }

  return `Recent activity in this panel session:\n${pageActivityLines.join("\n")}`;
}
