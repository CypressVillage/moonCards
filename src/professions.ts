// @ts-expect-error Shared browser/Node profession definitions are plain JavaScript.
import { professionOrder as classicOrder, diaryProfessionOrder as diaryOrder, sortCardProfessions } from '../scripts/card-professions.mjs';
import type { Card } from './catalog.ts';
export const professionOrder: string[] = classicOrder;
export const diaryProfessionOrder: string[] = diaryOrder;
export type GroupMode = 'classic' | 'diary';

const diaryLabels: Record<string, string> = {
  女骑士: '小骑士', 游侠: '小游侠', 小女巫: '小女巫', 药剂师: '小药剂师', 魔术师: '小魔术师',
};

export const professionChoices = (mode: GroupMode): string[] => mode === 'diary' ? diaryProfessionOrder : professionOrder;
export const sortedCardProfessions = (cards: Card[], mode: GroupMode): Card[] => sortCardProfessions(cards, mode);
export const professionLabel = (value: string, mode: GroupMode) => mode === 'diary' && Object.hasOwn(diaryLabels, value) ? diaryLabels[value] : value;
export const professionText = (values: string[], mode: GroupMode) => values.map((value) => professionLabel(value, mode)).join(' / ') || '无职业';
