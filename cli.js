#!/usr/bin/env node
const { build, auto_detect } = require('./builder');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const path = require('path');
const { table } = require('table');
const { exec } = require('child_process');
const { randomAddress } = require('./utils');
const { deploy } = require('./utils');
const axios = require('axios');
const os = require('os');
const prompt = require('prompt');

const BLAZO_PATH = path.join(os.homedir(), '.blazo');
const BUILDER_HOST = "https://solc-builder.fuzz.land/";

async function getToken() {
    if (fs.existsSync(BLAZO_PATH)) {
        const token = fs.readFileSync(BLAZO_PATH, 'utf-8').trim();
        if (token) {
            return token;
        }
    }

    console.log("===============================================");
    console.log("You're not logged in. To interact with the Blaz service, you need to be authenticated.");
    console.log("Please provide your login credentials below.");
    console.log("If you don't have an account, you can register at https://blaz.ai/");
    console.log("===============================================");

    prompt.message = '';

    const { email, password } = await prompt.get(['email', 'password']);

    try {
        const response = await axios.post('https://faas.infra.fuzz.land//users/login', {
            email: email,
            password: password
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data.status === 'success') {
            const token = response.data.token;
            fs.writeFileSync(BLAZO_PATH, token);
            return token;
        } else {
            console.error('Failed to login:', response.data.message);
            process.exit(1);
        }
    } catch (error) {
        console.error('Error while logging in:', error.message);
        process.exit(1);
    }
}

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

async function build_with_autodetect(project, projectType, compiler_version, daemon, autoStart) {
    console.log("Starting anvil...");
    const anvil = exec('anvil');

    process.on('SIGINT', () => {
        anvil.kill();
    });

    if (!projectType) {
        projectType = await auto_detect(project);
    }
    let results = await build(projectType, project, compiler_version);

    if (!Array.isArray(results)) {
        results = [results];
    }

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

    fs.writeFileSync("results.json", JSON.stringify(results, null, 4));
    fs.writeFileSync("offchain_config.json", JSON.stringify(offchainConfig, null, 4));
    visualize(results);
    console.log("Results written to results.json");

    if (autoStart) {
        const command = `ityfuzz evm --builder-artifacts-file ./results.json --offchain-config-file ./offchain_config.json -f -i -t "a" --work-dir ./workdir`;
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

    anvil.kill();
}

async function createOnchain(type, contractAddress, chain, blockNumber) {
    const token = await getToken(); // Get the token using your getToken function

    const data = {
        "contract_address": contractAddress,
        "chain": chain,
        "block_number": blockNumber,
        "to_detect": [],
        "invariants_contract": [],
        "sca_enabled": true,
        "n_cpus": 1,
        "liquidity_pools_definition": {},
        "token_price": {},
        "status": 0
    };

    try {
        const response = await axios.post('https://blaz.infra.fuzz.land/task/onchain', data, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token
            }
        });

        if (response.data.status === 'success') {
            console.log('Successfully created onchain task:', response.data);
        } else {
            console.error('Failed to create onchain task:', response.data.message);
        }
    } catch (error) {
        console.error('Error while creating onchain task:', error.message);
    }
}

async function submitBuildJob({ projectType, file, compilerVersion }) {
    let url = `${BUILDER_HOST}build/${projectType}?needs=${OFFCHAIN_NEEDS}`;
    if (compilerVersion) {
        url += `&compiler_version=${compilerVersion}`;
    }
    const formData = new FormData();

    // Read the file from the filesystem and append it to the FormData object
    const fileStream = fs.createReadStream(file);
    formData.append("file", fileStream);

    return (await axios.post(url, formData, {
        headers: {
            ...formData.getHeaders(), // This is necessary for axios to handle multipart/form-data correctly
            'Content-Type': 'multipart/form-data'
        }
    })).data;
}

async function getBuildJob({ task_id }) {
    let url = `${BUILDER_HOST}task/${task_id}`;
    let result = (await axios.get(url)).data;
    let result_json = null;
    if (result["status"] === "done") {
        result_json = (await axios.get(result["results"])).data;
    }
    return {
        status: result["status"],
        result_json,
        result_url: result["results"],
        log: result["log"],
    };
}

async function createOffchain(projectType, file, compilerVersion) {
    console.log(`Creating offchain`);

    // Submit build job
    const buildJobResponse = await submitBuildJob({ projectType, file, compilerVersion });

    // Poll for results
    let build_result;
    do {
        build_result = await getBuildJob({ task_id: buildJobResponse.task_id });
        if (build_result.status !== "done") {
            await new Promise(resolve => setTimeout(resolve, 5000)); // wait for 5 seconds before polling again
        }
    } while (build_result.status !== "done");

    // Generate offchain config
    let results = build_result.result_json;

    if (!Array.isArray(results)) {
        results = [results];
    }

    let offchainConfig = results.reduce((acc, item) => {
        const deepClonedItem = JSON.parse(JSON.stringify(item.abi));
        return { ...acc, ...deepClonedItem };
    }, {});

    for (const fileName in offchainConfig) {
        for (const contractName in offchainConfig[fileName]) {
            offchainConfig[fileName][contractName] = {
                "address": randomAddress(),
                "constructor_args": "0x"
            };
        }
    }

    // Send the final request to create the offchain task
    const token = await getToken();
    const data = {
        "contracts": build_result.result_url,
        "offchain_config": JSON.stringify(offchainConfig),
        "chain": "Ethereum",
        "to_detect": [],
        "invariants_contract": [],
        "sca_enabled": true,
        "n_cpus": 2,
        "liquidity_pools_definition": {},
        "token_price": {}
    };

    try {
        const response = await axios.post('https://blaz.infra.fuzz.land/task/offchain', data, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token
            }
        });

        if (response.data.status === 'success') {
            console.log('Successfully created offchain task:', response.data);
        } else {
            console.error('Failed to create offchain task:', response.data.message);
        }
    } catch (error) {
        console.error('Error while creating offchain task:', error.message);
    }
}

(async () => {
    await getToken();

    const argv = yargs(hideBin(process.argv))
        .command(
            '$0 <project>',
            'Build a project',
            (yargs) => {
                yargs.positional('project', {
                    describe: 'Name of the project to build',
                    type: 'string',
                })
                    .demandOption(['project'], 'Please provide the project argument to proceed');
            },
            async (argv) => {
                if (argv.project) {
                    await build_with_autodetect(argv.project, argv.projectType, argv.compilerVersion, argv.daemon, argv.autoStart);
                }
            }
        )
        .command(
            'create <type>',
            'Create a project type',
            (yargs) => {
                yargs.positional('type', {
                    describe: 'Type of the project to create (offchain/onchain)',
                    type: 'string',
                    choices: ['offchain', 'onchain']
                })
                    .option('contract-address', {
                        alias: 't',
                        type: 'string',
                        description: 'Contract address for onchain type',
                    })
                    .option('chain', {
                        alias: 'c',
                        type: 'string',
                        description: 'Chain for onchain type (e.g., ETH)',
                    })
                    .option('onchain-block-number', {
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
                    await createOnchain(argv.type, argv.contractAddress, argv.chain, argv.onchainBlockNumber);
                } else if (argv.type === 'offchain') {
                    await createOffchain(argv.projectType, argv.file, argv.compilerVersion);
                }
            }

        )
        .help()
        .argv;
})();