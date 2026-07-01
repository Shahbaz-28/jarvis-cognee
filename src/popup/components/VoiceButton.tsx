interface VoiceButtonProps {
  isListening: boolean;
  isLoading: boolean;
  isSupported: boolean;
  onToggle: () => void;
}

export default function VoiceButton({
  isListening,
  isLoading,
  isSupported,
  onToggle,
}: VoiceButtonProps) {
  const isDisabled = isLoading || !isSupported;

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={onToggle}
      title={
        isSupported
          ? isListening
            ? "Stop listening"
            : "Ask with your voice"
          : "Voice requires Google Chrome"
      }
      className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-50 ${
        isListening
          ? "animate-pulse border-rose-300 bg-rose-50 text-rose-500"
          : "border-slate-200 bg-white text-slate-500 hover:border-indigo-300 hover:text-indigo-500"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-4.5 w-4.5"
        aria-hidden="true"
      >
        <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
      </svg>
    </button>
  );
}
