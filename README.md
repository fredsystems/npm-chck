# npm-chck

> Check for outdated, incorrect, and unused dependencies.

## Fork Notice

This project is a fork of [npm-check](https://github.com/dylang/npm-check) by Dylan Greene, renamed to `npm-chck` to avoid npm publishing name collisions.

<img width="796" alt="npm-chck -u" src="https://cloud.githubusercontent.com/assets/51505/9569917/96947fea-4f48-11e5-9783-2d78077256f2.png">

## Features

- Tells you what's out of date.
- Provides a link to the package's documentation so you can decide if you want the update.
- Kindly informs you if a dependency is not being used in your code.
- Works on your globally installed packages too, via `-g`.
- **Interactive Update** for less typing and fewer typos, via `-u`.
- Supports public and private [@scoped/packages](https://docs.npmjs.com/getting-started/scoped-packages).
- Supports ES6-style [`import from`](http://exploringjs.com/es6/ch_modules.html) syntax.
- Upgrades your modules using your installed version of npm, including the new `npm@3`, so dependencies go where you expect them.
- Works with any public npm registry, [private registries](https://www.npmjs.com/enterprise), and alternate registries like [Sinopia](https://github.com/rlidwka/sinopia).
- Does not query registries for packages with `private: true` in their package.json.
- Emoji in a command-line app, because command-line apps can be fun too.
- Works with `npm@2` and `npm@3`, as well as newer alternative installers like `ied` and `pnpm`.

### Requirements

- Node >= 10.9.0

### On the command line

This is the easiest way to use `npm-chck`.

### Install

```bash
npm install -g npm-chck
```

### Use

```bash
npm-chck
```

<img width="882" alt="npm-chck" src="https://cloud.githubusercontent.com/assets/51505/9569919/99c2412a-4f48-11e5-8c65-e9b6530ee991.png">

The result should look like the screenshot, or something nice when your packages are all up-to-date and in use.

When updates are required it will return a non-zero response code that you can use in your CI tools.

### Options

```text
Usage
  $ npm-chck <path> <options>

Path
  Where to check. Defaults to current directory. Use -g for checking global modules.

Options
  -u, --update          Interactive update.
  -y, --update-all      Uninteractive update. Apply all updates without prompting.
  -g, --global          Look at global modules.
  -s, --skip-unused     Skip check for unused packages.
  -p, --production      Skip devDependencies.
  -d, --dev-only        Look at devDependencies only (skip dependencies).
  -i, --ignore          Ignore dependencies based on succeeding glob.
  -E, --save-exact      Save exact version (x.y.z) instead of caret (^x.y.z) in package.json.
  --specials            List of depcheck specials to include in check for unused dependencies.
  --no-color            Force or disable color output.
  --no-emoji            Remove emoji support. No emoji in default in CI environments.
  --debug               Show debug output. Throw in a gist when creating issues on github.

Examples
  $ npm-chck           # See what can be updated, what isn't being used.
  $ npm-chck ../foo    # Check another path.
  $ npm-chck -gu       # Update globally installed modules by picking which ones to upgrade.
```

![npm-chck-u](https://cloud.githubusercontent.com/assets/51505/9569912/8c600cd8-4f48-11e5-8757-9387a7a21316.gif)

#### `-u, --update`

Show an interactive UI for choosing which modules to update.

Automatically updates versions referenced in the `package.json`.

_Based on recommendations from the `npm` team, `npm-chck` only updates using `npm install`, not `npm update`.
To avoid using more than one version of `npm` in one directory, `npm-chck` will automatically install updated modules
using the version of `npm` installed globally._

<img width="669" alt="npm-chck -g -u" src="https://cloud.githubusercontent.com/assets/51505/9569921/9ca3aeb0-4f48-11e5-95ab-6fdb88124007.png">

##### Update using [ied](https://github.com/alexanderGugel/ied) or [pnpm](https://github.com/rstacruz/pnpm)

Set environment variable `NPM_CHECK_INSTALLER` to the name of the installer you wish to use.

```bash
NPM_CHECK_INSTALLER=pnpm npm-chck -u
## pnpm install --save-dev foo@version --color=always
```

You can also use this for dry-run testing:

```bash
NPM_CHECK_INSTALLER=echo npm-chck -u
```

#### `-y, --update-all`

Updates your dependencies like `--update`, just without any prompt. This is especially useful if you want to automate your dependency updates with `npm-chck`.

#### `-g, --global`

Check the versions of your globally installed packages.

If the value of `process.env.NODE_PATH` is set, it will override the default path of global node_modules returned by package [`global-modules`](https://www.npmjs.com/package/global-modules).

_Tip: Use `npm-chck -u -g` to do a safe interactive update of global modules, including npm itself._

#### `-s, --skip-unused`

By default `npm-chck` will let you know if any of your modules are not being used by looking at `require` statements
in your code.

This option will skip that check.

This is enabled by default when using `global` or `update`.

#### `-p, --production`

By default `npm-chck` will look at packages listed as `dependencies` and `devDependencies`.

This option will let it ignore outdated and unused checks for packages listed as `devDependencies`.

#### `-d, --dev-only`

Ignore `dependencies` and only check `devDependencies`.

This option will let it ignore outdated and unused checks for packages listed as `dependencies`.

#### `-i, --ignore`

Ignore dependencies that match specified glob.

`$ npm-chck -i babel-*` will ignore all dependencies starting with 'babel-'.

#### `-E, --save-exact`

Install packages using `--save-exact`, meaning exact versions will be saved in package.json.

Applies to both `dependencies` and `devDependencies`.

#### `--specials`

Check special (e.g. config) files when looking for unused dependencies.

`$ npm-chck --specials=bin,webpack` will look in the `scripts` section of package.json and in webpack config.

See [https://github.com/depcheck/depcheck#special](https://github.com/depcheck/depcheck#special) for more information.

#### `--color, --no-color`

Enable or disable color support.

By default `npm-chck` uses colors if they are available.

#### `--emoji, --no-emoji`

Enable or disable emoji support. Useful for terminals that don't support them. Automatically disabled in CI servers.

#### `--spinner, --no-spinner`

Enable or disable the spinner. Useful for terminals that don't support them. Automatically disabled in CI servers.

### API

The API is here in case you want to wrap this with your CI toolset.

```js
const npmCheck = require("npm-chck");

npmCheck(options).then((currentState) =>
  console.log(currentState.get("packages")),
);
```

#### `update`

- Interactive update.
- default is `false`

#### `global`

- Check global modules.
- default is `false`
- `cwd` is automatically set with this option.

#### `skipUnused`

- Skip checking for unused packages.
- default is `false`

#### `ignoreDev`

- Ignore `devDependencies`.
- This is called `--production` on the command line to match `npm`.
- default is `false`

#### `devOnly`

- Ignore `dependencies` and only check `devDependencies`.
- default is `false`

#### `ignore`

- Ignore dependencies that match specified glob.
- default is `[]`

#### `saveExact`

- Update package.json with exact version `x.y.z` instead of semver range `^x.y.z`.
- default is `false`

#### `debug`

- Show debug output. Throw in a gist when creating issues on github.
- default is `false`

#### `cwd`

- Override where `npm-chck` checks.
- default is `process.cwd()`

#### `specials`

- List of [`depcheck`](https://github.com/depcheck/depcheck) special parsers to include.
- default is `''`

#### `currentState`

The result of the promise is a `currentState` object, look in [state.js](lib/state/state.js) to see how it works.

You will probably want `currentState.get('packages')` to get an array of packages and the state of each of them.

Each item in the array will look like the following:

```js
{
  moduleName: 'lodash',                 // name of the module.
  homepage: 'https://lodash.com/',      // url to the home page.
  regError: undefined,                  // error communicating with the registry
  pkgError: undefined,                  // error reading the package.json
  latest: '4.7.0',                      // latest according to the registry.
  installed: '4.6.1',                   // version installed
  isInstalled: true,                    // Is it installed?
  notInstalled: false,                  // Is it installed?
  packageWanted: '4.7.0',               // Requested version from the package.json.
  packageJson: '^4.6.1',                // Version or range requested in the parent package.json.
  devDependency: false,                 // Is this a devDependency?
  usedInScripts: undefined,             // Array of `scripts` in package.json that use this module.
  mismatch: false,                      // Does the version installed not match the range in package.json?
  semverValid: '4.6.1',                 // Is the installed version valid semver?
  easyUpgrade: true,                    // Will running just `npm install` upgrade the module?
  bump: 'minor',                        // What kind of bump is required to get the latest, such as patch, minor, major.
  unused: false                         // Is this module used in the code?
},
```

You will also see this if you use `--debug` on the command line.

### RC File Support

Additional options can be sent to the depcheck process. See [depcheck API](https://github.com/depcheck/depcheck#api). Create a .npmcheckrc{.json,.yml,.js} file and set the depcheck options under depcheck property.

For example, to skip packages for unused check, but still want them in the outdated check (so can't use the --ignore option):

```yaml
# .npmcheckrc

depcheck:
  ignoreMatches: ["replace-in-file", "snyk", "sonarqube-scanner"]
```

### Inspiration

- [npm outdated](https://docs.npmjs.com/cli/v7/commands/npm-outdated) - awkward output, requires --depth=0 to be grokable.
- [david](https://github.com/alanshaw/david) - does not work with private registries.
- [update-notifier](https://github.com/yeoman/update-notifier) - for single modules, not everything in package.json.
- [depcheck](https://github.com/depcheck/depcheck) - only part of the puzzle. npm-chck uses depcheck.

### License

Copyright (c) 2016 Dylan Greene, contributors.
Copyright (c) 2026 Fred Clausen, contributors.

Released under the [MIT license](https://tldrlegal.com/license/mit-license).

Screenshots are [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/) (Attribution-ShareAlike).
