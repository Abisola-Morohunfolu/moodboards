import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Panel, SecondaryButton, Skeleton } from '@moodboard/ui';
import { api } from '../lib/api';
import { clientContext, changeClientContext } from '../lib/client-context';
import { Brand } from '../components/Brand';

export const Route = createFileRoute('/share/$token')({
  ssr: false,
  head: () => ({
    meta: [
      { name: 'referrer', content: 'no-referrer' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  component: ShareEntry,
});

function ShareEntry() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    changeClientContext(null);
    const context = clientContext();
    const controller = new AbortController();
    void qc.cancelQueries({ queryKey: ['client'] });
    qc.removeQueries({ queryKey: ['client'] });
    api
      .exchange(token, controller.signal)
      .then((result) => {
        if (!active || context !== clientContext()) {
          return;
        }
        qc.removeQueries({ queryKey: ['client'] });
        changeClientContext(result.board.id);
        window.location.replace(`/client/boards/${result.board.id}`);
      })
      .catch(() => {
        if (active) {
          setError(
            'This link has expired or is no longer available. Ask your planner for a new link.',
          );
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [token, qc]);
  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <Panel className="max-w-md p-8 text-center">
        <Brand />
        <h1 className="mt-4 text-2xl font-semibold">Opening your board</h1>
        {error ? (
          <>
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
            <SecondaryButton className="mt-6" onClick={() => window.location.reload()}>
              Try again
            </SecondaryButton>
          </>
        ) : (
          <div role="status" className="mt-5 space-y-3">
            <Skeleton className="h-4 w-full" />
            <p className="text-sm text-muted">Checking your invitation…</p>
          </div>
        )}
      </Panel>
    </main>
  );
}
