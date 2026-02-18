import { parse as parseGitUrl } from "giturl";

function bestGuessHomepage(data) {
    if (!data) {
        return false;
    }

    const packageDataForLatest = data.versions[data["dist-tags"].latest];

    return (
        packageDataForLatest.homepage ||
        (packageDataForLatest.bugs?.url &&
            parseGitUrl(packageDataForLatest.bugs.url.trim())) ||
        (packageDataForLatest.repository?.url &&
            parseGitUrl(packageDataForLatest.repository.url.trim()))
    );
}

export default bestGuessHomepage;
