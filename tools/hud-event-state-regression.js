import { services } from '../Modul/splittermond-smoother-fight/scripts/core/services.js';
import { buildCombatEvents } from '../Modul/splittermond-smoother-fight/scripts/features/combat-events/view.js';
import { runTurnMovementRegression } from './hud-turn-movement-regression.js';

// Exercise native <details> events and real card markup, not just the final
// render count: the reported GIF showed the whole HUD changing height.
export async function runEventStateRegression(fixture) {
    const { hud, combat, check, frame, turn, holdBuild } = fixture;
    const saved = { ...services };
    const groups = Array.from({ length: 3 }, (_, i) => ({
        kind: 'attack', defenses: [], damages: [], fumbles: [], interruptions: [],
        primary: {
            id: 'history-' + i, timestamp: i,
            speaker: { actor: 'history-actor', alias: i === 2 ? 'Taur-na-Fuin' : 'Söldner' },
            context: { combatId: combat.id, combatantId: 'history-combatant' },
            content: '<div class="splittermond check attack"><header class="chat-message-header"><h3>Albenbogen +2 (Relikt)</h3></header>'
                + '<div style="height:180px;padding:12px">Würfelergebnis <strong>19</strong> · Erfolgsgrade <strong>−2 EG</strong></div></div>',
        },
    }));
    let focus = null;
    Object.assign(services, {
        prepareCombatEventContext: context => ({ ...context, combatEventPresentation: { groups, focus } }),
        buildCombatEvents, getPendingActiveDefense: () => null,
        getMessageContext: message => message.context,
        defensePhaseForOffense: () => 'declined', defenseAwaitsResponse: () => false,
        resolveMessageTarget: () => null,
        isFumbleTableMessage: () => false, isDefenseMessage: () => false, isDamageMessage: () => false,
    });
    const group = id => hud.element.querySelector(`[data-event-id="${id}"]`);
    const card = id => group(id)?.querySelector('.sf-event-card');
    const clickSummary = node => node.querySelector(':scope > summary').click();
    const settle = async () => { await turn(); await frame(); await turn(); await frame(); };
    const snapshot = stage => ({ stage, group: Boolean(group('history-2')?.open), card: Boolean(card('history-2')?.open),
        height: Math.round(hud.element.querySelector('.sf-shell').getBoundingClientRect().height) });
    let watching = false, watcher = null;
    try {
        await hud.render(); await settle();
        if (!group('history-2').open) clickSummary(group('history-2'));
        await settle();
        const baseline = snapshot('before rebuild');
        check(baseline.group && baseline.card, 'GIF reproduction: foreign character history card is open');
        await hud.render();
        const samples = [snapshot('render resolved')];
        for (let i = 0; i < 6; i++) { await frame(); samples.push(snapshot('frame ' + i)); }
        const violations = samples.filter(s => !s.group || !s.card || s.height !== baseline.height);
        check(violations.length === 0, 'GIF reproduction: open attack card and HUD height remain stable through a full rebuild '
            + JSON.stringify({ baseline, violations }));

        let release;
        holdBuild(new Promise(resolve => { release = resolve; }));
        const pending = hud.render(); await turn();
        clickSummary(group('history-2'));
        await turn(); release(); await pending; await settle();
        check(!group('history-2').open, 'closing history during a slow rebuild is preserved');

        holdBuild(new Promise(resolve => { release = resolve; }));
        const pendingOpen = hud.render(); await turn();
        clickSummary(group('history-1'));
        await turn(); release(); await pendingOpen; await settle();
        check(group('history-1').open && card('history-1').open && !group('history-2').open,
            'opening another history card during a slow rebuild is preserved');
        clickSummary(group('history-2')); await settle();
        check(!group('history-1').open && group('history-2').open, 'summary activation keeps the accordion exclusive');

        focus = { groupId: 'history-0', messageId: 'history-0', step: 'offense' };
        await hud.render(); await settle();
        check(group('history-0').open && card('history-0').open && !group('history-2').open,
            'a genuine pending workflow still takes focus');
        focus = null;
        await hud.render();
        for (let i = 0; i < 4; i++) {
            await frame();
            check(!group('history-0').open && !card('history-0').open,
                'completed automatic focus remains closed after delayed toggle events ' + i);
        }

        clickSummary(group('history-2')); await settle();
        const collapsedFrames = [];
        let observedFrames = 0;
        watching = true;
        const observe = () => {
            if (!watching) return;
            observedFrames++;
            const current = snapshot('animation frame');
            if (!current.group || !current.card) collapsedFrames.push(current);
            watcher = requestAnimationFrame(observe);
        };
        watcher = requestAnimationFrame(observe);
        await runTurnMovementRegression(fixture);
        watching = false; cancelAnimationFrame(watcher);
        check(observedFrames > 0 && collapsedFrames.length === 0,
            'GIF sequence: no collapsed attack-card frames during booking, actor changes and automatic movement '
            + JSON.stringify({ observedFrames, collapsedFrames }));
    } finally {
        watching = false; if (watcher !== null) cancelAnimationFrame(watcher);
        for (const key of Object.keys(services)) if (!Object.hasOwn(saved, key)) delete services[key];
        Object.assign(services, saved);
        await hud.render();
    }
}
