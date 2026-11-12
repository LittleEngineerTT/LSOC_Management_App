import { useState } from 'react';
import type { Event } from '../admin/types';
import { Confirm } from '../admin/ui';
import { today } from './calendar';
import { usePlace } from './events';
import { downloadIcs, toIcs } from './ics';

/** Bouton « Exporter » du planning : les événements affichés (période et filtres), en fichier
 * agenda. Une fenêtre prévient d’abord que la copie exportée ne sera pas tenue à jour. */
export function ExportCalendar({ events }: { events: Event[] }) {
  const [open, setOpen] = useState(false);
  const place = usePlace();
  const count = events.length;
  return (
    <>
      <button
        type="button"
        className="admin-button"
        disabled={!count}
        title={count ? undefined : 'Aucun événement à exporter sur cette période'}
        onClick={() => setOpen(true)}
      >
        Exporter
      </button>
      {open && (
        <Confirm
          title="Exporter vers votre agenda"
          label="Télécharger le fichier"
          onClose={() => setOpen(false)}
          onConfirm={async () => {
            downloadIcs(
              toIcs(events, { place, origin: window.location.origin }),
              `lsoc-planning-${today()}.ics`,
            );
            setOpen(false);
          }}
        >
          <p>
            {count} événement{count > 1 ? 's' : ''} affiché{count > 1 ? 's' : ''}, avec la période
            et les filtres en cours, {count > 1 ? 'seront' : 'sera'} copié{count > 1 ? 's' : ''}{' '}
            dans un fichier agenda (.ics). Ouvrez-le sur votre téléphone ou importez-le dans votre
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
