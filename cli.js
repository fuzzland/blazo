#!/usr/bin/env node
const { build, auto_detect } = require('./builder');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const { table } = require('table');
const { exec, spawn } = require('child_process');
const { randomAddress } = require('./utils');
const { deploy } = require('./utils');
const { handleBuildCoverage } = require('./coverage');
const { createOffchain, createOnchain } = require('./task');

function visualize(results) {
    let data = [['File', 'Contract Name', 'Functions Can Get Fuzzed']];
    if (!(results.length > 0 && results[0].success)) {
        console.error('Build failed!');
        return;
    }
    let result = results[0];
    for (let contract_file_name of Object.keys(result.abi)) {
        if (contract_file_name.startsWith("lib/")) {
            continue;
        }

        let contract = result.abi[contract_file_name];
        for (let name of Object.keys(contract)) {
            let abis = contract[name];
            if (name === 'FuzzLand' || name.includes('Scribble')) {
                continue;
            }
            let abi_count = abis.filter((x) => x.type === 'function').length;
            data.push([contract_file_name, name, abi_count]);
        }
    }

    console.log(table(data));
}

function executeCommand(command, options, onExit, isPrint) {
    if (isPrint) {
        const [cmd, ...args] = command.split(' ');
        const childProcess = spawn(cmd, args, options);

        childProcess.stdout.on('data', (data) => {
            console.log(`${data}`);
        });

        childProcess.stderr.on('data', (data) => {
            console.error(`${data}`);
        });

        childProcess.on('error', (error) => {
            console.error(`${error}`);
            process.exit(1);
        });

        childProcess.on('close', (code) => {
            onExit(code);
        });

        return childProcess;
    } else {
        const childProcess = exec(command, options, (error, stdout, stderr) => {
            if (error) {
                console.error(`error: ${error}`);
                // process.exit(1);
                // onExit(0);
            }
            if (stderr) {
                console.error(`stderr: ${stderr}`);
            }
            console.log(`${stdout}`);
            onExit(0); // Assuming success, you might want to adjust this based on your use case
        });
        process.on('SIGINT', () => {
            console.log('Received SIGINT. Terminating child process.');
            childProcess.kill('SIGINT');
        });

        return childProcess;
    }
}

async function build_with_autodetect(
    project,
    projectType,
    compiler_version,
    autoStart,
    setupFile,
    isPrint
) {
    if (!projectType) {
        projectType = await auto_detect(project);
    }

    let results = await build(projectType, project, compiler_version);

    if (!Array.isArray(results)) {
        results = [results];
    }

    if (!setupFile) {
        let offchainConfig = results.reduce((acc, item) => {
            const deepClonedItem = JSON.parse(JSON.stringify(item.abi));
            return { ...acc, ...deepClonedItem };
        }, {});

        for (const fileName in offchainConfig) {
            for (const contractName in offchainConfig[fileName]) {
                offchainConfig[fileName][contractName] = {
                    address: randomAddress(),
                    constructor_args: '0x',
                };
            }
        }

        fs.writeFileSync(
            'offchain_config.json',
            JSON.stringify(offchainConfig, null, 4)
        );

        console.log(
            'Offchain config written to offchain_config.json, please edit it to specify the addresses of the contracts.'
        );
    }

    fs.writeFileSync('results.json', JSON.stringify(results, null, 4));
    visualize(results);
    console.log(`Results written to results.json`);

    if (autoStart) {
        let command = '';

        if (setupFile) {
            command = `ityfuzz evm --builder-artifacts-file ./results.json -t "a" --work-dir ./workdir --setup-file ${setupFile}`;
        } else {
            command = `ityfuzz evm --builder-artifacts-file ./results.json --offchain-config-file ./offchain_config.json -f -t "a" --work-dir ./workdir`;
        }
        console.log(`Starting ityfuzz with command: ${command}`);

        handleBuildCoverage();

        // maxBuffer: 100MB
        const options = { maxBuffer: 1024 * 1024 * 100 };
        executeCommand(
            command,
            options,
            (code) => {
                console.log(`Child process exited with code ${code}`);
                process.exit();
            },
            isPrint
        );
    }

    if (!autoStart) {
        process.exit();
    }
}

const argv = yargs(hideBin(process.argv))
    .command(
        '$0 <project>',
        'Build a project',
        (yargs) => {
            yargs
                .positional('project', {
                    describe: 'Name of the project to build',
                    type: 'string',
                })
                .demandOption(
                    ['project'],
                    'Please provide the project argument to proceed'
                );
        },
        async (argv) => {
            if (argv.project) {
                await build_with_autodetect(
                    argv.project,
                    argv.projectType,
                    argv.compilerVersion,
                    argv.autoStart,
                    argv.setupFile,
                    argv.printing
                );
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
    .option('printing', {
        alias: 'p',
        type: 'boolean',
        description: 'Print the output in real-time if true',
        default: false,
    })
    .command(
        'create <type>',
        'Create a project type',
        (yargs) => {
            yargs
                .positional('type', {
                    describe:
                        'Type of the project to create (offchain/onchain)',
                    type: 'string',
                    choices: ['offchain', 'onchain'],
                })
                .option('contract-addresses', {
                    alias: 't',
                    type: 'string',
                    description:
                        'Contract addresses for onchain type (Multiple comma-separated)',
                })
                .option('chain', {
                    alias: 'n',
                    type: 'string',
                    description: 'Chain for onchain type (e.g., ETH)',
                })
                .option('block-number', {
                    alias: 'b',
                    type: 'number',
                    description: 'Block number for onchain type',
                })
                .option('project-type', {
                    alias: 'p',
                    type: 'string',
                    description: 'Type of the project for offchain',
                })
                .option('file', {
                    alias: 'f',
                    type: 'string',
                    description: 'File path for offchain',
                })
                .option('compiler-version', {
                    alias: 'c',
                    type: 'string',
                    description: 'Compiler version for offchain',
                });
        },
        async (argv) => {
            if (argv.type === 'onchain') {
                createOnchain(
                    argv.contractAddresses,
                    argv.chain,
                    argv.blockNumber
                );
            } else if (argv.type === 'offchain') {
                createOffchain(
                    argv.file,
                    argv.projectType,
                    argv.compilerVersion
                );
            }
        }
    )
    .help().argv;
