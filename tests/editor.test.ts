import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { appendRegistrationDraft, moveCard, editCard, editCardIdentity, pendingRegistrationImages, searchRelatedCards, withdrawRegistrationDraft } from '../src/editor-model.ts';
import type { Card } from '../src/catalog.ts';
// @ts-expect-error Shared Node middleware is plain JavaScript.
import { cardEditorApi } from '../scripts/card-editor-api.mjs';

const card = (name: string, level = 1): Card => ({ name, level, group: 'base', classes: [], type: '攻击', cost: null, image: `assets/card_base/${name}${level}.png`, relatedCards: [] });

test('连续收录只追加草稿，保留已有修改，可排序、继续编辑和单独撤回', () => {
  const saved = [card('A'), card('B')];
  const changed = editCard(saved, 0, { cost: 2 });
  const candidate = { ...card('新卡'), classes: ['女骑士'] };
  const first = appendRegistrationDraft(changed, candidate);
  candidate.classes.push('游侠');
  let drafts = appendRegistrationDraft(first, card('第二张'));
  assert.deepEqual(drafts[2].classes, ['女骑士']);
  assert.equal(drafts[0].cost, 2);
  assert.deepEqual([...pendingRegistrationImages(drafts, saved)], [card('新卡').image, card('第二张').image]);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].cost, null);
  drafts = moveCard(drafts, 3, 0);
  drafts = withdrawRegistrationDraft(drafts, card('新卡').image, saved);
  assert.deepEqual(drafts.map((entry) => entry.name), ['第二张', 'A', 'B']);
  assert.equal(drafts[1].cost, 2);
  assert.throws(() => appendRegistrationDraft(drafts, card('第二张')), /重复收录/);
  assert.throws(() => appendRegistrationDraft(drafts, { ...card('A'), image: 'assets/card_base/另一张.png' }), /相同分组/);
  assert.throws(() => withdrawRegistrationDraft(drafts, saved[0].image, saved), /不能删除已保存/);
  assert.equal(pendingRegistrationImages(drafts, drafts).size, 0);
});

test('排序移动精确对应 JSON 记录顺序，不改变内容', () => {
  const cards = [card('A'), card('B'), card('C')];
  assert.deepEqual(moveCard(cards, 0, 2).map((entry) => entry.name), ['B', 'C', 'A']);
  assert.deepEqual(moveCard(cards, 2, 0).map((entry) => entry.name), ['C', 'A', 'B']);
  assert.equal(moveCard(cards, -1, 0), cards);
  assert.equal(cards[0].name, 'A');
});

test('元数据编辑保留其他记录，可见性同步同名等级但不跨模式', () => {
  const cards = [card('A'), card('A', 2), { ...card('A'), group: 'diary' }];
  assert.deepEqual(editCard(cards, 0, { hidden: true }).map((entry) => Boolean(entry.hidden)), [true, true, false]);
  const changed = editCard(cards, 0, { classes: ['猎人'], cost: 'X', relatedCards: ['B'] });
  assert.equal(changed[1], cards[1]);
  assert.deepEqual(changed[0].classes, ['猎人']);
});

test('职业支持多选和清空，星级保存为 null 或数字 1/2/3', () => {
  const cards = [card('A'), card('B')];
  const selected = editCard(cards, 0, { classes: ['女骑士', '游侠', '小猪妖'] });
  assert.deepEqual(selected[0].classes, ['女骑士', '游侠', '小猪妖']);
  assert.deepEqual(editCard(selected, 0, { classes: [] })[0].classes, []);
  for (const level of [null, 1, 2, 3]) {
    const updated = editCard(selected, 0, { level });
    assert.equal(JSON.parse(JSON.stringify(updated))[0].level, level);
    assert.equal(updated[1], cards[1]);
  }
});

test('重命名仅修改当前等级，其他等级仍存在时保持旧名称引用', () => {
  const cards = [card('A'), card('A', 2), { ...card('B'), relatedCards: ['A'] }, { ...card('A'), group: 'diary' }];
  const updated = editCardIdentity(cards, 0, { name: ' 新名称 ' });
  assert.deepEqual(updated.map((entry) => entry.name), ['新名称', 'A', 'B', 'A']);
  assert.deepEqual(updated[2].relatedCards, ['A']);
  assert.equal(updated[0].image, cards[0].image);
  assert.throws(() => editCardIdentity(cards, 0, { name: 'B' }), /相同类别、名称和星级/);
  assert.throws(() => editCardIdentity(cards, 0, { name: ' ' }), /不能为空/);
});

