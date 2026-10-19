import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath, readFile, writeFile, mkdir, rename, unlink, link, readdir } from 'node:fs/promises';
import { resolve, dirname, relative as relativePath, isAbsolute, sep } from 'node:path';

export const fingerprint = (value) => value === null ? 'missing' : createHash('sha256').update(value).digest('hex');
export const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;
export function problem(message, status = 400) { return Object.assign(new Error(message), { status }); }
export async function optionalRead(path) {
  try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function safeProjectPath(root, relative) {
  if (typeof relative !== 'string' || /[\\\x00-\x1f\x7f]/.test(relative)
    || relative.split('/').some((part) => !part || part === '.' || part === '..')) throw problem('非法文件路径', 403);
  const base = await realpath(root);
  let current = base;
  for (const part of relative.split('/')) {
    current = resolve(current, part);
    const inside = relativePath(base, current);
    if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw problem('文件路径越界', 403);
    try { if ((await lstat(current)).isSymbolicLink()) throw problem('不允许通过符号链接操作文件', 403); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return current;
}

export async function managedPath(root, relative) {
  if (!(typeof relative === 'string' && (/^assets\/card_[a-z][a-z0-9_]*\/.+\.(png|jpe?g|webp)$/i.test(relative)
    || /^data\/cards\/[a-z][a-z0-9_]*\.json$/.test(relative) || relative === 'data/groups.json'))) {
    throw problem('只能操作卡牌图片或分组元数据', 403);
  }
  return safeProjectPath(root, relative);
}

async function replaceBytes(path, bytes, expected) {
  const current = await optionalRead(path);
  if (fingerprint(current) !== fingerprint(expected)) throw problem(`文件被其他程序修改：${path}`, 409);
  if (bytes === null) { if (current !== null) await unlink(path); return; }
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, bytes, { flag: 'wx' });
    if (fingerprint(await optionalRead(path)) !== fingerprint(expected)) throw problem(`文件在写入时变化：${path}`, 409);
    if (expected === null) { await link(temp, path); }
    else { await rename(temp, path); }
  } finally { await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
}

async function saveJournal(path, journal, initial = false) {
  const content = Buffer.from(jsonText(journal));
  if (initial) await writeFile(path, content, { flag: 'wx' });
  else await replaceBytes(path, content, await optionalRead(path));
}

async function rollback(root, entries) {
  // Never overwrite an external change during recovery.
  for (const entry of [...entries].reverse()) {
    const path = await managedPath(root, entry.path);
    const before = entry.before === null ? null : Buffer.from(entry.before, 'base64');
    const after = entry.after === null ? null : Buffer.from(entry.after, 'base64');
    const current = await optionalRead(path);
    if (fingerprint(current) === fingerprint(before)) continue;
    if (fingerprint(current) !== fingerprint(after)) throw problem(`恢复被外部改动阻止：${entry.path}。请保留 .card-editor/ 中的备份并人工核对。`, 409);
    await replaceBytes(path, before, current);
  }
}

export async function commitChanges(root, changes, options = {}) {
  await recoverTransactions(root, { forWrite: true });
  const paths = new Set();
  for (const change of changes) {
    if (paths.has(change.path)) throw problem('操作包含重复文件');
    paths.add(change.path);
    const path = await managedPath(root, change.path);
    if (fingerprint(await optionalRead(path)) !== fingerprint(change.before)) throw problem(`文件已变更：${change.path}`, 409);
  }
  const directory = await safeProjectPath(root, '.card-editor/transactions');
  await mkdir(directory, { recursive: true });
  const journalPath = resolve(directory, `${randomUUID()}.json`);
  const journal = { state: 'pending', pid: process.pid, createdAt: new Date().toISOString(), entries: changes.map((change) => ({
    path: change.path, before: change.before?.toString('base64') ?? null, after: change.after?.toString('base64') ?? null,
  })) };
  await saveJournal(journalPath, journal, true);
  try {
    for (const [index, change] of changes.entries()) {
      await replaceBytes(await managedPath(root, change.path), change.after, change.before);
      await options.afterApply?.(index);
    }
    journal.state = 'completed';
    await saveJournal(journalPath, journal);
  } catch (error) {
    try { await rollback(root, journal.entries); journal.state = 'rolled_back'; }
    catch (recoveryError) { journal.state = 'recovery_required'; journal.error = recoveryError.message; }
    await saveJournal(journalPath, journal);
    if (journal.state === 'recovery_required') throw problem(journal.error, 409);
    throw error;
  }
  return journalPath;
}

export async function recoverTransactions(root, { forWrite = false } = {}) {
  const directory = await safeProjectPath(root, '.card-editor/transactions');
  let files;
  try { files = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const file of files.filter((file) => /^[a-f0-9-]+\.json$/.test(file))) {
    const path = await safeProjectPath(root, `.card-editor/transactions/${file}`);
    const journal = JSON.parse(await readFile(path, 'utf8'));
    if (!['pending', 'recovery_required'].includes(journal.state)) continue;
    if (journal.state === 'pending' && Number.isInteger(journal.pid)) {
      let alive = true;
      try { process.kill(journal.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      if (alive) {
        if (forWrite) throw problem('另一个开发服务进程仍在操作文件，请等待完成，不要同时启动多个写入服务', 409);
        continue; // Never roll back a live operation from another development server.
      }
    }
    await rollback(root, journal.entries);
    journal.state = 'rolled_back';
    await saveJournal(path, journal);
  }
}
