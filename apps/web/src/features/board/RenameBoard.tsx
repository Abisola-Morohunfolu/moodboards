import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, Field, PrimaryButton, SecondaryButton } from '@moodboard/ui';
import { api } from '../../lib/api';
import { useApiAction } from '../../lib/hooks';

export function RenameBoard({
  boardId,
  title,
  onClose,
}: {
  boardId: string;
  title: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const perform = useApiAction();
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim() || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await perform(() => api.updateBoard(boardId, { title: value.trim() }));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['account', 'board', boardId] }),
        qc.invalidateQueries({ queryKey: ['account', 'workspace'] }),
      ]);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not rename board. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label="Rename board" onClose={onClose}>
      <h2 className="text-xl font-semibold">Rename board</h2>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field
          autoFocus
          label="Board title"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
          maxLength={200}
          disabled={busy}
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <SecondaryButton type="button" onClick={onClose} disabled={busy}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={busy || !value.trim()}>
            {busy ? 'Saving…' : 'Save title'}
          </PrimaryButton>
        </div>
      </form>
    </Dialog>
  );
}
