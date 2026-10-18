import { useEffect, useRef, useState } from 'react';
import type { Card } from './catalog.ts';
import { levelLabel } from './catalog.ts';
import { editCard, editCardIdentity, moveCard, searchRelatedCards } from './editor-model.ts';
// @ts-expect-error Shared browser/Node validator is plain JavaScript.
import { validateCards, cardTypes as allowedCardTypes } from '../scripts/validate-cards.mjs';
import './editor.css';

const endpoint = `${import.meta.env.BASE_URL}__card-editor/cards`;
const professions = ['女骑士', '游侠', '小女巫', '修女', '魔术师', '药剂师', '狼人', '契约师', '机械师', '调灵师', '猎魔人', '小猪妖'];
const levels = [{ label: '无', value: null }, { label: '一星', value: 1 }, { label: '二星', value: 2 }, { label: '三星', value: 3 }];
const cardTypes: string[] = allowedCardTypes;
const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.split('/').map(encodeURIComponent).join('/')}`;

export function CardEditor({ initialCards }: { initialCards: Card[] }) {
  const [cards, setCards] = useState<Card[]>(() => structuredClone(initialCards));
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState('');
  const [relatedQuery, setRelatedQuery] = useState('');
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState('');
  const [busy, setBusy] = useState(import.meta.env.DEV);
  const [message, setMessage] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const drag = useRef<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const card = cards[selected];
  const local = import.meta.env.DEV;
  const errors: string[] = validateCards(cards);

  async function load() {
    setBusy(true);
    try {
      const response = await fetch(endpoint);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setCards(data.cards); setRevision(data.revision); setDirty(false); setSelected(0);
      setMessage('已读取本地 data/cards.json');
    } catch (error) { setMessage(`读取失败：${String(error)}`); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (local) void load(); }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!detailOpen || !element) return;
    element.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = previous; };
  }, [detailOpen]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  function update(patch: Partial<Card>) {
    setCards((previous) => editCard(previous, selected, patch)); setDirty(true); setMessage('');
  }
  function updateIdentity(patch: Pick<Partial<Card>, 'name' | 'diary'>) {
    try {
      setCards(editCardIdentity(cards, selected, patch)); setDirty(true); setMessage(''); return true;
    } catch (error) { setMessage(String(error)); return false; }
  }
  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= cards.length) return;
    const active = cards[selected];
    const result = moveCard(cards, from, to);
    setCards(result); setSelected(result.indexOf(active)); setDirty(true); setMessage('');
  }
  async function save() {
    setBusy(true);
    try {
      // Refresh only the token, not the editing state or original file revision.
      // This also survives a development-server restart without losing edits.
      const authorization = await fetch(endpoint, { cache: 'no-store' });
      const access = await authorization.json();
      if (!authorization.ok) throw new Error(access.error);
      if (access.editorApiVersion !== 2) throw new Error('开发服务仍在运行旧版保存接口，可能误拒绝名称或类别修改。请先导出 JSON 备份，再重启 npm run dev。');
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Card-Editor-Token': access.saveToken }, body: JSON.stringify({ cards, revision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRevision(data.revision); setDirty(false); setMessage('已保存到本地 data/cards.json');
    } catch (error) { setMessage(`保存失败：${String(error)}`); }
    finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(cards, null, 2)}\n`], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'cards.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('已导出 JSON；尚未写入项目文件。');
  }
  useEffect(() => { setRelatedQuery(''); }, [selected, card?.diary]);
  const related = card ? searchRelatedCards(cards, card, relatedQuery) : [];
  return <main className="editor-page">
    <div className="editor-heading"><div><p className="eyebrow">LOCAL CARD WORKSHOP</p><h1>卡牌元数据编辑</h1><p>{cards.length} 条版本记录 · {dirty ? '有未保存修改' : '无未保存修改'}</p></div>
      <div className="editor-actions"><a href={import.meta.env.BASE_URL} onClick={(event) => { if (dirty && !window.confirm('修改尚未保存，确定离开？')) event.preventDefault(); }}>返回图鉴</a>
        {local && <button disabled={busy} onClick={() => { if (!dirty || window.confirm('丢弃未保存修改并重新读取文件？')) void load(); }}>重新载入</button>}
        <button onClick={download} disabled={busy || errors.length > 0}>导出 JSON</button>
        {local && <button className="editor-save" onClick={() => void save()} disabled={busy || !dirty || !revision || errors.length > 0}>{busy ? '处理中…' : '保存到本地 JSON'}</button>}</div></div>
    <p className="editor-notice">{local ? '保存会直接写入 data/cards.json。修改完成后再保存，返回图鉴可查看最新数据。' : '静态网站模式：仅能导出 JSON，请手动替换项目中的 data/cards.json。'} 直接拖动缩略图调整 JSON 原始顺序，点击卡牌打开编辑窗口。关闭窗口会保留本次修改，最后统一保存。可见性对同名卡牌的所有星级同步生效。</p>
    {message && <p className="editor-message" role="status">{message}</p>}
    {errors.length > 0 && <div className="editor-errors" role="alert"><strong>请修正后再保存或导出：</strong>{errors.slice(0, 8).map((error, index) => <p key={index}>{error}</p>)}</div>}
    <div className="editor-workspace" aria-busy={busy}>
      <section aria-label="卡牌缩略图排序"><div className="editor-gallery-toolbar"><label className="editor-gallery-search">查找卡牌<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入卡牌名称" /></label><p>{query.trim() ? '搜索结果保留原始序号，拖动会调整完整 JSON 的顺序。' : '按 JSON 顺序排列 · 拖动排序 · 点击编辑'}</p></div>
        <div className="editor-thumbnail-grid">{cards.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.name.includes(query.trim())).map(({ entry, index }) =>
          <article key={entry.image + index} draggable={!busy} className={`editor-thumbnail${dragging === index ? ' is-dragging' : ''}${dropTarget === index && dragging !== index ? ' is-drop-target' : ''}`}
            onDragStart={(event) => { drag.current = index; setDragging(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }}
            onDragEnd={() => { drag.current = null; setDragging(null); setDropTarget(null); }}
            onDragOver={(event) => { if (busy || drag.current === null) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(index); }}
            onDrop={(event) => { event.preventDefault(); if (!busy && drag.current !== null) move(drag.current, index); drag.current = null; setDragging(null); setDropTarget(null); }}>
            <div className="editor-thumbnail-meta"><span>#{index + 1}</span><span>{entry.hidden ? '隐藏' : entry.diary ? '日记' : '经典'} <span aria-hidden="true">⠿</span></span></div>
            <button disabled={busy} className="editor-thumbnail-open" aria-label={`编辑${entry.name}·${levelLabel(entry.level)}·第${index + 1}条`} onClick={() => { if (drag.current !== null) return; setSelected(index); setDetailOpen(true); }}>
              <img src={assetUrl(`thumbnails/${entry.image.replace(/\.[^.]+$/, '.webp')}`)} alt={entry.name} loading="lazy" decoding="async" width="517" height="780" draggable={false} />
              <strong>{entry.name}</strong><small>{entry.diary ? '日记' : '经典'} · {levelLabel(entry.level)} · {entry.type}</small>
            </button>
            {dropTarget === index && dragging !== index && <span className="editor-drop-label">放到第 {index + 1} 位</span>}
          </article>)}</div>
        {!cards.some((entry) => entry.name.includes(query.trim())) && <p className="editor-gallery-empty">没有找到匹配的卡牌，请尝试其他名称。</p>}
      </section>
      {card && <dialog ref={dialog} className="editor-detail editor-dialog" aria-labelledby="editor-card-title" onCancel={(event) => { event.preventDefault(); setDetailOpen(false); }} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setDetailOpen(false); } }}>
        <button className="editor-dialog-close" type="button" aria-label="关闭卡牌编辑" onClick={() => setDetailOpen(false)}>×</button>
        <div className="editor-card-heading"><img src={assetUrl(`thumbnails/${card.image.replace(/\.[^.]+$/, '.webp')}`)} alt={card.name} /><div><p>第 {selected + 1} 条 / {cards.length}</p><h2 id="editor-card-title">{card.name}</h2><p>{card.diary ? '小红帽日记' : '经典模式'}</p><code>{card.image}</code></div></div>
        {message && <p className="editor-message" role="status">{message}</p>}
        {errors.length > 0 && <div className="editor-errors" role="alert">{errors.slice(0, 8).map((error, index) => <p key={index}>{error}</p>)}</div>}
        <fieldset key={`${card.image}:${revision}`} disabled={busy} className="editor-fields"><legend>元数据</legend>
          <div className="editor-position"><button disabled={busy || selected === 0} onClick={() => move(selected, selected - 1)}>↑ 上移</button><button disabled={busy || selected === cards.length - 1} onClick={() => move(selected, selected + 1)}>↓ 下移</button><label>移至第 <input key={`position-${selected}`} type="number" min="1" max={cards.length} defaultValue={selected + 1} onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= cards.length) move(selected, value - 1); }} /> 条</label></div>
          <label className="editor-wide">卡牌名称（仅修改当前记录，离开输入框时应用）<input key={`name-${selected}-${card.name}`} defaultValue={card.name} onChange={() => setDirty(true)} onBlur={(event) => { const name = event.target.value.trim(); event.target.value = name === card.name || updateIdentity({ name }) ? name : card.name; }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
          <fieldset className="editor-options editor-wide"><legend>类别（仅修改当前记录）</legend><div className="editor-choice-grid">
            {[{ label: '经典', value: false }, { label: '日记', value: true }].map(({ label, value }) => <label className="editor-choice" key={label}><input type="radio" name="card-mode" checked={card.diary === value} onChange={() => updateIdentity({ diary: value })} />{label}</label>)}
          </div></fieldset>
          <fieldset className="editor-options editor-wide"><legend>可获得职业（可多选，不勾选表示未标注）</legend><div className="editor-choice-grid">
            {professions.map((profession) => <label className="editor-choice" key={profession}><input type="checkbox" checked={card.classes.includes(profession)} onChange={(event) => update({ classes: event.target.checked ? [...card.classes, profession] : card.classes.filter((name) => name !== profession) })} />{profession}</label>)}
          </div>{card.classes.some((name) => !professions.includes(name)) && <p className="editor-hint">其他已有职业（保留原值）：{card.classes.filter((name) => !professions.includes(name)).join('、')}</p>}</fieldset>
          <fieldset className="editor-options editor-wide"><legend>星级（单选）</legend><div className="editor-choice-grid">
            {levels.map(({ label, value }) => <label className="editor-choice" key={label}><input type="radio" name="card-level" value={value === null ? 'null' : value} checked={card.level === value} onChange={() => update({ level: value })} />{label}</label>)}
          </div></fieldset>
          <fieldset className="editor-options editor-wide"><legend>类型（单选）</legend><div className="editor-choice-grid">
            {cardTypes.map((type) => <label className="editor-choice" key={type}><input type="radio" name="card-type" checked={card.type === type} onChange={() => update({ type })} />{type}</label>)}
          </div></fieldset>
          <label>能耗（空为未标注）<input key={`cost-${selected}`} defaultValue={card.cost ?? ''} placeholder="0、1、2… 或 X" onChange={(event) => { const value = event.target.value.trim().toUpperCase(); update({ cost: value === '' ? null : value === 'X' ? 'X' : /^\d+$/.test(value) ? Number(value) : NaN }); }} /></label>
          <label className="editor-check"><input type="checkbox" checked={!card.hidden} onChange={(event) => update({ hidden: !event.target.checked })} />在图鉴和搜索结果中显示</label>
          <div className="editor-wide"><p className="editor-field-label">关联卡牌（同模式，可多选）</p><div className="related-selected">{card.relatedCards.map((name) => <button key={name} onClick={() => update({ relatedCards: card.relatedCards.filter((value) => value !== name) })}>{name} ×</button>)}{!card.relatedCards.length && <span>暂无关联卡牌</span>}</div>
            <input type="search" aria-label="搜索关联卡牌" placeholder="输入名称搜索同模式卡牌…" value={relatedQuery} onChange={(event) => setRelatedQuery(event.target.value)} />
            <div className="editor-related-results" aria-label="关联卡牌搜索结果">{related.length ? related.map((name) => <button key={name} type="button" onClick={() => { update({ relatedCards: [...card.relatedCards, name] }); setRelatedQuery(''); }}>{name}<span>＋ 添加</span></button>) : <p>没有可添加的匹配卡牌</p>}</div></div>
          <p className="editor-wide editor-hint">名称和类别仅修改当前记录，允许同名不同星级；只有类别、名称、星级全部相同才算重复。同名卡牌的可见性仍同步所有星级。若旧名称还有其他星级，关联引用保持不变；否则同类别重命名会更新引用。切换类别后的失效关联需按提示修正，图片路径保持不变。</p>
        </fieldset>
        <div className="editor-actions editor-dialog-actions"><button type="button" onClick={() => setDetailOpen(false)}>完成编辑，返回缩略图</button>{local ? <button className="editor-save" onClick={() => void save()} disabled={busy || !dirty || !revision || errors.length > 0}>保存到本地 JSON</button> : <button onClick={download} disabled={busy || errors.length > 0}>导出 JSON</button>}</div>
      </dialog>}
    </div>
  </main>;
}
