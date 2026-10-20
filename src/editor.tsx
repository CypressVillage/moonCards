import { useEffect, useRef, useState } from 'react';
import type { Card } from './catalog.ts';
import type { CardCategory } from './card-data.ts';
// @ts-expect-error Shared group definitions are plain JavaScript.
import { describeGroup, validGroupId } from '../scripts/card-groups.mjs';
import { levelLabel, relatedVariants } from './catalog.ts';
import { appendRegistrationDraft, availableUnregisteredAssets, editCard, editCardIdentity, filterEditorCards, moveCard, pendingRegistrationImages, removeCard, searchRelatedCards, withdrawRegistrationDraft } from './editor-model.ts';
// @ts-expect-error Shared browser/Node validator is plain JavaScript.
import { validateCards, cardTypes as allowedCardTypes } from '../scripts/validate-cards.mjs';
import './editor.css';
import { AssetDialog, UnregisteredGallery, UploadImages, sourcePreviewUrl } from './asset-manager.tsx';
import type { AssetAction, CardAsset } from './asset-manager.tsx';
import { isErrorMessage, isTransientMessage } from './editor-feedback.ts';
import { professionChoices, professionLabel, sortedCardProfessions } from './professions.ts';
import { GroupSettingsDialog } from './group-settings.tsx';

