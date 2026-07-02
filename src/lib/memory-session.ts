const MEMORY_SESSION_STORAGE_KEY = "jarvis_vo_memory_session_id";
const MEMORY_TASK_LABEL_STORAGE_KEY = "jarvis_vo_memory_task_label";

/** One lifetime Cognee memory id — never reset so Jarvis remembers across days. */
export async function getMemorySessionId(): Promise<string | null> {
  const storedValue = await chrome.storage.local.get(MEMORY_SESSION_STORAGE_KEY);
  const existingSessionId = storedValue[MEMORY_SESSION_STORAGE_KEY];

  if (typeof existingSessionId === "string" && existingSessionId.length > 0) {
    return existingSessionId;
  }

  return null;
}

export async function getOrCreateMemorySessionId(): Promise<string> {
  const existingSessionId = await getMemorySessionId();

  if (existingSessionId) {
    return existingSessionId;
  }

  return resetMemorySessionId();
}

export async function resetMemorySessionId(): Promise<string> {
  const newSessionId = `jarvis_${crypto.randomUUID()}`;
  await chrome.storage.local.set({
    [MEMORY_SESSION_STORAGE_KEY]: newSessionId,
  });
  return newSessionId;
}

export async function loadMemoryTaskLabel(): Promise<string | null> {
  const storedValue = await chrome.storage.local.get(MEMORY_TASK_LABEL_STORAGE_KEY);
  const taskLabel = storedValue[MEMORY_TASK_LABEL_STORAGE_KEY];

  if (typeof taskLabel === "string" && taskLabel.trim().length > 0) {
    return taskLabel.trim();
  }

  return null;
}

export async function saveMemoryTaskLabel(taskLabel: string): Promise<void> {
  const trimmedTaskLabel = taskLabel.trim();

  if (!trimmedTaskLabel) {
    await chrome.storage.local.remove(MEMORY_TASK_LABEL_STORAGE_KEY);
    return;
  }

  await chrome.storage.local.set({
    [MEMORY_TASK_LABEL_STORAGE_KEY]: trimmedTaskLabel,
  });
}

export async function clearMemoryTaskLabel(): Promise<void> {
  await chrome.storage.local.remove(MEMORY_TASK_LABEL_STORAGE_KEY);
}
