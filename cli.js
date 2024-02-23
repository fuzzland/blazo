#!/usr/bin/env node
const { build, auto_detect } = require('./builder');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const { table } = require('table');
const { exec, spawn } = require('child_process');
const {
    randomAddress,
    getAPIKey,
    logger,
    checkFileExists,
} = require('./utils');
const { handleBuildCoverage } = require('./coverage');
const { createOffchain, createOnchain, uploadBuildResult } = require('./task');
const inquirer = require('inquirer');
const {
    ASTReader,
    ASTWriter, CompileFailedError,
    compileSol,
    DefaultASTWriterMapping,
    LatestCompilerVersion,
    PrettyFormatter, compileJson
} = require("solc-typed-ast")
const { compileJsonData } = require("solc-typed-ast");
const OpenAI = require('openai');
const { forge_build_json } = require('./foundry');

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

function startFuzz(setupFile, configFile, isPrint) {
    let command = '';
    if (setupFile) {
        command = `ityfuzz evm --builder-artifacts-file ./results.json -t "a" --work-dir ./workdir --setup-file ${setupFile}`;
    } else {
        command = `ityfuzz evm --builder-artifacts-file ./results.json --offchain-config-file ${configFile} -f -t "a" --work-dir ./workdir`;
    }
    console.log(`Starting ityfuzz with command: ${command}`);
    handleBuildCoverage();

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

// TODO: check offchain config is valid
function getOffchainConfig(results) {
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
    return offchainConfig;
}

async function findContractSetupCode(functions) {
    for (const func of functions) {
        if (func.name === 'setup') {
            return func.source;
        }
    }
    return "";
}

async function callOpenAI(functionSource, setupCode, errorMsg = "") {
    const openai = new OpenAI();
    let prompt = `You are given some smart contract functions. The functions are defined as follows:\n\`\`\`solidity\n${functionSource}\n\`\`\`\n\nNow, please finish the following property test case for these function. The setUp() function is already provided for you, you can add state variables and other functions as needed. \n\`\`\`solidity\ncontract TestContract {\n${setupCode}\n`;
    if (errorMsg) {
        prompt += `Please avoid the following error: ${errorMsg}\n`;
    }

    try {
        const response = await openai.chat.completions.create({
            model: "ft:gpt-3.5-turbo-1106:fuzzland::8ucaLWeG",
            messages: [{
                "role": "system",
                "content": prompt
            }],
            temperature: 1,
            max_tokens: 256,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error calling OpenAI:', error);
        return "";
    }
}

async function generateTestCasesForFunction(functionName, setupCode, functionSource, project) {
    let errorMsg = "";
    const filename = `${functionName}.t.sol`;
    for (let i = 0; i < 3; i++) {
        try {
            const testCode = await callOpenAI(setupCode, functionSource, errorMsg);
            const fullCode = `contract TestContract {\n${setupCode}\n${testCode}\n`.replace("```", "");
            fs.writeFileSync(`${project}/tests/${filename}`, fullCode);
            let { success, contents } = await forge_build_json(project);
            if (success) {
                return;
            }
            errorMsg = contents;
            fs.unlinkSync(`${project}/tests/${filename}`);
        } catch (error) {
            console.error('Error building project:', error);
        }
    }
    return testCode;
}

async function generateTestCasesForContract(contracts, contractName, project) {
    const functions = contracts[0].ast[contractName].contracts[0].functions;
    const setupCode = await findContractSetupCode(functions, project);
    if (!setupCode) {
        console.log(`Setup function not found for contract ${contractName}`);
    }

    for (const func of functions) {
        if (func.name.toLowerCase() !== 'setup') {
            await generateTestCasesForFunction(func.name, setupCode, func.source, project);
        }
    }
}

async function gen_test(results, project) {
    await generateTestCasesForContract(results, "contracts/MapleLoan.sol", project);
}

async function build_with_autodetect(
    project,
    projectType,
    compiler_version,
    autoStart,
    setupFile,
    offchainConfigPath,
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

    if (blaz) {
        await getAPIKey();
    }

    const generatedOffchainConfig = getOffchainConfig(results);

    if (!setupFile) {
        fs.writeFileSync(
            'offchain_config.json',
            JSON.stringify(generatedOffchainConfig, null, 4)
        );

        console.log(
            'Offchain config written to offchain_config.json, please edit it to specify the addresses of the contracts.'
        );
    } else {
        startFuzz(setupFile, '', isPrint);
        if (blaz) {
            const buildResultUrl = await uploadBuildResult('results.json');
            await createOffchain(
                buildResultUrl,
                projectType,
                generatedOffchainConfig,
                setupFile
            );
        }
    }

    if (offchainConfigPath) {
        const isExist = checkFileExists(offchainConfigPath);
        if (!isExist) return;
        startFuzz('', offchainConfigPath, isPrint);
        if (blaz) {
            const buildResultUrl = await uploadBuildResult('results.json');
            const offchainConfig = fs.readFileSync(offchainConfigPath, 'utf8');
            await createOffchain(buildResultUrl, projectType, offchainConfig);
        }
    }

    fs.writeFileSync('results.json', JSON.stringify(results, null, 4));
    visualize(results);
    console.log(`Results written to results.json`);

    await gen_test(results, project);

    if (autoStart) {
        startFuzz(setupFile, 'offchain_config.json', isPrint);
    }

    // No setup file/offchain config, select the mode of operation manually
    if (!setupFile && !offchainConfigPath && !autoStart) {
        const { choice } = await inquirer.prompt({
            type: 'list',
            name: 'choice',
            message: 'Please select the option you want to use:',
            choices: ['Setup File', 'Offchain Config'],
        });

        if (choice === 'Setup File') {
            // generate setup files and check that the input file path exists in the setup files
            const setupFiles = results.flatMap((obj) =>
                Object.entries(obj.ast).flatMap(([filePath, astObj]) =>
                    astObj.contracts.map(
                        (contract) => `${filePath}:${contract.name}`
                    )
                )
            );
            const setupType = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'contract',
                    message: 'Please select the below setup files to continue:',
                    choices: [...setupFiles, 'customization'],
                },
                {
                    type: 'input',
                    name: 'customContract',
                    message: 'Please input the setup file to continue:',
                    when: (answers) => answers.contract === 'customization',
                },
            ]);

            const inputSetupFileExist =
                setupFiles.findIndex((f) => f === setupType.customContract) >
                -1;

            if (setupType.customContract && !inputSetupFileExist) {
                logger.error(
                    'The setup file you input is not available, please check generated results.json file'
                );
                return;
            }
            const setupFile = setupType.customContract || setupType.contract;

            startFuzz(setupFile, '', isPrint);

            if (blaz) {
                const buildResultUrl = await uploadBuildResult('results.json');
                await createOffchain(
                    buildResultUrl,
                    projectType,
                    generatedOffchainConfig,
                    setupFile
                );
            }
        } else if (choice === 'Offchain Config') {
            const { offchain_cofig_path } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'offchain_cofig_path',
                    message:
                        'Select the offchain config file, if no value is provided, the generated offchain_config.json file will be applied:',
                },
            ]);
            const offchainConfigPath =
                offchain_cofig_path || 'offchain_config.json';
            const isExist = checkFileExists(offchainConfigPath);
            if (!isExist) return;

            if (blaz) {
                const offchainConfig = fs.readFileSync(
                    offchainConfigPath,
                    'utf8'
                );
                const buildResultUrl = await uploadBuildResult('results.json');
                await createOffchain(
                    buildResultUrl,
                    projectType,
                    offchainConfig
                );
            }
            startFuzz('', offchainConfigPath, isPrint);
        }
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
        description: 'Automatically run blaz services, create offchain task',
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
            await getAPIKey(true);
        }
    )
    .help().argv;
