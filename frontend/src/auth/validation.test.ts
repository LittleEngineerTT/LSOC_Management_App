import { expect, it } from 'vitest';
import { validUsername } from './validation';

it('accepte un identifiant libre ou une adresse e-mail, sans exiger d’adresse', () => {
  for (const value of ['camille.volley', 'Camille+Club@Example.org', 'abc', 'a_b-c'])
    expect(validUsername(value), value).toBe(true);
  for (const value of ['ab', 'a@b@c.org', '@example.org', 'camille@', 'camille volley', 'é-lise'])
    expect(validUsername(value), value).toBe(false);
});
