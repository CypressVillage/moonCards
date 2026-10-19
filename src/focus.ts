export function installFocusMode(document: Document) {
  const root = document.documentElement;
  root.dataset.focusMode = 'pointer';
  const onPointer = () => { root.dataset.focusMode = 'pointer'; };
  const onKey = (event: KeyboardEvent) => {
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) root.dataset.focusMode = 'keyboard';
  };
  document.addEventListener('pointerdown', onPointer, { capture: true });
  document.addEventListener('keydown', onKey, { capture: true });
  return () => {
    document.removeEventListener('pointerdown', onPointer, { capture: true });
    document.removeEventListener('keydown', onKey, { capture: true });
    delete root.dataset.focusMode;
  };
}
