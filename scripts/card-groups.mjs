import settings from '../data/groups.json' with { type: 'json' };
// Follow the configuration order, then append unconfigured groups.
const preferredOrder = Object.keys(settings);

export const validGroupId = (id) => typeof id === 'string' && /^[a-z][a-z0-9_]*$/.test(id) && id !== 'all';
export function groupLabel(id, overrides = settings) {
  const entry = Object.hasOwn(overrides, id) ? overrides[id] : undefined;
  return typeof entry === 'string' ? entry : entry?.label ?? id;
}
export function groupMode(id, overrides = settings) {
  const entry = Object.hasOwn(overrides, id) ? overrides[id] : undefined;
  return entry?.mode === 'diary' ? 'diary' : 'classic';
}
export function resolveRelatedCards(cards, sourceGroup, name) {
  const candidates = cards.filter((card) => card.name === name);
  const own = candidates.filter((card) => card.group === sourceGroup);
  if (own.length) return own;
  // Preserve existing classic/extra references when another JSON has the same name.
  const companion = sourceGroup === 'base' ? 'base_extra' : sourceGroup === 'base_extra' ? 'base' : null;
  const previous = candidates.filter((card) => card.group === companion);
  if (previous.length) return previous;
  // Names are stored as strings: choose one group, never mix different groups' levels.
  const [firstGroup] = sortGroupIds([...new Set(candidates.map((card) => card.group))]);
  return candidates.filter((card) => card.group === firstGroup);
}
export const describeGroup = (id, overrides = settings) => ({ id, label: groupLabel(id, overrides), mode: groupMode(id, overrides), folder: `assets/card_${id}`, file: `data/cards/${id}.json` });
export function sortGroupIds(ids) {
  const rank = (id) => preferredOrder.includes(id) ? preferredOrder.indexOf(id) : preferredOrder.length;
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
