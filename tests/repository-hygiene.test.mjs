import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowRoot = path.join(projectRoot, ".github", "workflows");

test("CI checks pull requests and pushes to main", () => {
    const ciWorkflow = fs.readFileSync(path.join(workflowRoot, "ci.yml"), "utf8");
    assert.match(
        ciWorkflow,
        /^on:\r?\n {2}pull_request:\r?\n {4}branches:\r?\n {6}- main\r?\n {2}push:\r?\n {4}branches:\r?\n {6}- main$/mu,
    );
    assert.match(ciWorkflow, /^permissions:\r?\n {2}contents: read$/mu);
    assert.match(ciWorkflow, /^ {10}node-version: 24$/mu);
    assert.match(ciWorkflow, /^ {8}run: npm run check$/mu);
});

test("release validation runs before packaging and uses the CI Node.js version", () => {
    const releaseWorkflow = fs.readFileSync(path.join(workflowRoot, "release.yml"), "utf8");
    const checkIndex = releaseWorkflow.indexOf("run: npm run check");
    const packageIndex = releaseWorkflow.indexOf("zip -r");
    const releaseIndex = releaseWorkflow.indexOf("gh release create");
    assert.ok(checkIndex >= 0);
    assert.ok(checkIndex < packageIndex);
    assert.ok(packageIndex < releaseIndex);
    assert.match(releaseWorkflow, /^ {10}node-version: 24$/mu);
});

test("local-only module artifacts remain ignored and absent from tracked content", () => {
    const ignoreRules = new Set(fs.readFileSync(path.join(projectRoot, ".gitignore"), "utf8").split(/\r?\n/u));
    assert.ok(ignoreRules.has("*.lnk"));
    assert.ok(ignoreRules.has("/Modul/splittermond-smoother-fight.zip"));

    const localArtifacts = [
        "Modul/modules - Verknüpfung.lnk",
        "Modul/splittermond-smoother-fight.zip",
    ];
    const tracked = spawnSync("git", ["-c", "core.quotePath=false", "ls-files", "-z", "--", ...localArtifacts], {
        cwd: projectRoot,
        encoding: "utf8",
    });
    assert.equal(tracked.status, 0, tracked.stderr);
    const trackedExistingArtifacts = tracked.stdout
        .split("\0")
        .filter(Boolean)
        .filter((file) => fs.existsSync(path.join(projectRoot, file)));
    assert.deepEqual(trackedExistingArtifacts, []);
});
