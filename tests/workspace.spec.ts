import {test,expect} from '@playwright/test';
test('detail is opened explicitly and cleared by workspace navigation',async({page})=>{
 await page.goto('/');
 await expect(page.locator('.detail-card')).toHaveCount(0);
 await page.locator('.nav-item[data-nav="all"]').click();
 await page.locator('tbody tr').first().click();
 await expect(page.locator('.detail-card')).toBeVisible();
 for(const view of ['incoming','links','overview','all']){
  await page.locator(`.nav-item[data-nav="${view}"]`).click();
  await expect(page.locator('.detail-card')).toHaveCount(0);
 }
});
test('monthly work survives state changes and drill-down matches the metric',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'登记文件',exact:true}).click();
 await page.locator('[name="title"]').fill('月度流转验证');
 await page.locator('[name="status"]').selectOption('processing');
 await page.getByRole('button',{name:'保存记录',exact:true}).click();
 await page.getByRole('button',{name:'编辑记录',exact:true}).click();
 await page.locator('[name="status"]').selectOption('archived');
 await page.getByRole('button',{name:'保存记录',exact:true}).click();
 await page.locator('.nav-item[data-nav="overview"]').click();
 await expect(page.locator('[data-stat="processing"] .stat-number')).toHaveText('1份');
 await expect(page.locator('[data-stat="archived"] .stat-number')).toHaveText('1份');
 await page.locator('[data-stat="processing"]').click();
 await expect(page.locator('tbody tr')).toHaveCount(1);
 await expect(page.locator('tbody tr')).toContainText('月度流转验证');
 await expect(page.locator('tbody tr')).toContainText('已归档');
});
test('appearance uses available width and range help occupies its own row',async({page})=>{
 await page.goto('/');
 await page.locator('.nav-item[data-nav="settings"]').click();
 await page.getByRole('button',{name:/外观与字体/}).click();
 for(const width of [1080,1440,1920]){
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  const bounds=await page.locator('.appearance-grid').boundingBox();
  const card=await page.locator('.appearance-grid > .settings-card').boundingBox();
  expect(card!.width).toBeGreaterThan(bounds!.width*.95);
  for(const field of await page.locator('.range-field').all()){
   const slider=await field.locator('input').boundingBox(),help=await field.locator('small').boundingBox();
   expect(help!.y).toBeGreaterThanOrEqual(slider!.y+slider!.height);
  }
 }
 await page.screenshot({path:'test-results/appearance-updated.png',fullPage:true});
});

test('workspace fits common window heights without sidebar or horizontal scrolling',async({page})=>{
 await page.goto('/');
 for(const size of [{width:1080,height:720},{width:1440,height:900}]){
  await page.setViewportSize(size);
  for(const scale of ['0.9','1.15']){
   await page.evaluate(scale=>document.documentElement.style.setProperty('--font-scale',scale),scale);
   for(const view of ['overview','all']){
    await page.locator(`.nav-item[data-nav="${view}"]`).click();
    const dims=await page.evaluate(()=>{const side=document.querySelector('.sidebar')!;return {side:side.scrollHeight-side.clientHeight,width:document.documentElement.scrollWidth-innerWidth};});
    expect(dims.side).toBeLessThanOrEqual(1);
    expect(dims.width).toBeLessThanOrEqual(1);
   }
  }
 }
});
