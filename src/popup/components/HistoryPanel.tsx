import { useState } from "react";
import type { HistoryEntry } from "../../lib/history";

interface HistoryPanelProps {
  historyEntries: HistoryEntry[];
  onSelectEntry: (entry: HistoryEntry) => void;
  onNewConversation: () => void;
}

const DEFAULT_VISIBLE_HISTORY_COUNT = 3;

function ChatBubbleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export default function HistoryPanel({
  historyEntries,
  onSelectEntry,
  onNewConversation,
}: HistoryPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (historyEntries.length === 0) {
    return (
      <button
        type="button"
        onClick={onNewConversation}
        className="atb-card w-full cursor-pointer px-4 py-2.5 text-xs font-medium text-slate-600 transition hover:border-indigo-200 hover:text-indigo-600"
      >
        New conversation
      </button>
    );
  }

  const visibleEntries = isExpanded
    ? historyEntries
    : historyEntries.slice(0, DEFAULT_VISIBLE_HISTORY_COUNT);
  const hasMoreEntries = historyEntries.length > DEFAULT_VISIBLE_HISTORY_COUNT;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Recent
        </p>
        <button
          type="button"
          onClick={onNewConversation}
          className="cursor-pointer text-xs font-semibold text-indigo-600 hover:text-indigo-500"
        >
          New conversation
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {visibleEntries.map((entry) => (
          <button
            key={entry.timestamp}
            type="button"
            onClick={() => onSelectEntry(entry)}
            className="atb-card flex cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition hover:border-indigo-200"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
              <ChatBubbleIcon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-slate-800">
                {entry.question}
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-400">
                {entry.answer}
              </span>
            </span>
            <span className="shrink-0 text-slate-300">
              <ClockIcon />
            </span>
          </button>
        ))}
      </div>

      {hasMoreEntries ? (
        <button
          type="button"
          onClick={() => setIsExpanded((previous) => !previous)}
          className="mx-auto flex cursor-pointer items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700"
        >
          {isExpanded ? "Show less" : "View all"}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-3.5 w-3.5 transition-transform ${
              isExpanded ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
