import { validateRegistrationImage } from './card-assets.mjs';
import { problem } from './managed-files.mjs';

export async function validateCardBatch(root, group, original, cards) {
  if (cards.length < original.length) throw problem('不能删除已有卡牌记录；此次未写入文件');
  const counts = (entries) => {
    const result = new Map();
    for (const card of entries) result.set(card.image, (result.get(card.image) ?? 0) + 1);
    return result;
  };
  const expected = counts(original);
  const actual = counts(cards);
  for (const path of actual.keys()) {
    if (typeof path !== 'string' || !path.startsWith(`assets/card_${group}/`)) throw problem(`图片必须属于当前文件夹：${String(path)}`);
  }
  for (const [path, count] of expected) {
    if (actual.get(path) !== count) throw problem(`已有图片记录不一致：${path}。只能编辑元数据或新增未收录图片，不能删除、替换已有图片或增加其记录。`);
  }
  const newImages = [];
  for (const [path, count] of actual) {
    if (expected.has(path)) continue;
    if (count !== 1) throw problem(`同一张未收录图片不能重复添加：${path}`);
    newImages.push(await validateRegistrationImage(root, path, group));
  }
  return newImages;
}
