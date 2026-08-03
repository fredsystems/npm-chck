import debug from "./debug.js";
import init from "./init.js";

const defaultOptions = {
    update: false,
    updateAll: false,
    global: false,
    cwd: process.cwd(),
    skipUnused: false,

    ignoreDev: false,
    devOnly: false,
    forceColor: false,
    saveExact: false,
    specials: "",
    debug: false,
    emoji: true,
    spinner: false,
    installer: "npm",
    ignore: [],

    // Names of the sibling packages in the enclosing workspace, if any. These
    // resolve to local symlinks and must be skipped during registry lookups.
    workspacePackageNames: [],
    // Paths the unused-dependency scan must not walk into. Used to stop a
    // workspace root's scan from reaching into its member packages.
    depcheckIgnorePatterns: [],

    globalPackages: {},
    cwdPackageJson: { devDependencies: {}, dependencies: {} },

    packages: false,
    unusedDependencies: false,
    missingFromPackageJson: {},
};

function state(userOptions) {
    const currentStateObject = { ...defaultOptions };

    function get(key) {
        if (!Object.hasOwn(currentStateObject, key)) {
            throw new Error(`Can't get unknown option "${key}".`);
        }
        return currentStateObject[key];
    }

    function set(key, value) {
        if (get("debug")) {
            debug("set key", key, "to value", value);
        }

        if (Object.hasOwn(currentStateObject, key)) {
            currentStateObject[key] = value;
        } else {
            throw new Error(
                `unknown option "${key}" setting to "${JSON.stringify(value, false, 4)}".`,
            );
        }
    }

    function inspectIfDebugMode() {
        if (get("debug")) {
            inspect();
        }
    }

    function inspect() {
        debug("current state", all());
    }

    function all() {
        return currentStateObject;
    }

    const currentState = {
        get,
        set,
        all,
        inspectIfDebugMode,
    };

    return init(currentState, userOptions);
}

export default state;
