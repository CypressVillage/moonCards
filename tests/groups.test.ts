import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { emptyFilters, filterGroups, relatedVariants, readFilters } from '../src/catalog.ts';
import type { Card } from '../src/catalog.ts';
// @ts-expect-error Shared Node store is plain JavaScript.
import { readCardStore } from '../scripts/card-store.mjs';
// @ts-expect-error Shared migration is plain JavaScript.
import { splitLegacyCards } from '../scripts/migrate-card-groups.mjs';
// @ts-expect-error Shared validator is plain JavaScript.
import { validateCards } from '../scripts/validate-cards.mjs';

const card = (group: string, name = '同名卡', level = 1): Card => ({ group, name, level, classes: [], type: '攻击', cost: 1, image: `assets/card_${group}/${name}${level}.png`, relatedCards: [] });

test('旧数据仅按现有图片目录拆分，保留元数据和组内顺序', () => {
  const legacy = [
    { ...card('base', 'B'), diary: false }, { ...card('diary', '日记'), diary: true },
    { ...card('base_extra', '附属'), diary: false }, { ...card('base', 'A'), diary: false },
  ].map(({ group, ...entry }) => entry);
  const migrated = splitLegacyCards(legacy);
  assert.deepEqual(Object.keys(migrated), ['base', 'base_extra', 'diary']);
  assert.deepEqual(migrated.base.map((entry: Card) => entry.name), ['B', 'A']);
  assert.equal(Object.values(migrated).flat().length, legacy.length);
  assert.ok(Object.values(migrated).flat().every((entry) => !('diary' in (entry as Card))));
  assert.throws(() => splitLegacyCards([{ ...legacy[0], image: 'assets/card_skill/未收录.png' }]), /此次迁移不包含/);
});

test('任意新增组可独立筛选，同名同星不跨组重复或合并', () => {
  const cards = [card('base'), card('base_extra'), card('diary'), card('skill')];
  assert.equal(filterGroups(cards, emptyFilters).length, 4);
  for (const group of ['base', 'base_extra', 'diary', 'skill']) {
    const result = filterGroups(cards, { ...emptyFilters, group });
    assert.equal(result.length, 1);
    assert.equal(result[0].group, group);
  }
  assert.deepEqual(validateCards(cards), []);
  assert.match(validateCards([{ ...cards[0], diary: false }]).join(), /不再使用 diary/);
  assert.match(validateCards([{ ...cards[0], group: '../base' }]).join(), /group/);
  assert.equal(readFilters('?mode=classic').group, 'base');
  assert.equal(readFilters('?group=skill').group, 'skill');
});

test('关联切换覆盖所有 JSON，同名优先本组并保留既有经典附属关系', () => {
  const cards = [card('base_extra', '小小法力'), card('diary', '小小法力')];
  assert.equal(relatedVariants(cards, { group: 'base' }, '小小法力')[0].group, 'base_extra');
  const same = card('base', '小小法力');
  assert.deepEqual(relatedVariants([...cards, same], { group: 'base' }, '小小法力'), [same]);
  assert.equal(relatedVariants(cards, { group: 'skill' }, '小小法力')[0].group, 'diary');
  assert.equal(relatedVariants([card('diary', '日记目标')], { group: 'base' }, '日记目标')[0].group, 'diary');
  assert.equal(relatedVariants([card('skill', '技能目标')], { group: 'base' }, '技能目标')[0].group, 'skill');
  assert.deepEqual(relatedVariants(cards, { group: 'base' }, '不存在'), []);
});

test('跨组同名卡按固定分组顺序解析，不混合不同分组的星级', () => {
  const first = card('diary', '同名目标', 1);
  const second = card('skill', '同名目标', 2);
  assert.deepEqual(relatedVariants([second, first], { group: 'ce' }, '同名目标'), [first]);
  assert.deepEqual(relatedVariants([first, second], { group: 'ce' }, '同名目标'), [first]);
});

test('分组文件自动发现，拒绝文件名、group 和图片文件夹不一致', async () => {
  const root = await mkdtemp(join(tmpdir(), 'card-groups-'));
  await mkdir(`${root}/data/cards`, { recursive: true });
  try {
    for (const group of ['diary', 'skill', 'base_extra', 'base']) {
      await writeFile(`${root}/data/cards/${group}.json`, JSON.stringify([card(group)]));
    }
    const store = await readCardStore(root);
    assert.deepEqual(store.groups.map((group: { id: string }) => group.id), ['base', 'diary', 'base_extra', 'skill']);
    assert.equal(store.groups[3].label, 'skill');
    assert.equal(store.cards.length, 4);
    await writeFile(`${root}/data/cards/skill.json`, JSON.stringify([card('base')]));
    await assert.rejects(readCardStore(root), /group: "skill"/);
    await writeFile(`${root}/data/cards/skill.json`, JSON.stringify([{ ...card('skill'), image: 'assets/card_base/其他.png' }]));
    await assert.rejects(readCardStore(root), /只能引用/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('实际 JSON 的 group 和目录一致，没有 diary 布尔字段（允许以后扩充新组）', async () => {
  const directory = new URL('../data/cards/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.json'));
  for (const required of ['base.json', 'base_extra.json', 'diary.json']) assert.ok(files.includes(required));
  const all: Card[] = [];
  for (const file of files) {
    const group = file.slice(0, -5);
    const cards: Card[] = JSON.parse(await readFile(new URL(file, directory), 'utf8'));
    assert.ok(cards.every((entry) => entry.group === group && entry.image.startsWith(`assets/card_${group}/`) && !('diary' in entry)));
    all.push(...cards);
  }
  assert.ok(all.length > 0);
  assert.deepEqual(validateCards(all), []);
});

test('分组配置支持可编辑模式和旧显示名，拒绝错误模式或空名称', async () => {
  const root = await mkdtemp(join(tmpdir(), 'group-settings-'));
  await mkdir(`${root}/data/cards`, { recursive: true });
  try {
    await writeFile(`${root}/data/cards/base.json`, JSON.stringify([card('base')]));
    await writeFile(`${root}/data/groups.json`, JSON.stringify({ base: { label: '任意日记目录', mode: 'diary' } }));
    let store = await readCardStore(root);
    assert.equal(store.groups[0].mode, 'diary');
    assert.equal(store.groups[0].label, '任意日记目录');
    await writeFile(`${root}/data/groups.json`, JSON.stringify({ base: '旧显示名' }));
    store = await readCardStore(root);
    assert.equal(store.groups[0].mode, 'classic');
    assert.equal(store.groups[0].label, '旧显示名');
    for (const entry of [{ label: '名称', mode: 'wrong' }, { label: '', mode: 'diary' }, { label: '名称', mode: true }]) {
      await writeFile(`${root}/data/groups.json`, JSON.stringify({ base: entry }));
      await assert.rejects(readCardStore(root), /分组配置格式错误/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
