const PREPARED_ACTION_KINDS = new Set(["attack", "spell"]);

export function preparedActionId(actor, kind) {
    if (!actor || !PREPARED_ACTION_KINDS.has(kind)) return null;

    const preparedAction = actor.system?.preparedAction;
    if (hasPreparedActionField(preparedAction, kind)) {
        return optionalId(preparedAction[kind]);
    }

    const controller = preparedActionController(actor, kind);
    if (controller && "preparedId" in Object(controller)) {
        return optionalId(controller.preparedId);
    }

    const legacyKey = legacyPreparedActionKey(kind);
    return optionalId(
        actor.getFlag?.("splittermond", legacyKey)
        ?? actor.flags?.splittermond?.[legacyKey]
    );
}

export async function setPreparedActionId(actor, kind, itemId) {
    if (!actor || !PREPARED_ACTION_KINDS.has(kind)) {
        throw new TypeError(`Unsupported prepared action kind: ${kind}`);
    }

    const value = optionalId(itemId);
    const preparedAction = actor.system?.preparedAction;
    const controller = preparedActionController(actor, kind);
    if (hasPreparedActionField(preparedAction, kind) || controller) {
        if (typeof actor.update !== "function") {
            throw new TypeError("Actor does not support prepared-action data-model updates");
        }
        await actor.update({ [`system.preparedAction.${kind}`]: value });
        return actor;
    }

    if (typeof actor.setFlag !== "function") {
        throw new TypeError("Actor does not support legacy prepared-action flags");
    }
    await actor.setFlag("splittermond", legacyPreparedActionKey(kind), value);
    return actor;
}

function hasPreparedActionField(preparedAction, kind) {
    return Boolean(preparedAction && typeof preparedAction === "object" && kind in preparedAction);
}

function preparedActionController(actor, kind) {
    return kind === "attack" ? actor.preparedAttacks : actor.preparedSpells;
}

function legacyPreparedActionKey(kind) {
    return kind === "attack" ? "preparedAttack" : "preparedSpell";
}

function optionalId(value) {
    const normalized = String(value ?? "").trim();
    return normalized || null;
}
