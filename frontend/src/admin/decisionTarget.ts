import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Demande à examiner : celle choisie dans la liste, ou celle désignée par le lien d’une
 * notification (`?demande=…`), ouverte d’office tant qu’elle est à valider.
 */
export function useDecisionTarget<T extends { id: string; status: string }>(
  items: T[] | undefined,
) {
  const [search, setSearch] = useSearchParams();
  const [chosen, setChosen] = useState<T | null>(null);
  const requested = search.get('demande');
  const target = requested ? items?.find((item) => item.id === requested) : undefined;
  const decision = chosen ?? (target?.status === 'pending' ? target : null);
  function close() {
    setChosen(null);
    if (requested)
      setSearch(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete('demande');
          return next;
        },
        { replace: true },
      );
  }
  return {
    decision,
    open: setChosen,
    close,
    /** La demande du lien existe mais a déjà été traitée. */
    alreadyDecided: !!target && target.status !== 'pending',
  };
}
