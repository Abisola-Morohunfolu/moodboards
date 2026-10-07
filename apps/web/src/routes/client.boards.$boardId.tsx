import { useEffect, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { EmptyState, SecondaryButton, Skeleton } from '@moodboard/ui';
import { q } from '../lib/hooks';
import { api } from '../lib/api';
import { ItemCard } from '../features/board/ItemCard';
import type { DecisionRequest } from '@moodboard/contracts';
import { clientContext, changeClientContext } from '../lib/client-context';
import { ClientReview } from '../features/board/ClientReview';
import { matchingApproval } from '../features/board/approvals';
import { ApprovalStatus, ApprovalReadNotice } from '../features/board/ApprovalStatus';

export const Route = createFileRoute('/client/boards/$boardId')({
  ssr: false,
  component: ClientViewer,
  head: () => ({
    meta: [
      { name: 'robots', content: 'noindex' },
      { name: 'referrer', content: 'no-referrer' },
    ],
  }),
});

function ClientViewer() {
  const { boardId } = Route.useParams();
  const qc = useQueryClient();
  const [section, setSection] = useState<string | null>(null);
  const [contextChanged, setContextChanged] = useState(false);
  const initialContext = useRef(clientContext());
  const contextActive = !contextChanged && initialContext.current === clientContext();
  const detail = q.clientBoard(contextActive);
  const list = q.clientItems(contextActive);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const attempts = useRef(new Map<string, Readonly<DecisionRequest>>());
  const validContext =
    !contextChanged &&
    initialContext.current === clientContext() &&
    detail.data?.board.id === boardId;
  const approvals = q.clientApprovals(boardId, !!validContext);
  const syncing =
    !!approvals.data &&
    !!list.data?.some((item) => !item.deletedAt && !matchingApproval(item, approvals.data));
  const ready = approvals.isSuccess && !syncing;
  const mismatched = useRef('');
  const selected = list.data?.find((item) => item.id === selectedId && !item.deletedAt);
  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['client'] });
  }
  useEffect(() => {
    const signature = syncing
      ? JSON.stringify([
          list.data?.map((item) => [item.id, item.version]),
          approvals.data?.map((approval) => [approval.itemId, approval.itemVersion]),
        ])
      : '';
    if (signature && signature !== mismatched.current && validContext) {
      mismatched.current = signature;
      void Promise.all([list.refetch(), approvals.refetch()]);
    } else if (!signature) {
      mismatched.current = '';
    }
  }, [syncing, validContext, list, approvals]);
  useEffect(() => {
    const onChange = (event: StorageEvent) => {
      if (event.key === 'moodboard-client-context') {
        setContextChanged(true);
        setSelectedId(null);
        attempts.current.clear();
        void qc.cancelQueries({ queryKey: ['client'] });
        qc.removeQueries({ queryKey: ['client'] });
      }
    };
    window.addEventListener('storage', onChange);
    return () => window.removeEventListener('storage', onChange);
  }, [qc]);
  const mismatch =
    contextChanged ||
    initialContext.current !== clientContext() ||
    (detail.data && detail.data.board.id !== boardId);
  if (mismatch) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="text-2xl font-semibold">This browser opened another invitation.</h1>
        <p className="mt-3 text-sm text-muted">
          Reopen this board from its original invitation link.
        </p>
      </main>
    );
  }
  if (detail.isPending || list.isPending) {
    return (
      <main
        role="status"
        aria-label="Opening shared board"
        className="mx-auto max-w-3xl space-y-5 p-5"
      >
        <Skeleton className="h-11 w-48" />
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </main>
    );
  }
  if (detail.isError || list.isError) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="text-2xl font-semibold">This board is unavailable.</h1>
        <p className="mt-3 text-sm text-muted">
          Your link may have expired or your access may have changed. Ask your planner for a new
          link.
        </p>
      </main>
    );
  }
  const visible = list.data.filter((item) => !item.deletedAt && item.sectionId === section);
  return (
    <main className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-surface px-5 py-5">
        <div className="mx-auto flex max-w-3xl items-start justify-between gap-4">
          <div>
            <h1 className="mt-2 break-words text-2xl font-semibold leading-tight">
              {detail.data.board.title}
            </h1>
            <p className="mt-2 text-sm text-muted">A collection of ideas, shared with you.</p>
          </div>
          <SecondaryButton
            aria-label="Leave board"
            onClick={async () => {
              try {
                await api.clientLogout();
              } catch {
                /* session may have ended */
              }
              qc.removeQueries({ queryKey: ['client'] });
              changeClientContext(null);
              window.location.replace('/login');
            }}
          >
            <LogOut size={16} />
          </SecondaryButton>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-5 py-5">
        <div className="flex gap-2 overflow-auto border-b border-line pb-4">
          <button
            className={`min-h-11 shrink-0 px-3 text-sm ${section === null ? 'border-b-2 border-accent font-semibold' : ''}`}
            onClick={() => setSection(null)}
          >
            Unsorted
          </button>
          {detail.data.sections.map((s) => (
            <button
              key={s.id}
              className={`min-h-11 shrink-0 px-3 text-sm ${section === s.id ? 'border-b-2 border-accent font-semibold' : ''}`}
              onClick={() => setSection(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <ApprovalReadNotice
          loading={approvals.isPending}
          error={approvals.isError}
          syncing={syncing}
          retry={() => void refresh()}
        />
        <p className="mt-6 text-sm text-muted">
          {section ? detail.data.sections.find((s) => s.id === section)?.name : 'Unsorted'} /{' '}
          {visible.length} items
        </p>
        {visible.length ? (
          <div className="mt-4 grid items-start gap-5 sm:grid-cols-2">
            {visible.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                client
                footer={
                  <div className="flex items-center justify-between gap-3">
                    {ready && matchingApproval(item, approvals.data) ? (
                      <ApprovalStatus status={matchingApproval(item, approvals.data)!.status} />
                    ) : (
                      <span className="text-xs text-muted">Status unavailable</span>
                    )}
                    <SecondaryButton
                      aria-label={`Review ${item.title ?? 'item'}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      Review
                    </SecondaryButton>
                  </div>
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nothing here yet"
            detail="Your planner may add more ideas to this part of the board."
          />
        )}
      </div>
      {selected && (
        <ClientReview
          key={selected.id}
          item={selected}
          approval={ready ? matchingApproval(selected, approvals.data) : undefined}
          role={detail.data.role}
          available={ready}
          refresh={refresh}
          close={() => setSelectedId(null)}
          attempts={attempts.current}
        />
      )}
      <footer className="mx-auto max-w-3xl border-t border-line p-5 text-xs text-muted">
        Moodboard · A place to decide together
      </footer>
    </main>
  );
}
