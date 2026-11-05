import type { RegistrationQuota } from '../admin/types';

/** Places réservées en cours de saisie : le nombre reste du texte jusqu’à l’enregistrement. */
export interface QuotaDraft {
  id?: string;
  section_id: string;
  position_ids: string[];
  limit: string;
}

export function quotaDrafts(quotas: RegistrationQuota[] | undefined): QuotaDraft[] {
  return (quotas ?? []).map((quota) => ({ ...quota, limit: String(quota.limit) }));
}

/** Places réservées prêtes à l’envoi ; erreur explicite sur une ligne incomplète. */
export function parseQuotas(drafts: QuotaDraft[]): RegistrationQuota[] {
  return drafts.map((draft, index) => {
    const line = drafts.length > 1 ? ` (ligne ${index + 1})` : '';
    const limit = Number(draft.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error(`Indiquez entre 1 et 1000 places réservées${line}.`);
    if (!draft.section_id) throw new Error(`Choisissez la section des places réservées${line}.`);
    if (!draft.position_ids.length)
      throw new Error(`Cochez au moins un poste pour les places réservées${line}.`);
    return {
      ...(draft.id ? { id: draft.id } : {}),
      section_id: draft.section_id,
      position_ids: draft.position_ids,
      limit,
    };
  });
}

/** Mêmes places réservées, quel que soit l’ordre des postes cochés. */
export function sameQuotas(left: RegistrationQuota[], right: RegistrationQuota[]) {
  const key = (quotas: RegistrationQuota[]) =>
    JSON.stringify(
      quotas.map((quota) => [
        quota.id ?? '',
        quota.section_id,
        [...quota.position_ids].sort(),
        quota.limit,
      ]),
    );
  return key(left) === key(right);
}

/** Lignes « N places · section · postes » ajoutées ou retirées en un clic. */
export function QuotaEditor({
  value,
  onChange,
  sections,
  positions,
}: {
  value: QuotaDraft[];
  onChange: (next: QuotaDraft[]) => void;
  sections: { id: string; name: string }[];
  positions: { id: string; name: string }[];
}) {
  const update = (index: number, patch: Partial<QuotaDraft>) =>
    onChange(value.map((draft, item) => (item === index ? { ...draft, ...patch } : draft)));
  return (
    <fieldset className="admin-choice-group club-quotas">
      <legend>Places réservées</legend>
      <p className="admin-hint">
        En plus du nombre maximal d’inscrits : chaque ligne réserve des places aux membres d’une
        section qui s’inscrivent à l’un des postes cochés. Ajoutez plusieurs lignes pour les
        cumuler.
      </p>
      {value.map((draft, index) => {
        const label = value.length > 1 ? ` ${index + 1}` : '';
        return (
          <div className="club-quota" key={draft.id ?? `new-${index}`}>
            <div className="club-quota-head">
              <label>
                Places
                <input
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={draft.limit}
                  aria-label={`Nombre de places réservées${label}`}
                  onChange={(event) => update(index, { limit: event.target.value })}
                />
              </label>
              <label>
                Section
                <select
                  value={draft.section_id}
                  aria-label={`Section des places réservées${label}`}
                  onChange={(event) => update(index, { section_id: event.target.value })}
                >
                  <option value="">Choisir…</option>
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="admin-button danger"
                onClick={() => onChange(value.filter((_, item) => item !== index))}
              >
                Retirer{label && ` la ligne${label}`}
              </button>
            </div>
            <div
              className="club-quota-positions"
              role="group"
              aria-label={`Postes des places réservées${label}`}
            >
              {positions.map((position) => (
                <label key={position.id}>
                  <input
                    type="checkbox"
                    checked={draft.position_ids.includes(position.id)}
                    onChange={(event) =>
                      update(index, {
                        position_ids: event.target.checked
                          ? [...draft.position_ids, position.id]
                          : draft.position_ids.filter((id) => id !== position.id),
                      })
                    }
                  />
                  {position.name}
                </label>
              ))}
              {!positions.length && (
                <p className="admin-hint">Aucun poste : créez-en dans l’administration.</p>
              )}
            </div>
          </div>
        );
      })}
      <div className="admin-actions">
        <button
          type="button"
          className="admin-button"
          onClick={() => onChange([...value, { section_id: '', position_ids: [], limit: '1' }])}
        >
          Ajouter des places réservées
        </button>
      </div>
    </fieldset>
  );
}
