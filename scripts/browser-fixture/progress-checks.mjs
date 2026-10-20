import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const screenshotDirectory = resolve('work/ai-gauge-progress-fixtures');

const CYAN = [45, 229, 244], ORANGE = [255, 174, 50], RED = [255, 69, 78];
const stripBars = "[window.__fixtureUsageRoot.querySelector('progress')]";
const popupBars = "[...document.querySelectorAll('.card progress')]";

async function waitFor(context, expression) {
  for (let i = 0; i < 40; i++) {
    if (await context.evaluate(expression)) return;
    await context.pause(25);
  }
  assert.fail(`Progress update timed out: ${expression}`);
}

// Chromium exposes native progress internals inconsistently through
// getComputedStyle(pseudo). Sample its actual painted pixels instead.
async function paintedBars({ cdp, session, evaluate }, bars, colors, screenshotName) {
  const geometry = await evaluate(`(${bars}).map(bar=>{const r=bar.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,value:bar.value,max:bar.max,hidden:bar.hidden}})`);
  assert.equal(geometry.length, colors.length);
  for (const bar of geometry) {
    assert.equal(bar.hidden, false);
    assert.equal(bar.max, 100);
    assert(bar.value >= 0 && bar.value <= 100);
    assert(bar.width > 0 && bar.height > 0);
  }
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, session);
  const samples = await evaluate(`(async()=>{const image=new Image();image.src='data:image/png;base64,${screenshot.data}';await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);return ${JSON.stringify(geometry)}.map(bar=>{const pixel=fraction=>[...context.getImageData(Math.floor(bar.x+bar.width*fraction),Math.floor(bar.y+bar.height/2),1,1).data].slice(0,3);return {fill:bar.value===0?[]:[.2,.5,.8].map(fraction=>pixel(bar.value/100*fraction)),empty:bar.value===100?null:pixel((bar.value+100)/200)}})})()`);
  samples.forEach((sample, i) => {
    for (const pixel of sample.fill) assert.deepEqual(pixel, colors[i], `Solid progress fill at ${geometry[i].value}% (item ${i})`);
    if (sample.empty) assert.notDeepEqual(sample.empty, colors[i], 'Unfilled track remains neutral');
  });
  if (screenshotName) {
    await mkdir(screenshotDirectory, { recursive: true });
    await writeFile(join(screenshotDirectory, screenshotName), Buffer.from(screenshot.data, 'base64'));
  }
  return samples;
}

