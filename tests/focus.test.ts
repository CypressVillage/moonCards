import test from 'node:test';
import assert from 'node:assert/strict';
import { installFocusMode } from '../src/focus.ts';

test('鼠标点击隐藏焦点框，键盘操作恢复焦点框，清理后不再监听', () => {
  const events = new EventTarget();
  const root = { dataset: {} as Record<string, string> };
  const document = Object.assign(events, { documentElement: root }) as unknown as Document;
  const cleanup = installFocusMode(document);
  assert.equal(root.dataset.focusMode, 'pointer');
  const key = (value: string) => events.dispatchEvent(Object.assign(new Event('keydown'), { key: value }));
  key('Shift');
  assert.equal(root.dataset.focusMode, 'pointer');
  key('Tab');
  assert.equal(root.dataset.focusMode, 'keyboard');
  events.dispatchEvent(new Event('pointerdown'));
  assert.equal(root.dataset.focusMode, 'pointer');
  key('ArrowDown');
  assert.equal(root.dataset.focusMode, 'keyboard');
  cleanup();
  events.dispatchEvent(new Event('pointerdown'));
  key('Tab');
  assert.equal(root.dataset.focusMode, undefined);
});
