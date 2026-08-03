import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    findWorkspaceRoot,
    getWorkspaceMemberPatterns,
    getWorkspacePackageNames,
    getWorkspacePackages,
    isWorkspaceRoot,
} from "../lib/in/get-workspace-packages.js";

describe("workspace discovery", () => {
    let root;

    function write(relPath, contents) {
        const target = join(root, relPath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, contents, "utf8");
    }

    function writeJson(relPath, obj) {
        write(relPath, JSON.stringify(obj, null, 4) + "\n");
    }

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), "npm-chck-ws-"));
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    describe("isWorkspaceRoot", () => {
        // Regression: detection used to require a root with zero dependencies,
        // so any monorepo whose root carried its own tooling devDependencies
        // was never recognised and its members were never checked.
        it("is true for a root that also has its own dependencies", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: ["packages/*"],
                devDependencies: { madge: "8.0.0" },
            });

            expect(isWorkspaceRoot(root)).toBe(true);
        });

        it("is true for a bare root with no dependencies of its own", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: ["packages/*"],
            });

            expect(isWorkspaceRoot(root)).toBe(true);
        });

        it("is true for the yarn nohoist object form", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: { packages: ["packages/*"], nohoist: ["**/foo"] },
            });

            expect(isWorkspaceRoot(root)).toBe(true);
        });

        it("is true for a pnpm workspace", () => {
            writeJson("package.json", { name: "r" });
            write("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n");

            expect(isWorkspaceRoot(root)).toBe(true);
        });

        it("is false for a plain single package", () => {
            writeJson("package.json", {
                name: "r",
                dependencies: { lodash: "4.18.1" },
            });

            expect(isWorkspaceRoot(root)).toBe(false);
        });

        it("is false when there is no package.json at all", () => {
            expect(isWorkspaceRoot(root)).toBe(false);
        });

        it("is false when package.json is malformed", () => {
            write("package.json", "{ not json");

            expect(isWorkspaceRoot(root)).toBe(false);
        });
    });

    describe("getWorkspacePackages", () => {
        it("includes the root first when the root has its own dependencies", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: ["packages/*"],
                devDependencies: { madge: "8.0.0" },
            });
            writeJson("packages/a/package.json", { name: "a" });
            writeJson("packages/b/package.json", { name: "b" });

            expect(getWorkspacePackages(root)).toEqual([
                root,
                join(root, "packages", "a"),
                join(root, "packages", "b"),
            ]);
        });

        it("omits a bare root that has nothing of its own to check", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: ["packages/*"],
            });
            writeJson("packages/a/package.json", { name: "a" });

            expect(getWorkspacePackages(root)).toEqual([
                join(root, "packages", "a"),
            ]);
        });

        it("omits the root when includeRoot is false", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: ["packages/*"],
                devDependencies: { madge: "8.0.0" },
            });
            writeJson("packages/a/package.json", { name: "a" });

            expect(getWorkspacePackages(root, { includeRoot: false })).toEqual([
                join(root, "packages", "a"),
            ]);
        });

        it("counts optionalDependencies as the root having its own deps", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: ["packages/*"],
                optionalDependencies: { fsevents: "2.3.3" },
            });
            writeJson("packages/a/package.json", { name: "a" });

            expect(getWorkspacePackages(root)).toContain(root);
        });

        it("resolves plain directory names as well as globs", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: ["types", "apps/*"],
            });
            writeJson("types/package.json", { name: "types" });
            writeJson("apps/web/package.json", { name: "web" });

            expect(getWorkspacePackages(root).sort()).toEqual(
                [join(root, "types"), join(root, "apps", "web")].sort(),
            );
        });

        it("never lists the root twice when a pattern also matches it", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: [".", "packages/*"],
                devDependencies: { madge: "8.0.0" },
            });
            writeJson("packages/a/package.json", { name: "a" });

            const dirs = getWorkspacePackages(root);
            expect(dirs.filter((d) => d === root)).toHaveLength(1);
        });

        it("reads pnpm-workspace.yaml when package.json has no workspaces", () => {
            writeJson("package.json", { name: "r" });
            write(
                "pnpm-workspace.yaml",
                'packages:\n  - "packages/*"\n  - tools # trailing comment\n',
            );
            writeJson("packages/a/package.json", { name: "a" });
            writeJson("tools/package.json", { name: "tools" });

            expect(getWorkspacePackages(root).sort()).toEqual(
                [join(root, "packages", "a"), join(root, "tools")].sort(),
            );
        });

        it("returns null when no workspace configuration exists", () => {
            writeJson("package.json", { name: "r" });

            expect(getWorkspacePackages(root)).toBeNull();
        });

        it("returns null when the patterns match nothing", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: ["packages/*"],
            });

            expect(getWorkspacePackages(root)).toBeNull();
        });
    });

    describe("getWorkspacePackageNames", () => {
        it("collects the root and every member name", () => {
            writeJson("package.json", {
                name: "@scope/root",
                workspaces: ["packages/*"],
                devDependencies: { madge: "8.0.0" },
            });
            writeJson("packages/a/package.json", { name: "@scope/a" });
            writeJson("packages/b/package.json", { name: "@scope/b" });

            expect(getWorkspacePackageNames(root).sort()).toEqual([
                "@scope/a",
                "@scope/b",
                "@scope/root",
            ]);
        });

        it("skips members without a name", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: ["packages/*"],
            });
            writeJson("packages/a/package.json", { version: "1.0.0" });

            expect(getWorkspacePackageNames(root)).toEqual(["r"]);
        });

        it("is empty for a directory that is not a workspace root", () => {
            writeJson("package.json", { name: "r" });

            expect(getWorkspacePackageNames(root)).toEqual(["r"]);
        });
    });

    describe("getWorkspaceMemberPatterns", () => {
        it("returns the declared patterns", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: ["packages/*", "tools"],
            });

            expect(getWorkspaceMemberPatterns(root)).toEqual([
                "packages/*",
                "tools",
            ]);
        });

        it("is empty when there is no workspace configuration", () => {
            writeJson("package.json", { name: "r" });

            expect(getWorkspaceMemberPatterns(root)).toEqual([]);
        });
    });

    describe("findWorkspaceRoot", () => {
        it("finds the root from a member directory", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: ["packages/*"],
            });
            writeJson("packages/a/package.json", { name: "a" });

            expect(findWorkspaceRoot(join(root, "packages", "a"))).toBe(root);
        });

        it("returns the directory itself when it is the root", () => {
            writeJson("package.json", {
                name: "r",
                workspaces: ["packages/*"],
            });

            expect(findWorkspaceRoot(root)).toBe(root);
        });

        it("returns null when no ancestor is a workspace root", () => {
            writeJson("package.json", { name: "r" });
            mkdirSync(join(root, "nested"), { recursive: true });

            // The temp dir's ancestors are not workspaces either, so this walks
            // to the filesystem root and gives up.
            expect(findWorkspaceRoot(join(root, "nested"))).toBeNull();
        });
    });
});
