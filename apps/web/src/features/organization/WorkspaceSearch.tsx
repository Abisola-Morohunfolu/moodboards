import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { EmptyState, Field, SecondaryButton, Skeleton } from '@moodboard/ui';
import type { WorkspaceSearchQuery } from '@moodboard/contracts';
import { ArrowUpRight } from 'lucide-react';
import { q } from '../../lib/hooks';
import { ItemCard } from '../board/ItemCard';
import { BoardPreview } from '../board/BoardPreview';

export type GallerySearch = {
  workspace?: string;
  q?: string;
  boardId?: string;
  kind?: WorkspaceSearchQuery['kind'];
};
export function WorkspaceSearch({
  workspaceId,
  boards,
  value,
  change,
}: {
  workspaceId: string;
  boards: { id: string; title: string }[];
  value: GallerySearch;
  change: (patch: Partial<GallerySearch>) => void;
}) {
  const [draft, setDraft] = useState(value.q ?? '');
  const [debounced, setDebounced] = useState(value.q?.trim() ?? '');
  useEffect(() => setDraft(value.q ?? ''), [value.q]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value.q?.trim() ?? ''), 300);
    return () => window.clearTimeout(timer);
  }, [value.q]);
  const query = q.search(workspaceId, { q: debounced, boardId: value.boardId, kind: value.kind });
  const waiting = debounced !== (value.q?.trim() ?? '');
  const active = !!value.q?.trim();
  const results = query.data?.pages.flatMap((page) => page.results) ?? [];
  const unique = results.filter(
    (hit, index) =>
      results.findIndex(
        (other) =>
          other.type === hit.type &&
          (other.type === 'board' ? other.board.id : other.item.id) ===
            (hit.type === 'board' ? hit.board.id : hit.item.id),
      ) === index,
  );
  return (
    <section aria-label="Workspace search" className="mt-6">
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(140px,200px)_140px]">
        <Field
          label="Search this workspace"
          type="search"
          value={draft}
          maxLength={200}
          placeholder="Find boards, notes, links, and images"
          onChange={(event) => {
            setDraft(event.target.value);
            change({ q: event.target.value || undefined });
          }}
        />
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Board
          <select
            aria-label="Filter search by board"
            className="min-h-11 border border-line bg-surface px-3 font-normal"
            value={value.boardId ?? ''}
            disabled={!active}
            onChange={(event) => change({ boardId: event.target.value || undefined })}
          >
            <option value="">All boards</option>
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Type
          <select
            aria-label="Filter search by type"
            className="min-h-11 border border-line bg-surface px-3 font-normal"
            value={value.kind ?? ''}
            disabled={!active}
            onChange={(event) =>
              change({ kind: (event.target.value || undefined) as GallerySearch['kind'] })
            }
          >
            <option value="">All types</option>
            <option value="image">Images</option>
            <option value="link">Links</option>
            <option value="note">Notes</option>
          </select>
        </label>
      </div>
      {active && (
        <div className="mt-5" aria-busy={waiting || query.isFetching}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Search results</h2>
            <button
              className="min-h-11 rounded-lg px-3 text-sm text-muted hover:bg-cream"
              onClick={() => change({ q: undefined, kind: undefined, boardId: undefined })}
            >
              Clear search
            </button>
          </div>
          {waiting || query.isPending ? (
            <div
              role="status"
              aria-label="Searching workspace"
              className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
            >
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-52" />
              ))}
            </div>
          ) : query.isError ? (
            <EmptyState
              title="Couldn't search this workspace"
              detail="Check your connection and access, then try again."
              action={
                <SecondaryButton onClick={() => void query.refetch()}>Try again</SecondaryButton>
              }
            />
          ) : unique.length ? (
            <>
              <div className="mt-4 grid items-start gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                {unique.map((hit) => (
                  <div
                    key={`${hit.type}:${hit.type === 'board' ? hit.board.id : hit.item.id}`}
                    className="min-w-0"
                  >
                    {hit.type === 'board' ? (
                      <>
                        <Link
                          to="/boards/$boardId"
                          params={{ boardId: hit.board.id }}
                          className="block rounded-xl"
                        >
                          <BoardPreview boardId={hit.board.id} />
                          <span className="mt-3 flex min-h-11 items-center justify-between gap-3 text-sm font-semibold">
                            <span className="break-words">{hit.board.title}</span>
                            <ArrowUpRight size={17} className="shrink-0" />
                          </span>
                        </Link>
                        <p className="text-xs text-muted">Board · {hit.board.role}</p>
                      </>
                    ) : (
                      <>
                        <ItemCard item={hit.item} />
                        <Link
                          to="/boards/$boardId"
                          params={{ boardId: hit.board.id }}
                          search={{ item: hit.item.id }}
                          className="mt-3 flex min-h-11 items-center justify-between gap-3 rounded-lg text-sm font-semibold hover:text-accent"
                        >
                          <span className="min-w-0 break-words">
                            Open{' '}
                            {hit.item.title ||
                              (hit.item.kind === 'link' ? hit.item.preview.title : null) ||
                              `${hit.item.kind} item`}
                          </span>
                          <ArrowUpRight size={17} className="shrink-0" />
                        </Link>
                        <p className="break-words text-xs text-muted">
                          {hit.board.title} · {hit.section?.name ?? 'Unsorted'}
                        </p>
                      </>
                    )}
                  </div>
                ))}
              </div>
              {query.hasNextPage && (
                <div className="mt-7 flex justify-center">
                  <SecondaryButton
                    disabled={query.isFetchingNextPage}
                    onClick={() => void query.fetchNextPage()}
                  >
                    {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </SecondaryButton>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              title="No matching ideas"
              detail="Try different words or broaden your board and type filters."
            />
          )}
        </div>
      )}
    </section>
  );
}
