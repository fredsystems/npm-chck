import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { globbySync } from "globby";

/**
 * Parse pnpm-workspace.yaml using a simple line-by-line parser.
 * Avoids adding a yaml dependency for this straightforward format.
 * Returns an array of glob patterns, or null if the file is not found.
 */
function parsePnpmWorkspaceYaml(cwd) {
    const filePath = join(cwd, "pnpm-workspace.yaml");
    if (!existsSync(filePath)) {
        return null;
    }

    const content = readFileSync(filePath, "utf8");
    const patterns = [];
    let inPackages = false;

    for (const line of content.split("\n")) {
        // Detect the start of the 'packages:' key
        if (/^packages\s*:/.test(line)) {
            inPackages = true;
            continue;
        }

        if (inPackages) {
            // Match list items: "  - 'pattern'" or '  - "pattern"' or "  - pattern"
            const match = line.match(
                /^\s+-\s+['"]?([^'"#\r\n]+?)['"]?\s*(?:#.*)?$/,
            );
            if (match) {
                patterns.push(match[1].trim());
            } else if (/^\S/.test(line) && line.trim().length > 0) {
                // A non-indented, non-empty line means we've left the packages block
                break;
            }
        }
    }

    return patterns.length > 0 ? patterns : null;
}

/**
 * Discover workspace package directories from a workspace root.
 *
 * Supports:
 *   - npm / yarn workspaces: `workspaces` array or `workspaces.packages` array in package.json
 *   - pnpm workspaces: `packages` list in pnpm-workspace.yaml
 *
 * @param {string} rootCwd - Absolute path to the workspace root directory.
 * @returns {string[] | null} Array of absolute paths to workspace package directories,
 *                            or null if no workspace configuration was found.
 */
export function getWorkspacePackages(rootCwd) {
    let patterns = null;

    // --- npm / yarn: read workspaces from package.json ---
    const rootPkgPath = join(rootCwd, "package.json");
    if (existsSync(rootPkgPath)) {
        try {
            const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));

            if (Array.isArray(rootPkg.workspaces)) {
                // Standard format: "workspaces": ["packages/*", ...]
                patterns = rootPkg.workspaces;
            } else if (
                rootPkg.workspaces &&
                Array.isArray(rootPkg.workspaces.packages)
            ) {
                // Yarn nohoist format: "workspaces": { "packages": ["packages/*"], "nohoist": [...] }
                patterns = rootPkg.workspaces.packages;
            }
        } catch {
            // Malformed package.json – skip and try pnpm
        }
    }

    // --- pnpm: read workspaces from pnpm-workspace.yaml ---
    if (!patterns) {
        patterns = parsePnpmWorkspaceYaml(rootCwd);
    }

    if (!patterns || patterns.length === 0) {
        return null;
    }

    // Expand each workspace glob pattern by looking for package.json files inside
    // (this naturally filters out non-package directories and handles both plain
    // paths like "acarshub-types" and globs like "packages/*")
    const pkgJsonPaths = globbySync(
        patterns.map((p) => `${p}/package.json`),
        {
            cwd: rootCwd,
            absolute: false,
            dot: false,
        },
    );

    if (pkgJsonPaths.length === 0) {
        return null;
    }

    return pkgJsonPaths.map((p) =>
        resolve(rootCwd, p.replace(/[/\\]package\.json$/, "")),
    );
}

/**
 * Return true if the given directory is the root of a workspace (i.e. it
 * contains workspace configuration) AND it has no direct dependencies of its
 * own.  This is used for auto-detection so that running `npm-chck` inside a
 * bare workspace root "just works".
 *
 * @param {string} cwd - Directory to inspect.
 * @returns {boolean}
 */
export function isBareworkspaceRoot(cwd) {
    const pkgPath = join(cwd, "package.json");
    if (!existsSync(pkgPath)) {
        return false;
    }

    try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        const hasWorkspaces =
            Array.isArray(pkg.workspaces) ||
            Array.isArray(pkg.workspaces?.packages);
        const hasPnpmWorkspaces = existsSync(join(cwd, "pnpm-workspace.yaml"));

        if (!hasWorkspaces && !hasPnpmWorkspaces) {
            return false;
        }

        const depCount =
            Object.keys(pkg.dependencies ?? {}).length +
            Object.keys(pkg.devDependencies ?? {}).length;

        return depCount === 0;
    } catch {
        return false;
    }
}
