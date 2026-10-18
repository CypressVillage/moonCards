export function installFocusMode(document: Document) {
  const root = document.documentElement;
  root.dataset.focusMode = 'pointer';
  const onPointer = () => { root.dataset.focusMode = 'pointer'; };
  const onKey = (event: KeyboardEvent) => {
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) root.dataset.focusMode = 'keyboard';
  };
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('keydown', onKey, true);
  return () => {
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
    delete root.dataset.focusMode;
  };
}
