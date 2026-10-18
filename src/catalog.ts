export interface Card {
  name: string;
  diary: boolean;
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
  mode: string;
  profession: string;
  type: string;
  cost: string;
  level: string;
}

export interface CardGroup {
  key: string;
  name: string;
  diary: boolean;
  cards: Card[];
  matches: Card[];
}

export const emptyFilters: Filters = {
  query: '', mode: 'all', profession: '', type: '', cost: '', level: '',
};

export const professionOrder = ['女骑士', '游侠', '小女巫', '修女', '魔术师', '药剂师', '狼人', '契约师', '机械师', '调灵师', '猎魔人', '小猪妖'];

export const groupKey = (card: Pick<Card, 'diary' | 'name'>) => JSON.stringify([card.diary, card.name]);
export const recordKey = (card: Card) => JSON.stringify([card.diary, card.name, card.level]);
export const sortLevels = (cards: Card[]) => [...cards].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
export const highestLevel = (cards: Card[]) => sortLevels(cards).at(-1)!;
export const levelLabel = (level: number | null) => level === null ? '无星级' : `${level} 星`;
export const costLabel = (cost: Card['cost']) => cost === null ? '未标注 / 不适用' : `${cost} 费`;

export function matchesCard(card: Card, filters: Filters) {
  const query = filters.query.trim().toLocaleLowerCase();
  return (!query || card.name.toLocaleLowerCase().includes(query))
    && (filters.mode === 'all' || card.diary === (filters.mode === 'diary'))
    && (!filters.profession || (filters.profession === '__unknown'
      ? card.classes.length === 0 : card.classes.includes(filters.profession)))
    && (!filters.type || card.type === filters.type)
    && (!filters.cost || String(card.cost) === filters.cost)
    && (!filters.level || String(card.level) === filters.level);
}

export function filterGroups(cards: Card[], filters: Filters): CardGroup[] {
  const groups = new Map<string, CardGroup>();
  for (const card of cards) {
    const key = groupKey(card);
    let group = groups.get(key);
    if (!group) {
      group = { key, name: card.name, diary: card.diary, cards: [], matches: [] };
      groups.set(key, group);
    }
    group.cards.push(card);
    // Hidden cards remain accessible through related-card selectors, not catalog searches.
    if (!card.hidden && matchesCard(card, filters)) group.matches.push(card);
  }
  return [...groups.values()].filter((group) => group.matches.length > 0);
}

export function relatedNames(group: CardGroup) {
  return [...new Set(group.cards.flatMap((card) => card.relatedCards))].filter((name) => name !== group.name);
}

export function readFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  return Object.fromEntries(Object.entries(emptyFilters).map(([key, fallback]) =>
    [key, params.get(key) ?? fallback])) as unknown as Filters;
}

export function writeFilters(filters: Filters) {
  const params = new URLSearchParams();
  for (const key of Object.keys(emptyFilters) as (keyof Filters)[]) {
    if (filters[key] !== emptyFilters[key]) params.set(key, filters[key]);
  }
  return params.toString();
}
