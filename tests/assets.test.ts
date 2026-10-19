import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, access, symlink, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Card } from '../src/catalog.ts';
import { appendRegistrationDraft, editCard, moveCard } from '../src/editor-model.ts';
// @ts-expect-error Shared Node asset service is plain JavaScript.
import { scanCardAssets, performAssetAction, readAssetImage, MAX_IMAGE_BYTES } from '../scripts/card-assets.mjs';
// @ts-expect-error Shared Node transaction implementation is plain JavaScript.
import { commitChanges, recoverTransactions, managedPath } from '../scripts/managed-files.mjs';
// @ts-expect-error Shared Node middleware is plain JavaScript.
import { cardEditorApi } from '../scripts/card-editor-api.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const source = 'assets/card_base/共享.png';
const card = (group: string, name: string, level: number | null = 1, image = `assets/card_${group}/${name}.png`): Card => ({ name, group, level, image, classes: [], type: '攻击', cost: null, relatedCards: [] });

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp('/tmp/opencode/card-assets-');
  try {
    await mkdir(`${root}/data/cards`, { recursive: true });
    for (const group of ['base', 'base_extra', 'diary', 'skill']) await mkdir(`${root}/assets/card_${group}`, { recursive: true });
    await writeFile(`${root}/data/cards/base.json`, JSON.stringify([card('base', 'A', 1, source), card('base', 'A', 2, source)]));
    await writeFile(`${root}/data/cards/base_extra.json`, '[]');
    await writeFile(`${root}/data/cards/diary.json`, JSON.stringify([card('diary', '日记')]));
    for (const path of [source, 'assets/card_base/未收录.png', 'assets/card_diary/日记.png', 'assets/card_skill/技能.png']) await writeFile(`${root}/${path}`, png);
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function files(root: string, relative = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(`${root}/${relative}`, { withFileTypes: true })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await files(root, path)); else found.push(path);
  }
  return found.sort();
}
async function action(root: string, payload: Record<string, unknown>) {
  return performAssetAction(root, { version: (await scanCardAssets(root)).version, ...payload });
}

test('扫描仅限卡牌目录，识别同图多记录和未收录，不建档、不生成图片', async () => fixture(async (root) => {
  await mkdir(`${root}/assets/paints`); await writeFile(`${root}/assets/paints/立绘.png`, png);
  const before = await files(root);
  const snapshot = await scanCardAssets(root);
  assert.equal(snapshot.assets.find((asset: { path: string }) => asset.path === source).references, 2);
  assert.equal(snapshot.groups.find((group: { id: string }) => group.id === 'skill').hasMetadata, false);
  assert.equal(snapshot.assets.filter((asset: { status: string }) => asset.status === 'unregistered').length, 2);
  assert.ok(!snapshot.assets.some((asset: { path: string }) => asset.path.includes('paints')));
  assert.deepEqual((await readAssetImage(root, source)).bytes, png);
  assert.deepEqual(await files(root), before);
}));

test('源图缺失仍保留 JSON 记录并明确标注，不静默删除', async () => fixture(async (root) => {
  await unlink(`${root}/${source}`);
  const original = await readFile(`${root}/data/cards/base.json`, 'utf8');
  const snapshot = await scanCardAssets(root);
  assert.equal(snapshot.assets.find((asset: { path: string }) => asset.path === source).status, 'missing');
  assert.equal(snapshot.groups.find((group: { id: string }) => group.id === 'base').missing, 1);
  assert.equal(await readFile(`${root}/data/cards/base.json`, 'utf8'), original);
  await assert.rejects(action(root, { action: 'rename', path: source, name: '新名.png' }), /源图片不存在/);
}));

test('显式收录才创建目标 JSON；预检查不写入，其他文件和图片字节不变', async () => fixture(async (root) => {
  const original = await readFile(`${root}/data/cards/base.json`);
  const payload = { action: 'register', path: 'assets/card_skill/技能.png', card: card('skill', '自定卡名', null, 'assets/card_skill/技能.png') };
  await action(root, { ...payload, dryRun: true });
  await assert.rejects(access(`${root}/data/cards/skill.json`));
  await action(root, payload);
  assert.deepEqual(JSON.parse(await readFile(`${root}/data/cards/skill.json`, 'utf8')), [payload.card]);
  assert.deepEqual(await readFile(`${root}/assets/card_skill/技能.png`), png);
  assert.deepEqual(await readFile(`${root}/data/cards/base.json`), original);
  await assert.rejects(action(root, payload), /已经收录/);
}));

