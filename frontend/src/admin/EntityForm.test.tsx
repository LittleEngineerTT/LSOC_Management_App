import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { EntityForm, shifted, type FormField } from './ui';

const schedule: FormField[] = [
  { name: 'starts_at', label: 'Début', type: 'datetime-fr', required: true },
  { name: 'ends_at', label: 'Fin', type: 'datetime-fr', required: true, after: { name: 'starts_at', minutes: 120 } },
  { name: 'note', label: 'Note' },
];

it('décale une date et heure ou une heure seule', () => {
  expect(shifted('2026-10-20T18:30', 120)).toBe('2026-10-20T20:30');
  expect(shifted('2026-12-31T23:00', 120)).toBe('2027-01-01T01:00');
  expect(shifted('18:00', 120)).toBe('20:00');
  expect(shifted('23:00', 120)).toBe('');
  expect(shifted('', 120)).toBe('');
});

it('propose la fin deux heures après le début tant qu’elle n’a pas été choisie', async () => {
  render(<EntityForm title="Événement" fields={schedule} initial={{ starts_at: '', ends_at: '', note: '' }} onSave={vi.fn()} markRequired />);
  await userEvent.type(screen.getByLabelText('Début'), '20/10/2026');
  await userEvent.selectOptions(screen.getByLabelText('Heure de Début'), '18');
  expect(screen.getByLabelText('Fin')).toHaveValue('20/10/2026');
  expect(screen.getByLabelText('Heure de Fin')).toHaveValue('20');
  // L’heure de début change : la fin proposée suit.
  await userEvent.selectOptions(screen.getByLabelText('Heure de Début'), '19');
  expect(screen.getByLabelText('Heure de Fin')).toHaveValue('21');
  // Une fin choisie à la main n’est plus modifiée.
  await userEvent.selectOptions(screen.getByLabelText('Heure de Fin'), '22');
  await userEvent.selectOptions(screen.getByLabelText('Heure de Début'), '17');
  expect(screen.getByLabelText('Heure de Fin')).toHaveValue('22');
});

it('marque d’un astérisque les champs obligatoires sur demande', () => {
  const { container } = render(<EntityForm title="Événement" fields={schedule} initial={{}} onSave={vi.fn()} markRequired />);
  expect(screen.getByText(/marqués d’un astérisque/)).toBeInTheDocument();
  expect(container.querySelector('.mark-required')).not.toBeNull();
  expect([...container.querySelectorAll('.admin-field.required')]).toHaveLength(2);
});

it('regroupe les équipes dans leurs sections dépliables', async () => {
  const save = vi.fn();
  render(
    <EntityForm
      title="Événement"
      fields={[{ name: 'section_ids', memberName: 'team_ids', label: 'Organisation', type: 'groups', all: true, groups: [
        { value: 's1', label: 'Loisir', members: [{ value: 't1', label: 'Loisir 1' }, { value: 't2', label: 'Loisir 2' }] },
        { value: 's2', label: 'Jeunes', members: [] },
      ] }]}
      initial={{ section_ids: [], team_ids: [] }}
      onSave={save}
    />,
  );
  const group = screen.getByRole('group', { name: 'Organisation' });
  const teams = within(group).getByText('2 équipes').closest('details') as HTMLElement;
  expect(teams).not.toHaveAttribute('open');
  await userEvent.click(within(group).getByText('2 équipes'));
  expect(teams).toHaveAttribute('open');
  await userEvent.click(within(teams).getByLabelText('Loisir 2'));
  expect(within(group).getByText('2 équipes · 1 cochée')).toBeInTheDocument();
  await userEvent.click(within(group).getByLabelText('Jeunes'));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(save.mock.calls[0]?.[0]).toMatchObject({ section_ids: ['s2'], team_ids: ['t2'] });
  await userEvent.click(within(group).getByLabelText('Tous'));
  expect(within(group).getByLabelText('Loisir')).toBeChecked();
  expect(within(teams).getByLabelText('Loisir 1')).toBeChecked();
});

it('ajoute l’astérisque d’un champ devenu obligatoire selon les autres valeurs', async () => {
  const { container } = render(
    <EntityForm
      title="Séance"
      fields={[
        { name: 'open', label: 'Séance ouverte', type: 'checkbox' },
        { name: 'limit', label: 'Nombre maximal d’inscrits', type: 'number', requiredWhen: (values) => values.open === true },
      ]}
      initial={{ open: false, limit: '' }}
      onSave={vi.fn()}
      markRequired
    />,
  );
  const limit = () => screen.getByLabelText('Nombre maximal d’inscrits');
  expect(container.querySelector('.admin-field.required')).toBeNull();
  expect(limit()).not.toHaveAttribute('aria-required');
  await userEvent.click(screen.getByLabelText('Séance ouverte'));
  expect(limit().closest('.admin-field')).toHaveClass('required');
  expect(limit()).toHaveAttribute('aria-required', 'true');
});
