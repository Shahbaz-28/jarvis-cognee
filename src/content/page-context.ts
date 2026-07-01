export const MAX_DOM_SNAPSHOT_CHARS = 10_000;

export interface PageDomSnapshot {
  url: string;
  title: string;
  snapshotText: string;
  snapshotHash: string;
}

interface DomListItem {
  label: string;
  selectorHint: string;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function simpleTextHash(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(16);
}

function truncateSnapshotText(snapshotText: string): string {
  if (snapshotText.length <= MAX_DOM_SNAPSHOT_CHARS) {
    return snapshotText;
  }

  return `${snapshotText.slice(0, MAX_DOM_SNAPSHOT_CHARS)}\n...[truncated]`;
}

function buildSelectorHint(element: Element): string {
  if (element.id) {
    return `#${element.id}`;
  }

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    return `[aria-label="${ariaLabel.slice(0, 40)}"]`;
  }

  const elementName = element.tagName.toLowerCase();
  const className = element.className;
  if (typeof className === "string" && className.trim()) {
    const firstClassName = className.trim().split(/\s+/)[0];
    return `${elementName}.${firstClassName}`;
  }

  return elementName;
}

function extractVisibleLabel(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    return normalizeWhitespace(ariaLabel);
  }

  const placeholder = element.getAttribute("placeholder");
  if (placeholder) {
    return normalizeWhitespace(placeholder);
  }

  const textContent = normalizeWhitespace(element.textContent ?? "");
  return textContent.slice(0, 80);
}

function extractHeadings(): string[] {
  const headingElements = document.querySelectorAll("h1, h2, h3, h4");
  const headings: string[] = [];

  for (const headingElement of headingElements) {
    const headingText = normalizeWhitespace(headingElement.textContent ?? "");
    if (!headingText) {
      continue;
    }

    const tagName = headingElement.tagName.toLowerCase();
    headings.push(`${tagName}: ${headingText}`);
    if (headings.length >= 20) {
      break;
    }
  }

  return headings;
}

function extractInteractiveElements(): DomListItem[] {
  const interactiveElements = document.querySelectorAll(
    "button, a[href], input, textarea, select, [role='button'], [role='link'], [role='menuitem'], [role='tab']"
  );
  const items: DomListItem[] = [];
  const seenLabels = new Set<string>();

  for (const interactiveElement of interactiveElements) {
    const label = extractVisibleLabel(interactiveElement);
    if (!label || seenLabels.has(label)) {
      continue;
    }

    seenLabels.add(label);
    items.push({
      label,
      selectorHint: buildSelectorHint(interactiveElement),
    });

    if (items.length >= 40) {
      break;
    }
  }

  return items;
}

function extractFormFields(): DomListItem[] {
  const formFieldElements = document.querySelectorAll(
    "input, textarea, select, [contenteditable='true']"
  );
  const fields: DomListItem[] = [];
  const seenLabels = new Set<string>();

  for (const formFieldElement of formFieldElements) {
    const label = extractVisibleLabel(formFieldElement);
    const fieldType =
      formFieldElement instanceof HTMLInputElement
        ? formFieldElement.type || "input"
        : formFieldElement.tagName.toLowerCase();

    const fieldLabel = label ? `${label} (${fieldType})` : `(${fieldType})`;
    if (seenLabels.has(fieldLabel)) {
      continue;
    }

    seenLabels.add(fieldLabel);
    fields.push({
      label: fieldLabel,
      selectorHint: buildSelectorHint(formFieldElement),
    });

    if (fields.length >= 25) {
      break;
    }
  }

  return fields;
}

function formatDomListSection(sectionTitle: string, items: DomListItem[]): string {
  if (items.length === 0) {
    return `${sectionTitle}\n(none found)`;
  }

  const formattedItems = items.map(
    (item) => `- ${item.label} | ${item.selectorHint}`
  );

  return `${sectionTitle}\n${formattedItems.join("\n")}`;
}

export function extractPageDomSnapshot(): PageDomSnapshot {
  const headings = extractHeadings();
  const interactiveItems = extractInteractiveElements();
  const formFields = extractFormFields();

  const snapshotLines = [
    `URL: ${window.location.href}`,
    `Title: ${document.title}`,
    "",
    "## Headings",
    headings.length > 0 ? headings.join("\n") : "(none found)",
    "",
    formatDomListSection("## Buttons & Links", interactiveItems),
    "",
    formatDomListSection("## Form Fields", formFields),
  ];

  const snapshotText = truncateSnapshotText(snapshotLines.join("\n"));

  return {
    url: window.location.href,
    title: document.title,
    snapshotText,
    snapshotHash: simpleTextHash(snapshotText),
  };
}

export function buildDomDiffMessage(
  previousSnapshotText: string,
  currentSnapshot: PageDomSnapshot
): string {
  if (previousSnapshotText === currentSnapshot.snapshotText) {
    return "Page structure unchanged since the last snapshot.";
  }

  const previousHash = simpleTextHash(previousSnapshotText);
  if (previousHash === currentSnapshot.snapshotHash) {
    return "Page structure unchanged since the last snapshot.";
  }

  return [
    "Page structure changed since the last snapshot.",
    "",
    "Current page snapshot:",
    currentSnapshot.snapshotText,
  ].join("\n");
}
