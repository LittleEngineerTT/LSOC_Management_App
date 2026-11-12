import { useState } from 'react';
import type { Event } from '../admin/types';
import { Confirm } from '../admin/ui';
import { daysBetween, nextAugust31, today } from './calendar';
import { usePlace } from './events';
import { downloadIcs, toIcs } from './ics';

/** Événements à exporter, de `first` sur `days` jours, avec les filtres en cours. */
export type ExportLoader = (first: string, days: number, signal: AbortSignal) => Promise<Event[]>;

/** Bouton « Exporter » du planning : les événements des filtres en cours, d’aujourd’hui au
 * prochain 31 août, en fichier agenda, quelle que soit la période affichée. Une fenêtre
 * prévient d’abord que la copie exportée ne sera pas tenue à jour. */
export function ExportCalendar({ load }: { load: ExportLoader }) {
  const [open, setOpen] = useState(false);
  const place = usePlace();
  const first = today();
  const last = nextAugust31(first);
  return (
    <>
      <button type="button" className="admin-button" onClick={() => setOpen(true)}>
        Exporter
      </button>
      {open && (
        <Confirm
          title="Exporter vers votre agenda"
          label="Télécharger le fichier"
          onClose={() => setOpen(false)}
          onConfirm={async (signal) => {
            const events = await load(first, daysBetween(first, last) + 1, signal);
            // Rien à exporter : la fenêtre reste ouverte et le dit.
            if (!events.length)
              throw new Error(
                'Aucun événement à exporter d’ici au 31 août avec ces filtres : modifiez-les.',
              );
            downloadIcs(
              toIcs(events, { place, origin: window.location.origin }),
              `lsoc-planning-${first}.ics`,
            );
            setOpen(false);
          }}
        >
          <p>
            Les événements correspondant aux filtres en cours, d’aujourd’hui au 31 août{' '}
            {last.slice(0, 4)}, seront copiés dans un fichier agenda (.ics), quelle que soit la
            semaine ou le mois affiché. Ouvrez-le sur votre téléphone ou importez-le dans votre
            agenda (Google Agenda, Apple Calendrier, Outlook…).
          </p>
          <p>
            <strong>Les événements exportés ne seront pas tenus à jour.</strong> Une modification,
            une annulation ou un nouvel événement n’apparaîtra pas dans votre agenda : consultez
            l’espace club pour les dernières informations, ou exportez de nouveau.
          </p>
        </Confirm>
      )}
    </>
  );
}
