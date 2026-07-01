export type PageActionType = "click" | "scroll";

export interface PageAction {
  actionType: PageActionType;
  selector: string;
  label: string;
}

export interface VerifiedActionResult {
  actionType: PageActionType | "type";
  label: string;
  success: boolean;
  message: string;
  evidence?: string;
}

export const ACTION_VERIFICATION_DELAY_MS = 500;

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function waitForVerificationDelay(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ACTION_VERIFICATION_DELAY_MS);
  });
}

function logFailedElementLookup(selector: string, label: string): void {
  console.warn(
    `[Jarvis VO] Could not find element. selector="${selector}" label="${label}"`
  );
}

function findElementBySelector(selector: string): Element | null {
  if (!selector || selector.toLowerCase() === "page") {
    return null;
  }

  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function elementTextMatchesLabel(element: Element, label: string): boolean {
  const normalizedLabel = normalizeText(label);
  const elementText = normalizeText(element.textContent ?? "");
  if (!elementText) {
    return false;
  }

  return (
    elementText === normalizedLabel || elementText.includes(normalizedLabel)
  );
}

function elementAttributeMatchesLabel(element: Element, label: string): boolean {
  const normalizedLabel = normalizeText(label);
  const attributesToCheck = [
    "aria-label",
    "title",
    "placeholder",
    "alt",
    "value",
    "name",
  ];

  return attributesToCheck.some((attributeName) => {
    const attributeValue = element.getAttribute(attributeName);
    if (!attributeValue) {
      return false;
    }

    const normalizedAttributeValue = normalizeText(attributeValue);
    return (
      normalizedAttributeValue === normalizedLabel ||
      normalizedAttributeValue.includes(normalizedLabel)
    );
  });
}

function findElementByAriaLabel(label: string): Element | null {
  const normalizedLabel = normalizeText(label);
  const ariaElements = document.querySelectorAll("[aria-label]");

  for (const ariaElement of ariaElements) {
    const ariaLabel = normalizeText(ariaElement.getAttribute("aria-label") ?? "");
    if (ariaLabel === normalizedLabel || ariaLabel.includes(normalizedLabel)) {
      return ariaElement;
    }
  }

  return null;
}

function findElementByRoleAndName(label: string): Element | null {
  const roleSelectors = [
    "[role='button']",
    "[role='link']",
    "[role='menuitem']",
    "[role='tab']",
    "[role='textbox']",
    "button",
    "a",
    "input",
    "textarea",
  ];

  for (const roleSelector of roleSelectors) {
    const candidateElements = document.querySelectorAll(roleSelector);
    for (const candidateElement of candidateElements) {
      if (
        elementTextMatchesLabel(candidateElement, label) ||
        elementAttributeMatchesLabel(candidateElement, label)
      ) {
        return candidateElement;
      }
    }
  }

  return null;
}

function findElementByVisibleText(label: string): Element | null {
  const candidateElements = document.querySelectorAll(
    "button, a, input, textarea, select, label, h1, h2, h3, h4, summary, [role='button']"
  );

  for (const candidateElement of candidateElements) {
    if (elementTextMatchesLabel(candidateElement, label)) {
      return candidateElement;
    }
  }

  return null;
}

export function findTargetElement(selector: string, label: string): Element | null {
  const selectorMatch = findElementBySelector(selector);
  if (selectorMatch) {
    return selectorMatch;
  }

  const ariaLabelMatch = findElementByAriaLabel(label);
  if (ariaLabelMatch) {
    return ariaLabelMatch;
  }

  const roleMatch = findElementByRoleAndName(label);
  if (roleMatch) {
    return roleMatch;
  }

  const visibleTextMatch = findElementByVisibleText(label);
  if (visibleTextMatch) {
    return visibleTextMatch;
  }

  logFailedElementLookup(selector, label);
  return null;
}

export function isElementInViewport(element: Element): boolean {
  const elementRect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

  return (
    elementRect.top < viewportHeight &&
    elementRect.bottom > 0 &&
    elementRect.left < viewportWidth &&
    elementRect.right > 0 &&
    elementRect.width > 0 &&
    elementRect.height > 0
  );
}

function scrollPage(directionLabel: string): VerifiedActionResult {
  const normalizedDirection = normalizeText(directionLabel);
  const scrollTopBefore = window.scrollY;

  if (normalizedDirection === "top" || normalizedDirection === "up") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return {
      actionType: "scroll",
      label: directionLabel,
      success: true,
      message: "Scrolled to the top of the page.",
      evidence: `Scroll position before: ${scrollTopBefore}px.`,
    };
  }

  if (normalizedDirection === "bottom" || normalizedDirection === "down") {
    window.scrollBy({ top: window.innerHeight * 0.85, behavior: "smooth" });
    return {
      actionType: "scroll",
      label: directionLabel,
      success: true,
      message: "Scrolled down the page.",
      evidence: `Scroll position before: ${scrollTopBefore}px.`,
    };
  }

  return {
    actionType: "scroll",
    label: directionLabel,
    success: false,
    message: `Unknown scroll direction "${directionLabel}".`,
    evidence: "Valid directions: up, down, top, bottom.",
  };
}

