interface ConversationModeBarProps {
  liveConversationEnabled: boolean;
  isListening: boolean;
  isLoading: boolean;
  isSpeaking: boolean;
  isVoiceSupported: boolean;
  orchestratorPhase: "thinking" | "acting" | null;
  onToggleLiveConversation: () => void;
}

function getLiveConversationStatusLabel(
  isListening: boolean,
  isLoading: boolean,
  isSpeaking: boolean,
  orchestratorPhase: "thinking" | "acting" | null
): string {
  if (isSpeaking) {
    return "Speaking...";
  }

  if (isLoading) {
    if (orchestratorPhase === "acting") {
      return "Acting...";
    }

    return "Thinking...";
  }

  if (isListening) {
    return "Listening...";
  }

  return "Ready — speak your question";
}

function getStatusDotClass(
  isListening: boolean,
  isLoading: boolean,
  isSpeaking: boolean
): string {
  if (isListening) {
    return "animate-pulse bg-rose-500";
  }
  if (isLoading) {
    return "animate-pulse bg-amber-500";
  }
  if (isSpeaking) {
    return "animate-pulse bg-indigo-500";
  }
  return "bg-slate-300";
}

export default function ConversationModeBar({
  liveConversationEnabled,
  isListening,
  isLoading,
  isSpeaking,
  isVoiceSupported,
  orchestratorPhase,
  onToggleLiveConversation,
}: ConversationModeBarProps) {
  if (!isVoiceSupported) {
    return (
      <p className="atb-card px-4 py-3 text-xs text-slate-500">
        Live conversation needs Chrome voice input.
      </p>
    );
  }

  const statusLabel = getLiveConversationStatusLabel(
    isListening,
    isLoading,
    isSpeaking,
    orchestratorPhase
  );

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggleLiveConversation}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition ${
          liveConversationEnabled
            ? "bg-rose-500 hover:bg-rose-600"
            : "atb-gradient"
        }`}
      >
        {liveConversationEnabled ? (
          <>
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-white" />
            End conversation
          </>
        ) : (
          <>
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm7 9a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-2.08A7 7 0 0 0 19 12Z" />
            </svg>
            Start conversation
          </>
        )}
      </button>

      {liveConversationEnabled ? (
        <div className="flex items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-3 py-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${getStatusDotClass(
              isListening,
              isLoading,
              isSpeaking
            )}`}
          />
          <p className="text-xs font-medium text-indigo-700">
            Live conversation · {statusLabel}
          </p>
        </div>
      ) : (
        <p className="px-1 text-xs leading-relaxed text-slate-500">
          Jarvis-style mode — speak, get an answer, speak again. No clicking Ask.
        </p>
      )}
    </div>
  );
}
