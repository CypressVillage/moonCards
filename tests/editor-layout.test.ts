import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

test('编辑器使用分组标题及编辑图标，状态、搜索、上传按顺序排列且不显示常驻提示', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search: '?editor&group=base' } } });
  const cache = await mkdtemp('/tmp/opencode/editor-layout-');
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), cacheDir: cache,
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [react()], server: { middlewareMode: true }, appType: 'custom',
    });
    const { CardEditor } = await server.ssrLoadModule('/src/editor.tsx');
    const html = renderToStaticMarkup(createElement(CardEditor, {
      initialCards: [
        { name: '测试卡', group: 'base', level: null, classes: [], type: '攻击', cost: null, relatedCards: [], image: 'assets/card_base/测试卡.png' },
        { name: '其他 JSON 卡牌', group: 'diary', level: null, classes: [], type: '法力', cost: 0, hidden: true, relatedCards: [], image: 'assets/card_diary/其他.png' },
      ],
      categories: [
        { id: 'base', label: '经典模式', folder: 'assets/card_base', file: 'data/cards/base.json', folderExists: true, unregistered: 3 },
        { id: 'diary', label: '小红帽日记', folder: 'assets/card_diary', file: 'data/cards/diary.json', folderExists: true, unregistered: 0 },
      ],
    }));
    assert.doesNotMatch(html, /class="editor-notice"|LOCAL CARD WORKSHOP|已读取本地/);
    assert.equal((html.match(/aria-label="修改分组显示名"/g) ?? []).length, 1);
    assert.match(html, /class="editor-group-name"><h2[^>]*>经典模式<\/h2><button/);
    const actions = html.match(/class="editor-actions">([\s\S]*?)<\/div>/)?.[1];
    assert.ok(actions);
    assert.doesNotMatch(actions, /修改分组显示名/);
    assert.match(html, /已收录记录 <strong>1<\/strong>/);
    assert.match(html, /未收录图片 <strong>3<\/strong>/);
    assert.match(html, /title="切换文件夹"/);
    const controls = html.slice(html.indexOf('class="editor-controls"'), html.indexOf('class="asset-section-heading"'));
    const state = controls.indexOf('aria-label="图片收录状态"');
    const search = controls.indexOf('aria-label="查找卡牌或图片文件名"');
    const upload = controls.indexOf('aria-label="上传本地图片到 card_base"');
    assert.ok(state >= 0 && search > state && upload > search);
    assert.match(controls, /class="asset-upload-zone compact/);
    assert.match(controls, /class="editor-visually-hidden" id="upload-help-base"/);
    assert.match(controls, /type="file"[^>]*multiple=""/);
    assert.match(html, /关联卡牌（全部分组，可多选）/);
    assert.match(html, /其他 JSON 卡牌<span title="小红帽日记">/);
  } finally {
    await server?.close();
    await rm(cache, { recursive: true, force: true });
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
