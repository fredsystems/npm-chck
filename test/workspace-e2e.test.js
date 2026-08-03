import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "bin", "cli.js");

/**
 * These tests run the real CLI binary against a real npm workspace on disk and
 * hit the npm registry, so they are slower and require network access. They
 * exercise the actual "collect across all workspaces, then a single root
 * install" behaviour that fixes shared-dependency conflicts (e.g. biome).
 *
 * The fixture root deliberately carries a devDependency of its own. That is the
 * regression guard for the bug where workspace auto-detection only fired for a
 * "bare" root, so any monorepo whose root had a single tooling devDependency
 * fell back to single-package mode and silently reported the whole repo as up
 * to date.
 */
describe("workspace update end-to-end", () => {
    let root;

    function pkgPath(...parts) {
        return join(root, ...parts);
    }

    function writeJson(relPath, obj) {
        const target = pkgPath(relPath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, JSON.stringify(obj, null, 4) + "\n", "utf8");
    }

    function readJson(relPath) {
        return JSON.parse(readFileSync(pkgPath(relPath), "utf8"));
    }

    beforeAll(async () => {
        root = mkdtempSync(join(tmpdir(), "npm-chck-e2e-"));

        // The root has a dependency of its own, so it must be checked and
        // updated alongside the members rather than short-circuiting workspace
        // detection.
        writeJson("package.json", {
            name: "e2e-root",
            version: "1.0.0",
            private: true,
            workspaces: ["packages/*"],
            devDependencies: { "text-table": "0.2.0" },
        });

        // lodash is shared across BOTH members and intentionally pinned to an
        // old version so an update is detected. This is the scenario that used
        // to fail because installs ran one workspace at a time.
        //
        // Member `a` pins exactly and member `b` uses a caret range, so a
        // single run asserts that each member keeps its own pinning style.
        writeJson("packages/a/package.json", {
            name: "@e2e/a",
            version: "1.0.0",
            dependencies: { lodash: "4.17.20" },
        });
        writeJson("packages/b/package.json", {
            name: "@e2e/b",
            version: "1.0.0",
            // Depends on its sibling, which is satisfied by a local symlink and
            // must never be looked up in the registry.
            dependencies: { "@e2e/a": "*", lodash: "^4.17.20" },
        });

        await execa("npm", ["install"], { cwd: root });
    }, 180_000);

    afterAll(() => {
        if (root) {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("auto-detects workspace mode for a root that has its own dependencies", async () => {
        // No -w: detection has to happen on its own.
        const result = await execa(process.execPath, [cli, "-s"], {
            cwd: root,
            reject: false,
        });

        const output = result.stdout + "\n" + result.stderr;

        // Every package, root included, gets its own section.
        expect(output).toContain("Workspace: e2e-root (.)");
        expect(output).toContain("Workspace: @e2e/a (packages/a)");
        expect(output).toContain("Workspace: @e2e/b (packages/b)");

        // The outdated member dependency is reported, and the exit code
        // reflects that there is something to do.
        expect(output).toContain("lodash");
        expect(result.exitCode).toBe(1);
    }, 180_000);

    it("does not report sibling workspace packages as missing from the registry", async () => {
        const result = await execa(process.execPath, [cli, "-s"], {
            cwd: root,
            reject: false,
        });

        const output = result.stdout + "\n" + result.stderr;

        expect(output).not.toContain("NPM ERR!");
        expect(output).not.toContain("could not be found");

        // `@e2e/a` may only appear as a section header, never as a reported row.
        const reportedLines = output
            .split("\n")
            .filter(
                (line) =>
                    line.includes("@e2e/a") && !line.includes("Workspace:"),
            );
        expect(reportedLines).toEqual([]);
    }, 180_000);

    it("updates every workspace's package.json and installs once from the root", async () => {
        const result = await execa(process.execPath, [cli, "-ys"], {
            cwd: root,
            reject: false,
        });

        const output = result.stdout + "\n" + result.stderr;

        // The shared lodash dependency must be bumped in BOTH members, each
        // keeping the range style it started with.
        const a = readJson("packages/a/package.json");
        const b = readJson("packages/b/package.json");
        expect(a.dependencies.lodash).toBe("4.18.1");
        expect(b.dependencies.lodash).toBe("^4.18.1");

        // The sibling dependency is left untouched.
        expect(b.dependencies["@e2e/a"]).toBe("*");

        // The install must run exactly once, from the workspace root.
        const installLines = output
            .split("\n")
            .filter((line) => line.includes("$ npm install"));
        expect(installLines.length).toBe(1);
        expect(output).toContain("run from workspace root");

        // The hoisted install resolves to the bumped version.
        const installed = JSON.parse(
            readFileSync(
                pkgPath("node_modules", "lodash", "package.json"),
                "utf8",
            ),
        );
        expect(installed.version).toBe("4.18.1");
    }, 180_000);

    it("reports nothing to do on a second run", async () => {
        const result = await execa(process.execPath, [cli, "-ys"], {
            cwd: root,
            reject: false,
        });

        const output = result.stdout + "\n" + result.stderr;
        expect(output).toContain("No updates selected. Nothing to do.");
    }, 180_000);

    it("checks only the root package when --no-workspaces is passed", async () => {
        const result = await execa(
            process.execPath,
            [cli, "-s", "--no-workspaces"],
            {
                cwd: root,
                reject: false,
            },
        );

        const output = result.stdout + "\n" + result.stderr;
        expect(output).not.toContain("Workspace:");
    }, 180_000);
});
