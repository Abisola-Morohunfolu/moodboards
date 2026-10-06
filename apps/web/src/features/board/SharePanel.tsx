import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { X, Copy, RotateCw, UserPlus, Trash2 } from 'lucide-react';
import { Dialog, Field, PrimaryButton, SecondaryButton } from '@moodboard/ui';
import { api } from '../../lib/api';
import { q, useApiAction } from '../../lib/hooks';

export function SharePanel({
  boardId,
  clientId,
  workspaceId,
  onClose,
}: {
  boardId: string;
  clientId: string | null;
  workspaceId: string;
  onClose: () => void;
}) {
  const perform = useApiAction();
  const qc = useQueryClient();
  const clientList = q.clients(workspaceId);
  const contactList = q.contacts(clientId ?? '');
  const people = q.participants(boardId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [contactId, setContactId] = useState('');
  const [expiry, setExpiry] = useState('');
  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['account', 'board', boardId] }),
      qc.invalidateQueries({ queryKey: ['account', 'workspace', workspaceId, 'clients'] }),
      ...(clientId
        ? [qc.invalidateQueries({ queryKey: ['account', 'client', clientId, 'contacts'] })]
        : []),
    ]);
  }
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await perform(fn);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete action');
    } finally {
      setBusy(false);
    }
  }
  async function copy(pid: string, rotate = false) {
    await action(async () => {
      const result = rotate ? await api.rotate(boardId, pid) : await api.link(boardId, pid);
      await navigator.clipboard.writeText(result.url);
      setCopied(pid);
    });
  }
  async function assign(event: FormEvent) {
    event.preventDefault();
    if (!contactId) {
      return;
    }
    await action(async () => {
      const row = await api.assign(
        boardId,
        contactId,
        expiry ? new Date(expiry).toISOString() : null,
      );
      await copy(row.id);
      setContactId('');
      setExpiry('');
    });
  }
  return (
    <Dialog label="Share board" variant="sheet" onClose={onClose}>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">Share this board.</h2>
          <p className="mt-2 text-sm text-muted">
            Each contact receives a link to this board only.
          </p>
        </div>
        <button aria-label="Close sharing" onClick={onClose} className="min-h-11 min-w-11">
          <X size={20} />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-4 bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}
      {!clientId ? (
        <div className="mt-8">
          <p className="text-sm font-semibold">Choose the client for this board</p>
          <p className="mt-1 text-sm text-muted">A board can be associated with one client.</p>
          <div className="mt-4 flex gap-2">
            <select
              id="board-client"
              aria-label="Client"
              className="min-h-11 flex-1 border border-line bg-surface px-3"
              defaultValue=""
            >
              <option value="" disabled>
                Select a client
              </option>
              {clientList.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <PrimaryButton
              disabled={busy}
              onClick={() => {
                const selected = (document.getElementById('board-client') as HTMLSelectElement)
                  .value;
                if (selected) {
                  action(() => api.updateBoard(boardId, { clientId: selected }));
                }
              }}
            >
              Associate
            </PrimaryButton>
          </div>
          <a
            href={`/clients?workspace=${workspaceId}`}
            className="mt-4 inline-block text-sm text-accent underline"
          >
            Manage clients and contacts
          </a>
        </div>
      ) : (
        <>
          <div className="mt-8 border-y border-line py-5">
            <p className="text-sm font-medium text-muted">Linked client</p>
            <p className="mt-1 text-base font-semibold">
              {clientList.data?.find((c) => c.id === clientId)?.name ?? 'Client'}
            </p>
            <a href={`/clients?workspace=${workspaceId}`} className="text-sm text-accent underline">
              Manage contacts
            </a>
          </div>
          <form onSubmit={assign} className="mt-6 flex flex-col gap-3">
            <h3 className="text-base font-semibold">Invite a viewer</h3>
            <select
              aria-label="Contact"
              required
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="min-h-11 border border-line bg-surface px-3"
            >
              <option value="">Choose contact</option>
              {contactList.data?.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Field
              label="Link expires (optional)"
              type="datetime-local"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
            <PrimaryButton disabled={busy || !contactId} type="submit">
              <UserPlus size={16} /> Add and copy link
            </PrimaryButton>
          </form>
          <div className="mt-7">
            <h3 className="text-base font-semibold">People with access</h3>
            {people.isPending && <p className="mt-3 text-sm text-muted">Loading…</p>}
            {people.data
              ?.filter((p) => contactList.data?.some((c) => c.id === p.contactId))
              .map((p) => (
                <div key={p.id} className="mt-3 rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {contactList.data?.find((c) => c.id === p.contactId)?.name}
                      </p>
                      <p className="text-xs text-muted">
                        {p.revokedAt
                          ? 'Revoked'
                          : `${p.role} · ${p.expiresAt ? `Expires ${new Date(p.expiresAt).toLocaleDateString()}` : 'No expiry'}`}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {p.revokedAt ? (
                        <SecondaryButton
                          disabled={busy}
                          onClick={() => action(() => api.assign(boardId, p.contactId, null))}
                        >
                          Restore
                        </SecondaryButton>
                      ) : (
                        <>
                          <SecondaryButton
                            aria-label={`Copy link for ${p.contactId}`}
                            disabled={busy}
                            onClick={() => copy(p.id)}
                          >
                            <Copy size={15} />
                            {copied === p.id ? 'Copied' : ''}
                          </SecondaryButton>
                          <SecondaryButton
                            aria-label="Rotate link"
                            disabled={busy}
                            onClick={() => copy(p.id, true)}
                          >
                            <RotateCw size={15} />
                          </SecondaryButton>
                          <SecondaryButton
                            aria-label="Revoke access"
                            disabled={busy}
                            onClick={() => action(() => api.revoke(boardId, p.id))}
                          >
                            <Trash2 size={15} />
                          </SecondaryButton>
                        </>
                      )}
                    </div>
                  </div>
                  {!p.revokedAt && (
                    <form
                      className="mt-3 flex flex-wrap items-end gap-2 text-xs text-muted"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const value = String(
                          new FormData(event.currentTarget).get('expiresAt') ?? '',
                        );
                        void action(() =>
                          api.updateParticipant(boardId, p.id, {
                            expiresAt: value ? new Date(value).toISOString() : null,
                          }),
                        );
                      }}
                    >
                      <label className="flex min-w-0 flex-1 flex-col gap-1">
                        Expiry
                        <input
                          name="expiresAt"
                          type="datetime-local"
                          defaultValue={p.expiresAt?.slice(0, 16) ?? ''}
                          className="min-h-11 border border-line px-2"
                        />
                      </label>
                      <SecondaryButton type="submit" disabled={busy}>
                        Save
                      </SecondaryButton>
                    </form>
                  )}
                </div>
              ))}
            {people.data?.length === 0 && (
              <p className="mt-3 text-sm text-muted">No client viewers yet.</p>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
