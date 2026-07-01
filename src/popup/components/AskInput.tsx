import VoiceButton from "./VoiceButton";

interface AskInputProps {
  question: string;
  isLoading: boolean;
  isListening: boolean;
  isVoiceSupported: boolean;
  liveConversationEnabled: boolean;
  voiceStatusMessage: string | null;
  orchestratorPhase: "thinking" | "acting" | null;
  onQuestionChange: (value: string) => void;
  onSubmit: () => void;
  onVoiceToggle: () => void;
}

function SparkleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12 2.5 13.7 8l5.5 1.7-5.5 1.7L12 17l-1.7-5.6L4.8 9.7 10.3 8 12 2.5ZM5 15l.8 2.5L8.3 18l-2.5.8L5 21.2 4.2 18.8 1.7 18l2.5-.8L5 15Zm14-1 .7 2.2 2.3.8-2.3.8-.7 2.2-.7-2.2-2.3-.8 2.3-.8.7-2.2Z" />
    </svg>
  );
}

export default function AskInput({
  question,
  isLoading,
  isListening,
  isVoiceSupported,
  liveConversationEnabled,
  voiceStatusMessage,
  orchestratorPhase,
  onQuestionChange,
  onSubmit,
  onVoiceToggle,
}: AskInputProps) {
  const isAskDisabled =
    isLoading ||
    isListening ||
    question.trim().length === 0 ||
    liveConversationEnabled;

  function handleTextareaKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (event.key === "Enter" && !event.shiftKey && !liveConversationEnabled) {
      event.preventDefault();
      if (!isAskDisabled) {
        onSubmit();
      }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label
        className="px-1 text-sm font-semibold text-slate-700"
        htmlFor="question"
      >
        {liveConversationEnabled
          ? "Speaking to Jarvis VO"
          : "Ask about this page"}
      </label>

      <div className="atb-card flex items-start gap-2 p-2 focus-within:border-indigo-300">
        <textarea
          id="question"
          value={question}
          disabled={isLoading || isListening}
          onChange={(event) => onQuestionChange(event.target.value)}
          onKeyDown={handleTextareaKeyDown}
          placeholder={
            liveConversationEnabled
              ? "Your words appear here as you speak..."
              : isListening
                ? "Listening..."
                : "What is this page about?"
          }
          className="min-h-18 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
        />

        {!liveConversationEnabled ? (
          <VoiceButton
            isListening={isListening}
            isLoading={isLoading}
            isSupported={isVoiceSupported}
            onToggle={onVoiceToggle}
          />
        ) : null}
      </div>

      {isListening && !liveConversationEnabled ? (
        <p className="px-1 text-xs text-rose-500">
          Listening... speak your question.
        </p>
      ) : null}

      {voiceStatusMessage ? (
        <p className="px-1 text-xs text-amber-600">{voiceStatusMessage}</p>
      ) : null}

      {!liveConversationEnabled ? (
        <button
          type="button"
          disabled={isAskDisabled}
          onClick={onSubmit}
          className="atb-gradient flex cursor-pointer items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SparkleIcon />
          {isLoading
            ? orchestratorPhase === "acting"
              ? "Acting..."
              : "Thinking..."
            : "Ask"}
        </button>
      ) : null}
    </div>
  );
}
