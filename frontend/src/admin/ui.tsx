import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { FrenchDateField, FrenchDateTimeField, FrenchTimeField } from './FrenchDateTimeField';
import { useDialogBackdropDismiss } from '../app/useDialogBackdropDismiss';

export interface Option {
  value: string;
  label: string;
}
export interface FormField {
  name: string;
  label: string;
  type?:
    | 'text'
    | 'number'
    | 'select'
    | 'checkbox'
    | 'choices'
    | 'groups'
    | 'datetime-fr'
    | 'date'
    | 'time'
    | 'textarea';
  options?: Option[];
  required?: boolean;
  min?: number | string;
  max?: number | string;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  hint?: string;
  disabled?: boolean;
  /** Nom d’une case à cocher : le champ n’apparaît que lorsqu’elle est cochée. */
  visibleWhen?: string;
  /** Nom d’une case à cocher : le champ disparaît lorsqu’elle est cochée. */
  hiddenWhen?: string;
  /** Choix multiples : case « Tous » qui coche ou décoche toutes les options. */
  all?: boolean;
  /** Groupes (`groups`) : chaque groupe se coche (valeurs de `name`) et se déplie sur ses
   * membres (valeurs de `memberName`), par exemple une section et ses équipes. */
  groups?: (Option & { members: Option[] })[];
  memberName?: string;
  /** Valeur par défaut : le champ `name` décalé de `minutes` (date et heure, ou heure), tant
   * que ce champ est vide ou garde la valeur calculée précédemment. */
  after?: { name: string; minutes: number };
  /** Obligatoire selon les autres valeurs : astérisque et `aria-required` ; le contrôle reste
   * dans `onSave`, avec un message explicite. */
  requiredWhen?: (values: FormValues) => boolean;
}

/** « 2026-10-18T18:00 » ou « 18:00 » décalé de `minutes` ; vide si l’heure sort de la journée. */
export function shifted(value: string, minutes: number): string {
  const time = /^(?:(\d{4})-(\d{2})-(\d{2})T)?(\d{2}):(\d{2})$/.exec(value);
  if (!time) return '';
  const [, year, month, day, hour, minute] = time;
  const total = Number(hour) * 60 + Number(minute) + minutes;
  const pad = (number: number) => String(number).padStart(2, '0');
  const clock = (count: number) => `${pad(Math.floor(count / 60) % 24)}:${pad(count % 60)}`;
  if (!year) return total < 24 * 60 ? clock(total) : '';
  // Calcul en UTC sur la date locale : aucun changement d’heure ne s’y glisse.
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  date.setUTCDate(date.getUTCDate() + Math.floor(total / (24 * 60)));
  const iso = date.toISOString().slice(0, 10);
  return `${iso}T${clock(total % (24 * 60))}`;
}

/** Applique les valeurs par défaut des champs qui suivent `changed`. */
function followers(
  fields: FormField[],
  previous: FormValues,
  next: FormValues,
  changed: string,
): FormValues {
  const result = { ...next };
  for (const field of fields) {
    if (field.after?.name !== changed) continue;
    const current = String(previous[field.name] ?? '');
    const expected = shifted(String(previous[changed] ?? ''), field.after.minutes);
    if (!current || current === expected)
      result[field.name] = shifted(String(next[changed] ?? ''), field.after.minutes);
  }
  return result;
}

const list = (value: FormValues[string] | undefined) => (Array.isArray(value) ? value : []);
const toggle = (items: string[], item: string, on: boolean) =>
  on ? [...items.filter((value) => value !== item), item] : items.filter((value) => value !== item);

