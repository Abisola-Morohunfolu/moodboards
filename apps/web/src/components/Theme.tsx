import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
type Theme = 'system' | 'light' | 'dark';
const ThemeContext = createContext<{ theme: Theme; cycle: () => void }>({
  theme: 'system',
  cycle: () => {},
});
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    try {
      const stored = localStorage.getItem('moodboard-theme');
      if (stored === 'light' || stored === 'dark') {
        setTheme(stored);
        document.documentElement.dataset.theme = stored;
      }
    } catch {
      /* system preference remains available without storage */
    }
  }, []);
  function cycle() {
    const next: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('moodboard-theme', next);
    } catch {
      /* session-only choice */
    }
  }
  return <ThemeContext.Provider value={{ theme, cycle }}>{children}</ThemeContext.Provider>;
}
export function ThemeToggle() {
  const { theme, cycle } = useContext(ThemeContext);
  const Icon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon;
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  return (
    <button
      type="button"
      aria-label={`Theme: ${theme}. Switch to ${next}`}
      title={`Theme: ${theme}`}
      onClick={cycle}
      className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted hover:bg-cream hover:text-ink"
    >
      <Icon size={18} strokeWidth={1.8} />
    </button>
  );
}