test('中文源图重命名同步全部等级引用，不改卡名、不重绘图片', async () => fixture(async (root) => {
  const diary = await readFile(`${root}/data/cards/diary.json`);
  await action(root, { action: 'rename', path: source, name: '中文新名字.png' });
  await assert.rejects(access(`${root}/${source}`));
  assert.deepEqual(await readFile(`${root}/assets/card_base/中文新名字.png`), png);
  const cards = JSON.parse(await readFile(`${root}/data/cards/base.json`, 'utf8'));
  assert.deepEqual(cards.map((entry: Card) => [entry.name, entry.level, entry.image]), [['A', 1, 'assets/card_base/中文新名字.png'], ['A', 2, 'assets/card_base/中文新名字.png']]);
  assert.deepEqual(await readFile(`${root}/data/cards/diary.json`), diary);
}));

test('移动已收录图片迁移所有引用并追加到目标组，保留目标已有顺序', async () => fixture(async (root) => {
  await action(root, { action: 'move', path: source, targetGroup: 'diary' });
  const destination = JSON.parse(await readFile(`${root}/data/cards/diary.json`, 'utf8'));
  assert.deepEqual(destination.map((entry: Card) => entry.name), ['日记', 'A', 'A']);
  assert.ok(destination.slice(1).every((entry: Card) => entry.group === 'diary' && entry.image === 'assets/card_diary/共享.png'));
  assert.deepEqual(JSON.parse(await readFile(`${root}/data/cards/base.json`, 'utf8')), []);
  assert.deepEqual(await readFile(`${root}/assets/card_diary/共享.png`), png);
}));

test('未收录图片移动不创建 JSON，已收录移动到新目录才显式建档', async () => fixture(async (root) => {
  await action(root, { action: 'move', path: 'assets/card_base/未收录.png', targetGroup: 'skill' });
  await assert.rejects(access(`${root}/data/cards/skill.json`));
  await action(root, { action: 'move', path: source, targetGroup: 'skill' });
  assert.equal(JSON.parse(await readFile(`${root}/data/cards/skill.json`, 'utf8')).length, 2);
}));

test('同名文件和重复星级阻止移动，跨组关联不应再被误拒绝', async () => fixture(async (root) => {
  await writeFile(`${root}/assets/card_diary/共享.png`, png);
  await assert.rejects(action(root, { action: 'move', path: source, targetGroup: 'diary' }), /目标图片已存在/);
  await unlink(`${root}/assets/card_diary/共享.png`);
  await writeFile(`${root}/data/cards/diary.json`, JSON.stringify([card('diary', 'A')]));
  await writeFile(`${root}/assets/card_diary/A.png`, png);
  await assert.rejects(action(root, { action: 'move', path: source, targetGroup: 'diary' }), /重复/);
  await writeFile(`${root}/data/cards/diary.json`, '[]');
  const records = JSON.parse(await readFile(`${root}/data/cards/base.json`, 'utf8'));
  records.push({ ...card('base', '引用者'), relatedCards: ['A'] });
  await writeFile(`${root}/data/cards/base.json`, JSON.stringify(records));
  await writeFile(`${root}/assets/card_base/引用者.png`, png);
  await action(root, { action: 'move', path: source, targetGroup: 'diary' });
  assert.deepEqual(await readFile(`${root}/assets/card_diary/共享.png`), png);
  const remaining = JSON.parse(await readFile(`${root}/data/cards/base.json`, 'utf8'));
  assert.deepEqual(remaining[0].relatedCards, ['A']);
}));

test('分组改名仅修改配置；上传保存原字节且保持未收录', async () => fixture(async (root) => {
  const before = await readFile(`${root}/data/cards/base.json`);
  await action(root, { action: 'label', group: 'base', label: '新的经典显示名' });
  assert.equal((await scanCardAssets(root)).groups.find((group: { id: string }) => group.id === 'base').label, '新的经典显示名');
  assert.deepEqual(await readFile(`${root}/data/cards/base.json`), before);
  await action(root, { action: 'upload', group: 'skill', files: [{ name: '上传中文.png', base64: png.toString('base64') }] });
  assert.deepEqual(await readFile(`${root}/assets/card_skill/上传中文.png`), png);
  await assert.rejects(access(`${root}/data/cards/skill.json`));
  assert.equal((await scanCardAssets(root)).assets.find((asset: { name: string }) => asset.name === '上传中文.png').status, 'unregistered');
}));

