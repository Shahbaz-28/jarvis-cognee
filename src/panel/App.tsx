import { useEffect, useState } from "react";

interface ActiveTabInfo {
  tabTitle: string;
  tabUrl: string;
}

export default function App() {
  const [activeTabInfo, setActiveTabInfo] = useState<ActiveTabInfo | null>(null);

  useEffect(() => {
    void chrome.runtime
      .sendMessage({ type: "GET_ACTIVE_TAB" })
      .then((response: ActiveTabInfo & { ok?: boolean }) => {
        if (response?.ok) {
          setActiveTabInfo({
            tabTitle: response.tabTitle,
            tabUrl: response.tabUrl,
          });
        }
      })
      .catch(() => {
        // Side panel opened before service worker is ready.
      });
  }, []);

  return (
    <main className="panel-root">
      <header className="panel-header">
        <p className="panel-eyebrow">Hackathon build · Day 2</p>
        <h1 className="panel-title">Jarvis VO</h1>
        <p className="panel-subtitle">
          A friend in your tab. Remembers what you do. Helps you continue.
        </p>
      </header>

      <section className="panel-card">
        <h2 className="panel-card-title">Current tab</h2>
        <p className="panel-tab-title">
          {activeTabInfo?.tabTitle ?? "Open a tab to get started"}
        </p>
        {activeTabInfo?.tabUrl ? (
          <p className="panel-tab-url">{activeTabInfo.tabUrl}</p>
        ) : null}
      </section>

      <section className="panel-card panel-card-muted">
        <h2 className="panel-card-title">Coming next</h2>
        <ul className="panel-checklist">
          <li>Cognee remember / recall</li>
          <li>What was I doing?</li>
          <li>Page actions</li>
          <li>Task done → forget</li>
        </ul>
      </section>
    </main>
  );
}
