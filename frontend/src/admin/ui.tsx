import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ErrorNotice } from '../auth/components';
import { useRequest } from '../auth/useRequest';
import { FrenchDateTimeField } from './FrenchDateTimeField';
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
    | 'datetime-local'
    | 'datetime-fr'
    | 'date'
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
}
export type FormValues = Record<string, string | boolean | string[]>;
export const str = (values: FormValues, name: string) => String(values[name] ?? '').trim();
export const num = (values: FormValues, name: string) => Number(str(values, name));
export const checked = (values: FormValues, name: string) => values[name] === true;
export const choices = (values: FormValues, name: string): string[] =>
  Array.isArray(values[name]) ? (values[name] as string[]) : [];

export function EntityForm({
  title,
  fields,
  initial,
  submit = 'Enregistrer',
  onSave,
  onCancel,
  children,
}: {
  title: string;
  fields: FormField[];
  initial: FormValues;
  submit?: string;
  onSave: (values: FormValues, signal: AbortSignal) => Promise<void>;
  onCancel?: () => void;
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
      className="admin-form"
      ref={first}
      onSubmit={(event) => {
        event.preventDefault();
        void request.run((signal) => onSave(values, signal));
      }}
    >
      <h3>{title}</h3>
      <fieldset disabled={request.pending} className="admin-fields">
        {fields.map((field) => {
          if (field.visibleWhen && values[field.visibleWhen] !== true) return null;
          const fieldId = `${id}-${field.name}`;
          const common = {
            id: fieldId,
            name: field.name,
            disabled: field.disabled,
            required: field.required,
            'aria-describedby': field.hint ? `${fieldId}-hint` : undefined,
          };
          const value = values[field.name];
          const update = (next: string | boolean | string[]) =>
            setValues((previous) => ({ ...previous, [field.name]: next }));
          if (field.type === 'choices')
            return (
              <fieldset className="admin-choice-group" key={field.name}>
                <legend>{field.label}</legend>
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
              className={`admin-field${field.type === 'checkbox' ? ' check-field' : ''}`}
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
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  label?: string;
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
          disabled={request.pending}
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
