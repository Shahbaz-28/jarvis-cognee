import {
  MEMORY_LONG_TERM_RECALL_QUERY,
  MEMORY_WHAT_WAS_I_DOING_QUERY,
  WORKER_MEMORY_FEEDBACK_ENDPOINT,
  WORKER_MEMORY_IMPROVE_ENDPOINT,
  WORKER_MEMORY_RECALL_ENDPOINT,
  WORKER_MEMORY_REMEMBER_ENDPOINT,
} from "./config";
import type { ActionResult } from "./messaging";

const MEMORY_REQUEST_TIMEOUT_MS = 10000;
const MEMORY_RECALL_TIMEOUT_MS = 35000;

export interface RememberTurnParams {
  sessionId: string;
  question: string;
  answer: string;
  pageUrl: string;
  pageTitle: string;
  actionResults: ActionResult[];
}

function buildActionsSummary(actionResults: ActionResult[]): string {
  if (actionResults.length === 0) {
    return "No page actions performed.";
  }

  return actionResults
    .map(
      (actionResult) =>
        `${actionResult.actionType}: ${actionResult.label} — ${actionResult.message}`
    )
    .join("; ");
}

function extractRecallText(recallPayload: unknown): string {
  if (typeof recallPayload === "string") {
    return recallPayload.trim();
  }

  if (Array.isArray(recallPayload)) {
    const entryTexts = recallPayload
      .map((entryItem) => extractRecallEntryText(entryItem))
      .filter((text) => text.length > 0);

    return entryTexts.join("\n\n").trim();
  }

  if (!recallPayload || typeof recallPayload !== "object") {
    return "";
  }

  return extractRecallEntryText(recallPayload);
}

function extractRecallEntryText(entryItem: unknown): string {
  if (typeof entryItem === "string") {
    return entryItem.trim();
  }

  if (!entryItem || typeof entryItem !== "object") {
    return "";
  }

  const entryRecord = entryItem as Record<string, unknown>;

  if (typeof entryRecord.answer === "string" && entryRecord.answer.trim()) {
    const questionPrefix =
      typeof entryRecord.question === "string" && entryRecord.question.trim()
        ? `You asked: ${entryRecord.question.trim()}\n`
        : "";
    return `${questionPrefix}${entryRecord.answer.trim()}`;
  }

  for (const key of ["text", "content", "response", "result", "output", "memory_context"]) {
    const value = entryRecord[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  if (Array.isArray(entryRecord.results)) {
    const resultTexts = entryRecord.results
      .map((resultItem) => extractRecallEntryText(resultItem))
      .filter((text) => text.length > 0);

    return resultTexts.join("\n").trim();
  }

  if (Array.isArray(entryRecord.data)) {
    const dataTexts = entryRecord.data
      .map((dataItem) => extractRecallEntryText(dataItem))
      .filter((text) => text.length > 0);

    return dataTexts.join("\n").trim();
  }

  return "";
}

export function isMemoryIntentQuestion(userQuestion: string): boolean {
  const normalizedQuestion = userQuestion
    .toLowerCase()
    .replace(/[^a-z0-9\s?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const memoryIntentPhrases = [
    "what was i doing",
    "what were i doing",
    "what did i do before",
    "what was i working on",
    "previous session",
    "last session",
    "remember what",
    "continue where i left",
    "earlier what was i",
    "what pages",
    "pages we",
    "pages did",
    "where were we",
    "sites we visited",
    "where did we go",
    "yesterday",
    "last time we",
    "few days ago",
    "last week",
    "earlier",
    "before",
    "we spoke",
    "we were talking",
    "talking about",
    "did we visit",
    "did we go",
    "have we been",
    "reddit",
    "recall",
  ];

  return memoryIntentPhrases.some((phrase) =>
    normalizedQuestion.includes(phrase)
  );
}

export function resolveMemoryRecallQuery(userQuestion: string): string {
  if (isMemoryIntentQuestion(userQuestion)) {
    return MEMORY_WHAT_WAS_I_DOING_QUERY;
  }

  return userQuestion;
}

async function postMemoryRequest<TResponse>(
  endpoint: string,
  requestBody: Record<string, unknown>,
  timeoutMs = MEMORY_REQUEST_TIMEOUT_MS
): Promise<TResponse> {
  const abortController = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    const responseBody = await response.text();

    if (!response.ok) {
      const isQuotaError =
        response.status === 402 ||
        responseBody.toLowerCase().includes("quota") ||
        responseBody.toLowerCase().includes("credits");

      if (isQuotaError) {
        throw new Error("COGNEE_QUOTA_EXCEEDED");
      }

      throw new Error(`Memory request failed (${response.status}): ${responseBody}`);
    }

    if (!responseBody) {
      return {} as TResponse;
    }

    return JSON.parse(responseBody) as TResponse;
  } catch (requestError) {
    if (requestError instanceof Error && requestError.name === "AbortError") {
      throw new Error("Memory request timed out. Check your worker and Cognee keys.");
    }

    throw requestError;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function rememberConversationTurn(
  params: RememberTurnParams
): Promise<void> {
  await postMemoryRequest(WORKER_MEMORY_REMEMBER_ENDPOINT, {
    sessionId: params.sessionId,
    question: params.question,
    answer: params.answer,
    pageUrl: params.pageUrl,
    pageTitle: params.pageTitle,
    actionsSummary: buildActionsSummary(params.actionResults),
  });
}

export async function recallMemoryContext(
  sessionId: string,
  query: string
): Promise<string> {
  const recallPayload = await postMemoryRequest<unknown>(
    WORKER_MEMORY_RECALL_ENDPOINT,
    {
      sessionId,
      query,
    },
    MEMORY_RECALL_TIMEOUT_MS
  );

  return extractRecallText(recallPayload);
}

/** Pick a good Cognee query for voice/chat questions about prior sessions. */
export async function recallMemoryContextForQuestion(
  sessionId: string,
  userQuestion: string
): Promise<string> {
  const recallQuery = resolveMemoryRecallQuery(userQuestion);
  const recalledText = await recallMemoryContext(sessionId, recallQuery);

  if (recalledText || !isMemoryIntentQuestion(userQuestion)) {
    return recalledText;
  }

  return recallWhatWasIDoing(sessionId);
}

export async function recallWhatWasIDoing(sessionId: string): Promise<string> {
  return recallMemoryContext(sessionId, MEMORY_LONG_TERM_RECALL_QUERY);
}

export async function recallLongTermMemoryContext(
  sessionId: string,
  query: string = MEMORY_LONG_TERM_RECALL_QUERY
): Promise<string> {
  return recallMemoryContext(sessionId, query);
}

export async function improveMemorySession(sessionId: string): Promise<void> {
  await postMemoryRequest(WORKER_MEMORY_IMPROVE_ENDPOINT, { sessionId });
}

export async function rememberAnswerFeedback(params: {
  sessionId: string;
  question: string;
  answer: string;
  rating: "positive" | "negative";
}): Promise<void> {
  await postMemoryRequest(WORKER_MEMORY_FEEDBACK_ENDPOINT, params);
}

/** Promote session notes to Cognee graph — keeps the same persistent memory id. */
export async function promoteMemoryTaskToLongTerm(
  sessionId: string
): Promise<{ improveFailed: boolean }> {
  try {
    await improveMemorySession(sessionId);
    return { improveFailed: false };
  } catch {
    return { improveFailed: true };
  }
}
