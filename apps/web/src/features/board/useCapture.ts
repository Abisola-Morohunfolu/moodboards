import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { type ItemResponse } from '@moodboard/contracts';
import { api } from '../../lib/api';
import { CaptureQueue, mergeCapturedItem } from './capture';

export function useCapture(boardId: string, editable: boolean) {
  const qc = useQueryClient();
  const queue = useMemo(() => {
    const itemKey = ['account', 'board', boardId, 'items'];
    const queue = new CaptureQueue(boardId, {
      presign: (id, file, signal) => api.presign(id, file.type, file.size, signal),
      upload: async (reservation, file, signal) => {
        const headers = new Headers(reservation.headers);
        headers.delete('Content-Length');
        const response = await fetch(reservation.url, {
          method: 'PUT',
          headers,
          body: file,
          signal,
        });
        if (!response.ok) {
          throw new Error('Image upload failed. Check your connection and retry.');
        }
      },
      create: (id, payload, signal) => api.createItem(id, payload, signal),
      saved: (item) => {
        void qc.cancelQueries({ queryKey: itemKey }).then(() => {
          if (!queue.isActive()) {
            return;
          }
          qc.setQueryData<ItemResponse[]>(itemKey, (items) => mergeCapturedItem(items, item));
          void qc.invalidateQueries({ queryKey: ['account', 'board', boardId] });
          void qc.invalidateQueries({
            queryKey: ['account', 'workspace'],
            predicate: (query) => query.queryKey[3] === 'search',
          });
        });
      },
      accessChanged: () => {
        void qc.invalidateQueries({ queryKey: ['account', 'board', boardId] });
        void qc.invalidateQueries({ queryKey: ['account', 'me'] });
      },
    });
    return queue;
  }, [boardId, qc]);
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  useEffect(() => {
    queue.start();
    return () => queue.dispose();
  }, [queue]);
  useEffect(() => queue.setPermission(editable), [queue, editable]);
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname && queue.getSnapshot().unfinished > 0,
    enableBeforeUnload: () => queue.getSnapshot().unfinished > 0,
    withResolver: true,
  });
  return { queue, blocker, ...snapshot };
}
