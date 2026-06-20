import { afterEach, describe, expect, it, vi } from "vitest";

// inquirer is mocked so we can drive the prompt deterministically without a TTY.
const promptMock = vi.fn();
vi.mock("inquirer", () => ({
    default: {
        prompt: (...args) => promptMock(...args),
        Separator: class {
            constructor(line) {
                this.line = line;
                this.type = "separator";
            }
        },
    },
}));

const { selectPackagesToUpdate, SKIP_WORKSPACE, ABORT_WORKSPACES, CANCEL } =
    await import("../lib/out/interactive-update.js");

/**
 * Build a minimal currentState stub backed by a plain object.
 */
function makeState(packages, overrides = {}) {
    const values = {
        packages,
        debug: false,
        installer: "npm",
        saveExact: false,
        global: false,
        ...overrides,
    };
    return {
        get: (key) => values[key],
    };
}

const lodashPatch = {
    moduleName: "lodash",
    latest: "4.18.1",
    installed: "4.17.20",
    bump: "patch",
    mismatch: false,
    notInstalled: false,
    devDependency: false,
};

const semverMinor = {
    moduleName: "semver",
    latest: "7.8.5",
    installed: "7.5.0",
    bump: "minor",
    mismatch: false,
    notInstalled: false,
    devDependency: true,
};

afterEach(() => {
    promptMock.mockReset();
});

describe("selectPackagesToUpdate", () => {
    it("returns action 'none' when there is nothing to update", async () => {
        const state = makeState([
            {
                moduleName: "lodash",
                latest: "4.18.1",
                bump: null,
                mismatch: false,
                notInstalled: false,
            },
        ]);

        const result = await selectPackagesToUpdate(state);

        expect(result).toEqual({ action: "none", packages: [] });
        expect(promptMock).not.toHaveBeenCalled();
    });

    it("returns the selected packages with action 'update'", async () => {
        promptMock.mockResolvedValue({ packages: [lodashPatch] });
        const state = makeState([lodashPatch]);

        const result = await selectPackagesToUpdate(state);

        expect(result.action).toBe("update");
        expect(result.packages).toEqual([lodashPatch]);
    });

    it("returns action 'skip' when the skip sentinel is chosen", async () => {
        promptMock.mockResolvedValue({ packages: [SKIP_WORKSPACE] });
        const state = makeState([lodashPatch]);

        const result = await selectPackagesToUpdate(state, {
            workspaceMode: true,
        });

        expect(result.action).toBe("skip");
        expect(result.packages).toEqual([]);
    });

    it("returns action 'abort' when the abort sentinel is chosen", async () => {
        // Even if some packages were also checked, abort wins.
        promptMock.mockResolvedValue({
            packages: [lodashPatch, ABORT_WORKSPACES],
        });
        const state = makeState([lodashPatch]);

        const result = await selectPackagesToUpdate(state, {
            workspaceMode: true,
        });

        expect(result.action).toBe("abort");
        expect(result.packages).toEqual([]);
    });

    it("returns action 'cancel' when the cancel sentinel is chosen (non-workspace)", async () => {
        promptMock.mockResolvedValue({ packages: [CANCEL] });
        const state = makeState([lodashPatch]);

        const result = await selectPackagesToUpdate(state);

        expect(result.action).toBe("cancel");
        expect(result.packages).toEqual([]);
    });

    it("offers a Cancel choice in non-workspace mode", async () => {
        let capturedChoices;
        promptMock.mockImplementation((questions) => {
            capturedChoices = questions[0].choices;
            return Promise.resolve({ packages: [] });
        });

        const state = makeState([lodashPatch]);
        await selectPackagesToUpdate(state);

        const values = capturedChoices.map((c) => c?.value).filter(Boolean);
        expect(values).toContain(CANCEL);
        expect(values).not.toContain(SKIP_WORKSPACE);
        expect(values).not.toContain(ABORT_WORKSPACES);
    });

    it("filters sentinels out of the returned package list", async () => {
        promptMock.mockResolvedValue({ packages: [lodashPatch, semverMinor] });
        const state = makeState([lodashPatch, semverMinor]);

        const result = await selectPackagesToUpdate(state, {
            workspaceMode: true,
        });

        expect(result.action).toBe("update");
        expect(result.packages).toEqual([lodashPatch, semverMinor]);
    });

    it("pre-checks packages chosen in an earlier workspace", async () => {
        let capturedChoices;
        promptMock.mockImplementation((questions) => {
            capturedChoices = questions[0].choices;
            return Promise.resolve({ packages: [] });
        });

        const preselected = new Map([["lodash", "4.18.1"]]);
        const state = makeState([lodashPatch, semverMinor]);

        await selectPackagesToUpdate(state, {
            workspaceMode: true,
            preselected,
        });

        // The lodash choice should be pre-checked; semver should not.
        const lodashChoice = capturedChoices.find(
            (c) => c?.value?.moduleName === "lodash",
        );
        const semverChoice = capturedChoices.find(
            (c) => c?.value?.moduleName === "semver",
        );

        expect(lodashChoice.checked).toBe(true);
        expect(semverChoice.checked).toBeUndefined();
    });

    it("adds skip and abort choices only in workspace mode", async () => {
        let capturedChoices;
        promptMock.mockImplementation((questions) => {
            capturedChoices = questions[0].choices;
            return Promise.resolve({ packages: [] });
        });

        const state = makeState([lodashPatch]);

        await selectPackagesToUpdate(state, { workspaceMode: false });
        const valuesNonWs = capturedChoices
            .map((c) => c?.value)
            .filter(Boolean);
        expect(valuesNonWs).not.toContain(SKIP_WORKSPACE);
        expect(valuesNonWs).not.toContain(ABORT_WORKSPACES);

        promptMock.mockClear();
        await selectPackagesToUpdate(state, { workspaceMode: true });
        const valuesWs = capturedChoices.map((c) => c?.value).filter(Boolean);
        expect(valuesWs).toContain(SKIP_WORKSPACE);
        expect(valuesWs).toContain(ABORT_WORKSPACES);
    });
});
