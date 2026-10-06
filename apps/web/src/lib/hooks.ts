import { useMutation, useQuery } from '@tanstack/react-query';
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
} from './api';

const activeInterval = (ms: number) => (document.visibilityState === 'visible' ? ms : false);
export function useApiAction() {
  const mutation = useMutation({ mutationFn: (action: () => Promise<unknown>) => action() });
  return <T>(action: () => Promise<T>): Promise<T> => mutation.mutateAsync(action) as Promise<T>;
}
export const q = {
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
  clientBoard: () =>
    useQuery({
      queryKey: ['client', 'board'],
      queryFn: clientBoard,
      retry: false,
      refetchInterval: () => activeInterval(15000),
    }),
  clientItems: () =>
    useQuery({
      queryKey: ['client', 'items'],
      queryFn: clientItems,
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
