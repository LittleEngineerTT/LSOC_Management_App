import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { FrenchDateTimeField } from './FrenchDateTimeField';

function Field({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><FrenchDateTimeField id="start" label="Du" value={value} onChange={setValue} required /><output aria-label="ISO">{value}</output></>;
}

it('accepte une saisie ISO complète puis affiche le jour en français', async () => {
  render(<Field />);
  await userEvent.type(screen.getByLabelText('Du'), '2026-10-20T18:30');
  expect(screen.getByLabelText('Du')).toHaveValue('20/10/2026');
  expect(screen.getByLabelText('ISO')).toHaveTextContent('2026-10-20T18:30');
});

it('conserve l’heure choisie avant la date et propose tous les horaires', async () => {
  render(<Field />);
  expect(screen.getByLabelText('Heure de Du').querySelectorAll('option')).toHaveLength(24);
  expect(screen.getByLabelText('Minutes de Du').querySelectorAll('option')).toHaveLength(60);
  await userEvent.selectOptions(screen.getByLabelText('Heure de Du'), '23');
  await userEvent.selectOptions(screen.getByLabelText('Minutes de Du'), '59');
  await userEvent.type(screen.getByLabelText('Du'), '31/12/2026');
  expect(screen.getByLabelText('Du')).toHaveValue('31/12/2026');
  expect(screen.getByLabelText('ISO')).toHaveTextContent('2026-12-31T23:59');
});

it('refuse un jour inexistant et conserve les changements d’heure pour la validation Paris', async () => {
  render(<Field initial="2026-03-29T02:30" />);
  expect(screen.getByLabelText('ISO')).toHaveTextContent('2026-03-29T02:30');
  await userEvent.clear(screen.getByLabelText('Du'));
  await userEvent.type(screen.getByLabelText('Du'), '31/02/2026');
  expect(screen.getByLabelText('Du')).toBeInvalid();
  expect(screen.getByLabelText('ISO')).toBeEmptyDOMElement();
});
