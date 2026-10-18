import { mkdir, copyFile, access, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { validateCards } from './validate-cards.mjs';
import { readCardStore } from './card-store.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { cards } = await readCardStore(root);
const errors = validateCards(cards);
const images = [...new Set(cards.map((card) => card?.image).filter((image) => typeof image === 'string'))];
// Do not access paths until structural validation has succeeded.
if (!errors.length) {
  for (const image of images) {
    try { await access(resolve(root, image)); }
    catch { errors.push(`图片不存在：${image}`); }
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
if (process.argv.includes('--check')) {
  console.log(`校验通过：${cards.length} 条记录，${images.length} 张图片。`);
} else {
  // These two directories contain generated files only; never touch the source assets/.
  await rm(resolve(root, 'public/assets'), { recursive: true, force: true });
  await rm(resolve(root, 'public/thumbnails'), { recursive: true, force: true });
  // Bound concurrency so a large catalog does not decode every original at once.
  let cursor = 0;
  const worker = async () => {
    while (cursor < images.length) {
      const image = images[cursor++];
      const source = resolve(root, image);
      const original = resolve(root, 'public', image);
      const thumbnail = resolve(root, 'public/thumbnails', image.replace(/\.[^.]+$/, '.webp'));
      await mkdir(dirname(original), { recursive: true });
      await mkdir(dirname(thumbnail), { recursive: true });
      await copyFile(source, original);
      await sharp(source).resize({ width: 360, withoutEnlargement: true }).webp({ quality: 82 }).toFile(thumbnail);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, images.length) }, worker));
  console.log(`已准备 ${images.length} 张原图和 WebP 缩略图。`);
}
