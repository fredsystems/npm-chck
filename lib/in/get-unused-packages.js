import depcheck from "depcheck";
import _ from "lodash";
import ora from "ora";
import { rcFile } from "rc-config-loader";

function skipUnused(currentState) {
    return (
        currentState.get("skipUnused") || // manual option to ignore this
        currentState.get("global") || // global modules
        currentState.get("update") || // in the process of doing an update
        !currentState.get("cwdPackageJson").name
    ); // there's no package.json
}

function loadRcFile(rcFileName) {
    try {
        const results = rcFile(rcFileName);
        // Not Found
        if (!results) {
            return {};
        }
        return results.config;
    } catch (error) {
        console.error(
            `Error parsing rc file; skipping it; error: ${error.message}`,
        );
        return {}; // default value
    }
}

function getSpecialParsers(currentState) {
    const specialsInput = currentState.get("specials");
    if (!specialsInput) return;
    return specialsInput
        .split(",")
        .map((special) => depcheck.special[special])
        .filter(Boolean);
}

function buildDepcheckOptions(currentState) {
    const depcheckDefaults = {
        ignoreDirs: [
            "sandbox",
            "dist",
            "generated",
            ".generated",
            "build",
            "fixtures",
            "jspm_packages",
        ],
        ignoreMatches: [
            "gulp-*",
            "grunt-*",
            "karma-*",
            "angular-*",
            "babel-*",
            "metalsmith-*",
            "eslint-plugin-*",
            "@types/*",
            "grunt",
            "mocha",
            "ava",
        ],
        specials: getSpecialParsers(currentState),
    };

    const npmCheckRc = loadRcFile("npmcheck");

    const options = {
        ...depcheckDefaults,
        ...npmCheckRc.depcheck,
    };

    // A workspace root must not have its own dependencies justified by code in
    // its member packages, so keep the scan out of the member directories.
    const workspaceIgnores = currentState.get("depcheckIgnorePatterns");
    if (workspaceIgnores.length > 0) {
        options.ignorePatterns = [
            ...(options.ignorePatterns ?? []),
            ...workspaceIgnores,
        ];
    }

    return options;
}

function recordResults(currentState, depCheckResults) {
    const unusedDependencies = [
        ...(depCheckResults.dependencies ?? []),
        ...(depCheckResults.devDependencies ?? []),
    ];
    currentState.set("unusedDependencies", unusedDependencies);

    const cwdPackageJson = currentState.get("cwdPackageJson");

    // currently missing will return devDependencies that aren't really missing
    const missingFromPackageJson = _.omit(
        depCheckResults.missing || {},
        Object.keys(cwdPackageJson.dependencies),
        Object.keys(cwdPackageJson.devDependencies),
    );
    currentState.set("missingFromPackageJson", missingFromPackageJson);

    return currentState;
}

async function checkUnused(currentState) {
    // Bail out before starting the spinner, otherwise a skipped scan still
    // announces "Checking for unused packages. --skip-unused if you don't want
    // this." even when --skip-unused is exactly what was passed.
    if (skipUnused(currentState)) {
        return recordResults(currentState, {});
    }

    const spinner = ora(
        `Checking for unused packages. --skip-unused if you don't want this.`,
    );
    spinner.enabled = spinner.enabled && currentState.get("spinner");
    spinner.start();

    try {
        const depCheckResults = await new Promise((resolve) => {
            depcheck(
                currentState.get("cwd"),
                buildDepcheckOptions(currentState),
                resolve,
            );
        });

        return recordResults(currentState, depCheckResults);
    } finally {
        spinner.stop();
    }
}

export default checkUnused;
