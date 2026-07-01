declare global {
  interface Window {
    __jarvisVoContentScriptLoaded?: boolean;
  }
}

import "./highlight.css";
import {
  findTargetElement,
  performVerifiedPageActions,
  performVerifiedTypeText,
  readVisiblePageText,
  type PageAction,
} from "./page-actions";
import { extractPageDomSnapshot } from "./page-context";
interface HighlightTarget {
  selector: string;
  label: string;
}

interface ContentScriptMessage {
  type:
    | "PING_CONTENT"
    | "SHOW_HIGHLIGHTS"
    | "CLEAR_HIGHLIGHTS"
    | "PERFORM_ACTIONS"
    | "READ_PAGE_TEXT"
    | "TYPE_TEXT"
    | "GET_DOM_SNAPSHOT";
  highlights?: HighlightTarget[];
  actions?: PageAction[];
  maxChars?: number;
  selector?: string;
  label?: string;
  text?: string;
}

interface TrackedHighlight {
  targetElement: Element;
  overlayElement: HTMLDivElement;
}

const OVERLAY_ROOT_ID = "jarvis-vo-overlay-root";
const TRACKED_HIGHLIGHTS: TrackedHighlight[] = [];
let positionUpdateFrameId: number | null = null;

function getOverlayRoot(): HTMLDivElement {
  const existingRoot = document.getElementById(OVERLAY_ROOT_ID);
  if (existingRoot instanceof HTMLDivElement) {
    return existingRoot;
  }

  const overlayRoot = document.createElement("div");
  overlayRoot.id = OVERLAY_ROOT_ID;
  overlayRoot.className = "jarvis-vo-overlay-root";
  document.documentElement.appendChild(overlayRoot);
  return overlayRoot;
}

function positionOverlayForTarget(
  targetElement: Element,
  overlayElement: HTMLDivElement
): void {
  const targetRect = targetElement.getBoundingClientRect();
  if (targetRect.width === 0 && targetRect.height === 0) {
    overlayElement.style.display = "none";
    return;
  }

  overlayElement.style.display = "block";
  overlayElement.style.left = `${Math.max(0, targetRect.left - 4)}px`;
  overlayElement.style.top = `${Math.max(0, targetRect.top - 4)}px`;
  overlayElement.style.width = `${targetRect.width + 8}px`;
  overlayElement.style.height = `${targetRect.height + 8}px`;
}

function updateAllHighlightPositions(): void {
  for (const trackedHighlight of TRACKED_HIGHLIGHTS) {
    positionOverlayForTarget(
      trackedHighlight.targetElement,
      trackedHighlight.overlayElement
    );
  }
}

function schedulePositionUpdate(): void {
  if (positionUpdateFrameId !== null) {
    return;
  }

  positionUpdateFrameId = window.requestAnimationFrame(() => {
    positionUpdateFrameId = null;
    updateAllHighlightPositions();
  });
}

function clearHighlights(): void {
  const overlayRoot = document.getElementById(OVERLAY_ROOT_ID);
  if (overlayRoot) {
    overlayRoot.remove();
  }

  TRACKED_HIGHLIGHTS.length = 0;
}

function showHighlights(highlights: HighlightTarget[]): void {
  clearHighlights();
  const overlayRoot = getOverlayRoot();

  for (const highlight of highlights) {
    const targetElement = findTargetElement(highlight.selector, highlight.label);
    if (!targetElement) {
      continue;
    }

    const overlayElement = document.createElement("div");
    overlayElement.className = "jarvis-vo-highlight-box";

    const labelElement = document.createElement("div");
    labelElement.className = "jarvis-vo-highlight-label";
    labelElement.textContent = highlight.label;
    overlayElement.appendChild(labelElement);

    overlayRoot.appendChild(overlayElement);
    positionOverlayForTarget(targetElement, overlayElement);

    TRACKED_HIGHLIGHTS.push({
      targetElement,
      overlayElement,
    });
  }
}

if (!window.__jarvisVoContentScriptLoaded) {
  window.__jarvisVoContentScriptLoaded = true;

  window.addEventListener("scroll", schedulePositionUpdate, true);
  window.addEventListener("resize", schedulePositionUpdate);

  chrome.runtime.onMessage.addListener(
    (message: ContentScriptMessage, _sender, sendResponse) => {
      if (message.type === "PING_CONTENT") {
        sendResponse({ ok: true });
        return true;
      }

      if (message.type === "CLEAR_HIGHLIGHTS") {
        clearHighlights();
        sendResponse({ ok: true });
        return true;
      }

      if (message.type === "SHOW_HIGHLIGHTS") {
        showHighlights(message.highlights ?? []);
        sendResponse({ ok: true, count: TRACKED_HIGHLIGHTS.length });
        return true;
      }

      if (message.type === "PERFORM_ACTIONS") {
        void performVerifiedPageActions(message.actions ?? []).then(
          (actionResults) => {
            sendResponse({ ok: true, actionResults });
          }
        );
        return true;
      }

      if (message.type === "READ_PAGE_TEXT") {
        const maxChars = message.maxChars ?? 4000;
        const pageText = readVisiblePageText(maxChars);
        sendResponse({ ok: true, pageText });
        return true;
      }

      if (message.type === "GET_DOM_SNAPSHOT") {
        const domSnapshot = extractPageDomSnapshot();
        sendResponse({ ok: true, ...domSnapshot });
        return true;
      }

      if (message.type === "TYPE_TEXT") {
        void performVerifiedTypeText(
          message.selector ?? message.label ?? "",
          message.label ?? "",
          message.text ?? ""
        ).then((actionResult) => {
          sendResponse({ ok: true, actionResults: [actionResult] });
        });
        return true;
      }

      return false;
    }
  );
}