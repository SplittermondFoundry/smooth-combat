import { getApplicableCombat } from "../../core/combat-compatibility.js";
import { services } from "../../core/services.js";
import { escapeHtml, t } from "../../shared/values.js";
import { abortMovementPlan, getMovementAbortState } from "./movement.js";
import { combatActionState } from "./state.js";

/** Reconcile document changes once per frame, regardless of the number of hooks. */
export function scheduleMovementTokenControls() {
    if (combatActionState.movementControlFrame !== null) return;
    combatActionState.movementControlFrame = requestAnimationFrame(() => {
        combatActionState.movementControlFrame = null;
        syncMovementTokenControls();
    });
}

/** Client-local PIXI children inherit the token's animation and camera transform. */
export function syncMovementTokenControls() {
    cancelScheduledSync();
    const canvas = globalThis.canvas;
    const combat = getApplicableCombat();
    if (!combat || !canvas?.stage || canvas.ready === false || !globalThis.PIXI?.Graphics) {
        clearMovementTokenControls();
        return;
    }
    const retained = new Set();
    for (const object of canvas.tokens?.placeables ?? []) {
        if (object.destroyed || !object.addChild) continue;
        const token = object.document;
        const reference = token.uuid;
        let control = combatActionState.movementControls.get(reference);
        const state = getMovementAbortState(token, combat, { includeStop: Boolean(control?.hovered) });
        if (!state?.canManage) continue;
        retained.add(reference);
        if (control && (control.id !== state.id || control.object !== object || control.button.destroyed)) {
            removeControl(reference);
            control = null;
        }
        if (!control) {
            control = createControl(object, state.id);
            combatActionState.movementControls.set(reference, control);
        }
        layoutControl(control);
        updatePreview(control, state);
    }
    for (const reference of combatActionState.movementControls.keys()) {
        if (!retained.has(reference)) removeControl(reference);
    }
}

/** refreshToken also fires during animation: no scene scans or rule calculations. */
export function refreshMovementTokenControl(object) {
    const control = combatActionState.movementControls.get(object?.document?.uuid);
    if (!control) return;
    if (object.destroyed || control.object !== object || control.button.destroyed) {
        removeControl(control.token.uuid);
        scheduleMovementTokenControls();
        return;
    }
    layoutControl(control);
}

/** Translation is inherited automatically; only a changed zoom needs work. */
export function refreshMovementTokenControlScale() {
    const scale = canvasScale();
    if (combatActionState.movementControlScale === scale) return;
    combatActionState.movementControlScale = scale;
    for (const control of combatActionState.movementControls.values()) layoutControl(control);
}

export function clearMovementTokenControls() {
    cancelScheduledSync();
    for (const reference of combatActionState.movementControls.keys()) removeControl(reference);
    combatActionState.movementControlScale = null;
}

function cancelScheduledSync() {
    if (combatActionState.movementControlFrame === null) return;
    cancelAnimationFrame(combatActionState.movementControlFrame);
    combatActionState.movementControlFrame = null;
}

function canvasScale() {
    return Number(globalThis.canvas?.stage?.scale?.x) || 1;
}

function tokenIsVisible(token) {
    if (globalThis.game?.user?.isGM) return true;
    return !token.hidden && services.isTokenPerceivableByUser?.(token, globalThis.game?.user) === true;
}

function createControl(object, id) {
    const token = object.document;
    const colors = controlColors();
    const button = new PIXI.Graphics();
    button.name = button.label = "sf-movement-token-stop";
    button.lineStyle(1.5, colors.outline, 1).beginFill(colors.fill, 1).drawCircle(0, 0, 13).endFill();
    drawMovementAbortIcon(button, colors);
    button.hitArea = new PIXI.Rectangle(-13, -13, 26, 26);
    button.eventMode = "static";
    button.cursor = "pointer";
    button.zIndex = 1001;
    button.accessible = true;
    button.accessibleType = "button";
    button.accessiblePointerEvents = "none";
    const control = { button, colors, id, object, token, hovered: false, busy: false, preview: null };
    const showPreview = () => {
        if (control.disposed || control.hovered) return;
        control.hovered = true;
        const state = getMovementAbortState(token, getApplicableCombat());
        if (!state?.canManage || state.id !== id || !tokenIsVisible(token)) {
            removeControl(token.uuid);
            return;
        }
        updatePreview(control, state);
    };
    const hidePreview = () => {
        control.hovered = false;
        clearPreview(control);
    };
    button.on("pointerenter", showPreview);
    button.on("pointerleave", hidePreview);
    // PIXI's accessibility manager translates keyboard focus into mouseover/out.
    button.on("mouseover", showPreview);
    button.on("mouseout", hidePreview);
    for (const event of ["pointerdown", "pointerup", "rightdown", "rightup"]) {
        button.on(event, (event) => event.stopPropagation());
    }
    button.on("pointertap", (event) => onClick(control, event));
    object.addChild(button);
    return control;
}

