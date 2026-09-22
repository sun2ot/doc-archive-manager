import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Department, DocumentRecord, Preferences } from './types';
export const preview = !isTauri();
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() - offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const now = new Date().toISOString();
const examples: Partial<DocumentRecord>[] = [
  {title:'关于开展第三季度工作总结的通知', sender:'综合管理部', recipient:'张知行', number:'综管〔2026〕028号', tags:['工作通知','季度总结'], location:'A 柜 · 第 2 层 · 03 号档案盒', links:['sample-2'], notes:'请各部门梳理第三季度重点工作进展，并于月底前提交书面总结。\n\n纸质原件已签收，待完成汇总后统一归档。', archived:false},
  {title:'2026 年度办公设备采购申请', sender:'行政办公室', recipient:'财务部', tags:['采购管理','待审批'], kind:'outgoing', location:'B 柜 · 第 1 层 · 01 号档案盒', archived:false},
  {title:'第三季度重点工作任务分解表', sender:'综合管理部', recipient:'张知行', tags:['季度总结','工作计划'], archived:true},
  {title:'关于调整内部会议安排的函', sender:'人力资源部', recipient:'张知行', tags:['工作通知'], archived:true},
  {title:'办公区域安全检查情况报告', sender:'张知行', recipient:'后勤保障部', kind:'outgoing', tags:['安全管理'], archived:true, links:['sample-5']},
  {title:'消防设施维护与检查记录', sender:'后勤保障部', recipient:'张知行', tags:['安全管理','检查记录'], archived:true},
  {title:'关于报送年度培训需求的通知', sender:'人力资源部', recipient:'张知行', tags:['培训学习'], archived:false},
  {title:'关于采购办公设备的请示', sender:'行政办公室', recipient:'分管领导', handler:'王经办', kind:'request', signedAt:day(7), receivedAt:'', sentAt:'', tags:['请示','采购管理'], archived:false},
  {title:'会议纪要及照片', sender:'综合管理部', recipient:'档案室', kind:'other', signedAt:day(9), receivedAt:'', sentAt:'', tags:['会议材料'], archived:true},
];
let docs: DocumentRecord[] = examples.map((d,i) => ({ id:`sample-${i}`, title:'', kind:'incoming', sender:'', recipient:'', handler:'', signedAt:day(i+2), receivedAt:(!d.kind || d.kind === 'incoming') ? day(i) : '', sentAt:d.kind === 'outgoing' ? day(i) : '', number:`归档〔2026〕${String(i+1).padStart(3,'0')}号`, location:'A 柜 · 第 2 层', notes:'纸质文件已登记，请按照存放位置查找原件。', tags:[], links:[], status:d.archived?'archived':'pending', archived:d.archived ?? false, createdAt:now, updatedAt:now, ...d }));
const previewDepartments: Department[] = [{id:'dept-general',name:'综合管理部',parentId:null,leaders:['张知行']},{id:'dept-admin',name:'行政办公室',parentId:null,leaders:[]},{id:'dept-finance',name:'财务部',parentId:null,leaders:[]},{id:'dept-hr',name:'人力资源部',parentId:null,leaders:[]},{id:'dept-logistics',name:'后勤保障部',parentId:null,leaders:[]}];
let prefs: Preferences = {totpEnabled:false,webdavUrl:'',webdavUsername:'',hasWebdavPassword:false,lastBackup:null,dataPath:'桌面版中显示本地加密数据库位置',locations:['A 柜 · 第 2 层 · 03 号档案盒','B 柜 · 第 1 层 · 01 号档案盒','档案室待整理区'],theme:'light',fontZh:'MiSans',fontEn:'Segoe UI',accent:'#2563eb',backgroundImage:'',backgroundOpacity:.18,fontScale:1,autoLockMinutes:15,numberTemplates:['〔2026〕','发〔2026〕','收〔2026〕','请〔2026〕'],departments:previewDepartments};
export async function api<T = unknown>(action: string, payload: unknown = {}): Promise<T> {
  if (!preview) return invoke<T>('dispatch', {action,payload});
  const p = payload as Record<string, any>;
  let result: unknown;
  switch (action) {
    case 'status': result = {exists:true,unlocked:true}; break;
    case 'list': result = docs.filter(d => (!p.kind || d.kind === p.kind) && (!p.tag || d.tags.includes(p.tag)) && (!p.query || JSON.stringify(d).toLowerCase().includes(p.query.toLowerCase()) || (p.query.toLowerCase().includes('gongzuo') && d.title.includes('工作')))); break;
    case 'save': {
      const doc = {...p,id:p.id || crypto.randomUUID(),createdAt:p.createdAt || new Date().toISOString(),updatedAt:new Date().toISOString()} as DocumentRecord;
      if (doc.kind === 'incoming') doc.sentAt = ''; else if (doc.kind === 'outgoing') doc.receivedAt = ''; else { doc.receivedAt = ''; doc.sentAt = ''; }
      if (doc.kind !== 'request') doc.handler = '';
      else doc.number = '';
      doc.status = doc.status || (doc.archived ? 'archived' : 'pending');
      doc.archived = doc.status === 'archived';
      const old=docs.find(d=>d.id===doc.id), month=day(0).slice(0,7);
      doc.processingMonths=[...(old?.processingMonths||[])];
      doc.archivedMonths=[...(old?.archivedMonths||[])];
      if(doc.status==='processing'&&!doc.processingMonths.includes(month))doc.processingMonths.push(month);
      if(doc.status==='archived'&&old?.status!=='archived'&&!doc.archivedMonths.includes(month))doc.archivedMonths.push(month);
      docs = [doc,...docs.filter(d => d.id !== doc.id)]; result=doc; break;
    }
    case 'delete': docs = docs.filter(d => d.id !== p.id).map(d => ({...d,links:d.links.filter(id => id !== p.id)})); result=true; break;
    case 'preferences': result=prefs; break;
    case 'webdav_save': prefs={...prefs,webdavUrl:p.url,webdavUsername:p.username,hasWebdavPassword:!!p.password}; result=true; break;
    case 'locations_set': prefs={...prefs,locations:[...new Set((p.locations as string[]).map(s=>s.trim()).filter(Boolean))]}; result=true; break;
    case 'number_templates_set': prefs={...prefs,numberTemplates:[...new Set((p.numberTemplates as string[]).map(s=>s.trim()).filter(Boolean))]}; result=true; break;
    case 'departments_set': prefs={...prefs,departments:structuredClone((p.departments as Department[])||[])}; result=true; break;
    case 'security_save': prefs={...prefs,autoLockMinutes:Math.min(480,Math.max(0,Number(p.autoLockMinutes ?? prefs.autoLockMinutes)))}; result=true; break;
    case 'theme_save': prefs={...prefs,...p,backgroundOpacity:Number(p.backgroundOpacity ?? prefs.backgroundOpacity)}; result=true; break;
    case 'lock': case 'unlock': case 'setup': case 'activity': case 'totp_cancel': result=true; break;
    default: throw new Error('浏览器是交互预览。加密、备份与身份验证请在 Windows 桌面版中使用。');
  }
  return structuredClone(result) as T;
}
