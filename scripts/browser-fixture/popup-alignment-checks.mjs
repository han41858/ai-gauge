import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const screenshots = resolve('work/ai-gauge-popup-alignment');

export async function checkPopupUsageAlignment({ cdp, session, evaluate, pause }) {
  await evaluate(`window.__alignmentSaved=structuredClone(window.__fixture);`);
  for (const language of ['ko', 'en']) {
    await evaluate(`window.__fixture.settings.language='${language}';for(const [providerIndex,p] of ['chatgpt','claude','gemini'].entries()){const s=window.__fixture.snapshots[p];s.state='ok';s.failures=0;s.errorCode=null;s.collectedAt=s.checkedAt=Date.now();s.limits=[0,9,20,70,100,null].map((_,i)=>({...s.limits[0],id:'alignment-'+i,label:['5시간','주간','Long additional model name without abbreviations','Additional feature','5시간','주간'][i],category:'model',windowSeconds:null,percent:[0,9,20,70,100,null][(i+providerIndex)%6],resetsAt:new Date(Date.now()+7200000).toISOString()}));}for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`document.querySelectorAll('.limit').length===18&&document.documentElement.lang==='${language}'`)) break;
      await pause(25);
    }
    for (const width of [600, 520, 481, 390, 320]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1800, deviceScaleFactor: 1, mobile: false }, session);
      const layout = await evaluate(`(()=>{const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};const textRects=node=>{const r=document.createRange();r.selectNodeContents(node);return [...r.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom}))};return {overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,rows:[...document.querySelectorAll('.limit')].map(row=>{const label=row.querySelector('.limit-line>:first-child'),usage=row.querySelector('.percent'),progress=row.querySelector('progress'),reset=row.querySelector('.reset');return {text:usage.textContent,usage:box(usage),usageText:textRects(usage),label:box(label),labelText:textRects(label),progress:progress&&box(progress),reset:box(reset),row:box(row)}})}})()`);
      assert.equal(layout.overflow, false, `${language} ${width}px: popup has no horizontal overflow`);
      assert.equal(layout.rows.length, 18);
      const first = layout.rows[0];
      const firstBar = layout.rows.find(row => row.progress).progress;
      for (const row of layout.rows) {
        // Measure text itself: equal span boxes can hide right-aligned text drift.
        assert(Math.abs(row.usageText[0].left - first.usageText[0].left) < .1,
          `${language} ${width}px: usage prefixes align across providers, values and unknowns: ${JSON.stringify(layout.rows.map(r=>({text:r.text,x:r.usageText[0].left})))}`);
        assert(row.labelText.every(rect => rect.right <= row.usageText[0].left - 3), 'Long period/model labels wrap before the usage column');
        assert(row.usageText.every(rect => rect.left >= row.row.left && rect.right <= row.row.right), 'All usage text remains inside its row');
        assert(Math.abs(row.reset.left - first.reset.left) < .1, 'Reset column remains aligned even without a progress bar');
        assert(row.reset.right <= row.row.right + .1, 'Reset text remains within its row');
        if (row.progress) {
          assert(Math.abs(row.progress.left - firstBar.left) < .1, 'Progress tracks stay aligned independently of usage value');
          assert(row.usageText.every(rect => rect.right <= row.progress.left - 3), 'Usage text does not overlap the progress track');
          assert(row.progress.right <= row.row.right + .1, 'Progress stays inside its row');
          if (width > 480) assert(row.progress.right < row.reset.left, 'Wide reset follows the progress track');
          else assert(row.reset.top >= Math.max(row.usage.bottom, row.label.bottom, row.progress.bottom), 'Narrow reset occupies the next row');
        }
      }
      assert(layout.rows.some(row => row.labelText.length > 1), 'The long model label wraps without moving usage prefixes');
      await mkdir(screenshots, { recursive: true });
      const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, session);
      await writeFile(join(screenshots, `popup-alignment-${language}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
    }
    await evaluate(`for(const p of ['chatgpt','claude','gemini']){const s=window.__fixture.snapshots[p];s.state='error';s.failures=2;s.errorCode='network';}for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`document.querySelectorAll('.old').length===18`)) break;
      await pause(25);
    }
    assert.equal(await evaluate(`document.querySelectorAll('.old').length`), 18, 'Existing previous-usage rows remain visible and marked after collection failure');
    assert.equal(await evaluate(`document.querySelectorAll('.old progress').length`), 15, 'Unknown usage remains without a progress bar');
  }
  await evaluate(`window.__fixture=window.__alignmentSaved;for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  for (let i = 0; i < 40; i++) {
    if (await evaluate(`document.querySelectorAll('.limit').length===4&&document.documentElement.lang==='ko'`)) break;
    await pause(25);
  }
  for (const [language, width] of [['ko',600], ['en',320]]) {
    await evaluate(`window.__fixture.settings.language='${language}';for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`document.documentElement.lang==='${language}'`)) break;
      await pause(25);
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
    const height = await evaluate('Math.ceil(document.body.getBoundingClientRect().height)');
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x:0, y:0, width, height, scale:1 } }, session);
    await writeFile(join(screenshots, `popup-normal-${language}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  await evaluate(`window.__fixture.settings.language='system';for(const fn of window.__storageListeners)fn({'settings:v2':{}},'local');`);
  for (let i = 0; i < 40; i++) {
    if (await evaluate(`document.documentElement.lang==='ko'`)) break;
    await pause(25);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 1000, deviceScaleFactor: 1, mobile: false }, session);
}
