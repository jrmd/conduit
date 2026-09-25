import { useEffect, useState } from 'react';

export type Appearance = 'system' | 'light' | 'dark';
const storageKey = 'conduit.appearance';
function readAppearance(): Appearance {
  try {
    const value = localStorage.getItem(storageKey);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
function apply(appearance: Appearance, dark: boolean) {
  const theme = appearance === 'system' ? (dark ? 'dark' : 'light') : appearance;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  return theme;
}
// Apply before React mounts so stored appearance does not flash the opposite theme.
apply(readAppearance(), systemTheme.matches);

export function useAppearance() {
  const [appearance, updateAppearance] = useState<Appearance>(readAppearance);
  const [systemDark, setSystemDark] = useState(systemTheme.matches);
  const theme = appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;
  useEffect(() => {
    const changed = () => setSystemDark(systemTheme.matches);
    systemTheme.addEventListener('change', changed);
    return () => systemTheme.removeEventListener('change', changed);
  }, []);
  useEffect(() => { apply(appearance, systemDark); }, [appearance, systemDark]);
  useEffect(() => {
    void window.j2code.setAppearance(appearance).catch(console.error);
  }, [appearance]);
  function setAppearance(value: Appearance) {
    try { localStorage.setItem(storageKey, value); } catch { /* The theme still works for this session. */ }
    apply(value, systemDark);
    updateAppearance(value);
  }
  return { appearance, theme, setAppearance };
}
