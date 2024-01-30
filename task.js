const fs = require('fs');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { logger, getAPIKey } = require('./utils');
const { INVARIANTS_ITEMS } = require('./constant');

const BLAZ_BASE_URL = 'https://blaz.dev.infra.fuzz.land';

async function createOffchain(
    buildResultUrl,
    projectType,
    offchainConfig,
    setupFile,
    status = 0
) {
    const invariants = Object.keys(INVARIANTS_ITEMS)
        .map((category) => INVARIANTS_ITEMS[category].map((slot) => slot.name))
        .flat();

    const API_KEY = await getAPIKey();
    await axios
        .post(
            `${BLAZ_BASE_URL}/task/offchain`,
            {
                task_name: 'Untitled Task Created by CLI',
                project_type: projectType,
                contracts_filename: '',
                contract_address: '',
                contracts: buildResultUrl,
                offchain_config: JSON.stringify(JSON.parse(offchainConfig)),
                chain: '',
                custom_rpc_url: '',
                to_detect: invariants,
                invariants_contract: [],
                sca_enabled: true,
                n_cpus: 1,
                liquidity_pools_definition: [],
                token_price: [],
                status,
                upload_type: 0,
                setup_file: setupFile,
            },
            {
                headers: {
                    Authorization: API_KEY,
                },
            }
        )
        .then(({ data: { id } }) => {
            logger.info(
                `Created offchain task successfully, You can check the task detial at https://blaz.ai/project/${id}`
            );
        })
        .catch((err) => {
            logger.info(err.message);
            process.exit(1);
        });
}

async function createOnchain(contractAddress, chain, blockNumber) {
    const invariants = Object.keys(INVARIANTS_ITEMS)
        .map((category) => INVARIANTS_ITEMS[category].map((slot) => slot.name))
        .flat();
    const data = {
        task_name: 'Untitled Task Created by CLI',
        chain: chain,
        custom_rpc_url: '',
        block_number: blockNumber,
        contract_address: contractAddress,
        to_detect: invariants,
        invariants_contract: [],
        sca_enabled: true,
        n_cpus: 1,
        liquidity_pools_definition: {},
        token_price: {},
        status: 0,
    };

    const API_KEY = await getAPIKey();
    await axios
        .post(`${BLAZ_BASE_URL}/task/onchain`, data, {
            headers: {
                Authorization: API_KEY,
            },
        })
        .then(({ data: { id, status, message } }) => {
            if (status === 'success') {
                logger.info(
                    `Created onchain task successfully, you can check the task detial at https://blaz.ai/project/${id}`
                );
            } else {
                logger.error('Failed to create onchain task:', message);
            }
        })
        .catch((err) => {
            logger.error('Error while creating onchain task:', err.message);
            process.exit(1);
        });
}

async function uploadBuildResult(filePath) {
    const task_id = uuidv4();
    let buffer;
    const API_KEY = await getAPIKey();
    const {
        data: { uploadUrl },
    } = await axios.get(
        `${BLAZ_BASE_URL}/storage/upload_url/${task_id}-results.json`,
        {
            headers: {
                Authorization: API_KEY,
            },
        }
    );
    try {
        buffer = fs.readFileSync(filePath);
    } catch (err) {
        logger.error('uploaded file not found');
        return;
    }
    await axios.put(uploadUrl, buffer, {
        headers: { 'Content-Type': 'application/octet-stream' },
    });
    return uploadUrl;
}

module.exports = {
    createOffchain,
    createOnchain,
    uploadBuildResult,
};