/** Groupes cochables, dépliables sur leurs membres cochables ; « Tous » coche l’ensemble. */
function GroupChoices({
  field,
  values,
  onChange,
}: {
  field: FormField;
  values: FormValues;
  onChange: (name: string, next: string[]) => void;
}) {
  const groups = field.groups ?? [];
  const memberName = field.memberName ?? `${field.name}_members`;
  const chosen = list(values[field.name]);
  const members = list(values[memberName]);
  const everyMember = groups.flatMap((group) => group.members.map((member) => member.value));
  const all =
    groups.every((group) => chosen.includes(group.value)) &&
    everyMember.every((member) => members.includes(member));
  return (
    <fieldset className="admin-choice-group admin-groups">
      <legend>{field.label}</legend>
      {field.all && groups.length + everyMember.length > 1 && (
        <label>
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => {
              onChange(field.name, event.target.checked ? groups.map((group) => group.value) : []);
              onChange(memberName, event.target.checked ? everyMember : []);
            }}
          />
          Tous
        </label>
      )}
      {groups.map((group) => {
        const picked = group.members.filter((member) => members.includes(member.value)).length;
        return (
          <div className="admin-group" key={group.value}>
            <label>
              <input
                type="checkbox"
                checked={chosen.includes(group.value)}
                onChange={(event) =>
                  onChange(field.name, toggle(chosen, group.value, event.target.checked))
                }
              />
              {group.label}
            </label>
            {group.members.length > 0 && (
              <details>
                <summary aria-label={`Équipes de ${group.label}`}>
                  {group.members.length} équipe{group.members.length > 1 ? 's' : ''}
                  {picked > 0 && ` · ${picked} cochée${picked > 1 ? 's' : ''}`}
                </summary>
                {group.members.map((member) => (
                  <label key={member.value}>
                    <input
                      type="checkbox"
                      checked={members.includes(member.value)}
                      onChange={(event) =>
                        onChange(memberName, toggle(members, member.value, event.target.checked))
                      }
                    />
                    {member.label}
                  </label>
                ))}
              </details>
            )}
          </div>
        );
      })}
      {field.hint && <p className="admin-hint">{field.hint}</p>}
    </fieldset>
  );
}
export type FormValues = Record<string, string | boolean | string[]>;
export const str = (values: FormValues, name: string) => String(values[name] ?? '').trim();
export const num = (values: FormValues, name: string) => Number(str(values, name));
export const checked = (values: FormValues, name: string) => values[name] === true;
export const choices = (values: FormValues, name: string): string[] =>
  Array.isArray(values[name]) ? (values[name] as string[]) : [];

