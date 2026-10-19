import type { Card } from './catalog.ts';
// @ts-expect-error Shared browser/Node group definitions are plain JavaScript.
import { describeGroup, sortGroupIds } from '../scripts/card-groups.mjs';

export interface CardCategory {
  id: string; label: string; folder: string; file: string;
  hasMetadata?: boolean; folderExists?: boolean; registered?: number; unregistered?: number; missing?: number; recordCount?: number;
}

const files = import.meta.glob<Card[]>('../data/cards/*.json', { eager: true, import: 'default' });
const byId = new Map(Object.entries(files).map(([path, cards]) => [path.split('/').at(-1)!.replace(/\.json$/, ''), cards]));
const ids: string[] = sortGroupIds([...byId.keys()]);
export const cardCategories: CardCategory[] = ids.map((id) => describeGroup(id));
export const cards: Card[] = ids.flatMap((id) => byId.get(id)!);
