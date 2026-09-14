import assert from "node:assert/strict";
import test from "node:test";
import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";

test('GM following another user keeps the real primary target; a private retarget becomes the GM selection', async () => {
    const f=focusFixture({gm:true});
    f.combat.combatant.runtimeController=f.other;
    const active=getHudContext();
    assert.equal(getHudFocusContexts(active).action.target,f.targetToken);
    await setHudFocusTarget(getHudFocusContexts(active).action,f.ownToken.uuid);
    assert.equal(getHudContext().target,f.targetToken);
    const focused=getHudFocusContexts(getHudContext());
    assert.equal(focused.mode,'personal');
    assert.equal(focused.personal.token,f.activeToken);
    assert.equal(focused.personal.target,f.ownToken);
    assert.equal((buildFocusedTargetColumn(getHudContext()).match(/class="sf-portrait /g)??[]).length,2);
    assert.deepEqual(f.calls.targets,[]);
});

test('explicit tick commands address the selected clone, including after a custom dialog', async () => {
    const { addFocusedCombatTicks } = await import('../Modul/splittermond-smoother-fight/scripts/features/combat-actions/focus-ticks.js');
    const f = focusFixture(); const changes=[];
    f.combat.setInitiative=async(id,value)=>{changes.push([id,value]);f.combat.combatants.find(c=>c.id===id).initiative=value;};
    selectHudFocus(getHudContext(),'personal',f.cloneToken.uuid);
    const context=getHudFocusContexts(getHudContext()).action;
    await addFocusedCombatTicks(context,4);
    assert.deepEqual(changes,[['clone',22]]);
    globalThis.foundry={applications:{api:{DialogV2:{wait:async()=>{
        selectHudFocus(getHudContext(),'personal',f.ownToken.uuid);return 5;
    }}}}};
    await addFocusedCombatTicks(context,3,{prompt:true});
    assert.deepEqual(changes,[['clone',22],['clone',27]]);
    f.own.isOwner=false;
    assert.equal(await addFocusedCombatTicks(context,2),null);
    assert.equal(changes.length,2);
});

test('a different client follows token-specific targets even while its controller inspects another actor', async () => {
    const { receiveHudFocusTargets } = await import('../Modul/splittermond-smoother-fight/scripts/features/hud/focus-target-sync.js');
    const f = focusFixture();
    f.ghost.testUserPermission = user => user.id === f.other.id;
    const payload = { tokenUuid: f.activeToken.uuid, targetTokenUuids: [f.targetToken.uuid], primaryTargetTokenUuid: f.targetToken.uuid };
    assert.equal(receiveHudFocusTargets(payload, f.other), true);
    f.nativeTargets.set(f.other.id, { target: f.ownToken, targets: [f.ownToken] });
    assert.equal(getHudContext().target, f.targetToken);
    f.settings.characterFocusHud = false;
    assert.equal(getHudContext().target, f.targetToken);
    receiveHudFocusTargets({reset:true}, f.other);
    assert.equal(getHudContext().target, f.ownToken);
});
test('remote focus target publications require ownership and do not expose invisible targets', async () => {
    const { receiveHudFocusTargets } = await import('../Modul/splittermond-smoother-fight/scripts/features/hud/focus-target-sync.js');
    const f = focusFixture();
    const payload = { tokenUuid: f.activeToken.uuid, targetTokenUuids: [f.ownToken.uuid], primaryTargetTokenUuid: f.ownToken.uuid };
    assert.equal(receiveHudFocusTargets(payload, f.player), false);
    f.ghost.testUserPermission = user => user.id === f.other.id;
    assert.equal(receiveHudFocusTargets(payload, f.other), true);
    assert.equal(getHudContext().target, f.ownToken);
    f.ownToken.object.isVisible = false;
    assert.equal(getHudContext().target, null);
});
test('native marker restoration during focus switching cannot overwrite the active turn target', () => {
    const f = focusFixture({gm:true});
    const active = getHudContext();
    getHudFocusContexts(active);
    let markers = 0;
    services.setLocalTarget = () => { markers++; captureHudFocusTargets(f.player, [f.targetToken.uuid]); };
    selectHudFocus(active, 'personal', f.ownToken.uuid);
    assert.equal(markers, 1);
    assert.equal(getHudContext().target, f.activeToken);
    assert.equal(getHudFocusContexts(getHudContext()).personal.target, f.activeToken);
    delete services.setLocalTarget;
});
test('preparation rechecks a turn change while its application state is being saved', async () => {
    const f = focusFixture();
    f.combat.combatant = f.combat.combatants[1];
    const context = getHudFocusContexts(getHudContext()).personal;
    const original = f.own.setFlag;
    f.own.setFlag = async function(...args) {
        const result = await original.apply(this,args);
        if(args[1]==='preparationApplication' && args[2]?.state==='applying') f.combat.combatant=f.combat.combatants[0];
        return result;
    };
    await performAttack(context,'bow');
    assert.deepEqual(f.calls.ticks,[]);
    assert.equal(f.own.system.preparedAction.attack,null);
    assert.equal(f.own.flags['splittermond-smoother-fight'].preparationApplication.state,'idle');
});
import { focusFixture } from "./fixtures/hud-focus-fixture.mjs";
import { getHudContext, resolveHudActionContext, reconcileControlledCombatTokenSelection } from "../Modul/splittermond-smoother-fight/scripts/features/hud/context.js";
import { getHudFocusCandidates,getHudFocusContexts,selectHudFocus,selectControlledHudToken,sameHudToken,resolveHudFocusActionContext,setHudFocusTarget,captureHudFocusTargets } from "../Modul/splittermond-smoother-fight/scripts/features/hud/focus-context.js";
import { buildHud } from "../Modul/splittermond-smoother-fight/scripts/features/hud/view.js";
import { buildFocusedActorColumn,buildFocusedTargetColumn } from "../Modul/splittermond-smoother-fight/scripts/features/hud/focus-view.js";
import { mayStartTurnAction } from "../Modul/splittermond-smoother-fight/scripts/shared/turn-start.js";
import { performAttack,performSpell } from "../Modul/splittermond-smoother-fight/scripts/features/combat-actions/actions.js";

test('players can select only owned visible tokens in the viewed scene',()=>{
 const f=focusFixture(),c=getHudFocusCandidates(getHudContext());
 assert.deepEqual(new Set(c.map(c=>c.reference)),new Set([f.ownToken.uuid,f.cloneToken.uuid]));
 assert.equal(selectHudFocus(getHudContext(),'personal',f.activeToken.uuid),false);
});
test('GM selection includes scene NPCs but excludes unplaced Actors',()=>{
 const f=focusFixture({gm:true});assert.ok(getHudFocusCandidates(getHudContext()).some(c=>c.reference===f.activeToken.uuid));
 assert.equal(selectHudFocus(getHudContext(),'personal',f.unplaced.uuid),false);
 assert.equal(selectHudFocus(getHudContext(),'personal',f.targetToken.uuid),true);
 const c=getHudFocusContexts(getHudContext()).action;assert.equal(c.actor,f.merc);assert.equal(c.token,f.targetToken);assert.equal(c.combatant,null);assert.equal(mayStartTurnAction(c),false);
});

test('a GM without a personal selection adopts a controlled NPC without changing the active turn',()=>{
 const f=focusFixture({gm:true});f.player.character=null;services.getControlledTokenDocument=()=>null;
 assert.equal(getHudFocusContexts(getHudContext()).personal,null);
 const active=getHudContext();
 assert.equal(selectControlledHudToken(f.targetToken.object,true),true);
 const selected=getHudFocusContexts(getHudContext());
 assert.equal(selected.mode,'personal');assert.equal(selected.action.token,f.targetToken);
 assert.equal(f.combat.combatant.token,active.token);assert.equal(getHudContext().target,active.target);
 assert.deepEqual(f.calls.controls,[]);
});

test('canvas selection accepts only owned visible player tokens and ignores releases',()=>{
 const f=focusFixture();getHudFocusContexts(getHudContext());
 services.getControlledTokenDocument=()=>f.cloneToken;
 assert.equal(selectControlledHudToken(f.cloneToken.object,true),true);
 assert.equal(getHudFocusContexts(getHudContext()).action.token,f.cloneToken);
 assert.equal(selectControlledHudToken(f.activeToken.object,true),false);
 assert.equal(selectControlledHudToken(f.cloneToken.object,false),false);
 f.ownToken.hidden=true;assert.equal(selectControlledHudToken(f.ownToken,true),false);
 assert.equal(getHudFocusContexts(getHudContext()).action.token,f.cloneToken);
 f.ownToken.hidden=false;f.settings.characterFocusHud=false;
 assert.equal(selectControlledHudToken(f.ownToken,true),false);
});
test('switching HUD selection neither controls a canvas token nor changes the active combatant',()=>{
 const f=focusFixture();selectHudFocus(getHudContext(),'personal',f.cloneToken.uuid);
 assert.equal(getHudFocusContexts(getHudContext()).action.token,f.cloneToken);assert.deepEqual(f.calls.controls,[]);assert.deepEqual(f.calls.targets,[]);assert.equal(f.combat.combatant.token,f.activeToken);
 assert.equal(reconcileControlledCombatTokenSelection(f.combat),false);
 f.combat.combatant=f.combat.combatants[1];assert.equal(getHudFocusContexts(getHudContext()).action.token,f.cloneToken);
});
test('same Actor with different Token UUIDs is not merged and is not considered active',()=>{
 const f=focusFixture();f.combat.combatant=f.combat.combatants[2];
 assert.equal(sameHudToken(f.ownToken,f.cloneToken),false);assert.equal(mayStartTurnAction(getHudFocusContexts(getHudContext()).action),false);
 const html=buildFocusedActorColumn(getHudContext());assert.equal((html.match(/sf-focus-actor[ .]/g)??[]).length,2);
 f.combat.combatant=f.combat.combatants[1];assert.equal((buildFocusedActorColumn(getHudContext()).match(/sf-focus-actor[ .]/g)??[]).length,1);
});
test('own target remains independent of the current turn and of other personal tokens',async()=>{
 const f=focusFixture();const active=getHudContext(),personal=getHudFocusContexts(active).personal;
 await setHudFocusTarget(personal,f.activeToken.uuid);assert.equal(getHudContext().target,f.targetToken);
 selectHudFocus(getHudContext(),'personal',f.cloneToken.uuid);const clone=getHudFocusContexts(getHudContext()).action;
 await setHudFocusTarget(clone,f.targetToken.uuid);selectHudFocus(getHudContext(),'personal',f.ownToken.uuid);
 assert.equal(getHudFocusContexts(getHudContext()).action.target,f.activeToken);assert.deepEqual(f.calls.targets,[]);
});
test('GM focus changes do not overwrite a player target or the active GM target',async()=>{
 const f=focusFixture({gm:true});getHudFocusContexts(getHudContext());
 selectHudFocus(getHudContext(),'personal',f.ownToken.uuid);await setHudFocusTarget(getHudFocusContexts(getHudContext()).action,f.targetToken.uuid);
 assert.equal(getHudContext().target,f.activeToken);assert.deepEqual(f.calls.targets,[]);
});
test('native target input is captured for the selected token without retargeting a different active token',()=>{
 const f=focusFixture({gm:true});getHudFocusContexts(getHudContext());selectHudFocus(getHudContext(),'personal',f.ownToken.uuid);
 f.nativeTargets.set(f.player.id,{target:f.targetToken,targets:[f.targetToken]});captureHudFocusTargets(f.player);
 assert.equal(getHudFocusContexts(getHudContext()).personal.target,f.targetToken);assert.equal(getHudContext().target,f.activeToken);
});
test('same targets merge independently of different actor tokens',async()=>{
 const f=focusFixture();await setHudFocusTarget(getHudFocusContexts(getHudContext()).personal,f.targetToken.uuid);
 const html=buildFocusedTargetColumn(getHudContext());assert.equal((html.match(/class="sf-portrait /g)??[]).length,1);assert.match(html,/YourTarget/);
});
test('lost target visibility removes its image and name before a later action',async()=>{
 const f=focusFixture();await setHudFocusTarget(getHudFocusContexts(getHudContext()).personal,f.targetToken.uuid);
 f.targetToken.hidden=true;assert.equal(getHudFocusContexts(getHudContext()).personal.target,null);
 const html=buildFocusedTargetColumn({...getHudContext(),target:null,targets:[]});assert.doesNotMatch(html,/Söldner/);
});
test('stale actor scopes never fall back to the newly selected actor',()=>{
 const f=focusFixture();const old=getHudFocusContexts(getHudContext()).personal;
 selectHudFocus(getHudContext(),'personal',f.cloneToken.uuid);
 assert.equal(resolveHudFocusActionContext(old).token,f.ownToken);
 f.own.isOwner=false;assert.equal(resolveHudFocusActionContext(old),null);
 const element={closest:()=>({dataset:{sfFocusReference:old.focusReference}})};assert.equal(resolveHudActionContext(getHudContext(),element),null);
});
test('outside the selected token turn the real spell and ranged entry points do not write flags or ticks, including GM',async()=>{
 for(const gm of [false,true]){const f=focusFixture({gm});selectHudFocus(getHudContext(),'personal',f.ownToken.uuid);const c=getHudFocusContexts(getHudContext()).action;
  await performSpell(c,'spell0');await performAttack(c,'bow');assert.deepEqual(f.calls.ticks,[]);assert.deepEqual(f.calls.flags,[]);assert.equal(f.calls.warnings.length,2);
 }
});
test('a turn change during asynchronous ranged speed calculation is rechecked before mutation',async()=>{
 const f=focusFixture();f.combat.combatant=f.combat.combatants[1];const c=getHudFocusContexts(getHudContext()).personal;
 f.own.attacks[1].weaponSpeedAsync=async()=>{f.combat.combatant=f.combat.combatants[0];return 6;};
 await performAttack(c,'bow');assert.deepEqual(f.calls.ticks,[]);assert.deepEqual(f.calls.flags,[]);
});
test('new view reuses complete menus, blocks starts, and renders events from the active context',async()=>{
 const f=focusFixture(),active=getHudContext(),html=await buildHud(active);
 assert.match(html,/data-sf-menu="skills"/);assert.match(html,/data-sf-menu="attacks"/);assert.match(html,/spell17/);assert.match(html,/sf-defense-menu/);
 assert.match(html,/data-attack-id="bow"[^>]*aria-disabled="true"/);assert.match(html,/data-spell-id="spell0"[^>]*aria-disabled="true"/);assert.match(html,/class="sf-focus-lock"/);assert.doesNotMatch(html,/inspect-hud-item/);
 for(const [button] of html.matchAll(/<button\b[^>]*data-sf-start-blocked[^>]*>/g)) assert.doesNotMatch(button,/\sdisabled(?:\s|=|>)/);
 assert.equal(f.calls.events.at(-1),active);assert.match(html,/Kampf: Geistervarg/);
});
test('scene token outside combat offers its sheet and menus without assuming a combatant',async()=>{
 const f=focusFixture({gm:true});selectHudFocus(getHudContext(),'personal',f.targetToken.uuid);const html=await buildHud(getHudContext());
 assert.match(html,/NotInCombat/);assert.match(html,/data-sf-action="open-token-sheet"/);assert.match(html,/data-sf-menu="skills"/);
});

test('viewed scene is authoritative even with tokens in other scenes or the tracked combat',()=>{
 const f=focusFixture({gm:true});const otherScene={id:'other-scene',tokens:[]};
 const elsewhere={...f.ownToken,id:'elsewhere',uuid:'Scene.other-scene.Token.elsewhere',parent:otherScene};
 otherScene.tokens.push(elsewhere);game.scenes.push(otherScene);
 f.combat.combatants.push({id:'elsewhere',actor:f.own,token:elsewhere});
 selectHudFocus(getHudContext(),'personal',f.ownToken.uuid);
 const oldContext=getHudFocusContexts(getHudContext()).personal;
 assert.equal(getHudFocusCandidates(getHudContext()).some(c=>c.reference===elsewhere.uuid),false);
 assert.equal(selectControlledHudToken(elsewhere,true),false);
 canvas.scene=otherScene;
 assert.deepEqual(getHudFocusCandidates(getHudContext()).map(c=>c.reference),[elsewhere.uuid]);
 assert.equal(resolveHudFocusActionContext(oldContext),null);
 canvas.scene=null;assert.deepEqual(getHudFocusCandidates(getHudContext()),[]);
});
test('turn starts become available for the exact active token and classic layout remains available',async()=>{
 const f=focusFixture();f.combat.combatant=f.combat.combatants[1];const html=await buildHud(getHudContext());assert.doesNotMatch(html,/data-sf-start-blocked/);
 f.settings.characterFocusHud=false;const classic=await buildHud(getHudContext());assert.doesNotMatch(classic,/sf-focus-shell|sf-focus-actor-column/);assert.match(classic,/sf-shell/);
});

test('movement ranges follow the exact player token turn and hide defeated combatants for everyone',async()=>{
 for(const gm of [false,true]){
  const f=focusFixture({gm});f.settings.movementTracking=true;
  selectHudFocus(getHudContext(),'personal',f.ownToken.uuid);
  let html=await buildHud(getHudContext());
  assert.equal(html.includes('sf-movement-tracker'),gm);
  f.combat.combatant=f.combat.combatants[2]; // Same actor, different token.
  html=await buildHud(getHudContext());assert.equal(html.includes('sf-movement-tracker'),gm);
  f.combat.combatant=f.combat.combatants[1];
  assert.match(await buildHud(getHudContext()),/sf-movement-tracker/);
  f.combat.combatants[1].isDefeated=true;
  assert.doesNotMatch(await buildHud(getHudContext()),/sf-movement-tracker/);
  f.combat.combatant=f.combat.combatants[0];
  assert.doesNotMatch(await buildHud(getHudContext()),/sf-movement-tracker/);
 }
});

test('compact actor and target bars obey observer, GM and reveal permissions',async()=>{
 const compact=html=>[...html.matchAll(/<aside class="sf-portrait [^"]*is-compact"[\s\S]*?<\/aside>/g)].map(([part])=>part).join('');
 const f=focusFixture();
 const actor=()=>compact(buildFocusedActorColumn(getHudContext()));
 const target=()=>compact(buildFocusedTargetColumn(getHudContext()));
 assert.doesNotMatch(actor()+target(),/sf-resource/);
 f.ghost.testUserPermission=()=>true;f.merc.testUserPermission=()=>true;
 assert.match(actor(),/sf-resource-health/);assert.match(target(),/sf-resource-focus/);
 f.ghost.testUserPermission=()=>false;f.merc.testUserPermission=()=>false;
 assert.doesNotMatch(actor()+target(),/sf-resource|24\/30|15\/21/);
 f.settings.revealTargetResources=true;
 assert.match(actor(),/24\/30/);assert.match(target(),/15\/21/);
 f.settings.revealTargetResources=false;
 await setHudFocusTarget(getHudFocusContexts(getHudContext()).personal,f.ownToken.uuid);
 selectHudFocus(getHudContext(),'active');
 assert.match(actor(),/sf-resource-health/);assert.match(target(),/sf-resource-focus/);
 f.player.isGM=true;selectHudFocus(getHudContext(),'personal');
 assert.match(actor(),/sf-resource-health/);assert.match(target(),/sf-resource-focus/);
});
