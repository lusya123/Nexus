import { flushSync } from 'react-dom';
import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { THEME_STORAGE_KEY } from '../constants/tools';
import type { ThemeMode, ThemeTransitionOrigin, ThemeViewTransitionApi } from '../types/nexus';

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';

  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // Ignore localStorage access failures and fallback to system preference.
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getThemeToggleCenter(target: HTMLElement): ThemeTransitionOrigin {
  const rect = target.getBoundingClientRect();
  return {
    x: rect.left + (rect.width / 2),
    y: rect.top + (rect.height / 2)
  };
}

function getThemeTransitionRadius(origin: ThemeTransitionOrigin): number {
  const maxX = Math.max(origin.x, window.innerWidth - origin.x);
  const maxY = Math.max(origin.y, window.innerHeight - origin.y);
  return Math.hypot(maxX, maxY);
}

export function useThemeMode() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const initial = getInitialTheme();
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', initial);
    }
    return initial;
  });
  const themeToggleOriginRef = useRef<ThemeTransitionOrigin | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore localStorage failures.
    }
  }, [theme]);

  const applyThemeWithTransition = (nextTheme: ThemeMode, origin: ThemeTransitionOrigin) => {
    if (nextTheme === theme) return;

    const root = document.documentElement;
    const startViewTransition = (document as ThemeViewTransitionApi).startViewTransition?.bind(document);
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!startViewTransition || prefersReducedMotion) {
      setTheme(nextTheme);
      return;
    }

    const radius = getThemeTransitionRadius(origin);
    root.style.setProperty('--theme-transition-x', `${origin.x}px`);
    root.style.setProperty('--theme-transition-y', `${origin.y}px`);
    root.style.setProperty('--theme-transition-radius', `${radius}px`);
    root.classList.add('theme-transitioning');

    try {
      const transition = startViewTransition(() => {
        flushSync(() => {
          setTheme(nextTheme);
        });
      });

      transition.finished.finally(() => {
        root.classList.remove('theme-transitioning');
      });
    } catch {
      root.classList.remove('theme-transitioning');
      setTheme(nextTheme);
    }
  };

  const handleThemeTogglePointerDown = (event: ReactPointerEvent<HTMLInputElement>) => {
    themeToggleOriginRef.current = {
      x: event.clientX,
      y: event.clientY
    };
  };

  const handleThemeToggleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextTheme: ThemeMode = event.target.checked ? 'dark' : 'light';
    const origin = themeToggleOriginRef.current ?? getThemeToggleCenter(event.currentTarget);
    themeToggleOriginRef.current = null;
    applyThemeWithTransition(nextTheme, origin);
  };

  return {
    theme,
    handleThemeTogglePointerDown,
    handleThemeToggleChange
  };
}
