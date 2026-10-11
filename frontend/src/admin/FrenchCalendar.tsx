import { useEffect, useId, useRef, useState } from 'react';

const months = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];
const weekdays = [
  ['lun.', 'lundi'],
  ['mar.', 'mardi'],
  ['mer.', 'mercredi'],
  ['jeu.', 'jeudi'],
  ['ven.', 'vendredi'],
  ['sam.', 'samedi'],
  ['dim.', 'dimanche'],
] as const;

const pad = (value: number) => String(value).padStart(2, '0');
const iso = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

function localToday() {
  const now = new Date();
  return iso(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Jours affichés pour un mois, semaines commençant le lundi ; null pour les cases vides. */
function monthDays(year: number, month: number) {
  const first = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = Array.from({ length: first }, () => null);
  for (let day = 1; day <= count; day += 1) cells.push(day);
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/**
 * Calendrier en français, indépendant de la langue du navigateur ou du téléphone :
 * le sélecteur natif suit toujours la langue du système.
 */
export function FrenchCalendar({
  label,
  value,
  onChange,
  disabled,
}: {
  /** Nom du champ, pour les libellés accessibles. */
  label: string;
  /** Date au format AAAA-MM-JJ, ou chaîne vide. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const today = localToday();
  const start = value || today;
  const [shown, setShown] = useState({
    year: Number(start.slice(0, 4)),
    month: Number(start.slice(5, 7)) - 1,
  });
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"], [aria-current="date"]')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function show() {
    setShown({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) - 1 });
    setOpen(true);
  }

  function close(next?: string) {
    if (next !== undefined) onChange(next);
    setOpen(false);
    toggle.current?.focus();
  }

  function move(step: number) {
    setShown(({ year, month }) => {
      const index = year * 12 + month + step;
      return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
    });
  }

  return (
    <div
      className="french-calendar"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={toggle}
        type="button"
        className="french-calendar-toggle"
        disabled={disabled}
        aria-label={`Choisir la date de ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : show())}
      >
        <span aria-hidden="true">📅</span> Choisir une date
      </button>
      {open && (
        <div className="french-calendar-panel" role="dialog" aria-labelledby={titleId}>
          <div className="french-calendar-header">
            <button type="button" aria-label="Mois précédent" onClick={() => move(-1)}>
              ‹
            </button>
            <strong id={titleId} aria-live="polite">
              {months[shown.month]} {shown.year}
            </strong>
            <button type="button" aria-label="Mois suivant" onClick={() => move(1)}>
              ›
            </button>
          </div>
          <table role="grid" aria-labelledby={titleId}>
            <thead>
              <tr>
                {weekdays.map(([short, long]) => (
                  <th key={long} scope="col" abbr={long}>
                    {short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthDays(shown.year, shown.month).map((week, index) => (
                <tr key={index}>
                  {week.map((day, column) =>
                    day === null ? (
                      <td key={column} />
                    ) : (
                      <td key={column}>
                        <button
                          type="button"
                          aria-label={`${weekdays[column]![1]} ${day} ${months[shown.month]} ${shown.year}`}
                          aria-pressed={iso(shown.year, shown.month, day) === value}
                          aria-current={
                            iso(shown.year, shown.month, day) === today ? 'date' : undefined
                          }
                          onClick={() => close(iso(shown.year, shown.month, day))}
                        >
                          {day}
                        </button>
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="french-calendar-footer">
            <button type="button" onClick={() => close('')}>
              Effacer
            </button>
            <button type="button" onClick={() => close(today)}>
              Aujourd’hui
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
