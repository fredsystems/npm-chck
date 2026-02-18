import ora from "ora";
import createPackageSummary from "./create-package-summary.js";
import getUnusedPackages from "./get-unused-packages.js";

export default async function npmCheck(currentState) {
    await getUnusedPackages(currentState);

    const spinner = ora(`Checking npm registries for updated packages.`);
    spinner.enabled = spinner.enabled && currentState.get("spinner");
    spinner.start();

    const cwdPackageJson = currentState.get("cwdPackageJson");

    function dependencies(pkg) {
        if (currentState.get("global")) {
            return currentState.get("globalPackages");
        }

        if (currentState.get("ignoreDev")) {
            return pkg.dependencies;
        }

        if (currentState.get("devOnly")) {
            return pkg.devDependencies;
        }

        return { ...pkg.dependencies, ...pkg.devDependencies };
    }

    const allDependencies = dependencies(cwdPackageJson);
    const allDependenciesIncludingMissing = Object.keys({
        ...allDependencies,
        ...currentState.get("missingFromPackageJson"),
    });

    const packageSummaries = allDependenciesIncludingMissing
        .map((moduleName) => createPackageSummary(moduleName, currentState))
        .filter(Boolean);

    const arrayOfPackageInfo = await Promise.all(packageSummaries);

    currentState.set("packages", arrayOfPackageInfo);

    spinner.stop();
    return currentState;
}
