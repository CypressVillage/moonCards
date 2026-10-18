import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describeGroup, sortGroupIds, validGroupId } from './card-groups.mjs';

export async function readCardStore(root) {
  const directory = resolve(root, 'data/cards');
  const files = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  const ids = files.map((entry) => entry.name.slice(0, -5));
  if (!ids.length) throw new Error('data/cards/ 中没有卡牌 JSON');
  if (ids.some((id) => !validGroupId(id))) throw new Error('卡牌 JSON 文件名必须是有效分组名称');
  const groups = await Promise.all(sortGroupIds(ids).map(async (id) => {
    const definition = describeGroup(id);
    const text = await readFile(resolve(root, definition.file), 'utf8');
    const cards = JSON.parse(text);
    if (!Array.isArray(cards)) throw new Error(`${definition.file} 必须是数组`);
    if (cards.some((card) => card?.group !== id)) throw new Error(`${definition.file} 的每条记录必须使用 group: "${id}"`);
    if (cards.some((card) => typeof card.image !== 'string' || !card.image.startsWith(`${definition.folder}/`))) {
      throw new Error(`${definition.file} 只能引用 ${definition.folder}/ 下的卡牌`);
    }
    return { ...definition, text, cards };
  }));
  return { groups, cards: groups.flatMap((group) => group.cards) };
}
