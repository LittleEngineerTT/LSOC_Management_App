import { useState } from 'react';
import { useAdmin, useResource } from './data';
import type { Block, Capacity } from './types';
import { dateLabel, interval, toLocal } from './time';
import {
  Confirm,
  Empty,
  EntityForm,
  LoadState,
  Notice,
  PanelHeading,
  num,
  str,
  type FormField,
} from './ui';

export function BlocksPanel() {
  const { api, catalog } = useAdmin();
  const result = useResource<Block>('/availability-blocks', true);
  const [editing, setEditing] = useState<Block | 'new' | null>(null);
  const [removing, setRemoving] = useState<Block | null>(null);
  const [notice, setNotice] = useState('');
  const fields: FormField[] = [
    { name: 'title', label: 'Motif', required: true, maxLength: 200 },
    {
      name: 'gymnasium_id',
      label: 'Gymnase',
      type: 'select',
      required: true,
      options: catalog.gymnasiums.map((gym) => ({ value: gym.id, label: gym.name })),
    },
    { name: 'starts_at', label: 'Début (Europe/Paris)', type: 'datetime-fr', required: true },
    {
      name: 'ends_at',
      label: 'Fin (Europe/Paris)',
      type: 'datetime-fr',
      required: true,
      after: { name: 'starts_at', minutes: 120 },
    },
    {
      name: 'courts',
      label: 'Terrains indisponibles',
      type: 'number',
      min: 1,
      max: 100,
      required: true,
    },
  ];
  const item = editing && editing !== 'new' ? editing : null;
  return (
    <>
      <PanelHeading
        title="Indisponibilités"
        description="Réservez une fermeture partielle ou totale et consultez l’occupation d’un gymnase."
      >
        <button className="admin-button primary" onClick={() => setEditing('new')}>
          Ajouter une indisponibilité
        </button>
      </PanelHeading>
      <LoadState result={result} />
      {notice && <Notice>{notice}</Notice>}
      {!catalog.gymnasiums.length && <p className="admin-hint">Créez d’abord un gymnase.</p>}
      {editing && (
        <EntityForm
          key={item?.id ?? 'new'}
          title={item ? 'Modifier l’indisponibilité' : 'Nouvelle indisponibilité'}
          fields={fields}
          initial={{
            title: item?.title ?? '',
            gymnasium_id: item?.gymnasium_id ?? '',
            starts_at: toLocal(item?.starts_at),
            ends_at: toLocal(item?.ends_at),
            courts: String(item?.courts ?? 1),
          }}
          submit={item ? 'Enregistrer' : 'Créer'}
          onCancel={() => setEditing(null)}
          onSave={async (values, signal) => {
            await api.request(
              item ? `/availability-blocks/${item.id}` : '/availability-blocks',
              item ? 'PUT' : 'POST',
              {
                title: str(values, 'title'),
                gymnasium_id: str(values, 'gymnasium_id'),
                courts: num(values, 'courts'),
                ...interval(str(values, 'starts_at'), str(values, 'ends_at')),
              },
              signal,
            );
            setEditing(null);
            setNotice(
              'Indisponibilité enregistrée. Les éventuels dépassements ont été signalés aux administrateurs.',
            );
            result.reload();
          }}
        />
      )}
      {result.loaded && !result.data?.length && <Empty>Aucune indisponibilité enregistrée.</Empty>}
      <div className="admin-list">
        {result.data?.map((block) => (
          <article className="admin-row" key={block.id}>
            <div className="admin-row-copy">
              <h3>{block.title}</h3>
              <p>
                {catalog.gymnasiums.find((gym) => gym.id === block.gymnasium_id)?.name} ·{' '}
                {block.courts} terrain(s)
              </p>
              <p>
                {dateLabel(block.starts_at)} → {dateLabel(block.ends_at)}
              </p>
            </div>
            <div className="admin-actions">
              <button className="admin-button" onClick={() => setEditing(block)}>
                Modifier
              </button>
              <button className="admin-button danger" onClick={() => setRemoving(block)}>
                Supprimer
              </button>
            </div>
          </article>
        ))}
      </div>
      {removing && (
        <Confirm
          title="Supprimer cette indisponibilité ?"
          label="Confirmer la suppression"
          onClose={() => setRemoving(null)}
          onConfirm={async (signal) => {
            await api.request(`/availability-blocks/${removing.id}`, 'DELETE', undefined, signal);
            result.reload();
            if (item?.id === removing.id) setEditing(null);
          }}
        >
          <p>Les terrains réservés par « {removing.title} » redeviendront disponibles.</p>
        </Confirm>
      )}
      <Availability />
    </>
  );
}
function Availability() {
  const { api, catalog } = useAdmin();
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [gymnasiumName, setGymnasiumName] = useState('');
  return (
    <section className="admin-card">
      <EntityForm
        title="Consulter les disponibilités"
        fields={[
          {
            name: 'gymnasium_id',
            label: 'Gymnase à consulter',
            type: 'select',
            required: true,
            options: catalog.gymnasiums.map((gym) => ({ value: gym.id, label: gym.name })),
          },
          { name: 'starts_at', label: 'Du (Europe/Paris)', type: 'datetime-fr', required: true },
          {
            name: 'ends_at',
            label: 'Au (Europe/Paris)',
            type: 'datetime-fr',
            required: true,
          },
        ]}
        initial={{ gymnasium_id: '', starts_at: '', ends_at: '' }}
        submit="Consulter"
        onSave={async (values, signal) => {
          setCapacity(null);
          setGymnasiumName(
            catalog.gymnasiums.find((gym) => gym.id === str(values, 'gymnasium_id'))?.name ??
              'Gymnase',
          );
          const dates = interval(str(values, 'starts_at'), str(values, 'ends_at'));
          const query = new URLSearchParams(dates);
          setCapacity(
            await api.request<Capacity>(
              `/gymnasiums/${str(values, 'gymnasium_id')}/availability?${query}`,
              'GET',
              undefined,
              signal,
            ),
          );
        }}
      />
      {capacity && (
        <div className="admin-list">
          <h4>Disponibilités de {gymnasiumName}</h4>
          <p role="status">Capacité : {capacity.capacity} terrain(s)</p>
          {capacity.segments.map((segment) => (
            <div className="admin-row" key={segment.starts_at}>
              <div>
                <p>
                  {dateLabel(segment.starts_at)} → {dateLabel(segment.ends_at)}
                </p>
                <p>
                  {segment.occupied} occupé(s) · {segment.available} disponible(s)
                  {segment.excess > 0 && ` · Dépassement : ${segment.excess}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
