import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { interval } from './time';
import { EntityForm, str } from './ui';

it('soumet les dates du calendrier et heures choisies avec les conversions Paris existantes', async () => {
  const save = vi.fn<(dates: ReturnType<typeof interval>) => Promise<void>>().mockResolvedValue(undefined);
  render(<EntityForm
    title="Disponibilités"
    fields={[
      { name: 'start', label: 'Du', type: 'datetime-fr', required: true },
      { name: 'end', label: 'Au', type: 'datetime-fr', required: true },
    ]}
    initial={{ start: '', end: '' }}
    onSave={async (values) => save(interval(str(values, 'start'), str(values, 'end')))}
  />);
  await userEvent.type(screen.getByLabelText('Du'), '20/10/2026');
  await userEvent.type(screen.getByLabelText('Au'), '20/10/2026');
  expect(screen.getByLabelText('Du')).toHaveValue('20/10/2026');
  expect(screen.getByLabelText('Heure de Du')).toHaveValue('00');
  await userEvent.selectOptions(screen.getByLabelText('Heure de Du'), '18');
  await userEvent.selectOptions(screen.getByLabelText('Minutes de Du'), '45');
  await userEvent.selectOptions(screen.getByLabelText('Heure de Au'), '20');
  expect(screen.getByLabelText('Du')).toBeValid();
  expect(screen.getByLabelText('Au')).toBeValid();
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ starts_at: '2026-10-20T16:45:00.000Z', ends_at: '2026-10-20T18:00:00.000Z' }));
});

it('présente en français la validation d’une date obligatoire vide', async () => {
  const save = vi.fn(async () => {});
  render(<EntityForm title="Disponibilités" fields={[{ name: 'start', label: 'Du', type: 'datetime-fr', required: true }]} initial={{ start: '' }} onSave={save} />);
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(save).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Du') as HTMLInputElement).validationMessage).toBe('Saisissez une date au format jj/mm/aaaa.');
  await userEvent.type(screen.getByLabelText('Du'), '20/10/2026');
  expect(screen.getByLabelText('Du')).toBeValid();
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
});
