// @ts-expect-error Shared browser/Node group definitions are plain JavaScript.
import { resolveRelatedCards } from '../scripts/card-groups.mjs';

export interface Card {
  name: string;
  group: string;
  level: number | null;
  classes: string[];
  type: string;
  cost: number | 'X' | null;
  image: string;
  relatedCards: string[];
  hidden?: boolean;
}

export interface Filters {
  query: string;
  group: string | string[];
  profession: string;
  type: string;
  cost: string;
  level: string;
  showHidden: boolean;
}

export interface CardGroup {
  key: string;
  name: string;
  group: string;
  cards: Card[];
  matches: Card[];
}

export const emptyFilters: Filters = {
  query: '', group: 'all', profession: '', type: '', cost: '', level: '', showHidden: false,
};

export { professionOrder } from './professions.ts';

export const groupKey = (card: Pick<Card, 'group' | 'name' | 'type'>) => JSON.stringify([card.group, card.name, card.type]);
export const recordKey = (card: Card) => JSON.stringify([card.image, card.level]);

export const selectedGroups = (filters: Filters): string[] => filters.group === 'all'
  ? [] : typeof filters.group === 'string' ? [filters.group] : filters.group;

export function relatedVariants(cards: Card[], source: Pick<Card, 'group'>, name: string): Card[] {
  return resolveRelatedCards(cards, source.group, name);
}
export const sortLevels = (cards: Card[]) => [...cards].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
export const highestLevel = (cards: Card[]) => sortLevels(cards).at(-1)!;
export const levelLabel = (level: number | null) => level === null ? '无星级' : `${level} 星`;
export const costLabel = (cost: Card['cost']) => cost === null ? '无能耗' : `${cost} 费`;

export function matchesCard(card: Card, filters: Filters) {
  const query = filters.query.trim().toLocaleLowerCase();
  return (!query || card.name.toLocaleLowerCase().includes(query))
    && (selectedGroups(filters).length === 0 || selectedGroups(filters).includes(card.group))
    && (!filters.profession || (filters.profession === '__unknown'
      ? card.classes.length === 0 : card.classes.includes(filters.profession)))
    && (!filters.type || card.type === filters.type)
    && (!filters.cost || String(card.cost) === filters.cost)
    && (!filters.level || String(card.level) === filters.level);
}

export function filterGroups(cards: Card[], filters: Filters): CardGroup[] {
  // Ambiguous same-level images must remain separate, not hide one another.
  const levels = new Map<string, Set<Card['level']>>();
  const separate = new Set<string>();
  for (const card of cards) {
    const key = groupKey(card);
    const seen = levels.get(key) ?? new Set<Card['level']>();
    if (seen.has(card.level)) separate.add(key);
    seen.add(card.level);
    levels.set(key, seen);
  }
  const groups = new Map<string, CardGroup>();
  for (const card of cards) {
    const baseKey = groupKey(card);
    const key = separate.has(baseKey) ? JSON.stringify([baseKey, card.image]) : baseKey;
    let group = groups.get(key);
    if (!group) {
      group = { key, name: card.name, group: card.group, cards: [], matches: [] };
      groups.set(key, group);
    }
    group.cards.push(card);
    // Related-card selectors can always access hidden cards; catalog inclusion is opt-in.
    if ((!card.hidden || filters.showHidden) && matchesCard(card, filters)) group.matches.push(card);
  }
  return [...groups.values()].filter((group) => group.matches.length > 0);
}

export function relatedNames(group: CardGroup) {
  return [...new Set(group.cards.flatMap((card) => card.relatedCards))].filter((name) => name !== group.name);
}

export function readFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  // Keep existing shared links useful after replacing the old mode filter.
  if (!params.has('group') && params.has('mode')) params.set('group', params.get('mode') === 'classic' ? 'base' : params.get('mode')!);
  const filters = Object.fromEntries(Object.entries(emptyFilters).map(([key, fallback]) =>
    [key, params.get(key) ?? fallback])) as unknown as Filters;
  const groups = [...new Set(params.getAll('group'))].filter((group) => group && group !== 'all');
  filters.group = groups.length > 1 ? groups : groups[0] ?? 'all';
  filters.showHidden = params.get('showHidden') === 'true';
  return filters;
}

export function writeFilters(filters: Filters) {
  const params = new URLSearchParams();
  for (const key of Object.keys(emptyFilters) as (keyof Filters)[]) {
    if (key === 'group') {
      for (const group of selectedGroups(filters)) params.append(key, group);
    } else if (filters[key] !== emptyFilters[key]) params.set(key, String(filters[key]));
  }
  return params.toString();
}
