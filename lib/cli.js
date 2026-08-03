#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import callsiteRecord from "callsite-record";
import chalk from "chalk";
import isCI from "is-ci";
import meow from "meow";
import { packageDirectorySync } from "pkg-dir";
import { preferredPM as detectPreferredPM } from "preferred-pm";
import updateNotifier from "update-notifier";
import {
    findWorkspaceRoot,
    getWorkspaceMemberPatterns,
    getWorkspacePackageNames,
    getWorkspacePackages,
    isWorkspaceRoot,
} from "./in/get-workspace-packages.js";
import npmCheck from "./index.js";
import interactiveUpdate from "./out/interactive-update.js";
import staticOutput from "./out/static-output.js";
import updateAll from "./out/update-all.js";
import { runWorkspaceUpdate } from "./out/workspace-update.js";
import debug from "./state/debug.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

updateNotifier({ pkg }).notify();

/* eslint-disable indent */
const cli = meow(
    `
        Usage
          $ npm-chck <path> <options>

        Path
          Where to check. Defaults to current directory. Use -g for checking global modules.

        Options
          -u, --update          Interactive update.
          -y, --update-all      Uninteractive update. Apply all updates without prompting.
          -g, --global          Look at global modules.
          -s, --skip-unused     Skip check for unused packages.
          -p, --production      Skip devDependencies.
          -d, --dev-only        Look at devDependencies only (skip dependencies).
          -i, --ignore          Ignore dependencies based on succeeding glob.
          -E, --save-exact      Save exact version (x.y.z) instead of caret (^x.y.z) in package.json.
          -w, --workspaces      Check all workspace packages (auto-detected for bare workspace roots).
          --no-workspaces       Disable workspace auto-detection (e.g. to check only the root package).
          --specials            List of depcheck specials to include in check for unused dependencies.
          --no-color            Force or disable color output.
          --no-emoji            Remove emoji support. No emoji in default in CI environments.
          --debug               Debug output. Throw in a gist when creating issues on github.

        Examples
          $ npm-chck           # See what can be updated, what isn't being used.
          $ npm-chck ../foo    # Check another path.
          $ npm-chck -gu       # Update globally installed modules by picking which ones to upgrade.
          $ npm-chck -w        # Check all workspace packages in a monorepo.
          $ npm-chck -wu       # Interactively update workspace packages.
    `,
    {
        importMeta: import.meta,
        flags: {
            update: {
                type: "boolean",
                shortFlag: "u",
            },
            updateAll: {
                type: "boolean",
                shortFlag: "y",
            },
            global: {
                type: "boolean",
                shortFlag: "g",
            },
            skipUnused: {
                type: "boolean",
                shortFlag: "s",
            },
            production: {
                type: "boolean",
                shortFlag: "p",
            },
            devOnly: {
                type: "boolean",
                shortFlag: "d",
            },
            saveExact: {
                type: "boolean",
                shortFlag: "E",
            },
            ignore: {
                type: "string",
                shortFlag: "i",
            },
            workspaces: {
                type: "boolean",
                shortFlag: "w",
            },
            specials: {
                type: "string",
            },
            color: {
                type: "boolean",
            },
            emoji: {
                type: "boolean",
                default: !isCI,
            },
            debug: {
                type: "boolean",
            },
            spinner: {
                type: "boolean",
                default: !isCI,
            },
        },
    },
);
/* eslint-enable indent */

const rootCwd = cli.input[0] || packageDirectorySync() || process.cwd();

// `workspaces` stays out of the state object – it is only used at the CLI
// layer to decide whether to iterate over workspace packages.
const { workspaces: workspacesFlag, ...restFlags } = cli.flags;

const options = {
    cwd: rootCwd,
    update: restFlags.update,
    updateAll: restFlags.updateAll,
    global: restFlags.global,
    skipUnused: restFlags.skipUnused,
    ignoreDev: restFlags.production,
    devOnly: restFlags.devOnly,
    saveExact: restFlags.saveExact,
    specials: restFlags.specials,
    emoji: restFlags.emoji,
    installer: process.env.NPM_CHECK_INSTALLER || "auto",
    debug: restFlags.debug,
    spinner: restFlags.spinner,
    ignore: restFlags.ignore,
};

if (options.debug) {
    debug("cli.flags", cli.flags);
    debug("cli.input", cli.input);
}

const SUPPORTED_INSTALLERS = new Set(["npm", "pnpm", "ied", "yarn"]);

