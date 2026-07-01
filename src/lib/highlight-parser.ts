export interface ParsedHighlight {
  selector: string;
  label: string;
}

export type PageActionType = "click" | "scroll";

export interface ParsedPageAction {
  actionType: PageActionType;
  selector: string;
  label: string;
}

export interface ParsedAnswer {
  cleanAnswer: string;
  highlights: ParsedHighlight[];
  actions: ParsedPageAction[];
}

const HIGHLIGHT_TAG_PATTERN = /\[HIGHLIGHT:[^\]]+\]/g;
const CLICK_TAG_PATTERN = /\[CLICK:[^\]]+\]/g;
const SCROLL_TAG_PATTERN = /\[SCROLL:[^\]]+\]/g;

function parseTaggedTarget(
  tag: string,
  prefix: string
): { selector: string; label: string } | null {
  const inner = tag.replace(new RegExp(`^\\[${prefix}:\\s*`), "").replace(/\]\s*$/, "");
  if (!inner || inner.toLowerCase() === "none") {
    return null;
  }

  const labelSeparatorIndex = inner.lastIndexOf(":");
  if (labelSeparatorIndex === -1) {
    return null;
  }

  const selector = inner.slice(0, labelSeparatorIndex).trim();
  const label = inner.slice(labelSeparatorIndex + 1).trim();

  if (!selector || !label) {
    return null;
  }

  return { selector, label };
}

function parseSingleHighlightTag(tag: string): ParsedHighlight | null {
  return parseTaggedTarget(tag, "HIGHLIGHT");
}

function parseSingleClickTag(tag: string): ParsedPageAction | null {
  const parsedTarget = parseTaggedTarget(tag, "CLICK");
  if (!parsedTarget) {
    return null;
  }

  return {
    actionType: "click",
    selector: parsedTarget.selector,
    label: parsedTarget.label,
  };
}

function parseSingleScrollTag(tag: string): ParsedPageAction | null {
  const parsedTarget = parseTaggedTarget(tag, "SCROLL");
  if (!parsedTarget) {
    return null;
  }

  return {
    actionType: "scroll",
    selector: parsedTarget.selector,
    label: parsedTarget.label,
  };
}

function stripTagsFromAnswer(answer: string, tagPatterns: RegExp[]): string {
  let cleanAnswer = answer;

  for (const tagPattern of tagPatterns) {
    cleanAnswer = cleanAnswer.replace(tagPattern, "");
  }

  return cleanAnswer.replace(/\s{2,}/g, " ").trim();
}

export function parseHighlightsFromAnswer(answer: string): ParsedAnswer {
  const highlights: ParsedHighlight[] = [];
  const actions: ParsedPageAction[] = [];

  const matchedHighlightTags = answer.match(HIGHLIGHT_TAG_PATTERN) ?? [];
  for (const matchedTag of matchedHighlightTags) {
    const parsedHighlight = parseSingleHighlightTag(matchedTag);
    if (parsedHighlight) {
      highlights.push(parsedHighlight);
    }
  }

  const matchedClickTags = answer.match(CLICK_TAG_PATTERN) ?? [];
  for (const matchedTag of matchedClickTags) {
    const parsedAction = parseSingleClickTag(matchedTag);
    if (parsedAction) {
      actions.push(parsedAction);
    }
  }

  const matchedScrollTags = answer.match(SCROLL_TAG_PATTERN) ?? [];
  for (const matchedTag of matchedScrollTags) {
    const parsedAction = parseSingleScrollTag(matchedTag);
    if (parsedAction) {
      actions.push(parsedAction);
    }
  }

  return {
    cleanAnswer: stripTagsFromAnswer(answer, [
      HIGHLIGHT_TAG_PATTERN,
      CLICK_TAG_PATTERN,
      SCROLL_TAG_PATTERN,
    ]),
    highlights: highlights.slice(0, 3),
    actions: actions.slice(0, 3),
  };
}
