#!/usr/bin/env node
const { build, auto_detect } = require('./builder');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const { table } = require('table');
const { exec } = require('child_process');
const { randomAddress } = require('./utils');
const axios = require('axios');

async function deployContract(bytecode, port) {
    const deployData = JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_sendTransaction",
        params: [{
            data: `0x${bytecode}`,
            from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            gas: "0x9716c0",
            gasPrice: "0x9184e72a000",
            value: "0x0"
        }]
    });

    const deployResponse = await axios.post(`http://localhost:${port}`, deployData, {
        headers: {
            'content-type': 'application/json'
        }
    });

    if (!deployResponse.data || !deployResponse.data.result) {
        console.log('Failed to deploy contract');
        return [];
    }

    const txHash = deployResponse.data.result;

    const traceData = JSON.stringify({
        id: 2,
        jsonrpc: "2.0",
        method: "trace_transaction",
        params: [txHash]
    });

    const traceResponse = await axios.post(`http://localhost:${port}`, traceData, {
        headers: {
            'content-type': 'application/json'
        }
    });

    if (!traceResponse.data || !traceResponse.data.result || traceResponse.data.result.length === 0) {
        console.log('Failed to trace transaction');
        return [];
    }

    return traceResponse.data.result;
}

async function deploy(data, offchainConfig) {
    const port = 8545;
    let bytecodeToAddress = [];

    for (var i = 0; i < data.length; i++) {
        const contracts = data[i].bytecode;
        for (const fileName in contracts) {
            for (const contractName in contracts[fileName]) {
                if (offchainConfig.hasOwnProperty(fileName) && offchainConfig[fileName].hasOwnProperty(contractName)) {
                    const bytecode = contracts[fileName][contractName];
                    const results = await deployContract(bytecode, port);
                    if (!results || results.length === 0) {
                        continue;
                    }
                    for (const result of results) {
                        bytecodeToAddress.push({
                            "code": result.result.code,
                            "address": result.result.address
                        });
                    }
                }
            }
        }
    }

    for (var i = 0; i < data.length; i++) {
        const contracts = data[i].bytecode;
        for (const fileName in contracts) {
            for (const contractName in contracts[fileName]) {
                const bytecode = contracts[fileName][contractName];
                for (const bytecodeAddress of bytecodeToAddress) {
                    if (bytecodeAddress.code.startsWith("0x")) {
                        bytecodeAddress.code = bytecodeAddress.code.slice(2);
                    }
                    if (bytecode.startsWith("0x")) {
                        bytecode = bytecode.slice(2);
                    }

                    if (bytecodeAddress.code.includes(bytecode) || bytecode.includes(bytecodeAddress.code)) {
                        if (!data[i].hasOwnProperty("address")) {
                            data[i]["address"] = {};
                        }
                        if (!data[i]["address"].hasOwnProperty(fileName)) {
                            data[i]["address"][fileName] = {};
                        }
                        data[i]["address"][fileName][contractName] = bytecodeAddress.address;
                    }
                }
            }
        }
    }

    return data;
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
                await build_with_autodetect(argv.project, argv.projectType, argv.compilerVersion, argv.daemon, argv.autoStart);
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
    .demandOption(['project'], 'Please provide the project argument to proceed')
    .help()
    .argv;
