interface AnswerPanelProps {
  answer: string | null;
  error: string | null;
  isLoading: boolean;
  orchestratorPhase: "thinking" | "acting" | null;
  highlightsApplied: number;
  actionResults: Array<{
    actionType: "click" | "scroll" | "highlight" | "type" | "read" | "capture";
    label: string;
    success: boolean;
    message: string;
  }>;
  isSpeaking: boolean;
  readAloudStatusMessage: string | null;
  onClearHighlights: () => void;
  onToggleReadAloud: () => void;
  onRetry?: () => void;
}

function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M5 9v6h4l5 5V4L9 9H5Zm11.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Z" />
    </svg>
  );
}

export default function AnswerPanel({
  answer,
  error,
  isLoading,
  orchestratorPhase,
  highlightsApplied,
  actionResults,
  isSpeaking,
  readAloudStatusMessage,
  onClearHighlights,
  onToggleReadAloud,
  onRetry,
}: AnswerPanelProps) {
  if (isLoading) {
    const loadingLabel =
      orchestratorPhase === "acting"
        ? "Acting on the page..."
        : "Thinking and planning...";

    return (
      <div className="atb-card px-4 py-4">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500" />
          {loadingLabel}
        </div>
        <div className="mt-3 space-y-2">
          <div className="h-2 animate-pulse rounded bg-slate-100" />
          <div className="h-2 w-5/6 animate-pulse rounded bg-slate-100" />
          <div className="h-2 w-2/3 animate-pulse rounded bg-slate-100" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
        <p className="text-sm text-rose-700">{error}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 cursor-pointer rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-100"
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  if (!answer) {
    return (
      <div className="atb-card flex items-start gap-3 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
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
            <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2h6c0-.8.4-1.5 1-2A7 7 0 0 0 12 2Z" />
          </svg>
        </span>
        <p className="text-xs leading-relaxed text-slate-500">
          Ask a question and Claude will answer using a screenshot. Say things like
          "click Sign up" or "scroll down" to interact with the page.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="atb-card px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Answer
          </p>
          <button
            type="button"
            onClick={onToggleReadAloud}
            aria-pressed={isSpeaking}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold transition ${
              isSpeaking
                ? "border-indigo-200 bg-indigo-50 text-indigo-600"
                : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-600"
            }`}
          >
            {isSpeaking ? (
              <>
                <span className="inline-block h-2 w-2 rounded-sm bg-indigo-500" />
                Stop
              </>
            ) : (
              <>
                <SpeakerIcon />
                Read aloud
              </>
            )}
          </button>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
          {answer}
        </p>
        {readAloudStatusMessage ? (
          <p className="mt-2 text-xs text-amber-600">{readAloudStatusMessage}</p>
        ) : null}
      </div>

      {actionResults.length > 0 ? (
        <div className="flex flex-col gap-2">
          {actionResults.map((actionResult) => (
            <div
              key={`${actionResult.actionType}-${actionResult.label}-${actionResult.message}`}
              className={`rounded-2xl border px-3 py-2 ${
                actionResult.success
                  ? "border-emerald-200 bg-emerald-50/80"
                  : "border-amber-200 bg-amber-50/80"
              }`}
            >
              <p
                className={`text-xs font-medium ${
                  actionResult.success ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {actionResult.message}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {highlightsApplied > 0 ? (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-3 py-2">
          <p className="text-xs font-medium text-indigo-700">
            Highlighted {highlightsApplied} element
            {highlightsApplied === 1 ? "" : "s"} on the page
          </p>
          <button
            type="button"
            onClick={onClearHighlights}
            className="cursor-pointer rounded-lg border border-indigo-200 bg-white px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-100"
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
