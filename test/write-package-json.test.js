import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    applyUpdatesToPackageJson,
    versionRange,
} from "../lib/out/write-package-json.js";

describe("versionRange", () => {
    it("returns a caret range by default", () => {
        expect(versionRange("1.2.3", false)).toBe("^1.2.3");
    });

    it("returns the exact version when saveExact is true", () => {
        expect(versionRange("1.2.3", true)).toBe("1.2.3");
    });
});

describe("applyUpdatesToPackageJson", () => {
    let dir;

    function writePkg(contents) {
        writeFileSync(join(dir, "package.json"), contents, "utf8");
    }

    function readPkg() {
        return readFileSync(join(dir, "package.json"), "utf8");
    }

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "npm-chck-test-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("updates a regular dependency to a caret range", () => {
        writePkg(
            JSON.stringify(
                { name: "a", dependencies: { lodash: "^4.17.20" } },
                null,
                4,
            ) + "\n",
        );

        const written = applyUpdatesToPackageJson(
            dir,
            [{ moduleName: "lodash", latest: "4.18.1", devDependency: false }],
            false,
        );

        expect(written).toEqual(["lodash@^4.18.1"]);
        const pkg = JSON.parse(readPkg());
        expect(pkg.dependencies.lodash).toBe("^4.18.1");
    });

    it("updates a devDependency in the devDependencies bucket", () => {
        writePkg(
            JSON.stringify(
                { name: "a", devDependencies: { semver: "^7.5.0" } },
                null,
                4,
            ) + "\n",
        );

        applyUpdatesToPackageJson(
            dir,
            [{ moduleName: "semver", latest: "7.8.5", devDependency: true }],
            false,
        );

        const pkg = JSON.parse(readPkg());
        expect(pkg.devDependencies.semver).toBe("^7.8.5");
        expect(pkg.dependencies).toBeUndefined();
    });

    it("pins exact versions when saveExact is true", () => {
        writePkg(
            JSON.stringify(
                { name: "a", dependencies: { lodash: "4.17.20" } },
                null,
                4,
            ) + "\n",
        );

        applyUpdatesToPackageJson(
            dir,
            [{ moduleName: "lodash", latest: "4.18.1", devDependency: false }],
            true,
        );

        const pkg = JSON.parse(readPkg());
        expect(pkg.dependencies.lodash).toBe("4.18.1");
    });

    it("preserves two-space indentation", () => {
        writePkg(
            JSON.stringify(
                { name: "a", dependencies: { lodash: "^4.17.20" } },
                null,
                2,
            ) + "\n",
        );

        applyUpdatesToPackageJson(
            dir,
            [{ moduleName: "lodash", latest: "4.18.1", devDependency: false }],
            false,
        );

        const raw = readPkg();
        expect(raw).toContain('\n  "name"');
        expect(raw.endsWith("\n")).toBe(true);
    });

    it("preserves tab indentation", () => {
        writePkg(
            '{\n\t"name": "a",\n\t"dependencies": {\n\t\t"lodash": "^4.17.20"\n\t}\n}\n',
        );

        applyUpdatesToPackageJson(
            dir,
            [{ moduleName: "lodash", latest: "4.18.1", devDependency: false }],
            false,
        );

        const raw = readPkg();
        expect(raw).toContain('\n\t"name"');
    });

    it("does not append a trailing newline if the original lacked one", () => {
        writePkg(
            JSON.stringify(
                { name: "a", dependencies: { lodash: "^4.17.20" } },
                null,
                4,
            ),
        );

        applyUpdatesToPackageJson(
            dir,
            [{ moduleName: "lodash", latest: "4.18.1", devDependency: false }],
            false,
        );

        const raw = readPkg();
        expect(raw.endsWith("}")).toBe(true);
        expect(raw.endsWith("}\n")).toBe(false);
    });

    it("creates the dependencies bucket if it is missing", () => {
        writePkg(JSON.stringify({ name: "a" }, null, 4) + "\n");

        applyUpdatesToPackageJson(
            dir,
            [{ moduleName: "lodash", latest: "4.18.1", devDependency: false }],
            false,
        );

        const pkg = JSON.parse(readPkg());
        expect(pkg.dependencies.lodash).toBe("^4.18.1");
    });

    it("updates the existing bucket when the package lives in the opposite one", () => {
        // Package is selected as a devDependency but already lives in
        // dependencies. We should update it in place rather than duplicating.
        writePkg(
            JSON.stringify(
                { name: "a", dependencies: { lodash: "^4.17.20" } },
                null,
                4,
            ) + "\n",
        );

        applyUpdatesToPackageJson(
            dir,
            [{ moduleName: "lodash", latest: "4.18.1", devDependency: true }],
            false,
        );

        const pkg = JSON.parse(readPkg());
        expect(pkg.dependencies.lodash).toBe("^4.18.1");
        expect(pkg.devDependencies?.lodash).toBeUndefined();
    });

    it("returns an empty array and writes nothing for no packages", () => {
        const original =
            JSON.stringify(
                { name: "a", dependencies: { lodash: "^4.17.20" } },
                null,
                4,
            ) + "\n";
        writePkg(original);

        const written = applyUpdatesToPackageJson(dir, [], false);

        expect(written).toEqual([]);
        expect(readPkg()).toBe(original);
    });

    it("applies multiple updates in one pass", () => {
        writePkg(
            JSON.stringify(
                {
                    name: "a",
                    dependencies: { lodash: "^4.17.20" },
                    devDependencies: { semver: "^7.5.0" },
                },
                null,
                4,
            ) + "\n",
        );

        const written = applyUpdatesToPackageJson(
            dir,
            [
                {
                    moduleName: "lodash",
                    latest: "4.18.1",
                    devDependency: false,
                },
                { moduleName: "semver", latest: "7.8.5", devDependency: true },
            ],
            false,
        );

        expect(written).toEqual(["lodash@^4.18.1", "semver@^7.8.5"]);
        const pkg = JSON.parse(readPkg());
        expect(pkg.dependencies.lodash).toBe("^4.18.1");
        expect(pkg.devDependencies.semver).toBe("^7.8.5");
    });
});
