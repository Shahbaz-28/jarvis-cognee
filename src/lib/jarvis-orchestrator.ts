import {
  buildInitialAgentMessages,
  buildScreenshotFollowUpMessage,
  callClaudeAgentStep,
  extractTextFromAssistantContent,
  extractToolUsesFromAssistantContent,
  type ClaudeAgentMessage,
  type ClaudeToolResultBlock,
} from "./api-agent";
import { ORCHESTRATOR_STEP_DELAY_MS } from "./config";
import { parseHighlightsFromAnswer } from "./highlight-parser";
import type { ActionResult } from "./messaging";
import {
  executeJarvisTool,
  JARVIS_TOOL_DEFINITIONS,
  type ToolExecutionContext,
} from "./tools";
import type { ConversationTurn } from "./conversation-session";

export type OrchestratorPhase = "thinking" | "acting";

export const MAX_ORCHESTRATOR_STEPS = 5;

export interface JarvisOrchestratorResult {
  answer: string;
  highlightsApplied: number;
  actionsPerformed: number;
  actionResults: ActionResult[];
  orchestratorSteps: number;
}

function reportOrchestratorStatus(
  phase: OrchestratorPhase,
  detail?: string
): void {
  void chrome.runtime
    .sendMessage({
      type: "ORCHESTRATOR_STATUS",
      phase,
      detail,
    })
    .catch(() => {
      // Side panel may be closed.
    });
}

function countSuccessfulActions(actionResults: ActionResult[]): number {
  return actionResults.filter((actionResult) => actionResult.success).length;
}

function waitForOrchestratorStepDelay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ORCHESTRATOR_STEP_DELAY_MS);
  });
}

async function runTagParsingFallback(
  rawText: string,
  tabId: number,
  accumulatedActionResults: ActionResult[],
  accumulatedHighlights: number
): Promise<JarvisOrchestratorResult> {
  const { cleanAnswer, highlights, actions } = parseHighlightsFromAnswer(rawText);
  let actionResults = [...accumulatedActionResults];
  let highlightsApplied = accumulatedHighlights;

  if (actions.length > 0) {
    reportOrchestratorStatus("acting", "Running page actions");
    try {
      const tabResponse = await chrome.tabs.sendMessage(tabId, {
        type: "PERFORM_ACTIONS",
        actions,
      });
      actionResults = [
        ...actionResults,
        ...(tabResponse?.actionResults ?? []),
      ];
    } catch {
      // Content script unavailable.
    }
  }

  if (highlights.length > 0) {
    try {
      const tabResponse = await chrome.tabs.sendMessage(tabId, {
        type: "SHOW_HIGHLIGHTS",
        highlights,
      });
      highlightsApplied += tabResponse?.count ?? 0;
    } catch {
      // Content script unavailable.
    }
  }

  return {
    answer: cleanAnswer || rawText,
    highlightsApplied,
    actionsPerformed: countSuccessfulActions(actionResults),
    actionResults,
    orchestratorSteps: 0,
  };
}

