import { useEffect, useRef, useState } from 'react';
import { Dialog, EmptyState, PrimaryButton, SecondaryButton, Skeleton } from '@moodboard/ui';
import { RotateCcw, X } from 'lucide-react';
import type { ItemResponse } from '@moodboard/contracts';
import { api, ApiError } from '../../lib/api';
import { q } from '../../lib/hooks';
import { ItemCard } from './ItemCard';

export function TrashPanel({
  boardId,
  close,
  refresh,
  reveal,
}: {
  boardId: string;
  close: () => void;
  refresh: () => Promise<void>;
  reveal: (id: string) => void;
}) {
  const trash = q.trash(boardId);
  const [pending, setPending] = useState(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [blocked, setBlocked] = useState(false);
  const [restored, setRestored] = useState<ItemResponse | null>(null);
  const restoredNotice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (restored) {
      restoredNotice.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [restored]);
  const rows = trash.data?.pages.flatMap((page) => page.items) ?? [];
  const unique = rows.filter(
    (item, index) => rows.findIndex((other) => other.id === item.id) === index,
  );
  async function restore(item: ItemResponse) {
    setPending((old) => new Set(old).add(item.id));
    setErrors((old) => ({ ...old, [item.id]: '' }));
    try {
      const saved = await api.restoreItem(item.id, item.deletedAt!);
      setRestored(saved);
      await refresh();
    } catch (cause) {
      setErrors((old) => ({
        ...old,
        [item.id]: cause instanceof Error ? cause.message : 'Could not restore. Try again.',
      }));
      if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
        setBlocked(true);
        void refresh();
      } else if (cause instanceof ApiError && cause.status === 409) {
        void trash.refetch();
      }
    } finally {
      setPending((old) => {
        const next = new Set(old);
        next.delete(item.id);
        return next;
      });
    }
  }
  return (
    <Dialog label="Board trash" onClose={close} className="mobile-sheet trash-panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Trash</h2>
        <button
          aria-label="Close trash"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-cream"
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>
      <p className="mt-2 text-sm text-muted">
        Deleted ideas stay here until you restore them. They do not expire.
      </p>
      {restored && (
        <div
          ref={restoredNotice}
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-cream p-3"
          role="status"
        >
          <span className="text-sm">Item restored to the board.</span>
          <SecondaryButton onClick={() => reveal(restored.id)}>View item</SecondaryButton>
        </div>
      )}
      {blocked && (
        <p className="mt-4 text-sm text-danger" role="alert">
          Your editing access changed. Reopen the board to check your access.
        </p>
      )}
      {trash.isPending ? (
        <div className="mt-5 space-y-3" role="status" aria-label="Loading trash">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : trash.isError ? (
        <EmptyState
          title="Couldn't open trash"
          detail="Check your connection and editing access, then try again."
          action={<SecondaryButton onClick={() => void trash.refetch()}>Try again</SecondaryButton>}
        />
      ) : unique.length ? (
        <>
          <div className="mt-5 grid items-start gap-4 sm:grid-cols-2">
            {unique.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                footer={
                  <div className="space-y-2">
                    <p className="text-xs text-muted">
                      Deleted {new Date(item.deletedAt!).toLocaleString()}
                    </p>
                    {errors[item.id] && (
                      <p className="text-sm text-danger" role="alert">
                        {errors[item.id]}
                      </p>
                    )}
                    <PrimaryButton
                      disabled={blocked || pending.has(item.id)}
                      onClick={() => void restore(item)}
                    >
                      <RotateCcw size={16} />
                      {pending.has(item.id) ? 'Restoring…' : 'Restore'}
                    </PrimaryButton>
                  </div>
                }
              />
            ))}
          </div>
          {trash.hasNextPage && (
            <div className="mt-5 flex justify-center">
              <SecondaryButton
                disabled={trash.isFetchingNextPage}
                onClick={() => void trash.fetchNextPage()}
              >
                {trash.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </SecondaryButton>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          title="Nothing in trash"
          detail="Items you move to trash will appear here. You can restore them whenever you need."
        />
      )}
    </Dialog>
  );
}
