import {
  SCREENSHOT_JPEG_QUALITY,
  SCREENSHOT_MAX_WIDTH_PX,
} from "./config";

export class ScreenshotCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenshotCaptureError";
  }
}

export interface ActiveBrowserTab {
  tabId: number;
  windowId: number;
  url: string;
}

const RESTRICTED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "devtools://",
];

function isRestrictedPageUrl(pageUrl: string): boolean {
  return RESTRICTED_URL_PREFIXES.some((prefix) => pageUrl.startsWith(prefix));
}

function base64FromDataUrl(dataUrl: string): string {
  const base64SeparatorIndex = dataUrl.indexOf(",");
  if (base64SeparatorIndex === -1) {
    throw new ScreenshotCaptureError("Screenshot data was empty.");
  }

  const base64Image = dataUrl.slice(base64SeparatorIndex + 1);
  if (!base64Image) {
    throw new ScreenshotCaptureError("Screenshot data was empty.");
  }

  return base64Image;
}

async function downscaleJpegBase64(
  base64Image: string,
  maxWidthPx: number,
  jpegQuality: number
): Promise<string> {
  if (typeof OffscreenCanvas === "undefined") {
    return base64Image;
  }

  try {
    const imageBytes = Uint8Array.from(atob(base64Image), (char) =>
      char.charCodeAt(0)
    );
    const imageBlob = new Blob([imageBytes], { type: "image/jpeg" });
    const bitmap = await createImageBitmap(imageBlob);

    const scale = Math.min(1, maxWidthPx / bitmap.width);
    if (scale >= 1) {
      bitmap.close();
      return base64Image;
    }

    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const context = canvas.getContext("2d");

    if (!context) {
      bitmap.close();
      return base64Image;
    }

    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const compressedBlob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: jpegQuality / 100,
    });

    const compressedBytes = new Uint8Array(await compressedBlob.arrayBuffer());
    let binaryString = "";
    for (const byte of compressedBytes) {
      binaryString += String.fromCharCode(byte);
    }

    return btoa(binaryString);
  } catch {
    return base64Image;
  }
}

function assertCapturablePageUrl(pageUrl: string): void {
  if (!pageUrl) {
    throw new ScreenshotCaptureError(
      "Could not read the active tab. Refresh the page and try again."
    );
  }

  if (isRestrictedPageUrl(pageUrl)) {
    throw new ScreenshotCaptureError(
      "This page cannot be captured. Open a normal website tab first."
    );
  }
}

async function captureWindowDataUrl(windowId: number): Promise<string> {
  return chrome.tabs.captureVisibleTab(windowId, {
    format: "jpeg",
    quality: SCREENSHOT_JPEG_QUALITY,
  });
}

function formatCaptureError(captureError: unknown): string {
  const captureMessage =
    captureError instanceof Error ? captureError.message : "Unknown error";

  if (captureMessage.includes("activeTab") || captureMessage.includes("all_urls")) {
    return (
      "Could not capture this page. Reload the extension at chrome://extensions, " +
      "click the website tab, then try again."
    );
  }

  return `Could not capture this page (${captureMessage}). Click the website tab, then try again.`;
}

export async function getActiveBrowserTab(): Promise<ActiveBrowserTab | null> {
  const focusedWindow = await chrome.windows.getLastFocused({
    windowTypes: ["normal"],
  });

  if (focusedWindow.id === undefined) {
    return null;
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId: focusedWindow.id,
  });

  if (activeTab?.id === undefined || activeTab.windowId === undefined) {
    return null;
  }

  return {
    tabId: activeTab.id,
    windowId: activeTab.windowId,
    url: activeTab.url ?? "",
  };
}

export async function captureActiveTabScreenshot(
  tab: ActiveBrowserTab
): Promise<string> {
  assertCapturablePageUrl(tab.url);

  let dataUrl: string;

  try {
    dataUrl = await captureWindowDataUrl(tab.windowId);
  } catch (captureError) {
    throw new ScreenshotCaptureError(formatCaptureError(captureError));
  }

  const base64Image = base64FromDataUrl(dataUrl);
  return downscaleJpegBase64(
    base64Image,
    SCREENSHOT_MAX_WIDTH_PX,
    SCREENSHOT_JPEG_QUALITY
  );
}
