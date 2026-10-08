import { randomUUID } from 'node:crypto';
import type { CreateItemRequest, ItemResponse } from '@moodboard/contracts';
import {
  CaptureQueue,
  captureAnchor,
  classifyText,
  imageError,
  mergeCapturedItem,
  nextCaptureOrder,
  transferSources,
  type CaptureDestination,
  type CaptureSource,
} from '../apps/web/src/features/board/capture';

const boardId = randomUUID();
const destination: CaptureDestination = {
  sectionId: null,
  sectionName: 'Unsorted',
  x: 48,
  y: 96,
  columns: 2,
  lastOrder: 'b0',
};
function response(payload: Readonly<CreateItemRequest>): ItemResponse {
  const base = {
    id: payload.id,
    boardId,
    sectionId: payload.sectionId ?? null,
    createdBy: randomUUID(),
    title: payload.title ?? null,
    note: payload.note ?? null,
    x: payload.x ?? null,
    y: payload.y ?? null,
    zOrder: payload.zOrder,
    quantity: 1,
    version: 1,
    deletedAt: null,
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
  };
  if (payload.kind === 'image') {
    return {
      ...base,
      kind: 'image',
      asset: {
        id: payload.assetId,
        status: 'pending',
        mime: 'image/png',
        bytes: 1,
        width: null,
        height: null,
        palette: null,
      },
    };
  }
  if (payload.kind === 'link') {
    return {
      ...base,
      kind: 'link',
      preview: {
        id: randomUUID(),
        url: payload.url,
        status: 'pending',
        title: null,
        description: null,
        imageUrl: null,
        siteName: null,
        fetchedAt: null,
        expiresAt: null,
      },
    };
  }
  return { ...base, kind: 'note' };
}
function setup() {
  const io = {
    presign: jest.fn(async () => ({
      assetId: randomUUID(),
      url: 'https://storage.example/upload',
      headers: {},
      expiresAt: '2099-01-01T00:00:00.000Z',
    })),
    upload: jest.fn(async (): Promise<void> => undefined),
    create: jest.fn(
      async (_boardId: string, payload: Readonly<CreateItemRequest>, _signal: AbortSignal) =>
        response(payload),
    ),
    saved: jest.fn(),
    accessChanged: jest.fn(),
    uuid: randomUUID,
  };
  const queue = new CaptureQueue(boardId, io);
  queue.start();
  queue.setPermission(true);
  return { queue, io };
}
async function settle() {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const notes = (count: number): CaptureSource[] =>
  Array.from({ length: count }, (_, index) => ({ kind: 'note', text: `Idea ${index}` }));
const image = (): CaptureSource => ({
  kind: 'image',
  file: new File(['bytes'], 'reference.png', { type: 'image/png' }),
});

describe('Quick capture inputs and placement', () => {
  it('normalizes one URL and splits only URL-only lists, keeping order and repetitions', () => {
    expect(classifyText(' https://example.com/a#section ')).toEqual([
      { kind: 'link', url: 'https://example.com/a' },
    ]);
    expect(
      classifyText('https://one.example\n\nhttps://two.example\r\nhttps://one.example'),
    ).toEqual([
      { kind: 'link', url: 'https://one.example/' },
      { kind: 'link', url: 'https://two.example/' },
      { kind: 'link', url: 'https://one.example/' },
    ]);
    expect(classifyText('Thought\nhttps://example.com\n  Second thought')).toEqual([
      { kind: 'note', text: 'Thought\nhttps://example.com\n  Second thought' },
    ]);
    expect(classifyText('javascript:alert(1)')).toEqual([
      { kind: 'note', text: 'javascript:alert(1)' },
    ]);
    expect(classifyText('   \n ')).toEqual([]);
  });
  it('gives files precedence over text and ignores HTML-only transfers', () => {
    const file = new File(['png'], 'image.png', { type: 'image/png' });
    const transfer = {
      files: [file] as unknown as FileList,
      getData: (type: string) => (type === 'text/plain' ? 'https://example.com' : ''),
    };
    expect(transferSources(transfer)).toEqual([{ kind: 'image', file }]);
    expect(transferSources({ files: [] as unknown as FileList, getData: () => '' })).toEqual([]);
    expect(
      transferSources({
        files: [] as unknown as FileList,
        getData: (type) => (type === 'text/uri-list' ? '# source\nhttps://example.com' : ''),
      }),
    ).toEqual([{ kind: 'link', url: 'https://example.com/' }]);
  });
  it('rejects empty, oversized, and unsupported files independently', () => {
    expect(imageError({ type: 'image/png', size: 0 })).toMatch(/empty/);
    expect(imageError({ type: 'image/gif', size: 100 })).toMatch(/JPEG/);
    expect(imageError({ type: 'image/png', size: 10485761 })).toMatch(/10 MiB/);
    expect(imageError({ type: 'image/webp', size: 10485760 })).toBeNull();
  });
  it('accounts for pan, zoom, scroll and drop coordinates, and clamps negative positions', () => {
    const viewport = {
      left: 100,
      top: 50,
      width: 900,
      scrollLeft: 120,
      scrollTop: 80,
      panX: -40,
      panY: 20,
      zoom: 2,
    };
    expect(captureAnchor(viewport, { x: 340, y: 230 })).toEqual({ x: 200, y: 120, columns: 1 });
    expect(captureAnchor(viewport)).toEqual({ x: 104, y: 78, columns: 1 });
    expect(captureAnchor({ ...viewport, panX: 9999, panY: 9999 })).toEqual({
      x: 0,
      y: 0,
      columns: 1,
    });
    expect(captureAnchor({ ...viewport, zoom: 1, width: 1000 }).columns).toBe(3);
  });
  it('generates bounded ASCII ordering keys above an existing key', () => {
    expect(nextCaptureOrder('b0')).toBe('b0V');
    const long = 'b'.repeat(127) + 'z';
    expect(nextCaptureOrder(long) > long).toBe(true);
    expect(nextCaptureOrder(long).length).toBeLessThanOrEqual(128);
    expect(() => nextCaptureOrder('z'.repeat(128))).toThrow(/ordering limit/);
  });
});

describe('Quick capture queue', () => {
  it('uses free grid slots for repeated quick captures without moving existing items', async () => {
    const { queue } = setup();
    const target = { ...destination, occupied: [{ x: 48, y: 96 }] };
    queue.enqueue(notes(1), target);
    queue.enqueue(notes(1), target);
    await settle();
    expect(queue.getSnapshot().entries.map((entry) => [entry.x, entry.y])).toEqual([
      [328, 96],
      [48, 456],
    ]);
    expect(target.occupied).toEqual([{ x: 48, y: 96 }]);
  });
  it('limits concurrency to three and keeps the batch order and destination despite out-of-order completion', async () => {
    const { queue, io } = setup();
    const gates = Array.from({ length: 4 }, () => deferred<ItemResponse>());
    io.create.mockImplementation((_id, payload) => gates[Number(payload.note!.slice(-1))]!.promise);
    const target = { ...destination, sectionId: randomUUID(), sectionName: 'Ideas' };
    expect(queue.enqueue(notes(4), target)).toBeNull();
    target.sectionId = randomUUID();
    target.x = 999;
    expect(io.create).toHaveBeenCalledTimes(3);
    gates[1]!.resolve(response(io.create.mock.calls[1]![1]));
    await settle();
    expect(io.create).toHaveBeenCalledTimes(4);
    for (const index of [3, 2, 0]) {
      gates[index]!.resolve(response(io.create.mock.calls[index]![1]));
    }
    await settle();
    const entries = queue.getSnapshot().entries;
    expect(entries.map((entry) => [entry.x, entry.y])).toEqual([
      [48, 96],
      [328, 96],
      [48, 456],
      [328, 456],
    ]);
    expect(new Set(entries.map((entry) => entry.sectionId)).size).toBe(1);
    expect(entries.map((entry) => entry.zOrder)).toEqual(
      [...entries.map((entry) => entry.zOrder)].sort(),
    );
    expect(entries.every((entry) => entry.stage === 'saved')).toBe(true);
  });
  it('rejects oversized gestures atomically and counts failed entries toward the unfinished limit', async () => {
    const { queue, io } = setup();
    const gate = deferred<ItemResponse>();
    io.create.mockReturnValue(gate.promise);
    expect(queue.enqueue(notes(21), destination)).toMatch(/20/);
    expect(queue.getSnapshot().entries).toHaveLength(0);
    queue.enqueue(notes(19), destination);
    expect(queue.enqueue(notes(2), destination)).toMatch(/1 more unfinished item/);
    expect(queue.getSnapshot().entries).toHaveLength(19);
    queue.dispose();
    gate.resolve(response(io.create.mock.calls[0]![1]));
    await settle();
    expect(io.saved).not.toHaveBeenCalled();
  });
  it('keeps valid files saving when another file or long note is invalid', async () => {
    const { queue, io } = setup();
    queue.enqueue(
      [
        { kind: 'image', file: new File([], 'empty.png', { type: 'image/png' }) },
        image(),
        { kind: 'note', text: 'x'.repeat(20001) },
      ],
      destination,
    );
    await settle();
    expect(queue.getSnapshot().entries.map((entry) => entry.stage)).toEqual([
      'failed',
      'saved',
      'failed',
    ]);
    expect(io.create).toHaveBeenCalledTimes(1);
    const failed = queue.getSnapshot().entries[0]!;
    queue.retry(failed.id);
    expect(io.create).toHaveBeenCalledTimes(1);
    queue.dismiss(failed.id);
    expect(queue.getSnapshot().unfinished).toBe(1);
  });
  it('retains an immutable payload and UUID after a response is lost following a committed save', async () => {
    const { queue, io } = setup();
    const records = new Map<string, ItemResponse>();
    let events = 0;
    let loseResponse = true;
    io.create.mockImplementation(async (_id, payload) => {
      if (!records.has(payload.id)) {
        records.set(payload.id, response(payload));
        events++;
      }
      if (loseResponse) {
        loseResponse = false;
        throw new TypeError('Connection lost');
      }
      return records.get(payload.id)!;
    });
    const sources = notes(1);
    queue.enqueue(sources, destination);
    await settle();
    const first = io.create.mock.calls[0]![1];
    expect(Object.isFrozen(first)).toBe(true);
    expect(queue.getSnapshot().entries[0]!.stage).toBe('failed');
    if (sources[0]!.kind === 'note') {
      sources[0]!.text = 'Edited draft';
    }
    queue.retry(first.id);
    await settle();
    expect(io.create.mock.calls[1]![1]).toBe(first);
    expect(records.size).toBe(1);
    expect(events).toBe(1);
    expect(queue.getSnapshot().entries[0]!.stage).toBe('saved');
  });
  it('repeats a failed upload with its reservation and replaces expired reservations before creation only', async () => {
    const { queue, io } = setup();
    io.upload.mockRejectedValueOnce(new Error('Upload failed'));
    queue.enqueue([image()], destination);
    await settle();
    const id = queue.getSnapshot().entries[0]!.id;
    expect(queue.getSnapshot().entries[0]!.payload).toBeNull();
    queue.retry(id);
    await settle();
    expect(io.presign).toHaveBeenCalledTimes(1);
    expect(io.upload).toHaveBeenCalledTimes(2);
    expect(io.create).toHaveBeenCalledTimes(1);

    const second = setup();
    second.io.presign.mockResolvedValueOnce({
      assetId: randomUUID(),
      url: 'https://storage.example/upload',
      headers: {},
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    second.io.upload.mockRejectedValueOnce(new Error('Expired upload'));
    second.queue.enqueue([image()], destination);
    await settle();
    second.queue.retry(second.queue.getSnapshot().entries[0]!.id);
    await settle();
    expect(second.io.presign).toHaveBeenCalledTimes(2);
    expect(second.io.create).toHaveBeenCalledTimes(1);
  });
  it('never reserves or uploads again after an image create request has been attempted', async () => {
    const { queue, io } = setup();
    io.create.mockRejectedValueOnce(new TypeError('Lost response'));
    queue.enqueue([image()], destination);
    await settle();
    const entry = queue.getSnapshot().entries[0]!;
    queue.retry(entry.id);
    await settle();
    expect(io.presign).toHaveBeenCalledTimes(1);
    expect(io.upload).toHaveBeenCalledTimes(1);
    expect(io.create.mock.calls[1]![1]).toBe(io.create.mock.calls[0]![1]);
    expect(queue.getSnapshot().entries[0]!.source).toBeNull();
  });
  it('pauses remaining work on permission loss and needs explicit resumption after access refresh', async () => {
    const { queue, io } = setup();
    io.create.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    queue.enqueue(notes(5), destination);
    await settle();
    expect(queue.getSnapshot().paused).toBe(true);
    expect(io.accessChanged).toHaveBeenCalledTimes(1);
    expect(io.create).toHaveBeenCalledTimes(3);
    queue.setPermission(false);
    queue.retry(queue.getSnapshot().entries[0]!.id);
    expect(io.create).toHaveBeenCalledTimes(3);
    queue.setPermission(true);
    expect(io.create).toHaveBeenCalledTimes(3);
    queue.resume();
    await settle();
    expect(io.create).toHaveBeenCalledTimes(5);
    queue.retry(queue.getSnapshot().entries[0]!.id);
    await settle();
    expect(queue.getSnapshot().unfinished).toBe(0);
  });
  it('dismisses paused queued images without losing failures or saving discarded inputs on resume', async () => {
    const { queue, io } = setup();
    io.create.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    queue.enqueue([...notes(3), image(), image()], destination);
    await settle();
    queue.setPermission(false);
    const before = queue.getSnapshot();
    const failed = before.entries.find((entry) => entry.stage === 'failed')!;
    const queued = before.entries.filter((entry) => entry.stage === 'queued');
    expect(queued).toHaveLength(2);
    queue.dismiss(queued[0]!.id);
    expect(queue.getSnapshot().entries).toEqual(
      before.entries.filter((entry) => entry.id !== queued[0]!.id),
    );
    expect(queue.getSnapshot()).toMatchObject({ paused: true, unfinished: 2 });
    expect(io.presign).not.toHaveBeenCalled();

    queue.setPermission(true);
    queue.resume();
    await settle();
    expect(io.presign).toHaveBeenCalledTimes(1);
    expect(io.create).toHaveBeenCalledTimes(4);
    expect(io.create.mock.calls.some((call) => call[1].id === queued[0]!.id)).toBe(false);
    expect(queue.getSnapshot().entries.find((entry) => entry.id === failed.id)?.stage).toBe(
      'failed',
    );
    queue.dismiss(failed.id);
    expect(queue.getSnapshot().unfinished).toBe(0);
  });
  it('clears unfinished captures during access loss while keeping active uploads and saves protected', async () => {
    const { queue, io } = setup();
    const gate = deferred<ItemResponse>();
    const upload = deferred<void>();
    io.create.mockReturnValue(gate.promise);
    io.upload.mockReturnValue(upload.promise);
    queue.enqueue([image(), ...notes(4)], destination);
    await settle();
    const before = queue.getSnapshot();
    const running = before.entries.filter((entry) => ['uploading', 'saving'].includes(entry.stage));
    const queued = before.entries.filter((entry) => entry.stage === 'queued');
    const states = before.entries.map(({ id, stage }) => ({ id, stage }));
    expect(running).toHaveLength(3);
    expect(queued).toHaveLength(2);
    queue.dismiss(queued[0]!.id);
    expect(queue.getSnapshot().entries.map(({ id, stage }) => ({ id, stage }))).toEqual(states);

    queue.setPermission(false);
    for (const entry of running) {
      queue.dismiss(entry.id);
    }
    expect(queue.getSnapshot().entries.map(({ id, stage }) => ({ id, stage }))).toEqual(states);
    for (const entry of queued) {
      queue.dismiss(entry.id);
    }
    expect(queue.getSnapshot()).toMatchObject({ paused: true, unfinished: 3 });
    expect(io.create).toHaveBeenCalledTimes(2);

    gate.reject(new Error('Offline'));
    upload.reject(new Error('Offline'));
    await settle();
    for (const entry of queue.getSnapshot().entries) {
      queue.dismiss(entry.id);
    }
    expect(queue.getSnapshot()).toMatchObject({ entries: [], paused: false, unfinished: 0 });
    expect(queue.enqueue(notes(1), destination)).toMatch(/access/);
    io.create.mockImplementation(async (_id, payload) => response(payload));
    queue.setPermission(true);
    expect(queue.enqueue(notes(1), destination)).toBeNull();
    await settle();
    expect(queue.getSnapshot().entries[0]?.stage).toBe('saved');
  });
  it('treats deleted sections as actionable failures without silently retargeting', async () => {
    const { queue, io } = setup();
    io.create.mockRejectedValueOnce(Object.assign(new Error('Section not found'), { status: 404 }));
    const sectionId = randomUUID();
    queue.enqueue(notes(1), { ...destination, sectionId, sectionName: 'Old section' });
    await settle();
    expect(queue.getSnapshot().entries[0]).toMatchObject({
      stage: 'failed',
      sectionId,
      retryable: false,
      error: expect.stringMatching(/another section/),
    });
    expect(queue.getSnapshot().paused).toBe(false);
  });
  it('stops queued work, aborts requests and ignores late completions on disposal', async () => {
    const { queue, io } = setup();
    const gate = deferred<ItemResponse>();
    io.create.mockReturnValue(gate.promise);
    queue.enqueue(notes(5), destination);
    queue.dispose();
    expect(io.create.mock.calls.every((call) => call[2].aborted)).toBe(true);
    gate.resolve(response(io.create.mock.calls[0]![1]));
    await settle();
    expect(io.saved).not.toHaveBeenCalled();
    expect(io.create).toHaveBeenCalledTimes(3);
  });
  it('does not begin item creation if access is lost while an upload is running', async () => {
    const { queue, io } = setup();
    const upload = deferred<void>();
    io.upload.mockReturnValue(upload.promise);
    queue.enqueue([image()], destination);
    await settle();
    queue.setPermission(false);
    upload.resolve();
    await settle();
    expect(io.create).not.toHaveBeenCalled();
    expect(queue.getSnapshot().entries[0]!.stage).toBe('failed');
  });
  it('releases saved files, keeps failures through tray changes, and clears only saved entries', async () => {
    const { queue, io } = setup();
    io.create.mockRejectedValueOnce(new Error('Offline'));
    queue.enqueue(notes(2), destination);
    await settle();
    queue.clearSaved();
    expect(queue.getSnapshot().entries).toHaveLength(1);
    expect(queue.getSnapshot().entries[0]!.source).not.toBeNull();
    expect(queue.getSnapshot().unfinished).toBe(1);
  });
});

describe('Confirmed capture cache reconciliation', () => {
  it('merges by ID in order without replacing newer content or resurrecting tombstones', () => {
    const first = response({ id: randomUUID(), kind: 'note', note: 'First', zOrder: 'a' });
    const second = response({ id: randomUUID(), kind: 'note', note: 'Second', zOrder: 'b' });
    expect(mergeCapturedItem([second], first)).toEqual([first, second]);
    expect(mergeCapturedItem([first], first)).toHaveLength(1);
    const newer = { ...first, version: 2, note: 'Edited' };
    expect(mergeCapturedItem([newer], first)).toEqual([newer]);
    expect(mergeCapturedItem([first], { ...first, deletedAt: '2026-10-07T01:00:00.000Z' })).toEqual(
      [],
    );
  });
});
