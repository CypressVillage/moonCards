import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// One-time, metadata-only migration; never scans or imports source images.
export function splitLegacyCards(cards) {
  const result = { base: [], base_extra: [], diary: [] };
  for (const card of cards) {
    const group = card.image.split('/')[1]?.replace(/^card_/, '');
    if (!Object.hasOwn(result, group)) throw new Error(`此次迁移不包含目录：${card.image}`);
    const { diary, ...metadata } = card;
    result[group].push({ ...metadata, group });
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = resolve(root, process.argv[2] ?? 'data/cards.json');
  const cards = JSON.parse(await readFile(source, 'utf8'));
  const groups = splitLegacyCards(cards);
  await mkdir(resolve(root, 'data/cards'), { recursive: true });
  for (const [group, records] of Object.entries(groups)) {
    await writeFile(resolve(root, `data/cards/${group}.json`), `${JSON.stringify(records, null, 2)}\n`, { flag: 'wx' });
    console.log(`${group}: ${records.length} 条`);
  }
}