async function verifyPageScroll(
  directionLabel: string,
  scrollTopBefore: number
): Promise<VerifiedActionResult> {
  await waitForVerificationDelay();

  const scrollTopAfter = window.scrollY;
  const scrollPositionChanged = Math.abs(scrollTopAfter - scrollTopBefore) > 8;

  return {
    actionType: "scroll",
    label: directionLabel,
    success: scrollPositionChanged,
    message: scrollPositionChanged
      ? `Scrolled the page (${directionLabel}).`
      : `Page scroll may not have moved (${directionLabel}).`,
    evidence: `Scroll Y changed from ${scrollTopBefore}px to ${scrollTopAfter}px.`,
  };
}

async function verifyClickAction(
  targetElement: Element,
  label: string,
  pageUrlBeforeClick: string
): Promise<VerifiedActionResult> {
  if (!(targetElement instanceof HTMLElement)) {
    return {
      actionType: "click",
      label,
      success: false,
      message: `Could not click "${label}".`,
      evidence: "Target was not a clickable HTML element.",
    };
  }

  targetElement.scrollIntoView({
    block: "center",
    inline: "center",
    behavior: "smooth",
  });
  targetElement.focus({ preventScroll: true });
  targetElement.click();

  await waitForVerificationDelay();

  const pageUrlAfterClick = window.location.href;
  const urlChanged = pageUrlAfterClick !== pageUrlBeforeClick;
  const elementStillPresent = document.contains(targetElement);

  if (urlChanged) {
    return {
      actionType: "click",
      label,
      success: true,
      message: `Clicked "${label}" and the page navigated.`,
      evidence: `URL changed from "${pageUrlBeforeClick}" to "${pageUrlAfterClick}".`,
    };
  }

  if (!elementStillPresent) {
    return {
      actionType: "click",
      label,
      success: true,
      message: `Clicked "${label}" and the page updated.`,
      evidence: "Clicked element was removed from the DOM after the click.",
    };
  }

  return {
    actionType: "click",
    label,
    success: true,
    message: `Clicked "${label}".`,
    evidence: "Click dispatched; URL unchanged and element still present.",
  };
}

async function verifyScrollToElement(
  targetElement: Element,
  label: string
): Promise<VerifiedActionResult> {
  targetElement.scrollIntoView({
    block: "center",
    inline: "center",
    behavior: "smooth",
  });

  await waitForVerificationDelay();

  const inViewport = isElementInViewport(targetElement);

  return {
    actionType: "scroll",
    label,
    success: inViewport,
    message: inViewport
      ? `Scrolled to "${label}".`
      : `Tried to scroll to "${label}" but it is not fully in view.`,
    evidence: inViewport
      ? `"${label}" is now in the viewport.`
      : `"${label}" is still outside the viewport after scrolling.`,
  };
}

export async function performVerifiedPageAction(
  action: PageAction
): Promise<VerifiedActionResult> {
  if (action.actionType === "scroll" && action.selector.toLowerCase() === "page") {
    const scrollTopBefore = window.scrollY;
    const initialResult = scrollPage(action.label);

    if (!initialResult.success) {
      return initialResult;
    }

    return verifyPageScroll(action.label, scrollTopBefore);
  }

  const targetElement = findTargetElement(action.selector, action.label);
  if (!targetElement) {
    return {
      actionType: action.actionType,
      label: action.label,
      success: false,
      message: `Could not find "${action.label}" on the page.`,
      evidence: `No match for label "${action.label}" or selector "${action.selector}".`,
    };
  }

  if (action.actionType === "click") {
    return verifyClickAction(
      targetElement,
      action.label,
      window.location.href
    );
  }

  return verifyScrollToElement(targetElement, action.label);
}

