import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MODULE_ROOT = path.join(WORKSPACE_ROOT, "Modul", "splittermond-smoother-fight");
const SCRIPTS_ROOT = path.join(MODULE_ROOT, "scripts");
const MANIFEST_PATH = path.join(MODULE_ROOT, "module.json");
const ENTRY_MAX_LINES = 200;
const MODULE_MAX_LINES = 800;

const FORBIDDEN_DOMAIN_GLOBALS = [
    "game",
    "canvas",
    "ui",
    "Hooks",
    "foundry",
    "CONFIG",
    "CONST",
    "Dialog",
    "ChatMessage",
    "AudioHelper",
    "renderTemplate",
    "fromUuid",
    "fromUuidSync",
    "globalThis",
    "window",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "NodeFilter",
    "DOMParser",
    "CustomEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "AudioContext",
];

const FORBIDDEN_DOMAIN_PATTERNS = [
    {
        name: "DOM document global",
        pattern: /(?<![\w$.])document\s*\.\s*(?:body|documentElement|createElement|createTreeWalker|querySelector|querySelectorAll)\b/u,
    },
];

async function collectFiles(directory, extension) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await collectFiles(absolute, extension));
        else if (entry.isFile() && entry.name.endsWith(extension)) files.push(absolute);
    }
    return files.sort((left, right) => left.localeCompare(right));
}

function relativeFile(file) {
    return path.relative(WORKSPACE_ROOT, file).replaceAll(path.sep, "/");
}