export async function checkStripProgressColors(context, provider) {
  const { cdp, session, evaluate } = context;
  const dataProvider = provider === 'codex' ? 'chatgpt' : provider;
  await evaluate(`window.__progressSaved=structuredClone(window.__fixture);window.__progressBodyStyle=document.body.style.cssText;window.__progressBar=window.__fixtureUsageRoot.querySelector('progress');window.__progressOldValue=window.__progressBar.value;window.__progressParent=document.getElementById('ai-gauge-usage-strip').parentElement;window.__progressParentStyle=window.__progressParent.style.cssText;`);
  for (const theme of ['light', 'dark']) {
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, session);
    await evaluate(`window.__progressParent.style.backgroundColor=document.body.style.background=${JSON.stringify(theme === 'dark' ? '#202020' : '#ffffff')};document.body.style.color=${JSON.stringify(theme === 'dark' ? '#ececec' : '#000000')};`);
    for (const [percent, color] of [[0,CYAN],[30,CYAN],[69.9,CYAN],[70,ORANGE],[89.9,ORANGE],[90,RED],[100,RED]]) {
      await evaluate(`{const s=window.__fixture.snapshots.${dataProvider};s.state='ok';s.errorCode=null;s.failures=0;delete s.usageInvalidated;s.collectedAt=s.checkedAt=Date.now();s.limits=[{...s.limits[0],percent:${percent},resetsAt:new Date(Date.now()+7200000).toISOString()}];window.__fixture.settings.warning=70;window.__fixture.settings.danger=90;for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');}`);
      await waitFor(context, `!window.__progressBar.hidden&&window.__progressBar.value===${percent}`);
      const result = await evaluate(`(()=>{const root=window.__fixtureUsageRoot,bar=root.querySelector('progress'),gauge=root.querySelector('.usage-gauge');return {same:bar===window.__progressBar,width:bar.getBoundingClientRect().width,height:bar.getBoundingClientRect().height,stripHeight:document.getElementById('ai-gauge-usage-strip').getBoundingClientRect().height,stroke:getComputedStyle(gauge.querySelector('.gauge-arc')).stroke,animations:bar.getAnimations({subtree:true}).length}})()`);
      assert.deepEqual(result, { same:true,width:80,height:6,stripHeight:30,stroke:`rgb(${color.join(', ')})`,animations:0 }, `${provider} ${theme}: same value/color as gauge and unchanged geometry, with reduced motion`);
      await paintedBars(context, stripBars, [color], percent === 70 ? `ai-gauge-${provider}-progress-${theme}-fixture.png` : null);
    }
    await evaluate(`{const s=window.__fixture.snapshots.${dataProvider};s.limits[0].percent=40.5;window.__fixture.settings.warning=40.5;window.__fixture.settings.danger=60.25;for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');}`);
    await waitFor(context, `window.__progressBar.value===40.5&&getComputedStyle(window.__fixtureUsageRoot.querySelector('.gauge-arc')).stroke==='rgb(255, 174, 50)'`);
    await paintedBars(context, stripBars, [ORANGE]);
    await evaluate(`window.__fixture.settings.danger=40.5;window.__fixture.settings.warning=20.25;for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
    await waitFor(context, `getComputedStyle(window.__fixtureUsageRoot.querySelector('.gauge-arc')).stroke==='rgb(255, 69, 78)'`);
    await paintedBars(context, stripBars, [RED]);
  }
  await evaluate(`window.__fixture=window.__progressSaved;document.body.style.cssText=window.__progressBodyStyle;window.__progressParent.style.cssText=window.__progressParentStyle;for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  await waitFor(context, `window.__fixtureUsageRoot.querySelector('progress').value===window.__progressOldValue`);
  await cdp('Emulation.setEmulatedMedia', { features: [] }, session);
}

export async function checkPopupProgressColors(context) {
  const { cdp, session, evaluate } = context;
  await evaluate(`window.__progressSaved=structuredClone(window.__fixture);`);
  for (const theme of ['light', 'dark']) {
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, session);
    await evaluate(`{window.__fixture.settings.warning=70;window.__fixture.settings.danger=90;for(const p of ['chatgpt','claude','gemini']){const s=window.__fixture.snapshots[p];s.state='ok';s.failures=0;s.errorCode=null;s.collectedAt=s.checkedAt=Date.now();s.limits=[30,70,90].map((percent,i)=>({...s.limits[0],id:'progress-'+i,label:['5시간','주간','Additional model'][i],category:i===2?'model':'window',windowSeconds:[18000,604800,null][i],percent,resetsAt:new Date(Date.now()+7200000).toISOString()}));}for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');}`);
    await waitFor(context, `document.querySelectorAll('.card progress').length===9&&document.querySelector('.card progress').value===30`);
    assert.deepEqual(await evaluate(`(${popupBars}).map(bar=>bar.value)`), [30,70,90,30,70,90,30,70,90], 'Each popup limit retains its own usage value');
    await paintedBars(context, popupBars, [CYAN,ORANGE,RED,CYAN,ORANGE,RED,CYAN,ORANGE,RED], `ai-gauge-popup-progress-${theme}-fixture.png`);
    await evaluate(`window.__fixture.settings.warning=30;window.__fixture.settings.danger=70;for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
    await waitFor(context, `getComputedStyle(document.querySelector('.card progress')).getPropertyValue('--usage-color').trim().toUpperCase()==='#FFAE32'`);
    await paintedBars(context, popupBars, [ORANGE,RED,RED,ORANGE,RED,RED,ORANGE,RED,RED]);
    await evaluate(`for(const p of ['chatgpt','claude','gemini']){const s=window.__fixture.snapshots[p];s.state='error';s.errorCode='network';s.failures=2;}for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
    await waitFor(context, `document.querySelectorAll('.old progress').length===9`);
    await paintedBars(context, popupBars, Array(9).fill(theme === 'dark' ? [158,175,198] : [89,109,133]));
  }
  await evaluate(`window.__fixture=window.__progressSaved;for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  await waitFor(context, `document.querySelectorAll('.card progress').length===4`);
  await cdp('Emulation.setEmulatedMedia', { features: [] }, session);
}
