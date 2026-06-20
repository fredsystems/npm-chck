import chalk from "chalk";
import inquirer from "inquirer";
import _ from "lodash";
import stripAnsi from "strip-ansi";
import table from "text-table";
import emoji from "./emoji.js";
import installPackages from "./install-packages.js";

const UI_GROUPS = [
    {
        title: chalk.bold.underline.green(
            "Update package.json to match version installed.",
        ),
        filter: { mismatch: true, bump: null },
    },
    {
        title: `${chalk.bold.underline.green("Missing.")} ${chalk.green("You probably want these.")}`,
        filter: { notInstalled: true, bump: null },
    },
    {
        title: `${chalk.bold.underline.green("Patch Update")} ${chalk.green("Backwards-compatible bug fixes.")}`,
        filter: { bump: "patch" },
    },
    {
        title: `${chalk.yellow.underline.bold("Minor Update")} ${chalk.yellow("New backwards-compatible features.")}`,
        bgColor: "yellow",
        filter: { bump: "minor" },
    },
    {
        title: `${chalk.red.underline.bold("Major Update")} ${chalk.red("Potentially breaking API changes. Use caution.")}`,
        filter: { bump: "major" },
    },
    {
        title: `${chalk.magenta.underline.bold("Non-Semver")} ${chalk.magenta("Versions less than 1.0.0, caution.")}`,
        filter: { bump: "nonSemver" },
    },
];

function label(pkg) {
    const bumpInstalled = pkg.bump ? pkg.installed : "";
    const installed = pkg.mismatch ? pkg.packageJson : bumpInstalled;
    const name = chalk.yellow(pkg.moduleName);
    const type = pkg.devDependency ? chalk.green(" devDep") : "";
    const missing = pkg.notInstalled ? chalk.red(" missing") : "";
    const homepage = pkg.homepage ? chalk.blue.underline(pkg.homepage) : "";
    return [
        name + type + missing,
        installed,
        installed && "❯",
        chalk.bold(pkg.latest || ""),
        pkg.latest ? homepage : pkg.regError || pkg.pkgError,
    ];
}

function short(pkg) {
    return `${pkg.moduleName}@${pkg.latest}`;
}

function choice(pkg) {
    if (!pkg.mismatch && !pkg.bump && !pkg.notInstalled) {
        return false;
    }

    return {
        value: pkg,
        name: label(pkg),
        short: short(pkg),
    };
}

function unselectable(options) {
    return new inquirer.Separator(chalk.reset(options ? options.title : " "));
}

function createChoices(packages, options) {
    const filteredChoices = _.filter(packages, options.filter);

    const choices = filteredChoices.map(choice).filter(Boolean);

    const choicesAsATable = table(_.map(choices, "name"), {
        align: ["l", "l", "l"],
        stringLength: (str) => stripAnsi(str).length,
    }).split("\n");

    const choicesWithTableFormating = _.map(choices, (choice, i) => {
        choice.name = choicesAsATable[i];
        return choice;
    });

    if (choicesWithTableFormating.length) {
        choices.unshift(unselectable(options));
        choices.unshift(unselectable());
        return choices;
    }
}

function buildPackageToUpdate(moduleName, version, isYarn, saveExact) {
    // handle adding ^ for yarn, npm seems to handle this if not exact
    return isYarn && !saveExact
        ? moduleName + "@^" + version
        : moduleName + "@" + version;
}

// Sentinel choice values used for the skip / abort / cancel actions.
export const SKIP_WORKSPACE = Symbol("npm-chck:skip-workspace");
export const ABORT_WORKSPACES = Symbol("npm-chck:abort-workspaces");
export const CANCEL = Symbol("npm-chck:cancel");

/**
 * Build the grouped, table-formatted checkbox choices for a state.
 *
 * @param {object} currentState
 * @param {Map<string,string>} [preselected] - Map of moduleName -> target
 *        version chosen in an earlier workspace. Matching packages are
 *        pre-checked so a shared dependency is updated consistently.
 * @returns {{choices: Array, hasChoices: boolean}}
 */
function buildChoices(currentState, preselected) {
    const packages = currentState.get("packages");

    if (currentState.get("debug")) {
        console.log("packages", packages);
    }

    const choicesGrouped = UI_GROUPS.map((group) =>
        createChoices(packages, group),
    ).filter(Boolean);

    const choices = _.flatten(choicesGrouped);

    if (!choices.length) {
        return { choices, hasChoices: false };
    }

    // Pre-check any package that was already selected in a previous workspace
    // so shared dependencies (e.g. biome) are updated to the same version
    // everywhere.
    if (preselected && preselected.size > 0) {
        for (const item of choices) {
            const pkg = item?.value;
            if (pkg && preselected.has(pkg.moduleName)) {
                item.checked = true;
            }
        }
    }

    return { choices, hasChoices: true };
}