function featureName(file) {
    const relative = path.relative(SCRIPTS_ROOT, file).replaceAll(path.sep, "/");
    return relative.match(/^features\/([^/]+)\//u)?.[1] ?? null;
}

function lineCount(source) {
    return source.length === 0 ? 0 : source.split(/\r?\n/u).length;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function regexLiteralEnd(value, start) {
    let inCharacterClass = false;
    for (let index = start + 1; index < value.length; index += 1) {
        const char = value[index];
        if (char === "\\") {
            index += 1;
            continue;
        }
        if (char === "[") inCharacterClass = true;
        else if (char === "]") inCharacterClass = false;
        else if (char === "/" && !inCharacterClass) {
            while (/^[A-Za-z]$/u.test(value[index + 1] ?? "")) index += 1;
            return index + 1;
        } else if (char === "\n" || char === "\r") {
            return null;
        }
    }
    return null;
}

function mayStartRegex(maskedPrefix) {
    const prefix = maskedPrefix.trimEnd();
    if (!prefix) return true;
    if ("([{=,:;!?&|+-*%^~<>".includes(prefix.at(-1))) return true;
    return /(?:^|\W)(?:return|case|throw|yield|await|delete|void|typeof|instanceof|in|of)$/u.test(prefix);
}

/**
 * Replaces comments and literal text with spaces while retaining line breaks and
 * JavaScript inside template substitutions. The resulting text can be searched
 * for executable identifier references without matching prose or HTML strings.
 */
function maskedSource(value) {
    let result = "";
    let mode = "code";
    let quote = "";
    let returnMode = "code";
    const templateReturnModes = [];
    const templateDepths = [];

    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        const next = value[index + 1];

        if (mode === "line-comment") {
            result += char === "\n" ? "\n" : " ";
            if (char === "\n") mode = returnMode;
            continue;
        }

        if (mode === "block-comment") {
            result += char === "\n" ? "\n" : " ";
            if (char === "*" && next === "/") {
                result += " ";
                index += 1;
                mode = returnMode;
            }
            continue;
        }

        if (mode === "string") {
            result += char === "\n" ? "\n" : " ";
            if (char === "\\") {
                if (next !== undefined) {
                    result += next === "\n" ? "\n" : " ";
                    index += 1;
                }
            } else if (char === quote) {
                mode = returnMode;
            }
            continue;
        }

        if (mode === "template") {
            if (char === "\\") {
                result += " ";
                if (next !== undefined) {
                    result += next === "\n" ? "\n" : " ";
                    index += 1;
                }
                continue;
            }
            if (char === "`") {
                result += " ";
                mode = templateReturnModes.pop() ?? "code";
                continue;
            }
            if (char === "$" && next === "{") {
                result += "  ";
                index += 1;
                templateDepths.push(1);
                mode = "template-expression";
                continue;
            }
            result += char === "\n" ? "\n" : " ";
            continue;
        }

        if (mode === "template-expression") {
            const depthIndex = templateDepths.length - 1;
            if (char === "{") templateDepths[depthIndex] += 1;
            if (char === "}") {
                templateDepths[depthIndex] -= 1;
                if (templateDepths[depthIndex] === 0) {
                    templateDepths.pop();
                    result += " ";
                    mode = "template";
                    continue;
                }
            }
        }

        if (char === "/" && next === "/") {
            result += "  ";
            index += 1;
            returnMode = mode;
            mode = "line-comment";
        } else if (char === "/" && next === "*") {
            result += "  ";
            index += 1;
            returnMode = mode;
            mode = "block-comment";
        } else if (char === "/" && mayStartRegex(result)) {
            const end = regexLiteralEnd(value, index);
            if (end !== null) {
                for (let cursor = index; cursor < end; cursor += 1) {
                    result += value[cursor] === "\n" ? "\n" : " ";
                }
                index = end - 1;
            } else {
                result += char;
            }
        } else if (char === "\"" || char === "'") {
            result += " ";
            quote = char;
            returnMode = mode;
            mode = "string";
        } else if (char === "`") {
            result += " ";
            templateReturnModes.push(mode);
            mode = "template";
        } else {
            result += char;
        }
    }

    return result;
}

function statementEnd(masked, start) {
    const semicolon = masked.indexOf(";", start);
    assert.notEqual(semicolon, -1, `Import/export statement at offset ${start} must end with a semicolon`);
    return semicolon + 1;
}

function parseImports(source) {
    const masked = maskedSource(source);
    const imports = [];
    const starts = /^\s*import\s+(?!\s*[.(])/gmu;
    let match;
    while ((match = starts.exec(masked)) !== null) {
        const start = match.index;
        const end = statementEnd(masked, start);
        const statement = source.slice(start, end).trim();
        const fromMatch = statement.match(/^import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;$/u);
        const sideEffectMatch = statement.match(/^import\s+["']([^"']+)["']\s*;$/u);
        assert.ok(fromMatch || sideEffectMatch, `Unsupported import syntax: ${statement}`);
        imports.push({
            start,
            end,
            clause: fromMatch?.[1]?.trim() ?? "",
            specifier: fromMatch?.[2] ?? sideEffectMatch[1],
        });
        starts.lastIndex = end;
    }
    return imports;
}

function parseReexports(source) {
    const reexports = [];
    const pattern = /^\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']\s*;/gmu;
    let match;
    while ((match = pattern.exec(source)) !== null) reexports.push(match[1]);
    return reexports;
}

function namedImportBindings(clause) {
    const braces = clause.match(/\{([\s\S]*?)\}/u);
    if (!braces) return [];
    return braces[1].split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
        const alias = part.split(/\s+as\s+/u);
        return alias.at(-1).trim();
    });
}

function namespaceImportBinding(clause) {
    return clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/u)?.[1] ?? null;
}

function blankRanges(source, ranges) {
    const characters = Array.from(source);
    for (const { start, end } of ranges) {
        for (let index = start; index < end; index += 1) {
            if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
        }
    }
    return characters.join("");
}