export async function performVerifiedPageActions(
  actions: PageAction[]
): Promise<VerifiedActionResult[]> {
  const actionResults: VerifiedActionResult[] = [];

  for (const action of actions) {
    actionResults.push(await performVerifiedPageAction(action));
  }

  return actionResults;
}

function setNativeInputValue(
  inputElement: HTMLInputElement | HTMLTextAreaElement,
  text: string
): void {
  const prototype =
    inputElement instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (valueSetter) {
    valueSetter.call(inputElement, text);
  } else {
    inputElement.value = text;
  }
}

export async function performVerifiedTypeText(
  selector: string,
  label: string,
  text: string
): Promise<VerifiedActionResult> {
  const targetElement = findTargetElement(selector, label);

  if (targetElement instanceof HTMLInputElement) {
    targetElement.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "smooth",
    });
    targetElement.focus({ preventScroll: true });
    setNativeInputValue(targetElement, text);
    targetElement.dispatchEvent(new Event("input", { bubbles: true }));
    targetElement.dispatchEvent(new Event("change", { bubbles: true }));

    await waitForVerificationDelay();

    const valueMatches = targetElement.value === text;

    return {
      actionType: "type",
      label,
      success: valueMatches,
      message: valueMatches
        ? `Typed "${text}" into "${label}".`
        : `Typed into "${label}" but the value did not stick.`,
      evidence: valueMatches
        ? `Input value is "${targetElement.value}".`
        : `Expected "${text}" but field has "${targetElement.value}".`,
    };
  }

  if (targetElement instanceof HTMLTextAreaElement) {
    targetElement.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "smooth",
    });
    targetElement.focus({ preventScroll: true });
    setNativeInputValue(targetElement, text);
    targetElement.dispatchEvent(new Event("input", { bubbles: true }));
    targetElement.dispatchEvent(new Event("change", { bubbles: true }));

    await waitForVerificationDelay();

    const valueMatches = targetElement.value === text;

    return {
      actionType: "type",
      label,
      success: valueMatches,
      message: valueMatches
        ? `Typed "${text}" into "${label}".`
        : `Typed into "${label}" but the value did not stick.`,
      evidence: valueMatches
        ? `Textarea value is "${targetElement.value}".`
        : `Expected "${text}" but field has "${targetElement.value}".`,
    };
  }

  if (
    targetElement instanceof HTMLElement &&
    targetElement.isContentEditable
  ) {
    targetElement.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "smooth",
    });
    targetElement.focus({ preventScroll: true });
    targetElement.textContent = text;
    targetElement.dispatchEvent(new Event("input", { bubbles: true }));

    await waitForVerificationDelay();

    const typedText = normalizeText(targetElement.textContent ?? "");
    const expectedText = normalizeText(text);
    const valueMatches =
      typedText === expectedText || typedText.includes(expectedText);

    return {
      actionType: "type",
      label,
      success: valueMatches,
      message: valueMatches
        ? `Typed "${text}" into "${label}".`
        : `Typed into "${label}" but content did not match.`,
      evidence: valueMatches
        ? `Editable content contains "${text}".`
        : `Editable content is "${targetElement.textContent ?? ""}".`,
    };
  }

  logFailedElementLookup(selector, label);

  return {
    actionType: "type",
    label,
    success: false,
    message: `Could not find an input field for "${label}".`,
    evidence: `No input, textarea, or contenteditable match for "${label}".`,
  };
}

export function readVisiblePageText(maxChars: number): string {
  const pageText = document.body?.innerText ?? "";
  return pageText.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

export function actionResultIndicatesNavigation(
  actionResult: VerifiedActionResult
): boolean {
  return (
    actionResult.actionType === "click" &&
    actionResult.success &&
    (actionResult.evidence?.includes("URL changed") ?? false)
  );
}
