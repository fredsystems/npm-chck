#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import callsiteRecord from "callsite-record";
import chalk from "chalk";
import isCI from "is-ci";
import meow from "meow";
import { packageDirectorySync } from "pkg-dir";
import detectPreferredPM from "preferred-pm";
import updateNotifier from "update-notifier";
import {
    getWorkspacePackages,
    isBareworkspaceRoot,
} from "./in/get-workspace-packages.js";
import npmCheck from "./index.js";
import interactiveUpdate from "./out/interactive-update.js";
import staticOutput from "./out/static-output.js";
import updateAll from "./out/update-all.js";
import debug from "./state/debug.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

updateNotifier({ pkg }).notify();

/* eslint-disable indent */
const cli = meow(
    `
        Usage
          $ npm-check <path> <options>

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
          $ npm-check           # See what can be updated, what isn't being used.
          $ npm-check ../foo    # Check another path.
          $ npm-check -gu       # Update globally installed modules by picking which ones to upgrade.
          $ npm-check -w        # Check all workspace packages in a monorepo.
          $ npm-check -wu       # Interactively update workspace packages.
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
 * Otherwise we auto-detect: if the target directory is a bare workspace
 * root (has a `workspaces` field but no direct dependencies) we switch
 * into workspace mode automatically so users don't need to pass a flag.
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

    // Auto-detect: bare workspace root (has workspaces config but no own deps)
    return isBareworkspaceRoot(cwd);
}

/**
 * Print a prominent workspace section header so the output of each
 * workspace package is clearly delineated.
 */
function printWorkspaceHeader(wsDir, rootDir) {
    const label = relative(rootDir, wsDir) || wsDir;
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
 * Run npm-check for a single `currentState` and execute the appropriate
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
 * Run npm-check across all discovered workspace packages, printing a
 * section header before each one.
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

    let anyIssues = false;

    for (const wsDir of workspaceDirs) {
        printWorkspaceHeader(wsDir, rootCwd);

        const wsOptions = {
            ...options,
            cwd: wsDir,
            installer,
        };

        try {
            // eslint-disable-next-line no-await-in-loop
            const currentState = await npmCheck(wsOptions);
            const prevExitCode = process.exitCode;
            // eslint-disable-next-line no-await-in-loop
            await runOutputForState(currentState);
            if (process.exitCode !== 0) {
                anyIssues = true;
                // Reset so the next workspace starts clean; we'll restore at
                // the end if any workspace had issues.
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

        // Single-package (non-workspace) flow
        const currentState = await npmCheck(options);
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
