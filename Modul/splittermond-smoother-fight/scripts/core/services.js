/**
 * Cross-feature API populated once by the composition root.
 *
 * Feature modules depend on this stable facade instead of importing one another,
 * which keeps the module graph acyclic while preserving late-bound Foundry hooks.
 */
export const services = {};

export function configureServices(...featureModules) {
    for (const featureModule of featureModules) {
        for (const [name, implementation] of Object.entries(featureModule)) {
            if (name === "default" || name === "configureServices" || name === "services") continue;
            if (Object.hasOwn(services, name) && services[name] !== implementation) {
                throw new Error(`Duplicate service registration: ${name}`);
            }
            services[name] = implementation;
        }
    }
    Object.freeze(services);
}
