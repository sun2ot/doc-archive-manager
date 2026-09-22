import { test, expect, type Page } from '@playwright/test';

async function assertLoginFits(page:Page) {
  await expect(page.locator('.login-screen')).toBeVisible();
  const failures=await page.evaluate(()=>{
    const errors:string[]=[];
    for(const selector of ['.login-art .brand','.login-art .brand-symbol','.login-art .brand-symbol svg','#login-form','#login-form h2','#login-form input[name="password"]','.login-submit','.login-security']){
      const el=document.querySelector<HTMLElement>(selector)!;
      const rect=el.getBoundingClientRect();
      if(rect.left < -1 || rect.top < -1 || rect.right > innerWidth+1 || rect.bottom > innerHeight+1) errors.push(selector);
      let parent=el.parentElement;
      while(parent){
        const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
        if(['hidden','clip','auto'].includes(style.overflowY)&&(rect.top<bounds.top-1||rect.bottom>bounds.bottom+1))errors.push(selector+' clipped');
        parent=parent.parentElement;
      }
    }
    if(document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight)errors.push('page overflow');
    return errors;
  });
  expect(failures).toEqual([]);
}

test('login and first-run form fit resized windows at both font scale limits',async({page})=>{
  for(const setup of [false,true]){
    if(setup) await page.route('**/src/api.ts',async route=>{
      const response=await route.fetch();
      const body=(await response.text()).replace(/exists:\s*true,\s*unlocked:\s*true/,'exists: false, unlocked: false');
      await route.fulfill({response,body});
    });
    await page.goto('/');
    if(!setup)await page.getByRole('button',{name:'锁定归档库',exact:true}).click();
    else await expect(page.getByRole('heading',{name:'建立你的归档空间'})).toBeVisible();
    for(const theme of ['light','dim','dark']){
      for(const scale of ['0.9','1.15']){
        await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.setProperty('--font-scale',scale);},{theme,scale});
        for(const size of [{width:1080,height:720},{width:1280,height:680},{width:1440,height:940},{width:1920,height:1080},{width:800,height:600},{width:600,height:720}]){
          await page.setViewportSize(size);
          await assertLoginFits(page);
        }
      }
    }
    await page.screenshot({path:`test-results/login-${setup?'setup':'locked'}.png`});
  }
});

test('completion menus follow theme and zoom, and dismiss without closing the editor',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'登记文件',exact:true}).click();
  const input=page.locator('[name="sender"]');
  for(const scale of ['0.9','1.15']){
    await page.evaluate(scale=>{document.documentElement.style.setProperty('--font-scale',scale);document.documentElement.dataset.theme='dark';},scale);
    await input.fill('综合');
    const option=page.getByRole('option',{name:'综合管理部',exact:true});
    await expect(option).toBeVisible();
    const inputBox=(await input.boundingBox())!, popupBox=(await page.locator('.app-suggestions:not([hidden])').boundingBox())!;
    expect(Math.abs(inputBox.x-popupBox.x)).toBeLessThan(2);
    expect(Math.abs(inputBox.width-popupBox.width)).toBeLessThan(2);
    expect(popupBox.y).toBeGreaterThanOrEqual(inputBox.y+inputBox.height);
    await input.press('Escape');
    await expect(option).toBeHidden();
    await expect(page.getByRole('dialog')).toBeVisible();
    await input.click();
    await option.click();
    await expect(input).toHaveValue('综合管理部');
    await expect(page.locator('input[list],datalist')).toHaveCount(0);
  }
  await input.fill('综合');
  await page.screenshot({path:'test-results/themed-suggestions.png'});
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.locator('.app-suggestions')).toHaveCount(0);
});