function resolveLocalImport(importer, specifier) {
    if (!specifier.startsWith(".")) return null;
    const withoutQuery = specifier.split(/[?#]/u, 1)[0];
    return path.resolve(path.dirname(importer), withoutQuery);
}

function findCycle(graph) {
    const visiting = new Set();
    const visited = new Set();
    const stack = [];

    function visit(file) {
        if (visiting.has(file)) {
            const start = stack.indexOf(file);
            return [...stack.slice(start), file];
        }
        if (visited.has(file)) return null;

        visiting.add(file);
        stack.push(file);
        for (const dependency of graph.get(file) ?? []) {
            const cycle = visit(dependency);
            if (cycle) return cycle;
        }
        stack.pop();
        visiting.delete(file);
        visited.add(file);
        return null;
    }

    for (const file of graph.keys()) {
        const cycle = visit(file);
        if (cycle) return cycle;
    }
    return null;
}

function directExportNames(source) {
    const masked = maskedSource(source);
    const names = new Set();
    const declaration = /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gmu;
    let match;
    while ((match = declaration.exec(masked)) !== null) names.add(match[1]);

    const lists = /^\s*export\s*\{([\s\S]*?)\}(?:\s+from\s+["'][^"']+["'])?\s*;/gmu;
    while ((match = lists.exec(source)) !== null) {
        for (const part of match[1].split(",").map((entry) => entry.trim()).filter(Boolean)) {
            const alias = part.split(/\s+as\s+/u);
            names.add(alias.at(-1).trim());
        }
    }
    return names;
}

function configuredNamespaceBindings(entrySource) {
    const namespaces = new Map();
    for (const imported of parseImports(entrySource)) {
        const binding = namespaceImportBinding(imported.clause);
        if (binding) namespaces.set(binding, imported.specifier);
    }

    const calls = [...entrySource.matchAll(/\bconfigureServices\s*\(/gu)];
    assert.equal(calls.length, 1, "Composition root must call configureServices(...) exactly once");
    const call = entrySource.match(/\bconfigureServices\s*\(([\s\S]*?)\)\s*;/u);
    assert.ok(call, "Composition root must call configureServices(...) exactly once");
    const argumentsList = call[1].split(",").map((argument) => argument.trim()).filter(Boolean);
    return argumentsList.map((binding) => {
        assert.ok(namespaces.has(binding), `configureServices argument ${binding} must be a namespace import`);
        return namespaces.get(binding);
    });
}

const productionFiles = await collectFiles(SCRIPTS_ROOT, ".js");
const productionSet = new Set(productionFiles.map((file) => path.resolve(file)));
const sources = new Map(await Promise.all(productionFiles.map(async (file) => [file, await readFile(file, "utf8")])));
const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));

const graph = new Map();
for (const file of productionFiles) {
    const source = sources.get(file);
    const specifiers = [
        ...parseImports(source).map((imported) => imported.specifier),
        ...parseReexports(source),
    ];
    const dependencies = [];
    for (const specifier of specifiers) {
        const resolved = resolveLocalImport(file, specifier);
        if (!resolved) continue;
        assert.ok(
            resolved === SCRIPTS_ROOT || resolved.startsWith(`${SCRIPTS_ROOT}${path.sep}`),
            `${relativeFile(file)} imports outside scripts/: ${specifier}`
        );
        assert.ok(productionSet.has(resolved), `${relativeFile(file)} has an unresolved import: ${specifier}`);
        dependencies.push(resolved);
    }
    graph.set(file, dependencies);
}

test("all production JavaScript files have valid syntax", () => {
    for (const file of productionFiles) {
        const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
        assert.equal(
            result.status,
            0,
            `${relativeFile(file)} failed node --check:\n${result.stderr || result.stdout}`
        );
    }
});

test("all production modules are reachable from module.json and imports are acyclic", () => {
    assert.ok(Array.isArray(manifest.esmodules) && manifest.esmodules.length > 0, "module.json must declare an ES module entry");
    const entries = manifest.esmodules.map((entry) => path.resolve(MODULE_ROOT, entry));
    for (const entry of entries) assert.ok(productionSet.has(entry), `Missing module.json entry: ${relativeFile(entry)}`);

    const reachable = new Set();
    const pending = [...entries];
    while (pending.length) {
        const file = pending.pop();
        if (reachable.has(file)) continue;
        reachable.add(file);
        pending.push(...(graph.get(file) ?? []));
    }

    const unreachable = productionFiles.filter((file) => !reachable.has(file)).map(relativeFile);
    assert.deepEqual(unreachable, [], `Unreachable production modules:\n${unreachable.join("\n")}`);

    const cycle = findCycle(graph);
    assert.equal(cycle, null, cycle ? `Import cycle:\n${cycle.map(relativeFile).join(" -> ")}` : "");
});

test("feature internals and state remain inside their owning feature", () => {
    const violations = [];
    for (const [file, dependencies] of graph) {
        const owner = featureName(file);
        for (const dependency of dependencies) {
            const dependencyOwner = featureName(dependency);
            if (owner && dependencyOwner && owner !== dependencyOwner) {
                violations.push(`${relativeFile(file)} -> ${relativeFile(dependency)}`);
            }
            if (path.basename(dependency) === "state.js" && owner !== dependencyOwner) {
                violations.push(`foreign state: ${relativeFile(file)} -> ${relativeFile(dependency)}`);
            }
            const relativeOwner = path.relative(SCRIPTS_ROOT, file).replaceAll(path.sep, "/");
            if (relativeOwner.startsWith("core/") && dependencyOwner) {
                violations.push(`core-to-feature: ${relativeFile(file)} -> ${relativeFile(dependency)}`);
            }
        }
    }
    assert.deepEqual(violations, [], `Feature boundary violations:\n${violations.join("\n")}`);
});

test("the composition root and production modules stay small", async () => {
    for (const file of productionFiles) {
        const lines = lineCount(sources.get(file));
        assert.ok(lines <= MODULE_MAX_LINES, `${relativeFile(file)} has ${lines} lines; maximum is ${MODULE_MAX_LINES}`);
    }

    for (const entryPath of manifest.esmodules) {
        const entry = path.resolve(MODULE_ROOT, entryPath);
        const source = sources.get(entry);
        assert.ok(lineCount(source) <= ENTRY_MAX_LINES, `${relativeFile(entry)} must stay below ${ENTRY_MAX_LINES} lines`);
        const masked = maskedSource(source);
        assert.doesNotMatch(masked, /^\s*(?:export\s+)?(?:async\s+)?function\b/mu, `${relativeFile(entry)} must not declare functions`);
        assert.doesNotMatch(masked, /^\s*(?:export\s+)?class\b/mu, `${relativeFile(entry)} must not declare classes`);
    }
});

test("domain modules do not access Foundry or DOM globals", () => {
    const domainFiles = productionFiles.filter((file) => {
        const relative = path.relative(SCRIPTS_ROOT, file).replaceAll(path.sep, "/");
        return relative === "combat-rules.js" || relative.startsWith("domain/");
    });
    assert.ok(domainFiles.length > 0, "At least one domain module must be covered by the purity rule");

    for (const file of domainFiles) {
        const masked = maskedSource(sources.get(file));
        for (const globalName of FORBIDDEN_DOMAIN_GLOBALS) {
            const bareIdentifier = new RegExp(`(?<![\\w$.])${escapeRegExp(globalName)}\\b`, "u");
            assert.doesNotMatch(masked, bareIdentifier, `${relativeFile(file)} accesses forbidden global ${globalName}`);
        }
        for (const forbidden of FORBIDDEN_DOMAIN_PATTERNS) {
            assert.doesNotMatch(masked, forbidden.pattern, `${relativeFile(file)} accesses forbidden ${forbidden.name}`);
        }
    }
});

test("every services.X reference is provided by the configured service facade", () => {
    const entryPath = path.resolve(MODULE_ROOT, manifest.esmodules[0]);
    const entrySource = sources.get(entryPath);
    const configuredSpecifiers = configuredNamespaceBindings(entrySource);
    const providers = new Map();
    const configuredFeatures = new Set();

    for (const specifier of configuredSpecifiers) {
        const providerFile = resolveLocalImport(entryPath, specifier);
        assert.ok(providerFile && productionSet.has(providerFile), `Configured service module cannot be resolved: ${specifier}`);
        assert.equal(path.basename(providerFile), "api.js", `Only explicit feature api.js modules may be configured: ${specifier}`);
        const providerFeature = featureName(providerFile);
        assert.ok(providerFeature, `Configured service API must belong to a feature: ${specifier}`);
        assert.ok(!configuredFeatures.has(providerFeature), `Feature API configured more than once: ${providerFeature}`);
        configuredFeatures.add(providerFeature);
        assert.deepEqual(parseImports(sources.get(providerFile)), [], `${relativeFile(providerFile)} must remain a re-export-only API`);
        assert.doesNotMatch(
            maskedSource(sources.get(providerFile)),
            /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\b/mu,
            `${relativeFile(providerFile)} must not implement services`,
        );
        for (const exportName of directExportNames(sources.get(providerFile))) {
            const previous = providers.get(exportName);
            assert.equal(
                previous,
                undefined,
                `Duplicate configured service ${exportName}: ${relativeFile(previous ?? providerFile)} and ${relativeFile(providerFile)}`
            );
            providers.set(exportName, providerFile);
        }
    }

    for (const stateFile of productionFiles.filter((file) => path.basename(file) === "state.js")) {
        const exposedState = [...directExportNames(sources.get(stateFile))].filter((name) => providers.has(name));
        assert.deepEqual(exposedState, [], `${relativeFile(stateFile)} exposes mutable state through a feature API`);
    }

    const references = new Map();
    for (const file of productionFiles) {
        const source = sources.get(file);
        const masked = maskedSource(source);
        for (const match of source.matchAll(/\bservices(?:\?\.|\.(?!js\b))/gu)) {
            assert.match(
                masked.slice(match.index),
                /^services(?:\?\.|\.)/u,
                `${relativeFile(file)} contains a services access inside literal text or a comment`
            );
        }
        const dynamicAccess = /\bservices\s*\[/u;
        if (path.basename(file) !== "services.js") {
            assert.doesNotMatch(masked, dynamicAccess, `${relativeFile(file)} must use auditable services.name access`);
        }
        const pattern = /\bservices(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/gu;
        let match;
        while ((match = pattern.exec(masked)) !== null) {
            const locations = references.get(match[1]) ?? [];
            locations.push(relativeFile(file));
            references.set(match[1], locations);
        }
    }

    const missing = [...references.keys()].filter((name) => !providers.has(name)).sort();
    assert.deepEqual(
        missing,
        [],
        `Service references without a configured export:\n${missing.map((name) => `${name}: ${references.get(name).join(", ")}`).join("\n")}`
    );

    const unusedProviders = [...providers.keys()].filter((name) => !references.has(name)).sort();
    assert.deepEqual(
        unusedProviders,
        [],
        `Configured exports without a services.X consumer:\n${unusedProviders.map((name) => `${name}: ${relativeFile(providers.get(name))}`).join("\n")}`
    );

    const internalOnlyProviders = [...providers.keys()].filter((name) => {
        const providerFeature = featureName(providers.get(name));
        return (references.get(name) ?? []).every((consumer) => {
            const consumerPath = path.resolve(WORKSPACE_ROOT, consumer);
            return featureName(consumerPath) === providerFeature;
        });
    }).sort();
    assert.deepEqual(
        internalOnlyProviders,
        [],
        `Feature-internal exports must use direct imports instead of the service facade:\n${internalOnlyProviders.map((name) => `${name}: ${relativeFile(providers.get(name))}`).join("\n")}`
    );
});

test("named imports are referenced outside their import declarations", () => {
    const unused = [];
    for (const file of productionFiles) {
        const source = sources.get(file);
        const imports = parseImports(source);
        const searchable = blankRanges(maskedSource(source), imports);
        for (const imported of imports) {
            for (const binding of namedImportBindings(imported.clause)) {
                const reference = new RegExp(`\\b${escapeRegExp(binding)}\\b`, "u");
                if (!reference.test(searchable)) unused.push(`${relativeFile(file)}: ${binding} from ${imported.specifier}`);
            }
        }
    }
    assert.deepEqual(unused, [], `Unused named imports:\n${unused.join("\n")}`);
});