/** « n° 7 · Passeur » : numéro et poste d’un joueur, vide sans l’un ni l’autre. */
export function playerDetails(
  assignment: { number?: number | null; position_id?: string | null },
  positions: { id: string; name: string }[],
) {
  return [
    assignment.number != null && `n° ${assignment.number}`,
    positions.find((position) => position.id === assignment.position_id)?.name,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function EntityForm({
  title,
  fields,
  initial,
  submit = 'Enregistrer',
  onSave,
  onCancel,
  markRequired = false,
  children,
}: {
  title: string;
  fields: FormField[];
  initial: FormValues;
  submit?: string;
  onSave: (values: FormValues, signal: AbortSignal) => Promise<void>;
  onCancel?: () => void;
  /** Astérisque après le libellé des champs obligatoires. */
  markRequired?: boolean;
  children?: ReactNode;
}) {
  const [values, setValues] = useState(initial);
  const request = useRequest();
  const id = useId();
  const first = useRef<HTMLFormElement>(null);
  useEffect(() => {
    first.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
  }, []);
  return (
    <form
      className={`admin-form${markRequired ? ' mark-required' : ''}`}
      ref={first}
      onSubmit={(event) => {
        event.preventDefault();
        void request.run((signal) => onSave(values, signal));
      }}
    >
      <h3>{title}</h3>
      {markRequired && (
        <p className="admin-hint">Les champs marqués d’un astérisque (*) sont obligatoires.</p>
      )}
      <fieldset disabled={request.pending} className="admin-fields">
        {fields.map((field) => {
          if (field.visibleWhen && values[field.visibleWhen] !== true) return null;
          if (field.hiddenWhen && values[field.hiddenWhen] === true) return null;
          const fieldId = `${id}-${field.name}`;
          const required = field.required || !!field.requiredWhen?.(values);
          const common = {
            id: fieldId,
            name: field.name,
            disabled: field.disabled,
            required: field.required,
            'aria-required': required || undefined,
            'aria-describedby': field.hint ? `${fieldId}-hint` : undefined,
          };
          const value = values[field.name];
          const update = (next: string | boolean | string[]) =>
            setValues((previous) =>
              followers(fields, previous, { ...previous, [field.name]: next }, field.name),
            );
          if (field.type === 'groups')
            return (
              <GroupChoices
                key={field.name}
                field={field}
                values={values}
                onChange={(name, next) => setValues((previous) => ({ ...previous, [name]: next }))}
              />
            );
          if (field.type === 'choices')
            return (
              <fieldset className="admin-choice-group" key={field.name}>
                <legend>{field.label}</legend>
                {field.all && field.options && field.options.length > 1 && (
                  <label>
                    <input
                      type="checkbox"
                      checked={
                        Array.isArray(value) &&
                        field.options.every((option) => value.includes(option.value))
                      }
                      onChange={(event) =>
                        update(
                          event.target.checked
                            ? (field.options ?? []).map((option) => option.value)
                            : [],
                        )
                      }
                    />
                    Tous
                  </label>
                )}
                {field.options?.map((option) => (
                  <label key={option.value}>
                    <input
                      type="checkbox"
                      checked={Array.isArray(value) && value.includes(option.value)}
                      onChange={(event) =>
                        update(
                          event.target.checked
                            ? [...(Array.isArray(value) ? value : []), option.value]
                            : (Array.isArray(value) ? value : []).filter(
                                (item) => item !== option.value,
                              ),
                        )
                      }
                    />
                    {option.label}
                  </label>
                ))}
                {field.hint && <p className="admin-hint">{field.hint}</p>}
              </fieldset>
            );
          return (
            <div
              className={`admin-field${field.type === 'checkbox' ? ' check-field' : ''}${required ? ' required' : ''}`}
              key={field.name}
            >
              {field.type === 'checkbox' ? (
                <label htmlFor={fieldId}>
                  <input
                    {...common}
                    type="checkbox"
                    checked={value === true}
                    onChange={(event) => update(event.target.checked)}
                  />
                  {field.label}
                </label>
              ) : field.type === 'datetime-fr' ? (
                <FrenchDateTimeField
                  id={fieldId}
                  label={field.label}
                  value={String(value ?? '')}
                  onChange={update}
                  required={field.required}
                  disabled={field.disabled}
                  describedBy={common['aria-describedby']}
                />
              ) : field.type === 'date' ? (
                <FrenchDateField
                  id={fieldId}
                  label={field.label}
                  value={String(value ?? '')}
                  onChange={update}
                  required={field.required}
                  disabled={field.disabled}
                  describedBy={common['aria-describedby']}
                />
              ) : field.type === 'time' ? (
                <FrenchTimeField
                  id={fieldId}
                  label={field.label}
                  value={String(value ?? '')}
                  onChange={update}
                  required={field.required}
                  disabled={field.disabled}
                  describedBy={common['aria-describedby']}
                />
              ) : (
                <>
                  <label htmlFor={fieldId}>{field.label}</label>
                  {field.type === 'select' ? (
                    <select
                      {...common}
                      value={String(value ?? '')}
                      onChange={(event) => update(event.target.value)}
                    >
                      <option value="">Choisir…</option>
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      {...common}
                      value={String(value ?? '')}
                      maxLength={field.maxLength}
                      onChange={(event) => update(event.target.value)}
                    />
                  ) : (
                    <input
                      {...common}
                      type={field.type ?? 'text'}
                      value={String(value ?? '')}
                      min={field.min}
                      max={field.max}
                      maxLength={field.maxLength}
                      minLength={field.minLength}
                      pattern={field.pattern}
                      step={field.type === 'number' ? 1 : undefined}
                      onChange={(event) => update(event.target.value)}
                    />
                  )}
                </>
              )}
              {field.hint && (
                <p className="admin-hint" id={`${fieldId}-hint`}>
                  {field.hint}
                </p>
              )}
            </div>
          );
        })}
        {children}
      </fieldset>
      <ErrorNotice message={request.error} />
      <div className="admin-actions">
        <button className="admin-button primary" type="submit" disabled={request.pending}>
          {request.pending ? 'Enregistrement…' : submit}
        </button>
        {onCancel && (
          <button
            className="admin-button"
            type="button"
            disabled={request.pending}
            onClick={onCancel}
          >
            Annuler
          </button>
        )}
      </div>
    </form>
  );
}

export function Confirm({
  title,
  children,
  label = 'Confirmer',
  disabled = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  label?: string;
  /** Confirmation bloquée tant qu’une condition (case cochée…) n’est pas remplie. */
  disabled?: boolean;
  onConfirm: (signal: AbortSignal) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropDismiss = useDialogBackdropDismiss(onClose);
  const request = useRequest();
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      {...backdropDismiss}
      className="admin-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        if (request.pending) event.preventDefault();
        else onClose();
      }}
    >
      <h3 id={id}>{title}</h3>
      <div className="admin-dialog-copy">{children}</div>
      <ErrorNotice message={request.error} />
      <div className="admin-actions">
        <button
          type="button"
          className="admin-button"
          autoFocus
          disabled={request.pending}
          onClick={onClose}
        >
          Annuler
        </button>
        <button
          type="button"
          className="admin-button danger"
          disabled={request.pending || disabled}
          onClick={() => {
            void request.run(async (signal) => {
              await onConfirm(signal);
              if (!signal.aborted) onClose();
            });
          }}
        >
          {request.pending ? 'Traitement…' : label}
        </button>
      </div>
    </dialog>
  );
}

export function PanelHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="admin-panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="admin-empty">{children}</p>;
}
export function LoadState({
  result,
}: {
  result: { loaded: boolean; error?: string; reload: () => void };
}) {
  return (
    <>
      {!result.loaded && (
        <p className="admin-loading" role="status">
          Chargement…
        </p>
      )}
      {result.error && (
        <div className="admin-notice" role="alert">
          {result.error}
          <button className="admin-button" onClick={result.reload}>
            Réessayer
          </button>
        </div>
      )}
    </>
  );
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`admin-badge ${tone}`}>{children}</span>;
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="admin-success" role="status">
      {children}
    </p>
  );
}