test('关联名称仍存在但跨组移动将指向另一张同名卡时，拒绝猜测目标', async () => fixture(async (root) => {
  const records = JSON.parse(await readFile(`${root}/data/cards/base.json`, 'utf8')).map((entry: Card) => ({ ...entry, relatedCards: ['日记'] }));
  records.push(card('base', '日记'));
  await writeFile(`${root}/data/cards/base.json`, JSON.stringify(records));
  await writeFile(`${root}/assets/card_base/日记.png`, png);
  await assert.rejects(action(root, { action: 'move', path: source, targetGroup: 'diary' }), /改变.*关联目标/);
  assert.deepEqual(await readFile(`${root}/${source}`), png);
  await assert.rejects(access(`${root}/assets/card_diary/共享.png`));
}));

test('日记文件夹设置只写配置，可取消且改显示名不会丢失模式，职业原值不变', async () => fixture(async (root) => {
  const baseFile = `${root}/data/cards/base.json`;
  const records = JSON.parse(await readFile(baseFile, 'utf8')).map((entry: Card) => ({ ...entry, classes: ['女骑士', '游侠', '修女'] }));
  await writeFile(baseFile, JSON.stringify(records));
  const metadata = ['base', 'base_extra', 'diary'];
  const before = await Promise.all(metadata.map((id) => readFile(`${root}/data/cards/${id}.json`)));
  await action(root, { action: 'group-settings', group: 'base', label: '经典目录使用日记称呼', mode: 'diary' });
  let snapshot = await scanCardAssets(root);
  assert.equal(snapshot.groups.find((group: { id: string }) => group.id === 'base').mode, 'diary');
  assert.equal(JSON.parse(await readFile(`${root}/data/groups.json`, 'utf8')).base.mode, 'diary');
  await action(root, { action: 'label', group: 'base', label: '只改显示名' });
  assert.equal(JSON.parse(await readFile(`${root}/data/groups.json`, 'utf8')).base.mode, 'diary');
  const settingsBefore = await readFile(`${root}/data/groups.json`);
  await assert.rejects(action(root, { action: 'group-settings', group: 'base', label: '无效模式', mode: 'wrong' }), /classic 或 diary/);
  assert.deepEqual(await readFile(`${root}/data/groups.json`), settingsBefore);
  await action(root, { action: 'group-settings', group: 'base', label: '只改显示名', mode: 'classic' });
  snapshot = await scanCardAssets(root);
  assert.equal(snapshot.groups.find((group: { id: string }) => group.id === 'base').mode, 'classic');
  await action(root, { action: 'group-settings', group: 'skill', label: '新日记目录', mode: 'diary' });
  await assert.rejects(access(`${root}/data/cards/skill.json`));
  for (const [index, id] of metadata.entries()) assert.deepEqual(await readFile(`${root}/data/cards/${id}.json`), before[index]);
  assert.deepEqual(await readFile(`${root}/${source}`), png);
}));

test('上传拒绝伪装文件、路径、过大图片及同名文件，批次不部分写入', async () => fixture(async (root) => {
  for (const file of [{ name: '../越界.png', base64: png.toString('base64') }, { name: '伪装.png', base64: Buffer.from('not an image').toString('base64') }, { name: '格式错误.jpg', base64: png.toString('base64') }]) {
    await assert.rejects(action(root, { action: 'upload', group: 'base', files: [file] }));
  }
  await assert.rejects(action(root, { action: 'upload', group: 'base', files: [{ name: '先上传.png', base64: png.toString('base64') }, { name: '共享.png', base64: png.toString('base64') }] }), /不会覆盖/);
  await assert.rejects(access(`${root}/assets/card_base/先上传.png`));
  const large = Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64');
  await assert.rejects(action(root, { action: 'upload', group: 'base', files: [{ name: '过大.png', base64: large }] }), /20 MB/);
}));

test('外部修改使扫描版本过期，拒绝写入而不丢弃外部改动', async () => fixture(async (root) => {
  const snapshot = await scanCardAssets(root);
  await writeFile(`${root}/assets/card_base/外部新增.png`, png);
  await assert.rejects(performAssetAction(root, { action: 'rename', path: source, name: '新.png', version: snapshot.version }), /其他程序修改/);
  assert.deepEqual(await readFile(`${root}/${source}`), png);
}));

