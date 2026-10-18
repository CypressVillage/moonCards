import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFilters, filterGroups, highestLevel, professionOrder, readFilters, relatedNames, writeFilters } from '../src/catalog.ts';
import type { Card } from '../src/catalog.ts';
// @ts-expect-error The validation script is intentionally shared as plain JavaScript.
import { validateCards, cardTypes } from '../scripts/validate-cards.mjs';

const makeCard = (overrides: Partial<Card> = {}): Card => ({
  name: '测试卡', diary: false, level: 1, classes: ['职业A', '职业B'],
  type: '攻击', cost: 1, image: 'assets/test.png', relatedCards: [], ...overrides,
});

test('职业筛选使用固定顺序并直接显示原始职业名称', () => {
  assert.deepEqual(professionOrder, ['女骑士', '游侠', '小女巫', '修女', '魔术师', '药剂师', '狼人', '契约师', '机械师', '调灵师', '猎魔人', '小猪妖']);
  assert.equal(professionOrder[0], '女骑士');
  assert.equal(filterGroups([makeCard({ classes: ['女骑士'] })], { ...emptyFilters, profession: professionOrder[0] }).length, 1);
});

test('类型选项固定为八种正常类型，拒绝乱码及任意未知类型', () => {
  assert.deepEqual(cardTypes, ['装备', '攻击', '法力', '行动', '咒术', '祷告', '反制', '特殊']);
  for (const type of cardTypes) assert.deepEqual(validateCards([makeCard({ type })]), []);
  for (const type of ['��动', '咒���', '未知类型', '']) {
    assert.match(validateCards([makeCard({ type })]).join(), /卡牌类型必须是/);
  }
});

test('同名等级合并，多职业不复制卡位，模式不串组', () => {
  const groups = filterGroups([makeCard(), makeCard({ level: 2 }), makeCard({ diary: true })], emptyFilters);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].cards.length, 2);
  assert.equal(highestLevel(groups[0].matches).level, 2);
});

test('筛选必须由同一条版本记录同时满足', () => {
  const cards = [makeCard(), makeCard({ level: 2, cost: 2 })];
  assert.equal(filterGroups(cards, { ...emptyFilters, level: '1', cost: '2' }).length, 0);
  const groups = filterGroups(cards, { ...emptyFilters, level: '1', cost: '1' });
  assert.equal(highestLevel(groups[0].matches).level, 1);
  assert.equal(groups[0].cards.length, 2);
});

test('职业、模式、类型组合筛选', () => {
  const cards = [makeCard(), makeCard({ name: '日记卡', diary: true })];
  assert.equal(filterGroups(cards, { ...emptyFilters, profession: '职业B', mode: 'diary', type: '攻击' })[0].name, '日记卡');
  assert.equal(filterGroups(cards, { ...emptyFilters, profession: '职业C' }).length, 0);
});

test('零费、未知能耗、无星级不混淆', () => {
  const cards = [makeCard({ cost: 0 }), makeCard({ name: '无星卡', level: null, cost: null })];
  assert.equal(filterGroups(cards, { ...emptyFilters, cost: '0' })[0].name, '测试卡');
  assert.equal(filterGroups(cards, { ...emptyFilters, cost: 'null', level: 'null' })[0].name, '无星卡');
});

test('隐藏附属卡不占默认卡位，也不出现在名称搜索中', () => {
  const cards = [makeCard(), makeCard({ name: '附属卡', hidden: true })];
  assert.equal(filterGroups(cards, emptyFilters).length, 1);
  assert.equal(filterGroups(cards, { ...emptyFilters, query: '附属' }).length, 0);
});

test('搜索忽略大小写和两侧空格', () => {
  assert.equal(filterGroups([makeCard({ name: 'Moon' })], { ...emptyFilters, query: ' MOON ' }).length, 1);
});

test('关联名称去重，不递归展开关系链', () => {
  const group = filterGroups([makeCard({ relatedCards: ['附属卡'] }), makeCard({ level: 2, relatedCards: ['附属卡'] })], emptyFilters)[0];
  assert.deepEqual(relatedNames(group), ['附属卡']);
});

test('URL 筛选往返保持中文和特殊字符', () => {
  const filters = { ...emptyFilters, query: '法力 & 卡', mode: 'diary', cost: '0' };
  assert.deepEqual(readFilters(writeFilters(filters)), filters);
  assert.equal(writeFilters(emptyFilters), '');
});

test('空目录可以正常检索', () => {
  assert.deepEqual(filterGroups([], emptyFilters), []);
});

test('数据校验拒绝重复身份和错误字段', () => {
  assert.deepEqual(validateCards([makeCard()]), []);
  assert.match(validateCards([makeCard(), makeCard()]).join(), /重复/);
  assert.match(validateCards([makeCard({ cost: -1 })]).join(), /cost/);
  assert.match(validateCards([makeCard({ image: 'assets/../secret.png' })]).join(), /image/);
});

test('关联只允许指向同一模式的现有卡牌', () => {
  const primary = makeCard({ relatedCards: ['附属卡'] });
  assert.match(validateCards([primary, makeCard({ name: '附属卡', diary: true })]).join(), /同模式/);
  assert.deepEqual(validateCards([primary, makeCard({ name: '附属卡' })]), []);
});

test('各等级的隐藏状态必须保持一致', () => {
  assert.match(validateCards([makeCard(), makeCard({ level: 2, hidden: true })]).join(), /hidden/);
});
