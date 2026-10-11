import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { FrenchDateField } from './FrenchDateTimeField';

function Field({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><FrenchDateField id="until" label="Fin" value={value} onChange={setValue} /><output aria-label="ISO">{value}</output></>;
}

it('affiche le calendrier en français, semaines commençant le lundi', async () => {
  render(<Field initial="2026-10-20" />);
  await userEvent.click(screen.getByRole('button', { name: 'Choisir la date de Fin' }));
  const dialog = screen.getByRole('dialog', { name: 'octobre 2026' });
  expect(within(dialog).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']);
  expect(within(dialog).getByRole('button', { name: 'mardi 20 octobre 2026' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(dialog).getByRole('button', { name: 'Effacer' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Aujourd’hui' })).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Mois suivant' }));
  expect(screen.getByRole('dialog', { name: 'novembre 2026' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'dimanche 1 novembre 2026' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Fin')).toHaveValue('01/11/2026');
  expect(screen.getByLabelText('ISO')).toHaveTextContent('2026-11-01');
});

it('efface la date et se ferme avec Échap', async () => {
  render(<Field initial="2026-10-20" />);
  await userEvent.click(screen.getByRole('button', { name: 'Choisir la date de Fin' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Choisir la date de Fin' }));
  await userEvent.click(screen.getByRole('button', { name: 'Effacer' }));
  expect(screen.getByLabelText('Fin')).toHaveValue('');
  expect(screen.getByLabelText('ISO')).toBeEmptyDOMElement();
});
