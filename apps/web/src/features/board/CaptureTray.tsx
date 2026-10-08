import { useState, useRef, useEffect } from 'react';
import { Check, Upload, X } from 'lucide-react';
import { SecondaryButton } from '@moodboard/ui';
import { canDismissCapture, type CaptureQueue, type CaptureSnapshot } from './capture';

const stages = {
  queued: 'Queued',
  uploading: 'Uploading…',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Needs attention',
};

export function CaptureTray({
  queue,
  entries,
  paused,
  unfinished,
  editable,
}: CaptureSnapshot & { queue: CaptureQueue; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const previousIds = useRef(new Set<string>());
  useEffect(() => {
    if (entries.some((entry) => !previousIds.current.has(entry.id))) {
      setOpen(true);
    }
    previousIds.current = new Set(entries.map((entry) => entry.id));
  }, [entries]);
  const saved = entries.filter((entry) => entry.stage === 'saved').length;
  const failed = entries.filter((entry) => entry.stage === 'failed').length;
  const summary = `${saved} saved${unfinished ? ` · ${unfinished} unfinished` : ''}${failed ? ` · ${failed} need attention` : ''}`;
  if (!entries.length) {
    return null;
  }
  function close() {
    setOpen(false);
    toggle.current?.focus();
  }
  return (
    <section aria-label="Capture progress" className="capture-tray">
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <button
          ref={toggle}
          type="button"
          aria-expanded={open}
          aria-controls="capture-entries"
          onClick={() => setOpen(!open)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm"
        >
          {unfinished ? (
            <Upload size={17} className="shrink-0" />
          ) : (
            <Check size={17} className="shrink-0" />
          )}
          <span className="min-w-0">{summary}</span>
        </button>
        {open && (
          <button
            type="button"
            aria-label="Close capture progress"
            onClick={close}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-cream"
          >
            <X size={18} />
          </button>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {summary}
        {paused ? '. Saving paused. Check your access.' : ''}
      </p>
      {open && (
        <div
          id="capture-entries"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
        >
          {paused && (
            <div className="border-t border-line px-4 py-3 text-sm">
              <p>Saving paused. Check your board access before continuing.</p>
              <SecondaryButton className="mt-2" disabled={!editable} onClick={() => queue.resume()}>
                Resume saving
              </SecondaryButton>
            </div>
          )}
          <ul className="capture-entries border-t border-line">
            {entries.map((entry) => (
              <li key={entry.id} className="border-b border-line px-4 py-3 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={entry.label}>
                      {entry.label}
                    </p>
                    <p className="mt-1 break-words text-xs text-muted">
                      {stages[entry.stage]} · {entry.sectionName}
                    </p>
                  </div>
                  {canDismissCapture(entry.stage, paused) && (
                    <button
                      type="button"
                      aria-label={`Dismiss ${entry.label.slice(0, 80)}`}
                      onClick={() => queue.dismiss(entry.id)}
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted hover:bg-cream"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                {entry.error && (
                  <p
                    className={`mt-2 break-words text-sm ${entry.stage === 'failed' ? 'text-danger' : 'text-muted'}`}
                  >
                    {entry.error}
                  </p>
                )}
                {entry.stage === 'failed' && entry.retryable && (
                  <SecondaryButton
                    className="mt-2"
                    disabled={!editable}
                    onClick={() => queue.retry(entry.id)}
                  >
                    Retry same save
                  </SecondaryButton>
                )}
              </li>
            ))}
          </ul>
          {saved > 0 && (
            <div className="px-4 py-2">
              <button
                type="button"
                className="min-h-11 text-sm text-muted underline"
                onClick={() => queue.clearSaved()}
              >
                Clear saved entries
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