test('同名同星在不同分组中不冲突，编辑名称不改变所属组', () => {
  const cards = [card('A'), { ...card('B'), group: 'diary' }];
  const updated = editCardIdentity(cards, 1, { name: 'A' });
  assert.equal(updated[1].group, 'diary');
  assert.equal(updated[1].name, 'A');
  assert.equal(updated[0], cards[0]);
});

test('同名一二三星允许共存，重命名不会修改其他记录', () => {
  const cards = [card('普通攻击', 1), card('普通攻击', 2), card('普通攻击3', 3)];
  const updated = editCardIdentity(cards, 2, { name: '普通攻击' });
  assert.deepEqual(updated.map((entry) => [entry.name, entry.level]), [['普通攻击', 1], ['普通攻击', 2], ['普通攻击', 3]]);
  assert.equal(updated[0], cards[0]);
  assert.equal(updated[1], cards[1]);
  assert.throws(() => editCardIdentity([card('A', 3), card('B', 3)], 1, { name: 'A' }), /相同类别、名称和星级/);
});

test('旧名称最后一条记录重命名时更新引用，并移除合并后的自身关联', () => {
  const cards = [card('A', 3), { ...card('B', 1), relatedCards: ['A'] }, { ...card('C'), relatedCards: ['A'] }];
  const updated = editCardIdentity(cards, 0, { name: 'B' });
  assert.deepEqual(updated[1].relatedCards, []);
  assert.deepEqual(updated[2].relatedCards, ['B']);
});

test('关联搜索覆盖所有 JSON，去重并排除自身和已选关联', () => {
  const cards = [card('A'), card('Moon'), card('Moon', 2), card('B'), { ...card('Moon日记'), group: 'diary' }];
  assert.deepEqual(searchRelatedCards(cards, cards[0], ' MOON '), ['Moon', 'Moon日记']);
  assert.deepEqual(searchRelatedCards(cards, { ...cards[0], relatedCards: ['Moon'] }, ''), ['B', 'Moon日记']);
  assert.deepEqual(searchRelatedCards(cards, cards[0], '不存在'), []);
  const expanded = [...cards, { ...card('技能目标'), group: 'skill', hidden: true }];
  assert.deepEqual(searchRelatedCards(expanded, cards[0], '技能'), ['技能目标']);
});

