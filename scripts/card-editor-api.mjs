import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateCards } from './validate-cards.mjs';
import { validGroupId } from './card-groups.mjs';
import { readCardStore } from './card-store.mjs';

const revision = (text) => createHash('sha256').update(text).digest('hex');

export function cardEditorApi(root) {
  const saveToken = randomUUID();
  let saving = false;
  return async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/__card-editor/cards') return next();
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
      const groupId = new URL(req.url, 'http://localhost').searchParams.get('group');
      if (!validGroupId(groupId)) return reply(400, { error: '请选择有效的卡牌分组' });
      const store = await readCardStore(root);
      const current = store.groups.find((group) => group.id === groupId);
      if (!current) return reply(404, { error: '卡牌分组不存在' });
      const file = resolve(root, current.file);
      if (req.method === 'GET') {
        return reply(200, {
          cards: current.cards, catalogCards: store.cards, revision: revision(current.text), saveToken, editorApiVersion: 3,
          groups: store.groups.map(({ id, label, folder, file }) => ({ id, label, folder, file })),
        });
      }
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
        const chunks = [];
        let byteLength = 0;
        for await (const chunk of req) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          byteLength += buffer.length;
          if (byteLength > 5 * 1024 * 1024) return reply(413, { error: '数据过大' });
          chunks.push(buffer);
        }
        // A UTF-8 character may span HTTP chunks. Decode only after reassembly.
        const body = Buffer.concat(chunks, byteLength).toString('utf8');
        let payload;
        try { payload = JSON.parse(body); }
        catch { return reply(400, { error: 'JSON 格式错误' }); }
        if (!Array.isArray(payload?.cards)) return reply(400, { error: '卡牌数据必须是数组' });
        if (payload.cards.some((card) => card?.group !== groupId)) return reply(400, { error: `只能保存 group: "${groupId}" 的卡牌，不能跨组移动记录` });
        // Use the latest sibling files for cross-file relationship validation.
        const latest = await readCardStore(root);
        const errors = validateCards([...latest.cards.filter((card) => card.group !== groupId), ...payload.cards]);
        if (errors.length) return reply(400, { error: errors.join('\n') });
        const previous = await readFile(file, 'utf8');
        if (payload.revision !== revision(previous)) return reply(409, { error: '文件已被其他程序修改，请先导出当前修改备份，再重新载入。' });
        const originalCards = JSON.parse(previous);
        if (payload.cards.length !== originalCards.length) {
          return reply(400, { error: `记录数量不一致：页面 ${payload.cards.length} 条，文件 ${originalCards.length} 条。请先导出备份，再重新载入；此次未写入文件。` });
        }
        // Names are editable metadata, never record identities.
        // Compare image multiplicities, not order, name, category, or star level.
        const imageCounts = (cards) => {
          const counts = new Map();
          for (const card of cards) counts.set(card.image, (counts.get(card.image) ?? 0) + 1);
          return counts;
        };
        const expected = imageCounts(originalCards);
        const actual = imageCounts(payload.cards);
        const changedImages = [...new Set([...expected.keys(), ...actual.keys()])]
          .filter((image) => expected.get(image) !== actual.get(image));
        if (changedImages.length) {
          return reply(400, { error: `图片记录不一致（名称和类别修改是允许的）：\n${changedImages.slice(0, 6).map((image) => `${image}：文件 ${expected.get(image) ?? 0} 条，页面 ${actual.get(image) ?? 0} 条`).join('\n')}\n请先导出备份，再重新载入；此次未写入文件。` });
        }
        if (payload.dryRun === true) return reply(200, { valid: true });
        const text = `${JSON.stringify(payload.cards, null, 2)}\n`;
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, text, { flag: 'wx' });
          if (revision(await readFile(file, 'utf8')) !== payload.revision) return reply(409, { error: '文件在保存时发生变化，请重新载入' });
          await rename(temporary, file);
        } finally { await unlink(temporary).catch(() => {}); }
        return reply(200, { revision: revision(text) });
      } finally { saving = false; }
    } catch (error) { return reply(500, { error: `无法读写卡牌文件：${error.message}` }); }
  };
}
