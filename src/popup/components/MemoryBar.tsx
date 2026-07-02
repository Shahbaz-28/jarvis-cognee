interface MemoryBarProps {
  memoryBannerText: string | null;
  isLoadingMemoryBanner: boolean;
  memoryStatusMessage: string | null;
  taskLabel: string;
  isMemoryActionPending: boolean;
  onTaskLabelChange: (taskLabel: string) => void;
  onSaveTaskLabel: () => void;
  onRecallWhatWasIDoing: () => void;
  onMarkTaskDone: () => void;
}

function truncateMemoryBannerText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trimEnd()}…`;
}

export default function MemoryBar({
  memoryBannerText,
  isLoadingMemoryBanner,
  memoryStatusMessage,
  taskLabel,
  isMemoryActionPending,
  onTaskLabelChange,
  onSaveTaskLabel,
  onRecallWhatWasIDoing,
  onMarkTaskDone,
}: MemoryBarProps) {
  const isErrorStatusMessage =
    memoryStatusMessage !== null &&
    /timed out|failed|error|denied|invalid|not respond/i.test(
      memoryStatusMessage
    );

  const hasMemoryBanner =
    !isLoadingMemoryBanner &&
    memoryBannerText !== null &&
    memoryBannerText.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="atb-card px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">
            Memory
          </p>
          {isLoadingMemoryBanner ? (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500" />
          ) : null}
        </div>

        {isLoadingMemoryBanner ? (
          <p className="text-xs text-slate-500">Checking what you were doing…</p>
        ) : hasMemoryBanner ? (
          <p className="text-xs leading-relaxed text-slate-600">
            <span className="font-medium text-slate-700">Last time: </span>
            {truncateMemoryBannerText(memoryBannerText, 220)}
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            No prior task found yet — ask something and Jarvis will remember.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isMemoryActionPending}
            onClick={onRecallWhatWasIDoing}
            className="cursor-pointer rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            What was I doing?
          </button>
          <button
            type="button"
            disabled={isMemoryActionPending}
            onClick={onMarkTaskDone}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Mark task done
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={taskLabel}
            onChange={(event) => {
              onTaskLabelChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSaveTaskLabel();
              }
            }}
            placeholder="Task label (optional)"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
          />
          <button
            type="button"
            onClick={onSaveTaskLabel}
            className="cursor-pointer shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-600"
          >
            Save
          </button>
        </div>

        {memoryStatusMessage ? (
          <p
            className={`mt-2 text-xs font-medium ${
              isErrorStatusMessage ? "text-amber-700" : "text-emerald-600"
            }`}
          >
            {memoryStatusMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
