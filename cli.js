#!/usr/bin/env node
const { build, auto_detect } = require('./builder');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const { table } = require('table');
const { exec } = require('child_process');
const { randomAddress } = require('./utils');
const { deploy } = require('./utils');

function visualize(results) {
    let data = [[
        "File",
        "Contract Name",
        "Functions Can Get Fuzzed"
    ]];
    if (!(results.length > 0 && results[0].success)) {
        console.error("Build failed!");
        return;
    }
    let result = results[0]
    for (let contract_file_name of Object.keys(result.abi)) {
        let contract = result.abi[contract_file_name];
        for (let name of Object.keys(contract)) {
            let abis = contract[name];
            if (name === "FuzzLand" || name.includes("Scribble")) {
                continue
            }
            let abi_count = abis.filter(x => x.type === "function").length;
            data.push([contract_file_name, name, abi_count]);
        }
    }

    console.log(table(data))
}

async function build_with_autodetect(project, projectType, compiler_version, daemon, autoStart, setupFile) {

    if (!projectType) {
        projectType = await auto_detect(project);
    }

    let results = await build(projectType, project, compiler_version);

    if (!Array.isArray(results)) {
        results = [results];
    }

    let anvil = null;

    if (!setupFile) {
        console.log("Starting anvil...");
        anvil = exec('anvil');

        process.on('SIGINT', () => {
            anvil.kill();
        });

        let offchainConfig = results.reduce((acc, item) => {
            const deepClonedItem = JSON.parse(JSON.stringify(item.abi));
            return { ...acc, ...deepClonedItem };
        }, {});

        for (const fileName in offchainConfig) {
            for (const contractName in offchainConfig[fileName]) {
                offchainConfig[fileName][contractName] = {
                    "address": randomAddress(),
                    "constructor_args": "0x"
                }
            }
        }

        fs.writeFileSync("offchain_config.json", JSON.stringify(offchainConfig, null, 4));

        console.log("Offchain config written to offchain_config.json, please edit it to specify the addresses of the contracts and press enter to continue");

        await new Promise((resolve) => {
            process.stdin.once('data', (chunk) => {
                resolve();
            });
        });

        let artifacts = await deploy(results, offchainConfig);

        for (const artifact of artifacts) {
            for (const fileName in artifact["address"]) {
                for (const contractName in artifact["address"][fileName]) {
                    if (offchainConfig.hasOwnProperty(fileName) && offchainConfig[fileName].hasOwnProperty(contractName) && artifact["address"][fileName][contractName]) {
                        offchainConfig[fileName][contractName]["address"] = artifact["address"][fileName][contractName];
                    }
                }
            }
        }
    }

    fs.writeFileSync("results.json", JSON.stringify(results, null, 4));
    visualize(results);
    console.log("Results written to results.json");

    if (autoStart) {
        let command = "";
        if (setupFile) {
            command = `ityfuzz evm --builder-artifacts-file ./results.json -t "a" --work-dir ./workdir --setup-file ${setupFile}`;
        } else {
            command = `ityfuzz evm --builder-artifacts-file ./results.json --offchain-config-file ./offchain_config.json -f -t "a" --work-dir ./workdir`;
        }
        console.log(`Starting ityfuzz with command: ${command}`);
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`error: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`stderr: ${stderr}`);
                return;
            }
            console.log(`stdout: ${stdout}`);
        });
    }

    if (daemon) {
        await new Promise(() => { });
    }

    if (!setupFile) {
        anvil.kill();
    }
}

const argv = yargs(hideBin(process.argv))
    .command(
        '$0 <project>',
        'Build a project',
        (yargs) => {
            yargs.positional('project', {
                describe: 'Name of the project to build',
                type: 'string',
            });
        },
        async (argv) => {
            if (argv.project) {
                await build_with_autodetect(argv.project, argv.projectType, argv.compilerVersion, argv.daemon, argv.autoStart, argv.setupFile);
            }
        }
    )
    .option('project-type', {
        alias: 't',
        type: 'string',
        description: 'Type of the project',
    })
    .option('compiler-version', {
        alias: 'c',
        type: 'string',
        description: 'Specify the compiler version to use',
    })
    .option('daemon', {
        alias: 'd',
        type: 'boolean',
        description: 'Run in daemon mode',
    })
    .option('auto-start', {
        alias: 's',
        type: 'boolean',
        description: 'Automatically run ityfuzz after building',
    })
    .option('setup-file', {
        alias: 'f',
        type: 'string',
        description: 'Specify the setup file to use',
    })
    .demandOption(['project'], 'Please provide the project argument to proceed')
    .help()
    .argv;
