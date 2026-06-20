import { relative } from "node:path";
import chalk from "chalk";
import { execa } from "execa";
import inquirer from "inquirer";
import ora from "ora";
import { selectPackagesToUpdate } from "./interactive-update.js";
import {
    applyUpdatesToPackageJson,
    versionRange,
} from "./write-package-json.js";

/**
 * Collect the packages to update across every workspace package without
 * writing any files. Prompts interactively per workspace (with skip/abort
 * actions) or, in update-all mode, auto-selects every available update.
 *
 * Packages chosen in one workspace are remembered and pre-selected in later
 * workspaces that also depend on them, so a shared dependency (e.g. biome) is
 * bumped to a single, consistent version across the monorepo.
 *
 * @param {Array<{wsDir: string, state: object}>} workspaces
 * @param {object} options
 * @param {string} options.rootCwd
 * @param {boolean} options.interactive - true for `-u`, false for `-y`.
 * @param {(wsDir: string) => void} options.printHeader
 * @returns {Promise<{aborted: boolean, plan: Array<{wsDir: string, packages: Array}>}>}
 */
async function collectSelections(workspaces, options) {
    const { interactive, printHeader } = options;

    // moduleName -> chosen target version (the "latest" picked earlier).
    const chosen = new Map();
    const plan = [];

    for (const { wsDir, state } of workspaces) {
        printHeader(wsDir);

        if (interactive) {
            // eslint-disable-next-line no-await-in-loop
            const result = await selectPackagesToUpdate(state, {
                workspaceMode: true,
                preselected: chosen,
            });

            if (result.action === "abort") {
                console.log(chalk.yellow("Aborted. No changes were made."));
                return { aborted: true, plan: [] };
            }

            if (result.action === "skip" || result.action === "none") {
                continue;
            }

            if (result.packages.length === 0) {
                console.log("No packages selected for this workspace.");
                continue;
            }

            for (const pkg of result.packages) {
                chosen.set(pkg.moduleName, pkg.latest);
            }
            plan.push({ wsDir, packages: result.packages });
        } else {
            // update-all: take every available update in this workspace.
            const packages = state.get("packages") || [];
            const toUpdate = packages.filter(
                (p) => p.mismatch || p.notInstalled || p.bump,
            );
            if (toUpdate.length === 0) {
                continue;
            }
            for (const pkg of toUpdate) {
                chosen.set(pkg.moduleName, pkg.latest);
            }
            plan.push({ wsDir, packages: toUpdate });
        }
    }

    return { aborted: false, plan };
}

/**
 * Print a summary of every pending change across all workspaces.
 */
function printSummary(plan, rootCwd, saveExact) {
    console.log("");
    console.log(chalk.bold.cyan("Pending updates across workspaces:"));
    for (const { wsDir, packages } of plan) {
        const label = relative(rootCwd, wsDir) || ".";
        console.log("");
        console.log(chalk.bold(`  ${label}`));
        for (const pkg of packages) {
            const bucket = pkg.devDependency ? "devDep" : "dep";
            console.log(
                `    ${chalk.yellow(pkg.moduleName)} ${chalk.dim(`(${bucket})`)} → ${chalk.green(
                    versionRange(pkg.latest, saveExact),
                )}`,
            );
        }
    }
    console.log("");
}

/**
 * Run a single install from the workspace root so the installer can resolve a
 * consistent dependency tree for the whole monorepo in one pass.
 */
async function installAtRoot(rootCwd, installer, spinnerEnabled) {
    const color = chalk.level > 0 ? "--color=always" : null;
    const installCmd = installer === "yarn" ? "install" : "install";
    const args = [installCmd, color].filter(Boolean);

    console.log("");
    console.log(`$ ${chalk.green(installer)} ${chalk.green(args.join(" "))}`);
    console.log(chalk.dim(`  (run from workspace root: ${rootCwd})`));

    const spinner = ora(`Installing using ${chalk.green(installer)}...`);
    spinner.enabled = spinner.enabled && spinnerEnabled;
    spinner.start();

    try {
        const output = await execa(installer, args, { cwd: rootCwd });
        spinner.stop();
        if (output.stdout) {
            console.log(output.stdout);
        }
        if (output.stderr) {
            console.log(output.stderr);
        }
    } catch (err) {
        spinner.stop();
        throw err;
    }
}

/**
 * Orchestrate a workspace-wide update:
 *   1. collect selections across all workspaces (no writes),
 *   2. show a summary and confirm once,
 *   3. write every workspace package.json,
 *   4. run a single install from the root.
 *
 * @param {Array<{wsDir: string, state: object}>} workspaces
 * @param {object} options
 * @param {string} options.rootCwd
 * @param {boolean} options.interactive
 * @param {boolean} options.saveExact
 * @param {string} options.installer
 * @param {boolean} options.spinner
 * @param {(wsDir: string) => void} options.printHeader
 * @returns {Promise<boolean>} true if an install was performed.
 */
export async function runWorkspaceUpdate(workspaces, options) {
    const { rootCwd, interactive, saveExact, installer, spinner, printHeader } =
        options;

    const { aborted, plan } = await collectSelections(workspaces, {
        interactive,
        printHeader,
    });

    if (aborted) {
        return false;
    }

    if (plan.length === 0) {
        console.log("");
        console.log(chalk.green("No updates selected. Nothing to do."));
        return false;
    }

    printSummary(plan, rootCwd, saveExact);

    if (interactive) {
        const { confirm } = await inquirer.prompt([
            {
                name: "confirm",
                type: "confirm",
                message:
                    "Apply these updates and run a single install from the root?",
                default: true,
            },
        ]);

        if (!confirm) {
            console.log(chalk.yellow("Aborted. No changes were made."));
            return false;
        }
    }

    // Nothing is written until this point, so there is nothing to roll back if
    // the user cancels above.
    const allWritten = [];
    for (const { wsDir, packages } of plan) {
        const written = applyUpdatesToPackageJson(wsDir, packages, saveExact);
        allWritten.push(...written);
    }

    console.log("");
    console.log(
        chalk.green(
            `[npm-chck] Updated ${plan.length} workspace package.json file(s).`,
        ),
    );

    await installAtRoot(rootCwd, installer, spinner);

    console.log("");
    console.log(chalk.green("[npm-chck] Update complete!"));
    console.log(chalk.green("[npm-chck] " + allWritten.join(", ")));
    console.log(
        chalk.green(
            "[npm-chck] You should re-run your tests to make sure everything works with the updates.",
        ),
    );

    return true;
}

export default runWorkspaceUpdate;
