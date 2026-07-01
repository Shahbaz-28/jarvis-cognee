import type { ActionResult, HighlightTarget, PageAction } from "./messaging";

export interface ToolExecutionContext {
  tabId: number;
  windowId: number;
}

export interface JarvisToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const JARVIS_TOOL_DEFINITIONS: JarvisToolDefinition[] = [
  {
    name: "answer_user",
    description:
      "Deliver the final plain-text answer the user will hear or read. Always call this when you are ready to respond.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Short plain-text answer for the user (1-3 sentences).",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "click_element",
    description: "Click a button, link, or other interactive element on the page.",
    input_schema: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description: "Visible text or aria-label of the element.",
        },
        selector: {
          type: "string",
          description: "Optional CSS selector if known.",
        },
      },
      required: ["label"],
    },
  },
  {
    name: "scroll",
    description:
      "Scroll the page or scroll an element into view. Use direction for whole-page scrolls.",
    input_schema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          description: 'Page scroll direction: "up", "down", "top", or "bottom".',
        },
        label: {
          type: "string",
          description: "Visible label of an element to scroll into view.",
        },
        selector: {
          type: "string",
          description: "Optional CSS selector for the scroll target.",
        },
      },
    },
  },
  {
    name: "highlight_element",
    description: "Highlight an element on the page without clicking it.",
    input_schema: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description: "Visible text or aria-label of the element.",
        },
        selector: {
          type: "string",
          description: "Optional CSS selector if known.",
        },
      },
      required: ["label"],
    },
  },
  {
    name: "type_text",
    description: "Type text into an input field or textarea.",
    input_schema: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description: "Visible label, placeholder, or aria-label of the field.",
        },
        text: {
          type: "string",
          description: "Text to type into the field.",
        },
        selector: {
          type: "string",
          description: "Optional CSS selector if known.",
        },
      },
      required: ["label", "text"],
    },
  },
  {
    name: "read_dom_snapshot",
    description:
      "Get a structured snapshot of the page: title, headings, buttons, links, and form fields with selector hints.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "read_page_text",
    description: "Read visible text content from the current page.",
    input_schema: {
      type: "object",
      properties: {
        maxChars: {
          type: "number",
          description: "Maximum characters to return (default 4000).",
        },
      },
    },
  },
  {
    name: "capture_screen",
    description:
      "Capture a fresh screenshot after a page change. Use before describing what changed.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "end_turn",
    description: "Signal that tool work is complete when no user-facing answer is needed.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

type TabMessageResponse = {
  actionResults?: ActionResult[];
  count?: number;
  pageText?: string;
  snapshotText?: string;
  snapshotHash?: string;
  url?: string;
  title?: string;
  ok?: boolean;
};

async function isContentScriptReachable(tabId: number): Promise<boolean> {
  try {
    const pingResponse = await chrome.tabs.sendMessage(tabId, {
      type: "PING_CONTENT",
    });
    return pingResponse?.ok === true;
  } catch {
    return false;
  }
}

async function injectContentScriptOnTab(tabId: number): Promise<boolean> {
  const contentScriptFiles = chrome.runtime.getManifest().content_scripts?.[0]?.js;
  if (!contentScriptFiles?.length) {
    return false;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: contentScriptFiles,
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureContentScriptOnTab(tabId: number): Promise<boolean> {
  if (await isContentScriptReachable(tabId)) {
    return true;
  }

  const injectedContentScript = await injectContentScriptOnTab(tabId);
  if (!injectedContentScript) {
    return false;
  }

  return isContentScriptReachable(tabId);
}

async function sendMessageToTab(
  tabId: number,
  message: Record<string, unknown>
): Promise<TabMessageResponse | undefined> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    const contentScriptReady = await ensureContentScriptOnTab(tabId);
    if (!contentScriptReady) {
      return undefined;
    }

    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch {
      return undefined;
    }
  }
}

function stringFromToolInput(
  toolInput: Record<string, unknown>,
  key: string,
  fallback = ""
): string {
  const value = toolInput[key];
  if (typeof value === "string") {
    return value.trim();
  }

  return fallback;
}

function numberFromToolInput(
  toolInput: Record<string, unknown>,
  key: string,
  fallback: number
): number {
  const value = toolInput[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return fallback;
}

function formatActionResultForClaude(actionResult: ActionResult): string {
  return JSON.stringify({
    success: actionResult.success,
    message: actionResult.message,
    actionType: actionResult.actionType,
    label: actionResult.label,
    evidence: actionResult.evidence ?? null,
  });
}

function actionResultIndicatesNavigation(actionResult: ActionResult): boolean {
  return (
    actionResult.actionType === "click" &&
    actionResult.success &&
    (actionResult.evidence?.includes("URL changed") ?? false)
  );
}

async function attachCaptureAfterNavigation(
  outcome: JarvisToolExecutionOutcome,
  context: ToolExecutionContext
): Promise<JarvisToolExecutionOutcome> {
  const navigatedClickResult = outcome.actionResults.find(
    actionResultIndicatesNavigation
  );

  if (!navigatedClickResult) {
    return outcome;
  }

  try {
    const capturedScreenshotBase64 = await captureTabScreenshotBase64(
      context.windowId
    );

    return {
      ...outcome,
      capturedScreenshotBase64,
      actionResults: [
        ...outcome.actionResults,
        {
          actionType: "capture",
          label: "screenshot",
          success: true,
          message: "Auto-captured screenshot after navigation.",
          evidence: "Triggered because the click changed the page URL.",
        },
      ],
    };
  } catch {
    return outcome;
  }
}

function base64FromDataUrl(dataUrl: string): string {
  const base64SeparatorIndex = dataUrl.indexOf(",");
  if (base64SeparatorIndex === -1) {
    throw new Error("Screenshot data was empty.");
  }

  const base64Image = dataUrl.slice(base64SeparatorIndex + 1);
  if (!base64Image) {
    throw new Error("Screenshot data was empty.");
  }

  return base64Image;
}

export async function captureTabScreenshotBase64(
  windowId: number
): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "jpeg",
    quality: 50,
  });

  return base64FromDataUrl(dataUrl);
}

