import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
 * Read and parse a package.json, returning null when it is missing or invalid.
 */
function tryReadPackageJson(dir) {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) {
        return null;
    }

    try {
        return JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
        return null;
    }
}

/**
 * Extract the workspace glob patterns declared by a directory, from either
 * package.json (`workspaces`) or pnpm-workspace.yaml (`packages`).
 *
 * @param {string} cwd
 * @returns {string[] | null} Glob patterns, or null when `cwd` declares none.
 */
function readWorkspacePatterns(cwd) {
    const rootPkg = tryReadPackageJson(cwd);

    if (rootPkg) {
        if (Array.isArray(rootPkg.workspaces)) {
            // Standard format: "workspaces": ["packages/*", ...]
            return rootPkg.workspaces;
        }

        if (Array.isArray(rootPkg.workspaces?.packages)) {
            // Yarn nohoist format: "workspaces": { "packages": [...], "nohoist": [...] }
            return rootPkg.workspaces.packages;
        }
    }

    return parsePnpmWorkspaceYaml(cwd);
}

/**
 * Return true when a package.json declares dependencies of its own (as opposed
 * to a "bare" workspace root that only exists to hold the `workspaces` field).
 */
function hasOwnDependencies(pkg) {
    if (!pkg) {
        return false;
    }

    const depCount =
        Object.keys(pkg.dependencies ?? {}).length +
        Object.keys(pkg.devDependencies ?? {}).length +
        Object.keys(pkg.optionalDependencies ?? {}).length;

    return depCount > 0;
}

/**
 * Discover workspace package directories from a workspace root.
 *
 * Supports:
 *   - npm / yarn workspaces: `workspaces` array or `workspaces.packages` array in package.json
 *   - pnpm workspaces: `packages` list in pnpm-workspace.yaml
 *
 * The workspace root itself is included (first) when it declares dependencies
 * of its own, because those need checking just as much as the members' do. A
 * bare root that only carries the `workspaces` field is left out since it has
 * nothing to check.
 *
 * @param {string} rootCwd - Absolute path to the workspace root directory.
 * @param {object} [options]
 * @param {boolean} [options.includeRoot=true] - Include the root package when
 *        it has dependencies of its own.
 * @returns {string[] | null} Array of absolute paths to workspace package directories,
 *                            or null if no workspace configuration was found.
 */
export function getWorkspacePackages(rootCwd, { includeRoot = true } = {}) {
    const patterns = readWorkspacePatterns(rootCwd);

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

    const memberDirs = pkgJsonPaths.map((p) =>
        resolve(rootCwd, p.replace(/[/\\]package\.json$/, "")),
    );

    const root = resolve(rootCwd);
    const dirs = memberDirs.filter((dir) => dir !== root);

    if (includeRoot && hasOwnDependencies(tryReadPackageJson(root))) {
        dirs.unshift(root);
    }

    return dirs.length > 0 ? dirs : null;
}

/**
 * Workspace member directories relative to the root, e.g. `["packages/a"]`.
 * Used to keep the root package's unused-dependency scan from walking into
 * member packages (their code must not justify the root's dependencies).
 *
 * @param {string} rootCwd
 * @returns {string[]}
 */
export function getWorkspaceMemberPatterns(rootCwd) {
    const patterns = readWorkspacePatterns(rootCwd);
    return patterns ? [...patterns] : [];
}

/**
 * The `name` of every local package in the workspace (root included).
 *
 * A dependency on one of these names is satisfied by a symlink to a sibling
 * directory rather than by the registry, so it must not be looked up remotely —
 * doing so reports a bogus "could not be found" registry error for every
 * internal package.
 *
 * @param {string} rootCwd - Absolute path to the workspace root directory.
 * @returns {string[]} Package names, possibly empty.
 */
export function getWorkspacePackageNames(rootCwd) {
    const dirs = getWorkspacePackages(rootCwd, { includeRoot: false }) ?? [];
    const names = new Set();

    const rootPkg = tryReadPackageJson(resolve(rootCwd));
    if (rootPkg?.name) {
        names.add(rootPkg.name);
    }

    for (const dir of dirs) {
        const pkg = tryReadPackageJson(dir);
        if (pkg?.name) {
            names.add(pkg.name);
        }
    }

    return [...names];
}

/**
 * Return true if the given directory declares a workspace configuration, i.e.
 * it is the root of an npm/yarn/pnpm monorepo.
 *
 * Note this says nothing about whether the root has dependencies of its own: a
 * root that also carries its own `devDependencies` (a very common layout) is
 * still a workspace root, and its members still need checking.
 *
 * @param {string} cwd - Directory to inspect.
 * @returns {boolean}
 */
export function isWorkspaceRoot(cwd) {
    const patterns = readWorkspacePatterns(cwd);
    return Boolean(patterns && patterns.length > 0);
}

/**
 * Walk up from `cwd` looking for the nearest enclosing workspace root.
 *
 * Lets a run targeted at a single member directory still recognise its sibling
 * packages as local links instead of missing registry packages.
 *
 * @param {string} cwd - Directory to start from (inclusive).
 * @returns {string | null} Absolute path to the workspace root, or null.
 */
export function findWorkspaceRoot(cwd) {
    let current = resolve(cwd);

    for (;;) {
        if (isWorkspaceRoot(current)) {
            return current;
        }

        const parent = dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}
