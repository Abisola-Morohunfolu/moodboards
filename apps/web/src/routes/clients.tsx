import { createFileRoute, Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { EmptyState, Field, Panel, PrimaryButton, SecondaryButton, Skeleton } from '@moodboard/ui';
import { api } from '../lib/api';
import { q, useApiAction } from '../lib/hooks';

export const Route = createFileRoute('/clients')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    workspace: typeof search.workspace === 'string' ? search.workspace : '',
  }),
  component: Clients,
});

function Clients() {
  const perform = useApiAction();
  const { workspace } = Route.useSearch();
  const qc = useQueryClient();
  const me = q.account();
  const current =
    me.data?.workspaces.find((w) => w.id === workspace && w.type === 'business') ??
    me.data?.workspaces.find((w) => w.type === 'business');
  const list = q.clients(current?.id ?? '');
  const [selected, setSelected] = useState('');
  const [archived, setArchived] = useState(false);
  const archiveList = q.clients(current?.id ?? '', archived);
  const contacts = q.contacts(selected);
  const activeList = archived ? archiveList : list;
  const selectedClient = (archived ? archiveList.data : list.data)?.find((c) => c.id === selected);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await perform(fn);
      await qc.invalidateQueries({ queryKey: ['account', 'workspace', current?.id, 'clients'] });
      if (selected) {
        await qc.invalidateQueries({ queryKey: ['account', 'client', selected, 'contacts'] });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }
  async function createClient(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!current) {
      return;
    }
    const form = e.currentTarget;
    await action(async () => {
      const created = await api.createClient(current.id, String(new FormData(form).get('name')));
      setSelected(created.id);
      form.reset();
    });
  }
  async function createContact(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    await action(async () => {
      const values = new FormData(form);
      await api.createContact(
        selected,
        String(values.get('name')),
        String(values.get('email') || '') || undefined,
      );
      form.reset();
    });
  }
  if (me.isPending) {
    return <main className="p-8">Loading…</main>;
  }
  if (me.isError) {
    window.location.replace('/login');
    return null;
  }
  if (!current) {
    return (
      <EmptyState
        title="A space for client projects"
        detail="Create a studio from your boards page to organize clients and share their boards."
        action={
          <Link to="/boards" className="inline-flex min-h-11 items-center text-accent underline">
            Back to boards
          </Link>
        }
      />
    );
  }
  return (
    <main className="min-h-dvh bg-paper">
      <header className="flex items-center gap-4 border-b border-line bg-surface px-5 py-5 md:px-12">
        <Link
          to="/boards"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line"
          aria-label="Back to boards"
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Clients & contacts</h1>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-7 p-5 md:grid-cols-[1fr_1.2fr] md:p-12">
        <Panel className="p-5">
          <h2 className="text-lg font-semibold">Your clients</h2>
          <p className="mt-1 text-sm text-muted">Organize projects by client.</p>
          {current && (
            <form onSubmit={createClient} className="mt-5 flex flex-col gap-3">
              <Field label="Client name" name="name" required maxLength={100} />
              <PrimaryButton type="submit" disabled={busy}>
                <Plus size={16} /> Add client
              </PrimaryButton>
            </form>
          )}
          <label className="mt-6 flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
              className="h-5 w-5"
            />{' '}
            Show archived
          </label>
          {activeList.isPending && (
            <div role="status" aria-label="Loading clients" className="mt-3 space-y-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          )}
          {activeList.isError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              Couldn't load clients.{' '}
              <button
                type="button"
                className="min-h-11 underline"
                onClick={() => void activeList.refetch()}
              >
                Try again
              </button>
            </p>
          )}
          <div className="mt-3 space-y-2">
            {(archived ? archiveList.data : list.data)?.map((client) => (
              <button
                key={client.id}
                onClick={() => setSelected(client.id)}
                className={`flex min-h-14 w-full items-center justify-between rounded-lg px-4 text-left ${selected === client.id ? 'bg-cream font-semibold' : 'hover:bg-cream'}`}
              >
                <span>
                  {client.name}
                  {client.archivedAt && ' · archived'}
                </span>
              </button>
            ))}
          </div>
          {activeList.isSuccess && !activeList.data.length && (
            <EmptyState
              title="No clients yet"
              detail="Add a client, then attach their board and invite contacts."
            />
          )}
        </Panel>
        <Panel className="p-5">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">{selectedClient?.name ?? 'Client'}</h2>
                </div>
                {!selectedClient?.archivedAt && (
                  <SecondaryButton
                    disabled={busy}
                    onClick={() => {
                      if (confirm('Archive this client? Existing board links stay active.')) {
                        void action(async () => {
                          await api.archiveClient(selected);
                          setSelected('');
                        });
                      }
                    }}
                  >
                    Archive
                  </SecondaryButton>
                )}
              </div>
              {!selectedClient?.archivedAt && (
                <form onSubmit={createContact} className="mt-6 grid gap-3">
                  <Field label="Contact name" name="name" required maxLength={100} />
                  <Field label="Email (optional)" name="email" type="email" />
                  <PrimaryButton type="submit" disabled={busy}>
                    <Plus size={16} /> Add contact
                  </PrimaryButton>
                </form>
              )}
              <div className="mt-7 space-y-2">
                {contacts.isPending && (
                  <div role="status" aria-label="Loading contacts">
                    <Skeleton className="h-14" />
                  </div>
                )}
                {contacts.isError && (
                  <p role="alert" className="text-sm text-danger">
                    Couldn't load contacts.{' '}
                    <button
                      type="button"
                      className="min-h-11 underline"
                      onClick={() => void contacts.refetch()}
                    >
                      Try again
                    </button>
                  </p>
                )}
                {contacts.data?.map((contact) => (
                  <div
                    className="flex items-center justify-between gap-3 border-b border-line py-3"
                    key={contact.id}
                  >
                    <div>
                      <p className="font-semibold">{contact.name}</p>
                      <p className="text-xs text-muted">{contact.email ?? 'No email'}</p>
                    </div>
                    <SecondaryButton
                      disabled={busy}
                      aria-label={`Remove ${contact.name}`}
                      onClick={() => {
                        if (confirm(`Remove ${contact.name} and revoke all their board links?`)) {
                          action(() => api.removeContact(contact.id));
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </SecondaryButton>
                  </div>
                ))}
                {contacts.isSuccess && !contacts.data.length && (
                  <p className="text-sm text-muted">
                    No contacts yet. Add one to create a board link.
                  </p>
                )}
              </div>
            </>
          ) : (
            <EmptyState
              title="Choose a client"
              detail="Their contacts will appear here. A contact link can be assigned from a board's Share panel."
            />
          )}
        </Panel>
        {error && (
          <p role="alert" className="md:col-span-2 text-danger">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
