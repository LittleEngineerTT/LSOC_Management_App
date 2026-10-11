import { useRef, type MouseEvent, type PointerEvent } from 'react';

function outsideDialog(event: MouseEvent<HTMLDialogElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return (
    event.target === event.currentTarget &&
    (event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom)
  );
}

/** Native dialog backdrop events target the dialog, as does its empty padding. */
export function useDialogBackdropDismiss(onClose: () => void) {
  const startedOutside = useRef(false);
  return {
    onPointerDown(event: PointerEvent<HTMLDialogElement>) {
      startedOutside.current = outsideDialog(event);
    },
    onClick(event: MouseEvent<HTMLDialogElement>) {
      const dismiss = startedOutside.current && outsideDialog(event);
      startedOutside.current = false;
      if (dismiss) onClose();
    },
  };
}
