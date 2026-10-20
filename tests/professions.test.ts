import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFilters, filterGroups } from '../src/catalog.ts';
import type { Card } from '../src/catalog.ts';
import { diaryProfessionOrder, professionChoices, professionLabel, professionOrder, professionText, sortedCardProfessions } from '../src/professions.ts';
// @ts-expect-error Shared Node/browser group definitions are plain JavaScript.
import { describeGroup, groupLabel, groupMode } from '../scripts/card-groups.mjs';

test('五种日记职业只改变显示，不改变统一职业选项值', () => {
  assert.deepEqual(diaryProfessionOrder.map((value) => professionLabel(value, 'diary')), ['小骑士', '小女巫', '小游侠', '小药剂师', '小魔术师']);
  assert.deepEqual(professionChoices('diary'), ['女骑士', '小女巫', '游侠', '药剂师', '魔术师']);
  assert.deepEqual(professionChoices('classic'), professionOrder);
  assert.equal(professionLabel('小女巫', 'diary'), '小女巫');
  assert.equal(professionLabel('修女', 'diary'), '修女');
  assert.equal(professionLabel('其他职业', 'diary'), '其他职业');
});

test('空职业统一显示无职业', () => {
  assert.equal(professionText([], 'classic'), '无职业');
  assert.equal(professionText([], 'diary'), '无职业');
});

test('保存职业按对应模式的默认顺序排列，不改写原数组或丢失未知职业', () => {
  const card: Card = { name: '卡牌', group: 'base', level: null, classes: ['其他B', '药剂师', '游侠', '魔术师', '女骑士', '小女巫', '其他A'], type: '攻击', cost: null, image: 'assets/card_base/卡牌.png', relatedCards: [] };
  const before = JSON.stringify(card);
  assert.deepEqual(sortedCardProfessions([card], 'classic')[0].classes, ['女骑士', '游侠', '小女巫', '魔术师', '药剂师', '其他B', '其他A']);
  assert.deepEqual(sortedCardProfessions([card], 'diary')[0].classes, ['女骑士', '小女巫', '游侠', '药剂师', '魔术师', '其他B', '其他A']);
  assert.equal(JSON.stringify(card), before);
  assert.deepEqual(sortedCardProfessions([{ ...card, classes: [] }], 'classic')[0].classes, []);
});

test('任意目录可配置日记称呼，目录名不决定模式，旧字符串显示名仍可读取', () => {
  const settings = { base: '旧经典名', custom: { label: '自定义日记', mode: 'diary' }, diary: { label: '日记改为经典', mode: 'classic' } };
  assert.equal(groupMode('custom', settings), 'diary');
  assert.equal(groupMode('diary', settings), 'classic');
  assert.equal(groupMode('unknown', settings), 'classic');
  assert.equal(groupLabel('base', settings), '旧经典名');
  assert.equal(groupLabel('custom', settings), '自定义日记');
  assert.equal(describeGroup('custom', settings).folder, 'assets/card_custom');
  assert.equal(describeGroup('custom', settings).file, 'data/cards/custom.json');
  assert.equal(describeGroup('custom', settings).mode, 'diary');
});

test('跨经典和日记仍使用同一个职业字段检索，映射可逆且不改写卡牌数据', () => {
  const makeCard = (group: string): Card => ({ name: '卡牌', group, level: null, classes: ['女骑士', '游侠'], type: '攻击', cost: null, image: `assets/card_${group}/卡牌.png`, relatedCards: [] });
  const cards = [makeCard('base'), makeCard('custom')];
  const before = JSON.stringify(cards);
  assert.equal(filterGroups(cards, { ...emptyFilters, profession: '女骑士' }).length, 2);
  assert.equal(filterGroups(cards, { ...emptyFilters, profession: '游侠', group: 'custom' }).length, 1);
  assert.equal(professionText(cards[1].classes, 'diary'), '小骑士 / 小游侠');
  assert.equal(professionText(cards[1].classes, 'classic'), '女骑士 / 游侠');
  assert.equal(JSON.stringify(cards), before);
});
