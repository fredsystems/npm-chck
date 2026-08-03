import { describe, expect, it, vi } from "vitest";

// The registry is mocked so this stays a fast unit test and so we can assert
// that lookups are skipped entirely rather than merely ignored afterwards.
const getLatestMock = vi.fn();
vi.mock("../lib/in/get-latest-from-registry.js", () => ({
    default: (...args) => getLatestMock(...args),
}));

const createPackageSummary = (
    await import("../lib/in/create-package-summary.js")
).default;

/**
 * Build a minimal currentState stub backed by a plain object.
 */
function makeState(overrides = {}) {
    const values = {
        cwd: "/tmp/does-not-exist",
        cwdPackageJson: {
            dependencies: {},
            devDependencies: {},
        },
        global: false,
        globalPackages: {},
        ignore: [],
        unusedDependencies: [],
        missingFromPackageJson: {},
        workspacePackageNames: [],
        ...overrides,
    };
    return { get: (key) => values[key] };
}

describe("createPackageSummary", () => {
    it("skips sibling packages from the same workspace", () => {
        // Regression: an internal package such as `"@acarshub/types": "*"` is
        // satisfied by a symlink to a sibling directory. Looking it up produced
        // a bogus 'Registry error Package could not be found' on every run.
        const state = makeState({
            cwdPackageJson: {
                dependencies: { "@scope/types": "*" },
                devDependencies: {},
            },
            workspacePackageNames: ["@scope/root", "@scope/types"],
        });

        expect(createPackageSummary("@scope/types", state)).toBe(false);
        expect(getLatestMock).not.toHaveBeenCalled();
    });

    it("still checks third-party packages in a workspace", () => {
        getLatestMock.mockResolvedValue({ latest: "4.18.1", versions: [] });

        const state = makeState({
            cwdPackageJson: {
                dependencies: { lodash: "4.17.20" },
                devDependencies: {},
            },
            workspacePackageNames: ["@scope/root", "@scope/types"],
        });

        expect(createPackageSummary("lodash", state)).not.toBe(false);
        expect(getLatestMock).toHaveBeenCalledWith("lodash");
    });

    it("skips dependencies whose version is not a valid semver range", () => {
        const state = makeState({
            cwdPackageJson: {
                dependencies: { thing: "github:me/thing#main" },
                devDependencies: {},
            },
        });

        expect(createPackageSummary("thing", state)).toBe(false);
    });
});
