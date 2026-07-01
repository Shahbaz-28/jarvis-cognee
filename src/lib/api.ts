import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL, WORKER_CHAT_ENDPOINT } from "./config";
import type { ConversationTurn } from "./conversation-session";
import { ASK_THIS_TAB_SYSTEM_PROMPT } from "./prompts";

interface ClaudeTextBlock {
  type: "text";
  text: string;
}

interface ClaudeImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg";
    data: string;
  };
}

type ClaudeContentBlock = ClaudeTextBlock | ClaudeImageBlock;

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
}

interface ClaudeRequestBody {
  model: string;
  max_tokens: number;
  stream: boolean;
  system: string;
  messages: ClaudeMessage[];
}

interface ClaudeErrorResponse {
  error?: {
    message?: string;
  };
  type?: string;
  message?: string;
}

function buildClaudeRequestBody(
  question: string,
  imageBase64: string | null,
  priorTurns: ConversationTurn[]
): ClaudeRequestBody {
  const messages: ClaudeMessage[] = [];

  for (const turn of priorTurns) {
    messages.push({
      role: turn.role,
      content: turn.content,
    });
  }

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
          text: question,
        },
      ],
    });
  } else {
    messages.push({
      role: "user",
      content: question,
    });
  }

  return {
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    stream: true,
    system: ASK_THIS_TAB_SYSTEM_PROMPT,
    messages,
  };
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

async function parseStreamingClaudeResponse(
  response: Response
): Promise<string> {
  if (!response.body) {
    throw new Error("Claude returned an empty response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bufferedText = "";
  let accumulatedAnswer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    bufferedText += decoder.decode(value, { stream: true });
    const eventChunks = bufferedText.split("\n\n");
    bufferedText = eventChunks.pop() ?? "";

    for (const eventChunk of eventChunks) {
      for (const line of eventChunk.split("\n")) {
        if (!line.startsWith("data: ")) {
          continue;
        }

        const jsonPayload = line.slice(6).trim();
        if (!jsonPayload || jsonPayload === "[DONE]") {
          continue;
        }

        try {
          const event = JSON.parse(jsonPayload) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };

          if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta" &&
            event.delta.text
          ) {
            accumulatedAnswer += event.delta.text;
          }
        } catch {
          // Skip malformed SSE chunks.
        }
      }
    }
  }

  if (!accumulatedAnswer.trim()) {
    throw new Error("Claude returned an empty answer.");
  }

  return accumulatedAnswer.trim();
}

export async function askPageWithContext(
  question: string,
  imageBase64: string | null,
  priorTurns: ConversationTurn[]
): Promise<string> {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) {
    throw new Error("Please enter a question first.");
  }

  const response = await fetch(WORKER_CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildClaudeRequestBody(trimmedQuestion, imageBase64, priorTurns)
    ),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(extractErrorMessage(errorBody, response.status));
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return parseStreamingClaudeResponse(response);
  }

  const json = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const textBlock = json.content?.find((block) => block.type === "text");
  if (!textBlock?.text) {
    throw new Error("Claude returned an unexpected response format.");
  }

  return textBlock.text.trim();
}
