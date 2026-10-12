import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Brand } from './Brand';
import { ThemeToggle } from './Theme';

export function InfoLinks() {
  return (
    <nav aria-label="Help and policies" className="flex flex-wrap gap-4 text-sm text-muted">
      <Link to="/help" className="inline-flex min-h-11 items-center underline">
        Help & feedback
      </Link>
      <Link to="/privacy" className="inline-flex min-h-11 items-center underline">
        Privacy
      </Link>
      <Link to="/terms" className="inline-flex min-h-11 items-center underline">
        Beta terms
      </Link>
    </nav>
  );
}
export function SupportContact() {
  const email = import.meta.env.VITE_SUPPORT_EMAIL;
  return email ? (
    <a className="text-accent underline" href={`mailto:${email}`}>
      {email}
    </a>
  ) : (
    <span>the person who invited you, using your invitation conversation</span>
  );
}
export function BetaInfo({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-8 md:px-10">
      <header className="flex items-center justify-between gap-4">
        <Link to="/" aria-label="Moodboard home">
          <Brand />
        </Link>
        <ThemeToggle />
      </header>
      <Link
        to="/boards"
        className="mt-6 inline-flex min-h-11 items-center text-sm text-accent underline"
      >
        Your boards
      </Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-6 space-y-6 text-base leading-7 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-2">
        {children}
      </div>
      <footer className="mt-10 border-t border-line pt-5">
        <InfoLinks />
      </footer>
    </main>
  );
}
