import { useRef, useState } from 'react';
import { FrenchCalendar } from './FrenchCalendar';

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year!, month! - 1, day);
  return year! > 0 && date.toISOString().slice(0, 10) === value;
}

function frenchDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '';
}

const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const quarters = ['00', '15', '30', '45'];
/** Quarts d’heure, plus la valeur actuelle si elle n’en est pas un (horaire FFVB, ancien événement). */
function minuteOptions(current: string) {
  return current && !quarters.includes(current) ? [...quarters, current].sort() : quarters;
}

/** Date seule (AAAA-MM-JJ en interne), saisie en jj/mm/aaaa ou choisie dans le calendrier. */
export function FrenchDateField({
  id,
  label,
  value,
  onChange,
  required,
  disabled,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  const [draft, setDraft] = useState<{ source: string; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const text = draft?.source === value ? draft.text : frenchDate(value);

  function choose(next: string) {
    setDraft(null);
    input.current?.setCustomValidity('');
    onChange(next);
  }

  return (
    <div className="admin-datetime-fr">
      <label htmlFor={id}>{label}</label>
      <div className="admin-date-controls">
        <input
          ref={input}
          id={id}
          type="text"
          inputMode="numeric"
          placeholder="jj/mm/aaaa"
          required={required}
          disabled={disabled}
          aria-describedby={describedBy}
          value={text}
          onInvalid={(event) => {
            if (!text)
              event.currentTarget.setCustomValidity('Saisissez une date au format jj/mm/aaaa.');
          }}
          onChange={(event) => {
            const next = event.target.value;
            const french = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(next);
            const nextDate = french ? `${french[3]}-${french[2]}-${french[1]}` : next;
            if (validDate(nextDate)) {
              choose(nextDate);
            } else {
              event.target.setCustomValidity(
                next ? 'Saisissez une date valide au format jj/mm/aaaa.' : '',
              );
              setDraft({ source: '', text: next });
              onChange('');
            }
          }}
        />
        <FrenchCalendar
          label={label}
          value={validDate(value) ? value : ''}
          onChange={choose}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

export function FrenchDateTimeField({
  id,
  label,
  value,
  onChange,
  required,
  disabled,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  // Only unfinished user input needs local state; valid values come from the parent.
  const [draft, setDraft] = useState<{ source: string; text: string } | null>(null);
  const [pendingTime, setPendingTime] = useState({ hour: '00', minute: '00' });
  const dateInput = useRef<HTMLInputElement>(null);
  const date = value.slice(0, 10);
  const hour = value ? value.slice(11, 13) : pendingTime.hour;
  const minute = value ? value.slice(14, 16) : pendingTime.minute;
  const text = draft?.source === value ? draft.text : frenchDate(value);
  const common = { disabled, 'aria-describedby': describedBy };
  const controlLabel = label.replace(/\s*\(Europe\/Paris\)$/, '');

  function chooseDate(next: string) {
    const result = next ? `${next}T${hour}:${minute}` : '';
    setPendingTime({ hour, minute });
    setDraft(null);
    dateInput.current?.setCustomValidity('');
    onChange(result);
  }

  function chooseTime(part: 'hour' | 'minute', next: string) {
    const time = { hour, minute, [part]: next };
    setPendingTime(time);
    if (value) onChange(`${date}T${time.hour}:${time.minute}`);
  }

  return (
    <div className="admin-datetime-fr">
      <label htmlFor={id}>{label}</label>
      <input
        {...common}
        ref={dateInput}
        id={id}
        type="text"
        placeholder="jj/mm/aaaa"
        required={required}
        value={text}
        onInvalid={(event) => {
          if (!text)
            event.currentTarget.setCustomValidity('Saisissez une date au format jj/mm/aaaa.');
        }}
        onChange={(event) => {
          const next = event.target.value;
          const french = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(next);
          const iso = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(next);
          const nextDate = french ? `${french[3]}-${french[2]}-${french[1]}` : iso?.[1];
          if (nextDate && validDate(nextDate)) {
            const result = `${nextDate}T${iso?.[2] ?? hour}:${iso?.[3] ?? minute}`;
            event.target.setCustomValidity('');
            setDraft(null);
            onChange(result);
          } else {
            event.target.setCustomValidity(
              next ? 'Saisissez une date valide au format jj/mm/aaaa.' : '',
            );
            setPendingTime({ hour, minute });
            setDraft({ source: '', text: next });
            onChange('');
          }
        }}
      />
      <div className="admin-datetime-controls">
        <div className="admin-datetime-calendar">
          <span>Calendrier</span>
          <FrenchCalendar
            label={controlLabel}
            value={validDate(date) ? date : ''}
            onChange={chooseDate}
            disabled={disabled}
          />
        </div>
        <label>
          <span>Heure</span>
          <select
            {...common}
            aria-label={`Heure de ${controlLabel}`}
            value={hour}
            onChange={(event) => chooseTime('hour', event.target.value)}
          >
            {hours.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Minutes</span>
          <select
            {...common}
            aria-label={`Minutes de ${controlLabel}`}
            value={minute}
            onChange={(event) => chooseTime('minute', event.target.value)}
          >
            {minuteOptions(minute).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/** Heure seule au format 24 heures (HH:MM), sans dépendre de la langue du navigateur. */
export function FrenchTimeField({
  id,
  label,
  value,
  onChange,
  required,
  disabled,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value);
  const hour = match?.[1] ?? '';
  const minute = match?.[2] ?? '';
  const common = { disabled, required, 'aria-describedby': describedBy };

  function choose(part: 'hour' | 'minute', next: string) {
    const time = { hour: hour || '00', minute: minute || '00', [part]: next };
    onChange(next ? `${time.hour}:${time.minute}` : '');
  }

  return (
    <div className="admin-datetime-fr">
      <label htmlFor={id}>{label}</label>
      <div className="admin-time-controls">
        <select
          {...common}
          id={id}
          value={hour}
          onChange={(event) => choose('hour', event.target.value)}
        >
          {!hour && <option value="">--</option>}
          {hours.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <span aria-hidden="true">h</span>
        <select
          {...common}
          aria-label={`Minutes de ${label}`}
          value={minute}
          onChange={(event) => choose('minute', event.target.value)}
        >
          {!minute && <option value="">--</option>}
          {minuteOptions(minute).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
