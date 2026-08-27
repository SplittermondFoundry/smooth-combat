import {
    DEFAULT_MELEE_RANGE,
} from "../domain/combat/range.js";

import {
    getSetting,
} from "./values.js";

export function configuredMeleeRange() {
    const value = Number(getSetting("meleeRange", DEFAULT_MELEE_RANGE));
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_MELEE_RANGE;
}
