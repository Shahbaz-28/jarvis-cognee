const AUTO_READ_ALOUD_STORAGE_KEY = "jarvis_vo_auto_read_aloud";

export async function loadAutoReadAloudEnabled(): Promise<boolean> {
  const storedValue = await chrome.storage.local.get(AUTO_READ_ALOUD_STORAGE_KEY);
  const storedPreference = storedValue[AUTO_READ_ALOUD_STORAGE_KEY];

  // Default on — matches tutor-style "answer speaks back" behavior.
  if (storedPreference === undefined) {
    return true;
  }

  return storedPreference === true;
}

export async function saveAutoReadAloudEnabled(
  autoReadAloudEnabled: boolean
): Promise<void> {
  await chrome.storage.local.set({
    [AUTO_READ_ALOUD_STORAGE_KEY]: autoReadAloudEnabled,
  });
}
