import { readdir, readFile } from 'node:fs/promises';
import { describeGroup, sortGroupIds, validGroupId } from './card-groups.mjs';
import { optionalRead, safeProjectPath } from './managed-files.mjs';

export async function readGroupSettings(root) {
  const bytes = await optionalRead(await safeProjectPath(root, 'data/groups.json'));
  if (bytes === null) return { groups: undefined, bytes };
  const groups = JSON.parse(bytes.toString('utf8'));
  const validLabel = (label) => typeof label === 'string' && label.trim().length > 0 && label.length <= 60 && !/[\x00-\x1f\x7f]/.test(label);
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)
    || Object.entries(groups).some(([id, entry]) => !validGroupId(id) || !(typeof entry === 'string' ? validLabel(entry)
      : entry && typeof entry === 'object' && !Array.isArray(entry) && validLabel(entry.label) && ['classic', 'diary'].includes(entry.mode)))) {
    throw new Error('分组配置格式错误：显示名称须为 1～60 个字符，mode 须为 classic 或 diary');
  }
  return { groups, bytes };
}

export async function readCardStore(root) {
  const directory = await safeProjectPath(root, 'data/cards');
  const { groups: settings } = await readGroupSettings(root);
  const files = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  const ids = files.map((entry) => entry.name.slice(0, -5));
  if (!ids.length) throw new Error('data/cards/ 中没有卡牌 JSON');
  if (ids.some((id) => !validGroupId(id))) throw new Error('卡牌 JSON 文件名必须是有效分组名称');
  const groups = await Promise.all(sortGroupIds(ids).map(async (id) => {
    const definition = describeGroup(id, settings);
    const text = await readFile(await safeProjectPath(root, definition.file), 'utf8');
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
