import {
  CLAUDE_AGENT_MAX_TOKENS,
  CLAUDE_MODEL,
  WORKER_CHAT_ENDPOINT,
} from "./config";
import type { ConversationTurn } from "./conversation-session";
import { buildRecentPanelActivitySummary } from "./conversation-session";
import { JARVIS_SYSTEM_PROMPT } from "./prompts";
import type { JarvisToolDefinition } from "./tools";

export interface ClaudeTextBlock {
  type: "text";
  text: string;
}

export interface ClaudeImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg";
    data: string;
  };
}

export interface ClaudeToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

type ClaudeUserContentBlock =
  | ClaudeTextBlock
  | ClaudeImageBlock
  | ClaudeToolResultBlock;

type ClaudeAssistantContentBlock = ClaudeTextBlock | ClaudeToolUseBlock;

export interface ClaudeAgentUserMessage {
  role: "user";
  content: string | ClaudeUserContentBlock[];
}

export interface ClaudeAgentAssistantMessage {
  role: "assistant";
  content: string | ClaudeAssistantContentBlock[];
}

export type ClaudeAgentMessage =
  | ClaudeAgentUserMessage
  | ClaudeAgentAssistantMessage;

export interface ClaudeAgentStepResult {
  content: ClaudeAssistantContentBlock[];
  stopReason: string;
}

interface ClaudeErrorResponse {
  error?: {
    message?: string;
  };
  type?: string;
  message?: string;
}

function extractErrorMessage(responseBody: string, statusCode: number): string {
  try {
    const parsed = JSON.parse(responseBody) as ClaudeErrorResponse;
    if (parsed.error?.message) {
      return parsed.error.message;
    }
    if (parsed.message) {
      return parsed.message;
    }
  } catch {
    // Fall through to generic message.
  }

  return `Claude API error (${statusCode})`;
}

export function buildInitialAgentMessages(
  question: string,
  imageBase64: string | null,
  priorTurns: ConversationTurn[],
  domContextText: string | null = null,
  recalledMemoryContext: string | null = null,
  isMemoryIntentQuestion = false
): ClaudeAgentMessage[] {
  const messages: ClaudeAgentMessage[] = [];

  for (const turn of priorTurns) {
    messages.push({
      role: turn.role,
      content: turn.content,
    });
  }

  const recentPanelActivitySummary = buildRecentPanelActivitySummary(priorTurns);

  const userQuestionText = buildUserQuestionText(
    question,
    domContextText,
    recalledMemoryContext,
    recentPanelActivitySummary,
    isMemoryIntentQuestion
  );

  if (imageBase64) {
    messages.push({
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: imageBase64,
          },
        },
        {
          type: "text",
          text: userQuestionText,
        },
      ],
    });
  } else {
    messages.push({
      role: "user",
      content: userQuestionText,
    });
  }

  return messages;
}

function buildUserQuestionText(
  question: string,
  domContextText: string | null,
  recalledMemoryContext: string | null,
  recentPanelActivitySummary: string,
  isMemoryIntentQuestion: boolean
): string {
  const questionSections: string[] = [];

  if (recentPanelActivitySummary) {
    questionSections.push(recentPanelActivitySummary);
  }

  if (recalledMemoryContext) {
    questionSections.push(
      `Memory from past conversations with this user:\n${recalledMemoryContext}`
    );
  } else if (isMemoryIntentQuestion && !recentPanelActivitySummary) {
    questionSections.push(
      "Background context from earlier sessions: (nothing relevant returned for this query)"
    );
  }

  if (domContextText) {
    questionSections.push(`Page structure snapshot:\n${domContextText}`);
  }

  questionSections.push(`User question: ${question}`);

  return questionSections.join("\n\n");
}

export function buildScreenshotFollowUpMessage(
  screenshotBase64: string
): ClaudeAgentUserMessage {
  return {
    role: "user",
    content: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: screenshotBase64,
        },
      },
      {
        type: "text",
        text: "Here is an updated screenshot after the last action.",
      },
    ],
  };
}

export function extractTextFromAssistantContent(
  content: ClaudeAssistantContentBlock[]
): string {
  return content
    .filter((block): block is ClaudeTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

export function extractToolUsesFromAssistantContent(
  content: ClaudeAssistantContentBlock[]
): ClaudeToolUseBlock[] {
  return content.filter(
    (block): block is ClaudeToolUseBlock => block.type === "tool_use"
  );
}

export async function callClaudeAgentStep(
  messages: ClaudeAgentMessage[],
  tools: JarvisToolDefinition[]
): Promise<ClaudeAgentStepResult> {
  const response = await fetch(WORKER_CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_AGENT_MAX_TOKENS,
      stream: false,
      system: JARVIS_SYSTEM_PROMPT,
      messages,
      tools,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(extractErrorMessage(errorBody, response.status));
  }

  const json = (await response.json()) as {
    content?: ClaudeAssistantContentBlock[];
    stop_reason?: string;
  };

  const content = json.content ?? [];
  if (content.length === 0) {
    throw new Error("Claude returned an empty response.");
  }

  return {
    content,
    stopReason: json.stop_reason ?? "end_turn",
  };
}
