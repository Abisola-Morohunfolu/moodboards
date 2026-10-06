import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  ImagePlus,
  Link2,
  Minus,
  Plus,
  Pencil,
  PanelLeft,
  MoreHorizontal,
  Share2,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import type { ItemResponse } from '@moodboard/contracts';
import { Dialog, EmptyState, Field, PrimaryButton, SecondaryButton, Skeleton } from '@moodboard/ui';
import { api, ApiError } from '../../lib/api';
import { q, useApiAction } from '../../lib/hooks';
import { ItemCard } from './ItemCard';
import { ThemeToggle } from '../../components/Theme';
import { SharePanel } from './SharePanel';

const key = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong';

export function Editor({ boardId }: { boardId: string }) {
  const perform = useApiAction();
  const qc = useQueryClient();
  const detail = q.board(boardId);
  const list = q.items(boardId);
  const [section, setSection] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composer, setComposer] = useState<
    'note' | 'link' | 'image' | 'section' | 'rename-section' | null
  >(null);
  const [share, setShare] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const queuedMoves = useRef(new Map<string, Promise<unknown>>());
  const draftItemId = useRef<string | null>(null);
  const canvasViewport = useRef<HTMLDivElement>(null);
  const visible = list.data?.filter((i) => !i.deletedAt && i.sectionId === section) ?? [];
  const selected = list.data?.find((i) => i.id === selectedId);
  const editable = detail.data?.role === 'editor' || detail.data?.role === 'owner';
  const shareable = detail.data?.role === 'owner';
  useEffect(() => {
    draftItemId.current = null;
  }, [composer]);

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['account', 'board', boardId] }),
      qc.invalidateQueries({ queryKey: ['account', 'board', boardId, 'items'] }),
    ]);
  }
  function saveMove(
    item: ItemResponse,
    patch: { x?: number; y?: number; sectionId?: string | null },
    rollbackItem: ItemResponse = item,
  ) {
    const queryKey = ['account', 'board', boardId, 'items'];
    void qc.cancelQueries({ queryKey });
    qc.setQueryData<ItemResponse[]>(queryKey, (old) =>
      old?.map((i) => (i.id === item.id ? { ...i, ...patch } : i)),
    );
    const prior = queuedMoves.current.get(item.id) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(() => perform(() => api.moveItem(item.id, patch)))
      .catch((cause: unknown) => {
        if (queuedMoves.current.get(item.id) === next) {
          qc.setQueryData<ItemResponse[]>(queryKey, (old) =>
            old?.map((i) => (i.id === item.id ? rollbackItem : i)),
          );
        }
        setError(message(cause));
      })
      .finally(() => {
        if (queuedMoves.current.get(item.id) === next) {
          queuedMoves.current.delete(item.id);
          void qc.invalidateQueries({ queryKey });
        }
      });
    queuedMoves.current.set(item.id, next);
  }
  function drag(event: PointerEvent<HTMLButtonElement>, item: ItemResponse) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const x = item.x ?? 48;
    const y = item.y ?? 48;
    target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => {
      const next = {
        x: Math.round(x + (e.clientX - startX) / zoom),
        y: Math.round(y + (e.clientY - startY) / zoom),
      };
      qc.setQueryData<ItemResponse[]>(['account', 'board', boardId, 'items'], (old) =>
        old?.map((i) => (i.id === item.id ? { ...i, ...next } : i)),
      );
    };
    const end = (e: globalThis.PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', cancel);
      saveMove(
        item,
        {
          x: Math.round(x + (e.clientX - startX) / zoom),
          y: Math.round(y + (e.clientY - startY) / zoom),
        },
        item,
      );
    };
    const cancel = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', cancel);
      qc.setQueryData<ItemResponse[]>(['account', 'board', boardId, 'items'], (old) =>
        old?.map((i) => (i.id === item.id ? item : i)),
      );
    };
    target.addEventListener('pointercancel', cancel);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
  }
  function fitToContent() {
    const viewport = canvasViewport.current;
    if (!viewport || !visible.length) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const minX = Math.min(...visible.map((item) => item.x ?? 48));
    const minY = Math.min(...visible.map((item) => item.y ?? 48));
    const maxX = Math.max(...visible.map((item) => (item.x ?? 48) + 250));
    const maxY = Math.max(...visible.map((item) => (item.y ?? 48) + 320));
    const nextZoom = Math.min(
      1.25,
      Math.max(
        0.5,
        Math.min(
          (viewport.clientWidth - 96) / (maxX - minX),
          (viewport.clientHeight - 96) / (maxY - minY),
        ),
      ),
    );
    viewport.scrollTo(0, 0);
    setZoom(nextZoom);
    setPan({
      x: (viewport.clientWidth - (maxX - minX) * nextZoom) / 2 - minX * nextZoom,
      y: (viewport.clientHeight - (maxY - minY) * nextZoom) / 2 - minY * nextZoom,
    });
  }
  async function moveSection(direction: -1 | 1) {
    if (!section || !detail.data) {
      return;
    }
    const current = detail.data.sections.findIndex((entry) => entry.id === section);
    const neighbor = detail.data.sections[current + direction];
    const selectedSection = detail.data.sections[current];
    if (!neighbor || !selectedSection) {
      return;
    }
    setError('');
    try {
      await perform(() =>
        api.updateSection(boardId, selectedSection.id, { position: neighbor.position }),
      );
      await perform(() =>
        api.updateSection(boardId, neighbor.id, { position: selectedSection.position }),
      );
      await refresh();
    } catch (cause) {
      setError(message(cause));
      await refresh();
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      if (composer === 'rename-section' && section) {
        await perform(() =>
          api.updateSection(boardId, section, { name: String(form.get('name')) }),
        );
      } else if (composer === 'section') {
        const last = detail.data?.sections.at(-1)?.position;
        await perform(() =>
          api.createSection(
            boardId,
            String(form.get('name')),
            last && last.length < 128 ? `${last}V` : key(),
          ),
        );
      } else {
        const id = (draftItemId.current ??= crypto.randomUUID());
        const common = {
          id,
          title: String(form.get('title') || '').trim() || null,
          note: String(form.get('note') || '').trim() || null,
          sectionId: section,
          x: 48 + visible.length * 24,
          y: 48 + visible.length * 24,
          zOrder: key(),
        };
        if (composer === 'note') {
          await perform(() => api.createItem(boardId, { ...common, kind: 'note' }));
        }
        if (composer === 'link') {
          await perform(() =>
            api.createItem(boardId, { ...common, kind: 'link', url: String(form.get('url')) }),
          );
        }
        if (composer === 'image') {
          const file = form.get('file');
          if (
            !(file instanceof File) ||
            !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
            file.size > 10485760
          ) {
            throw new Error('Choose a JPEG, PNG or WebP under 10 MiB.');
          }
          const ticket = await perform(() => api.presign(boardId, file.type, file.size));
          const uploadHeaders = new Headers(ticket.headers);
          uploadHeaders.delete('Content-Length');
          const upload = await fetch(ticket.url, {
            method: 'PUT',
            headers: uploadHeaders,
            body: file,
          });
          if (!upload.ok) {
            throw new Error('Image upload failed. Check storage access and try again.');
          }
          await perform(() =>
            api.createItem(boardId, { ...common, kind: 'image', assetId: ticket.assetId }),
          );
        }
      }
      draftItemId.current = null;
      setComposer(null);
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  if (detail.isPending || list.isPending) {
    return (
      <main role="status" aria-label="Opening board" className="space-y-6 p-6">
        <Skeleton className="h-11 w-64" />
        <Skeleton className="h-[70dvh]" />
      </main>
    );
  }
  if (detail.isError || list.isError) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-semibold">This board is unavailable.</h1>
        <p className="mt-3 text-sm text-muted">
          It may have been removed or your access may have changed.
        </p>
        <Link to="/boards" className="mt-5 inline-flex min-h-11 items-center text-accent underline">
          Back to boards
        </Link>
      </main>
    );
  }
  const sectionName = section
    ? detail.data.sections.find((entry) => entry.id === section)?.name
    : 'Unsorted';
  const chooseSection = (id: string | null) => {
    setSection(id);
    setSelectedId(null);
  };
  const addTools = editable && (
    <>
      <SecondaryButton onClick={() => setComposer('image')}>
        <ImagePlus size={17} /> Image
      </SecondaryButton>
      <SecondaryButton onClick={() => setComposer('link')}>
        <Link2 size={17} /> Link
      </SecondaryButton>
      <SecondaryButton onClick={() => setComposer('note')}>
        <StickyNote size={17} /> Note
      </SecondaryButton>
    </>
  );
  return (
    <main className="min-h-dvh bg-paper">
      <header className="flex h-16 items-center justify-between gap-3 border-b border-line bg-surface px-3 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/boards"
            aria-label="Back to boards"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-cream"
          >
            <ArrowLeft size={18} />
          </Link>
          <button
            type="button"
            aria-label="Toggle sections"
            aria-expanded={sectionsOpen}
            onClick={() => setSectionsOpen(!sectionsOpen)}
            className="hidden min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-cream md:flex"
          >
            <PanelLeft size={18} />
          </button>
          <h1 className="truncate text-base font-semibold" title={detail.data.board.title}>
            {detail.data.board.title}
          </h1>
          <span className="ml-2 hidden text-xs capitalize text-muted lg:block">
            {detail.data.role}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {shareable && (
            <SecondaryButton aria-label="Share board" onClick={() => setShare(true)}>
              <Share2 size={16} />
              <span className="hidden sm:inline">Share board</span>
            </SecondaryButton>
          )}
        </div>
      </header>
      {error && !composer && (
        <p
          className="flex items-center justify-between gap-3 border-b border-line bg-danger-soft px-5 py-3 text-sm text-danger"
          role="alert"
        >
          {error}
          <button type="button" className="min-h-11 underline" onClick={() => setError('')}>
            Dismiss
          </button>
        </p>
      )}
      <div
        className="flex items-center gap-2 overflow-x-auto border-b border-line bg-surface px-4 py-2 md:hidden"
        aria-label="Sections"
      >
        <button
          type="button"
          aria-pressed={section === null}
          className={`min-h-11 shrink-0 rounded-lg px-3 text-sm ${section === null ? 'bg-cream font-semibold' : 'text-muted'}`}
          onClick={() => chooseSection(null)}
        >
          Unsorted
        </button>
        {detail.data.sections.map((s) => (
          <button
            type="button"
            key={s.id}
            aria-pressed={section === s.id}
            className={`min-h-11 shrink-0 rounded-lg px-3 text-sm ${section === s.id ? 'bg-cream font-semibold' : 'text-muted'}`}
            onClick={() => chooseSection(s.id)}
          >
            {s.name}
          </button>
        ))}
        {editable && (
          <button
            type="button"
            aria-label="Add section"
            className="min-h-11 min-w-11 shrink-0 rounded-lg text-accent"
            onClick={() => setComposer('section')}
          >
            <Plus size={18} className="mx-auto" />
          </button>
        )}
      </div>
      <div className="editor-stage">
        {sectionsOpen && (
          <nav className="section-nav" aria-label="Board sections">
            <div className="mb-3 flex items-center justify-between px-2">
              <h2 className="text-sm font-semibold">Sections</h2>
              {editable && (
                <button
                  type="button"
                  aria-label="Add section"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted hover:bg-cream"
                  onClick={() => setComposer('section')}
                >
                  <Plus size={17} />
                </button>
              )}
            </div>
            <button
              type="button"
              aria-pressed={section === null}
              className={`min-h-11 w-full rounded-lg px-3 text-left text-sm ${section === null ? 'bg-cream font-semibold' : 'text-muted hover:bg-cream'}`}
              onClick={() => chooseSection(null)}
            >
              Unsorted
            </button>
            {detail.data.sections.map((s) => (
              <button
                type="button"
                key={s.id}
                aria-pressed={section === s.id}
                className={`mt-1 min-h-11 w-full break-words rounded-lg px-3 text-left text-sm ${section === s.id ? 'bg-cream font-semibold' : 'text-muted hover:bg-cream'}`}
                onClick={() => chooseSection(s.id)}
              >
                {s.name}
              </button>
            ))}
          </nav>
        )}
        <div className="relative hidden min-w-0 flex-1 md:block">
          <div
            ref={canvasViewport}
            className="board-grid absolute inset-0 overflow-auto"
            onPointerDown={(e) => {
              if (
                (e.target as HTMLElement).closest('article, button, a, input, select, textarea')
              ) {
                return;
              }
              const start = { pointerX: e.clientX, pointerY: e.clientY, panX: pan.x, panY: pan.y };
              const el = e.currentTarget;
              el.setPointerCapture(e.pointerId);
              const move = (p: globalThis.PointerEvent) =>
                setPan({
                  x: start.panX + p.clientX - start.pointerX,
                  y: start.panY + p.clientY - start.pointerY,
                });
              const end = () => {
                el.removeEventListener('pointermove', move);
                el.removeEventListener('pointerup', end);
                el.removeEventListener('pointercancel', end);
              };
              el.addEventListener('pointermove', move);
              el.addEventListener('pointerup', end);
              el.addEventListener('pointercancel', end);
            }}
          >
            <div
              className="relative h-[1800px] w-[2200px] origin-top-left"
              style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}
            >
              {visible.map((item) => (
                <div
                  key={item.id}
                  className="absolute w-[250px]"
                  style={{
                    left: item.x ?? 48,
                    top: item.y ?? 48,
                    zIndex: Number.parseInt(item.zOrder.slice(-3), 36) || 1,
                  }}
                >
                  <ItemCard
                    item={item}
                    selected={selectedId === item.id}
                    onSelect={() => setSelectedId(item.id)}
                    onDrag={editable ? (e) => drag(e, item) : undefined}
                    onKeyMove={
                      editable
                        ? (dx, dy) =>
                            saveMove(item, { x: (item.x ?? 48) + dx, y: (item.y ?? 48) + dy })
                        : undefined
                    }
                  />
                </div>
              ))}
            </div>
          </div>
          {editable && (
            <div className="canvas-toolbar" aria-label="Add to board">
              {addTools}
            </div>
          )}
          {!visible.length && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="max-w-xs text-center">
                <h2 className="text-xl font-semibold">Space for inspiration</h2>
                <p className="mt-3 text-sm leading-6 text-muted">
                  {editable
                    ? 'Add an image, link, or note to start this section.'
                    : 'Ideas will appear here when they are added.'}
                </p>
              </div>
            </div>
          )}
          <div
            className="absolute bottom-4 right-4 flex items-center gap-1 rounded-xl bg-surface p-1 shadow-lg shadow-ink/5"
            aria-label="Canvas zoom"
          >
            <button
              type="button"
              aria-label="Zoom out"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-cream"
              onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
            >
              <Minus size={16} />
            </button>
            <span className="min-w-12 text-center text-xs tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-cream"
              onClick={() => setZoom(Math.min(1.8, zoom + 0.1))}
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              onClick={fitToContent}
              className="min-h-11 rounded-lg px-3 text-sm hover:bg-cream"
            >
              Fit
            </button>
          </div>
        </div>
        <div className="md:hidden">
          <div className="flex flex-wrap gap-2 px-4 pt-4">{addTools}</div>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {visible.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                onSelect={() => setSelectedId(item.id)}
              />
            ))}
            {!visible.length && (
              <EmptyState
                title="Space for inspiration"
                detail={
                  editable
                    ? 'Add an image, link, or note to begin.'
                    : 'Ideas will appear here when they are added.'
                }
              />
            )}
          </div>
        </div>
        {selected && (
          <Inspector
            key={selected.id}
            item={selected}
            editable={!!editable}
            sections={detail.data.sections}
            close={() => setSelectedId(null)}
            refresh={refresh}
            move={saveMove}
          />
        )}
      </div>
      {editable && section && (
        <details className="fixed bottom-4 left-4 z-20 md:left-5">
          <summary
            aria-label={`Manage section ${sectionName}`}
            className="flex min-h-11 min-w-11 list-none items-center justify-center rounded-lg bg-surface px-3 text-sm shadow-lg shadow-ink/5"
          >
            <MoreHorizontal size={20} />
            <span className="ml-2 hidden md:inline">{sectionName}</span>
          </summary>
          <div className="absolute bottom-full left-0 mb-2 w-56 rounded-xl bg-surface p-2 shadow-xl shadow-ink/10">
            <button
              type="button"
              onClick={() => setComposer('rename-section')}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm hover:bg-cream"
            >
              <Pencil size={16} /> Rename section
            </button>
            <button
              type="button"
              disabled={detail.data.sections[0]?.id === section}
              onClick={() => void moveSection(-1)}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm hover:bg-cream disabled:opacity-40"
            >
              <ArrowLeft size={16} /> Move earlier
            </button>
            <button
              type="button"
              disabled={detail.data.sections.at(-1)?.id === section}
              onClick={() => void moveSection(1)}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm hover:bg-cream disabled:opacity-40"
            >
              <ArrowRight size={16} /> Move later
            </button>
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-danger hover:bg-cream"
              onClick={async () => {
                if (!confirm('Delete this section? Its items will return to Unsorted.')) {
                  return;
                }
                try {
                  await perform(() => api.deleteSection(boardId, section));
                  setSection(null);
                  await refresh();
                } catch (cause) {
                  setError(message(cause));
                }
              }}
            >
              <Trash2 size={16} /> Delete section
            </button>
          </div>
        </details>
      )}
      {share && (
        <SharePanel
          boardId={boardId}
          clientId={detail.data.board.clientId}
          workspaceId={detail.data.board.workspaceId}
          onClose={() => {
            setShare(false);
            void refresh();
          }}
        />
      )}
      {composer && (
        <Dialog
          label={composer === 'rename-section' ? 'Rename section' : `Add ${composer}`}
          className="mobile-sheet"
          onClose={() => setComposer(null)}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">
              {composer === 'rename-section' ? 'Rename section' : `Add ${composer}`}
            </h2>
            <button
              type="button"
              aria-label="Close"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-cream"
              onClick={() => setComposer(null)}
            >
              <X size={20} />
            </button>
          </div>
          <form onSubmit={create} className="mt-5 flex flex-col gap-4">
            {composer === 'section' || composer === 'rename-section' ? (
              <Field
                label="Section name"
                name="name"
                defaultValue={
                  composer === 'rename-section'
                    ? detail.data.sections.find((entry) => entry.id === section)?.name
                    : ''
                }
                required
                maxLength={100}
              />
            ) : (
              <>
                <Field label="Title (optional)" name="title" maxLength={200} />
                {composer === 'link' && (
                  <Field
                    label="Web address"
                    name="url"
                    type="url"
                    placeholder="https://"
                    required
                  />
                )}
                {composer === 'image' && (
                  <Field
                    label="JPEG, PNG or WebP (10 MiB max)"
                    name="file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    required
                  />
                )}
                <label className="flex flex-col gap-2 text-sm font-semibold">
                  Note (optional)
                  <textarea
                    name="note"
                    rows={3}
                    maxLength={20000}
                    className="border border-line bg-surface p-3 font-normal"
                  />
                </label>
              </>
            )}
            {error && (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            <PrimaryButton disabled={busy} type="submit">
              {busy ? 'Saving…' : composer === 'rename-section' ? 'Save section' : 'Add to board'}
            </PrimaryButton>
          </form>
        </Dialog>
      )}
    </main>
  );
}

