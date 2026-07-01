export interface HistoryEntry {
  question: string;
  answer: string;
  timestamp: number;
}

const HISTORY_STORAGE_KEY = "jarvis_vo_history";
const MAX_HISTORY_ENTRIES = 5;

export async function loadConversationHistory(): Promise<HistoryEntry[]> {
  const storedValue = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
  const storedHistory = storedValue[HISTORY_STORAGE_KEY] as
    | HistoryEntry[]
    | undefined;

  if (!Array.isArray(storedHistory)) {
    return [];
  }

  return storedHistory.slice(0, MAX_HISTORY_ENTRIES);
}

export async function addConversationEntry(
  question: string,
  answer: string
): Promise<HistoryEntry[]> {
  const existingHistory = await loadConversationHistory();
  const newEntry: HistoryEntry = {
    question,
    answer,
    timestamp: Date.now(),
  };

  const updatedHistory = [newEntry, ...existingHistory].slice(
    0,
    MAX_HISTORY_ENTRIES
  );

  await chrome.storage.local.set({
    [HISTORY_STORAGE_KEY]: updatedHistory,
  });

  return updatedHistory;
}

export async function clearConversationHistory(): Promise<void> {
  await chrome.storage.local.remove(HISTORY_STORAGE_KEY);
}
