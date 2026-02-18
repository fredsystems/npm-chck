import { resolve } from "node:path";
import { globbySync } from "globby";
import readPackageJson from "./read-package-json.js";

export default function getInstalledPackages(cwd) {
    const GLOBBY_PACKAGE_JSON = "{*/package.json,@*/*/package.json}";
    const installedPackages = globbySync(GLOBBY_PACKAGE_JSON, { cwd });

    return Object.fromEntries(
        installedPackages
            .map((pkgPath) => {
                const pkg = readPackageJson(resolve(cwd, pkgPath));
                return [pkg.name, pkg.version];
            })
            .filter(([name]) => Boolean(name)),
    );
}
