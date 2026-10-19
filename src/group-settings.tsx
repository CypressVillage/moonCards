import { useEffect, useRef, useState } from 'react';
import type { CardCategory } from './card-data.ts';
import { diaryProfessionOrder, professionLabel } from './professions.ts';
import type { GroupMode } from './professions.ts';
import { isErrorMessage } from './editor-feedback.ts';

export function GroupSettingsDialog({ group, busy, message, onSave, onClose }: {
  group: CardCategory; busy: boolean; message: string;
  onSave: (label: string, mode: GroupMode) => Promise<boolean>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [label, setLabel] = useState(group.label);
  const [mode, setMode] = useState<GroupMode>(group.mode ?? 'classic');
  const changed = label.trim() !== group.label || mode !== (group.mode ?? 'classic');
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (changed && !busy) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [changed, busy]);
  async function save() { if (await onSave(label.trim(), mode)) onClose(); }
  return <dialog ref={dialog} className="editor-detail editor-dialog group-settings-dialog" aria-labelledby="group-settings-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <button className="editor-dialog-close" type="button" aria-label="关闭分组设置" disabled={busy} onClick={onClose}>×</button>
    <h2 id="group-settings-title">分组设置</h2>
    <p className="editor-hint">{group.folder} · {group.file}</p>
    <form onSubmit={(event) => { event.preventDefault(); if (!busy && changed && label.trim()) void save(); }}>
      <fieldset className="group-settings-fields" disabled={busy}>
        <legend className="editor-visually-hidden">分组显示名称和职业模式</legend>
        <label className="group-label-field">分组显示名称<input aria-label="分组显示名称" value={label} maxLength={60} required onChange={(event) => setLabel(event.target.value)} /></label>
        <label className="group-mode-option"><input type="checkbox" aria-label="日记文件夹" checked={mode === 'diary'} onChange={(event) => setMode(event.target.checked ? 'diary' : 'classic')} /><span>日记文件夹</span></label>
        <p className="editor-hint">勾选后使用：{diaryProfessionOrder.map((profession) => professionLabel(profession, 'diary')).join('、')}。取消勾选后恢复经典称呼。</p>
        <p className="editor-hint">只切换职业显示名称和编辑选项，不改目录、卡牌 group 或已有 classes。检索始终使用同一套职业值；未包含在映射中的已有职业保留原名。</p>
      </fieldset>
      {message && <p className={isErrorMessage(message) ? 'editor-errors' : 'editor-message'} role={isErrorMessage(message) ? 'alert' : 'status'}>{message}</p>}
      <div className="editor-actions editor-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="editor-save" disabled={busy || !changed || !label.trim()}>{busy ? '保存中…' : '保存分组设置'}</button></div>
    </form>
  </dialog>;
}
