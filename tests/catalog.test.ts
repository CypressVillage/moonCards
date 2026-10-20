import test from 'node:test';
import assert from 'node:assert/strict';
import { costLabel, emptyFilters, filterGroups, highestLevel, professionOrder, readFilters, relatedNames, writeFilters } from '../src/catalog.ts';
import type { Card } from '../src/catalog.ts';
// @ts-expect-error The validation script is intentionally shared as plain JavaScript.
import { validateCards, cardTypes } from '../scripts/validate-cards.mjs';

const makeCard = (overrides: Partial<Card> = {}): Card => ({
  name: '测试卡', group: 'base', level: 1, classes: ['职业A', '职业B'],
  type: '攻击', cost: 1, image: 'assets/test.png', relatedCards: [], ...overrides,
});

test('空能耗显示无能耗，不混淆明确的零费、普通费用和 X 费', () => {
  assert.equal(costLabel(null), '无能耗');
  assert.equal(costLabel(0), '0 费');
  assert.equal(costLabel(2), '2 费');
  assert.equal(costLabel('X'), 'X 费');
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
  const groups = filterGroups([makeCard(), makeCard({ level: 2 }), makeCard({ group: 'diary' })], emptyFilters);
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
  const cards = [makeCard(), makeCard({ name: '日记卡', group: 'diary' })];
  assert.equal(filterGroups(cards, { ...emptyFilters, profession: '职业B', group: 'diary', type: '攻击' })[0].name, '日记卡');
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

test('显示隐藏卡牌包含普通卡和隐藏卡，仍应用名称、职业和分组筛选', () => {
  const cards = [makeCard(), makeCard({ name: '附属卡', hidden: true }), makeCard({ name: '日记附属卡', group: 'diary', hidden: true })];
  const filters = { ...emptyFilters, showHidden: true };
  assert.equal(filterGroups(cards, filters).length, 3);
  assert.deepEqual(filterGroups(cards, { ...filters, query: '附属', group: 'base', profession: '职业A' }).map((group) => group.name), ['附属卡']);
  assert.equal(filterGroups(cards, { ...filters, profession: '不存在' }).length, 0);
  assert.equal(filterGroups(cards, emptyFilters).length, 1);
});

test('隐藏卡牌开关可通过 URL 往返，默认关闭且忽略无效值', () => {
  const filters = { ...emptyFilters, showHidden: true, query: '附属卡' };
  assert.deepEqual(readFilters(writeFilters(filters)), filters);
  for (const search of ['', '?showHidden=false', '?showHidden=1']) assert.equal(readFilters(search).showHidden, false);
});

test('搜索忽略大小写和两侧空格', () => {
  assert.equal(filterGroups([makeCard({ name: 'Moon' })], { ...emptyFilters, query: ' MOON ' }).length, 1);
});

test('关联名称去重，不递归展开关系链', () => {
  const group = filterGroups([makeCard({ relatedCards: ['附属卡'] }), makeCard({ level: 2, relatedCards: ['附属卡'] })], emptyFilters)[0];
  assert.deepEqual(relatedNames(group), ['附属卡']);
});

test('URL 筛选往返保持中文和特殊字符', () => {
  const filters = { ...emptyFilters, query: '法力 & 卡', group: 'diary', cost: '0' };
  assert.deepEqual(readFilters(writeFilters(filters)), filters);
  assert.equal(writeFilters(emptyFilters), '');
});

test('空目录可以正常检索', () => {
  assert.deepEqual(filterGroups([], emptyFilters), []);
});

test('类别多选取并集，并与其他筛选条件组合', () => {
  const cards = [makeCard(), makeCard({ name: '日记卡', group: 'diary' }), makeCard({ name: '技能卡', group: 'skill' })];
  assert.deepEqual(filterGroups(cards, { ...emptyFilters, group: ['base', 'diary'] }).map((card) => card.name), ['测试卡', '日记卡']);
  assert.deepEqual(filterGroups(cards, { ...emptyFilters, group: ['base', 'diary'], query: '日记' }).map((card) => card.name), ['日记卡']);
  assert.equal(filterGroups(cards, { ...emptyFilters, group: [], cost: '1' }).length, 3);
});

test('类别多选 URL 可往返，兼容单类别及旧模式链接', () => {
  const filters = { ...emptyFilters, group: ['base', 'diary'], query: '测试' };
  assert.deepEqual(readFilters(writeFilters(filters)), filters);
  assert.equal(readFilters('?group=diary').group, 'diary');
  assert.equal(readFilters('?mode=classic').group, 'base');
  assert.equal(readFilters('?group=base&group=base').group, 'base');
  assert.equal(readFilters('?group=').group, 'all');
  assert.equal(writeFilters({ ...emptyFilters, group: [] }), '');
});

test('数据校验拒绝重复身份和错误字段', () => {
  assert.deepEqual(validateCards([makeCard()]), []);
  assert.match(validateCards([makeCard(), makeCard()]).join(), /重复/);
  assert.match(validateCards([makeCard({ cost: -1 })]).join(), /cost/);
  assert.match(validateCards([makeCard({ image: 'assets/../secret.png' })]).join(), /image/);
});

test('关联允许指向任意已加载 JSON，仅拒绝不存在的名称', () => {
  const primary = makeCard({ image: 'assets/primary.png', relatedCards: ['附属卡'] });
  assert.deepEqual(validateCards([primary, makeCard({ name: '附属卡', group: 'diary' })]), []);
  assert.deepEqual(validateCards([primary, makeCard({ name: '附属卡' })]), []);
  assert.deepEqual(validateCards([primary, makeCard({ name: '附属卡', group: 'base_extra' })]), []);
  assert.deepEqual(validateCards([primary, makeCard({ name: '附属卡', group: 'skill' })]), []);
  assert.match(validateCards([primary]).join(), /所有已加载 JSON 中不存在/);
});

test('不同源图片允许同名同星级及不同隐藏状态，图片路径和星级重复仍报错', () => {
  const cards = [makeCard(), makeCard({ image: 'assets/another.png', hidden: true })];
  assert.deepEqual(validateCards(cards), []);
  assert.deepEqual(validateCards([makeCard(), makeCard({ level: 2, hidden: true })]), []);
  assert.match(validateCards([makeCard(), makeCard({ name: '另一名称' })]).join(), /图片路径、等级重复/);
});

test('同名同星不同图片分别展示，不同类型不混合，普通等级仍合并', () => {
  const cards = [makeCard(), makeCard({ image: 'assets/another.png' }), makeCard({ type: '特殊', image: 'assets/special.png' })];
  const groups = filterGroups(cards, emptyFilters);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => group.cards[0].image), cards.map((card) => card.image));
  assert.equal(filterGroups([makeCard(), makeCard({ level: 2, image: 'assets/level2.png' })], emptyFilters).length, 1);
});
