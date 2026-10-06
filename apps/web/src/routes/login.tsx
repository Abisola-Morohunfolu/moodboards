import { useState, type FormEvent } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ApiError, api } from '../lib/api';
import { Field, PrimaryButton, SecondaryButton, Panel } from '@moodboard/ui';
import { useApiAction } from '../lib/hooks';
import { Brand } from '../components/Brand';

export const Route = createFileRoute('/login')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { mode: 'login' | 'signup' } => ({
    mode: search.mode === 'signup' ? 'signup' : 'login',
  }),
  component: Login,
});

function Login() {
  const perform = useApiAction();
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    try {
      if (mode === 'signup') {
        await perform(() =>
          api.signup({ email, password, displayName: String(form.get('displayName') ?? '') }),
        );
      } else {
        await perform(() => api.login({ email, password }));
      }
      window.location.assign('/boards');
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 429
          ? cause.retryAfter
            ? `Too many attempts. Try again in ${cause.retryAfter} seconds.`
            : 'Too many attempts. Try again shortly.'
          : cause instanceof Error
            ? cause.message
            : 'Could not sign in.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <Panel className="w-full max-w-md p-7 md:p-9">
        <Link to="/" aria-label="Moodboard home">
          <Brand />
        </Link>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">
          {mode === 'signup' ? 'A home for your ideas' : 'Welcome back'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          {mode === 'signup'
            ? 'Create an account to start collecting.'
            : 'Sign in to pick up where you left off.'}
        </p>
        <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
          {mode === 'signup' && (
            <Field label="Your name" name="displayName" required maxLength={100} />
          )}
          <Field label="Email address" name="email" type="email" autoComplete="email" required />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={mode === 'signup' ? 15 : 1}
          />
          {mode === 'signup' && (
            <p className="text-xs leading-5 text-muted">
              Use at least 15 characters for your password.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <PrimaryButton disabled={busy} type="submit">
            {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </PrimaryButton>
        </form>
        <SecondaryButton
          className="mt-4 w-full"
          disabled={busy}
          onClick={() => {
            void navigate({
              to: '/login',
              search: { mode: mode === 'signup' ? 'login' : 'signup' },
            });
            setError('');
          }}
        >
          {mode === 'signup' ? 'I already have an account' : 'Create an account'}
        </SecondaryButton>
      </Panel>
    </main>
  );
}
