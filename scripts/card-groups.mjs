const labels = { base: '经典模式', base_extra: '经典附属卡', diary: '小红帽日记' };
// Preserve the original main-page categories, then append additional groups.
const preferredOrder = ['base', 'diary', 'base_extra'];

export const validGroupId = (id) => typeof id === 'string' && /^[a-z][a-z0-9_]*$/.test(id) && id !== 'all';
export const groupLabel = (id) => Object.hasOwn(labels, id) ? labels[id] : id;
export const relatedScope = (id) => id === 'base_extra' ? 'base' : id;
export const describeGroup = (id) => ({ id, label: groupLabel(id), folder: `assets/card_${id}`, file: `data/cards/${id}.json` });
export function sortGroupIds(ids) {
  const rank = (id) => preferredOrder.includes(id) ? preferredOrder.indexOf(id) : preferredOrder.length;
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