test('符号链接、目录穿越和非卡牌目录不能预览或写入', async () => fixture(async (root) => {
  await writeFile(`${root}/secret.png`, png);
  await symlink(`${root}/secret.png`, `${root}/assets/card_base/链接.png`);
  await symlink(`${root}/assets/card_base`, `${root}/assets/card_link`);
  for (const path of ['assets/card_base/链接.png', 'assets/card_link/共享.png', 'assets/card_base/../../secret.png', 'assets/paints/a.png', 'data/cards/base.json', '/etc/passwd']) await assert.rejects(readAssetImage(root, path));
  assert.ok(!(await scanCardAssets(root)).assets.some((asset: { name: string }) => asset.name === '链接.png'));
  await assert.rejects(managedPath(root, 'data/cards/../../secret.json'));
}));

test('多文件操作中途失败回滚，保留备份日志，不留下半移动状态', async () => fixture(async (root) => {
  const original = await readFile(`${root}/data/cards/base.json`);
  const destination = 'assets/card_diary/恢复.png';
  await assert.rejects(commitChanges(root, [
    { path: destination, before: null, after: png }, { path: source, before: png, after: null },
    { path: 'data/cards/base.json', before: original, after: Buffer.from('[]') },
  ], { afterApply(index: number) { if (index === 2) throw new Error('模拟故障'); } }), /模拟故障/);
  assert.deepEqual(await readFile(`${root}/${source}`), png);
  assert.deepEqual(await readFile(`${root}/data/cards/base.json`), original);
  await assert.rejects(access(`${root}/${destination}`));
  const journals = await readdir(`${root}/.card-editor/transactions`);
  assert.equal(JSON.parse(await readFile(`${root}/.card-editor/transactions/${journals[0]}`, 'utf8')).state, 'rolled_back');
}));

test('重启可恢复未完成操作；恢复遇到外部修改时保留现场并阻止覆盖', async () => fixture(async (root) => {
  const destination = 'assets/card_diary/恢复.png';
  const journalDirectory = `${root}/.card-editor/transactions`;
  await mkdir(journalDirectory, { recursive: true });
  const journalPath = `${journalDirectory}/12345678-1234-1234-1234-123456789abc.json`;
  const journal = { state: 'pending', entries: [{ path: destination, before: null, after: png.toString('base64') }, { path: source, before: png.toString('base64'), after: null }] };
  await writeFile(journalPath, JSON.stringify(journal)); await writeFile(`${root}/${destination}`, png); await unlink(`${root}/${source}`);
  await recoverTransactions(root);
  assert.deepEqual(await readFile(`${root}/${source}`), png);
  await assert.rejects(access(`${root}/${destination}`));
  await writeFile(journalPath, JSON.stringify(journal));
  await writeFile(`${root}/${destination}`, Buffer.from('external edit'));
  await assert.rejects(recoverTransactions(root), /外部改动/);
  assert.equal(await readFile(`${root}/${destination}`, 'utf8'), 'external edit');
}));

test('本地 HTTP 扫描、原图预览和收录；缺失令牌或跨站操作被拒绝', async () => fixture(async (root) => {
  const middleware = cardEditorApi(root);
  const server = createServer((req, res) => void middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const loaded = await (await fetch(`${origin}/__card-editor/cards?group=skill`)).json();
    assert.deepEqual(loaded.cards, []); assert.equal(loaded.revision, 'missing');
    const image = await fetch(`${origin}/__card-editor/image?path=${encodeURIComponent(source)}`);
    assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    const snapshot = await (await fetch(`${origin}/__card-editor/assets`)).json();
    const payload = { action: 'register', version: snapshot.version, path: 'assets/card_skill/技能.png', card: card('skill', '新卡', null, 'assets/card_skill/技能.png') };
    const url = `${origin}/__card-editor/assets`;
    const post = (token: string, site = 'same-origin') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Card-Editor-Token': token, 'Sec-Fetch-Site': site }, body: JSON.stringify(payload) });
    assert.equal((await post('')).status, 403);
    assert.equal((await post(snapshot.saveToken, 'cross-site')).status, 403);
    assert.equal((await post(snapshot.saveToken)).status, 200);
    assert.equal(JSON.parse(await readFile(`${root}/data/cards/skill.json`, 'utf8'))[0].name, '新卡');
    const latest = await (await fetch(`${origin}/__card-editor/assets`)).json();
    const before = await readFile(`${root}/data/cards/base.json`);
    const settingsResponse = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Card-Editor-Token': latest.saveToken },
      body: JSON.stringify({ action: 'group-settings', group: 'base', label: '可编辑日记组', mode: 'diary', version: latest.version }) });
    assert.equal(settingsResponse.status, 200);
    const updated = await (await fetch(`${origin}/__card-editor/cards?group=base`)).json();
    assert.equal(updated.groups.find((group: { id: string }) => group.id === 'base').mode, 'diary');
    assert.deepEqual(await readFile(`${root}/data/cards/base.json`), before);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}));

