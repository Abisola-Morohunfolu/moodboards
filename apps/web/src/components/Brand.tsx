export function Brand({ loading = false }: { loading?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
      <span
        aria-hidden="true"
        className={`inline-block text-2xl leading-none text-accent ${loading ? 'brand-mark-loading' : ''}`}
      >
        ✳
      </span>
      moodboard
    </span>
  );
}

export function Pending() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading Moodboard"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-paper px-5"
    >
      <Brand loading />
      <p className="text-sm text-muted">Loading…</p>
    </div>
  );
}
