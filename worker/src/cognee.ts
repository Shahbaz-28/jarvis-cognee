export interface CogneeWorkerEnv {
  COGNEE_API_KEY: string;
  COGNEE_BASE_URL: string;
  COGNEE_CLOUD_API_URL?: string;
  COGNEE_TENANT_ID: string;
  COGNEE_DATASET_NAME: string;
}

export interface RememberTurnRequestBody {
  sessionId: string;
  question: string;
  answer: string;
  pageUrl: string;
  pageTitle: string;
  actionsSummary?: string;
}

export interface RecallRequestBody {
  sessionId: string;
  query: string;
}

export interface ImproveSessionRequestBody {
  sessionId: string;
}

export interface FeedbackEntryRequestBody {
  sessionId: string;
  question: string;
  answer: string;
  rating: "positive" | "negative";
}

function normalizeCogneeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function resolveCogneeTenantBaseUrl(env: CogneeWorkerEnv): string {
  return normalizeCogneeBaseUrl(env.COGNEE_BASE_URL);
}

/** Improve runs on the shared Cloud API; tenant subdomains may not expose it. */
function resolveCogneeCloudApiUrl(env: CogneeWorkerEnv): string {
  return normalizeCogneeBaseUrl(
    env.COGNEE_CLOUD_API_URL ?? "https://api.cognee.ai"
  );
}

function cogneeRequestHeaders(env: CogneeWorkerEnv): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Api-Key": env.COGNEE_API_KEY,
    "X-Tenant-Id": env.COGNEE_TENANT_ID,
  };
}

const COGNEE_REQUEST_TIMEOUT_MS = 15000;
const COGNEE_RECALL_TIMEOUT_MS = 30000;

async function fetchCognee(
  url: string,
  env: CogneeWorkerEnv,
  body: Record<string, unknown>,
  timeoutMs = COGNEE_REQUEST_TIMEOUT_MS
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: cogneeRequestHeaders(env),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function buildRememberContext(params: RememberTurnRequestBody): string {
  const contextLines = [
    `Recorded at: ${new Date().toISOString()}`,
    `Page title: ${params.pageTitle}`,
    `Page URL: ${params.pageUrl}`,
  ];

  if (params.actionsSummary) {
    contextLines.push(`Actions: ${params.actionsSummary}`);
  }

  return contextLines.join("\n");
}

export async function rememberConversationTurn(
  env: CogneeWorkerEnv,
  params: RememberTurnRequestBody
): Promise<unknown> {
  const cogneeResponse = await fetchCognee(
    `${resolveCogneeTenantBaseUrl(env)}/api/v1/remember/entry`,
    env,
    {
      entry: {
        type: "qa",
        question: params.question,
        answer: params.answer,
        context: buildRememberContext(params),
      },
      dataset_name: env.COGNEE_DATASET_NAME,
      session_id: params.sessionId,
    }
  );

  const responseBody = await cogneeResponse.text();

  if (!cogneeResponse.ok) {
    throw new Error(
      `Cognee remember failed (${cogneeResponse.status}): ${responseBody}`
    );
  }

  return JSON.parse(responseBody) as unknown;
}

function hasRecallResults(recallPayload: unknown): boolean {
  if (typeof recallPayload === "string") {
    return recallPayload.trim().length > 0;
  }

  if (Array.isArray(recallPayload)) {
    return recallPayload.length > 0;
  }

  if (!recallPayload || typeof recallPayload !== "object") {
    return false;
  }

  const payloadRecord = recallPayload as Record<string, unknown>;

  for (const key of ["answer", "text", "content", "response", "result", "output"]) {
    const value = payloadRecord[key];
    if (typeof value === "string" && value.trim()) {
      return true;
    }
  }

  if (Array.isArray(payloadRecord.results) && payloadRecord.results.length > 0) {
    return true;
  }

  if (Array.isArray(payloadRecord.data) && payloadRecord.data.length > 0) {
    return true;
  }

  return false;
}

async function fetchRecall(
  env: CogneeWorkerEnv,
  recallBody: Record<string, unknown>
): Promise<unknown> {
  const cogneeResponse = await fetchCognee(
    `${resolveCogneeTenantBaseUrl(env)}/api/v1/recall`,
    env,
    recallBody,
    COGNEE_RECALL_TIMEOUT_MS
  );

  const responseBody = await cogneeResponse.text();

  if (!cogneeResponse.ok) {
    throw new Error(
      `Cognee recall failed (${cogneeResponse.status}): ${responseBody}`
    );
  }

  if (!responseBody) {
    return [];
  }

  return JSON.parse(responseBody) as unknown;
}

export async function recallMemory(
  env: CogneeWorkerEnv,
  params: RecallRequestBody
): Promise<unknown> {
  // Session cache only — graph recall burns Cognee credits and often hits quota limits.
  const sessionRecallResult = await fetchRecall(env, {
    query: params.query,
    session_id: params.sessionId,
    include_references: false,
  }).catch(() => []);

  if (hasRecallResults(sessionRecallResult)) {
    return sessionRecallResult;
  }

  return [];
}

export async function improveMemorySession(
  env: CogneeWorkerEnv,
  params: ImproveSessionRequestBody
): Promise<unknown> {
  const cogneeResponse = await fetchCognee(
    `${resolveCogneeCloudApiUrl(env)}/api/v1/improve`,
    env,
    {
      datasetName: env.COGNEE_DATASET_NAME,
      sessionIds: [params.sessionId],
      runInBackground: true,
    }
  );

  const responseBody = await cogneeResponse.text();

  if (!cogneeResponse.ok) {
    throw new Error(
      `Cognee improve failed (${cogneeResponse.status}): ${responseBody}`
    );
  }

  if (!responseBody) {
    return {};
  }

  return JSON.parse(responseBody) as unknown;
}

export async function rememberAnswerFeedback(
  env: CogneeWorkerEnv,
  params: FeedbackEntryRequestBody
): Promise<unknown> {
  const cogneeResponse = await fetchCognee(
    `${resolveCogneeTenantBaseUrl(env)}/api/v1/remember/entry`,
    env,
    {
      entry: {
        type: "feedback",
        question: params.question,
        answer: params.answer,
        context: `User rating: ${params.rating}`,
      },
      dataset_name: env.COGNEE_DATASET_NAME,
      session_id: params.sessionId,
    }
  );

  const responseBody = await cogneeResponse.text();

  if (!cogneeResponse.ok) {
    throw new Error(
      `Cognee feedback remember failed (${cogneeResponse.status}): ${responseBody}`
    );
  }

  return JSON.parse(responseBody) as unknown;
}
