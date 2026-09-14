import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const runtimeRoot=path.resolve(process.env.HUD_MODULE_ROOT ?? path.join(root,"Modul","splittermond-smoother-fight"));
const modulePath=process.env.PLAYWRIGHT_MODULE_PATH;
const playwright=await import(modulePath ? pathToFileURL(path.join(modulePath,"index.mjs")).href : "playwright");
const browserName=process.env.HUD_BROWSER ?? "chromium";
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,"http://localhost"),local=decodeURIComponent(url.pathname).replace(/^\/modules\//,"/Modul/");
  const prefix="/Modul/splittermond-smoother-fight/",isRuntime=local.startsWith(prefix);
  const base=isRuntime?runtimeRoot:root;
  const file=path.resolve(base,isRuntime?local.slice(prefix.length):"."+local);
  if(!file.startsWith(base+path.sep)) {res.writeHead(403).end();return;}
  const types={".js":"text/javascript",".mjs":"text/javascript",".json":"application/json",".css":"text/css",".html":"text/html",".svg":"image/svg+xml",".webp":"image/webp"};
  res.setHeader("content-type",types[path.extname(file)]??"application/octet-stream");res.end(await fs.readFile(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await playwright[browserName].launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE || undefined});
const page=await browser.newPage({viewport:{width:1920,height:1080}});
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const output=path.join(root,"tmp","hud-focus-qa",browserName);await fs.mkdir(output,{recursive:true});
async function pointerClick(locator,button='left'){
 await locator.scrollIntoViewIfNeeded();
 const rect=await locator.boundingBox();assert.ok(rect);
 await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2,{button});
}
async function rightClickItem(locator,itemId){
 const count=await page.evaluate(()=>fixture.calls.sheets.length);
 await page.evaluate(()=>{
  window.lastItemContextMenu=null;
  document.addEventListener('contextmenu',event=>{window.lastItemContextMenu=event;},{capture:true,once:true});
 });
 await pointerClick(locator,'right');
 assert.deepEqual(await page.evaluate(count=>fixture.calls.sheets.slice(count),count),[itemId]);
 assert.equal(await page.evaluate(()=>window.lastItemContextMenu?.defaultPrevented),true);
}
try{
 await page.goto("http://127.0.0.1:"+server.address().port+"/demo/character-focus.html?gm=1");
 await page.waitForFunction(()=>window.ready,{},{timeout:8000});
 await page.screenshot({path:path.join(output,"gm-fullhd.png")});
 await page.locator('.sf-focus-actor.is-compact .sf-focus-mini').click();
 await page.waitForFunction(()=>document.querySelector('.sf-focus-controls')?.dataset.sfFocusReference==="Scene.scene.Token.own");
 await page.screenshot({path:path.join(output,"personal-fullhd.png")});
 assert.equal(await page.locator('.sf-focus-actor.is-compact').count(),1);
 assert.match(await page.locator('.sf-turnline').innerText(),/Geistervarg/);
 assert.match(await page.locator('.sf-events').innerText(),/Geistervarg/);
 await page.locator('.sf-focus-picker > summary').click();
 assert.equal(await page.locator('.sf-focus-picker [data-sf-quick-target-row]:visible').count(),4);
 await page.locator('.sf-focus-picker [data-sf-quick-target-search]').fill('söld');
 assert.equal(await page.locator('.sf-focus-picker [data-sf-quick-target-row]:visible').count(),1);
 await page.screenshot({path:path.join(output,"picker-fullhd.png")});
 await page.locator('[data-focus-reference="Scene.scene.Token.target"]').click();
 await page.waitForFunction(()=>document.querySelector('.sf-focus-controls')?.dataset.sfFocusReference==="Scene.scene.Token.target");
 await page.locator('.sf-focus-card-scope [data-sf-action="open-token-sheet"]').click();
 assert.equal(await page.evaluate(()=>fixture.calls.sheets.at(-1)),"Söldner");
 await page.locator('.sf-focus-picker > summary').click();
 await page.locator('[data-focus-reference="Scene.scene.Token.own"]').click();
 await page.waitForFunction(()=>document.querySelector('.sf-focus-controls')?.dataset.sfFocusReference==="Scene.scene.Token.own");
 await page.evaluate(async()=>{
  fixture.own.flags['splittermond-smoother-fight']={defaultAttackId:'bow'};
  fixture.ghost.items.get('bow').sheet.render=()=>fixture.calls.sheets.push('wrong-active-bow');
  await hud.render();
 });
 const directBow=page.locator('.sf-direct-attack[data-attack-id="bow"]');
 await rightClickItem(directBow,'bow');
 await page.locator('[data-sf-menu="attacks"] > summary').click();
 const bow=page.locator('.sf-attack-option [data-sf-action="attack"][data-attack-id="bow"]');
 const bowLock=page.locator('.sf-attack-option .sf-focus-lock[data-attack-id="bow"]');
 await bowLock.hover();
 await page.waitForFunction(()=>document.querySelector('.sf-action-tooltip .sf-focus-lock-notice')?.textContent.includes('nicht an der Reihe'));
 assert.equal(await bowLock.innerText(),'');
 assert.equal(await page.locator('[data-sf-action="inspect-hud-item"]').count(),0);
 await page.screenshot({path:path.join(output,"locked-attack-fullhd.png")});
 await rightClickItem(bowLock,'bow');
 await page.mouse.move(50,300);
 await bow.hover();
 await page.waitForFunction(()=>document.querySelector('.sf-action-tooltip .sf-focus-lock-notice')?.textContent.includes('nicht an der Reihe'));
 await rightClickItem(bow,'bow');
 await rightClickItem(bow.locator('img'),'bow');
 const beforeBlockedClicks=await page.evaluate(()=>({flags:fixture.calls.flags.length,ticks:fixture.calls.ticks.length,sheets:fixture.calls.sheets.length}));
 await pointerClick(bow);
 await bowLock.click();
 await pointerClick(directBow);
 await directBow.press('Enter');
 await directBow.press('Space');
 assert.deepEqual(await page.evaluate(()=>({flags:fixture.calls.flags.length,ticks:fixture.calls.ticks.length,sheets:fixture.calls.sheets.length})),beforeBlockedClicks);
 await page.mouse.move(50,300);
 await page.waitForFunction(()=>!document.querySelector('.sf-action-tooltip'));
 await page.locator('[data-sf-menu="spells"] > summary').click();
 assert.equal(await page.locator('[data-sf-action="spell"][aria-disabled="true"]').count(),18);
 assert.equal(await page.locator('button[data-sf-start-blocked]:disabled').count(),0);
 const blockedSpell=page.locator('[data-sf-action="spell"][data-spell-id="spell0"]');
 await rightClickItem(blockedSpell,'spell0');
 await rightClickItem(blockedSpell.locator('img'),'spell0');
 const beforeSpellClicks=await page.evaluate(()=>({flags:fixture.calls.flags.length,ticks:fixture.calls.ticks.length,sheets:fixture.calls.sheets.length}));
 await pointerClick(blockedSpell);
 await blockedSpell.press('Enter');
 await blockedSpell.press('Space');
 assert.deepEqual(await page.evaluate(()=>({flags:fixture.calls.flags.length,ticks:fixture.calls.ticks.length,sheets:fixture.calls.sheets.length})),beforeSpellClicks);
 await page.screenshot({path:path.join(output,"spells-fullhd.png")});
 await page.locator('#turn').click();
 await page.waitForFunction(()=>document.querySelector('.sf-turnline strong')?.textContent==="Peritus");
 assert.equal(await page.locator('[data-sf-menu="spells"]').evaluate(el=>el.open),true);
 assert.equal(await page.locator('[data-sf-start-blocked]').count(),0);
 assert.match(await page.locator('.sf-events').innerText(),/Peritus/);
 assert.equal(await page.locator('.sf-focus-actor-column .sf-portrait').count(),1);
 await page.locator('#turn').click();
 await page.waitForFunction(()=>document.querySelector('.sf-turnline strong')?.textContent==="Geistervarg");
 assert.equal(await page.locator('[data-sf-menu="spells"]').evaluate(el=>el.open),true);
 assert.equal(await page.locator('[data-sf-action="spell"][aria-disabled="true"]').count(),18);
 await page.locator('[data-sf-menu="spells"] > summary').click();
 await page.locator('#theme').click();
 await page.waitForFunction(()=>document.querySelector('.sf-hud')?.classList.contains('sf-theme-light'));
 await page.screenshot({path:path.join(output,"light-fullhd.png")});
 const rects=await page.locator("#splittermond-smoother-fight-hud").evaluate(el=>Object.fromEntries([".sf-center",".sf-focus-actor-column",".sf-focus-target-column",".sf-portrait",".sf-focus-actor.is-compact"].map(selector=>{const r=el.querySelector(selector)?.getBoundingClientRect();return [selector,r?{x:r.x,y:r.y,width:r.width,height:r.height}:null];})));
 console.log(JSON.stringify({errors,rects,output}));
 assert.equal(rects[".sf-focus-actor-column"].width,172);
 assert.equal(rects[".sf-focus-actor-column"].height,324);
 assert.equal(rects[".sf-focus-actor.is-compact"].height,72);
 await page.goto("http://127.0.0.1:"+server.address().port+"/demo/character-focus.html?gm=0");
 await page.waitForFunction(()=>window.ready);
 assert.equal(await page.locator('.sf-focus-controls').getAttribute('data-sf-focus-reference'),"Scene.scene.Token.own");
 await page.locator('.sf-focus-picker > summary').click();
 assert.equal(await page.locator('.sf-focus-picker [data-sf-quick-target-row]:visible').count(),2);
 await page.locator('.sf-focus-picker > summary').click();
 await page.locator('[data-sf-menu="spells"] > summary').click();
 await page.locator('[data-sf-spell-search]').fill('Zauber 17');
 await page.locator('#turn').click();
 await page.waitForFunction(()=>document.querySelector('.sf-turnline strong')?.textContent==="Peritus");
 assert.equal(await page.locator('[data-sf-spell-search]').inputValue(),'Zauber 17');
 assert.equal(await page.locator('[data-sf-action="spell"]:visible').count(),1);
 await page.locator('[data-sf-menu="spells"] > summary').click();
 await page.locator('#turn').click();
 await page.waitForFunction(()=>document.querySelector('.sf-turnline strong')?.textContent==="Geistervarg");
 await page.locator('.sf-focus-actor.is-compact .sf-focus-mini').click();
 await page.waitForFunction(()=>document.querySelector('.sf-focus-shell')?.dataset.sfFocusMode==="active");
 assert.equal(await page.locator('.sf-focus-controls .sf-actions').count(),0);
 assert.match(await page.locator('.sf-events').innerText(),/Geistervarg/);
 await page.locator('.sf-focus-actor.is-compact .sf-focus-mini').click();
 await page.waitForFunction(()=>document.querySelector('.sf-focus-controls')?.dataset.sfFocusReference==="Scene.scene.Token.own");
 await page.screenshot({path:path.join(output,"player-fullhd.png")});
 await page.evaluate(async()=>{
   const c=focus.getHudFocusContexts(services.getHudContext()).personal;
   await focus.setHudFocusTarget(c,fixture.activeToken.uuid,{remove:true});
   await hud.render();
 });
 assert.equal(await page.locator('.sf-focus-target-column .sf-no-target').count(),1);
 assert.equal(await page.locator('.sf-focus-target-column').evaluate(el=>el.getBoundingClientRect().height),rects[".sf-focus-target-column"].height);
 assert.doesNotMatch(await page.locator('.sf-hud').innerText(),/\[object Object\]/);
 await page.screenshot({path:path.join(output,"no-target-fullhd.png")});
 assert.deepEqual(errors,[]);
 // Exercise the installed CSS entry points, including a client still using the pre-upgrade URL.
 // Foundry's main template imports module CSS from an inline style; some packages use a layer.
 const manifest=JSON.parse(await fs.readFile(path.join(runtimeRoot,"module.json"),"utf8"));
 const styleFailures=[];
 page.on("response",response=>{
  if(new URL(response.url()).pathname.endsWith(".css") && !response.ok()) styleFailures.push(response.url());
 });
 for(const stylesheet of [manifest.styles[0],"styles/smoother-fight.css","styles/smoother-fight-0.6.4.css"]){
  for(const layered of [false,true]){
   await page.goto("http://127.0.0.1:"+server.address().port+"/demo/character-focus.html?gm=1");
   await page.waitForFunction(()=>window.ready);
   await page.evaluate(({stylesheet,layered})=>{
    document.querySelector('link[rel="stylesheet"]').remove();
    const style=document.createElement("style");
    style.textContent=`@import "/modules/splittermond-smoother-fight/${stylesheet}"${layered?" layer(modules)":""};`;
    document.head.prepend(style);
   },{stylesheet,layered});
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('.sf-hud')).position==="fixed");
   assert.equal(await page.locator('.sf-focus-actor.is-compact').evaluate(el=>el.getBoundingClientRect().height),72);
   await page.locator('#classic').click();
   assert.equal(await page.locator('.sf-focus-shell').count(),0);
   assert.equal(await page.locator('.sf-hud').evaluate(el=>getComputedStyle(el).position),"fixed");
  }
 }
 assert.deepEqual(styleFailures,[]);
 assert.deepEqual(errors,[]);
 // Empty GM selection: the picker must be clickable outside the short portrait card.
 for(const viewport of [{width:1920,height:1080},{width:1280,height:720}]){
  await page.setViewportSize(viewport);
  await page.goto("http://127.0.0.1:"+server.address().port+"/demo/character-focus.html?gm=1");
  await page.waitForFunction(()=>window.ready);
  await page.evaluate(async()=>{
   focus.resetHudFocus();fixture.player.character=null;services.getControlledTokenDocument=()=>null;
   await hud.render();
  });
  await page.locator('.sf-focus-empty .sf-focus-picker > summary').click();
  const pickerBounds=await page.locator('.sf-focus-empty .sf-quick-target-popover').boundingBox();
  const cardBounds=await page.locator('.sf-focus-empty').boundingBox();
  assert.ok(pickerBounds.y<cardBounds.y-50);
  assert.ok(pickerBounds.x>=0 && pickerBounds.x+pickerBounds.width<=viewport.width);
  if(viewport.width===1920)await page.screenshot({path:path.join(output,"gm-empty-picker-fullhd.png")});
  await page.locator('.sf-focus-empty [data-focus-reference="Scene.scene.Token.own"]').click();
  await page.waitForFunction(()=>document.querySelector('.sf-focus-controls')?.dataset.sfFocusReference==="Scene.scene.Token.own");
 }
 await page.setViewportSize({width:1920,height:1080});
 // Demo map clicks invoke the same receiver as Foundry's controlToken hook.
 await page.locator('.sf-focus-picker > summary').click();
 await page.locator('.map-token').first().click();
 await page.waitForFunction(()=>document.querySelector('.sf-focus-controls')?.dataset.sfFocusReference==="Scene.scene.Token.active");
 assert.equal(await page.locator('.sf-focus-picker').evaluate(el=>el.open),false);
 await page.locator('.sf-focus-picker > summary').click();
 await page.locator('.map-token.second').click();
 await page.waitForFunction(()=>document.querySelector('.sf-focus-controls')?.dataset.sfFocusReference==="Scene.scene.Token.own");
 assert.equal(await page.locator('.sf-focus-picker').evaluate(el=>el.open),false);
 await page.evaluate(async()=>{await hud.render();});
 assert.equal(await page.locator('.sf-focus-picker').evaluate(el=>el.open),false);
 assert.match(await page.locator('.sf-turnline strong').innerText(),/Geistervarg/);
 // Native details grouping handles pointer, keyboard and programmatic openings.
 for(const menu of ['skills','attacks','spells','defense']){
  await page.locator(`[data-sf-menu="${menu}"] > summary`).click();
  assert.equal(await page.locator('.sf-actions details[open]').count(),1);
  assert.equal(await page.locator(`[data-sf-menu="${menu}"]`).evaluate(el=>el.open),true);
 }
 await page.evaluate(async()=>{await hud.render();});
 assert.equal(await page.locator('[data-sf-menu="defense"]').evaluate(el=>el.open),true);
 await page.locator('[data-sf-menu="skills"] > summary').focus();
 await page.keyboard.press('Enter');
 assert.equal(await page.locator('.sf-actions details[open]').count(),1);
 assert.equal(await page.locator('[data-sf-menu="skills"]').evaluate(el=>el.open),true);
 await page.evaluate(async()=>{
  fixture.own.flags['splittermond-smoother-fight']={favoriteSkillIds:['acrobatics'],defaultAttackId:'staff'};
  await hud.render();
 });
 assert.equal(await page.locator('.sf-direct-skill-picker').count(),1);
 assert.equal(await page.locator('.sf-direct-attack-picker[data-sf-menu="attacks"]').count(),1);
 await page.locator('[data-sf-menu="attacks"] > summary').click();
 await page.locator('[data-sf-menu="spells"] > summary').click();
 assert.equal(await page.locator('.sf-actions details[open]').count(),1);
 await page.locator('.sf-direct-skill-picker > summary').click();
 assert.equal(await page.locator('.sf-actions details[open]').count(),1);
 await page.locator('#classic').click();
 for(const menu of ['skills','attacks','spells','defense']){
  await page.locator(`[data-sf-menu="${menu}"] > summary`).click();
  assert.equal(await page.locator('.sf-actions details[open]').count(),1);
 }
 await page.goto("http://127.0.0.1:"+server.address().port+"/demo/character-focus.html?gm=0");
 await page.waitForFunction(()=>window.ready);
 await page.locator('.sf-focus-picker > summary').click();
 await page.locator('.map-token').first().click();
 assert.equal(await page.locator('.sf-focus-controls').getAttribute('data-sf-focus-reference'),'Scene.scene.Token.own');
 assert.equal(await page.locator('.sf-focus-picker').evaluate(el=>el.open),true);
 await page.locator('.sf-focus-actor.is-compact .sf-focus-mini').click();
 await page.waitForFunction(()=>document.querySelector('.sf-focus-shell')?.dataset.sfFocusMode==="active");
 await page.locator('.sf-focus-picker > summary').click();
 await page.locator('.map-token.second').click();
 await page.waitForFunction(()=>document.querySelector('.sf-focus-controls')?.dataset.sfFocusReference==="Scene.scene.Token.own");
 assert.equal(await page.locator('.sf-focus-picker').evaluate(el=>el.open),false);
 assert.match(await page.locator('.sf-events').innerText(),/Geistervarg/);
 assert.deepEqual(errors,[]);
 // A long scene list scrolls independently of the shared search and type controls.
 await page.goto("http://127.0.0.1:"+server.address().port+"/demo/character-focus.html?gm=1");
 await page.waitForFunction(()=>window.ready);
 await page.evaluate(async()=>{
  for(let i=0;i<20;i++)fixture.scene.tokens.push({...fixture.targetToken,id:`guard${i}`,uuid:`Scene.scene.Token.guard${i}`,name:`Wache ${i+1}`});
  await hud.render();
 });
 await page.locator('.sf-focus-picker > summary').click();
 const search=page.locator('.sf-focus-picker [data-sf-quick-target-search]');
 const searchBefore=await search.boundingBox();
 await page.locator('.sf-focus-picker .sf-quick-target-results').evaluate(el=>{el.scrollTop=el.scrollHeight;});
 assert.equal((await search.boundingBox()).y,searchBefore.y);
 assert.equal(await page.locator('.sf-focus-picker [data-sf-quick-target-row]').count(),24);
 assert.equal(await page.locator('.sf-focus-picker [data-focus-reference^="Actor."]').count(),0);
 const searchStyle=selector=>page.locator(selector).evaluate(el=>{
  const style=getComputedStyle(el);return [style.height,style.fontSize,style.padding,style.backgroundColor];
 });
 await page.locator('.sf-quick-targets > summary').click();
 assert.deepEqual(await searchStyle('.sf-focus-picker .sf-quick-target-search input'),await searchStyle('.sf-quick-targets .sf-quick-target-search input'));
 await page.locator('.sf-quick-targets > summary').click();
 await search.fill('Peritus');
 assert.equal(await page.locator('.sf-focus-picker [data-sf-quick-target-row]:visible').count(),2);
 assert.match(await page.locator('.sf-focus-picker .sf-quick-target-results').innerText(),/Peritus · 1\/2/);
 await page.locator('.sf-focus-picker [data-sf-quick-target-filter="npc"]').click();
 assert.equal(await page.locator('.sf-focus-picker [data-sf-quick-target-row]:visible').count(),0);
 assert.equal(await page.locator('.sf-focus-picker [data-sf-quick-target-empty]').isVisible(),true);
 await page.evaluate(async()=>{await hud.render();});
 assert.equal(await search.inputValue(),'Peritus');
 assert.equal(await page.locator('.sf-focus-picker [data-sf-quick-target-filter="npc"]').getAttribute('aria-pressed'),'true');
 await search.fill('Wache');
 assert.equal(await page.locator('.sf-focus-picker [data-sf-quick-target-row]:visible').count(),20);
 await page.evaluate(async()=>{
  fixture.scene.tokens.find(token=>token.id==='guard0').name='Umbenannt';
  const {refreshHudVisibilityParts}=await import('/Modul/splittermond-smoother-fight/scripts/features/hud/canvas-parts.js');
  refreshHudVisibilityParts(hud.element,services.getHudContext());
 });
 assert.equal(await page.locator('.sf-focus-picker [data-sf-quick-target-row]:visible').count(),19);
 assert.equal(await search.inputValue(),'Wache');
 await page.locator('.sf-focus-picker [data-sf-quick-target-filter="all"]').click();
 await search.fill('');
 await page.locator('.sf-focus-picker .sf-quick-target-results').evaluate(el=>{el.scrollTop=0;});
 await page.screenshot({path:path.join(output,"scene-character-picker-fullhd.png")});
 // Expanded portraits pan; compact portraits select. Resource permissions apply to every small card.
 for(const gm of [false,true]){
  await page.goto("http://127.0.0.1:"+server.address().port+`/demo/character-focus.html?gm=${Number(gm)}`);
  await page.waitForFunction(()=>window.ready);
  await page.evaluate(async()=>{
   fixture.settings.movementTracking=true;fixture.ownToken.x=400;fixture.activeToken.x=900;
   focus.selectHudFocus(services.getHudContext(),'active');await hud.render();
  });
  const miniOwn=page.locator('.sf-focus-actor.is-compact[data-sf-token-uuid="Scene.scene.Token.own"]');
  assert.equal(await miniOwn.locator('.sf-resource').count(),2);
  assert.equal(await miniOwn.evaluate(el=>el.getBoundingClientRect().height),72);
  await miniOwn.locator('.sf-focus-mini').click();
  await page.waitForFunction(()=>document.querySelector('.sf-focus-shell')?.dataset.sfFocusMode==='personal');
  assert.equal(await page.evaluate(()=>fixture.calls.pans.length),0);
  assert.equal(await page.locator('.sf-movement-tracker').count(),Number(gm));
  const ownPortrait=page.locator('.sf-focus-actor.is-selected .sf-portrait-focus');
  await ownPortrait.click();
  assert.equal(await page.evaluate(()=>fixture.calls.pans.at(-1)?.x),450);
  const leftPan=await page.evaluate(()=>fixture.calls.pans.at(-1));
  await ownPortrait.click({button:'right'});
  assert.deepEqual(await page.evaluate(()=>fixture.calls.pans.at(-1)),leftPan);
  assert.equal(await page.evaluate(()=>fixture.calls.pans.length),2);
  assert.equal(await page.evaluate(()=>fixture.combat.combatant.id),'active');
  assert.equal(await page.locator('.sf-focus-actor.is-compact .sf-resource').count(),gm?2:0);
  assert.equal(await page.locator('.sf-focus-target.is-compact .sf-resource').count(),gm?2:0);
  await page.locator('#turn').click();
  assert.equal(await page.locator('.sf-movement-tracker').count(),1);
  await page.evaluate(async()=>{fixture.combat.combatants[1].isDefeated=true;await hud.render();});
  assert.equal(await page.locator('.sf-movement-tracker').count(),0);
  await page.locator('#turn').click();
  assert.equal(await page.locator('.sf-movement-tracker').count(),0);
  await page.evaluate(async()=>{fixture.combat.combatants[1].isDefeated=false;await hud.render();});
  if(gm){
   assert.equal(await page.locator('.sf-movement-tracker').count(),1);
   await page.evaluate(async()=>{
    fixture.combat.combatants[1].isDefeated=true;
    const {refreshHudCanvas}=await import('/Modul/splittermond-smoother-fight/scripts/features/hud/canvas-updates.js');
    refreshHudCanvas(hud.element);
   });
   assert.equal(await page.locator('.sf-movement-tracker').count(),0);
  }else{
   await page.evaluate(async()=>{
    fixture.ghost.testUserPermission=()=>true;fixture.merc.testUserPermission=()=>true;
    await hud.render();
   });
   assert.equal(await page.locator('.sf-focus-actor.is-compact .sf-resource').count(),2);
   assert.equal(await page.locator('.sf-focus-target.is-compact .sf-resource').count(),2);
   await page.evaluate(async()=>{
    fixture.ghost.system.healthBar.value=7;fixture.merc.system.focusBar.value=3;
    const {refreshHudVisibilityParts}=await import('/Modul/splittermond-smoother-fight/scripts/features/hud/canvas-parts.js');
    refreshHudVisibilityParts(hud.element,services.getHudContext());
   });
   assert.match(await page.locator('.sf-focus-actor.is-compact .sf-resource-health').innerText(),/7\/30/);
   assert.match(await page.locator('.sf-focus-target.is-compact .sf-resource-focus').innerText(),/3\/21/);
  }
  const smallBars=await page.locator('.is-compact .sf-resource').evaluateAll(bars=>bars.map(el=>{
   const bar=el.getBoundingClientRect(),card=el.closest('.sf-portrait').getBoundingClientRect();
   return {width:bar.width,height:bar.height,fits:bar.right<=card.right&&bar.bottom<=card.bottom};
  }));
  assert.ok(smallBars.length>=2);
  for(const bar of smallBars){assert.equal(bar.height,11);assert.ok(bar.width>=70&&bar.fits);}
  await page.screenshot({path:path.join(output,`compact-resources-${gm?'gm':'player'}-fullhd.png`)});
  if(!gm){
   await page.evaluate(async()=>{
    fixture.ghost.testUserPermission=()=>false;fixture.merc.testUserPermission=()=>false;
    const {refreshHudVisibilityParts}=await import('/Modul/splittermond-smoother-fight/scripts/features/hud/canvas-parts.js');
    refreshHudVisibilityParts(hud.element,services.getHudContext());
   });
   assert.equal(await page.locator('.is-compact .sf-resource').count(),0);
  }
  const beforeActivePan=await page.evaluate(()=>fixture.calls.pans.length);
  await page.locator('.sf-focus-actor.is-compact .sf-focus-mini').click();
  await page.waitForFunction(()=>document.querySelector('.sf-focus-shell')?.dataset.sfFocusMode==='active');
  assert.equal(await page.evaluate(()=>fixture.calls.pans.length),beforeActivePan);
  await page.locator('.sf-focus-actor.is-selected .sf-portrait-focus').click();
  assert.equal(await page.evaluate(()=>fixture.calls.pans.at(-1)?.x),950);
 }
 assert.deepEqual(errors,[]);
 // Draw attention only to a different token whose turn belongs to this user.
 for(const gm of [false,true]){
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto("http://127.0.0.1:"+server.address().port+`/demo/character-focus.html?gm=${Number(gm)}`);
  await page.waitForFunction(()=>window.ready);
  await page.evaluate(async gm=>{
   fixture.combat.combatant=fixture.combat.combatants[gm?0:2];
   focus.selectHudFocus(services.getHudContext(),'personal',fixture.ownToken.uuid);
   await hud.render();
  },gm);
  const attention=page.locator('.sf-focus-actor.is-turn-attention');
  assert.equal(await attention.count(),1);
  assert.equal(await attention.getAttribute('data-sf-token-uuid'),gm?'Scene.scene.Token.active':'Scene.scene.Token.clone');
  assert.match(await attention.locator('.sf-focus-mini').getAttribute('title'),/bist dran/i);
  assert.equal(await attention.evaluate(el=>getComputedStyle(el).animationName),'sf-focus-turn-attention');
  assert.equal(await attention.evaluate(el=>getComputedStyle(el).animationDuration),'2s');
  assert.equal(await attention.evaluate(el=>el.getBoundingClientRect().height),72);
  await attention.evaluate(el=>{const animation=el.getAnimations()[0];animation.pause();animation.currentTime=1000;});
  await page.screenshot({path:path.join(output,`turn-attention-${gm?'gm':'player'}-fullhd.png`)});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await attention.evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await attention.locator('.sf-focus-label .fa-bolt').count(),1);
  await page.evaluate(async()=>{fixture.settings.hudMotion='full';await hud.render();});
  assert.equal(await attention.evaluate(el=>getComputedStyle(el).animationName),'sf-focus-turn-attention');
  await page.evaluate(async()=>{fixture.settings.hudMotion='none';await hud.render();});
  assert.equal(await attention.evaluate(el=>getComputedStyle(el).animationName),'none');
  await attention.locator('.sf-focus-mini').click();
  await page.waitForFunction(()=>document.querySelector('.sf-focus-shell')?.dataset.sfFocusMode==='active');
  assert.equal(await attention.count(),0);
  await page.evaluate(async()=>{
   fixture.settings.hudMotion='system';fixture.combat.combatant.runtimeController=fixture.other;
   focus.selectHudFocus(services.getHudContext(),'personal',fixture.ownToken.uuid);await hud.render();
  });
  assert.equal(await attention.count(),0);
  assert.deepEqual(await page.evaluate(()=>fixture.calls.ticks),[]);
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({runtimeRoot,version:manifest.version,stylesheetChecks:6,styleFailures}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