async function detectPreferredInstaller(cwd) {
    const preferredPM = await detectPreferredPM(cwd);
    return preferredPM && SUPPORTED_INSTALLERS.has(preferredPM.name)
        ? preferredPM.name
        : "npm";
}

/**
 * Determine whether to run in workspace mode.
 *
 * Explicit `--workspaces` / `--no-workspaces` flags take precedence.
 * Otherwise we auto-detect: any directory declaring a workspace
 * configuration switches into workspace mode, so running `npm-chck` at a
 * monorepo root "just works" without a flag.
 *
 * The root's own dependencies are deliberately NOT part of this decision.
 * Requiring a dependency-free root meant the extremely common layout of a
 * root that carries a few tooling devDependencies fell back to
 * single-package mode, silently checking only the root and reporting the
 * whole monorepo as up to date.
 *
 * NOTE: meow v14 returns `false` for any boolean flag that was not
 * explicitly provided on the command line, which makes it impossible to
 * distinguish "not given" from "--no-workspaces" using `workspacesFlag`
 * alone.  We therefore inspect `process.argv` directly to detect the
 * explicit negation.
 */
function resolveWorkspaceMode(cwd) {
    // Explicit opt-out via --no-workspaces
    if (process.argv.includes("--no-workspaces")) {
        return false;
    }

    // Explicit opt-in via --workspaces / -w
    if (workspacesFlag === true) {
        return true;
    }

    // Auto-detect: any workspace root, with or without its own dependencies.
    return isWorkspaceRoot(cwd);
}

/**
 * Print a prominent workspace section header so the output of each
 * workspace package is clearly delineated.
 */
function printWorkspaceHeader(wsDir, rootDir) {
    // The workspace root itself is checked too; label it "." rather than
    // falling back to a noisy absolute path.
    const label = relative(rootDir, wsDir) || ".";
    let name = label;

    // Try to read the package name for a friendlier label
    try {
        const pkgJson = JSON.parse(
            readFileSync(join(wsDir, "package.json"), "utf8"),
        );
        if (pkgJson.name) {
            name = `${pkgJson.name} (${label})`;
        }
    } catch {
        // Ignore – fall back to the directory label
    }

    const line = "─".repeat(Math.min(process.stdout.columns || 80, 80));
    console.log("");
    console.log(chalk.bold.cyan(line));
    console.log(chalk.bold.cyan(`  Workspace: ${name}`));
    console.log(chalk.bold.cyan(line));
}

/**
 * Resolve the workspace context for a target directory.
 *
 * `packageNames` lets the registry lookup skip sibling packages (they are
 * local symlinks, not published), and `memberPatterns` lets the root's
 * unused-dependency scan stay out of the member directories. Both are derived
 * from the nearest enclosing workspace root, so they are populated even when
 * npm-chck is pointed at a single member directory.
 *
 * @param {string} cwd
 * @returns {{root: string | null, packageNames: string[], memberPatterns: string[]}}
 */
function resolveWorkspaceContext(cwd) {
    const root = findWorkspaceRoot(cwd);

    if (!root) {
        return { root: null, packageNames: [], memberPatterns: [] };
    }

    return {
        root,
        packageNames: getWorkspacePackageNames(root),
        memberPatterns: getWorkspaceMemberPatterns(root),
    };
}

/**
 * Build the option object for one package's check, layering the workspace
 * context on top of the CLI options.
 */
function buildCheckOptions(cwd, installer, workspaceContext) {
    const isWorkspaceRootDir =
        workspaceContext.root !== null &&
        resolve(cwd) === resolve(workspaceContext.root);

    return {
        ...options,
        cwd,
        installer,
        workspacePackageNames: workspaceContext.packageNames,
        depcheckIgnorePatterns: isWorkspaceRootDir
            ? workspaceContext.memberPatterns
            : [],
    };
}

/**
 * Run npm-chck for a single `currentState` and execute the appropriate
 * output handler (static / update-all / interactive).
 */
async function runOutputForState(currentState) {
    currentState.inspectIfDebugMode();

    if (options.updateAll) {
        return updateAll(currentState);
    }

    if (options.update) {
        return interactiveUpdate(currentState);
    }

    return staticOutput(currentState);
}

/**
 * Check every workspace package, returning the discovered states. A section
 * header is printed before each package so check output stays delineated.
 *
 * @returns {Promise<{states: Array<{wsDir: string, state: object}>, anyIssues: boolean}>}
 */