function drawMovementAbortIcon(button, colors) {
    // Draw once in token-local coordinates; keep the walking figure readable at 26 px.
    button.lineStyle(0).beginFill(colors.text, 1).drawCircle(2, -7, 2.2).endFill();
    button.lineStyle({ width: 2.4, color: colors.text, cap: "round", join: "round" });
    button.moveTo(0, -3).lineTo(-2, 2).lineTo(1, 5).lineTo(1, 9);
    button.moveTo(-2, 2).lineTo(-5, 7).lineTo(-8, 9);
    button.moveTo(-6, 1).lineTo(-4, -2).lineTo(0, -3).lineTo(4, 0).lineTo(7, 0);
    // A background-colored gap separates the strike-through from the white limbs.
    button.lineStyle({ width: 4.5, color: colors.fill, cap: "round" }).moveTo(-8, -8).lineTo(8, 8);
    button.lineStyle({ width: 2.2, color: colors.outline, cap: "round" }).moveTo(-8, -8).lineTo(8, 8);
}

function controlColors() {
    const style = globalThis.document?.documentElement && globalThis.getComputedStyle?.(document.documentElement);
    const color = (name, fallback) => {
        const value = style?.getPropertyValue(name)?.trim();
        return value && PIXI.Color ? new PIXI.Color(value).toNumber() : fallback;
    };
    return {
        outline: color("--sf-gold-bright", 0xf2ce87), fill: color("--sf-danger", 0xc65d55),
        text: color("--sf-text", 0xeef4ef), background: color("--sf-bg", 0x050f12),
    };
}

async function onClick(control, event) {
    event.stopPropagation();
    if (event.button > 0 || control.busy || control.disposed) return;
    const { token, id, button } = control;
    const combat = getApplicableCombat();
    const state = getMovementAbortState(token, combat);
    if (!state?.canManage || state.id !== id || !tokenIsVisible(token)) {
        syncMovementTokenControls();
        return;
    }
    control.busy = true;
    button.alpha = 0.5;
    clearPreview(control);
    try {
        if (await abortMovementPlan(token, combat, id)) {
            // A document hook may already have installed the next action's control.
            if (combatActionState.movementControls.get(token.uuid) === control) removeControl(token.uuid);
            await reportAbort(token, state);
        } else {
            globalThis.ui?.notifications?.warn?.(t("SMOOTHER_FIGHT.HUD.MovementAbortFailed"));
        }
    } catch (error) {
        console.error("Could not abort token movement", error);
        globalThis.ui?.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.MovementAbortFailed"));
    } finally {
        control.busy = false;
        if (!button.destroyed) button.alpha = 1;
        if (!control.disposed) syncMovementTokenControls();
    }
}

function layoutControl(control) {
    if (control.button.destroyed) return;
    const scale = canvasScale();
    const width = Number(control.object.w) || 100;
    const height = Number(control.object.h) || 100;
    const buttonScale = Math.min(1 / scale, width / 40, height / 40);
    // Keep the button inside Foundry's token hit area so it receives pointer events.
    const y = 14 * buttonScale;
    const cornerX = width - 14 * buttonScale;
    const x = control.object.hitArea?.contains?.(cornerX, y) === false ? width / 2 : cornerX;
    control.button.position.set(x, y);
    control.button.scale.set(buttonScale);
    control.button.visible = tokenIsVisible(control.token);
    if (!control.button.visible) clearPreview(control);
    control.preview?.marker?.scale.set(1 / scale);
    layoutTooltip(control);
}

