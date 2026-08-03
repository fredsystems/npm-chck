import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";

/**
 * Compute the version range string to write into a package.json
 * dependency entry.
 *
 * The range operator already used by the project wins, so a repo that pins
 * exact versions (e.g. a Renovate-managed monorepo where every entry is
 * `"react": "19.2.7"`) does not silently get rewritten to `"^19.2.8"`, and a
 * `~` range is not widened to `^`. `--save-exact` still forces an exact pin,
 * and anything we can't classify falls back to a caret range.
 *
 * @param {string} version - The bare target version (e.g. "1.2.3").
 * @param {boolean} saveExact - When true, pin the exact version. Otherwise
 *                              use a caret range.
 * @param {string} [currentRange] - The range currently in package.json, used
 *                                  to preserve the project's pinning style.
 * @returns {string}
 */
export function versionRange(version, saveExact, currentRange) {
    if (saveExact) {
        return version;
    }

    if (typeof currentRange === "string") {
        const trimmed = currentRange.trim();

        // An exact pin such as "19.2.7" (or "=19.2.7") stays an exact pin.
        if (semver.valid(trimmed.replace(/^=/, ""))) {
            return version;
        }

        if (trimmed.startsWith("~")) {
            return `~${version}`;
        }
    }

    return `^${version}`;
}

/**
 * Detect the indentation used by an existing package.json source string so
 * that the rewritten file preserves the project's formatting.
 *
 * @param {string} source - Raw package.json file contents.
 * @returns {string|number} The indent to hand to JSON.stringify.
 */
function detectIndent(source) {
    const match = source.match(/^[ \t]+(?=["{[])/m);
    if (!match) {
        return 4;
    }

    const indent = match[0];
    return indent.includes("\t") ? "\t" : indent.length;
}

/**
 * Apply a set of dependency updates to a workspace package's package.json on
 * disk. Only the relevant dependency/devDependency entry for each selected
 * package is touched; the rest of the file (including formatting and key
 * order) is preserved.
 *
 * @param {string} wsDir - Absolute path to the workspace package directory.
 * @param {Array} packages - Selected package summaries to apply. Each must
 *                           have `moduleName`, `latest` and `devDependency`.
 * @param {boolean} saveExact - Whether to pin exact versions.
 * @returns {string[]} The list of `name@range` strings that were written.
 */
export function applyUpdatesToPackageJson(wsDir, packages, saveExact) {
    if (!packages || packages.length === 0) {
        return [];
    }

    const pkgPath = join(wsDir, "package.json");
    const source = readFileSync(pkgPath, "utf8");
    const indent = detectIndent(source);
    const pkg = JSON.parse(source);

    const written = [];

    for (const entry of packages) {
        const bucket = entry.devDependency ? "devDependencies" : "dependencies";

        if (!pkg[bucket]) {
            pkg[bucket] = {};
        }

        // If the package somehow lives in the opposite bucket already, update
        // it there instead of creating a duplicate entry.
        const otherBucket = entry.devDependency
            ? "dependencies"
            : "devDependencies";
        const targetBucket =
            pkg[otherBucket] &&
            Object.hasOwn(pkg[otherBucket], entry.moduleName)
                ? otherBucket
                : bucket;

        const range = versionRange(
            entry.latest,
            saveExact,
            pkg[targetBucket][entry.moduleName],
        );
        pkg[targetBucket][entry.moduleName] = range;

        written.push(`${entry.moduleName}@${range}`);
    }

    const trailingNewline = source.endsWith("\n") ? "\n" : "";
    writeFileSync(
        pkgPath,
        JSON.stringify(pkg, null, indent) + trailingNewline,
        "utf8",
    );

    return written;
}
