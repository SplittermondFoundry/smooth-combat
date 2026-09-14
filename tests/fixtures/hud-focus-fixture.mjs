import { services } from "../../Modul/splittermond-smoother-fight/scripts/core/services.js";
import { getHudContext } from "../../Modul/splittermond-smoother-fight/scripts/features/hud/context.js";
import { resetHudFocus, resolveHudFocusActionContext, setHudFocusTarget, captureHudFocusTargets } from "../../Modul/splittermond-smoother-fight/scripts/features/hud/focus-context.js";
import { isRangedAttack } from "../../Modul/splittermond-smoother-fight/scripts/features/combat-actions/attack-type.js";

export function focusFixture({ gm = false, dictionary = null } = {}) {
    resetHudFocus();
    const calls = { controls: [], targets: [], flags: [], ticks: [], events: [], sheets: [], warnings: [], rolls: [] };
    const player = { id: "player", isGM: gm, active: true, name: "Pad", targets: new Set() };
    const other = { id: "other", active: true, name: "Andere Person" };
    const settings = { characterFocusHud: true, enabled: true, showCards: true, minimized: false, movementTracking: false, meleeRange: 2, theme: "dark" };
    const localize = key => dictionary ? key.split('.').reduce((v,k)=>v?.[k],dictionary) ?? key : key;
    globalThis.game = { user: player, i18n: { lang: "de", localize, format: (key,data) => localize(key).replace(/\{([^}]+)\}/g,(_,k)=>data[k]??k) },
        settings: { get: (_,key) => settings[key] }, actors: [], scenes: [], messages: { contents: [] } };
    function actor(id, own) {
        const a = { id, uuid: `Actor.${id}`, name: id, isOwner: own, img: 'icons/svg/mystery-man.svg',
            skills: Object.fromEntries(['acrobatics','athletics','stealth','perception','endurance'].map(id=>[id,{id,label:id,points:6,value:17}])),
            system: { preparedAction: { attack: null, spell: null }, healthBar:{value:24,max:30}, focusBar:{value:15,max:21} },
            derivedValues: { defense:{value:21},bodyresist:{value:17},mindresist:{value:20},speed:{value:8} },
            attacks: [{ id:'staff',name:'Kampfstab',isRanged:false,skill:{label:'Stangenwaffen',value:14},weaponSpeed:7,damage:'1W10+4',img:'' },{id:'bow',name:'Kurzbogen',isRanged:true,skill:{id:'longrange',label:'Schusswaffen',value:12},weaponSpeed:6,img:''}],
            spells: Array.from({length:18},(_,i)=>({id:'spell'+i,name:i?'Zauber '+i:'Flammenschild',img:'',enoughFocus:true,castDuration:6,skill:{label:'Feuermagie',value:15},costs:'K8V2'})),
            flags: {}, getFlag(ns,key){return this.flags[ns]?.[key]??null;}, async setFlag(ns,key,value){calls.flags.push([id,ns,key,value]);(this.flags[ns]??={})[key]=value;return this;},
            async update(changes){for(const [key,value] of Object.entries(changes)){const k=key.split('.');if(k[0]==='system')this.system.preparedAction[k[2]]=value;}},
            async addTicks(ticks){calls.ticks.push([id,ticks]);},
            testUserPermission:()=>gm||own, sheet:{render:()=>calls.sheets.push(id)}, rollSkill:()=>calls.rolls.push(id),
        };
        a.items = new Map([...a.attacks,...a.spells].map(item=>[item.id,{...item,sheet:{render:()=>calls.sheets.push(item.id)}}]));
        return a;
    }
    const ghost=actor('Geistervarg',false),own=actor('Peritus',true),merc=actor('Söldner',false),unplaced=actor('Bogen ohne Token',true);
    const scene={id:'scene',name:'Battle-Map',tokens:[]};
    function token(id,a){const t={id,uuid:`Scene.scene.Token.${id}`,name:a.name,actor:a,parent:scene,hidden:false,texture:{src:a.img},x:0,y:0,width:1,height:1};t.object={document:t,isVisible:true,control:()=>calls.controls.push(id)};return t;}
    const activeToken=token('active',ghost),ownToken=token('own',own),cloneToken=token('clone',own),targetToken=token('target',merc);
    scene.tokens=[activeToken,ownToken,cloneToken,targetToken];
    const cb=(id,t,user)=>({id,actor:t.actor,token:t,initiative:18,runtimeController:user,assignedUser:user});
    const combat={id:'combat',started:true,currentTick:18,scene,combatants:[cb('active',activeToken,gm?player:other),cb('own',ownToken,player),cb('clone',cloneToken,player)]};
    combat.combatant=combat.combatants[0];combat.turns=combat.combatants;
    game.combat=combat;game.actors=[ghost,own,merc,unplaced];game.scenes=[scene];player.character=own;
    globalThis.canvas={ready:true,scene,tokens:{get:id=>scene.tokens.find(t=>t.id===id)?.object},grid:{size:100,distance:2,units:'m',type:1}};
    globalThis.ui={notifications:{warn:m=>calls.warnings.push(m),info:()=>{},error:()=>{}}};
    const nativeTargets = new Map([[player.id,{target:activeToken,targets:[activeToken]}],[other.id,{target:targetToken,targets:[targetToken]}]]);
    Object.assign(services,{
        getHudContext, resolveHudFocusActionContext,setHudFocusTarget,captureHudFocusTargets,
        getAssignedUser:cb=>cb?.assignedUser??player,getRuntimeController:c=>c?.runtimeController??player,
        resolveToken:uuid=>scene.tokens.find(t=>t.uuid===uuid),tokenUuid:t=>t?.uuid,resolveCombatantToken:c=>c?.token,
        getControlledTokenDocument:()=>ownToken,isTokenPerceivableByUser:t=>gm||(!t.hidden&&t.object?.isVisible===true),
        getTargetSceneTokens:()=>scene.tokens.filter(t=>gm||(!t.hidden&&t.object.isVisible)),getTargetSelectionForUser:u=>nativeTargets.get(u?.id)??{target:null,targets:[]},
        canChooseTarget:()=>true,isCurrentUserTarget:()=>false,publishOwnTarget:(...v)=>calls.targets.push(v),
        scheduleRender:()=>{},clearActionMenuExpansionRequest:()=>{},getAttackSpeed:async a=>a.weaponSpeed,
        getAttackPreparation:()=>null,getPreparationApplicationStatus:()=>({state:'idle',record:null}),
        getPendingActiveDefense:()=>null,getPendingContinuousActionInterruption:()=>null,getPendingContinuousActionInterruptionsForCurrentUser:()=>[],
        getAbortableControlledTokenMovement:()=>null,getGmCheatRollPreset:()=>null,isPreparingSpell:()=>false,isRangedAttack,
        feedbackMarkup:()=>'',buildCombatEvents:context=>{calls.events.push(context);return `<section class="sf-events"><div class="sf-event-scroller">Kampf: ${context.actor?.name??'verborgen'} → ${context.target?.name??'–'}</div></section>`;},
    });
    return {calls,settings,player,other,scene,combat,ghost,own,merc,unplaced,activeToken,ownToken,cloneToken,targetToken,nativeTargets};
}
