import { useState, type ReactNode } from 'react';
import { useAdmin } from './data';
import type { Gymnasium, Section, Team } from './types';
import { TeamSourceWarningPreference } from './SourceWarnings';
import {
  Confirm,
  Empty,
  EntityForm,
  Notice,
  PanelHeading,
  num,
  str,
  type FormField,
  type FormValues,
} from './ui';

interface CatalogConfig<T extends Section> {
  title: string;
  description: string;
  add: string;
  path: string;
  items: T[];
  fields: FormField[];
  initial: (item: T | null) => FormValues;
  payload: (values: FormValues) => object;
  describe: (item: T) => ReactNode;
}
function CatalogPanel<T extends Section>(config: CatalogConfig<T>) {
  const { api, reloadCatalog, admin } = useAdmin();
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [removing, setRemoving] = useState<T | null>(null);
  const [notice, setNotice] = useState('');
  const item = editing && editing !== 'new' ? editing : null;
  return (
    <>
      <PanelHeading
        title={config.title}
        description={admin ? config.description : 'Consultation seule.'}
      >
        {admin && (
          <button
            className="admin-button primary"
            onClick={() => {
              setEditing('new');
              setNotice('');
            }}
          >
            {config.add}
          </button>
        )}
      </PanelHeading>
      {notice && <Notice>{notice}</Notice>}
      {editing && (
        <EntityForm
          key={item?.id ?? 'new'}
          title={item ? `Modifier ${item.name}` : config.add}
          fields={config.fields}
          initial={config.initial(item)}
          submit={item ? 'Enregistrer' : 'Créer'}
          onCancel={() => setEditing(null)}
          onSave={async (values, signal) => {
            await api.request(
              item ? `${config.path}/${item.id}` : config.path,
              item ? 'PUT' : 'POST',
              config.payload(values),
              signal,
            );
            setEditing(null);
            setNotice(item ? 'Modification enregistrée.' : 'Création enregistrée.');
            reloadCatalog();
          }}
        />
      )}
      {!config.items.length ? (
        <Empty>
          {admin ? 'Aucun élément pour le moment. Commencez par une création.' : 'Aucun élément.'}
        </Empty>
      ) : (
        <div className="admin-list">
          {config.items.map((value) => (
            <article className="admin-row" key={value.id}>
              <div className="admin-row-copy">
                <h3>{value.name}</h3>
                {config.describe(value)}
              </div>
              {admin && (
                <div className="admin-actions">
                  <button
                    className="admin-button"
                    aria-label={`Modifier ${value.name}`}
                    onClick={() => {
                      setEditing(value);
                      setNotice('');
                    }}
                  >
                    Modifier
                  </button>
                  <button
                    className="admin-button danger"
                    aria-label={`Supprimer ${value.name}`}
                    onClick={() => setRemoving(value)}
                  >
                    Supprimer
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {removing && (
        <Confirm
          title={`Supprimer ${removing.name} ?`}
          label="Confirmer la suppression"
          onClose={() => setRemoving(null)}
          onConfirm={async (signal) => {
            await api.request(`${config.path}/${removing.id}`, 'DELETE', undefined, signal);
            if (item?.id === removing.id) setEditing(null);
            setNotice('Suppression effectuée.');
            reloadCatalog();
          }}
        >
          <p>
            Cette suppression est définitive. Si cet élément est encore utilisé, le serveur refusera
            la suppression ; retirez d’abord ses liens.
          </p>
        </Confirm>
      )}
    </>
  );
}
const name: FormField = { name: 'name', label: 'Nom', required: true, maxLength: 120 };
export function SectionsPanel() {
  const { catalog } = useAdmin();
  return (
    <CatalogPanel<Section>
      title="Sections"
      description="Organisez les groupes de pratique du club."
      add="Ajouter une section"
      path="/sections"
      items={catalog.sections}
      fields={[name]}
      initial={(item) => ({ name: item?.name ?? '' })}
      payload={(values) => ({ name: str(values, 'name') })}
      describe={(item) => (
        <p>{catalog.teams.filter((team) => team.section_id === item.id).length} équipe(s)</p>
      )}
    />
  );
}
export function GymnasiumsPanel() {
  const { catalog } = useAdmin();
  return (
    <CatalogPanel<Gymnasium>
      title="Gymnases"
      description="Définissez les lieux et le nombre de terrains disponibles pour les réservations."
      add="Ajouter un gymnase"
      path="/gymnasiums"
      items={catalog.gymnasiums}
      fields={[
        name,
        {
          name: 'capacity',
          label: 'Capacité en terrains',
          type: 'number',
          min: 1,
          max: 100,
          required: true,
          hint: 'Une baisse de capacité peut déclencher des alertes sur les réservations existantes.',
        },
      ]}
      initial={(item) => ({ name: item?.name ?? '', capacity: String(item?.capacity ?? 3) })}
      payload={(values) => ({ name: str(values, 'name'), capacity: num(values, 'capacity') })}
      describe={(item) => (
        <p>
          {item.capacity} terrain{item.capacity > 1 ? 's' : ''}
        </p>
      )}
    />
  );
}
export function TeamsPanel() {
  const { catalog, admin, referents } = useAdmin();
  return (
    <>
      <CatalogPanel<Team>
        title="Équipes"
        description="Rattachez les équipes aux sections et choisissez leur référent par défaut."
        add="Ajouter une équipe"
        path="/teams"
        items={catalog.teams}
        fields={[
          name,
          {
            name: 'section_id',
            label: 'Section',
            type: 'select',
            required: true,
            options: catalog.sections.map((section) => ({
              value: section.id,
              label: section.name,
            })),
          },
          {
            name: 'referent_id',
            label: 'Référent',
            type: 'select',
            options: catalog.users
              .filter((user) => user.active)
              .map((user) => ({ value: user.id, label: user.first_name })),
            hint: 'Un référent actif est requis avant d’activer une source FFVB.',
          },
        ]}
        initial={(item) => ({
          name: item?.name ?? '',
          section_id: item?.section_id ?? '',
          referent_id: item?.referent_id ?? '',
        })}
        payload={(values) => ({
          name: str(values, 'name'),
          section_id: str(values, 'section_id'),
          referent_id: str(values, 'referent_id') || null,
        })}
        describe={(item) => (
          <>
            <p>
              {catalog.sections.find((section) => section.id === item.section_id)?.name ??
                'Section introuvable'}{' '}
              · Référent :{' '}
              {catalog.users.find((user) => user.id === item.referent_id)?.first_name ??
                (item.referent_id && referents[item.referent_id]) ??
                'À attribuer'}
            </p>
            {admin && item.ffvb_source_warning_ignored && (
              <TeamSourceWarningPreference team={item} ignored />
            )}
          </>
        )}
      />
      {admin && !catalog.sections.length && (
        <p className="admin-hint">Créez une section avant d’ajouter une équipe.</p>
      )}
    </>
  );
}
