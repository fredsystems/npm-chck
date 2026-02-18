import { cpus } from "node:os";
import _ from "lodash";
import packageJson from "package-json";
import semver from "semver";
import throat from "throat";
import bestGuessHomepage from "./best-guess-homepage.js";

const cpuCount = cpus().length;
const throttle = throat(cpuCount);

function getNpmInfo(packageName) {
    return throttle(() =>
        packageJson(packageName, { fullMetadata: true, allVersions: true }),
    )
        .then((rawData) => {
            const CRAZY_HIGH_SEMVER = "8000.0.0";

            const sortedVersions = _(rawData.versions)
                .keys()
                .remove(_.partial(semver.gt, CRAZY_HIGH_SEMVER))
                .sort(semver.compare)
                .valueOf();

            const latest = rawData["dist-tags"].latest;
            const next = rawData["dist-tags"].next;
            const latestStableRelease = semver.satisfies(latest, "*")
                ? latest
                : semver.maxSatisfying(sortedVersions, "*");
            return {
                latest: latestStableRelease,
                next: next,
                versions: sortedVersions,
                homepage: bestGuessHomepage(rawData),
            };
        })
        .catch((err) => {
            const errorMessage = `Registry error ${err.message}`;
            return {
                error: errorMessage,
            };
        });
}

export default getNpmInfo;
