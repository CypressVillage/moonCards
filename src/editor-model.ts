import { groupKey, recordKey } from './catalog.ts';
import type { Card } from './catalog.ts';

export function moveCard(cards: Card[], from: number, to: number): Card[] {
  if (from === to || from < 0 || to < 0 || from >= cards.length || to >= cards.length) return cards;
  const result = [...cards];
  const [card] = result.splice(from, 1);
  result.splice(to, 0, card);
  return result;
}

export function editCard(cards: Card[], index: number, patch: Partial<Card>): Card[] {
  return cards.map((card, position) => {
    if (patch.hidden !== undefined && groupKey(card) === groupKey(cards[index])) return { ...card, hidden: patch.hidden };
    return position === index ? { ...card, ...patch } : card;
  });
}

export function editCardIdentity(cards: Card[], index: number, patch: Pick<Partial<Card>, 'name' | 'diary'>): Card[] {
  const original = cards[index];
  const name = (patch.name ?? original.name).trim();
  const diary = patch.diary ?? original.diary;
  if (!name) throw new Error('卡牌名称不能为空');
  const originalKey = groupKey(original);
  const updated = { ...original, name, diary };
  if (cards.some((card, position) => position !== index && recordKey(card) === recordKey(updated))) {
    throw new Error(`已存在相同类别、名称和星级的记录：${name}（${original.level === null ? '无星级' : `${original.level}星`}）。不同星级可以使用相同名称。`);
  }
  // Keep references to the old name while any other level still uses it.
  const renameReferences = diary === original.diary && name !== original.name
    && !cards.some((card, position) => position !== index && groupKey(card) === originalKey);
  return cards.map((card, position) => {
    const result = position === index ? updated : card;
    const relatedCards = renameReferences && card.diary === original.diary && card.relatedCards.includes(original.name)
      ? [...new Set(card.relatedCards.map((related) => related === original.name ? name : related))].filter((related) => related !== result.name)
      : card.relatedCards;
    return relatedCards === result.relatedCards ? result : { ...result, relatedCards };
  });
}

export function searchRelatedCards(cards: Card[], card: Card, query: string): string[] {
  const term = query.trim().toLocaleLowerCase();
  return [...new Set(cards.filter((candidate) => candidate.diary === card.diary
    && candidate.name !== card.name && !card.relatedCards.includes(candidate.name)
    && candidate.name.toLocaleLowerCase().includes(term)).map((candidate) => candidate.name))];
}