function InspectorSurface({ children, close }: { children: React.ReactNode; close: () => void }) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return mobile ? (
    <Dialog label="Item details" variant="sheet" onClose={close}>
      {children}
    </Dialog>
  ) : (
    <aside className="w-80 shrink-0 overflow-auto border-l border-line bg-surface p-5">
      {children}
    </aside>
  );
}

function Inspector({
  item,
  sections,
  editable,
  close,
  refresh,
  move,
}: {
  item: ItemResponse;
  sections: { id: string; name: string }[];
  editable: boolean;
  close: () => void;
  refresh: () => Promise<void>;
  move: (item: ItemResponse, patch: { sectionId?: string | null }) => void;
}) {
  const perform = useApiAction();
  const [title, setTitle] = useState(item.title ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const [version, setVersion] = useState(item.version);
  const [serverVersion, setServerVersion] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (item.version > version && serverVersion === null) {
      setServerVersion(item.version);
    }
  }, [item.version, version, serverVersion]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const updated = await perform(() =>
        api.updateItem(item.id, {
          version: serverVersion ?? version,
          title: title.trim() || null,
          note: note.trim() || null,
        }),
      );
      setVersion(updated.version);
      setServerVersion(null);
      await refresh();
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.status === 409 &&
        typeof cause.body === 'object' &&
        cause.body &&
        'currentItem' in cause.body &&
        typeof cause.body.currentItem === 'object' &&
        cause.body.currentItem &&
        'version' in cause.body.currentItem &&
        typeof cause.body.currentItem.version === 'number'
      ) {
        setServerVersion(cause.body.currentItem.version);
      }
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <InspectorSurface close={close}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Item details</h2>
        <button aria-label="Close details" onClick={close} className="min-h-11 min-w-11">
          <X size={19} />
        </button>
      </div>
      <form className="mt-5 flex flex-col gap-4" onSubmit={submit}>
        <Field
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={!editable}
          maxLength={200}
        />
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Note
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={!editable}
            rows={5}
            maxLength={20000}
            className="border border-line bg-surface p-3 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Section
          <select
            value={item.sectionId ?? ''}
            disabled={!editable}
            onChange={(e) => move(item, { sectionId: e.target.value || null })}
            className="min-h-11 border border-line bg-surface px-3 font-normal"
          >
            <option value="">Unsorted</option>
            {sections.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {serverVersion !== null && (
          <p role="status" className="bg-cream p-3 text-sm">
            A newer version is on the board. Your draft is still here. Review it before saving over
            version {serverVersion}.
          </p>
        )}
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {editable && (
          <PrimaryButton disabled={busy} type="submit">
            {busy ? 'Saving…' : serverVersion !== null ? 'Reapply my changes' : 'Save changes'}
          </PrimaryButton>
        )}
      </form>
      {editable && (
        <SecondaryButton
          className="mt-4 w-full"
          onClick={async () => {
            if (!confirm('Delete this item?')) {
              return;
            }
            try {
              await perform(() => api.deleteItem(item.id));
              close();
              await refresh();
            } catch (cause) {
              setError(message(cause));
            }
          }}
        >
          <Trash2 size={16} /> Delete item
        </SecondaryButton>
      )}
    </InspectorSurface>
  );
}