function updatePreview(control, state) {
    const label = t("SMOOTHER_FIGHT.HUD.MovementAbortTooltip", {
        token: control.token.name ?? control.token.actor?.name ?? "", tick: state.endTick,
    });
    control.button.accessibleTitle = label;
    if (!control.hovered || control.busy) return;
    const text = state.hasRoute ? label : `${label}\n${t("SMOOTHER_FIGHT.HUD.MovementAbortManualPosition")}`;
    if (control.preview?.text !== text) {
        clearPreview(control);
        const tooltip = new PIXI.Container();
        tooltip.eventMode = "none";
        const caption = new PIXI.Text(text, {
            fontFamily: "Signika", fontSize: 14, fill: control.colors.text, wordWrap: true, wordWrapWidth: 280,
        });
        const background = new PIXI.Graphics();
        background.beginFill(control.colors.background, 0.96).drawRoundedRect(0, 0, caption.width + 16, caption.height + 12, 5).endFill();
        caption.position.set(8, 6);
        tooltip.addChild(background, caption);
        control.button.addChild(tooltip);
        control.preview = { tooltip, text, width: caption.width + 16, height: caption.height + 12, marker: null };
    }
    layoutTooltip(control);
    if (!state.stop || !globalThis.canvas?.interface) return;
    let marker = control.preview.marker;
    if (!marker) {
        marker = new PIXI.Graphics();
        marker.name = marker.label = "sf-movement-stop-preview";
        marker.eventMode = "none";
        marker.zIndex = 1002;
        marker.lineStyle(3, control.colors.outline, 1).beginFill(control.colors.fill, 0.2).drawCircle(0, 0, 17).endFill();
        canvas.interface.addChild(marker);
        control.preview.marker = marker;
    }
    marker.position.set(Number(state.stop.x) + control.object.w / 2, Number(state.stop.y) + control.object.h / 2);
    marker.scale.set(1 / canvasScale());
}

export function refreshMovementTokenControlVisibility() {
    for (const control of combatActionState.movementControls.values()) {
        control.button.visible = tokenIsVisible(control.token);
        if (!control.button.visible) clearPreview(control);
    }
}

function layoutTooltip(control) {
    if (!control.preview) return;
    const { tooltip, width, height } = control.preview;
    const point = control.button.toGlobal({ x: 0, y: 0 });
    const screenHeight = globalThis.canvas?.app?.renderer?.screen?.height ?? Infinity;
    tooltip.position.set(point.x < width ? -13 : 13 - width, point.y + height + 20 > screenHeight ? -height - 20 : 20);
}

function clearPreview(control) {
    destroyDisplayObject(control.preview?.tooltip);
    destroyDisplayObject(control.preview?.marker);
    control.preview = null;
}

function destroyDisplayObject(object) {
    if (!object || object.destroyed) return;
    object.parent?.removeChild(object);
    object.destroy({ children: true });
}

function removeControl(reference) {
    const control = combatActionState.movementControls.get(reference);
    if (!control) return;
    control.disposed = true;
    combatActionState.movementControls.delete(reference);
    // PIXI forwards DOM focusout through the display tree. Blur while the button
    // is still connected; otherwise its accessibility manager cannot find a path.
    const focused = globalThis.document?.activeElement;
    if (focused?.displayObject === control.button && !control.button.destroyed) focused.blur();
    clearPreview(control);
    destroyDisplayObject(control.button);
}

async function reportAbort(token, state) {
    const text = t("SMOOTHER_FIGHT.HUD.MovementAbortDone", {
        token: token.name ?? token.actor?.name ?? "", tick: state.tick, endTick: state.endTick,
    });
    globalThis.ui?.notifications?.info?.(state.hasRoute ? text
        : `${text} ${t("SMOOTHER_FIGHT.HUD.MovementAbortManualPosition")}`);
    const recipients = new Set([globalThis.game?.user?.id]);
    const controller = services.getRuntimeController?.(token);
    if (!token.hidden || controller?.isGM) recipients.add(controller?.id);
    const users = globalThis.game?.users;
    for (const user of users?.values?.() ?? users ?? []) if (user.isGM) recipients.add(user.id);
    try {
        await globalThis.ChatMessage?.create?.({
            content: `<p>${escapeHtml(text)}</p>`, whisper: [...recipients].filter(Boolean),
        });
    } catch (error) {
        console.error("Could not create the movement abort message", error);
    }
}
