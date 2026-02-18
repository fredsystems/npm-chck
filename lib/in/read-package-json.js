import { readFileSync } from "node:fs";

function readPackageJson(filename) {
    let pkg;
    let error;
    try {
        pkg = JSON.parse(readFileSync(filename, "utf8"));
    } catch (e) {
        if (e.code === "MODULE_NOT_FOUND" || e.code === "ENOENT") {
            error = new Error(`A package.json was not found at ${filename}`);
        } else {
            error = new Error(
                `A package.json was found at ${filename}, but it is not valid.`,
            );
        }
    }
    return { devDependencies: {}, dependencies: {}, error, ...pkg };
}

export default readPackageJson;