/**
 * Prompt the user to choose packages to update for a single state, without
 * performing any installation or file writes.
 *
 * @param {object} currentState
 * @param {object} [options]
 * @param {Map<string,string>} [options.preselected]
 * @param {boolean} [options.workspaceMode] - When true, the prompt includes
 *        "skip this workspace" and "abort all" actions.
 * @returns {Promise<{action: "update"|"skip"|"abort"|"none", packages: Array}>}
 */
export function selectPackagesToUpdate(currentState, options = {}) {
    const { preselected, workspaceMode = false } = options;

    const { choices, hasChoices } = buildChoices(currentState, preselected);

    if (!hasChoices) {
        console.log(
            `${emoji(":heart:  ")}Your modules look ${chalk.bold("amazing")}. Keep up the great work.${emoji(" :heart:")}`,
        );
        return Promise.resolve({ action: "none", packages: [] });
    }

    if (workspaceMode) {
        choices.push(unselectable());
        choices.push({
            value: SKIP_WORKSPACE,
            name: chalk.cyan("» Skip this workspace (make no changes)"),
            short: "skip",
        });
        choices.push({
            value: ABORT_WORKSPACES,
            name: chalk.red("» Abort — cancel all remaining workspaces"),
            short: "abort",
        });
    } else {
        choices.push(unselectable());
        choices.push({
            value: CANCEL,
            name: chalk.red("» Cancel (make no changes)"),
            short: "cancel",
        });
    }

    choices.push(unselectable());
    choices.push(
        unselectable({
            title: workspaceMode
                ? "Space to select. Enter to confirm this workspace. Select Skip/Abort to bail."
                : "Space to select. Enter to start upgrading. Select Cancel (or Control-C) to bail.",
        }),
    );

    const questions = [
        {
            name: "packages",
            message: "Choose which packages to update.",
            type: "checkbox",
            choices: choices.concat(unselectable()),
            pageSize: process.stdout.rows - 2,
        },
    ];

    return inquirer.prompt(questions).then((answers) => {
        const selected = answers.packages || [];

        if (selected.includes(ABORT_WORKSPACES)) {
            return { action: "abort", packages: [] };
        }

        if (selected.includes(SKIP_WORKSPACE)) {
            return { action: "skip", packages: [] };
        }

        if (selected.includes(CANCEL)) {
            return { action: "cancel", packages: [] };
        }

        const packagesToUpdate = selected.filter(
            (value) =>
                value !== SKIP_WORKSPACE &&
                value !== ABORT_WORKSPACES &&
                value !== CANCEL,
        );

        return { action: "update", packages: packagesToUpdate };
    });
}

/**
 * Install the chosen packages into the state's cwd (the legacy, single-package
 * behaviour: edits package.json via the installer's --save flags).
 */
function installSelected(packagesToUpdate, currentState) {
    const isYarn = currentState.get("installer") === "yarn";
    const saveExact = currentState.get("saveExact");

    const saveDependencies = packagesToUpdate
        .filter((pkg) => !pkg.devDependency)
        .map((pkg) =>
            buildPackageToUpdate(pkg.moduleName, pkg.latest, isYarn, saveExact),
        );

    const saveDevDependencies = packagesToUpdate
        .filter((pkg) => pkg.devDependency)
        .map((pkg) =>
            buildPackageToUpdate(pkg.moduleName, pkg.latest, isYarn, saveExact),
        );

    const updatedPackages = packagesToUpdate
        .map((pkg) =>
            buildPackageToUpdate(pkg.moduleName, pkg.latest, isYarn, saveExact),
        )
        .join(", ");

    if (!currentState.get("global")) {
        if (saveDependencies.length) {
            !isYarn && saveDependencies.push("--save");
        }

        if (saveDevDependencies.length) {
            isYarn
                ? saveDevDependencies.push("--dev")
                : saveDevDependencies.push("--save-dev");
        }
    }

    return installPackages(saveDependencies, currentState)
        .then((currentState) =>
            installPackages(saveDevDependencies, currentState),
        )
        .then((currentState) => {
            console.log("");
            console.log(chalk.green(`[npm-chck] Update complete!`));
            console.log(chalk.green("[npm-chck] " + updatedPackages));
            console.log(
                chalk.green(
                    `[npm-chck] You should re-run your tests to make sure everything works with the updates.`,
                ),
            );
            return currentState;
        });
}

function interactive(currentState) {
    return selectPackagesToUpdate(currentState).then((result) => {
        if (result.action === "cancel") {
            console.log(chalk.yellow("Cancelled. No changes were made."));
            return false;
        }

        if (result.action !== "update" || result.packages.length === 0) {
            if (result.action === "update") {
                console.log("No packages selected for update.");
            }
            return false;
        }

        return installSelected(result.packages, currentState);
    });
}

export default interactive;
