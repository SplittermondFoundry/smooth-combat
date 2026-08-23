import {
    findDefensiveFeatureValue,
} from "../../combat-rules.js";

export async function persistMissingDefensiveFeature(message, defensiveFeatureValue) {
    const value = Math.max(0, Number(defensiveFeatureValue) || 0);
    const check = message?.flags?.splittermond?.check ?? message?.getFlag?.("splittermond", "check");
    if (!check || value <= 0 || findDefensiveFeatureValue(check.itemData) >= value) return false;

    const itemData = check.itemData && typeof check.itemData === "object" ? check.itemData : {};
    const itemFeatures = itemData.itemFeatures && typeof itemData.itemFeatures === "object"
        ? itemData.itemFeatures
        : {};
    const existing = Array.isArray(itemFeatures.internalFeatureList)
        ? itemFeatures.internalFeatureList.filter((feature) =>
            String(feature?.name ?? "").toLocaleLowerCase("de") !== "defensiv")
        : [];
    await message.update({
        "flags.splittermond.check.itemData": {
            ...itemData,
            itemFeatures: {
                ...itemFeatures,
                internalFeatureList: [...existing, { name: "Defensiv", value }],
            },
        },
    });
    return true;
}
