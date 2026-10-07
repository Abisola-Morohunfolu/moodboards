/** The link exchange changes this generation before changing the contact cookie. */
export function clientContext(): string {
  return typeof window === 'undefined'
    ? ''
    : (localStorage.getItem('moodboard-client-context') ?? '');
}

export function changeClientContext(boardId: string | null): void {
  localStorage.setItem(
    'moodboard-client-context',
    JSON.stringify({ boardId, nonce: crypto.randomUUID() }),
  );
}
