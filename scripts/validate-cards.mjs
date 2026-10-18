import { relatedScope, validGroupId } from './card-groups.mjs';

export const cardTypes = ['装备', '攻击', '法力', '行动', '咒术', '祷告', '反制', '特殊'];

export function validateCards(cards) {
  const errors = [];
  if (!Array.isArray(cards)) return ['卡牌 JSON 必须是数组'];
  const identities = new Set();
  const names = new Set();
  const groupVisibility = new Map();
  for (const [index, card] of cards.entries()) {
    const prefix = `第 ${index + 1} 条记录`;
    if (!card || typeof card !== 'object' || Array.isArray(card)) {
      errors.push(`${prefix} 必须是对象`);
      continue;
    }
    const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
    const stringArray = (value) => Array.isArray(value) && value.every(nonempty);
    if (!nonempty(card.name)) errors.push(`${prefix} 缺少名称`);
    if (!validGroupId(card.group)) errors.push(`${prefix} group 必须是有效分组名称`);
    if ('diary' in card) errors.push(`${prefix} 请使用 group 字段，不再使用 diary`);
    if (card.level !== null && (!Number.isInteger(card.level) || card.level < 1)) {
      errors.push(`${prefix} level 必须是正整数或 null`);
    }
    if (!stringArray(card.classes)) errors.push(`${prefix} classes 必须是字符串数组`);
    if (!cardTypes.includes(card.type)) errors.push(`${prefix} 卡牌类型必须是：${cardTypes.join('、')}`);
    if (!(card.cost === null || card.cost === 'X' ||
      (Number.isInteger(card.cost) && card.cost >= 0))) {
      errors.push(`${prefix} cost 必须是非负整数、"X" 或 null`);
    }
    if (!nonempty(card.image) || !/^assets\/[^\\?#]+\.(png|jpe?g|webp)$/i.test(card.image)
      || card.image.split('/').some((part) => part === '..' || part === '.' || part === '')) {
      errors.push(`${prefix} image 必须是 assets/ 下的图片相对路径`);
    }
    if (!stringArray(card.relatedCards)) errors.push(`${prefix} relatedCards 必须是字符串数组`);
    if (card.hidden !== undefined && typeof card.hidden !== 'boolean') errors.push(`${prefix} hidden 必须是布尔值`);
    const groupKey = JSON.stringify([card.group, card.name]);
    const identity = JSON.stringify([card.group, card.name, card.level]);
    if (identities.has(identity)) errors.push(`${prefix} 分组、名称、等级重复：${card.name}`);
    identities.add(identity);
    names.add(JSON.stringify([relatedScope(card.group), card.name]));
    if (groupVisibility.has(groupKey) && groupVisibility.get(groupKey) !== Boolean(card.hidden)) {
      errors.push(`${prefix} 同一张卡的各等级必须使用一致的 hidden`);
    }
    groupVisibility.set(groupKey, Boolean(card.hidden));
  }
  for (const card of cards) {
    if (!card || !Array.isArray(card.relatedCards)) continue;
    for (const name of card.relatedCards) {
      if (name === card.name) errors.push(`${card.name} 不需要关联自身`);
      if (!names.has(JSON.stringify([relatedScope(card.group), name]))) {
        errors.push(`${card.name} 的关联卡「${name}」在可关联分组中不存在`);
      }
    }
  }
  return errors;
}
