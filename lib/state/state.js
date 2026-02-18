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
