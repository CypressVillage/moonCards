import { readdir, lstat, readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import sharp from 'sharp';
import { readCardStore, readGroupSettings } from './card-store.mjs';
import { describeGroup, resolveRelatedCards, sortGroupIds, validGroupId } from './card-groups.mjs';
import { validateCards } from './validate-cards.mjs';
import { commitChanges, fingerprint, jsonText, managedPath, optionalRead, problem, safeProjectPath } from './managed-files.mjs';

export const imageExtension = /\.(png|jpe?g|webp)$/i;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 40 * 1024 * 1024;

export async function scanCardAssets(root) {
  const store = await readCardStore(root);
  const settings = await readGroupSettings(root);
  const references = new Map();
  for (const card of store.cards) references.set(card.image, [...(references.get(card.image) ?? []), card]);
  const groups = new Map(store.groups.map((group) => [group.id, { ...describeGroup(group.id, settings.groups), hasMetadata: true, folderExists: false }]));
  let folders = [];
  try { folders = await readdir(await safeProjectPath(root, 'assets'), { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const assets = [];
  async function visit(folder, group) {
    for (const entry of await readdir(await safeProjectPath(root, folder), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) await visit(path, group);
      else if (entry.isFile() && imageExtension.test(entry.name)) {
        const stat = await lstat(await managedPath(root, path));
        const refs = references.get(path) ?? [];
        assets.push({ path, group, name: entry.name, status: refs.length ? 'registered' : 'unregistered', references: refs.length, size: stat.size, mtime: stat.mtimeMs });
      }
    }
  }
  for (const folder of folders) {
    const id = folder.name.replace(/^card_/, '');
    if (!folder.name.startsWith('card_') || !folder.isDirectory() || !validGroupId(id)) continue;
    groups.set(id, { ...describeGroup(id, settings.groups), hasMetadata: store.groups.some((group) => group.id === id), folderExists: true });
    await visit(`assets/${folder.name}`, id);
  }
  const found = new Set(assets.map((asset) => asset.path));
  for (const [path, refs] of references) {
    if (!found.has(path)) assets.push({ path, group: refs[0].group, name: basename(path), status: 'missing', references: refs.length, size: 0, mtime: 0 });
  }
  assets.sort((a, b) => a.path.localeCompare(b.path));
  const version = fingerprint(JSON.stringify([store.groups.map((group) => [group.id, group.text]), fingerprint(settings.bytes), assets]));
  const categories = sortGroupIds([...groups.keys()]).map((id) => {
    const own = assets.filter((asset) => asset.group === id);
    return { ...groups.get(id), registered: own.filter((asset) => asset.status === 'registered').length,
      unregistered: own.filter((asset) => asset.status === 'unregistered').length,
      missing: own.filter((asset) => asset.status === 'missing').length,
      recordCount: store.cards.filter((card) => card.group === id).length };
  });
  return { store, groups: categories, assets, version, settings };
}

function checkedFilename(name) {
  if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 180
    || /[\\/\x00-\x1f\x7f�]/.test(name) || !imageExtension.test(name) || name.startsWith('.')) throw problem('图片文件名无效；请使用 PNG、JPEG 或 WebP，不能包含路径或控制字符');
  return name;
}

async function validateImage(bytes, name) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw problem('图片大小必须在 0～20 MB 之间');
  let metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    await sharp(bytes, { limitInputPixels: 40_000_000 }).stats(); // Decode validation only; no image output.
  }
  catch { throw problem('不是有效图片，或图片尺寸过大'); }
  const expected = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' }[extname(name).toLowerCase()];
  if (metadata.format !== expected || !metadata.width || !metadata.height) throw problem('图片实际格式与扩展名不一致');
}

export async function validateRegistrationImage(root, path, group) {
  if (typeof path !== 'string' || !path.startsWith(`assets/card_${group}/`)) throw problem(`图片必须属于当前文件夹：${String(path)}`);
  const bytes = await optionalRead(await managedPath(root, path));
  if (bytes === null) throw problem(`待收录图片不存在：${path}`, 404);
  await validateImage(bytes, basename(path));
  return { path, bytes };
}

export async function readAssetImage(root, path) {
  const group = typeof path === 'string' ? path.split('/')[1]?.replace(/^card_/, '') : null;
  if (typeof path !== 'string' || !/^assets\/card_[a-z][a-z0-9_]*\//.test(path) || !validGroupId(group)) throw problem('非法图片路径', 403);
  const absolute = await managedPath(root, path);
  const bytes = await optionalRead(absolute);
  if (bytes === null) throw problem('图片不存在', 404);
  return { bytes, type: { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(path).toLowerCase()] };
}

export async function prepareAssetAction(root, payload) {
  const snapshot = await scanCardAssets(root);
  if (!payload || payload.version !== snapshot.version) throw problem('图片或元数据已被其他程序修改，请刷新扫描后重试', 409);
  const changes = [];
  const summary = [];
  let relocation = null;
  const addChange = async (path, after) => changes.push({ path, before: await optionalRead(await managedPath(root, path)), after: after === null ? null : Buffer.isBuffer(after) ? after : Buffer.from(after) });
  const updated = new Map(snapshot.store.groups.map((group) => [group.id, group.cards]));
  const source = snapshot.assets.find((asset) => asset.path === payload.path);
  const requireSource = () => { if (!source || source.status === 'missing') throw problem('源图片不存在或不在允许的卡牌目录中', 404); };

  if (payload.action === 'register') {
    requireSource();
    if (source.references) throw problem('该图片已经收录，请编辑已有卡牌');
    const card = payload.card;
    if (!card || card.image !== source.path || card.group !== source.group) throw problem('卡牌分组和图片必须与源文件一致');
    await validateRegistrationImage(root, source.path, source.group);
    updated.set(source.group, [...(updated.get(source.group) ?? []), card]);
    summary.push(`收录图片：${source.path}`, `添加「${card.name}」到 data/cards/${source.group}.json 末尾；不修改源图片`);
  } else if (payload.action === 'rename' || payload.action === 'move') {
    requireSource();
    let target;
    let targetGroup = source.group;
    if (payload.action === 'rename') {
      const name = checkedFilename(payload.name);
      if (extname(name) !== extname(source.path)) throw problem('重命名时请保留原图片扩展名');
      target = `${source.path.slice(0, source.path.lastIndexOf('/') + 1)}${name}`;
    } else {
      const category = snapshot.groups.find((group) => group.id === payload.targetGroup && group.folderExists);
      if (!category) throw problem('目标卡牌目录不存在');
      targetGroup = category.id;
      target = `${category.folder}/${basename(source.path)}`;
    }
    if (target === source.path) throw problem('目标与当前路径相同，无需操作');
    if (payload.action === 'move') relocation = { from: source.path, to: target, group: targetGroup };
    if (await optionalRead(await managedPath(root, target)) !== null) throw problem(`目标图片已存在，不会覆盖：${target}`, 409);
    const bytes = await readFile(await managedPath(root, source.path));
    await addChange(target, bytes);
    changes.push({ path: source.path, before: bytes, after: null });
    const moved = [];
    for (const [id, cards] of updated) {
      if (payload.action === 'rename') updated.set(id, cards.map((card) => card.image === source.path ? { ...card, image: target } : card));
      else {
        moved.push(...cards.filter((card) => card.image === source.path).map((card) => ({ ...card, image: target, group: targetGroup })));
        updated.set(id, cards.filter((card) => card.image !== source.path));
      }
    }
    if (moved.length) updated.set(targetGroup, [...(updated.get(targetGroup) ?? []), ...moved]);
    summary.push(`${payload.action === 'rename' ? '重命名' : '移动'}：${source.path} → ${target}`, `同步 ${source.references} 条图片引用；卡牌名称不变`);
  } else if (payload.action === 'delete') {
    requireSource();
    const bytes = await readFile(await managedPath(root, source.path));
    changes.push({ path: source.path, before: bytes, after: null });
    summary.push(`删除源图片：${source.path}`, source.references ? `保留 ${source.references} 条元数据和关联，界面将标注源图缺失；不自动删除卡牌记录` : '未收录图片已移除，不创建或修改卡牌 JSON', '原文件字节备份保存在 .card-editor/transactions/');
  } else if (payload.action === 'label' || payload.action === 'group-settings') {
    const current = snapshot.groups.find((group) => group.id === payload.group);
    if (!current) throw problem('分组不存在');
    const label = typeof payload.label === 'string' ? payload.label.trim() : '';
    if (!label || label.length > 60 || /[\x00-\x1f\x7f]/.test(label)) throw problem('分组显示名称须为 1～60 个正常字符');
    const mode = payload.action === 'group-settings' ? payload.mode : current.mode;
    if (!['classic', 'diary'].includes(mode)) throw problem('分组模式必须是 classic 或 diary');
    const config = snapshot.settings.groups ?? Object.fromEntries(snapshot.groups.map((group) => [group.id, { label: group.label, mode: group.mode }]));
    const existing = config[payload.group];
    await addChange('data/groups.json', jsonText({ ...config, [payload.group]: { ...(typeof existing === 'object' && existing !== null ? existing : {}), label, mode } }));
    summary.push(`更新分组设置：${payload.group} → ${label}（${mode === 'diary' ? '日记职业称呼' : '经典职业称呼'}）`, '仅更新 data/groups.json；目录、group ID、卡牌记录及统一职业值不变');
  } else if (payload.action === 'upload') {
    const category = snapshot.groups.find((group) => group.id === payload.group && group.folderExists);
    if (!category) throw problem('请先选择已存在的卡牌目录');
    if (!Array.isArray(payload.files) || !payload.files.length || payload.files.length > 20) throw problem('每次请选择 1～20 张图片');
    let total = 0;
    const targets = new Set();
    for (const file of payload.files) {
      const name = checkedFilename(file?.name);
      const path = `${category.folder}/${name}`;
      if (targets.has(path) || await optionalRead(await managedPath(root, path)) !== null) throw problem(`图片同名，不会覆盖：${name}`, 409);
      targets.add(path);
      if (typeof file.base64 !== 'string') throw problem('上传图片编码无效');
      if (file.base64.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3)) throw problem('单张图片不能超过 20 MB');
      if (file.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(file.base64)) throw problem('上传图片编码无效');
      const bytes = Buffer.from(file.base64, 'base64');
      if (bytes.length > MAX_IMAGE_BYTES) throw problem('单张图片不能超过 20 MB');
      if (bytes.toString('base64') !== file.base64) throw problem('上传图片编码无效');
      total += bytes.length;
      if (total > MAX_BATCH_BYTES) throw problem('单次上传总大小不能超过 40 MB');
      await validateImage(bytes, name);
      changes.push({ path, before: null, after: bytes });
    }
    summary.push(`上传 ${payload.files.length} 张原始图片到 ${category.folder}/，保持原始字节，不生成卡牌记录`);
    summary.push(...payload.files.map((file) => `新增图片：${category.folder}/${file.name}`));
  } else throw problem('不支持的图片操作');

  const merged = [...updated.values()].flat();
  const errors = validateCards(merged);
  if (errors.length) throw problem(`操作会造成元数据冲突或关联失效，请先修正后重试：\n${errors.join('\n')}`);
  if (relocation) {
    // A name may still exist after a move but resolve to a different card.
    // Do not silently retarget either outgoing or incoming relationships.
    const identity = (card, before = false) => JSON.stringify([before && card.image === relocation.from ? relocation.to : card.image, card.name, card.level]);
    for (const owner of snapshot.store.cards) {
      if (!owner.relatedCards.length) continue;
      const movedOwner = owner.image === relocation.from ? { ...owner, group: relocation.group, image: relocation.to } : owner;
      for (const name of owner.relatedCards) {
        const before = resolveRelatedCards(snapshot.store.cards, owner.group, name).map((card) => identity(card, true)).sort();
        const after = resolveRelatedCards(merged, movedOwner.group, name).map((card) => identity(card)).sort();
        if (JSON.stringify(before) !== JSON.stringify(after)) throw problem(`移动会改变「${owner.name} → ${name}」的关联目标或星级范围。请先明确移除或调整关联，再移动；不会自动猜测新目标。`);
      }
    }
  }
  for (const [id, cards] of updated) {
    const previous = snapshot.store.groups.find((group) => group.id === id);
    if (JSON.stringify(cards) === JSON.stringify(previous?.cards ?? [])) continue;
    const path = `data/cards/${id}.json`;
    await addChange(path, jsonText(cards));
    summary.push(`更新 ${path}（${cards.length} 条）`);
  }
  return { changes, summary, version: snapshot.version };
}

export async function performAssetAction(root, payload) {
  const prepared = await prepareAssetAction(root, payload);
  if (payload.dryRun === true) return { summary: prepared.summary, version: prepared.version };
  if ((await scanCardAssets(root)).version !== prepared.version) throw problem('预检查后文件发生变化，请重新确认', 409);
  await commitChanges(root, prepared.changes);
  return { summary: prepared.summary };
}
