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

        writeJson("package.json", {
            name: "e2e-root",
            version: "1.0.0",
            private: true,
            workspaces: ["packages/*"],
        });

        // lodash is shared across BOTH members and intentionally pinned to an
        // old exact version so an update is detected. This is the scenario
        // that used to fail because installs ran one workspace at a time.
        writeJson("packages/a/package.json", {
            name: "@e2e/a",
            version: "1.0.0",
            dependencies: { lodash: "4.17.20" },
        });
        writeJson("packages/b/package.json", {
            name: "@e2e/b",
            version: "1.0.0",
            dependencies: { lodash: "4.17.20" },
        });

        await execa("npm", ["install"], { cwd: root });
    }, 180_000);

    afterAll(() => {
        if (root) {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("updates every workspace's package.json and installs once from the root", async () => {
        const result = await execa(process.execPath, [cli, "-wys"], {
            cwd: root,
            reject: false,
        });

        const output = result.stdout + "\n" + result.stderr;

        // The shared lodash dependency must be bumped in BOTH members.
        const a = readJson("packages/a/package.json");
        const b = readJson("packages/b/package.json");
        expect(a.dependencies.lodash).toBe("^4.18.1");
        expect(b.dependencies.lodash).toBe("^4.18.1");

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
        const result = await execa(process.execPath, [cli, "-wys"], {
            cwd: root,
            reject: false,
        });

        const output = result.stdout + "\n" + result.stderr;
        expect(output).toContain("No updates selected. Nothing to do.");
    }, 180_000);
});
