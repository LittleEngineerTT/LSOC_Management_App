import { useEffect, useRef, useState } from 'react';

export function useRequest() {
  const active = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => active.current?.abort(), []);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setError('');
    setPending(true);
    try {
      await action(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : 'Une erreur est survenue. Réessayez.',
        );
    } finally {
      if (!controller.signal.aborted) setPending(false);
      if (active.current === controller) active.current = null;
    }
  }

  return { pending, error, run };
}