export async function runJarvisOrchestrator(params: {
  question: string;
  screenshotBase64: string | null;
  domContextText: string | null;
  tabId: number;
  windowId: number;
  priorTurns: ConversationTurn[];
  recalledMemoryContext?: string | null;
  isMemoryIntentQuestion?: boolean;
}): Promise<JarvisOrchestratorResult> {
  const toolContext: ToolExecutionContext = {
    tabId: params.tabId,
    windowId: params.windowId,
  };

  const agentMessages: ClaudeAgentMessage[] = buildInitialAgentMessages(
    params.question,
    params.screenshotBase64,
    params.priorTurns,
    params.domContextText,
    params.recalledMemoryContext ?? null,
    params.isMemoryIntentQuestion ?? false
  );

  let accumulatedActionResults: ActionResult[] = [];
  let accumulatedHighlightsApplied = 0;
  let pendingScreenshotBase64: string | null = null;
  let lastAssistantText = "";

  for (
    let orchestratorStep = 0;
    orchestratorStep < MAX_ORCHESTRATOR_STEPS;
    orchestratorStep += 1
  ) {
    reportOrchestratorStatus("thinking");

    const agentStepResult = await callClaudeAgentStep(
      agentMessages,
      JARVIS_TOOL_DEFINITIONS
    );

    lastAssistantText = extractTextFromAssistantContent(agentStepResult.content);
    const toolUses = extractToolUsesFromAssistantContent(agentStepResult.content);

    agentMessages.push({
      role: "assistant",
      content: agentStepResult.content,
    });

    if (toolUses.length === 0) {
      if (lastAssistantText) {
        return runTagParsingFallback(
          lastAssistantText,
          params.tabId,
          accumulatedActionResults,
          accumulatedHighlightsApplied
        );
      }

      break;
    }

    reportOrchestratorStatus("acting");
    const toolResultBlocks: ClaudeToolResultBlock[] = [];
    let answerText: string | null = null;
    let shouldEndTurn = false;

    const actionToolUses = toolUses.filter(
      (toolUse) =>
        toolUse.name !== "answer_user" && toolUse.name !== "end_turn"
    );
    const answerToolUses = toolUses.filter(
      (toolUse) => toolUse.name === "answer_user"
    );
    const endTurnToolUses = toolUses.filter(
      (toolUse) => toolUse.name === "end_turn"
    );

    for (let actionIndex = 0; actionIndex < actionToolUses.length; actionIndex += 1) {
      if (actionIndex > 0) {
        await waitForOrchestratorStepDelay();
      }

      const toolUse = actionToolUses[actionIndex];
      const executionOutcome = await executeJarvisTool(
        toolUse.name,
        toolUse.input,
        toolContext
      );

      accumulatedActionResults = [
        ...accumulatedActionResults,
        ...executionOutcome.actionResults,
      ];
      accumulatedHighlightsApplied += executionOutcome.highlightsApplied;

      if (executionOutcome.capturedScreenshotBase64) {
        pendingScreenshotBase64 = executionOutcome.capturedScreenshotBase64;
      }

      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: executionOutcome.toolResultContent,
      });
    }

    for (const toolUse of answerToolUses) {
      const executionOutcome = await executeJarvisTool(
        toolUse.name,
        toolUse.input,
        toolContext
      );

      if (executionOutcome.answerText) {
        answerText = executionOutcome.answerText;
      }

      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: executionOutcome.toolResultContent,
      });
    }

    for (const toolUse of endTurnToolUses) {
      shouldEndTurn = true;
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify({ ended: true }),
      });
    }

    if (answerText) {
      return {
        answer: answerText,
        highlightsApplied: accumulatedHighlightsApplied,
        actionsPerformed: countSuccessfulActions(accumulatedActionResults),
        actionResults: accumulatedActionResults,
        orchestratorSteps: orchestratorStep + 1,
      };
    }

    agentMessages.push({
      role: "user",
      content: toolResultBlocks,
    });

    if (pendingScreenshotBase64) {
      agentMessages.push(
        buildScreenshotFollowUpMessage(pendingScreenshotBase64)
      );
      pendingScreenshotBase64 = null;
    }

    if (shouldEndTurn) {
      break;
    }
  }

  if (lastAssistantText) {
    return runTagParsingFallback(
      lastAssistantText,
      params.tabId,
      accumulatedActionResults,
      accumulatedHighlightsApplied
    );
  }

  return {
    answer: "I couldn't finish that request. Try asking again.",
    highlightsApplied: accumulatedHighlightsApplied,
    actionsPerformed: countSuccessfulActions(accumulatedActionResults),
    actionResults: accumulatedActionResults,
    orchestratorSteps: MAX_ORCHESTRATOR_STEPS,
  };
}
