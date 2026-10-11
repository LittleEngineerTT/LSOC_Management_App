import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Confirm } from './ui';

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const onClose = vi.fn();
  const onConfirm = vi.fn(async () => {});
  render(<Confirm title="Supprimer" onClose={onClose} onConfirm={onConfirm}>Irréversible</Confirm>);
  const dialog = screen.getByRole('dialog');
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
    x: 100, y: 100, left: 100, top: 100, right: 400, bottom: 300,
    width: 300, height: 200, toJSON: () => ({}),
  });
  return { dialog, onClose, onConfirm };
}

it('ferme sur un clic du fond sans lancer la confirmation', () => {
  const { dialog, onClose, onConfirm } = setup();
  fireEvent.pointerDown(dialog, { clientX: 20, clientY: 20 });
  fireEvent.click(dialog, { clientX: 20, clientY: 20 });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

it('garde la confirmation ouverte sur son espace intérieur vide', () => {
  const { dialog, onClose } = setup();
  fireEvent.pointerDown(dialog, { clientX: 110, clientY: 110 });
  fireEvent.click(dialog, { clientX: 110, clientY: 110 });
  expect(onClose).not.toHaveBeenCalled();
});

it('garde la confirmation ouverte après un geste commencé à l’intérieur', () => {
  const { dialog, onClose } = setup();
  fireEvent.pointerDown(dialog, { clientX: 110, clientY: 110 });
  fireEvent.click(dialog, { clientX: 20, clientY: 20 });
  expect(onClose).not.toHaveBeenCalled();
});

it('permet aussi de fermer le fond pendant une confirmation en cours', () => {
  const { dialog, onClose, onConfirm } = setup();
  onConfirm.mockImplementation(() => new Promise<void>(() => {}));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
  expect(screen.getByRole('button', { name: 'Traitement…' })).toBeDisabled();
  fireEvent.pointerDown(dialog, { clientX: 20, clientY: 20 });
  fireEvent.click(dialog, { clientX: 20, clientY: 20 });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