const endpoint = `${import.meta.env.BASE_URL}__card-editor/cards`;
const levels = [{ label: '无', value: null }, { label: '一星', value: 1 }, { label: '二星', value: 2 }, { label: '三星', value: 3 }];
const cardTypes: string[] = allowedCardTypes;
const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.split('/').map(encodeURIComponent).join('/')}`;

export function CardEditor({ initialCards, categories }: { initialCards: Card[]; categories: CardCategory[] }) {
  const requestedGroup = new URLSearchParams(window.location.search).get('group');
  const initialGroup = requestedGroup && (categories.some((group) => group.id === requestedGroup) || (import.meta.env.DEV && validGroupId(requestedGroup))) ? requestedGroup : categories[0]?.id ?? 'base';
  const [groupId, setGroupId] = useState(initialGroup);
  const [availableGroups, setAvailableGroups] = useState(categories);
  const [catalogCards, setCatalogCards] = useState(initialCards);
  const [assets, setAssets] = useState<CardAsset[]>([]);
  const [assetVersion, setAssetVersion] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [managedAsset, setManagedAsset] = useState<CardAsset | null>(null);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [candidate, setCandidate] = useState<Card | null>(null);
  const [candidateDirty, setCandidateDirty] = useState(false);
  const [cards, setCards] = useState<Card[]>(() => structuredClone(initialCards.filter((card) => card.group === initialGroup)));
  const savedCards = catalogCards.filter((card) => card.group === groupId);
  const unsavedImages = pendingRegistrationImages(cards, savedCards);
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
  const card = candidate ?? cards[selected];
  const local = import.meta.env.DEV;
  const errors: string[] = validateCards([...catalogCards.filter((entry) => entry.group !== groupId), ...cards]);
  const formErrors: string[] = candidate ? validateCards([...catalogCards.filter((entry) => entry.group !== groupId), ...cards, candidate]) : errors;
  const groupEndpoint = `${endpoint}?group=${encodeURIComponent(groupId)}`;
  const currentGroup: CardCategory = availableGroups.find((group) => group.id === groupId) ?? describeGroup(groupId);
  const professionMode = currentGroup.mode ?? 'classic';
  const professions = professionChoices(professionMode);
  const previewUrl = (path: string) => local ? sourcePreviewUrl(path) : assetUrl(`thumbnails/${path.replace(/\.[^.]+$/, '.webp')}`);

  async function load(target = groupId) {
    setBusy(true);
    try {
      const response = await fetch(`${endpoint}?group=${encodeURIComponent(target)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setCards(data.cards); setCatalogCards(data.catalogCards); setAvailableGroups(data.groups); setGroupId(target);
      setAssets(data.assets ?? []); setAssetVersion(data.assetVersion ?? ''); setCandidate(null); setCandidateDirty(false);
      setRevision(data.revision); setDirty(false); setSelected(0); setQuery('');
      setMessage('');
    } catch (error) { setMessage(`读取失败：${String(error)}`); }
    finally { setBusy(false); }
  }
  function selectGroup(target: string) {
    if (target === groupId || (dirty && !window.confirm('当前组有未保存修改。确定丢弃并切换分组？可先导出 JSON 备份。'))) return;
    setDetailOpen(false);
    if (local) void load(target);
    else {
      setGroupId(target); setCards(structuredClone(initialCards.filter((entry) => entry.group === target)));
      setSelected(0); setDirty(false); setQuery(''); setMessage('');
    }
  }
  useEffect(() => { if (local) void load(); }, []);
  useEffect(() => {
    if (!isTransientMessage(message)) return;
    const timer = window.setTimeout(() => setMessage(''), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('group', groupId);
    window.history.replaceState(null, '', url);
  }, [groupId]);
  useEffect(() => {
    const element = dialog.current;
    if (!detailOpen || !element) return;
    element.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = previous; };
  }, [detailOpen]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty || candidateDirty) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, candidateDirty]);
  function update(patch: Partial<Card>) {
    if (candidate) { setCandidate((previous) => previous ? { ...previous, ...patch } : previous); setCandidateDirty(true); return; }
    setCards((previous) => editCard(previous, selected, patch)); setDirty(true); setMessage('');
  }
  function updateIdentity(patch: Pick<Partial<Card>, 'name'>) {
    try {
      if (candidate) {
        if (!patch.name?.trim()) throw new Error('卡牌名称不能为空');
        setCandidate({ ...candidate, name: patch.name.trim() }); setCandidateDirty(true); return true;
      }
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
      const authorization = await fetch(groupEndpoint, { cache: 'no-store' });
      const access = await authorization.json();
      if (!authorization.ok) throw new Error(access.error);
      if (access.editorApiVersion !== 6) throw new Error('开发服务仍在运行旧版保存接口。请先导出 JSON 备份，再重启 npm run dev。');
      const orderedCards = sortedCardProfessions(cards, professionMode);
      const response = await fetch(groupEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Card-Editor-Token': access.saveToken }, body: JSON.stringify({ cards: orderedCards, revision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setCards(orderedCards); setRevision(data.revision); setCatalogCards([...access.catalogCards.filter((entry: Card) => entry.group !== groupId), ...orderedCards]);
      setDirty(false); setMessage(`已保存到本地 data/cards/${groupId}.json，其他组文件未修改`);
      try { await refreshInventory(); }
      catch (error) { setMessage(`元数据已保存，但扫描刷新失败：${String(error)}。请刷新扫描后再操作图片文件。`); }
    } catch (error) { setMessage(`保存失败：${String(error)}`); }
    finally { setBusy(false); }
  }
  async function refreshInventory() {
    const response = await fetch(`${import.meta.env.BASE_URL}__card-editor/assets`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setAssets(data.assets.filter((asset: CardAsset) => asset.group === groupId));
    setAssetVersion(data.version); setAvailableGroups(data.groups); setCatalogCards(data.catalogCards);
  }
  async function runAssetAction(action: AssetAction): Promise<boolean> {
    if (dirty || candidateDirty) {
      setMessage('请先保存当前元数据修改，再执行图片文件操作或修改分组设置。'); return false;
    }
    setBusy(true);
    const url = `${import.meta.env.BASE_URL}__card-editor/assets`;
    try {
      const authorization = await fetch(url, { cache: 'no-store' });
      const access = await authorization.json();
      if (!authorization.ok) throw new Error(access.error);
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Card-Editor-Token': access.saveToken }, body: JSON.stringify({ ...action, version: assetVersion }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDetailOpen(false); setCandidate(null); setCandidateDirty(false);
      await load(groupId);
      setMessage(`操作完成：\n${result.summary.join('\n')}`);
      return true;
    } catch (error) { setMessage(`操作失败：${String(error)}`); return false; }
    finally { setBusy(false); }
  }
  function beginRegistration(asset: CardAsset) {
    setManagedAsset(null); setCandidate({ name: asset.name.replace(/\.[^.]+$/, ''), group: asset.group, image: asset.path,
      level: null, classes: [], type: '', cost: null, relatedCards: [], hidden: false });
    setCandidateDirty(false); setRelatedQuery(''); setMessage('请选择卡牌类型并核对元数据；不会从文件名推断星级。'); setDetailOpen(true);
  }
  function collectCard() {
    if (!candidate || formErrors.length) return;
    try {
      if (candidate.group !== groupId) throw new Error('只能添加当前分组的卡牌');
      const next = appendRegistrationDraft(cards, candidate);
      setCards(next); setSelected(next.length - 1); setDirty(true);
      setCandidate(null); setCandidateDirty(false); setDetailOpen(false);
      setMessage('已收录到当前编辑列表，尚未保存 JSON。可继续收录，最后统一保存。');
    } catch (error) { setMessage(`收录失败：${String(error)}`); }
  }
  function withdrawDraft() {
    if (!card || !unsavedImages.has(card.image)) return;
    const next = withdrawRegistrationDraft(cards, card.image, savedCards);
    setCards(next); setSelected(Math.max(0, Math.min(selected, next.length - 1)));
    setDirty(JSON.stringify(next) !== JSON.stringify(savedCards)); setDetailOpen(false);
    setMessage('已撤销本次收录，源图片未删除，其他修改仍保留。');
  }
  function deleteRecord() {
    if (busy || candidate || !card) return;
    if (!window.confirm(`删除「${card.name} · ${levelLabel(card.level)}」这条已收录记录？\n仅删除当前记录，不删除源图片或同名的其他星级。${local ? '点击“保存到本地 JSON”后才会写入文件。' : '仅修改导出的 JSON，不会写入项目文件。'}`)) return;
    try {
      const next = removeCard(cards, selected, catalogCards.filter((entry) => entry.group !== groupId));
      setCards(next); setSelected(Math.max(0, Math.min(selected, next.length - 1)));
      setDirty(JSON.stringify(next) !== JSON.stringify(savedCards)); setDetailOpen(false);
      setMessage('已删除当前收录记录，源图片未删除，其他修改仍保留；尚未保存 JSON。');
    } catch (error) { setMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  function closeDetail() {
    if (candidateDirty && !window.confirm('放弃尚未收录的新卡牌草稿？源图片不会删除。')) return;
    setDetailOpen(false); setCandidate(null); setCandidateDirty(false);
  }
  function download() {
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(sortedCardProfessions(cards, professionMode), null, 2)}\n`], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${groupId}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('已导出 JSON；尚未写入项目文件。');
  }
  useEffect(() => { setRelatedQuery(''); }, [selected, groupId]);
  const relationshipCatalog = [...catalogCards.filter((entry) => entry.group !== groupId), ...cards];
  const related = card && relatedQuery.trim() ? searchRelatedCards(relationshipCatalog, card, relatedQuery) : [];
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));
  const matchesQuery = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const visibleStatus = statusFilter === 'pending' ? 'registered' : statusFilter;
  const missingImages = new Set(assets.filter((asset) => asset.status === 'missing').map((asset) => asset.path));
  const visibleCards = filterEditorCards(cards, query, visibleStatus, missingImages);
  const remainingAssets = availableUnregisteredAssets(assets, cards).map((asset) => ({ ...asset, status: 'unregistered' as const, references: 0 }));
  const unregistered = remainingAssets.filter((asset) => matchesQuery(asset.name) && ['all', 'unregistered'].includes(statusFilter));
  function editGroupSettings() {
    setMessage('');
    setGroupSettingsOpen(true);
  }
  return <main className="editor-page">
    <div className="editor-heading"><div className="editor-heading-copy"><h1>卡牌图片与元数据管理</h1><span className={`editor-save-state${dirty || candidateDirty ? ' is-dirty' : ''}`} aria-live="polite">{dirty || candidateDirty ? '有未保存修改' : '无未保存修改'}</span>{!local && <span className="editor-static-mode" title="静态网站仅支持已有元数据编辑和导出；扫描目录、上传及文件操作需要 npm run dev。">静态模式 · 仅导出</span>}</div>
      <div className="editor-actions"><a href={import.meta.env.BASE_URL} onClick={(event) => { if (dirty && !window.confirm('修改尚未保存，确定离开？')) event.preventDefault(); }}>返回图鉴</a>
        {local && <button disabled={busy} onClick={() => { if (!dirty || window.confirm('丢弃未保存修改并重新扫描文件？')) void load(); }}>刷新扫描</button>}
        <button onClick={download} disabled={busy || errors.length > 0}>导出 JSON</button>
        {local && <button className="editor-save" onClick={() => void save()} disabled={busy || !dirty || !revision || errors.length > 0}>{busy ? '处理中…' : '保存到本地 JSON'}</button>}</div></div>
    {errors.length > 0 && <div className="editor-errors" role="alert"><strong>请修正后再保存或导出：</strong>{errors.slice(0, 8).map((error, index) => <p key={index}>{error}</p>)}</div>}
    <div className="editor-workspace" aria-busy={busy}>
      <section aria-labelledby="editor-group-title">
        <div className="editor-group-header">
          <div className="editor-group-name"><h2 id="editor-group-title" title={currentGroup.label}>{currentGroup.label}</h2>{local && <button className="editor-group-rename" type="button" aria-label="编辑分组设置" title={dirty ? '请先保存元数据修改' : '分组设置：显示名称和日记文件夹'} disabled={busy || dirty} onClick={editGroupSettings}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z" /><path d="m14 5 5 5" /></svg></button>}</div>
          <p className="editor-group-meta" title={`${currentGroup.folder} · ${currentGroup.file}`}><code>card_{groupId}</code>{professionMode === 'diary' && <span>日记职业称呼</span>}<span>已收录记录 <strong>{cards.length}</strong></span>{local && <><span>未收录图片 <strong>{assetVersion ? remainingAssets.length : currentGroup.unregistered ?? 0}</strong></span>{(currentGroup.missing ?? 0) > 0 && <span className="editor-missing-count">缺图 <strong>{currentGroup.missing}</strong></span>}</>}</p>
          <label className="editor-folder-switch"><span className="editor-visually-hidden">切换文件夹</span><select aria-label="按文件夹选择编辑分组" title="切换文件夹" value={groupId} disabled={busy} onChange={(event) => selectGroup(event.target.value)}>{availableGroups.map((group) => <option key={group.id} value={group.id}>{group.label} · card_{group.id}</option>)}</select></label>
        </div>
        <div className="editor-controls">
          <label className="editor-status-filter">收录状态<select aria-label="图片收录状态" value={local ? visibleStatus : 'registered'} disabled={!local} onChange={(event) => setStatusFilter(event.target.value)}>{local && <option value="all">全部图片</option>}<option value="registered">已收录</option>{local && <><option value="unregistered">未收录</option><option value="missing">源图缺失</option></>}</select></label>
          <label className="editor-gallery-search">查找卡牌 / 文件名<input type="search" aria-label="查找卡牌或图片文件名" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入卡牌名称或图片文件名" /></label>
          <div className="editor-upload-field"><span className="editor-control-label">上传到当前文件夹</span>{local ? <UploadImages group={groupId} disabled={busy || dirty || !currentGroup.folderExists} disabledReason={dirty ? '请先保存元数据修改' : busy ? '正在处理，请稍后' : !currentGroup.folderExists ? '源文件夹不存在，暂时不能上传' : undefined} onReadingChange={setBusy} onAction={runAssetAction} onError={(error) => setMessage(`上传失败：${error}`)} /> : <div className="asset-upload-zone compact disabled" title="上传图片需要在本地运行 npm run dev"><button type="button" disabled>仅本地开发支持上传</button></div>}</div>
        </div>
        {message && !detailOpen && !managedAsset && !groupSettingsOpen && <div className={`editor-feedback${isTransientMessage(message) ? ' is-transient' : ''}${isErrorMessage(message) ? ' is-error' : ''}`} role={isErrorMessage(message) ? 'alert' : 'status'}><span>{message}</span><button type="button" aria-label="关闭提示" onClick={() => setMessage('')}>×</button></div>}
        {visibleCards.length > 0 && <h2 className="asset-section-heading">已收录记录 <small>{visibleCards.length} 条 · 拖动调整顺序，最后统一保存</small></h2>}
        <div className="editor-thumbnail-grid">{visibleCards.map(({ entry, index }) =>
          <article key={entry.image + index} draggable={!busy} className={`editor-thumbnail${dragging === index ? ' is-dragging' : ''}${dropTarget === index && dragging !== index ? ' is-drop-target' : ''}`}
            onDragStart={(event) => { drag.current = index; setDragging(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }}
            onDragEnd={() => { drag.current = null; setDragging(null); setDropTarget(null); }}
            onDragOver={(event) => { if (busy || drag.current === null) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(index); }}
            onDrop={(event) => { event.preventDefault(); if (!busy && drag.current !== null) move(drag.current, index); drag.current = null; setDragging(null); setDropTarget(null); }}>
            <div className="editor-thumbnail-meta"><span>#{index + 1}</span><span>{entry.hidden ? '隐藏' : entry.group} <span aria-hidden="true">⠿</span></span></div>
            <button disabled={busy} className="editor-thumbnail-open" aria-label={`编辑${entry.name}·${levelLabel(entry.level)}·第${index + 1}条`} onClick={() => { if (drag.current !== null) return; setSelected(index); setDetailOpen(true); }}>
              {byPath.get(entry.image)?.status === 'missing' ? <div className="asset-missing-preview">源图片缺失<br />元数据已保留</div> : <img src={previewUrl(entry.image)} alt={entry.name} loading="lazy" decoding="async" width="517" height="780" draggable={false} />}
              <strong>{entry.name}</strong><small>{levelLabel(entry.level)} · {entry.type}{byPath.get(entry.image)?.status === 'missing' ? ' · 图片缺失' : ''}</small>
            </button>
            {dropTarget === index && dragging !== index && <span className="editor-drop-label">放到第 {index + 1} 位</span>}
          </article>)}</div>
        {local && <UnregisteredGallery assets={unregistered} onOpen={(asset) => { setManagedAsset(asset); setMessage(''); }} busy={busy} />}
        {!visibleCards.length && !unregistered.length && <p className="editor-gallery-empty">没有找到匹配的记录或图片，请尝试其他名称或收录状态。</p>}
      </section>
      {card && <dialog ref={dialog} className="editor-detail editor-dialog" aria-labelledby="editor-card-title" onCancel={(event) => { event.preventDefault(); if (!busy) closeDetail(); }} onClick={(event) => { if (!busy && event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDetail(); } }}>
        <button className="editor-dialog-close" type="button" aria-label="关闭卡牌编辑" disabled={busy} onClick={closeDetail}>×</button>
        <div className="editor-card-heading">{byPath.get(card.image)?.status !== 'missing' && <img src={previewUrl(card.image)} alt={card.name} />}<div><p>{candidate ? '未收录图片 · 新卡牌草稿' : `组内第 ${selected + 1} 条 / ${cards.length}`}</p><h2 id="editor-card-title">{card.name}</h2><p>{currentGroup.label}</p><code>{card.image}</code></div></div>
        {message && <p className="editor-message" role="status">{message}</p>}
        {formErrors.length > 0 && <div className="editor-errors" role="alert">{formErrors.slice(0, 8).map((error, index) => <p key={index}>{error}</p>)}</div>}
        <fieldset key={`${card.image}:${revision}`} disabled={busy} className="editor-fields"><legend>元数据</legend>
          {!candidate && <div className="editor-position"><button disabled={busy || selected === 0} onClick={() => move(selected, selected - 1)}>↑ 上移</button><button disabled={busy || selected === cards.length - 1} onClick={() => move(selected, selected + 1)}>↓ 下移</button><label>移至第 <input key={`position-${selected}`} type="number" min="1" max={cards.length} defaultValue={selected + 1} onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= cards.length) move(selected, value - 1); }} /> 条</label></div>}
          <label className="editor-wide">卡牌名称（仅修改当前记录，离开输入框时应用）<input key={`name-${selected}-${card.name}`} defaultValue={card.name} onChange={() => candidate ? setCandidateDirty(true) : setDirty(true)} onBlur={(event) => { const name = event.target.value.trim(); event.target.value = name === card.name || updateIdentity({ name }) ? name : card.name; }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
          <fieldset className="editor-options editor-wide"><legend>可获得职业（可多选，不勾选表示无职业）</legend><div className="editor-choice-grid">
            {professions.map((profession) => <label className="editor-choice" key={profession}><input type="checkbox" value={profession} checked={card.classes.includes(profession)} onChange={(event) => update({ classes: event.target.checked ? [...card.classes, profession] : card.classes.filter((name) => name !== profession) })} />{professionLabel(profession, professionMode)}</label>)}
          </div>{card.classes.some((name) => !professions.includes(name)) && <p className="editor-hint">其他已有职业（保留原值）：{card.classes.filter((name) => !professions.includes(name)).join('、')}</p>}</fieldset>
          <fieldset className="editor-options editor-wide"><legend>星级（单选）</legend><div className="editor-choice-grid">
            {levels.map(({ label, value }) => <label className="editor-choice" key={label}><input type="radio" name="card-level" value={value === null ? 'null' : value} checked={card.level === value} onChange={() => update({ level: value })} />{label}</label>)}
          </div></fieldset>
          <fieldset className="editor-options editor-wide"><legend>类型（单选）</legend><div className="editor-choice-grid">
            {cardTypes.map((type) => <label className="editor-choice" key={type}><input type="radio" name="card-type" checked={card.type === type} onChange={() => update({ type })} />{type}</label>)}
          </div></fieldset>
          <label>能耗（空为无能耗）<input key={`cost-${selected}`} defaultValue={card.cost ?? ''} placeholder="0、1、2… 或 X" onChange={(event) => { const value = event.target.value.trim().toUpperCase(); update({ cost: value === '' ? null : value === 'X' ? 'X' : /^\d+$/.test(value) ? Number(value) : NaN }); }} /></label>
          <label className="editor-check"><input type="checkbox" checked={!!card.hidden} onChange={(event) => update({ hidden: event.target.checked })} />隐藏</label>
          <div className="editor-wide"><p className="editor-field-label">关联卡牌（全部分组，可多选）</p><div className="related-selected">{card.relatedCards.map((name) => <button key={name} onClick={() => update({ relatedCards: card.relatedCards.filter((value) => value !== name) })}>{name} ×</button>)}{!card.relatedCards.length && <span>暂无关联卡牌</span>}</div>
            <input type="search" aria-label="搜索关联卡牌" placeholder="输入名称搜索所有 JSON 中的卡牌…" value={relatedQuery} onChange={(event) => setRelatedQuery(event.target.value)} />
            {relatedQuery.trim() && <div className="editor-related-matches" aria-label="关联卡牌搜索结果">{related.length ? related.map((name) => {
              const targetGroup = relatedVariants(relationshipCatalog, card, name)[0]?.group;
              const label = availableGroups.find((group) => group.id === targetGroup)?.label ?? targetGroup;
              return <button key={name} type="button" onClick={() => { update({ relatedCards: [...card.relatedCards, name] }); setRelatedQuery(''); }}>{name}<span title={label}>{label} · ＋ 添加</span></button>;
            }) : <p>没有可添加的匹配卡牌</p>}</div>}</div>
          <p className="editor-wide editor-hint">名称仅修改当前记录；不同源图片允许同名同星级，图片操作仅在目标目录存在同名文件时阻止覆盖。可见性同步本组同名同类型卡牌的所有星级。重命名会在适用时更新本组引用，跨文件关联若失效需按校验提示先修正；图片路径保持不变。</p>
        </fieldset>
        <div className="editor-actions editor-dialog-actions"><button type="button" disabled={busy} onClick={closeDetail}>{candidate ? '取消收录' : '完成编辑，返回缩略图'}</button>{local && !candidate && unsavedImages.has(card.image) && <button type="button" disabled={busy} onClick={withdrawDraft}>撤销本次收录</button>}{!candidate && !unsavedImages.has(card.image) && <button type="button" className="editor-delete-record" disabled={busy} title="仅删除当前元数据记录，保留源图片；保存或导出后生效" onClick={deleteRecord}>删除已收录记录</button>}{local && !candidate && byPath.has(card.image) && <button disabled={busy || dirty} onClick={() => { setDetailOpen(false); setManagedAsset(byPath.get(card.image)!); setMessage(''); }}>管理源图片文件</button>}{local ? candidate ? <button type="button" className="editor-save" title="只加入当前编辑列表，最后统一保存 JSON" onClick={collectCard} disabled={busy || formErrors.length > 0}>收录卡牌</button> : <button className="editor-save" onClick={() => void save()} disabled={busy || !dirty || !revision || errors.length > 0}>保存到本地 JSON</button> : <button onClick={download} disabled={busy || errors.length > 0}>导出 JSON</button>}</div>
      </dialog>}
      {local && managedAsset && <AssetDialog key={managedAsset.path} asset={managedAsset} groups={availableGroups} busy={busy} message={message} onClose={() => setManagedAsset(null)} onAction={runAssetAction} onRegister={beginRegistration} />}
      {local && groupSettingsOpen && <GroupSettingsDialog key={groupId} group={currentGroup} busy={busy} message={message} onClose={() => setGroupSettingsOpen(false)} onSave={(label, mode) => runAssetAction({ action: 'group-settings', group: groupId, label, mode })} />}
    </div>
  </main>;
}