test('本地 API 保存、冲突、校验和跨域保护（仅使用临时文件）', async () => {
  const root = await mkdtemp('/tmp/opencode/card-editor-');
  await mkdir(`${root}/data/cards`, { recursive: true });
  const file = `${root}/data/cards/base.json`;
  await writeFile(file, JSON.stringify([card('落石'), card('B')]));
  const siblingFile = `${root}/data/cards/diary.json`;
  const sibling = JSON.stringify([{ ...card('日记卡'), group: 'diary', image: 'assets/card_diary/日记卡1.png' }]);
  await writeFile(siblingFile, sibling);
  const extraFile = `${root}/data/cards/base_extra.json`;
  const extra = JSON.stringify([{ ...card('附属'), group: 'base_extra', image: 'assets/card_base_extra/附属1.png' }]);
  await writeFile(extraFile, extra);
  const middleware = cardEditorApi(root);
  const server = createServer((req, res) => {
    // Simulate Vite's generic CORS middleware running before our API.
    res.setHeader('Access-Control-Allow-Origin', '*');
    void middleware(req, res, () => { res.writeHead(404); res.end(); });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const url = `${origin}/__card-editor/cards?group=base`;
  let saveToken = '';
  const post = (body: unknown, source = origin, token = saveToken, site = source === origin ? 'same-origin' : 'cross-site') => fetch(url, { method: 'POST', headers: { Origin: source, 'Content-Type': 'application/json', 'X-Card-Editor-Token': token, 'Sec-Fetch-Site': site }, body: JSON.stringify(body) });
  try {
    const read = await fetch(url);
    assert.equal(read.headers.get('access-control-allow-origin'), null);
    const loaded = await read.json();
    saveToken = loaded.saveToken;
    assert.ok(saveToken);
    assert.equal(loaded.editorApiVersion, 5);
    assert.deepEqual(loaded.groups.map((group: { id: string }) => group.id), ['base', 'diary', 'base_extra']);
    assert.equal(loaded.cards.length, 2);
    assert.equal(loaded.catalogCards.length, 4);
    const updated = moveCard(loaded.cards, 0, 1);
    updated[0] = { ...updated[0], cost: 'X', classes: ['猎人'], relatedCards: ['附属'] };
    const saved = await post({ cards: updated, revision: loaded.revision });
    assert.equal(saved.status, 200);
    const savedData = await saved.json();
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), updated);
    assert.equal((await post({ cards: loaded.cards, revision: loaded.revision })).status, 409);
    assert.equal((await post({ cards: [{ ...updated[0], cost: -1 }], revision: savedData.revision })).status, 400);
    assert.equal((await post({ cards: updated.map((entry: Card, index: number) => index === 0 ? { ...entry, relatedCards: ['日记卡'] } : entry), revision: savedData.revision, dryRun: true })).status, 200);
    assert.equal((await post({ cards: updated.map((entry: Card, index: number) => index === 0 ? { ...entry, relatedCards: ['不存在的目标'] } : entry), revision: savedData.revision })).status, 400);
    assert.equal((await post({ cards: updated, revision: savedData.revision }, 'https://other.example')).status, 403);
    assert.equal((await post({ cards: updated, revision: savedData.revision }, origin, '')).status, 403);
    assert.equal((await post({ cards: updated, revision: savedData.revision }, origin, 'wrong-token')).status, 403);
    assert.equal((await fetch(url, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await post({ cards: [], revision: savedData.revision })).status, 400);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), updated);
    const renamed = editCardIdentity(updated, 0, { name: '新名称' });
    renamed[0] = { ...renamed[0], level: 3, type: '装备', hidden: true, classes: ['游侠', '女骑士'] };
    const checked = await post({ cards: renamed, revision: savedData.revision, dryRun: true });
    assert.equal(checked.status, 200);
    assert.deepEqual(await checked.json(), { valid: true });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), updated);
    // A preview proxy presents a different public Origin than the upstream Host.
    const changed = await post({ cards: renamed, revision: savedData.revision }, 'https://openchamber-preview.localhost:5422', saveToken, 'same-origin');
    assert.equal(changed.status, 200);
    const changedData = await changed.json();
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), renamed);
    // Force a chunk boundary inside the Chinese image path, independent of TCP buffering.
    const nextCards = renamed.map((entry) => ({ ...entry, cost: 2 }));
    const bytes = Buffer.from(JSON.stringify({ cards: nextCards, revision: changedData.revision }));
    const split = bytes.indexOf(Buffer.from('assets/card_base/落石1.png')) + Buffer.byteLength('assets/card_base/') + 1;
    assert.ok(split > Buffer.byteLength('assets/'));
    const request = Object.assign(Readable.from([bytes.subarray(0, split), bytes.subarray(split)]), {
      url: '/__card-editor/cards?group=base', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-card-editor-token': saveToken, 'sec-fetch-site': 'same-origin' },
    });
    let splitStatus = 0;
    let splitBody = '';
    await middleware(request, {
      removeHeader() {},
      writeHead(status: number) { splitStatus = status; },
      end(body: string) { splitBody = body; },
    }, () => assert.fail('请求不应跳过编辑接口'));
    assert.equal(splitStatus, 200, splitBody);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), nextCards);
    assert.match(await readFile(file, 'utf8'), /assets\/card_base\/落石1.png/);
    assert.doesNotMatch(await readFile(file, 'utf8'), /�/);
    const replaced = await post({ cards: [{ ...nextCards[0], image: 'assets/other.png' }, nextCards[1]], revision: JSON.parse(splitBody).revision });
    assert.equal(replaced.status, 400);
    assert.match((await replaced.json()).error, /assets\/other.png/);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), nextCards);
    assert.equal(await readFile(siblingFile, 'utf8'), sibling);
    assert.equal(await readFile(extraFile, 'utf8'), extra);
    assert.equal((await fetch(`${origin}/__card-editor/cards?group=..%2Fsecret`)).status, 400);
    assert.equal((await fetch(`${origin}/__card-editor/cards?group=missing`)).status, 404);
    assert.equal((await post({ cards: nextCards.map((entry) => ({ ...entry, group: 'diary' })), revision: JSON.parse(splitBody).revision })).status, 400);
    // A newer sibling file must not cause a false conflict or be overwritten.
    const externalSibling = JSON.stringify([{ ...JSON.parse(sibling)[0], cost: 5 }]);
    await writeFile(siblingFile, externalSibling);
    const independentSave = await post({ cards: nextCards, revision: JSON.parse(splitBody).revision });
    assert.equal(independentSave.status, 200);
    assert.equal(await readFile(siblingFile, 'utf8'), externalSibling);
    const latestRevision = (await independentSave.json()).revision;
    const crossGroupCards = nextCards.map((entry: Card, index: number) => index === 0 ? { ...entry, relatedCards: ['日记卡'] } : entry);
    const crossGroupSave = await post({ cards: crossGroupCards, revision: latestRevision });
    assert.equal(crossGroupSave.status, 200);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8'))[0].relatedCards, ['日记卡']);
    assert.equal(await readFile(siblingFile, 'utf8'), externalSibling);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