export interface JarvisToolExecutionOutcome {
  toolResultContent: string;
  actionResults: ActionResult[];
  highlightsApplied: number;
  capturedScreenshotBase64: string | null;
  answerText: string | null;
  shouldEndTurn: boolean;
}

export async function executeJarvisTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<JarvisToolExecutionOutcome> {
  const emptyOutcome: JarvisToolExecutionOutcome = {
    toolResultContent: "",
    actionResults: [],
    highlightsApplied: 0,
    capturedScreenshotBase64: null,
    answerText: null,
    shouldEndTurn: false,
  };

  if (toolName === "answer_user") {
    const answerText = stringFromToolInput(toolInput, "text");
    return {
      ...emptyOutcome,
      toolResultContent: JSON.stringify({ delivered: true }),
      answerText: answerText || "Done.",
    };
  }

  if (toolName === "end_turn") {
    return {
      ...emptyOutcome,
      toolResultContent: JSON.stringify({ ended: true }),
      shouldEndTurn: true,
    };
  }

  if (toolName === "click_element") {
    const label = stringFromToolInput(toolInput, "label");
    const selector = stringFromToolInput(toolInput, "selector", label);
    const pageAction: PageAction = {
      actionType: "click",
      selector,
      label,
    };
    const tabResponse = await sendMessageToTab(context.tabId, {
      type: "PERFORM_ACTIONS",
      actions: [pageAction],
    });
    const actionResults = tabResponse?.actionResults ?? [
      {
        actionType: "click",
        label,
        success: false,
        message: `I couldn't find "${label}" to click on this page.`,
        evidence: "Element lookup failed in the content script.",
      },
    ];

    const clickOutcome: JarvisToolExecutionOutcome = {
      ...emptyOutcome,
      toolResultContent: formatActionResultForClaude(actionResults[0]),
      actionResults,
    };

    return attachCaptureAfterNavigation(clickOutcome, context);
  }

  if (toolName === "scroll") {
    const direction = stringFromToolInput(toolInput, "direction");
    const label = stringFromToolInput(toolInput, "label");
    const selector = stringFromToolInput(toolInput, "selector");

    let pageAction: PageAction;
    if (direction) {
      pageAction = {
        actionType: "scroll",
        selector: "page",
        label: direction,
      };
    } else {
      pageAction = {
        actionType: "scroll",
        selector: selector || label,
        label: label || selector,
      };
    }

    const tabResponse = await sendMessageToTab(context.tabId, {
      type: "PERFORM_ACTIONS",
      actions: [pageAction],
    });
    const actionResults = tabResponse?.actionResults ?? [
      {
        actionType: "scroll",
        label: label || direction || "page",
        success: false,
        message: `I couldn't scroll to "${label || direction || "the target"}".`,
        evidence: "Scroll target was not found or did not move.",
      },
    ];

    return {
      ...emptyOutcome,
      toolResultContent: formatActionResultForClaude(actionResults[0]),
      actionResults,
    };
  }

  if (toolName === "highlight_element") {
    const label = stringFromToolInput(toolInput, "label");
    const selector = stringFromToolInput(toolInput, "selector", label);
    const highlightTarget: HighlightTarget = { selector, label };

    const tabResponse = await sendMessageToTab(context.tabId, {
      type: "SHOW_HIGHLIGHTS",
      highlights: [highlightTarget],
    });
    const highlightsApplied = tabResponse?.count ?? 0;
    const success = highlightsApplied > 0;

    return {
      ...emptyOutcome,
      toolResultContent: JSON.stringify({
        success,
        message: success
          ? `Highlighted "${label}".`
          : `Could not find "${label}" to highlight.`,
        label,
      }),
      highlightsApplied,
      actionResults: [
        {
          actionType: "highlight",
          label,
          success,
          message: success
            ? `Highlighted "${label}".`
            : `Could not find "${label}" to highlight.`,
        },
      ],
    };
  }

  if (toolName === "type_text") {
    const label = stringFromToolInput(toolInput, "label");
    const text = stringFromToolInput(toolInput, "text");
    const selector = stringFromToolInput(toolInput, "selector", label);

    const tabResponse = await sendMessageToTab(context.tabId, {
      type: "TYPE_TEXT",
      selector,
      label,
      text,
    });
    const actionResults = tabResponse?.actionResults ?? [
      {
        actionType: "type",
        label,
        success: false,
        message: `I couldn't find an input field for "${label}".`,
        evidence: "No matching input, textarea, or contenteditable field.",
      },
    ];

    return {
      ...emptyOutcome,
      toolResultContent: formatActionResultForClaude(actionResults[0]),
      actionResults,
    };
  }

  if (toolName === "read_dom_snapshot") {
    const tabResponse = await sendMessageToTab(context.tabId, {
      type: "GET_DOM_SNAPSHOT",
    });
    const snapshotText = tabResponse?.snapshotText ?? "";

    return {
      ...emptyOutcome,
      toolResultContent: JSON.stringify({
        success: snapshotText.length > 0,
        url: tabResponse?.url ?? "",
        title: tabResponse?.title ?? "",
        snapshotText,
        snapshotHash: tabResponse?.snapshotHash ?? "",
      }),
      actionResults: [
        {
          actionType: "read",
          label: "dom snapshot",
          success: snapshotText.length > 0,
          message:
            snapshotText.length > 0
              ? "Read structured DOM snapshot from the page."
              : "Could not read DOM snapshot from the page.",
          evidence: tabResponse?.title ?? undefined,
        },
      ],
    };
  }

  if (toolName === "read_page_text") {
    const maxChars = numberFromToolInput(toolInput, "maxChars", 4000);
    const tabResponse = await sendMessageToTab(context.tabId, {
      type: "READ_PAGE_TEXT",
      maxChars,
    });
    const pageText = tabResponse?.pageText ?? "";

    return {
      ...emptyOutcome,
      toolResultContent: JSON.stringify({
        success: pageText.length > 0,
        pageText,
        charCount: pageText.length,
      }),
      actionResults: [
        {
          actionType: "read",
          label: "page text",
          success: pageText.length > 0,
          message:
            pageText.length > 0
              ? `Read ${pageText.length} characters from the page.`
              : "Could not read text from the page.",
        },
      ],
    };
  }

  if (toolName === "capture_screen") {
    try {
      const capturedScreenshotBase64 = await captureTabScreenshotBase64(
        context.windowId
      );

      return {
        ...emptyOutcome,
        toolResultContent: JSON.stringify({
          success: true,
          message: "Screenshot captured.",
        }),
        capturedScreenshotBase64,
        actionResults: [
          {
            actionType: "capture",
            label: "screenshot",
            success: true,
            message: "Captured a fresh screenshot.",
          },
        ],
      };
    } catch (captureError) {
      const message =
        captureError instanceof Error
          ? captureError.message
          : "Screenshot capture failed.";

      return {
        ...emptyOutcome,
        toolResultContent: JSON.stringify({ success: false, message }),
        actionResults: [
          {
            actionType: "capture",
            label: "screenshot",
            success: false,
            message,
          },
        ],
      };
    }
  }

  return {
    ...emptyOutcome,
    toolResultContent: JSON.stringify({
      success: false,
      message: `Unknown tool "${toolName}".`,
    }),
  };
}
