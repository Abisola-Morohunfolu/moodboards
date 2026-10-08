import {
  createItemRequestSchema,
  linkUrlSchema,
  type CreateItemRequest,
  type ItemResponse,
} from '@moodboard/contracts';

export const CAPTURE_LIMIT = 20;
export const CAPTURE_CONCURRENCY = 3;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type CaptureSource =
  | { kind: 'note'; text: string; title?: string }
  | { kind: 'link'; url: string; title?: string }
  | { kind: 'image'; file: File };
export type CaptureStage = 'queued' | 'uploading' | 'saving' | 'saved' | 'failed';
export type UploadReservation = {
  assetId: string;
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
};
export type CaptureEntry = {
  id: string;
  boardId: string;
  sectionId: string | null;
  sectionName: string;
  source: CaptureSource | null;
  label: string;
  x: number;
  y: number;
  zOrder: string;
  reservation: UploadReservation | null;
  payload: Readonly<CreateItemRequest> | null;
  stage: CaptureStage;
  error: string | null;
  retryable: boolean;
};
export type CaptureDestination = {
  sectionId: string | null;
  sectionName: string;
  x: number;
  y: number;
  columns: number;
  lastOrder: string | null;
  occupied?: readonly { x: number; y: number }[];
};
export type CaptureSnapshot = {
  entries: readonly CaptureEntry[];
  paused: boolean;
  unfinished: number;
};

export function canDismissCapture(stage: CaptureStage, paused: boolean): boolean {
  return stage === 'failed' || stage === 'saved' || (paused && stage === 'queued');
}

type CaptureIO = {
  presign: (boardId: string, file: File, signal: AbortSignal) => Promise<UploadReservation>;
  upload: (reservation: UploadReservation, file: File, signal: AbortSignal) => Promise<void>;
  create: (
    boardId: string,
    payload: Readonly<CreateItemRequest>,
    signal: AbortSignal,
  ) => Promise<ItemResponse>;
  saved: (item: ItemResponse) => void;
  accessChanged: () => void;
  uuid?: () => string;
  now?: () => number;
};

export function classifyText(text: string, title?: string): CaptureSource[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const urls = lines.map((line) => linkUrlSchema.safeParse(line));
  if (urls.every((url) => url.success)) {
    return urls.map((url) => ({ kind: 'link', url: url.data!, ...(title ? { title } : {}) }));
  }
  return [{ kind: 'note', text: trimmed, ...(title ? { title } : {}) }];
}

// Files take precedence over browser-supplied text/HTML representations of those files.
export function transferSources(
  transfer: Pick<DataTransfer, 'files' | 'getData'>,
): CaptureSource[] {
  if (transfer.files.length) {
    return Array.from(transfer.files, (file) => ({ kind: 'image' as const, file }));
  }
  const plain = transfer.getData('text/plain');
  const uriList = transfer
    .getData('text/uri-list')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('#'))
    .join('\n');
  return classifyText(plain || uriList);
}

export function imageError(file: Pick<File, 'type' | 'size'>): string | null {
  if (!IMAGE_TYPES.includes(file.type)) {
    return 'Choose a JPEG, PNG, or WebP image.';
  }
  if (!file.size) {
    return 'This file is empty. Choose another image.';
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return 'This image exceeds 10 MiB. Choose a smaller image.';
  }
  return null;
}

export function captureAnchor(
  viewport: {
    left: number;
    top: number;
    width: number;
    scrollLeft: number;
    scrollTop: number;
    panX: number;
    panY: number;
    zoom: number;
  },
  point?: { x: number; y: number },
): { x: number; y: number; columns: number } {
  const localX = point ? point.x - viewport.left : 48;
  const localY = point ? point.y - viewport.top : 96;
  return {
    x: Math.max(0, Math.round((localX + viewport.scrollLeft - viewport.panX) / viewport.zoom)),
    y: Math.max(0, Math.round((localY + viewport.scrollTop - viewport.panY) / viewport.zoom)),
    columns: Math.max(1, Math.floor((viewport.width - localX) / viewport.zoom / 280)),
  };
}

export function nextCaptureOrder(previous: string | null): string {
  if (!previous) {
    return 'V';
  }
  if (previous.length < 128) {
    return `${previous}V`;
  }
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  for (let index = previous.length - 1; index >= 0; index--) {
    const next = alphabet[alphabet.indexOf(previous[index]!) + 1];
    if (next) {
      return previous.slice(0, index) + next;
    }
  }
  throw new Error('This board has reached its item ordering limit.');
}

