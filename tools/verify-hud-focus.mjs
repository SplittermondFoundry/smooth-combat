import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const runtimeRoot=path.resolve(process.env.HUD_MODULE_ROOT ?? path.join(root,"Modul","splittermond-smoother-fight"));
const modulePath=process.env.PLAYWRIGHT_MODULE_PATH;
const {chromium}=await import(modulePath ? pathToFileURL(path.join(modulePath,"index.mjs")).href : "playwright");
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
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
const page=await browser.newPage({viewport:{width:1920,height:1080}});
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const output=path.join(root,"tmp","hud-focus-qa");await fs.mkdir(output,{recursive:true});
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
 assert.equal(await page.locator('.sf-focus-picker [data-focus-search]:visible').count(),5);
 await page.locator('[data-sf-focus-search]').fill('ohne');
 assert.equal(await page.locator('.sf-focus-picker [data-focus-search]:visible').count(),1);
 await page.screenshot({path:path.join(output,"picker-fullhd.png")});
 await page.locator('[data-focus-reference="Actor.Bogen ohne Token"]').click();
 await page.waitForFunction(()=>document.querySelector('.sf-focus-controls')?.dataset.sfFocusReference==="Actor.Bogen ohne Token");
 await page.locator('.sf-focus-card-scope [data-sf-action="open-sheet"]').click();
 assert.equal(await page.evaluate(()=>fixture.calls.sheets.at(-1)),"Bogen ohne Token");
 await page.locator('.sf-focus-picker > summary').click();
 await page.locator('[data-focus-reference="Scene.scene.Token.own"]').click();
 await page.waitForFunction(()=>document.querySelector('.sf-focus-controls')?.dataset.sfFocusReference==="Scene.scene.Token.own");
 await page.locator('[data-sf-menu="spells"] > summary').click();
 assert.equal(await page.locator('[data-sf-action="spell"]:disabled').count(),18);
 await page.locator('[data-sf-action="inspect-hud-item"][data-item-id="spell0"]').click();
 assert.equal(await page.evaluate(()=>fixture.calls.sheets.at(-1)),"spell0");
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
 assert.equal(await page.locator('[data-sf-action="spell"]:disabled').count(),18);
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
 assert.equal(await page.locator('.sf-focus-picker [data-focus-search]:visible').count(),3);
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
 assert.equal(await page.locator('.sf-focus-target-column').evaluate(el=>el.getBoundingClientRect().height),356);
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
 console.log(JSON.stringify({runtimeRoot,version:manifest.version,stylesheetChecks:6,styleFailures}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
