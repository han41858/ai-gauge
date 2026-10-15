import assert from 'node:assert/strict';

// Run against the real content bundle, with the same synthetic provider view as
// browser-fixture. Screen matrices catch a wrong SVG pivot that DOM tests miss.
export async function checkGaugeMatchesUsage(evaluate, pause) {
  await pause(550);
  const value = await evaluate(`(()=>{
    const root=window.__fixtureUsageRoot,gauge=root.querySelector('.usage-gauge'),needle=gauge.querySelector('.gauge-needle'),bar=root.querySelector('progress');
    const center=new DOMPoint(32,46).matrixTransform(gauge.getScreenCTM()),pivot=new DOMPoint(32,46).matrixTransform(needle.getScreenCTM()),tip=new DOMPoint(32,13).matrixTransform(needle.getScreenCTM());
    return {count:root.querySelectorAll('.usage-gauge').length,width:gauge.getBoundingClientRect().width,height:gauge.getBoundingClientRect().height,hidden:gauge.getAttribute('aria-hidden'),percent:bar.value,angle:Math.atan2(tip.x-pivot.x,pivot.y-tip.y)*180/Math.PI,pivotError:Math.hypot(center.x-pivot.x,center.y-pivot.y),backgroundTransform:getComputedStyle(gauge.querySelector('.gauge-arc')).transform};
  })()`);
  assert.equal(value.count, 1);
  assert.equal(value.width, 20); assert.equal(value.height, 20);
  assert.equal(value.hidden, 'true', 'Numeric usage remains the accessible source');
  assert(value.pivotError < 0.02, `Needle must rotate around SVG (32,46): ${JSON.stringify(value)}`);
  assert(Math.abs(value.angle - (-90 + value.percent * 1.8)) < 0.02, `Needle uses the same percentage as the existing progress: ${JSON.stringify(value)}`);
  assert.equal(value.backgroundTransform, 'none');
}

export async function checkGaugeMotion({ cdp, session, evaluate, pause }) {
  await evaluate(`window.__gaugeSavedSnapshot=structuredClone(window.__fixture.snapshots.chatgpt);window.__gaugeSavedSettings=structuredClone(window.__fixture.settings);window.__gaugeNode=window.__fixtureUsageRoot.querySelector('.usage-gauge');`);
  const setPercent = async percent => {
    await evaluate(`{const s=window.__fixture.snapshots.chatgpt;s.state='ok';s.errorCode=null;s.failures=0;s.collectedAt=s.checkedAt=Date.now();s.limits=[{...s.limits[0],percent:${percent},resetsAt:new Date(Date.now()+7200000).toISOString()}];for(const fn of window.__storageListeners)fn({},'local');}`);
    for (let i=0;i<20;i++) {
      if(await evaluate(`window.__fixtureUsageRoot.querySelector('progress').value===${percent}`)) return;
      await pause(25);
    }
    assert.fail('Usage update did not reach the strip');
  };
  const stroke = () => evaluate(`getComputedStyle(window.__gaugeNode.querySelector('.gauge-arc')).stroke`);
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, session);
  for (const percent of [0,50,100]) {
    await setPercent(percent);
    await checkGaugeMatchesUsage(evaluate,pause);
  }
  await setPercent(0); await pause(550);
  await setPercent(100); await pause(80);
  const motion=await evaluate(`(()=>{const needle=window.__gaugeNode.querySelector('.gauge-needle'),arc=window.__gaugeNode.querySelector('.gauge-arc'),matrix=new DOMMatrix(getComputedStyle(needle).transform);return {needle:needle.getAnimations().map(a=>a.effect.getTiming().duration),arc:arc.getAnimations().map(a=>a.effect.getTiming().duration),angle:Math.atan2(matrix.b,matrix.a)*180/Math.PI};})()`);
  assert(motion.needle.includes(500), 'A real usage change creates the 500ms needle transition');
  assert(motion.arc.includes(300), 'A threshold crossing creates the 300ms arc transition');
  assert(motion.angle>-90&&motion.angle<90, 'Needle passes through intermediate angles');
  await pause(550);
  for(const [percent,color] of [[69.99,'rgb(45, 229, 244)'],[70,'rgb(255, 174, 50)'],[89.99,'rgb(255, 174, 50)'],[90,'rgb(255, 69, 78)']]) {
    await setPercent(percent); await pause(550);
    assert.equal(await stroke(),color,`Default threshold at ${percent}%`);
  }
  await setPercent(50); await pause(550);
  await evaluate(`window.__gaugeNeedleChanges=0;window.__gaugeObserver=new MutationObserver(records=>{window.__gaugeNeedleChanges+=records.length});window.__gaugeObserver.observe(window.__gaugeNode.querySelector('.gauge-needle'),{attributes:true,subtree:true});window.__fixture.settings.warning=40;window.__fixture.settings.danger=60;for(const fn of window.__storageListeners)fn({},'local');`);
  await pause(350);
  assert.equal(await stroke(),'rgb(255, 174, 50)', 'Saved custom thresholds propagate through the existing storage listener');
  assert.equal(await evaluate('window.__gaugeNeedleChanges'),0, 'Threshold-only changes do not rotate or mutate the needle');
  await evaluate(`for(let i=0;i<3;i++)for(const fn of window.__runtimeListeners)fn({type:'invalidate'},{id:'fixture'});`);
  await pause(350);
  assert.equal(await evaluate('window.__gaugeNeedleChanges'),0, 'Repeated views with unchanged usage do not restart animation');
  assert(await evaluate(`window.__fixtureUsageRoot.querySelector('.usage-gauge')===window.__gaugeNode&&window.__gaugeNode.getAnimations({subtree:true}).length===0`));
  await evaluate('window.__gaugeObserver.disconnect()');
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, session);
  await setPercent(100);
  assert(await evaluate(`window.__gaugeNode.getAnimations({subtree:true}).length===0&&getComputedStyle(window.__gaugeNode.querySelector('.gauge-needle')).transitionDuration==='0s'&&getComputedStyle(window.__gaugeNode.querySelector('.gauge-arc')).transitionDuration==='0s'`), 'Reduced motion disables both needle and color transitions');
  await checkGaugeMatchesUsage(evaluate,pause);
  await cdp('Emulation.setEmulatedMedia', { features: [] }, session);
  await evaluate(`window.__fixture.snapshots.chatgpt=window.__gaugeSavedSnapshot;window.__fixture.settings=window.__gaugeSavedSettings;for(const fn of window.__storageListeners)fn({},'local');`);
  await checkGaugeMatchesUsage(evaluate,pause);
}
