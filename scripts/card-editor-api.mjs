import { randomUUID } from 'node:crypto';
import { validateCards } from './validate-cards.mjs';
import { describeGroup, validGroupId } from './card-groups.mjs';
import { readCardStore } from './card-store.mjs';
import { performAssetAction, readAssetImage, scanCardAssets } from './card-assets.mjs';
import { commitChanges, fingerprint, jsonText, managedPath, optionalRead, problem, recoverTransactions } from './managed-files.mjs';
import { validateCardBatch } from './card-save.mjs';

const revision = (text) => fingerprint(text);

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw problem('请求数据过大', 413);
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
  catch { throw problem('JSON 格式错误'); }
}

export function cardEditorApi(root) {
  const saveToken = randomUUID();
  const ready = recoverTransactions(root);
  ready.catch(() => {}); // Errors are reported to the editor and block further writes.
  let saving = false;
  return async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!['/__card-editor/cards', '/__card-editor/assets', '/__card-editor/image'].includes(url.pathname)) return next();
    // Vite's general CORS policy must not expose the editor token to other origins.
    res.removeHeader('Access-Control-Allow-Origin');
    res.removeHeader('Access-Control-Allow-Credentials');
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        return reply(403, { error: '不允许从其他网站访问卡牌编辑接口' });
      }
      await ready;
      if (url.pathname === '/__card-editor/image') {
        if (req.method !== 'GET') return reply(405, { error: '不支持的请求方法' });
        const image = await readAssetImage(root, url.searchParams.get('path'));
        res.writeHead(200, { 'Content-Type': image.type, 'Content-Length': image.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; sandbox" });
        return res.end(image.bytes);
      }
      if (url.pathname === '/__card-editor/assets') {
        if (req.method === 'GET') {
          const snapshot = await scanCardAssets(root);
          return reply(200, { groups: snapshot.groups, assets: snapshot.assets, catalogCards: snapshot.store.cards, version: snapshot.version, saveToken });
        }
        if (req.method !== 'POST') return reply(405, { error: '不支持的请求方法' });
        if (req.headers['x-card-editor-token'] !== saveToken || !req.headers['content-type']?.startsWith('application/json')) return reply(403, { error: '保存校验失败，请通过卡牌编辑页重试' });
        if (saving) return reply(409, { error: '正在操作文件，请稍后重试' });
        saving = true;
        try { return reply(200, await performAssetAction(root, await readBody(req, 60 * 1024 * 1024))); }
        finally { saving = false; }
      }
      const groupId = url.searchParams.get('group');
      if (!validGroupId(groupId)) return reply(400, { error: '请选择有效的卡牌分组' });
      if (req.method === 'GET') {
        const snapshot = await scanCardAssets(root);
        const current = snapshot.store.groups.find((group) => group.id === groupId);
        if (!snapshot.groups.some((group) => group.id === groupId)) return reply(404, { error: '卡牌分组不存在' });
        return reply(200, {
          cards: current?.cards ?? [], catalogCards: snapshot.store.cards, revision: revision(current?.text ?? null), saveToken, editorApiVersion: 5,
          groups: snapshot.groups, assets: snapshot.assets.filter((asset) => asset.group === groupId), assetVersion: snapshot.version,
        });
      }
      const store = await readCardStore(root);
      const current = store.groups.find((group) => group.id === groupId);
      if (!current && !(await scanCardAssets(root)).groups.some((group) => group.id === groupId && group.folderExists)) return reply(404, { error: '卡牌目录不存在' });
      const relativeFile = current?.file ?? describeGroup(groupId).file;
      const file = await managedPath(root, relativeFile);
      if (req.method !== 'POST') return reply(405, { error: '不支持的请求方法' });
      // A per-server token protects writes without trusting proxy-rewritten Host,
      // Origin, forwarded headers, or the client's network address.
      if (req.headers['x-card-editor-token'] !== saveToken
        || !req.headers['content-type']?.startsWith('application/json')) {
        return reply(403, { error: '保存校验失败，请通过卡牌编辑页重试' });
      }
      if (saving) return reply(409, { error: '正在保存，请稍后重试' });
      saving = true;
      try {
        const payload = await readBody(req, 5 * 1024 * 1024);
        if (!Array.isArray(payload?.cards)) return reply(400, { error: '卡牌数据必须是数组' });
        if (payload.cards.some((card) => card?.group !== groupId)) return reply(400, { error: `只能保存 group: "${groupId}" 的卡牌，不能跨组移动记录` });
        // Use the latest sibling files for cross-file relationship validation.
        const latest = await readCardStore(root);
        const errors = validateCards([...latest.cards.filter((card) => card.group !== groupId), ...payload.cards]);
        if (errors.length) return reply(400, { error: errors.join('\n') });
        const previousBytes = await optionalRead(file);
        if (payload.revision !== revision(previousBytes)) return reply(409, { error: '文件已被其他程序修改，请先导出当前修改备份，再重新载入。' });
        const originalCards = previousBytes === null ? [] : JSON.parse(previousBytes.toString('utf8'));
        if (previousBytes === null && !payload.cards.length) return reply(400, { error: '请先添加待收录卡牌，不会创建空 JSON' });
        const newImages = await validateCardBatch(root, groupId, originalCards, payload.cards);
        if (payload.dryRun === true) return reply(200, { valid: true });
        for (const image of newImages) {
          if (fingerprint(await optionalRead(await managedPath(root, image.path))) !== fingerprint(image.bytes)) throw problem(`待收录图片已变化，请核对后重试：${image.path}`, 409);
        }
        const text = jsonText(payload.cards);
        await commitChanges(root, [{ path: relativeFile, before: previousBytes, after: Buffer.from(text) }]);
        return reply(200, { revision: revision(text), added: payload.cards.length - originalCards.length });
      } finally { saving = false; }
    } catch (error) { return reply(error.status ?? 500, { error: `无法读写卡牌文件：${error.message}` }); }
  };
}
