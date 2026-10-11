import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { FrenchDateTimeField } from './FrenchDateTimeField';

function Field({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><FrenchDateTimeField id="from" label="Du" value={value} onChange={setValue} required /><output aria-label="Valeur interne">{value}</output></>;
}

it('affiche une date française et permet de choisir séparément heures et minutes', async () => {
  render(<Field initial="2026-10-20T18:30" />);
  expect(screen.getByLabelText('Du')).toHaveValue('20/10/2026');
  expect(screen.getByLabelText('Heure de Du')).toHaveValue('18');
  expect(screen.getByLabelText('Minutes de Du')).toHaveValue('30');
  await userEvent.selectOptions(screen.getByLabelText('Heure de Du'), '21');
  await userEvent.selectOptions(screen.getByLabelText('Minutes de Du'), '45');
  expect(screen.getByLabelText('Valeur interne')).toHaveTextContent('2026-10-20T21:45');
});

it('convertit la saisie jj/mm/aaaa au format technique sans perdre l’heure', async () => {
  render(<Field />);
  await userEvent.type(screen.getByLabelText('Du'), '25/12/2026');
  await userEvent.selectOptions(screen.getByLabelText('Heure de Du'), '19');
  await userEvent.selectOptions(screen.getByLabelText('Minutes de Du'), '15');
  expect(screen.getByLabelText('Valeur interne')).toHaveTextContent('2026-12-25T19:15');
});