export function mergeCapturedItem(items: ItemResponse[] = [], item: ItemResponse): ItemResponse[] {
  const existing = items.find((entry) => entry.id === item.id);
  if (item.deletedAt) {
    return items.filter((entry) => entry.id !== item.id);
  }
  // A late retry must not replace a newer content version already read from the server.
  if (existing && existing.version > item.version) {
    return items;
  }
  return [...items.filter((entry) => entry.id !== item.id), item].sort((a, b) =>
    a.zOrder < b.zOrder ? -1 : a.zOrder > b.zOrder ? 1 : a.id.localeCompare(b.id),
  );
}

export class CaptureQueue {
  private entries: CaptureEntry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: CaptureSnapshot = { entries: [], paused: false, unfinished: 0 };
  private active = false;
  private allowed = false;
  private paused = false;
  private generation = 0;
  private running = new Map<string, AbortController>();
  private lastOrder: string | null = null;

  constructor(
    private readonly boardId: string,
    private readonly io: CaptureIO,
  ) {}
  isActive = () => this.active;
  getSnapshot = (): CaptureSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  start() {
    this.active = true;
    this.pump();
  }
  dispose() {
    this.active = false;
    this.generation++;
    for (const controller of this.running.values()) {
      controller.abort();
    }
    this.running.clear();
  }
  setPermission(allowed: boolean) {
    if (this.allowed === allowed) {
      return;
    }
    this.allowed = allowed;
    if (!allowed && this.entries.some((entry) => entry.stage !== 'saved')) {
      this.paused = true;
    }
    this.publish();
    this.pump();
  }
  resume() {
    if (!this.allowed || !this.active) {
      return;
    }
    this.paused = false;
    this.publish();
    this.pump();
  }
  enqueue(sources: CaptureSource[], destination: CaptureDestination): string | null {
    if (!this.active || !this.allowed || this.paused) {
      return 'Saving is paused. Check your board access, then resume.';
    }
    if (!sources.length) {
      return 'Enter a note or web address.';
    }
    const available = CAPTURE_LIMIT - this.snapshot.unfinished;
    if (sources.length > available) {
      return `There is room for ${available} more unfinished ${available === 1 ? 'item' : 'items'}. Save or dismiss entries before adding this batch.`;
    }
    let order = destination.lastOrder;
    if (this.lastOrder && (!order || this.lastOrder > order)) {
      order = this.lastOrder;
    }
    const added: CaptureEntry[] = [];
    const occupied = [...(destination.occupied ?? [])];
    if (destination.occupied) {
      occupied.push(...this.entries.filter((entry) => entry.sectionId === destination.sectionId));
    }
    let slot = 0;
    try {
      for (const source of sources) {
        order = nextCaptureOrder(order);
        let x: number;
        let y: number;
        do {
          x = destination.x + (slot % destination.columns) * 280;
          y = destination.y + Math.floor(slot / destination.columns) * 360;
          slot++;
        } while (
          occupied.some(
            (position) => Math.abs(position.x - x) < 250 && Math.abs(position.y - y) < 320,
          )
        );
        occupied.push({ x, y });
        const entry: CaptureEntry = {
          id: (this.io.uuid ?? (() => crypto.randomUUID()))(),
          boardId: this.boardId,
          sectionId: destination.sectionId,
          sectionName: destination.sectionName,
          source,
          label:
            source.kind === 'image'
              ? source.file.name || 'Pasted image'
              : source.kind === 'link'
                ? source.url
                : source.title || source.text,
          x,
          y,
          zOrder: order,
          reservation: null,
          payload: null,
          stage: 'queued',
          error: null,
          retryable: true,
        };
        const error =
          source.kind === 'image'
            ? imageError(source.file)
            : source.kind === 'note' && source.text.length > 20000
              ? 'Notes can contain at most 20,000 characters. Split this text into shorter notes.'
              : null;
        if (error) {
          entry.stage = 'failed';
          entry.error = error;
          entry.retryable = false;
        }
        added.push(entry);
      }
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Could not add this batch.';
    }
    // Saved history is bounded and its file buffers have already been released.
    this.entries = [
      ...this.entries.filter((entry) => entry.stage !== 'saved'),
      ...this.entries.filter((entry) => entry.stage === 'saved').slice(-20),
      ...added,
    ];
    this.lastOrder = order;
    this.publish();
    this.pump();
    return null;
  }
  retry(id: string) {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!this.active || !this.allowed || !entry || entry.stage !== 'failed' || !entry.retryable) {
      return;
    }
    entry.stage = 'queued';
    entry.error = null;
    this.paused = false;
    this.publish();
    this.pump();
  }
  dismiss(id: string) {
    this.entries = this.entries.filter(
      (entry) => entry.id !== id || !canDismissCapture(entry.stage, this.paused),
    );
    if (!this.entries.some((entry) => entry.stage !== 'saved')) {
      this.paused = false;
    }
    this.publish();
  }
  clearSaved() {
    this.entries = this.entries.filter((entry) => entry.stage !== 'saved');
    this.publish();
  }
  private publish() {
    this.snapshot = {
      entries: this.entries.map((entry) => ({ ...entry })),
      paused: this.paused,
      unfinished: this.entries.filter((entry) => entry.stage !== 'saved').length,
    };
    for (const listener of this.listeners) {
      listener();
    }
  }
  private pump() {
    if (!this.active || !this.allowed || this.paused) {
      return;
    }
    while (this.running.size < CAPTURE_CONCURRENCY) {
      const entry = this.entries.find(
        (candidate) => candidate.stage === 'queued' && !this.running.has(candidate.id),
      );
      if (!entry) {
        break;
      }
      const controller = new AbortController();
      this.running.set(entry.id, controller);
      void this.save(entry, controller, this.generation);
    }
  }
  private async save(entry: CaptureEntry, controller: AbortController, generation: number) {
    const current = () => this.active && generation === this.generation;
    const proceed = () => {
      if (!current()) {
        throw new Error('Capture closed');
      }
      if (!this.allowed || this.paused) {
        throw new Error('Saving is paused. Check your access, then retry.');
      }
    };
    try {
      if (!entry.payload) {
        const source = entry.source!;
        if (source.kind === 'image') {
          entry.stage = 'uploading';
          this.publish();
          if (
            !entry.reservation ||
            Date.parse(entry.reservation.expiresAt) <= (this.io.now ?? Date.now)()
          ) {
            entry.reservation = await this.io.presign(
              entry.boardId,
              source.file,
              controller.signal,
            );
          }
          proceed();
          await this.io.upload(entry.reservation, source.file, controller.signal);
          proceed();
        }
        entry.payload = Object.freeze(
          createItemRequestSchema.parse({
            id: entry.id,
            sectionId: entry.sectionId,
            x: entry.x,
            y: entry.y,
            zOrder: entry.zOrder,
            kind: source.kind,
            ...(source.kind === 'image'
              ? { assetId: entry.reservation!.assetId }
              : { title: source.title || null }),
            ...(source.kind === 'note'
              ? { note: source.text }
              : source.kind === 'link'
                ? { url: source.url }
                : {}),
          }),
        );
      }
      proceed();
      entry.stage = 'saving';
      this.publish();
      const item = await this.io.create(entry.boardId, entry.payload, controller.signal);
      if (!current()) {
        return;
      }
      entry.stage = 'saved';
      entry.error = item.deletedAt ? 'Already saved, then removed from the board.' : null;
      entry.source = null;
      entry.reservation = null;
      this.publish();
      this.io.saved(item);
    } catch (cause) {
      if (!current()) {
        return;
      }
      const status = typeof cause === 'object' && cause && 'status' in cause ? cause.status : null;
      const message =
        cause instanceof Error ? cause.message : 'Could not save. Check your connection and retry.';
      entry.stage = 'failed';
      entry.error = message;
      if (status === 404 && message === 'Section not found') {
        entry.error = 'This section was removed. Dismiss this entry and add it to another section.';
        entry.retryable = false;
      } else if (status === 401 || status === 403 || status === 404) {
        this.paused = true;
        entry.error = 'Your board access may have changed. Check access before retrying.';
        this.io.accessChanged();
      } else if (status === 400) {
        entry.retryable = false;
      }
      this.publish();
    } finally {
      if (current()) {
        this.running.delete(entry.id);
        this.pump();
      }
    }
  }
}