async function checkWorkspaces(
    workspaceDirs,
    installer,
    { withHeader, workspaceContext },
) {
    const states = [];
    let anyIssues = false;

    for (const wsDir of workspaceDirs) {
        if (withHeader) {
            printWorkspaceHeader(wsDir, rootCwd);
        }

        const wsOptions = buildCheckOptions(wsDir, installer, workspaceContext);

        try {
            // eslint-disable-next-line no-await-in-loop
            const currentState = await npmCheck(wsOptions);
            states.push({ wsDir, state: currentState });
        } catch (error) {
            console.log(
                chalk.red(
                    `Error checking workspace ${wsDir}: ${error.message}`,
                ),
            );
            if (options.debug) {
                console.log(callsiteRecord(error).renderSync());
            }
            anyIssues = true;
        }
    }

    return { states, anyIssues };
}

/**
 * Run npm-chck across all discovered workspace packages.
 *
 * In check-only mode each workspace is reported independently. In update
 * (`-u`) or update-all (`-y`) mode every workspace is checked first, the
 * selections are gathered across the whole monorepo, and a single install is
 * run from the workspace root so shared dependencies resolve consistently.
 */
async function runWorkspaces(installer) {
    const workspaceDirs = getWorkspacePackages(rootCwd);

    if (!workspaceDirs || workspaceDirs.length === 0) {
        console.log(
            chalk.yellow(
                "No workspace packages found. " +
                    "Make sure your package.json (or pnpm-workspace.yaml) " +
                    "has a valid `workspaces` configuration.",
            ),
        );
        process.exit(0);
    }

    if (options.debug) {
        debug("workspace packages", workspaceDirs);
    }

    const workspaceContext = resolveWorkspaceContext(rootCwd);
    const updateMode = options.update || options.updateAll;

    // Check-only: keep the original per-workspace static report.
    if (!updateMode) {
        let anyIssues = false;
        for (const wsDir of workspaceDirs) {
            printWorkspaceHeader(wsDir, rootCwd);
            const wsOptions = buildCheckOptions(
                wsDir,
                installer,
                workspaceContext,
            );
            try {
                // eslint-disable-next-line no-await-in-loop
                const currentState = await npmCheck(wsOptions);
                const prevExitCode = process.exitCode;
                // eslint-disable-next-line no-await-in-loop
                await runOutputForState(currentState);
                if (process.exitCode !== 0) {
                    anyIssues = true;
                    process.exitCode = 0;
                } else {
                    process.exitCode = prevExitCode;
                }
            } catch (error) {
                console.log(
                    chalk.red(
                        `Error checking workspace ${wsDir}: ${error.message}`,
                    ),
                );
                if (options.debug) {
                    console.log(callsiteRecord(error).renderSync());
                }
                anyIssues = true;
            }
        }
        if (anyIssues) {
            process.exitCode = 1;
        }
        return;
    }

    // Update mode: gather all workspace states, then drive a single batched
    // update + root install.
    const { states, anyIssues } = await checkWorkspaces(
        workspaceDirs,
        installer,
        { withHeader: false, workspaceContext },
    );

    if (states.length === 0) {
        if (anyIssues) {
            process.exitCode = 1;
        }
        return;
    }

    await runWorkspaceUpdate(states, {
        rootCwd,
        interactive: Boolean(options.update),
        saveExact: Boolean(options.saveExact),
        installer,
        spinner: options.spinner,
        printHeader: (wsDir) => printWorkspaceHeader(wsDir, rootCwd),
    });

    if (anyIssues) {
        process.exitCode = 1;
    }
}

// ─── Main entry point ────────────────────────────────────────────────────────

Promise.resolve()
    .then(() =>
        options.installer === "auto"
            ? detectPreferredInstaller(rootCwd)
            : options.installer,
    )
    .then(async (installer) => {
        options.installer = installer;

        if (resolveWorkspaceMode(rootCwd)) {
            return runWorkspaces(installer);
        }

        // Single-package flow. This still resolves the workspace context so
        // that pointing npm-chck at one member of a monorepo (or using
        // --no-workspaces at the root) does not treat sibling packages as
        // missing registry packages.
        const currentState = await npmCheck(
            buildCheckOptions(
                rootCwd,
                installer,
                resolveWorkspaceContext(rootCwd),
            ),
        );
        return runOutputForState(currentState);
    })
    .catch((error) => {
        console.log(error.message);

        if (options.debug) {
            console.log(callsiteRecord(error).renderSync());
        } else {
            console.log("For more detail, add `--debug` to the command");
        }

        process.exit(1);
    });
