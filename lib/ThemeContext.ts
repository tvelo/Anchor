import React, { useEffect, useState } from 'react';
import { Appearance } from 'react-native';

export type Theme = 'dark' | 'light' | 'system';

export const DARK = {
  bg: '#0E0E12', surface: '#16161C', surfaceHigh: '#1E1E28', border: '#2A2A38',
  accent: '#C8A96E', accentSoft: 'rgba(200,169,110,0.15)',
  danger: '#E05C5C', dangerSoft: 'rgba(224,92,92,0.12)',
  textPrimary: '#F0EDE8', textSecondary: '#8A8799', textMuted: '#4A4A5A',
  white: '#FFFFFF', switchTrack: '#3A3A4A', switchThumb: '#C8A96E',
};

export const LIGHT = {
  bg: '#F5F2EE', surface: '#FFFFFF', surfaceHigh: '#F0EDE8', border: '#E0DAD2',
  accent: '#B8924A', accentSoft: 'rgba(184,146,74,0.12)',
  danger: '#D94040', dangerSoft: 'rgba(217,64,64,0.08)',
  textPrimary: '#1A1714', textSecondary: '#6B6570', textMuted: '#A09898',
  white: '#FFFFFF', switchTrack: '#D0C8C0', switchThumb: '#B8924A',
};

export type Colors = typeof DARK;

// ─── Module-level singleton ────────────────────────────────────────────────────
// Stored outside React so all components share the same value, no provider needed.
let _theme: Theme = 'dark';
const _listeners = new Set<(t: Theme) => void>();

export function resolveColors(theme: Theme): Colors {
  const sys = Appearance.getColorScheme();
  const resolved = theme === 'system' ? (sys ?? 'dark') : theme;
  return resolved === 'dark' ? DARK : LIGHT;
}

export function setGlobalTheme(t: Theme) {
  _theme = t;
  try {
    if (t === 'light') Appearance.setColorScheme('light');
    else if (t === 'dark') Appearance.setColorScheme('dark');
    else Appearance.setColorScheme(null);
  } catch {}
  // Notify every mounted component that called useTheme()
  _listeners.forEach(fn => fn(t));
}

// ─── Hook — works with OR without ThemeProvider ────────────────────────────────
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(_theme);

  useEffect(() => {
    // Always subscribe to module-level changes
    const listener = (t: Theme) => setThemeState(t);
    _listeners.add(listener);
    // Sync immediately in case theme changed before this component mounted
    setThemeState(_theme);
    return () => { _listeners.delete(listener); };
  }, []);

  return {
    theme,
    colors: resolveColors(theme),
    setTheme: setGlobalTheme,
  };
}

// ─── Optional provider — just triggers re-renders top-down as well ─────────────
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Subscribe so provider re-renders too (keeps tab bar colors in sync)
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const listener = () => forceUpdate(n => n + 1);
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);
  return React.createElement(React.Fragment, null, children);
}