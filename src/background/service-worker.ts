chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener(
  (
    message: { type?: string },
    _sender,
    sendResponse: (response: { ok: boolean; tabTitle?: string; tabUrl?: string }) => void
  ) => {
    if (message.type !== "GET_ACTIVE_TAB") {
      return false;
    }

    void (async () => {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });

      sendResponse({
        ok: true,
        tabTitle: activeTab?.title ?? "Unknown page",
        tabUrl: activeTab?.url ?? "",
      });
    })();

    return true;
  }
);
