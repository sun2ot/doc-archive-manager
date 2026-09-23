import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';

type Behavior = 'ask' | 'tray' | 'exit';
const key = 'jiancang-window-close';
export function readCloseBehavior(): Behavior {
  try { const value=localStorage.getItem(key);return value==='tray'||value==='exit'?value:value==='minimize'?'tray':'ask'; }
  catch { return 'ask'; }
}
export function closeBehaviorSetting() {
  const value=readCloseBehavior();
  return `<section class="settings-card window-settings"><h2>窗口行为</h2><label class="field">点击窗口关闭按钮时<select id="close-behavior"><option value="ask" ${value==='ask'?'selected':''}>每次询问</option><option value="tray" ${value==='tray'?'selected':''}>最小化到托盘</option><option value="exit" ${value==='exit'?'selected':''}>退出程序</option></select><small>最小化后可从系统托盘恢复窗口。此设置保存在本机，锁定归档库后也生效。</small></label><p id="close-setting-result" role="status"></p></section>`;
}
export function bindCloseBehaviorSetting() {
  document.querySelector<HTMLSelectElement>('#close-behavior')?.addEventListener('change',event=>{
    const input=event.target as HTMLSelectElement;
    try { localStorage.setItem(key,input.value);document.querySelector('#close-setting-result')!.textContent='窗口行为已保存'; }
    catch { input.value=readCloseBehavior();document.querySelector('#close-setting-result')!.textContent='无法保存窗口行为，请重试'; }
  });
}
type WindowActions = { hide: () => Promise<void>; exit: () => Promise<void> };
let active=false;
export async function handleWindowClose(window:WindowActions) {
  if(active)return;
  active=true;
  const previous=document.activeElement as HTMLElement|null;
  let dialog:HTMLDialogElement|undefined;
  try {
    // Do not interrupt a pending save or discard an open editing form silently.
    const saving=!!document.querySelector('form button[type="submit"]:disabled');
    const editing=!!document.querySelector('#modal-root form');
    const behavior=readCloseBehavior();
    if(behavior==='tray'){await window.hide();return;}
    if(behavior==='exit'&&!editing&&!saving){await window.exit();return;}
    dialog=document.createElement('dialog');
    dialog.className='window-close-dialog';
    dialog.setAttribute('aria-labelledby','window-close-title');
    dialog.innerHTML=`<h2 id="window-close-title">关闭笺藏</h2><p>${saving?'正在保存，请完成后再退出。':editing?'当前编辑窗口尚未关闭，退出程序会丢弃未保存的内容。':'请选择关闭窗口后的操作。'}</p><p>隐藏到系统托盘后，程序继续运行；单击托盘图标即可恢复窗口。</p><label class="checkbox-field"><input type="checkbox" id="remember-close">记住选择，下次不再提醒</label><p class="close-error" role="alert"></p><div class="close-dialog-actions"><button class="btn secondary" data-close="cancel" autofocus>取消</button><button class="btn secondary" data-close="tray" ${saving?'disabled':''}>最小化到托盘</button><button class="btn primary" data-close="exit" ${saving?'disabled':''}>退出程序</button></div>`;
    document.body.append(dialog);
    dialog.showModal();
    await new Promise<void>(resolve=>{
      let executing=false;
      dialog!.addEventListener('cancel',event=>{event.preventDefault();if(!executing)resolve();});
      dialog!.addEventListener('keydown',event=>{event.stopPropagation();});
      dialog!.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button=>button.addEventListener('click',async()=>{
        if(executing)return;
        const choice=button.dataset.close!;
        if(choice==='cancel'){resolve();return;}
        executing=true;
        const buttons=[...dialog!.querySelectorAll<HTMLButtonElement>('button')];
        buttons.forEach(b=>b.disabled=true);
        const old=readCloseBehavior();
        try {
          if(dialog!.querySelector<HTMLInputElement>('#remember-close')!.checked)localStorage.setItem(key,choice);
          if(choice==='tray')await window.hide();else await window.exit();
          resolve();
        } catch {
          try { localStorage.setItem(key,old); } catch { /* Retain the dialog if storage is unavailable. */ }
          dialog!.querySelector('.close-error')!.textContent='操作未完成，请重试。';
          buttons.forEach(b=>b.disabled=saving&&b.dataset.close!=='cancel');
          executing=false;
        }
      }));
    });
  } finally { dialog?.remove();active=false;if(previous?.isConnected)previous.focus(); }
}
export async function installWindowClose() {
  const window=getCurrentWindow();
  return window.onCloseRequested(async event=>{
    event.preventDefault();
    try { await handleWindowClose({hide:()=>window.hide(),exit:()=>invoke('quit_app')}); }
    catch { localStorage.removeItem(key);await handleWindowClose({hide:()=>window.hide(),exit:()=>invoke('quit_app')}); }
  });
}

