import chalk from "chalk";

function debug(...args) {
    console.log(chalk.green("[npm-chck] debug"));
    console.log(...args);
    console.log(`${chalk.green("===============================")}`);
}

export default debug;
