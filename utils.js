const axios = require('axios');
const compare = require('hamming-distance');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const chalk = require('chalk');
const { BLAZO_PATH } = require('./constant');
const inquirer = require('inquirer');

async function deployContract(bytecode, port) {
    const deployData = JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_sendTransaction',
        params: [
            {
                data: `0x${bytecode}`,
                from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
                gas: '0x9716c0',
                gasPrice: '0x9184e72a000',
                value: '0x0',
            },
        ],
    });

    try {
        const deployResponse = await axios.post(
            `http://localhost:${port}`,
            deployData,
            {
                headers: {
                    'content-type': 'application/json',
                },
            }
        );

        if (!deployResponse.data || !deployResponse.data.result) {
            console.log('Failed to deploy contract');
            return [];
        }

        const txHash = deployResponse.data.result;

        const traceData = JSON.stringify({
            id: 2,
            jsonrpc: '2.0',
            method: 'trace_transaction',
            params: [txHash],
        });

        const traceResponse = await axios.post(
            `http://localhost:${port}`,
            traceData,
            {
                headers: {
                    'content-type': 'application/json',
                },
            }
        );

        if (
            !traceResponse.data ||
            !traceResponse.data.result ||
            traceResponse.data.result.length === 0
        ) {
            console.log('Failed to trace transaction');
            return [];
        }

        return traceResponse.data.result;
    } catch (e) {
        console.log(e);
        return [];
    }
}

async function deploy(data, offchainConfig) {
    const port = 8545;
    let bytecodeToAddress = [];

    for (var i = 0; i < data.length; i++) {
        const contracts = data[i].bytecode;
        for (const fileName in contracts) {
            for (const contractName in contracts[fileName]) {
                if (
                    offchainConfig.hasOwnProperty(fileName) &&
                    offchainConfig[fileName].hasOwnProperty(contractName)
                ) {
                    const bytecode = contracts[fileName][contractName];
                    const results = await deployContract(bytecode, port);
                    if (!results || results.length === 0) {
                        continue;
                    }
                    for (const result of results) {
                        bytecodeToAddress.push({
                            code: result.result.code,
                            address: result.result.address,
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
                let bytecode = contracts[fileName][contractName];
                if (bytecode.startsWith('0x')) {
                    bytecode = bytecode.slice(2);
                }

                let minDistance = Infinity;
                let closestBytecodeAddress = null;

                for (const bytecodeAddress of bytecodeToAddress) {
                    let code = bytecodeAddress.code;
                    if (code.startsWith('0x')) {
                        code = code.slice(2);
                    }

                    const lengthDifference = Math.abs(
                        bytecode.length - code.length
                    );
                    const maxLength = Math.max(bytecode.length, code.length);
                    if (lengthDifference / maxLength <= 0.1) {
                        const bytecodeBuffer = Buffer.from(bytecode, 'hex');
                        const codeBuffer = Buffer.from(code, 'hex');

                        const targetLength = Math.max(
                            bytecodeBuffer.length,
                            codeBuffer.length
                        );

                        let paddedBytecodeBuffer = bytecodeBuffer;
                        let paddedCodeBuffer = codeBuffer;

                        if (bytecodeBuffer.length < targetLength) {
                            paddedBytecodeBuffer = Buffer.concat([
                                bytecodeBuffer,
                                Buffer.alloc(
                                    targetLength - bytecodeBuffer.length
                                ),
                            ]);
                        }
                        if (codeBuffer.length < targetLength) {
                            paddedCodeBuffer = Buffer.concat([
                                codeBuffer,
                                Buffer.alloc(targetLength - codeBuffer.length),
                            ]);
                        }

                        const distance = compare(
                            paddedBytecodeBuffer,
                            paddedCodeBuffer
                        );
                        if (distance !== null && distance < minDistance) {
                            minDistance = distance;
                            closestBytecodeAddress = bytecodeAddress;
                        }
                    }
                }

                if (closestBytecodeAddress) {
                    if (!data[i].hasOwnProperty('address')) {
                        data[i]['address'] = {};
                    }
                    if (!data[i]['address'].hasOwnProperty(fileName)) {
                        data[i]['address'][fileName] = {};
                    }
                    data[i]['address'][fileName][contractName] =
                        closestBytecodeAddress.address;
                }
            }
        }
    }

    return data;
}

function randomAddress() {
    let address = '0x';
    for (let i = 0; i < 40; i++) {
        address += Math.floor(Math.random() * 16).toString(16);
    }
    return address;
}

function hasYarn(cwd = process.cwd()) {
    return fs.existsSync(path.resolve(cwd, 'yarn.lock'));
}

function hasPnpm(cwd = process.cwd()) {
    return fs.existsSync(path.resolve(cwd, 'pnpm-lock.yaml'));
}

function checkSolcSelectInstalled() {
    try {
        execSync('solc-select versions');
        return true;
    } catch (error) {
        console.log(error.message);
        return false;
    }
}

const logger = {
    error(...args) {
        console.log(chalk.red(...args));
    },
    warn(...args) {
        console.log(chalk.yellow(...args));
    },
    info(...args) {
        console.log(chalk.cyan(...args));
    },
    success(...args) {
        console.log(chalk.green(...args));
    },
    break() {
        console.log('');
    },
};

async function getAPIKey(isReset = false) {
    if (!isReset) {
        if (fs.existsSync(BLAZO_PATH)) {
            const token = fs.readFileSync(BLAZO_PATH, 'utf-8').trim();
            if (token) {
                return token;
            }
        }
    }

    logger.info('===============================================');
    logger.info(
        "You're not logged in. To interact with the Blaz service, you need to be authenticated."
    );
    logger.info('Please provide your login credentials below.');
    logger.info(
        "If you don't have an account, you can register at https://blaz.ai, and get the API key at https://blaz.ai/account/apikeys."
    );
    logger.info('===============================================');

    const data = await inquirer.prompt([
        {
            type: 'input',
            name: 'API_KEY',
            message: 'Input API Key:',
        },
    ]);
    const API_KEY = data['API_KEY'];
    fs.writeFileSync(BLAZO_PATH, API_KEY);
    return API_KEY;
}

function checkFileExists(filePath) {
    const exists = fs.existsSync(filePath);
    if (exists) {
        return true;
    } else {
        logger.error(`${filePath} does not exist`);
        return false;
    }
}

module.exports = {
    randomAddress,
    deploy,
    hasYarn,
    hasPnpm,
    checkSolcSelectInstalled,
    logger,
    getAPIKey,
    checkFileExists,
};
