import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import type { WorkspaceSearchQuery } from '@moodboard/contracts';
import {
  account,
  boards,
  clients,
  contacts,
  participants,
  board,
  items,
  clientBoard,
  clientItems,
  plannerApprovals,
  clientApprovals,
  searchWorkspace,
  trashItems,
} from './api';
import { clientContext } from './client-context';

const activeInterval = (ms: number) => (document.visibilityState === 'visible' ? ms : false);
export function useApiAction() {
  const mutation = useMutation({ mutationFn: (action: () => Promise<unknown>) => action() });
  return <T>(action: () => Promise<T>): Promise<T> => mutation.mutateAsync(action) as Promise<T>;
}
export const q = {
  search: (wid: string, input: Omit<WorkspaceSearchQuery, 'cursor'>) =>
    useInfiniteQuery({
      queryKey: ['account', 'workspace', wid, 'search', input],
      queryFn: ({ pageParam, signal }) =>
        searchWorkspace(wid, { ...input, ...(pageParam ? { cursor: pageParam } : {}) }, signal),
      initialPageParam: null as string | null,
      getNextPageParam: (page) => page.nextCursor,
      enabled: !!wid && !!input.q.trim(),
      retry: false,
      refetchInterval: (query) =>
        query.state.data?.pages.some((page) =>
          page.results.some(
            (hit) =>
              hit.type === 'item' &&
              ((hit.item.kind === 'image' && hit.item.asset.status === 'pending') ||
                (hit.item.kind === 'link' && hit.item.preview.status === 'pending')),
          ),
        )
          ? activeInterval(3000)
          : false,
    }),
  trash: (bid: string) =>
    useInfiniteQuery({
      queryKey: ['account', 'board', bid, 'trash'],
      queryFn: ({ pageParam, signal }) => trashItems(bid, pageParam ?? undefined, signal),
      initialPageParam: null as string | null,
      getNextPageParam: (page) => page.nextCursor,
      retry: false,
    }),
  account: () => useQuery({ queryKey: ['account', 'me'], queryFn: account, retry: false }),
  boards: (wid: string) =>
    useQuery({
      queryKey: ['account', 'workspace', wid, 'boards'],
      queryFn: () => boards(wid),
      enabled: !!wid,
    }),
  clients: (wid: string, archived = false) =>
    useQuery({
      queryKey: ['account', 'workspace', wid, 'clients', archived],
      queryFn: () => clients(wid, archived),
      enabled: !!wid,
    }),
  contacts: (cid: string) =>
    useQuery({
      queryKey: ['account', 'client', cid, 'contacts'],
      queryFn: () => contacts(cid),
      enabled: !!cid,
    }),
  board: (bid: string) =>
    useQuery({
      queryKey: ['account', 'board', bid],
      queryFn: () => board(bid),
      refetchInterval: () => activeInterval(15000),
    }),
  items: (bid: string) =>
    useQuery({
      queryKey: ['account', 'board', bid, 'items'],
      queryFn: () => items(bid),
      refetchInterval: (query) =>
        activeInterval(
          query.state.data?.some(
            (item) =>
              (item.kind === 'image' && item.asset.status === 'pending') ||
              (item.kind === 'link' && item.preview.status === 'pending'),
          )
            ? 3000
            : 15000,
        ),
    }),
  participants: (bid: string) =>
    useQuery({
      queryKey: ['account', 'board', bid, 'participants'],
      queryFn: () => participants(bid),
    }),
  approvals: (bid: string, enabled: boolean) =>
    useQuery({
      queryKey: ['account', 'board', bid, 'approvals'],
      queryFn: ({ signal }) => plannerApprovals(bid, signal),
      enabled,
      retry: false,
      refetchInterval: () => activeInterval(15000),
    }),
  clientApprovals: (bid: string, enabled: boolean) =>
    useQuery({
      queryKey: ['client', clientContext(), bid, 'approvals'],
      queryFn: ({ signal }) => clientApprovals(signal),
      enabled,
      retry: false,
      refetchInterval: () => activeInterval(15000),
    }),
  clientBoard: (enabled = true) =>
    useQuery({
      queryKey: ['client', clientContext(), 'board'],
      queryFn: ({ signal }) => clientBoard(signal),
      enabled,
      retry: false,
      refetchInterval: () => activeInterval(15000),
    }),
  clientItems: (enabled = true) =>
    useQuery({
      queryKey: ['client', clientContext(), 'items'],
      queryFn: ({ signal }) => clientItems(signal),
      enabled,
      retry: false,
      refetchInterval: (query) =>
        activeInterval(
          query.state.data?.some(
            (item) =>
              (item.kind === 'image' && item.asset.status === 'pending') ||
              (item.kind === 'link' && item.preview.status === 'pending'),
          )
            ? 3000
            : 15000,
        ),
    }),
};
