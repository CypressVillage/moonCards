import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { cards, cardCategories } from './card-data.ts';
// @ts-expect-error Shared browser/Node group labels are plain JavaScript.
import { groupLabel } from '../scripts/card-groups.mjs';
import {
  costLabel, emptyFilters, filterGroups, groupKey, highestLevel, levelLabel,
  matchesCard, professionOrder, readFilters, recordKey, relatedNames, relatedVariants, sortLevels, writeFilters,
} from './catalog.ts';
import type { Card, CardGroup, Filters } from './catalog.ts';
import './style.css';
import { CardEditor } from './editor.tsx';
import { installFocusMode } from './focus.ts';

const removeFocusMode = installFocusMode(document);
if (import.meta.hot) import.meta.hot.dispose(removeFocusMode);

const heroFront = cards.find((card) => !card.hidden && card.type === '装备') ?? cards[0];
const heroBack = cards.find((card) => !card.hidden && card.type === '攻击') ?? cards[1] ?? cards[0];
const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.split('/').map(encodeURIComponent).join('/')}`;
const thumbnailUrl = (card: Card) => assetUrl(`thumbnails/${card.image.replace(/\.[^.]+$/, '.webp')}`);
const variantsByName = new Map<string, Card[]>();
for (const card of cards) {
  const key = groupKey(card);
  variantsByName.set(key, [...(variantsByName.get(key) ?? []), card]);
}

function Icon({ name, size = 20 }: { name: 'moon' | 'search' | 'download' | 'close' | 'arrow' | 'book' | 'filter'; size?: number }) {
  const paths = {
    moon: <path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    book: <><path d="M12 5v16M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z" /></>,
    filter: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function CardImage({ card, large = false }: { card: Card; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [card.image]);
  return failed
    ? <div className="image-fallback"><Icon name="book" size={36} /><span>图片暂不可用</span><small>{card.name}</small></div>
    : <img src={large ? assetUrl(card.image) : thumbnailUrl(card)} alt={`${card.name} · ${levelLabel(card.level)}`}
      loading={large ? 'eager' : 'lazy'} decoding="async" width="517" height="780" onError={() => setFailed(true)} />;
}

function Selectors({ root, selected, onSelect }: { root: CardGroup; selected: Card; onSelect: (card: Card) => void }) {
  const variants = variantsByName.get(groupKey(selected)) ?? [selected];
  const related = relatedNames(root);
  return <div className="selectors">
    {related.length > 0 && <div className="related-buttons" aria-label="关联卡切换">
      {[root.name, ...related].map((name) => <button key={name} type="button" className={selected.name === name ? 'active' : ''}
        aria-pressed={selected.name === name}
        onClick={() => {
          const options = relatedVariants(cards, root, name);
          if (options?.length) onSelect(highestLevel(name === root.name ? root.matches : options));
        }}>{name === root.name ? '本卡' : name}</button>)}
    </div>}
    <div className="level-buttons" aria-label={`${selected.name}等级切换`}>
      {sortLevels(variants).map((card) => <button type="button" key={recordKey(card)}
        aria-pressed={selected.level === card.level} className={selected.level === card.level ? 'active' : ''}
        onClick={() => onSelect(card)}>{levelLabel(card.level)}</button>)}
    </div>
  </div>;
}

function DownloadLink({ card, full = false }: { card: Card; full?: boolean }) {
  const extension = card.image.split('.').at(-1);
  const filename = `${groupLabel(card.group)}-${card.name}${card.level === null ? '' : `-${card.level}星`}.${extension}`;
  return <a className={full ? 'download-full' : 'download-icon'} href={assetUrl(card.image)} download={filename}
    aria-label={`下载${card.name}${levelLabel(card.level)}原图`}><Icon name="download" size={17} />{full && '下载原图'}</a>;
}

function CardTile({ group, filters, onOpen }: { group: CardGroup; filters: Filters; onOpen: (root: CardGroup, card: Card) => void }) {
  const [selected, setSelected] = useState(() => highestLevel(group.matches));
  return <article className="card-tile">
    <div className="tile-meta"><span>{selected.type}牌</span><span>{groupLabel(selected.group)}</span></div>
    <button className="card-image-button" type="button" onClick={() => onOpen(group, selected)} aria-label={`查看${selected.name}详情`}>
      <CardImage card={selected} /><span className="image-hint">查看大图 <Icon name="arrow" size={15} /></span>
    </button>
    <div className="card-title-row"><h3>{selected.name}</h3><DownloadLink card={selected} /></div>
    <p className="card-profession">{selected.classes.length ? selected.classes.join(' / ') : '职业待补充'}<span>·</span>{selected.cost === null ? '能耗未标注' : costLabel(selected.cost)}</p>
    <Selectors root={group} selected={selected} onSelect={setSelected} />
    {!matchesCard(selected, filters) && <p className="outside-filter">当前切换版本不符合筛选条件</p>}
  </article>;
}

function DetailDialog({ root, initial, onClose }: { root: CardGroup; initial: Card; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(initial);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = previous; };
  }, []);
  return <dialog ref={dialog} className="detail-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="detail-title">
    <div className="detail-layout">
      <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭详情" autoFocus><Icon name="close" /></button>
      <div className="detail-image"><CardImage card={selected} large /></div>
      <div className="detail-content">
        <p className="eyebrow">CARD ARCHIVE / 卡牌档案</p>
        <span className="detail-mode">{groupLabel(selected.group)}</span>
        <h2 id="detail-title">{selected.name}</h2>
        <dl><div><dt>卡牌类型</dt><dd>{selected.type}牌</dd></div><div><dt>卡牌等级</dt><dd>{levelLabel(selected.level)}</dd></div>
          <div><dt>能耗</dt><dd>{costLabel(selected.cost)}</dd></div><div><dt>可获得职业</dt><dd>{selected.classes.join(' / ') || '待补充'}</dd></div></dl>
        <Selectors root={root} selected={selected} onSelect={setSelected} />
        <DownloadLink card={selected} full />
        <p className="detail-note">下载保留原始图片尺寸，可用于个人整理及打印。卡牌图片版权归游戏权利方所有。</p>
      </div>
    </div>
  </dialog>;
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="filter-select"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

function App() {
  const [filters, setFilters] = useState<Filters>(() => readFilters(window.location.search));
  const [sort, setSort] = useState('default');
  const [detail, setDetail] = useState<{ root: CardGroup; card: Card } | null>(null);
  const signature = writeFilters(filters);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = signature;
    window.history.replaceState(null, '', url);
  }, [signature]);
  useEffect(() => {
    const onPop = () => { setFilters(readFilters(window.location.search)); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const update = (key: keyof Filters, value: string) => { setFilters((previous) => ({ ...previous, [key]: value })); };
  const reset = () => { setFilters({ ...emptyFilters }); };
  const groups = useMemo(() => {
    const result = filterGroups(cards, filters);
    if (sort === 'name') result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return result;
  }, [filters, sort]);
  const modeCards = cards.filter((card) => filters.group === 'all' || card.group === filters.group);
  const classes = [...professionOrder];
  const types = [...new Set(modeCards.map((card) => card.type))];
  const costs = [...new Set(modeCards.map((card) => String(card.cost)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const levels = [...new Set(modeCards.map((card) => String(card.level)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  // Keep a selected value visible even when a mode change removes it from the available options.
  if (filters.profession && filters.profession !== '__unknown' && !classes.includes(filters.profession)) classes.push(filters.profession);
  if (filters.type && !types.includes(filters.type)) types.push(filters.type);
  if (filters.cost && !costs.includes(filters.cost)) costs.push(filters.cost);
  if (filters.level && !levels.includes(filters.level)) levels.push(filters.level);
  const totalCount = filterGroups(cards, emptyFilters).length;
  const categories = cardCategories.map((category) => ({ ...category, count: filterGroups(cards, { ...emptyFilters, group: category.id }).length }));
  const hasFilters = signature.length > 0;

  return <>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href={import.meta.env.BASE_URL} aria-label="林间图鉴首页"><span className="brand-symbol"><Icon name="moon" size={25} /></span><span>林间图鉴<small>NIGHT OF FULL MOON</small></span></a>
      <nav aria-label="主导航"><a className="nav-active" href="#catalog">卡牌图鉴</a><a href="#about">关于图鉴 <span>↗</span></a></nav>
      <span className="header-label">非官方 · 持续收录中</span><a className="editor-entry" href="?editor">编辑卡牌</a>
    </div></header>
    <main>
      <section className="hero">
        <div className="hero-copy"><p className="eyebrow"><span className="tiny-star">✧</span> THE FOREST KEEPS EVERY STORY</p><h1>翻开月夜，<br />寻找你的<span>下一张牌。</span></h1>
          <p className="hero-description">从经典冒险到小红帽日记，<br className="mobile-break" />让散落在森林里的卡牌，有迹可循。</p>
          <a className="hero-link" href="#catalog">开始探索 <Icon name="arrow" size={18} /></a>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="hero-moon" /><span className="art-spark spark-one">✦</span><span className="art-spark spark-two">✧</span><span className="art-spark spark-three">·</span>
          {heroBack && <img className="hero-card hero-card-back" src={thumbnailUrl(heroBack)} alt="" width="517" height="780" />}
          {heroFront && <img className="hero-card hero-card-front" src={thumbnailUrl(heroFront)} alt="" width="517" height="780" />}
          <span className="art-caption">A LITTLE MAGIC, A LONG JOURNEY.</span>
        </div>
        <div className="hero-bottom"><span><span className="status-dot" /> 图鉴已开启</span><span>{totalCount} 个卡位 <i>/</i> {cards.length} 条版本记录 <i>/</i> {categories.length} 个分组</span></div>
      </section>

      <section className="catalog-section" id="catalog" aria-labelledby="catalog-heading">
        <div className="section-heading"><div><p className="eyebrow">THE COLLECTION</p><h2 id="catalog-heading">卡牌收藏室<span>01 —</span></h2></div><p>每张卡牌，都有自己的故事。</p></div>
        <div className="mode-tabs" role="group" aria-label="卡牌分组">
          {[{ id: 'all', label: '全部卡牌', count: totalCount }, ...categories].map(({ id, label, count }) =>
            <button type="button" key={id} aria-pressed={filters.group === id} className={filters.group === id ? 'active' : ''} onClick={() => update('group', id)}>{label}<span>{count}</span></button>)}
        </div>
        <div className="filter-box">
          <label className="search-field"><Icon name="search" /><input type="search" placeholder="寻找一张卡牌，输入名称…" aria-label="搜索卡牌名称" value={filters.query} onChange={(event) => update('query', event.target.value)} /><span>按名称检索</span></label>
          <div className="filter-row"><span className="filter-row-label"><Icon name="filter" size={17} /> 筛选</span>
            <FilterSelect label="职业" value={filters.profession} onChange={(value) => update('profession', value)}><option value="">全部职业</option>{classes.map((name) => <option key={name} value={name}>{name}</option>)}<option value="__unknown">未标注职业</option></FilterSelect>
            <FilterSelect label="类型" value={filters.type} onChange={(value) => update('type', value)}><option value="">全部类型</option>{types.map((type) => <option key={type} value={type}>{type}牌</option>)}</FilterSelect>
            <FilterSelect label="能耗" value={filters.cost} onChange={(value) => update('cost', value)}><option value="">全部能耗</option>{costs.map((cost) => <option key={cost} value={cost}>{cost === 'null' ? '未标注 / 不适用' : `${cost} 费`}</option>)}</FilterSelect>
            <FilterSelect label="等级" value={filters.level} onChange={(value) => update('level', value)}><option value="">全部等级</option>{levels.map((level) => <option key={level} value={level}>{level === 'null' ? '无星级' : `${level} 星`}</option>)}</FilterSelect>
            <button type="button" className="reset-button" onClick={reset} disabled={!hasFilters}>重置筛选 ↺</button>
          </div>
        </div>
        <div className="results-toolbar"><p aria-live="polite">找到 <strong>{groups.length}</strong> 个卡位<span>同名等级已合并 · 点击卡面查看大图</span></p>
          <label className="sort-label">排列<select aria-label="卡牌排列" value={sort} onChange={(event) => { setSort(event.target.value); }}><option value="default">收录顺序</option><option value="name">名称顺序</option></select></label>
        </div>
        {groups.length ? <div className="card-grid">{groups.map((group) => <CardTile key={`${group.key}:${signature}`} group={group} filters={filters} onOpen={(root, card) => setDetail({ root, card })} />)}</div>
          : <div className="empty-state"><Icon name="search" size={36} /><h3>这片森林里，暂时没有找到它。</h3><p>试试其他名称，或放宽筛选条件。</p><button type="button" onClick={reset}>清除筛选</button></div>}
        <aside className="collection-note"><Icon name="book" size={19} /><p><strong>这还是一本正在编写的图鉴。</strong> 当前仅展示少量示例，职业与部分能耗尚待补全。关联切换仅作功能演示，不代表已核实的游戏生成关系。</p><span>持续收录中</span></aside>
      </section>
    </main>
    <footer id="about"><div className="footer-brand"><Icon name="moon" size={20} /><strong>林间图鉴</strong><span>愿每一次冒险，都有月光相伴。</span></div><p>《月圆之夜》非官方卡牌收藏与检索站。图片及游戏内容版权归原权利方所有。</p><p>个人整理 · 非商业用途 · 支持原图下载</p></footer>
    {detail && <DetailDialog root={detail.root} initial={detail.card} onClose={() => setDetail(null)} />}
  </>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode>{new URLSearchParams(window.location.search).has('editor') ? <CardEditor initialCards={cards} categories={cardCategories} /> : <App />}</React.StrictMode>);
