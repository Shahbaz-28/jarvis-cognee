export interface FriendMemoryEntry {
  question: string;
  answer: string;
  pageUrl: string;
  pageTitle: string;
  timestamp: number;
}

const FRIEND_MEMORY_STORAGE_KEY = "jarvis_vo_friend_memory";
const MAX_FRIEND_MEMORY_ENTRIES = 100;

export async function loadFriendMemoryEntries(): Promise<FriendMemoryEntry[]> {
  const storedValue = await chrome.storage.local.get(FRIEND_MEMORY_STORAGE_KEY);
  const storedEntries = storedValue[FRIEND_MEMORY_STORAGE_KEY];

  if (!Array.isArray(storedEntries)) {
    return [];
  }

  return storedEntries as FriendMemoryEntry[];
}

export async function appendFriendMemoryEntry(
  entry: Omit<FriendMemoryEntry, "timestamp"> & { timestamp?: number }
): Promise<void> {
  const existingEntries = await loadFriendMemoryEntries();

  const newEntry: FriendMemoryEntry = {
    question: entry.question,
    answer: entry.answer,
    pageUrl: entry.pageUrl,
    pageTitle: entry.pageTitle,
    timestamp: entry.timestamp ?? Date.now(),
  };

  const updatedEntries = [newEntry, ...existingEntries].slice(
    0,
    MAX_FRIEND_MEMORY_ENTRIES
  );

  await chrome.storage.local.set({
    [FRIEND_MEMORY_STORAGE_KEY]: updatedEntries,
  });
}

function formatFriendMemoryTimestamp(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return "unknown time";
  }
}

function entryMatchesQuestionKeywords(
  entry: FriendMemoryEntry,
  questionKeywords: string[]
): boolean {
  if (questionKeywords.length === 0) {
    return true;
  }

  const searchableText = [
    entry.question,
    entry.answer,
    entry.pageUrl,
    entry.pageTitle,
  ]
    .join(" ")
    .toLowerCase();

  return questionKeywords.some((keyword) => searchableText.includes(keyword));
}

function extractQuestionKeywords(userQuestion: string): string[] {
  return userQuestion
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4)
    .filter(
      (word) =>
        ![
          "what",
          "were",
          "was",
          "have",
          "that",
          "this",
          "with",
          "about",
          "from",
          "when",
          "where",
          "page",
          "tell",
          "speaking",
          "doing",
          "earlier",
          "before",
          "visit",
          "visited",
        ].includes(word)
    );
}

export function buildFriendMemoryContext(
  friendMemoryEntries: FriendMemoryEntry[],
  userQuestion?: string
): string {
  if (friendMemoryEntries.length === 0) {
    return "";
  }

  const questionKeywords = userQuestion
    ? extractQuestionKeywords(userQuestion)
    : [];

  const keywordMatchedEntries = friendMemoryEntries.filter((entry) =>
    entryMatchesQuestionKeywords(entry, questionKeywords)
  );

  const entriesToInclude =
    keywordMatchedEntries.length > 0
      ? keywordMatchedEntries.slice(0, 25)
      : friendMemoryEntries.slice(0, 20);

  const memoryLines = entriesToInclude.map((entry) => {
    const recordedAtLabel = formatFriendMemoryTimestamp(entry.timestamp);
    return `[${recordedAtLabel}] ${entry.pageTitle} (${entry.pageUrl})\nYou asked: ${entry.question}\nYou answered: ${entry.answer}`;
  });

  return `What you remember from past conversations with this user (survives closing the sidebar):\n${memoryLines.join("\n\n")}`;
}
