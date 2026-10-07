import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Dialog, PrimaryButton, SecondaryButton } from '@moodboard/ui';
import type {
  BoardRole,
  ClientApproval,
  DecisionRequest,
  ItemResponse,
} from '@moodboard/contracts';
import { api, ApiError } from '../../lib/api';
import { clientContext } from '../../lib/client-context';
import { ItemCard } from './ItemCard';
import { ApprovalStatus } from './ApprovalStatus';
import { decisionAttempt } from './approvals';

type Attempts = Map<string, Readonly<DecisionRequest>>;

export function ClientReview({
  item,
  approval,
  role,
  available,
  refresh,
  close,
  attempts,
}: {
  item: ItemResponse;
  approval?: ClientApproval;
  role: BoardRole;
  available: boolean;
  refresh: () => Promise<void>;
  close: () => void;
  attempts: Attempts;
}) {
  const initialAttempt = attempts.get(item.id);
  const [comment, setComment] = useState(
    initialAttempt?.comment ?? approval?.ownDecision?.comment ?? '',
  );
  const [attempt, setAttempt] = useState(initialAttempt);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const [reviewedVersion, setReviewedVersion] = useState(item.version);
  const mounted = useRef(true);
  const context = useRef(clientContext());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && context.current === clientContext();
  const versionChanged = reviewedVersion !== item.version;
  const canDecide =
    available &&
    role === 'approver' &&
    approval?.status !== 'approved' &&
    !needsReview &&
    !versionChanged;

  async function send(status?: DecisionRequest['status']) {
    if (submitting.current || !current()) {
      return;
    }
    let payload = attempt;
    if (!payload) {
      if (!status || !canDecide) {
        return;
      }
      try {
        payload = decisionAttempt({
          id: crypto.randomUUID(),
          itemId: item.id,
          itemVersion: item.version,
          status,
          comment: comment.trim() || null,
        });
      } catch {
        setError(
          comment.trim().length > 2000
            ? 'Keep your comment to 2,000 characters.'
            : 'Tell your planner what you would like instead.',
        );
        return;
      }
    }
    const request = payload;
    attempts.set(item.id, request);
    submitting.current = true;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const result = await api.decide(request);
      if (!current()) {
        return;
      }
      attempts.delete(item.id);
      setAttempt(undefined);
      await refresh();
      if (!current()) {
        return;
      }
      setSaved(
        `Your ${result.decision.status === 'approved' ? 'approval' : result.decision.status === 'rejected' ? 'rejection' : 'swap request'} was saved for version ${request.itemVersion}.`,
      );
    } catch (cause) {
      if (!current()) {
        return;
      }
      if (cause instanceof ApiError && cause.status < 500) {
        attempts.delete(item.id);
        setAttempt(undefined);
        if (cause.status === 409) {
          setNeedsReview(true);
          setError(
            'This item or its sign-off changed. Review the refreshed item before submitting again. Your comment is still here.',
          );
        } else if (cause.status === 403) {
          setError('You can no longer decide on this item. Your access has been refreshed.');
        } else if (cause.status === 401 || cause.status === 404) {
          setError('This item or invitation is no longer available.');
        } else {
          setError(cause.message);
        }
        await refresh();
      } else {
        setAttempt(request);
        setError(
          'We could not confirm whether your decision was saved. Retry the same decision to check safely.',
        );
      }
    } finally {
      submitting.current = false;
      if (current()) {
        setBusy(false);
      }
    }
  }

  return (
    <Dialog label="Review item" variant="sheet" onClose={close}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Review item</h2>
        <button
          type="button"
          aria-label="Close review"
          className="min-h-11 min-w-11"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <ItemCard item={item} client />
      <section className="mt-6" aria-label="Board approval">
        <h3 className="text-sm font-semibold">Board approval</h3>
        {available && approval ? (
          <div className="mt-2">
            <ApprovalStatus status={approval.status} />
          </div>
        ) : (
          <p role="status" className="mt-2 text-sm text-muted">
            Approval status is refreshing or unavailable.
          </p>
        )}
        <p className="mt-2 text-sm leading-6 text-muted">
          Every current approver must approve before sign-off. Your planner's content edits start a
          new round.
        </p>
      </section>
      {available && approval?.ownDecision && (
        <section className="mt-5 border-t border-line pt-5" aria-label="Your decision">
          <h3 className="text-sm font-semibold">Your decision</h3>
          <div className="mt-2">
            <ApprovalStatus status={approval.ownDecision.status} />
          </div>
          {approval.ownDecision.comment && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
              {approval.ownDecision.comment}
            </p>
          )}
          <time dateTime={approval.ownDecision.decidedAt} className="mt-2 block text-xs text-muted">
            {new Date(approval.ownDecision.decidedAt).toLocaleString()}
          </time>
        </section>
      )}
      {saved && (
        <p role="status" className="mt-5 text-sm">
          {saved}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-5 text-sm leading-6 text-danger">
          {error}
        </p>
      )}
      {attempt ? (
        <div className="mt-5">
          <p className="text-sm text-muted">
            Retrying sends your original{' '}
            {attempt.status === 'swap_requested'
              ? 'swap request'
              : attempt.status === 'approved'
                ? 'approval'
                : 'rejection'}{' '}
            for version {attempt.itemVersion}, with the same comment.
          </p>
          <PrimaryButton
            className="mt-3"
            disabled={busy || !available || role !== 'approver'}
            onClick={() => void send()}
          >
            {busy ? 'Checking decision…' : 'Retry same decision'}
          </PrimaryButton>
        </div>
      ) : role === 'approver' && available && approval?.status !== 'approved' ? (
        <div className="mt-6 border-t border-line pt-5">
          <label className="flex flex-col gap-2 text-sm font-semibold">
            Comment{' '}
            <span className="font-normal text-muted">Required for a swap; optional otherwise.</span>
            <textarea
              aria-label="Decision comment"
              value={comment}
              disabled={busy}
              maxLength={2000}
              rows={4}
              className="border border-line bg-surface p-3 font-normal"
              onChange={(event) => {
                setComment(event.target.value);
                setSaved('');
              }}
            />
          </label>
          {(needsReview || versionChanged) && (
            <div className="mt-4">
              <p className="text-sm text-muted">
                Review the current content above before deciding on version {item.version}.
              </p>
              <SecondaryButton
                className="mt-3"
                disabled={busy}
                onClick={() => {
                  setReviewedVersion(item.version);
                  setNeedsReview(false);
                  setError('');
                  setSaved('');
                }}
              >
                I've reviewed this version
              </SecondaryButton>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <PrimaryButton disabled={busy || !canDecide} onClick={() => void send('approved')}>
              {busy ? 'Saving…' : 'Approve'}
            </PrimaryButton>
            <SecondaryButton disabled={busy || !canDecide} onClick={() => void send('rejected')}>
              Reject
            </SecondaryButton>
            <SecondaryButton
              disabled={busy || !canDecide}
              onClick={() => void send('swap_requested')}
            >
              Request swap
            </SecondaryButton>
          </div>
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted">
          {approval?.status === 'approved' && available
            ? 'This version is signed off. Your planner can edit the item to start a new round.'
            : role !== 'approver'
              ? 'You have viewing access to this board.'
              : 'Decisions are available once approval status has refreshed.'}
        </p>
      )}
    </Dialog>
  );
}
