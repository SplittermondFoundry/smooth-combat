import assert from "node:assert/strict";
import test from "node:test";

import { services } from "../Modul/splittermond-smoother-fight/scripts/core/services.js";
import {
    shouldDisableContinuousActionInterruptionControl,
    synchronizeContinuousActionInterruptionControls,
} from "../Modul/splittermond-smoother-fight/scripts/features/hud/controller.js";

test("a cancelled HUD Determination roll is immediately available for another attempt", (t) => {
    const originalPermissionCheck = services.canCurrentUserRollContinuousActionInterruption;
    t.after(() => {
        services.canCurrentUserRollContinuousActionInterruption = originalPermissionCheck;
    });
    services.canCurrentUserRollContinuousActionInterruption = () => false;

    assert.equal(
        shouldDisableContinuousActionInterruptionControl({ status: "cancelled" }, { id: "interruption" }),
        false,
        "the authoritative cancellation result must win over a temporarily stale document check",
    );
    assert.equal(
        shouldDisableContinuousActionInterruptionControl({ status: "unknown" }, { id: "interruption" }),
        false,
    );
    assert.equal(
        shouldDisableContinuousActionInterruptionControl({ status: "succeeded" }, { id: "interruption" }),
        true,
    );
});

test("other HUD Determination outcomes still follow the live permission state", (t) => {
    const originalPermissionCheck = services.canCurrentUserRollContinuousActionInterruption;
    t.after(() => {
        services.canCurrentUserRollContinuousActionInterruption = originalPermissionCheck;
    });
    services.canCurrentUserRollContinuousActionInterruption = () => true;

    assert.equal(
        shouldDisableContinuousActionInterruptionControl(null, { id: "interruption" }),
        false,
    );
    assert.equal(
        shouldDisableContinuousActionInterruptionControl(null, null),
        false,
    );
});

test("cancelling Determination unlocks a replacement HUD control after a rerender", () => {
    const replacedControl = interruptionControl("request-1");
    const unrelatedControl = interruptionControl("request-2");
    const root = {
        querySelectorAll: () => [replacedControl, unrelatedControl],
    };

    assert.equal(synchronizeContinuousActionInterruptionControls(root, "request-1", true), 1);
    assert.equal(replacedControl.disabled, true);
    assert.equal(replacedControl.attributes.get("aria-disabled"), "true");

    assert.equal(synchronizeContinuousActionInterruptionControls(root, "request-1", false), 1);
    assert.equal(replacedControl.disabled, false);
    assert.equal(replacedControl.attributes.has("aria-disabled"), false);
    assert.equal(replacedControl.highlighted, true);
    assert.equal(unrelatedControl.disabled, false);
});

function interruptionControl(requestId) {
    const attributes = new Map();
    return {
        attributes,
        dataset: { requestId },
        disabled: false,
        highlighted: false,
        classList: {
            toggle(_className, active) {
                this.highlighted = active;
            },
        },
        setAttribute(name, value) {
            attributes.set(name, value);
        },
        removeAttribute(name) {
            attributes.delete(name);
        },
        get highlighted() {
            return this.classList.highlighted;
        },
    };
}
