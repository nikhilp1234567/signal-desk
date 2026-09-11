export function SignalMark({ compact = false }: { compact?: boolean }) {
  return <span className={`signal-mark${compact ? " signal-mark--compact" : ""}`} aria-hidden="true">
    <i /><i /><i /><i /><b />
  </span>;
}
