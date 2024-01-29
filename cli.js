#!/usr/bin/env node
const { build, auto_detect } = require('./builder');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const { table } = require('table');
const { exec, spawn } = require('child_process');
const { randomAddress, getAPIKey } = require('./utils');
const { handleBuildCoverage } = require('./coverage');
const { createOffchain, createOnchain } = require('./task');
const inquirer = require('inquirer');

function visualize(results) {
    let data = [['File', 'Contract Name', 'Functions Can Get Fuzzed']];
    if (!(results.length > 0 && results[0].success)) {
        console.error('Build failed!');
        return;
    }
    let result = results[0];
    for (let contract_file_name of Object.keys(result.abi)) {
        if (contract_file_name.startsWith('lib/')) {
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

// TODO: when process exit or timeout, create offchain task and update TaskResult
function startFuzzWithSetupFile(setupFile, isPrint) {
    const options = { maxBuffer: 1024 * 1024 * 100 };
    const command = `ityfuzz evm --builder-artifacts-file ./results.json -t "a" --work-dir ./workdir --setup-file ${setupFile}`;
    executeCommand(
        command,
        options,
        (code) => {
            console.log(`Child process exited with code ${code}`);
            handleBuildCoverage();
            process.exit();
        },
        isPrint
    );
}

// TODO: when process exit or timeout, create offchain task and update TaskResult
function startFuzzWithOffchainConfig(configFile, isPrint) {
    const options = { maxBuffer: 1024 * 1024 * 100 };
    const command = `ityfuzz evm --builder-artifacts-file ./results.json --offchain-config-file ${configFile} -f -t "a" --work-dir ./workdir`;
    executeCommand(
        command,
        options,
        (code) => {
            console.log(`Child process exited with code ${code}`);
            handleBuildCoverage();
            process.exit();
        },
        isPrint
    );
}

// TODO: start blaz service(create task, update taskResult)
function startBlaz() {
    //
}

async function build_with_autodetect(
    project,
    projectType,
    compiler_version,
    autoStart,
    setupFile,
    offchainConfig,
    isPrint,
    blaz
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
    } else {
        startFuzzWithSetupFile(setupFile, isPrint);
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

    // No setup file/offchain config
    if (!setupFile && !offchainConfig) {
        const { choice } = await inquirer.prompt({
            type: 'list',
            name: 'choice',
            message: 'Please select the option you want to use:',
            choices: ['Setup File', 'Offchain Config'],
        });

        if (choice === 'Setup File') {
            console.log('Setup File');
            const { setup_file_path } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'file_path',
                    message: 'Input setup file:',
                },
            ]);
            startFuzzWithSetupFile(setup_file_path, isPrint);
        } else if (choice === 'Offchain Config') {
            console.log('Offchain config');
            const { file_path } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'file_path',
                    message:
                        'Select the offchain config file, if no value is provided, the generated configuration will be selected:',
                },
            ]);

            const offchainConfig = fs.readFileSync(
                file_path || 'offchain_config.json',
                'utf8'
            );

            startFuzzWithOffchainConfig();

            // TODO: need to upload contracts(results.json) for clone flow?
            await createOffchain('', projectType, offchainConfig, 0);

            // TODO: copy faas fuzz_manager logic below, update status when task error or completed
            // also save workdir results to TaskResult
            function updateTaskResult() {
                //
            }
        }
    }

    // Run blaz services, create task
    if (blaz) {
        const API_KEY = await getAPIKey();
        console.log('API_KEY', API_KEY);
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
                    argv.offchainConfig,
                    argv.printing,
                    argv.blaz
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
    .option('blaz', {
        alias: 'b',
        type: 'boolean',
        description: 'Automatically run blaz services, create task',
    })
    .option('setup-file', {
        alias: 'f',
        type: 'string',
        description: 'Specify the setup file to use',
    })
    .option('offchain-config', {
        alias: '-o',
        type: 'string',
        description: 'Specify the config file to use',
    })
    .option('printing', {
        alias: 'p',
        type: 'boolean',
        description: 'Print the output in real-time if true',
        default: false,
    })
    .command(
        'configure',
        'Configure CLI options, the values you provide will be written to file (~/.blazo)',
        async () => {
            await getAPIKey();
        }
    )
    .help().argv;
