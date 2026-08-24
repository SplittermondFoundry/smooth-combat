import {
    MODULE_ID,
} from "../core/constants.js";

import {
    t,
} from "./values.js";

export async function setRequiredDocumentFlag(document, key, value, namespace = MODULE_ID) {
    try {
        const updated = await document.setFlag(namespace, key, value);
        const stored = document.getFlag?.(namespace, key) ?? document.flags?.[namespace]?.[key];
        if (!updated && JSON.stringify(stored) !== JSON.stringify(value)) {
            throw new Error("The document update returned no result and the stored value does not match");
        }
        return updated || document;
    } catch (cause) {
        const error = new Error(`Could not persist required ${key} flag on ${document?.documentName ?? "document"} ${document?.id ?? "unknown"}`, {
            cause,
        });
        console.error(`${MODULE_ID} | ${error.message}`, cause);
        ui.notifications?.error?.(t("SMOOTHER_FIGHT.HUD.RequiredFlagFailed", { flag: key }));
        throw error;
    }
}
