/*
 * Mirrors the theme preference between this device and the account (UX-01).
 *
 * Ordering is deliberate:
 *   - localStorage wins at first paint, because the boot script in index.html
 *     runs before React and before any network call. A theme that flickers on
 *     every cold start would be a poor trade for one round trip.
 *   - The stored account preference is adopted once, on first load, if it
 *     differs — that is what makes the choice follow you to a new device.
 *   - Afterwards, local changes are pushed up.
 *
 * The push goes through the outbox like any other write, so changing theme
 * offline is queued rather than lost.
 */
import { useEffect, useRef } from 'react';
import { useAuth } from '@/data/AuthProvider';
import { useUpdateSettings, useUserSettings } from '@/data/user';
import { useTheme, type ThemePref } from '@/theme/ThemeProvider';

const isPref = (v: unknown): v is ThemePref => v === 'system' || v === 'light' || v === 'dark';

export function useThemeSync(): void {
  const { session } = useAuth();
  const settings = useUserSettings();
  const update = useUpdateSettings();
  const { pref, setPref } = useTheme();
  const adopted = useRef(false);
  const lastPushed = useRef<ThemePref | null>(null);

  const remote = settings.data?.theme;

  // Adopt the account's preference once, when it first arrives.
  useEffect(() => {
    if (adopted.current || !session || settings.isPending) return;
    adopted.current = true;
    if (isPref(remote) && remote !== pref) {
      lastPushed.current = remote; // adopting is not a change to push back
      setPref(remote);
    }
  }, [session, settings.isPending, remote, pref, setPref]);

  // Push local changes up, once the initial adoption has settled.
  useEffect(() => {
    if (!adopted.current || !session) return;
    if (pref === lastPushed.current || pref === remote) return;
    lastPushed.current = pref;
    update.mutate({ theme: pref });
    // `update` is a fresh object each render; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pref, session, remote]);
}