test('其他进程仍存活的事务不会被启动恢复误回滚，写入会被阻止', async () => fixture(async (root) => {
  const destination = 'assets/card_diary/尚在操作.png';
  await mkdir(`${root}/.card-editor/transactions`, { recursive: true });
  await writeFile(`${root}/${destination}`, png);
  await writeFile(`${root}/.card-editor/transactions/12345678-1234-1234-1234-123456789abc.json`, JSON.stringify({ state: 'pending', pid: process.pid,
    entries: [{ path: destination, before: null, after: png.toString('base64') }] }));
  await recoverTransactions(root);
  assert.deepEqual(await readFile(`${root}/${destination}`), png);
  await assert.rejects(commitChanges(root, [{ path: 'data/groups.json', before: null, after: Buffer.from('{}') }]), /另一个开发服务进程/);
  await assert.rejects(access(`${root}/data/groups.json`));
}));

test('暂存多张新卡不写文件，统一保存时与旧卡修改、排序和草稿关联一次写入', async () => fixture(async (root) => {
  await writeFile(`${root}/assets/card_base/第二张.png`, png);
  const file = `${root}/data/cards/base.json`;
  const before = await readFile(file);
  const sibling = await readFile(`${root}/data/cards/diary.json`);
  const middleware = cardEditorApi(root);
  const server = createServer((req, res) => void middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const url = `${origin}/__card-editor/cards?group=base`;
  try {
    const loaded = await (await fetch(url)).json();
    let drafts = editCard(loaded.cards, 0, { cost: 3 });
    drafts = appendRegistrationDraft(drafts, card('base', '新卡一', null, 'assets/card_base/未收录.png'));
    drafts = appendRegistrationDraft(drafts, card('base', '新卡二', null, 'assets/card_base/第二张.png'));
    drafts = editCard(drafts, 2, { relatedCards: ['新卡二'] });
    drafts = moveCard(drafts, 3, 0);
    assert.deepEqual(await readFile(file), before);
    const post = (cards: Card[], dryRun = false, revision = loaded.revision) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Card-Editor-Token': loaded.saveToken }, body: JSON.stringify({ cards, revision, dryRun }) });
    assert.equal((await post(drafts.filter((entry) => !(entry.name === 'A' && entry.level === 1)))).status, 400);
    assert.equal((await post([...drafts, card('base', '已有图片多加一条', 3, source)])).status, 400);
    assert.deepEqual(await readFile(file), before);
    assert.equal((await post(drafts, true)).status, 200);
    assert.deepEqual(await readFile(file), before);
    const response = await post(drafts);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).added, 2);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), drafts);
    assert.deepEqual(await readFile(`${root}/data/cards/diary.json`), sibling);
    assert.deepEqual(await readFile(`${root}/assets/card_base/未收录.png`), png);
    const persisted = await readFile(file);
    assert.equal((await post(drafts)).status, 409);
    assert.deepEqual(await readFile(file), persisted);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}));

test('首次建档也只在统一保存时创建 JSON，缺图或无效图片使整批保存失败', async () => fixture(async (root) => {
  const middleware = cardEditorApi(root);
  const server = createServer((req, res) => void middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const url = `${origin}/__card-editor/cards?group=skill`;
  try {
    const loaded = await (await fetch(url)).json();
    const drafts = appendRegistrationDraft(loaded.cards, card('skill', '新技能', null, 'assets/card_skill/技能.png'));
    const file = `${root}/data/cards/skill.json`;
    const post = (cards: Card[], dryRun = false) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Card-Editor-Token': loaded.saveToken }, body: JSON.stringify({ cards, revision: loaded.revision, dryRun }) });
    await assert.rejects(access(file));
    assert.equal((await post([], false)).status, 400);
    assert.equal((await post([...drafts, card('skill', '缺失')])).status, 404);
    await writeFile(`${root}/assets/card_skill/伪装.png`, Buffer.from('not an image'));
    assert.equal((await post([...drafts, card('skill', '伪装')])).status, 400);
    assert.equal((await post([...drafts, { ...drafts[0], name: '重复图片' }])).status, 400);
    await assert.rejects(access(file));
    assert.equal((await post(drafts, true)).status, 200);
    await assert.rejects(access(file));
    assert.equal((await post(drafts)).status, 200);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), drafts);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}));
