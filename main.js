import * as fs from "fs";
import Axios from "axios";
import { ArgumentParser } from "argparse";
import { createObjectCsvWriter } from "csv-writer";
import { printTable } from "console-table-printer";
import * as cliProgress from "cli-progress";
const groupBy = (items, key) => items.reduce((result, item) => ({
    ...result,
    [item[key]]: [...(result[item[key]] || []), item],
}), {});
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function tryUntilSucceed(func, delay = 100) {
    let result = null;
    let succeeded = false;
    while (!succeeded) {
        try {
            result = await func();
            succeeded = true;
        }
        catch { }
        await sleep(delay);
    }
    return result;
}
async function getTokensAmount(wallets, apiKey) {
    const results = new Map();
    for (const address of wallets) {
        console.log(`Processing Address: ${address}`);
        const url = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=0&endblock=999999999&sort=asc&apikey=${apiKey}`;
        const response = await tryUntilSucceed(() => Axios.get(url));
        console.log("Fetched transactios");
        const values = response["data"]["result"];
        const contracts = new Map();
        for (let val of values) {
            contracts.set(val["tokenSymbol"], [
                val["contractAddress"],
                Number(val["tokenDecimal"]),
            ]);
        }
        const bar = new cliProgress.SingleBar();
        bar.start(contracts.size);
        for (let contractData of contracts.entries()) {
            const contract = contractData[1][0];
            const contractUrl = `https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${contract}&address=${address}&tag=latest&apikey=${apiKey}`;
            const response = await tryUntilSucceed(() => Axios.get(contractUrl));
            const total = Number(response["data"]["result"]);
            if (!results.has(contractData[0])) {
                results.set(contractData[0], 0);
            }
            results.set(contractData[0], results.get(contractData[0]) + total * Math.pow(10, -contractData[1][1]));
            bar.increment();
        }
        bar.stop();
        await sleep(200);
        console.log(results);
    }
    return [...results.entries()].filter((x) => x[1] > 0);
}
function main() {
    const parser = new ArgumentParser({
        description: "Computes amount owned by a collection of wallets.",
    });
    parser.addArgument("--addressedFileName", {
        type: String,
        defaultValue: "wallets.txt",
        help: "File name containing the wallets to analyze. Addresses must be separated by a new line.",
    });
    parser.addArgument("--apiKey", {
        type: String,
        defaultValue: "G35B6KXU5MTS3CQ92MZG5NF2SJ5R1AEVN8",
    });
    parser.addArgument("--summaryFile", {
        type: String,
        defaultValue: "summary.csv",
        help: "File where results will be saved in CSV format.",
    });
    parser.addArgument("--sortBy", {
        defult: "amount",
        type: String,
        choices: ["symbol", "amount"],
        help: "Whether to sort the result according to the symbol (alphabetically) or the amount (ascending).",
    });
    const args = parser.parseArgs();
    console.log(args);
    const addresses = fs
        .readFileSync(args.addressedFileName, { encoding: "utf8", flag: "r" })
        .split("\n")
        .filter((x) => x.length > 0);
    getTokensAmount(addresses, args.apiKey)
        .then((transactions) => {
        const key = { symbol: 0, amount: 1 }[args.sortBy];
        const result = transactions
            .sort((x, y) => (x[key] > y[key] ? 1 : -1))
            .map((x) => {
            return { Symbol: x[0], Amount: x[1] };
        });
        printTable(result);
        const csvWriter = createObjectCsvWriter({
            path: args.summaryFile,
            header: [
                { id: "Symbol", title: "Symbol" },
                { id: "Value", title: "Value" },
            ],
        });
        csvWriter
            .writeRecords(result)
            .then(() => console.log("Successfully written CSV summary."))
            .catch(() => console.log("Write Error"));
    })
        .catch(console.log);
}
main();
