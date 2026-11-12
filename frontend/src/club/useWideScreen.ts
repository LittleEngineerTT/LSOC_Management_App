import { useSyncExternalStore } from 'react';

// Au-delà, le planning s’affiche en grille horaire : version ordinateur.
const WIDE = '(min-width: 901px)';

/** Écran assez large pour la version ordinateur du planning ; suit le redimensionnement.
 * Sans `matchMedia` (navigateur ancien, tests), l’écran est considéré comme large. */
export function useWideScreen(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const query = window.matchMedia(WIDE);
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(WIDE).matches : true),
  );
}
