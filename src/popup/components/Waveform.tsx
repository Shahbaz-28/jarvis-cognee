interface WaveformProps {
  isActive: boolean;
}

export default function Waveform({ isActive }: WaveformProps) {
  return (
    <span className="atb-waveform" data-active={isActive} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
