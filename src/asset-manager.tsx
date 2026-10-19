import { useEffect, useRef, useState } from 'react';
import type { CardCategory } from './card-data.ts';

export interface CardAsset {
  path: string; group: string; name: string; status: 'registered' | 'unregistered' | 'missing';
  references: number; size: number; mtime: number;
}
export type AssetAction = Record<string, unknown> & { action: string };
export const sourcePreviewUrl = (path: string) => `${import.meta.env.BASE_URL}__card-editor/image?path=${encodeURIComponent(path)}`;

export function UnregisteredGallery({ assets, onOpen, busy }: { assets: CardAsset[]; onOpen: (asset: CardAsset) => void; busy: boolean }) {
  if (!assets.length) return null;
  return <section className="asset-unregistered" aria-label="未收录图片"><h2>未收录图片 <small>{assets.length} 张 · 仅显示源图，不会自动入库</small></h2>
    <div className="editor-thumbnail-grid">{assets.map((asset) => <article className="editor-thumbnail is-unregistered" key={asset.path}>
      <div className="editor-thumbnail-meta"><span>未收录</span><span>{asset.group}</span></div>
      <button className="editor-thumbnail-open" disabled={busy} onClick={() => onOpen(asset)} aria-label={`管理未收录图片${asset.name}`}>
        <div className="asset-muted-preview"><img src={sourcePreviewUrl(asset.path)} alt={asset.name} loading="lazy" decoding="async" width="517" height="780" draggable={false} /><span>未收录</span></div>
        <strong>{asset.name}</strong><small>点击预览 / 收录 / 管理文件</small>
      </button>
    </article>)}</div>
  </section>;
}

export function UploadImages({ group, disabled, disabledReason, onAction, onError }: {
  group: string; disabled: boolean; disabledReason?: string; onAction: (action: AssetAction) => Promise<boolean>; onError: (error: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  async function upload(files: File[]) {
    if (disabled || reading || !files.length) return;
    if (files.length > 20 || files.some((file) => file.size > 20 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 40 * 1024 * 1024) {
      onError('一次最多上传 20 张；单张不超过 20 MB，总大小不超过 40 MB。'); return;
    }
    setReading(true);
    try {
      const encoded = [];
      for (const file of files) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
          reader.readAsDataURL(file);
        });
        encoded.push({ name: file.name, base64 });
      }
      await onAction({ action: 'upload', group, files: encoded });
    } catch (error) { onError(String(error)); }
    finally { setReading(false); if (input.current) input.current.value = ''; }
  }
  const help = `${disabledReason ? `${disabledReason}。` : ''}上传到 card_${group}；支持 PNG、JPEG、WebP。一次最多 20 张，单张 20 MB，总计 40 MB。上传后为未收录图片，原图不加工。`;
  return <div className={`asset-upload-zone compact${disabled ? ' disabled' : ''}`} title={help} onDragOver={(event) => {
    if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'; }
  }} onDrop={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); void upload([...event.dataTransfer.files]); } }}>
    <input ref={input} type="file" accept=".png,.jpg,.jpeg,.webp" multiple hidden disabled={disabled || reading} onChange={(event) => void upload([...(event.target.files ?? [])])} />
    <button type="button" aria-label={`上传本地图片到 card_${group}`} aria-describedby={`upload-help-${group}`} disabled={disabled || reading} onClick={() => input.current?.click()}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" /></svg><span>{reading ? '正在读取图片…' : '上传图片 / 拖入'}</span></button>
    <span className="editor-visually-hidden" id={`upload-help-${group}`}>{help}</span>
  </div>;
}

export function AssetDialog({ asset, groups, busy, message, onClose, onAction, onRegister }: {
  asset: CardAsset; groups: CardCategory[]; busy: boolean; message: string; onClose: () => void;
  onAction: (action: AssetAction) => Promise<boolean>; onRegister: (asset: CardAsset) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(asset.name);
  const [target, setTarget] = useState('');
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = overflow; };
  }, []);
  async function perform(action: AssetAction) { if (await onAction(action)) onClose(); }
  return <dialog ref={dialog} className="editor-detail editor-dialog asset-dialog" aria-labelledby="asset-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <button className="editor-dialog-close" aria-label="关闭图片管理" disabled={busy} onClick={onClose}>×</button>
    <h2 id="asset-dialog-title">源图片管理</h2>
    <p className="editor-hint">{asset.status === 'unregistered' ? '未收录图片' : asset.status === 'missing' ? '源图片缺失' : `已收录 · ${asset.references} 条记录引用此图片`}</p>
    {asset.status !== 'missing' && <img className="asset-original-preview" src={sourcePreviewUrl(asset.path)} alt={asset.name} />}
    <code className="asset-path">{asset.path}</code>
    {message && <p className="editor-message" role="status">{message}</p>}
    {asset.status === 'missing' ? <p className="editor-errors">源文件不存在，元数据仍被保留。请先恢复图片并重新扫描，不会自动删除记录。</p> : <fieldset className="asset-file-fields" disabled={busy}>
      <legend>点击操作按钮后立即执行；保留冲突检查和备份，不会改变图片内容</legend>
      <label>图片文件名（不是卡牌名称，保留扩展名）<input aria-label="图片文件名" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <button disabled={busy || name === asset.name} onClick={() => void perform({ action: 'rename', path: asset.path, name })}>重命名源图片并同步引用</button>
      <label>移动到文件夹<select aria-label="图片移动目标文件夹" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">选择目标文件夹…</option>{groups.filter((group) => group.id !== asset.group && group.folderExists).map((group) => <option key={group.id} value={group.id}>{group.label} · card_{group.id}</option>)}</select></label>
      <button disabled={busy || !target} onClick={() => void perform({ action: 'move', path: asset.path, targetGroup: target })}>移动源图片及其卡牌记录</button>
      <p className="editor-hint">同名文件不会覆盖。已收录图片的全部引用一并迁移，目标组追加记录；有关联失效或同名同星冲突时阻止操作，请先修正。</p>
    </fieldset>}
    <div className="editor-actions editor-dialog-actions"><button disabled={busy} onClick={onClose}>返回缩略图</button>{asset.status === 'unregistered' && <button className="editor-save" disabled={busy} onClick={() => onRegister(asset)}>填写元数据，添加为新卡牌</button>}</div>
  </dialog>;
}
