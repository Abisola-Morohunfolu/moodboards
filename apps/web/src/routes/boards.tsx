import { createFileRoute, Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Dialog, EmptyState, Field, PrimaryButton, SecondaryButton, Skeleton } from '@moodboard/ui';
import { ArrowUpRight, Plus, LogOut, X } from 'lucide-react';
import { api, ApiError, type account } from '../lib/api';
import { q, useApiAction } from '../lib/hooks';
import { ThemeToggle } from '../components/Theme';
import { Brand } from '../components/Brand';
import { WorkspaceSearch, type GallerySearch } from '../features/organization/WorkspaceSearch';
import { BoardPreview } from '../features/board/BoardPreview';

export const Route = createFileRoute('/boards')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): GallerySearch => ({
    workspace: typeof search.workspace === 'string' ? search.workspace : undefined,
    q: typeof search.q === 'string' ? search.q.slice(0, 200) : undefined,
    boardId: typeof search.boardId === 'string' ? search.boardId : undefined,
    kind: ['image', 'link', 'note'].includes(String(search.kind))
      ? (search.kind as GallerySearch['kind'])
      : undefined,
  }),
  component: BoardsRoute,
});
function BoardsRoute() {
  const location = useLocation();
  return location.pathname === '/boards' ? <BoardsHome /> : <Outlet />;
}
function BoardsHome() {
  const me = q.account();
  const navigate = useNavigate();
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (unauthenticated) {
      void navigate({ to: '/login', search: { mode: 'login' }, replace: true });
    }
  }, [unauthenticated, navigate]);
  if (me.isPending) {
    return (
      <main aria-label="Loading boards" className="mx-auto max-w-7xl space-y-6 p-8">
        <Skeleton className="h-12 w-48" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-[4/3]" />
          ))}
        </div>
      </main>
    );
  }
  if (me.isError) {
    return (
      <EmptyState
        title="Your boards couldn't be opened"
        detail="Check your connection and try again."
        action={<SecondaryButton onClick={() => void me.refetch()}>Try again</SecondaryButton>}
      />
    );
  }
  return <BoardsContent me={me.data} />;
}
function BoardsContent({ me }: { me: Awaited<ReturnType<typeof account>> }) {
  const qc = useQueryClient();
  const perform = useApiAction();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const workspaceId = search.workspace;
  function changeSearch(patch: Partial<GallerySearch>) {
    void navigate({
      to: '/boards',
      search: (old) => ({ ...old, workspace: old.workspace ?? selectedId, ...patch }),
      replace: true,
    });
  }
  function setWorkspaceId(id: string) {
    changeSearch({ workspace: id, boardId: undefined });
  }

  const selected =
    me.workspaces.find((w) => w.id === workspaceId) ??
    me.workspaces.find((w) => w.type === 'personal') ??
    me.workspaces[0];
  const selectedId = selected?.id ?? '';
  const boards = q.boards(selectedId);
  const [form, setForm] = useState<'workspace' | 'board' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      if (form === 'workspace') {
        const created = await perform(() => api.createWorkspace(String(values.get('name'))));
        await qc.invalidateQueries({ queryKey: ['account', 'me'] });
        setWorkspaceId(created.id);
        setForm(null);
      } else {
        const created = await perform(() =>
          api.createBoard(selectedId, String(values.get('title'))),
        );
        window.location.assign(`/boards/${created.id}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create. Try again.');
    } finally {
      setBusy(false);
    }
  }
  function openForm(kind: 'workspace' | 'board') {
    setError('');
    setForm(kind);
  }
  return (
    <main className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-x-5 gap-y-2 px-5 py-2 md:px-10">
          <div className="flex min-w-0 items-center gap-5">
            <Link to="/boards" aria-label="Moodboard boards">
              <Brand />
            </Link>
            <select
              aria-label="Workspace"
              value={selectedId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="hidden min-h-11 max-w-56 border border-line px-3 text-sm sm:block"
            >
              {me.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <span className="hidden max-w-40 truncate text-sm text-muted lg:block">
              {me.user.displayName}
            </span>
            <SecondaryButton
              aria-label="Log out"
              onClick={async () => {
                try {
                  await api.logout();
                } catch {
                  /* session may have expired */
                }
                qc.clear();
                window.location.assign('/');
              }}
            >
              <LogOut size={17} />
            </SecondaryButton>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Your boards</h1>
            <p className="mt-2 text-sm text-muted">A little space for every idea.</p>
          </div>
          <PrimaryButton onClick={() => openForm('board')} disabled={!selectedId}>
            <Plus size={17} /> New board
          </PrimaryButton>
        </div>
        <div className="mt-7 flex flex-wrap items-center gap-2 border-b border-line pb-4 text-sm">
          <select
            aria-label="Workspace on mobile"
            value={selectedId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="min-h-11 max-w-52 border border-line px-3 sm:hidden"
          >
            {me.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <span className="mr-auto hidden font-medium sm:block">
            {selected?.name ?? 'Choose a workspace'}
          </span>
          {selected?.type === 'business' && (
            <Link
              to="/clients"
              search={{ workspace: selectedId }}
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-muted hover:bg-cream hover:text-ink"
            >
              Clients
            </Link>
          )}
          <button
            type="button"
            onClick={() => openForm('workspace')}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-muted hover:bg-cream hover:text-ink"
          >
            <Plus size={16} /> New studio
          </button>
        </div>
        <WorkspaceSearch
          key={selectedId}
          workspaceId={selectedId}
          boards={boards.data ?? []}
          value={search}
          change={changeSearch}
        />
        {!search.q?.trim() &&
          (boards.isPending ? (
            <div
              role="status"
              aria-label="Loading boards"
              className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
            >
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="aspect-[4/3]" />
              ))}
            </div>
          ) : boards.isError ? (
            <EmptyState
              title="Couldn't load boards"
              detail="Check your connection and try again."
              action={
                <SecondaryButton onClick={() => void boards.refetch()}>Try again</SecondaryButton>
              }
            />
          ) : boards.data.length ? (
            <div className="mt-8 grid gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {boards.data.map((board) => (
                <Link
                  key={board.id}
                  to="/boards/$boardId"
                  params={{ boardId: board.id }}
                  className="group min-w-0 rounded-xl"
                >
                  <BoardPreview boardId={board.id} />
                  <div className="mt-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="break-words text-base font-semibold group-hover:text-accent">
                        {board.title}
                      </h2>
                      <p className="mt-1 text-xs capitalize text-muted">{board.role}</p>
                    </div>
                    <ArrowUpRight
                      size={18}
                      className="shrink-0 text-muted group-hover:text-accent"
                    />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Start with an idea"
              detail="Create a board and bring your images, links, and notes together."
              action={
                <SecondaryButton onClick={() => openForm('board')} disabled={!selectedId}>
                  Create your first board
                </SecondaryButton>
              }
            />
          ))}
      </div>
      {form && (
        <Dialog
          label={form === 'workspace' ? 'New studio' : 'New board'}
          onClose={() => setForm(null)}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">
              {form === 'workspace' ? 'New studio' : 'New board'}
            </h2>
            <button
              type="button"
              aria-label="Close"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-cream"
              onClick={() => setForm(null)}
            >
              <X size={20} />
            </button>
          </div>
          <p className="mt-2 text-sm text-muted">
            {form === 'workspace'
              ? 'A space for your client projects.'
              : 'Give your idea a name. You can change it later.'}
          </p>
          <form onSubmit={create} className="mt-6 space-y-4">
            <Field
              autoFocus
              label={form === 'workspace' ? 'Studio name' : 'Board title'}
              name={form === 'workspace' ? 'name' : 'title'}
              required
              maxLength={form === 'workspace' ? 100 : 200}
            />
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <SecondaryButton type="button" onClick={() => setForm(null)}>
                Cancel
              </SecondaryButton>
              <PrimaryButton type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create'}
              </PrimaryButton>
            </div>
          </form>
        </Dialog>
      )}
    </main>
  );
}
