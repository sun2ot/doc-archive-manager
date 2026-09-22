import { createIcons, Archive, ArrowDownLeft, ArrowUpRight, ArrowRight, ArrowLeft, Bell, Check, CheckCheck, ChevronDown, ChevronRight, Copy, Database, Download, FileText, FolderClosed, FolderOpen, HardDrive, HelpCircle, LayoutDashboard, Link2, LockKeyhole, LogOut, MapPin, MoreHorizontal, Plus, Search, Settings2, ShieldCheck, Tag, Trash2, Upload, X, Pencil, CalendarDays, PanelRightClose, CloudUpload, KeyRound, RefreshCw, CircleCheck, Inbox, ExternalLink, BookOpen, Fingerprint, Command, CircleAlert, Palette, Image, ChevronUp, Users } from 'lucide';
import { api, preview } from './api';
import type { Department, DocumentRecord as Doc, Preferences } from './types';
import { attachSuggestions } from './suggestions';
import { APP_VERSION } from './version';
import { installWindowClose, closeBehaviorSetting, bindCloseBehaviorSetting } from './window-close';
import './style.css';
import './readability.css';

const icons = {Archive,ArrowDownLeft,ArrowUpRight,ArrowRight,ArrowLeft,Bell,Check,CheckCheck,ChevronDown,ChevronRight,Copy,Database,Download,FileText,FolderClosed,FolderOpen,HardDrive,HelpCircle,LayoutDashboard,Link2,LockKeyhole,LogOut,MapPin,MoreHorizontal,Plus,Search,Settings2,ShieldCheck,Tag,Trash2,Upload,X,Pencil,CalendarDays,PanelRightClose,CloudUpload,KeyRound,RefreshCw,CircleCheck,Inbox,ExternalLink,BookOpen,Fingerprint,Command,CircleAlert,Palette,Image,ChevronUp,Users};
const icon = (name: string, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const root = document.querySelector<HTMLDivElement>('#app')!;
let docs: Doc[] = [], visible: Doc[] = [], prefs: Preferences;
let view = 'overview', selected = '', query = '', tag = '', sort = 'updated', statusFilter = '', initialized = false, modal = '', requestId = 0;
let monthMetric = '';
const inMonth = (d:Doc, metric:string) => metric==='received' ? d.kind==='incoming' && d.receivedAt.startsWith(today().slice(0,7)) : (metric==='processing' ? d.processingMonths : d.archivedMonths)?.includes(today().slice(0,7)) || false;
let totpSecret = '';
let suggestionCleanups: Array<() => void> = [];
let themeImageDraft = '';
let lastActivity = Date.now(), lastPing = 0;
const today = () => new Date().toLocaleDateString('sv-SE');
const fmt = (s: string) => s ? s.slice(0,10).replaceAll('-','.') : '未填写';
const tags = () => [...new Set(docs.flatMap(d => d.tags))].sort();
const kinds = ['incoming','outgoing','request','other'] as const;
const kindLabels: Record<string,string> = {incoming:'收文',outgoing:'发文',request:'请示',other:'其他文件'};
const titles: Record<string,string> = {overview:'归档概览',all:'全部文件',incoming:'收文管理',outgoing:'发文管理',request:'请示管理',other:'其他文件',tags:'标签管理',links:'文件关联',backup:'同步与备份',settings:'设置','settings-security':'安全设置','settings-appearance':'外观设置','settings-archive':'档案资料','settings-number-templates':'文号模板','settings-locations':'物理位置','settings-departments':'单位与领导'};
const statusLabels: Record<string,string> = {processing:'办件中',pending:'待归档',archived:'已归档'};
const themePresets = [
  {value:'#2563eb', key:'ocean', label:'海洋蓝', description:'清晰、稳重，适合日常办公'},
  {value:'#4f46e5', key:'indigo', label:'靛青紫', description:'沉静、专注，适合长时间使用'},
  {value:'#c26a21', key:'amber', label:'琥珀橙', description:'温暖、有层次，适合档案整理'},
  {value:'#c24168', key:'berry', label:'莓果红', description:'醒目、柔和，适合强调提醒'}
] as const;
const statusOf = (d:Doc): 'processing'|'pending'|'archived' => d.status || (d.archived ? 'archived' : 'pending');
const kindIcon = (kind:string) => kind === 'incoming' ? 'arrow-down-left' : kind === 'outgoing' ? 'arrow-up-right' : kind === 'request' ? 'file-text' : 'archive';
const defaultDisplayPreferences = {theme:'light' as const,fontZh:'MiSans',fontEn:'Segoe UI',accent:'#2563eb',backgroundImage:'',backgroundOpacity:.18,fontScale:1};
function publicDisplayPreferences() {
  try { return {...defaultDisplayPreferences,...JSON.parse(localStorage.getItem('jiancang-display-preferences')||'{}')}; } catch { return {...defaultDisplayPreferences}; }
}
function rememberDisplayPreferences() {
  if (!prefs) return;
  try { localStorage.setItem('jiancang-display-preferences',JSON.stringify({theme:prefs.theme,fontZh:prefs.fontZh,fontEn:prefs.fontEn,accent:prefs.accent,backgroundImage:prefs.backgroundImage,backgroundOpacity:prefs.backgroundOpacity,fontScale:prefs.fontScale})); } catch { /* localStorage may be disabled in a restricted webview */ }
}
function redrawIcons() { createIcons({icons,attrs:{'stroke-width':1.75}}); }
function applyTheme() {
  const display=prefs||publicDisplayPreferences();
  const el=document.documentElement;
  const palette=themePresets.find(item=>item.value.toLowerCase()===(display.accent||'').toLowerCase())||themePresets[0];
  el.dataset.theme=display.theme || 'light';
  el.dataset.palette=palette.key;
  el.style.setProperty('--accent',palette.value);
  el.style.setProperty('--font-zh',`'${display.fontZh || 'MiSans'}', 'MiSans', 'Microsoft YaHei UI', sans-serif`);
  el.style.setProperty('--font-en',`'${display.fontEn || 'Segoe UI'}', 'Segoe UI', sans-serif`);
  el.style.setProperty('--background-image',display.backgroundImage ? `url("${display.backgroundImage}")` : 'none');
  el.style.setProperty('--background-opacity',String(Math.min(Math.max(Number(display.backgroundOpacity ?? .18),0),.48)));
  el.style.setProperty('--font-scale',String(Math.min(Math.max(Number(display.fontScale ?? 1),.9),1.15)));
}
function toast(message: string, error = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div'); el.className=`toast ${error?'error':''}`;
  el.innerHTML=`${icon(error?'circle-alert':'circle-check')}<span>${esc(message)}</span>`;
  document.body.append(el); redrawIcons(); setTimeout(() => el.remove(),6000);
}
function fail(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes('LOCKED')) { clearSession(); login(true); toast('会话已锁定，请重新登录'); }
  else toast(message,true);
}
function clearSession() { docs=[]; visible=[]; selected=''; query=''; tag=''; initialized=false; monthMetric='';statusFilter=''; totpSecret=''; closeModal(); }
async function refresh() {
  docs = await api<Doc[]>('list'); prefs = await api<Preferences>('preferences'); applyTheme();
  if (!initialized) { selected=''; initialized=true; }
  if (!docs.some(d => d.id === selected)) selected='';
  await filter();
}
async function filter() {
  const seq=++requestId;
  const result=await api<Doc[]>('list',{query,kind:kinds.includes(view as any)?view:'',tag});
  if (seq!==requestId) return;
  visible=result.filter(d => (!statusFilter || statusOf(d) === statusFilter) && (!monthMetric || inMonth(d,monthMetric)));
  if (sort==='signed') visible.sort((a,b)=>b.signedAt.localeCompare(a.signedAt));
  if (sort==='title') visible.sort((a,b)=>a.title.localeCompare(b.title,'zh-CN'));
}
function shell() {
  const incoming=docs.filter(d=>d.kind==='incoming').length, outgoing=docs.filter(d=>d.kind==='outgoing').length, requests=docs.filter(d=>d.kind==='request').length, others=docs.filter(d=>d.kind==='other').length;
  const settingsActive=view==='settings'||view.startsWith('settings-')||view==='backup';
  const nav=(id:string,name:string,ico:string,count?:number) => `<button class="nav-item ${id==='settings'?settingsActive:view===id?'active':''}" data-nav="${id}">${icon(ico)}<span>${name}</span>${count!==undefined?`<b>${count}</b>`:''}</button>`;
  root.innerHTML=`<div class="app-shell"><aside class="sidebar">
    <a class="brand" href="#" data-nav="overview"><div class="brand-symbol">${icon('archive')}</div><div><strong>笺藏<span> JIANCANG</span></strong><small>让每一份文件，有迹可循</small></div></a>
    <div class="workspace"><div class="workspace-avatar">${icon('folder-closed')}</div><div><strong>个人归档库</strong><small>本地个人档案库</small></div></div>
    <div class="nav-caption">工作台</div><nav>${nav('overview','归档概览','layout-dashboard')}${nav('all','全部文件','folder-open',docs.length)}${nav('incoming','收文管理','arrow-down-left',incoming)}${nav('outgoing','发文管理','arrow-up-right',outgoing)}${nav('request','请示管理','file-text',requests)}${nav('other','其他文件','archive',others)}</nav>
    <div class="nav-caption second">整理与关联</div><nav>${nav('tags','标签管理','tag')}${nav('links','文件关联','link-2')}</nav>
    <div class="sidebar-bottom"><div class="vault-state">${icon('shield-check')}<div><strong>${preview?'交互预览模式':'本地加密保护中'}</strong><small>${preview?'示例数据 · 不保存到磁盘':'数据仅存储在你的设备'}</small></div><span class="status-dot"></span></div>
    ${nav('settings','设置','settings-2')}<button class="nav-item" data-action="help">${icon('help-circle')}<span>使用指南</span>${icon('external-link')}</button>
    <div class="profile"><span class="avatar">我</span><div><strong>个人归档库</strong><small>笺藏 v${APP_VERSION}</small></div><button class="icon-btn" data-action="lock" title="锁定归档库" aria-label="锁定归档库">${icon('lock-keyhole')}</button></div></div>
    </aside><div class="main-shell"><header class="topbar"><div class="breadcrumb">工作台 ${icon('chevron-right')}<span>${titles[view]}</span></div><div class="topbar-right"><span>${icon('hard-drive')} ${preview?'浏览器预览':'离线可用'}</span><span class="divider"></span><button class="icon-btn" data-action="help" title="使用指南">${icon('help-circle')}</button><span class="avatar small">我</span></div></header>
    ${preview?'<div class="preview-strip">交互预览 · 当前显示示例档案，修改仅在本次浏览中有效。真实加密、拼音检索和备份由桌面版 Rust 引擎提供。</div>':''}
    <main id="main-content">${page()}</main><footer class="app-footer"><span>${icon('shield-check')} ${preview?'桌面版支持端到本地的加密保存':'所有更改已加密保存到本地'}</span><span>一纸一事，井然有序。</span></footer></div></div><div id="modal-root"></div>`;
  bind(); redrawIcons();
}
function page() {
  if (view==='backup') return syncSettingsPage();
  if (view==='settings-security') return securitySettingsPage();
  if (view==='settings-appearance') return appearanceSettingsPage();
  if (view==='settings-archive') return archiveSettingsPage();
  if (view==='settings-number-templates') return numberTemplatesPage();
  if (view==='settings-locations') return locationsPage();
  if (view==='settings-departments') return departmentsPage();
  if (view==='settings') return settingsOverviewPage();
  if (view==='tags') return tagsPage();
  if (view==='links') return linksPage();
  if(view==='overview') return overviewPage();
  const overview=false;
  return `<section class="page-heading"><div><div class="eyebrow">${overview?'YOUR PAPERWORK, IN ORDER':'DOCUMENT WORKSPACE'}</div><h1>${titles[view]}<span class="heading-dot">.</span></h1><p>${overview?'把纸上的事务，整理成心中的秩序。':'记录每一次流转，让实体文件清晰可查。'}</p></div><div class="heading-actions">${overview?`<span class="date-label">${icon('calendar-days')}${new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}</span>`:''}<button class="btn primary" data-action="new">${icon('plus')}登记文件</button></div></section>
  ${monthMetric?`<p class="metrics-note">${today().slice(0,7)} · 本月${monthMetric==='received'?'收文':monthMetric==='processing'?'办件':'归档'}记录 <button class="text-btn" data-nav="all">查看全部文件</button></p>`:''}
  <section class="records-workspace ${selected?'with-detail':''}"><div class="records-card"><div class="card-heading"><div><h2>${overview?'最近文件':'文件目录'}<span class="count-badge">${visible.length}</span></h2><p>${overview?'近期登记与更新的实体文件':'集中管理文件信息、存放位置与流转记录'}</p></div>${overview?'<button class="text-btn" data-nav="all">查看全部 '+icon('arrow-right')+'</button>':''}</div>
  <div class="toolbar"><label class="search-box">${icon('search')}<input id="search" placeholder="搜索标题、发件人、拼音…" value="${esc(query)}" autocomplete="off" aria-label="搜索文件"/><kbd>Ctrl K</kbd></label><select id="tag-filter" aria-label="标签筛选"><option value="">全部标签</option>${tags().map(t=>`<option ${tag===t?'selected':''} value="${esc(t)}">${esc(t)}</option>`).join('')}</select><select id="status-filter" aria-label="文件状态"><option value="">全部状态</option>${Object.entries(statusLabels).map(([value,label])=>`<option value="${value}" ${statusFilter===value?'selected':''}>${label}</option>`).join('')}</select></div>
  <div class="list-meta"><span>${query||tag?'检索结果':'文件记录'} <strong>${visible.length}</strong> 份</span><label>排序：<select id="sort" aria-label="排序"><option value="updated" ${sort==='updated'?'selected':''}>最近更新</option><option value="signed" ${sort==='signed'?'selected':''}>签署日期</option><option value="title" ${sort==='title'?'selected':''}>文件标题</option></select></label></div>
  <div id="records-list">${records()}</div><div class="table-footer"><span>共 ${visible.length} 份文件${tag?` · 标签：${esc(tag)}`:''}</span><span>本地档案 · 安全存储</span></div></div>${selected?detail():''}</section>
  ${overview?`<section class="bottom-grid"><div class="insight-card"><div class="insight-icon">${icon('link-2')}</div><div><h3>文件之间，也有脉络</h3><p>把通知、回复和后续材料关联起来，让来龙去脉一目了然。</p></div><button class="text-btn" data-nav="links">查看关联 ${icon('arrow-right')}</button></div><div class="backup-nudge">${icon('cloud-upload')}<div><h3>给档案多一份安心</h3><p>${prefs.lastBackup?'上次备份于 '+fmt(prefs.lastBackup):'定期备份，换一台电脑也能继续工作。'}</p></div><button class="icon-btn" data-nav="backup" title="备份与迁移">${icon('arrow-right')}</button></div></section>`:''}`;
}
function overviewPage() {
  return sectionHeading('YOUR PAPERWORK, IN ORDER','归档概览','月度工作量与当前待办，一眼掌握归档进度。')+stats()+`<p class="metrics-note">${today().slice(0,7)} · 收文按实际接收日期；办件按当月办理记录；归档按进入已归档的月份。同一文件每项每月只计一次，后续状态变化不扣减。历史办理与归档从本次更新后记录，旧记录不推算。</p><div class="overview-grid"><section class="settings-card"><h2>当前待办</h2><p class="settings-description">当前状态用于安排接下来的工作。</p>${['processing','pending'].map(status=>`<button class="overview-task" data-current="${status}"><span>${statusLabels[status]}</span><strong>${docs.filter(d=>statusOf(d)===status).length} 份</strong>${icon('arrow-right')}</button>`).join('')}<button class="btn primary" data-action="new">${icon('plus')}登记文件</button></section><section class="settings-card"><h2>档案库</h2><p class="settings-description">共 ${docs.length} 份文件，当前已归档 ${docs.filter(d=>statusOf(d)==='archived').length} 份。</p><button class="overview-task" data-nav="all"><span>检索与管理全部文件</span>${icon('arrow-right')}</button><button class="overview-task" data-nav="links"><span>查看文件关联</span>${icon('link-2')}</button><button class="overview-task" data-nav="backup"><span>备份个人归档库</span>${icon('cloud-upload')}</button></section></div>`;
}
function stats() {
 const rows=[['全部文件',docs.length,'folder-open',''],['本月收文',docs.filter(d=>inMonth(d,'received')).length,'arrow-down-left','received'],['本月办件',docs.filter(d=>inMonth(d,'processing')).length,'arrow-right','processing'],['本月归档',docs.filter(d=>inMonth(d,'archived')).length,'archive','archived']];
 return `<section class="stats">${rows.map(([name,count,ico,metric])=>`<button class="stat-card" data-stat="${metric}"><div class="stat-top"><span>${name}</span><div class="stat-icon">${icon(String(ico))}</div></div><div class="stat-number">${count}<small>份</small></div><div class="stat-bottom"><span>查看对应文件</span>${icon('arrow-up-right')}</div></button>`).join('')}</section>`;
}
function records() {
  if (!visible.length) return `<div class="empty"><div class="empty-icon">${icon('inbox')}</div><h3>${docs.length?'没有找到匹配的文件':'从第一份文件开始'}</h3><p>${docs.length?'试试其他关键词，或调整标签和状态筛选。':'登记标题、收发信息和存放位置，建立你的实体档案库。'}</p><button class="btn ${docs.length?'secondary':'primary'}" data-action="${docs.length?'reset-filter':'new'}">${icon(docs.length?'refresh-cw':'plus')}${docs.length?'清除筛选':'登记第一份文件'}</button></div>`;
  return `<div class="table-scroll"><table><thead><tr><th class="file-col">文件名称</th><th>文件类型</th><th>主要日期</th><th>文件状态</th></tr></thead><tbody>${visible.map(d=>{const status=statusOf(d);const date=d.kind==='incoming'?d.receivedAt:d.kind==='outgoing'?d.sentAt:d.signedAt;return `<tr class="${selected===d.id?'selected':''}" data-select="${esc(d.id)}" tabindex="0" aria-label="查看 ${esc(d.title)}"><td><div class="file-cell"><span class="file-icon ${d.kind}">${icon(kindIcon(d.kind))}</span><div><strong>${esc(d.title)}</strong><small>${esc(d.sender||'未填写发件人')}${d.kind==='request'?'':`<span>·</span>${esc(d.number||'暂无文号')}`} </small>${d.notes?`<span class="record-note" title="${esc(d.notes)}">备注：${esc(d.notes.replace(/\s+/g,' '))}</span>`:''}<div class="row-tags">${d.tags.slice(0,2).map(t=>`<span class="tag-chip color-${Math.abs(t.length)%5}">${esc(t)}</span>`).join('')}${d.links.length?`<span class="link-count">${icon('link-2')}${d.links.length}</span>`:''}</div></div></div></td><td><span class="type-badge ${d.kind}">${icon(kindIcon(d.kind))}${kindLabels[d.kind]}</span></td><td class="date-cell">${fmt(date)}</td><td><span class="state-badge ${status}"><span></span>${statusLabels[status]}</span></td></tr>`;}).join('')}</tbody></table></div>`;
}
function relationItems(items: Doc[], empty: string) {
  return items.length ? items.map(d=>`<button class="relation-item" data-select="${esc(d.id)}">${icon('file-text')}<span>${esc(d.title)}</span>${icon('arrow-up-right')}</button>`).join('') : `<div class="relation-empty">${empty}</div>`;
}
function detail() {
  const d=docs.find(d=>d.id===selected); if(!d) return '';
  const forward=docs.filter(x=>d.links.includes(x.id)), backward=docs.filter(x=>x.links.includes(d.id));
  const info=[d.sender?`<dt>${d.kind==='request'?'拟稿部门':'发件人 / 部门'}</dt><dd>${esc(d.sender)}</dd>`:'',d.recipient?`<dt>${d.kind==='request'?'主送领导':'收件人 / 部门'}</dt><dd>${esc(d.recipient)}</dd>`:'',d.kind==='request'&&d.handler?`<dt>经办人</dt><dd>${esc(d.handler)}</dd>`:'',d.signedAt?`<dt>文件签署日期</dt><dd>${fmt(d.signedAt)}</dd>`:'',d.kind==='incoming'&&d.receivedAt?`<dt>实际接收日期</dt><dd>${fmt(d.receivedAt)}</dd>`:'',d.kind==='outgoing'&&d.sentAt?`<dt>实际发出日期</dt><dd>${fmt(d.sentAt)}</dd>`:'',`<dt>文件状态</dt><dd><span class="state-badge ${statusOf(d)}"><span></span>${statusLabels[statusOf(d)]}</span></dd>`].filter(Boolean).join('');
  return `<aside class="detail-card"><div class="detail-toolbar"><span>${icon('file-text')}文件详情</span><div><button class="icon-btn" data-action="edit" title="编辑文件">${icon('pencil')}</button><button class="icon-btn" data-action="close-detail" title="关闭详情">${icon('panel-right-close')}</button></div></div><div class="detail-body"><span class="type-badge ${d.kind}">${icon(kindIcon(d.kind))}${kindLabels[d.kind]}</span><h2>${esc(d.title)}</h2>${d.kind!=='request'&&d.number?`<p class="document-number">${esc(d.number)}</p>`:''}${d.tags.length?`<div class="detail-tags">${d.tags.map(t=>`<button data-tag="${esc(t)}" class="tag-chip color-${Math.abs(t.length)%5}">${esc(t)}</button>`).join('')}</div>`:''}
  <div class="detail-section"><h3>基本信息</h3><dl>${info}</dl></div>
  ${d.location?`<div class="location-card">${icon('map-pin')}<div><small>实体文件存放位置</small><strong>${esc(d.location)}</strong></div></div>`:''}
  <div class="detail-section"><h3>文件关联<span>${forward.length+backward.length}</span><button class="icon-btn" data-action="edit" title="管理关联">${icon('plus')}</button></h3><div class="relation-label">${icon('arrow-up-right')}关联的文件 <b>${forward.length}</b></div>${relationItems(forward,'暂未添加关联文件')}<div class="relation-label reverse">${icon('arrow-down-left')}被关联的文件 <b>${backward.length}</b></div>${relationItems(backward,'暂无其他文件关联本文件')}</div>
  ${d.notes?`<div class="detail-section notes"><h3>备注</h3><p>${esc(d.notes)}</p></div>`:''}<div class="detail-updated">最后更新 ${fmt(d.updatedAt)}</div></div><div class="detail-actions"><button class="btn secondary" data-action="edit">${icon('pencil')}编辑记录</button><button class="icon-btn danger" data-action="delete" title="删除记录">${icon('trash-2')}</button></div></aside>`;
}
function sectionHeading(eyebrow:string,title:string,sub:string) { return `<section class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}<span class="heading-dot">.</span></h1><p>${sub}</p></div></section>`; }
function tagsPage() {
  return sectionHeading('ORGANIZE WITH CLARITY','标签管理','按主题与业务分类，让每一份文件更容易被找到。')+`<div class="tag-grid">${tags().map((t,i)=>`<button class="tag-card color-${i%4}" data-tag="${esc(t)}"><div class="tag-card-icon">${icon('tag')}</div><h3>${esc(t)}</h3><p>${docs.filter(d=>d.tags.includes(t)).length} 份文件</p>${icon('arrow-up-right')}</button>`).join('')||'<div class="empty"><h3>还没有标签</h3><p>登记或编辑文件时，可以直接添加标签。</p><button class="btn primary" data-action="new">登记文件</button></div>'}</div><div class="info-note">${icon('help-circle')}在文件编辑窗口中添加或修改标签。多个标签可用逗号分隔，标签将自动去重。</div>`;
}
function linksPage() {
  const linked=docs.filter(d=>d.links.length||docs.some(x=>x.links.includes(d.id)));
  return sectionHeading('EVERY DOCUMENT IS CONNECTED','文件关联','从一份通知到后续回复，双向串联完整的业务脉络。')+`<div class="relations-layout"><div class="relations-list">${linked.length?linked.map(d=>`<article class="relationship-card"><button class="relationship-title" data-select="${esc(d.id)}">${icon('file-text')}<div><small>${kindLabels[d.kind]}${d.kind!=='request'&&d.number?' · '+esc(d.number):''}</small><h3>${esc(d.title)}</h3></div>${icon('chevron-right')}</button><div class="relationship-columns"><div><span class="relation-label">${icon('arrow-up-right')}关联的文件</span>${relationItems(docs.filter(x=>d.links.includes(x.id)),'暂无正向关联')}</div><div><span class="relation-label reverse">${icon('arrow-down-left')}被关联的文件</span>${relationItems(docs.filter(x=>x.links.includes(d.id)),'暂无反向关联')}</div></div></article>`).join(''):'<div class="empty"><div class="empty-icon">'+icon('link-2')+'</div><h3>为文件建立联系</h3><p>在文件编辑窗口中选择关联文件，反向关联会自动呈现。</p><button class="btn primary" data-nav="all">前往文件目录</button></div>'}</div>${selected?detail():''}</div>`;
}
function backupPage() {
  return sectionHeading('KEEP YOUR ARCHIVE SAFE','同步与备份','把加密副本安全带走，在不同设备之间延续你的归档工作。')+settingsBack('同步与备份')+`<div class="settings-grid"><section class="settings-card"><div class="settings-card-title"><span class="feature-icon">${icon('hard-drive')}</span><div><h2>本地备份</h2><p>一份文件，保存全部记录与关联</p></div></div><p class="settings-description">导出包含文件记录、标签、关联和安全设置的 <b>.dag 加密数据库</b>。备份自动使用 UTC 时间戳和随机后缀命名，避免覆盖已有文件。</p><div class="backup-status"><span>最近成功备份</span><strong>${prefs.lastBackup?new Date(prefs.lastBackup).toLocaleString('zh-CN'):'尚未备份'}</strong></div><button class="btn primary" data-action="export">${icon('download')}导出加密备份</button><div class="setting-separator"></div><h3>从备份迁移 / 恢复</h3><p class="settings-description">导入将替换当前归档库，需要备份创建时的密码及动态验证码（如已开启）。当前数据会先自动保存一份恢复副本。</p><button class="btn secondary" data-action="import">${icon('upload')}选择备份并恢复</button></section>
  <section class="settings-card"><div class="settings-card-title"><span class="feature-icon blue">${icon('cloud-upload')}</span><div><h2>WebDAV 远程备份</h2><p>将加密副本保存至你自己的云端</p></div></div><form id="webdav-form"><label class="field">服务器文件夹地址<input name="url" type="url" placeholder="https://dav.example.com/archives/" value="${esc(prefs.webdavUrl)}"/><small>使用 HTTPS，请先在服务器上创建目标文件夹。</small></label><label class="field">用户名<input name="username" autocomplete="username" value="${esc(prefs.webdavUsername)}"/></label><label class="field">应用密码<input name="password" type="password" autocomplete="new-password" placeholder="${prefs.hasWebdavPassword?'已保存，留空则保持原密码':'输入 WebDAV 应用密码'}"/><small>连接凭据与档案一同加密存储。</small></label><div class="form-actions inline"><button class="btn secondary" type="submit">${icon('check')}保存设置</button><button class="btn primary" type="button" data-action="webdav-backup" ${!prefs.webdavUrl?'disabled':''}>${icon('cloud-upload')}立即备份</button></div></form></section></div><div class="info-note">${icon('shield-check')}备份不是同步：远程备份不会合并或删除文件。需要恢复时，请从 WebDAV 下载 .dag 文件后导入。旧备份仍使用当时的密码与 TOTP 设置。</div>`;
}
function settingsNavigation(active:string) {
  const items=[['settings-security','安全设置','shield-check','密码、加密与二次验证'],['settings-appearance','外观设置','palette','主题、字体、字号与背景'],['settings-archive','档案设置','map-pin','实体文件位置目录'],['backup','同步与备份','cloud-upload','本地导出与 WebDAV']];
  return `<nav class="settings-tabs" aria-label="设置分类">${items.map(([id,label,ico,sub])=>`<button class="settings-tab ${active===id?'active':''}" data-nav="${id}">${icon(ico)}<span><strong>${label}</strong><small>${sub}</small></span>${icon('chevron-right')}</button>`).join('')}</nav>`;
}
function settingsCards() {
  const body=settingsPage();
  return [...body.matchAll(/<section class="settings-card">[\s\S]*?<\/section>/g)].map(match=>match[0]);
}
function settingsScopedPage(active:string,title:string,eyebrow:string,sub:string,indexes:number[]) {
  const cards=settingsCards();
  return sectionHeading(eyebrow,title,sub)+settingsNavigation(active)+`<div class="settings-grid">${indexes.map(index=>cards[index]||'').join('')}</div>`;
}
function settingsPage() {
  const themeImage=themeImageDraft||prefs.backgroundImage||'';
  return sectionHeading('SETTINGS','设置','按类别管理安全、外观与同步，让常用选项更容易找到。')+settingsNavigation('settings')+`<div class="settings-grid"><section class="settings-card"><div class="settings-card-title"><span class="feature-icon">${icon('shield-check')}</span><div><h2>本地加密</h2><p>AES-256-GCM · Argon2id</p></div><span class="secure-pill">已启用</span></div><p class="settings-description">SQLite 数据库只在解锁后的内存中读取，磁盘与备份中保存的都是加密文件。外部数据库工具无法直接浏览你的文件记录。</p><div class="setting-row"><div><h3>登录密码</h3><p>用于解锁归档库和加密数据</p></div><button class="btn secondary" data-action="password">修改密码</button></div><div class="setting-row"><div><h3>自动锁定</h3><p>15 分钟无操作后自动锁定</p></div>${icon('lock-keyhole')}</div><div class="path-display"><small>数据库位置</small><code>${esc(prefs.dataPath)}</code></div><p class="security-footnote">请妥善保管密码。加密数据无法通过重置密码找回；更改密码不会重新加密以前导出的备份。</p></section><section class="settings-card"><div class="settings-card-title"><span class="feature-icon blue">${icon('fingerprint')}</span><div><h2>TOTP 二次验证</h2><p>兼容 Bitwarden 等身份验证器</p></div><span class="secure-pill ${prefs.totpEnabled?'':'off'}">${prefs.totpEnabled?'已开启':'未开启'}</span></div><p class="settings-description">开启后，登录除了密码，还需要输入身份验证器中每 30 秒更新的 6 位验证码。</p><div class="totp-illustration">${icon('shield-check')}<div><span>• • •</span><span>• • •</span></div></div><ul class="security-list"><li>${icon('check')}显示密钥，支持一键复制</li><li>${icon('check')}扫码添加到身份验证器</li><li>${icon('check')}验证成功后才正式启用</li></ul><button class="btn ${prefs.totpEnabled?'secondary':'primary'}" data-action="${prefs.totpEnabled?'totp-disable':'totp-prepare'}">${icon('key-round')}${prefs.totpEnabled?'关闭二次验证':'设置二次验证'}</button><p class="security-footnote">TOTP 保护应用登录，不会改变数据库加密方式。请将密钥安全保存，避免丢失后无法进入归档库。</p></section><section class="settings-card"><div class="settings-card-title"><span class="feature-icon">${icon('map-pin')}</span><div><h2>实体文件位置</h2><p>登记时可直接选择或快捷新增</p></div></div><div class="location-manager">${(prefs.locations||[]).map((location,i)=>`<div class="managed-location"><span>${icon('map-pin')}<span>${esc(location)}</span></span><span class="location-actions"><button class="icon-btn" data-action="edit-location" data-edit-location="${i}" title="编辑位置">${icon('pencil')}</button><button class="icon-btn" data-remove-location="${i}" title="删除位置">${icon('trash-2')}</button></span></div>`).join('')||'<p class="settings-description">还没有位置条目。</p>'}</div><form id="location-form" class="form-actions inline"><input name="location" placeholder="新增位置条目" maxlength="300"/><button class="btn secondary" type="submit">${icon('plus')}新增</button></form></section><section class="settings-card"><div class="settings-card-title"><span class="feature-icon blue">${icon('palette')}</span><div><h2>外观与字体</h2><p>主题色、字体和背景图片</p></div></div><form id="theme-form"><input type="hidden" name="backgroundImage" value="${esc(themeImage)}"/><div class="form-grid"><label class="field">界面主题<select name="theme"><option value="light" ${prefs.theme==='light'?'selected':''}>浅色</option><option value="dim" ${prefs.theme==='dim'?'selected':''}>柔和</option><option value="dark" ${prefs.theme==='dark'?'selected':''}>深色</option></select></label><label class="field">主题色<select name="accent">${themePresets.map(theme=>`<option value="${theme.value}" ${prefs.accent.toLowerCase()===theme.value?'selected':''}>${theme.label} · ${theme.description}</option>`).join('')}</select><small>提供几套经过对比度优化的主题色，避免界面出现杂乱的色彩组合。</small></label><label class="field">中文字体<select name="fontZh"><option value="MiSans" ${prefs.fontZh==='MiSans'?'selected':''}>MiSans（推荐）</option><option value="Microsoft YaHei UI" ${prefs.fontZh==='Microsoft YaHei UI'?'selected':''}>Microsoft YaHei UI</option><option value="Microsoft YaHei" ${prefs.fontZh==='Microsoft YaHei'?'selected':''}>Microsoft YaHei</option><option value="SimSun" ${prefs.fontZh==='SimSun'?'selected':''}>SimSun</option><option value="System UI" ${prefs.fontZh==='System UI'?'selected':''}>System UI</option></select></label><label class="field">英文字体<select name="fontEn"><option value="Segoe UI" ${prefs.fontEn==='Segoe UI'?'selected':''}>Segoe UI</option><option value="Arial" ${prefs.fontEn==='Arial'?'selected':''}>Arial</option><option value="Georgia" ${prefs.fontEn==='Georgia'?'selected':''}>Georgia</option><option value="System UI" ${prefs.fontEn==='System UI'?'selected':''}>System UI</option></select></label></div><label class="field range-field">界面字号<input name="fontScale" type="range" min="0.9" max="1.15" step="0.05" value="${prefs.fontScale??1}"/><span>${Math.round((prefs.fontScale??1)*100)}%</span><small>限制在 90%–115%，避免文字过大或过小破坏布局。</small></label><div class="background-picker"><div><strong>自定义背景图片</strong><small>图片会加密保存于归档库，建议使用 4 MB 以内的 PNG / JPG。系统会保留遮罩，确保文字清晰可见。</small></div><button type="button" class="btn secondary" data-action="choose-background">${icon('image')}选择图片</button>${themeImage?`<button type="button" class="icon-btn danger" data-action="clear-background" title="清除背景">${icon('x')}</button>`:''}</div><label class="field range-field">背景透明度<input name="backgroundOpacity" type="range" min="0" max="0.48" step="0.01" value="${Math.min(Number(prefs.backgroundOpacity??.18),.48)}"/><span>${Math.round(Math.min(Number(prefs.backgroundOpacity??.18),.48)*100)}%</span><small>背景越淡，内容对比度越稳定。</small></label><div class="form-actions inline"><button class="btn primary" type="submit">${icon('check')}保存外观</button></div></form></section></div>`;
}
function settingsBack(title:string,parent='设置',parentView='settings') {
  return `<div class="settings-back"><button class="text-btn" data-nav="${parentView}">${icon('arrow-left')}返回${parent}</button><span>${esc(parent)} / ${esc(title)}</span></div>`;
}
function settingsOverviewPage() {
  const categories=[
    ['settings-security','安全与隐私','shield-check','密码、二次验证与自动锁定','保护归档库的访问和本地数据安全。'],
    ['settings-appearance','外观与字体','palette','主题色、字体、字号与背景','调整阅读体验，并保持内容清晰可见。'],
    ['settings-archive','档案资料','archive','文号、位置、单位与领导记录','维护登记文件时可直接复用的基础资料。'],
    ['backup','同步与备份','cloud-upload','本地导出与 WebDAV 远程备份','为归档库保留可迁移、可恢复的加密副本。']
  ] as const;
  return sectionHeading('SETTINGS','设置','选择一个设置分类，再进入对应的详细设置页面。')+`<div class="settings-category-grid">${categories.map(([id,title,ico,sub,description])=>`<button class="settings-category" data-nav="${id}"><span class="settings-category-icon">${icon(ico)}</span><span><strong>${title}</strong><small>${sub}</small><em>${description}</em></span>${icon('chevron-right')}</button>`).join('')}</div>`+closeBehaviorSetting();
}
function securitySettingsPage() {
  const lockOptions=[[15,'15 分钟'],[30,'30 分钟'],[60,'1 小时'],[120,'2 小时'],[240,'4 小时'],[480,'8 小时'],[0,'永不锁定']] as const;
  return sectionHeading('SECURITY & PRIVACY','安全与隐私','管理登录保护、自动锁定和二次验证。')+settingsBack('安全与隐私')+`<div class="settings-grid"><section class="settings-card"><div class="settings-card-title"><span class="feature-icon">${icon('shield-check')}</span><div><h2>本地加密</h2><p>AES-256-GCM · Argon2id</p></div><span class="secure-pill">已启用</span></div><p class="settings-description">SQLite 数据库只在解锁后的内存中读取，磁盘与备份中保存的都是加密文件。</p><div class="setting-row"><div><h3>登录密码</h3><p>用于解锁归档库和加密数据</p></div><button class="btn secondary" data-action="password">修改密码</button></div><form id="security-form"><label class="field">自动锁定<select name="autoLockMinutes" autocomplete="off">${lockOptions.map(([value,label])=>`<option value="${value}" ${prefs.autoLockMinutes===value?'selected':''}>${label}</option>`).join('')}</select><small>总计时长不超过 8 小时。选择“永不锁定”后，仅可通过左下角的锁定按钮手动锁定。</small></label><div class="form-actions inline"><button class="btn primary" type="submit">${icon('check')}保存安全设置</button></div></form><div class="path-display"><small>数据库位置</small><code>${esc(prefs.dataPath)}</code></div><p class="security-footnote">请妥善保管密码。加密数据无法通过重置密码找回；更改密码不会重新加密以前导出的备份。</p></section><section class="settings-card"><div class="settings-card-title"><span class="feature-icon blue">${icon('fingerprint')}</span><div><h2>TOTP 二次验证</h2><p>兼容 Bitwarden 等身份验证器</p></div><span class="secure-pill ${prefs.totpEnabled?'':'off'}">${prefs.totpEnabled?'已开启':'未开启'}</span></div><p class="settings-description">开启后，登录除了密码，还需要输入身份验证器中每 30 秒更新的 6 位验证码。</p><div class="totp-illustration">${icon('shield-check')}<div><span>• • •</span><span>• • •</span></div></div><ul class="security-list"><li>${icon('check')}显示密钥，支持一键复制</li><li>${icon('check')}扫码添加到身份验证器</li><li>${icon('check')}验证成功后才正式启用</li></ul><button class="btn ${prefs.totpEnabled?'secondary':'primary'}" data-action="${prefs.totpEnabled?'totp-disable':'totp-prepare'}">${icon('key-round')}${prefs.totpEnabled?'关闭二次验证':'设置二次验证'}</button><p class="security-footnote">TOTP 保护应用登录，不会改变数据库加密方式。请将密钥安全保存，避免丢失后无法进入归档库。</p></section></div>`;
}
function appearanceSettingsPage() {
  const themeImage=themeImageDraft||prefs.backgroundImage||'';
  return sectionHeading('APPEARANCE & TYPE','外观与字体','让主题、字体和背景保持统一，同时优先保证文字可读性。')+settingsBack('外观与字体')+`<div class="settings-grid appearance-grid"><section class="settings-card"><div class="settings-card-title"><span class="feature-icon blue">${icon('palette')}</span><div><h2>外观与字体</h2><p>主题色、字体、字号和背景图片</p></div></div><form id="theme-form"><input type="hidden" name="backgroundImage" value="${esc(themeImage)}"/><div class="appearance-columns"><div class="appearance-group"><h3>主题与字体</h3><div class="form-grid"><label class="field">界面主题<select name="theme" autocomplete="off"><option value="light" ${prefs.theme==='light'?'selected':''}>浅色</option><option value="dim" ${prefs.theme==='dim'?'selected':''}>柔和</option><option value="dark" ${prefs.theme==='dark'?'selected':''}>深色</option></select></label><label class="field">主题色<select name="accent" autocomplete="off">${themePresets.map(theme=>`<option value="${theme.value}" ${prefs.accent.toLowerCase()===theme.value?'selected':''}>${theme.label} · ${theme.description}</option>`).join('')} </select><small>提供几套经过对比度优化的主题色，登录页和文件类型栏也会同步使用。</small></label><label class="field">中文字体<select name="fontZh" autocomplete="off"><option value="MiSans" ${prefs.fontZh==='MiSans'?'selected':''}>MiSans（推荐）</option><option value="Microsoft YaHei UI" ${prefs.fontZh==='Microsoft YaHei UI'?'selected':''}>Microsoft YaHei UI</option><option value="Microsoft YaHei" ${prefs.fontZh==='Microsoft YaHei'?'selected':''}>Microsoft YaHei</option><option value="SimSun" ${prefs.fontZh==='SimSun'?'selected':''}>SimSun</option><option value="System UI" ${prefs.fontZh==='System UI'?'selected':''}>System UI</option></select></label><label class="field">英文字体<select name="fontEn" autocomplete="off"><option value="Segoe UI" ${prefs.fontEn==='Segoe UI'?'selected':''}>Segoe UI</option><option value="Arial" ${prefs.fontEn==='Arial'?'selected':''}>Arial</option><option value="Georgia" ${prefs.fontEn==='Georgia'?'selected':''}>Georgia</option><option value="System UI" ${prefs.fontEn==='System UI'?'selected':''}>System UI</option></select></label></div></div><div class="appearance-group"><h3>阅读与背景</h3><label class="field range-field">界面字号<input name="fontScale" type="range" min="0.9" max="1.15" step="0.05" value="${prefs.fontScale??1}" autocomplete="off"/><span>${Math.round((prefs.fontScale??1)*100)}%</span><small>限制在 90%–115%，避免文字过大或过小破坏布局。</small></label><div class="background-picker"><div><strong>自定义背景图片</strong><small>图片会加密保存于归档库，建议使用 4 MB 以内的 PNG / JPG。系统会保留遮罩，确保文字清晰可见。</small></div><button type="button" class="btn secondary" data-action="choose-background">${icon('image')}选择图片</button>${themeImage?`<button type="button" class="icon-btn danger" data-action="clear-background" title="清除背景">${icon('x')}</button>`:''}</div><label class="field range-field">背景透明度<input name="backgroundOpacity" type="range" min="0" max="0.48" step="0.01" value="${Math.min(Number(prefs.backgroundOpacity??.18),.48)}" autocomplete="off"/><span>${Math.round(Math.min(Number(prefs.backgroundOpacity??.18),.48)*100)}%</span><small>背景越淡，内容对比度越稳定。</small></label></div></div><div class="form-actions inline"><button class="btn primary" type="submit">${icon('check')}保存外观</button></div></form></section></div>`;
}
function archiveSettingsPage() {
  const categories=[['settings-number-templates','文号模板','file-text','维护发文、收文等常用编号前缀。'],['settings-locations','物理位置','map-pin','登记柜号、层号、档案盒等实体存放位置。'],['settings-departments','单位与领导','folder-open','按层级维护单位部门及其对应领导。']] as const;
  return sectionHeading('ARCHIVE DATA','档案资料','先维护基础记录，登记文件时即可直接选择并自动填充。')+settingsBack('档案资料')+`<div class="settings-category-grid archive-category-grid">${categories.map(([id,title,ico,description])=>`<button class="settings-category" data-nav="${id}"><span class="settings-category-icon">${icon(ico)}</span><span><strong>${title}</strong><em>${description}</em></span>${icon('chevron-right')}</button>`).join('')}</div>`;
}
function numberTemplatesPage() {
  const templates=prefs.numberTemplates||[];
  return sectionHeading('ARCHIVE DATA / NUMBERING','文号模板','维护登记文件时可快速套用的文号前缀。')+settingsBack('文号模板','档案资料','settings-archive')+`<section class="settings-card record-manager-card"><div class="settings-card-title"><span class="feature-icon">${icon('file-text')}</span><div><h2>常用文号前缀</h2><p>模板只保存前缀，具体年份和流水号仍可在登记时调整。</p></div></div><div class="managed-records">${templates.map((template,index)=>`<div class="managed-record" data-template-index="${index}"><span>${icon('file-text')}<strong>${esc(template)}</strong></span><span class="record-actions"><button class="icon-btn" data-action="edit-template" data-template-index="${index}" title="编辑模板">${icon('pencil')}</button><button class="icon-btn danger" data-action="remove-template" data-template-index="${index}" title="删除模板">${icon('trash-2')}</button></span></div>`).join('')||'<p class="settings-description">还没有文号模板。</p>'}</div><form id="number-template-form" class="form-actions inline"><input name="template" placeholder="例如：〔2026〕" maxlength="100" autocomplete="off"/><button class="btn secondary" type="submit">${icon('plus')}新增模板</button></form></section>`;
}
function locationsPage() {
  return sectionHeading('ARCHIVE DATA / LOCATIONS','物理位置','维护纸质文件的柜号、层号和档案盒位置。')+settingsBack('物理位置','档案资料','settings-archive')+`<section class="settings-card record-manager-card"><div class="settings-card-title"><span class="feature-icon">${icon('map-pin')}</span><div><h2>实体文件位置</h2><p>登记时可直接选择或快捷新增。</p></div></div><div class="location-manager">${(prefs.locations||[]).map((location,i)=>`<div class="managed-location"><span>${icon('map-pin')}<span>${esc(location)}</span></span><span class="location-actions"><button class="icon-btn" data-action="edit-location" data-edit-location="${i}" title="编辑位置">${icon('pencil')}</button><button class="icon-btn danger" data-remove-location="${i}" title="删除位置">${icon('trash-2')}</button></span></div>`).join('')||'<p class="settings-description">还没有位置条目。</p>'}</div><form id="location-form" class="form-actions inline"><input name="location" placeholder="新增位置条目" maxlength="300" autocomplete="off"/><button class="btn secondary" type="submit">${icon('plus')}新增位置</button></form></section>`;
}
function departmentTreeRows(items:Department[],parentId:string|null=null,depth=0):string {
  return items.filter(item=>(item.parentId||null)===parentId).map(item=>`<div class="managed-record department-record" data-department-id="${esc(item.id)}" style="--tree-depth:${depth}"><span>${icon(depth?'folder-open':'folder-closed')}<strong>${esc(item.name)}</strong><small>${item.leaders.length?item.leaders.map(esc).join('、'):'未设置领导'}</small></span><span class="record-actions"><button class="icon-btn" data-action="edit-department" data-department-id="${esc(item.id)}" title="编辑部门">${icon('pencil')}</button><button class="icon-btn danger" data-action="remove-department" data-department-id="${esc(item.id)}" title="删除部门">${icon('trash-2')}</button></span></div>`).join('')+items.filter(item=>(item.parentId||null)===parentId).map(item=>departmentTreeRows(items,item.id,depth+1)).join('');
}
function departmentOptions(items:Department[],selected='',exclude=''):string {
  return items.filter(item=>item.id!==exclude).map(item=>`<option value="${esc(item.id)}" ${item.id===selected?'selected':''}>${'　'.repeat(Math.min(8,departmentDepth(items,item.id)))}${esc(item.name)}</option>`).join('');
}
function departmentDepth(items:Department[],id:string):number {
  let depth=0,current=items.find(item=>item.id===id);
  const seen=new Set<string>();
  while(current?.parentId&&!seen.has(current.id)){seen.add(current.id);depth+=1;current=items.find(item=>item.id===current!.parentId);}
  return depth;
}
function departmentsPage() {
  const departments=prefs.departments||[];
  return sectionHeading('ARCHIVE DATA / ORGANIZATION','单位与领导','按层级维护部门；填写拟稿部门后，会自动带出对应领导。')+settingsBack('单位与领导','档案资料','settings-archive')+`<div class="settings-grid department-settings-grid"><section class="settings-card record-manager-card"><div class="settings-card-title"><span class="feature-icon">${icon('folder-open')}</span><div><h2>部门层级</h2><p>支持多级部门，每个部门的领导可以为空或设置多位。</p></div></div><div class="managed-records department-tree">${departmentTreeRows(departments)||'<p class="settings-description">还没有部门记录。</p>'}</div><button class="btn secondary" type="button" data-action="new-department">${icon('plus')}新增部门</button></section><section class="settings-card record-manager-card"><div class="settings-card-title"><span class="feature-icon blue">${icon('users')}</span><div><h2 id="department-form-title">新增部门</h2><p>领导可用逗号或换行分隔；允许暂不设置领导。</p></div></div><form id="department-form"><input type="hidden" name="id"/><label class="field">部门名称<input name="name" required maxlength="100" autocomplete="off" placeholder="例如：综合管理部"/></label><label class="field">上级部门<select name="parentId" autocomplete="off"><option value="">无（一级部门）</option>${departmentOptions(departments)}</select><small>设置上级后，该部门会以树状层级显示。</small></label><label class="field">部门领导<textarea name="leaders" rows="4" maxlength="2000" autocomplete="off" placeholder="例如：张三、李四"></textarea><small>可留空；多个领导请用逗号、顿号或换行分隔。</small></label><div class="form-actions inline"><button class="btn primary" type="submit">${icon('check')}保存部门</button><button class="btn secondary" type="button" data-action="new-department">清空</button></div></form></section></div>`;
}
function syncSettingsPage() { return backupPage(); }
function showModal(title:string,subtitle:string,body:string,wide=false) {
  suggestionCleanups.forEach(cleanup=>cleanup()); suggestionCleanups=[];
  modal=title;
  document.querySelector('#modal-root')!.innerHTML=`<div class="modal-backdrop"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><div><h2>${title}</h2><p>${subtitle}</p></div><button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('x')}</button></header>${body}</section></div>`;
  document.querySelectorAll<HTMLInputElement>('.modal input, .modal textarea, .modal select').forEach(input=>{if(input.type!=='password'&&input.getAttribute('autocomplete')!=='one-time-code')input.setAttribute('autocomplete','off');});
  bindModal(); redrawIcons();
  document.querySelector<HTMLInputElement>('.modal input:not([type=hidden]):not([type=radio]):not([type=checkbox])')?.focus();
}
function closeModal() { suggestionCleanups.forEach(cleanup=>cleanup()); suggestionCleanups=[]; document.querySelector('#modal-root')?.replaceChildren(); modal=''; totpSecret=''; }
function editDoc(existing?:Doc) {
  const d=existing||{id:'',title:'',kind:(kinds.includes(view as any)?view:'incoming') as Doc['kind'],sender:'',recipient:'',handler:'',signedAt:'',receivedAt:today(),sentAt:today(),number:'',location:'',notes:'',tags:[],links:[],status:'pending' as const,archived:false,createdAt:'',updatedAt:''};
  const input=(label:string,name:string,value:string,type='text',placeholder='')=>`<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" placeholder="${placeholder}" autocomplete="${type==='password'?'new-password':'off'}" ${name==='title'?'required maxlength="200"':type==='text'?'maxlength="300"':''}/></label>`;
  const templateOptions=['',...(prefs?.numberTemplates||[])];
  const chip=(t:string,i:number)=>`<span class="tag-chip color-${i%5}">${esc(t)}<button type="button" data-remove-tag="${esc(t)}" aria-label="删除标签 ${esc(t)}">${icon('x')}</button></span>`;
  showModal(existing?'编辑文件':'登记新文件','按文件类型记录不同的流转日期与办理状态。',`<form id="document-form"><div class="modal-body"><div class="type-switch type-switch-four">${(['incoming','outgoing','request','other'] as const).map(k=>`<label><input type="radio" name="kind" value="${k}" ${d.kind===k?'checked':''}/><span>${icon(kindIcon(k))}${kindLabels[k]}</span></label>`).join('')}</div>${input('文件标题 <em>*</em>','title',d.title,'text','输入文件的完整标题')}<div class="form-grid">${input('发件人 / 部门','sender',d.sender,'text','如：综合管理部')}${input('收件人 / 部门','recipient',d.recipient,'text','如：本人或接收部门')}<label class="field" data-number-field>文件文号<select id="number-template" aria-label="文号模板" autocomplete="off">${templateOptions.map(t=>`<option value="${esc(t)}">${t?'套用 '+t+' 编号':'选择文号模板'}</option>`).join('')}</select><input name="number" type="text" value="${esc(d.number)}" maxlength="300" autocomplete="off" placeholder="选择模板后填写编号"></label>${input('文件签署日期','signedAt',d.signedAt,'date')}<div data-date="incoming" ${d.kind!=='incoming'?'hidden':''}>${input('实际接收日期','receivedAt',d.receivedAt,'date')}</div><div data-date="outgoing" ${d.kind!=='outgoing'?'hidden':''}>${input('实际发出日期','sentAt',d.sentAt,'date')}</div><label class="field">文件状态<select name="status" autocomplete="off">${Object.entries(statusLabels).map(([value,label])=>`<option value="${value}" ${statusOf(d)===value?'selected':''}>${label}</option>`).join('')}</select></label></div><label class="field">实体文件存放位置<input name="location" autocomplete="off" value="${esc(d.location)}" placeholder="选择已有位置，或直接输入新位置"><small>可以直接输入新位置，保存后会自动加入位置条目。</small></label><label class="field">文件标签<div class="tag-editor" id="tag-editor"><div id="tag-chips">${d.tags.map(chip).join('')}</div><input id="tag-input" aria-label="标签输入" autocomplete="off" placeholder="输入标签，回车添加"/><div class="tag-suggestions" id="tag-suggestions" hidden></div></div><small>输入时会匹配已有标签，可用上下键选择，回车添加。</small></label><label class="field">关联文件<small>选择正向关联目标，对方的“被关联”列表会自动显示本文件。</small><input id="link-search" type="search" autocomplete="off" placeholder="筛选可关联文件"/></label><div class="link-options">${docs.filter(x=>x.id!==d.id).map(x=>`<label class="link-option" data-link-title="${esc(x.title.toLowerCase())}"><input type="checkbox" name="links" value="${esc(x.id)}" ${d.links.includes(x.id)?'checked':''}/><span>${esc(x.title)}</span><small>${kindLabels[x.kind]}</small></label>`).join('')||'<div class="relation-empty">还没有其他可关联的文件</div>'}</div><label class="field">备注<textarea name="notes" rows="3" maxlength="10000" autocomplete="off" placeholder="记录需要留意的事项…">${esc(d.notes)}</textarea></label></div><footer class="modal-footer"><span>${icon('shield-check')}保存时自动加密</span><button class="btn secondary" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">${icon('check')}保存记录</button></footer></form>`,true);
  const form=document.querySelector<HTMLFormElement>('#document-form')!;
  const senderField=form.querySelector<HTMLInputElement>('[name="sender"]')!.closest('label')!;
  const recipientField=form.querySelector<HTMLInputElement>('[name="recipient"]')!.closest('label')!;
  recipientField.insertAdjacentHTML('afterend',`<label class="field" data-handler-field>经办人<input name="handler" type="text" value="${esc(d.handler)}" maxlength="300" placeholder="如：张三"/></label>`);
  const handlerField=form.querySelector<HTMLElement>('[data-handler-field]')!;
  const senderInput=form.querySelector<HTMLInputElement>('[name="sender"]')!;
  const recipientInput=form.querySelector<HTMLInputElement>('[name="recipient"]')!;
  const departmentNames=()=> (prefs.departments||[]).map(item=>item.name);
  const leaderNames=()=> (prefs.departments||[]).find(item=>item.name===senderInput.value.trim())?.leaders||[];
  const updatePartyFields=()=>{const request=String(new FormData(form).get('kind'))==='request';senderField.childNodes[0].textContent=request?'拟稿部门':'发件人 / 部门';recipientField.childNodes[0].textContent=request?'主送领导':'收件人 / 部门';handlerField.hidden=!request;const numberField=form.querySelector<HTMLElement>('[data-number-field]')!;numberField.hidden=request;numberField.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(input=>input.disabled=request);const leaders=leaderNames();if(request&&leaders.length===1&&!recipientInput.value)recipientInput.value=leaders[0];};
  suggestionCleanups.push(
    attachSuggestions(senderInput,departmentNames),
    attachSuggestions(recipientInput,()=>String(new FormData(form).get('kind'))==='request'?leaderNames():departmentNames()),
    attachSuggestions(form.querySelector<HTMLInputElement>('[name="location"]')!,()=>prefs.locations||[],{showAllOnFocus:true})
  );
  let selectedTags=[...d.tags];
  const updateTags=()=>{document.querySelector('#tag-chips')!.innerHTML=selectedTags.map(chip).join('');document.querySelectorAll<HTMLElement>('[data-remove-tag]').forEach(el=>el.addEventListener('click',()=>{selectedTags=selectedTags.filter(t=>t!==el.dataset.removeTag);updateTags();}));};
  const tagInput=form.querySelector<HTMLInputElement>('#tag-input')!;
  form.querySelector('#tag-suggestions')?.remove();
  suggestionCleanups.push(attachSuggestions(tagInput,()=>tags().filter(value=>!selectedTags.includes(value)),{
    showOnEmpty:false, tag:true, anchor:form.querySelector<HTMLElement>('#tag-editor')!,
    onSelect:value=>{selectedTags.push(value);tagInput.value='';updateTags();}
  }));
  tagInput.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Enter'){e.preventDefault();const value=tagInput.value.trim();if(value&&!selectedTags.includes(value)){selectedTags.push(value);tagInput.value='';updateTags();tagInput.dispatchEvent(new Event('input'));}}else if(e.key==='Backspace'&&!tagInput.value&&selectedTags.length){selectedTags.pop();updateTags();}});
  updateTags();
  form.addEventListener('change',()=>{const kind=String(new FormData(form).get('kind'));document.querySelectorAll<HTMLElement>('[data-date]').forEach(e=>e.hidden=e.dataset.date!==kind);updatePartyFields();});
  senderInput.addEventListener('input',updatePartyFields);
  updatePartyFields();
  document.querySelector('#number-template')!.addEventListener('change',e=>{const prefix=(e.target as HTMLSelectElement).value;const number=document.querySelector<HTMLInputElement>('[name="number"]')!;if(prefix&&!number.value.startsWith(prefix))number.value=prefix;number.focus();});
  document.querySelector('#link-search')!.addEventListener('input',e=>document.querySelectorAll<HTMLElement>('.link-option').forEach(el=>el.hidden=!el.dataset.linkTitle!.includes((e.target as HTMLInputElement).value.toLowerCase())));
  form.addEventListener('submit',e=>{e.preventDefault();void busy(form,async()=>{const f=new FormData(form);const status=String(f.get('status')) as Doc['status'];const location=String(f.get('location')||'').trim();const record={...d,...Object.fromEntries(f),number:f.get('kind')==='request'?'':String(f.get('number')||''),status,archived:status==='archived',links:f.getAll('links'),tags:selectedTags,location};const saved=await api<Doc>('save',record);if(location&&!prefs.locations.includes(location)){prefs.locations=[...prefs.locations,location];await api('locations_set',{locations:prefs.locations});}selected=saved.id;if(view==='overview')view='all';closeModal();await refresh();shell();toast('文件记录已保存');});});
}
function authFields(withNew=false) { return `<label class="field">${withNew?'当前密码':'登录密码'}<input name="password" type="password" required autocomplete="current-password"/></label>${withNew?'<label class="field">新密码<input name="newPassword" type="password" minlength="10" required autocomplete="new-password"/><small>至少 10 个字符，请使用独立的强密码。</small></label><label class="field">确认新密码<input name="confirmPassword" type="password" minlength="10" required autocomplete="new-password"/></label>':''}<label class="field">动态验证码${prefs?.totpEnabled?'':'（未开启可留空）'}<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" ${prefs?.totpEnabled?'required':''}/></label>`; }
function authModal(action:string) {
  const changing=action==='password',disabling=action==='totp-disable';
  showModal(changing?'修改登录密码':disabling?'关闭二次验证':'设置二次验证','为保障归档安全，请先验证你的身份。',`<form id="auth-form"><div class="modal-body">${authFields(changing)}</div><footer class="modal-footer"><button class="btn secondary" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">${changing?'保存新密码':disabling?'确认关闭':'继续'}</button></footer></form>`);
  const form=document.querySelector<HTMLFormElement>('#auth-form')!;
  form.addEventListener('submit',e=>{e.preventDefault();void busy(form,async()=>{
    const p=Object.fromEntries(new FormData(form));
    if (changing && p.newPassword!==p.confirmPassword) throw Error('两次新密码不一致');
    if(action==='totp-prepare') { const setup=await api<{secret:string;uri:string;qr:string}>('totp_prepare',p); totpSetup(setup); }
    else {await api(changing?'change_password':'totp_disable',p);closeModal();await refresh();shell();toast(changing?'密码已修改，旧备份仍使用原密码':'二次验证已关闭');}
  });});
}
function totpSetup(data:{secret:string;uri:string;qr:string}) {
  showModal('绑定身份验证器','使用 Bitwarden 或其他身份验证器扫描下方二维码。',`<form id="totp-form"><div class="modal-body totp-setup"><img class="qr-code" src="data:image/png;base64,${data.qr}" alt="TOTP 绑定二维码"/><label class="field">手动添加密钥<div class="copy-field"><code>${esc(data.secret)}</code><button class="icon-btn" data-action="copy-secret" type="button" title="复制密钥">${icon('copy')}</button></div></label><button class="text-btn" type="button" data-action="copy-uri">${icon('copy')}复制 otpauth 链接</button><div class="info-note">${icon('key-round')}请先安全保存密钥。下一步验证成功后才会开启二次验证。</div><label class="field">输入身份验证器的 6 位验证码<input name="code" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"/></label></div><footer class="modal-footer"><button class="btn secondary" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">验证并启用</button></footer></form>`);
  totpSecret=data.secret;
  document.querySelector('[data-action="copy-uri"]')!.addEventListener('click',()=>void navigator.clipboard.writeText(data.uri).then(()=>toast('绑定链接已复制')).catch(fail));
  const form=document.querySelector<HTMLFormElement>('#totp-form')!;
  form.addEventListener('submit',e=>{e.preventDefault();void busy(form,async()=>{await api('totp_enable',Object.fromEntries(new FormData(form)));closeModal();await refresh();shell();toast('TOTP 二次验证已开启');});});
}
function importModal() {
  showModal('从加密备份恢复','将完整替换当前归档库，不会合并记录。',`<form id="import-form"><div class="modal-body"><div class="info-note">${icon('database')}现有数据会先保存为 before-import 开头的恢复副本。恢复后使用备份中的密码、TOTP 和 WebDAV 设置。</div><label class="field">备份创建时的密码<input name="password" type="password" required autocomplete="off"/></label><label class="field">备份的 TOTP 验证码（如已开启）<input name="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}"/></label><label class="checkbox-field"><input name="consent" type="checkbox" required/>我已了解当前归档库将被替换</label></div><footer class="modal-footer"><button class="btn secondary" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">选择备份文件并恢复</button></footer></form>`);
  const form=document.querySelector<HTMLFormElement>('#import-form')!;
  form.addEventListener('submit',e=>{e.preventDefault();void busy(form,async()=>{const result=await api('import',Object.fromEntries(new FormData(form)));if(result){closeModal();query='';tag='';statusFilter='';initialized=false;await refresh();shell();toast('归档库已成功恢复');}});});
}
function deleteModal() {
  const d=docs.find(d=>d.id===selected);if(!d)return;
  showModal('删除文件记录','此操作会同时移除相关双向关联。',`<div class="modal-body"><p class="delete-warning">确认删除「${esc(d.title)}」的登记记录？实体文件不会受到影响，删除后只能通过备份恢复。</p></div><footer class="modal-footer"><button class="btn secondary" data-action="close-modal">取消</button><button class="btn danger-fill" id="confirm-delete">删除记录</button></footer>`);
  document.querySelector('#confirm-delete')!.addEventListener('click',e=>void busy(e.currentTarget as HTMLElement,async()=>{await api('delete',{id:d.id});closeModal();selected='';await refresh();shell();toast('记录已删除');}));
}
async function busy(el:HTMLElement,fn:()=>Promise<void>) {
  if(el.dataset.busy)return;el.dataset.busy='true';
  const buttons=el.matches('button')?[el as HTMLButtonElement]:[...el.querySelectorAll<HTMLButtonElement>('button[type="submit"]')];
  buttons.forEach(b=>b.disabled=true);
  try{await fn();}catch(e){fail(e);}finally{delete el.dataset.busy;buttons.forEach(b=>b.disabled=false);}
}
async function action(name:string,el:HTMLElement) {
  if(name==='new')editDoc();
  else if(name==='edit')editDoc(docs.find(d=>d.id===selected));
  else if(name==='delete')deleteModal();
  else if(name==='close-detail'){selected='';shell();}
  else if(name==='close-modal'){if(totpSecret)await api('totp_cancel');closeModal();}
  else if(name==='lock'){await api('lock');clearSession();login(true);}
  else if(name==='reset-filter'){monthMetric='';query='';tag='';statusFilter='';await filter();shell();}
  else if(name==='password'||name==='totp-prepare'||name==='totp-disable')authModal(name);
  else if(name==='copy-secret'){await navigator.clipboard.writeText(totpSecret);toast('密钥已复制，请安全保管剪贴板内容');}
  else if(name==='choose-background'){const chosen=await api<{dataUrl:string}|null>('background_choose');if(chosen){themeImageDraft=chosen.dataUrl;prefs.backgroundImage=chosen.dataUrl;applyTheme();const input=document.querySelector<HTMLInputElement>('[name="backgroundImage"]');if(input)input.value=chosen.dataUrl;toast('背景图片已选择，保存外观后生效');}}
  else if(name==='clear-background'){themeImageDraft='';prefs.backgroundImage='';applyTheme();const input=document.querySelector<HTMLInputElement>('[name="backgroundImage"]');if(input)input.value='';toast('背景图片已移除，请保存外观');}
  else if(name==='edit-template'){
    const index=Number(el.dataset.templateIndex), current=prefs.numberTemplates?.[index]||'';
    showModal('编辑文号模板','修改后会同步更新文号模板目录。',`<form id="edit-template-form"><div class="modal-body"><label class="field">模板内容<input name="template" maxlength="100" required autocomplete="off" value="${esc(current)}"/></label></div><footer class="modal-footer"><button class="btn secondary" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">${icon('check')}保存模板</button></footer></form>`);
    const form=document.querySelector<HTMLFormElement>('#edit-template-form')!;
    form.addEventListener('submit',e=>{e.preventDefault();void busy(form,async()=>{const value=String(new FormData(form).get('template')||'').trim();if(!value)throw Error('文号模板不能为空');const templates=[...(prefs.numberTemplates||[])];templates[index]=value;await api('number_templates_set',{numberTemplates:templates});closeModal();await refresh();shell();toast('文号模板已修改');});});
  }
  else if(name==='remove-template'){
    const index=Number(el.dataset.templateIndex), current=prefs.numberTemplates?.[index]||'';
    showModal('删除文号模板','删除后不会影响已经登记的文件记录。',`<div class="modal-body"><p class="delete-warning">确认删除「${esc(current)}」这个文号模板？</p></div><footer class="modal-footer"><button class="btn secondary" data-action="close-modal">取消</button><button class="btn danger-fill" id="confirm-remove-template">删除模板</button></footer>`);
    document.querySelector('#confirm-remove-template')!.addEventListener('click',e=>void busy(e.currentTarget as HTMLElement,async()=>{const templates=[...(prefs.numberTemplates||[])];templates.splice(index,1);await api('number_templates_set',{numberTemplates:templates});closeModal();await refresh();shell();toast('文号模板已删除');}));
  }
  else if(name==='new-department'){
    const form=document.querySelector<HTMLFormElement>('#department-form');
    if(form){form.dataset.editing='';(form.elements.namedItem('id') as HTMLInputElement).value='';(form.elements.namedItem('name') as HTMLInputElement).value='';(form.elements.namedItem('parentId') as HTMLSelectElement).value='';(form.elements.namedItem('leaders') as HTMLTextAreaElement).value='';const title=document.querySelector('#department-form-title');if(title)title.textContent='新增部门';(form.elements.namedItem('name') as HTMLInputElement).focus();}
  }
  else if(name==='edit-department'){
    const id=el.dataset.departmentId||'', department=(prefs.departments||[]).find(item=>item.id===id), form=document.querySelector<HTMLFormElement>('#department-form');
    if(department&&form){form.dataset.editing=id;(form.elements.namedItem('id') as HTMLInputElement).value=id;(form.elements.namedItem('name') as HTMLInputElement).value=department.name;const parent=form.elements.namedItem('parentId') as HTMLSelectElement;parent.innerHTML=`<option value="">无（一级部门）</option>${departmentOptions(prefs.departments||[],department.parentId||'',id)}`;parent.value=department.parentId||'';(form.elements.namedItem('leaders') as HTMLTextAreaElement).value=department.leaders.join('、');const title=document.querySelector('#department-form-title');if(title)title.textContent='编辑部门';(form.elements.namedItem('name') as HTMLInputElement).focus();}
  }
  else if(name==='remove-department'){
    const id=el.dataset.departmentId||'', department=(prefs.departments||[]).find(item=>item.id===id);
    if(!department)return;
    if((prefs.departments||[]).some(item=>item.parentId===id)){toast('请先删除或调整下级部门',true);return;}
    showModal('删除部门','删除后不会影响已经登记的文件记录。',`<div class="modal-body"><p class="delete-warning">确认删除「${esc(department.name)}」及其领导设置？</p></div><footer class="modal-footer"><button class="btn secondary" data-action="close-modal">取消</button><button class="btn danger-fill" id="confirm-remove-department">删除部门</button></footer>`);
    document.querySelector('#confirm-remove-department')!.addEventListener('click',e=>void busy(e.currentTarget as HTMLElement,async()=>{await api('departments_set',{departments:(prefs.departments||[]).filter(item=>item.id!==id)});closeModal();await refresh();shell();toast('部门已删除');}));
  }
  else if(name==='edit-location'){
    const index=Number(el.dataset.editLocation), current=prefs.locations?.[index]||'';
    showModal('编辑实体文件位置','修改后会同步更新位置目录；已登记文件中的原位置不会被自动改写。',`<form id="edit-location-form"><div class="modal-body"><label class="field">位置名称<input name="location" maxlength="300" required autocomplete="off" value="${esc(current)}"/></label></div><footer class="modal-footer"><button class="btn secondary" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">${icon('check')}保存位置</button></footer></form>`);
    const form=document.querySelector<HTMLFormElement>('#edit-location-form')!;
    form.addEventListener('submit',e=>{e.preventDefault();void busy(form,async()=>{const value=String(new FormData(form).get('location')||'').trim();if(!value)throw Error('位置名称不能为空');const locations=[...(prefs.locations||[])];locations[index]=value;await api('locations_set',{locations});closeModal();await refresh();shell();toast('位置条目已修改');});});
  }
  else if(name==='import')importModal();
  else if(name==='export'||name==='webdav-backup')await busy(el,async()=>{const result=await api<{path:string;warning:string|null}|null>(name==='export'?'export':'webdav_backup');if(result){await refresh();shell();toast(result.warning?`备份成功，但备份时间未更新：${result.warning}`:'加密备份已保存：'+result.path);}});
  else if(name==='help')showModal('使用指南','从登记到归档，一个完整的文件流转记录。',`<div class="modal-body guide"><h3>1. 登记实体文件</h3><p>根据收文或发文选择类型；签署日期是文件正文上的日期，收发日期是实际拿到或交出文件的日期。</p><h3>2. 找到文件</h3><p>支持中文片段、拼音全拼及首字母检索。多个关键词用空格分隔，可结合标签和状态筛选。填写柜号、层号和档案盒，方便查找纸质原件。</p><h3>3. 建立双向关联</h3><p>编辑文件并勾选关联目标。详情页会同时显示“关联的文件”和“被关联的文件”。</p><h3>4. 备份与安全</h3><p>定期导出加密备份，或手动上传 WebDAV。迁移时需使用备份生成时的密码和动态验证码。请妥善保管密码及 TOTP 密钥。</p></div><footer class="modal-footer"><button class="btn primary" data-action="close-modal">开始整理</button></footer>`);
}
function bindModal() {
  document.querySelectorAll<HTMLElement>('#modal-root [data-action]').forEach(el=>el.addEventListener('click',()=>void action(el.dataset.action!,el).catch(fail)));
}
function bind() {
  bindCloseBehaviorSetting();
  root.querySelectorAll<HTMLInputElement>('input, textarea, select').forEach(input=>{if(input.type!=='password'&&input.getAttribute('autocomplete')!=='one-time-code')input.setAttribute('autocomplete','off');});
  root.querySelectorAll<HTMLElement>('[data-nav]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();void (async()=>{selected='';monthMetric='';view=el.dataset.nav!;query='';tag='';statusFilter='';await filter();shell();})().catch(fail);}));
  root.querySelectorAll<HTMLElement>('[data-select]').forEach(el=>{
    const select=()=>{selected=el.dataset.select!;shell();};
    el.addEventListener('click',select);el.addEventListener('keydown',e=>{if(e.key==='Enter')select();});
  });
  root.querySelectorAll<HTMLElement>('[data-tag]').forEach(el=>el.addEventListener('click',()=>void(async()=>{selected='';monthMetric='';tag=el.dataset.tag!;query='';view='all';await filter();shell();})().catch(fail)));
  root.querySelectorAll<HTMLElement>('[data-action]').forEach(el=>el.addEventListener('click',()=>void action(el.dataset.action!,el).catch(fail)));
  root.querySelectorAll<HTMLElement>('[data-remove-location]').forEach(el=>el.addEventListener('click',()=>void(async()=>{const locations=[...(prefs.locations||[])];locations.splice(Number(el.dataset.removeLocation),1);await api('locations_set',{locations});await refresh();shell();toast('位置条目已删除');})().catch(fail)));
  root.querySelectorAll<HTMLElement>('[data-stat], [data-current]').forEach(el=>el.addEventListener('click',()=>void(async()=>{selected='';view='all';monthMetric=el.dataset.stat||'';statusFilter=el.dataset.current||'';query='';tag='';await filter();shell();})().catch(fail)));
  let timer:ReturnType<typeof setTimeout>;
  document.querySelector('#search')?.addEventListener('input',e=>{query=(e.target as HTMLInputElement).value;clearTimeout(timer);timer=setTimeout(()=>void(async()=>{await filter();const input=document.querySelector<HTMLInputElement>('#search');const pos=input?.selectionStart;shell();const newInput=document.querySelector<HTMLInputElement>('#search');newInput?.focus();if(pos!==null&&pos!==undefined)newInput?.setSelectionRange(pos,pos);})().catch(fail),220);});
  for(const [id,set] of [['tag-filter',(v:string)=>tag=v],['status-filter',(v:string)=>statusFilter=v],['sort',(v:string)=>sort=v]] as const)document.querySelector('#'+id)?.addEventListener('change',e=>void(async()=>{set((e.target as HTMLSelectElement).value);await filter();shell();})().catch(fail));
  const form=document.querySelector<HTMLFormElement>('#webdav-form');form?.addEventListener('submit',e=>{e.preventDefault();void busy(form,async()=>{await api('webdav_save',Object.fromEntries(new FormData(form)));await refresh();shell();toast('WebDAV 设置已加密保存');});});
  const locationForm=document.querySelector<HTMLFormElement>('#location-form');locationForm?.addEventListener('submit',e=>{e.preventDefault();void busy(locationForm,async()=>{const value=String(new FormData(locationForm).get('location')||'').trim();if(!value)return;await api('locations_set',{locations:[...(prefs.locations||[]),value]});await refresh();shell();toast('位置条目已新增');});});
  const securityForm=document.querySelector<HTMLFormElement>('#security-form');securityForm?.addEventListener('submit',e=>{e.preventDefault();void busy(securityForm,async()=>{await api('security_save',Object.fromEntries(new FormData(securityForm)));await refresh();shell();toast('安全设置已保存');});});
  const templateForm=document.querySelector<HTMLFormElement>('#number-template-form');templateForm?.addEventListener('submit',e=>{e.preventDefault();void busy(templateForm,async()=>{const value=String(new FormData(templateForm).get('template')||'').trim();if(!value)return;await api('number_templates_set',{numberTemplates:[...(prefs.numberTemplates||[]),value]});await refresh();shell();toast('文号模板已新增');});});
  const departmentForm=document.querySelector<HTMLFormElement>('#department-form');departmentForm?.addEventListener('submit',e=>{e.preventDefault();void busy(departmentForm,async()=>{const f=new FormData(departmentForm),name=String(f.get('name')||'').trim(),id=String(f.get('id')||'').trim()||crypto.randomUUID(),parentId=String(f.get('parentId')||'').trim()||null,leaders=[...new Set(String(f.get('leaders')||'').split(/[，,、\n]/).map(value=>value.trim()).filter(Boolean))];if(!name)throw Error('部门名称不能为空');if(parentId===id)throw Error('上级部门不能选择自己');const departments=[...(prefs.departments||[])],record:Department={id,name,parentId,leaders},index=departments.findIndex(item=>item.id===id);if(index>=0)departments[index]=record;else departments.push(record);await api('departments_set',{departments});await refresh();shell();toast(index>=0?'部门已修改':'部门已新增');});});
  const themeForm=document.querySelector<HTMLFormElement>('#theme-form');themeForm?.addEventListener('submit',e=>{e.preventDefault();void busy(themeForm,async()=>{await api('theme_save',Object.fromEntries(new FormData(themeForm)));themeImageDraft='';await refresh();rememberDisplayPreferences();shell();toast('外观设置已保存');});});
  document.querySelectorAll<HTMLInputElement>('#theme-form input[type="range"]').forEach(input=>input.addEventListener('input',e=>{const range=e.target as HTMLInputElement;const out=range.parentElement?.querySelector('span');if(out)out.textContent=`${Math.round(Number(range.value)*100)}%`;}));
}
function login(exists:boolean) {
  applyTheme();
  root.innerHTML=`<div class="login-screen"><div class="login-art"><div class="brand light"><div class="brand-symbol">${icon('archive')}</div><div><strong>笺藏 <span>JIANCANG</span></strong><small>实体文档归档管家</small></div></div><div class="login-message"><div class="eyebrow">A PLACE FOR EVERY PAPER.</div><h1>让每一份文件，<br/>都有迹可循。</h1><p>收发有序，关联清晰。<br/>为你的纸质文件，建立一个安心的数字家。</p><div class="paper-art"><div class="paper back"></div><div class="paper front">${icon('file-text')}<span></span><span></span><span></span><div>${icon('shield-check')}PRIVATE & ORGANIZED</div></div><span class="art-seal">藏</span></div></div><span class="login-art-footer">一纸一事，井然有序。</span></div><div class="login-form-wrap"><form id="login-form"><div class="login-lock">${icon('lock-keyhole')}</div><h2>${exists?'欢迎回来':'建立你的归档空间'}</h2><p>${exists?'解锁归档库，继续整理你的文件。':'设置密码，创建一个仅属于你的加密档案库。'}</p>${preview?'<div class="info-note">当前为浏览器交互预览，任意密码均可进入。</div>':''}<label class="field">${exists?'登录密码':'设置登录密码'}<input name="password" type="password" required ${exists?'':'minlength="10"'} autocomplete="${exists?'current-password':'new-password'}" placeholder="${exists?'请输入登录密码':'至少 10 个字符'}"/></label>${exists?'<label class="field">动态验证码 <small>已开启 TOTP 时填写</small><input name="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="6 位验证码" autocomplete="one-time-code"/></label>':'<label class="field">确认密码<input name="confirmation" type="password" required minlength="10" autocomplete="new-password" placeholder="再次输入密码"/></label><p class="security-footnote">密码用于加密数据库，无法通过重置找回。请安全保存密码；之后可在安全设置中开启 TOTP。</p>'}<button class="btn primary login-submit" type="submit">${icon(exists?'lock-keyhole':'plus')}${exists?'解锁归档库':'创建加密归档库'}${icon('arrow-right')}</button>${!exists?'<button class="text-btn login-import" type="button" id="login-import">'+icon('upload')+'已有备份？从备份恢复</button>':''}<div class="login-security">${icon('shield-check')}本地加密 · 离线可用 · 数据自主</div></form></div></div><div id="modal-root"></div>`;
  redrawIcons();
  const form=document.querySelector<HTMLFormElement>('#login-form')!;
  form.addEventListener('submit',e=>{e.preventDefault();void busy(form,async()=>{const p=Object.fromEntries(new FormData(form));if(!exists&&p.password!==p.confirmation)throw Error('两次密码不一致');await api(exists?'unlock':'setup',p);lastActivity=Date.now();await refresh();shell();});});
  document.querySelector('#login-import')?.addEventListener('click',importModal);
}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&modal){void action('close-modal',document.body).catch(fail);}
  if((e.ctrlKey||e.metaKey)&&e.key==='k'&&initialized){e.preventDefault();if(!document.querySelector('#search')){view='all';shell();}document.querySelector<HTMLInputElement>('#search')?.focus();}
  if((e.ctrlKey||e.metaKey)&&e.key==='n'&&initialized&&!modal){e.preventDefault();editDoc();}
  if(e.key==='Tab'&&modal){const focusable=[...document.querySelectorAll<HTMLElement>('.modal button:not(:disabled), .modal input:not(:disabled), .modal select, .modal textarea')].filter(x=>!x.closest('[hidden]'));const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
});
for(const event of ['pointerdown','keydown','wheel']) document.addEventListener(event,()=>{
  lastActivity=Date.now();
  if(initialized&&Date.now()-lastPing>60000){lastPing=Date.now();void api('activity').catch(fail);}
},{passive:true});
setInterval(()=>{const minutes=prefs?.autoLockMinutes??15;if(initialized&&minutes>0&&Date.now()-lastActivity>minutes*60*1000)void action('lock',document.body).catch(fail);},10000);
async function start(){const state=await api<{exists:boolean;unlocked:boolean}>('status');if(state.unlocked){await refresh();shell();}else login(state.exists);}
if(!preview) void installWindowClose().catch(fail);
void start().catch(e=>{root.innerHTML='<div class="startup-error"><h2>暂时无法打开归档库</h2><p>'+esc(e)+'</p><button class="btn primary" id="retry-start">重试</button></div>';document.querySelector('#retry-start')!.addEventListener('click',()=>location.reload());});
