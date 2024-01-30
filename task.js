const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const axios = require('axios');
const FormData = require('form-data');
const { randomAddress, logger, getAPIKey } = require('./utils');
const { auto_detect } = require('./builder');
const { INVARIANTS_ITEMS } = require('./constant');

const BLAZ_API_KEY = process.env.BLAZ_API_KEY;
const BUILDER_BASE_URL = 'https://solc-builder.dev.infra.fuzz.land';
const BLAZ_BASE_URL =
    'http://localhost:3000' || 'https://blaz.dev.infra.fuzz.land';

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
                    Authorization: BLAZ_API_KEY,
                },
            }
        )
        .then(({ data: { id } }) => {
            logger.info(
                `You can check the task detial at https://blaz.ai/project/${id}`
            );
            process.exit(1);
        })
        .catch((err) => {
            logger.info(err.message);
            process.exit(1);
        });
}

// async function createOffchain(projectPath, projectType, compilerVersion) {
//     if (!BLAZ_API_KEY) {
//         logger.error(
//             'Please setup your API token, you can get the token from https://blaz.ai/account/apikeys.'
//         );
//         process.exit(1);
//     }
//     if (!compilerVersion) {
//         logger.error('Compiler version not specified');
//         process.exit(1);
//     }
//     if (!projectType) {
//         projectType = await auto_detect(projectPath);
//     }

//     //  create a file to stream archive data to
//     const output = fs.createWriteStream(path.join('output.zip'));
//     const archive = archiver('zip', {
//         zlib: { level: 9 },
//     });

//     // listen for all archive data to be written
//     output.on('close', async () => {
//         logger.info('ZIP file created:', archive.pointer(), 'total bytes');

//         try {
//             // upload zip files
//             const formData = new FormData();
//             formData.append(
//                 'file',
//                 fs.createReadStream(path.join('output.zip'))
//             );

//             const {
//                 data: { task_id },
//             } = await axios.post(
//                 `${BUILDER_BASE_URL}/build/${projectType}`,
//                 formData,
//                 {
//                     params: {
//                         compiler_version: compilerVersion,
//                         needs: 'sourcemap,bytecode,abi,sources,invariants,compiler_args,ast',
//                     },
//                     headers: formData.getHeaders(),
//                 }
//             );
//             logger.info(`Project uploaded successfully`);

//             // get builder results, wait for status update to done
//             async function handleLoadBuilderResult(attempts = 0) {
//                 if (attempts > 200) {
//                     logger.error(
//                         'Exceeded maximum number of attempts, cannot get builder results.'
//                     );
//                     process.exit(1);
//                 }
//                 return await axios
//                     .get(`${BUILDER_BASE_URL}/task/${task_id}`)
//                     .then((response) => {
//                         const data = response.data;
//                         if (data.status === 'done') {
//                             return data;
//                         } else {
//                             return new Promise((resolve) => {
//                                 setTimeout(
//                                     () =>
//                                         resolve(
//                                             handleLoadBuilderResult(
//                                                 attempts + 1
//                                             )
//                                         ),
//                                     1000
//                                 );
//                             });
//                         }
//                     })
//                     .catch((error) => {
//                         logger.error('Error:', error);
//                     });
//             }
//             logger.info(`Waiting taskID: ${task_id} for build to start...`);
//             const { results } = await handleLoadBuilderResult();

//             // get results json from GCP or get results json from local?
//             const { data: result_json } = await axios.get(results);
//             logger.info(`Load builder results`);

//             // create offchain config
//             let offchainConfig = result_json.reduce((acc, item) => {
//                 const deepClonedItem = JSON.parse(JSON.stringify(item.abi));
//                 return { ...acc, ...deepClonedItem };
//             }, {});

//             for (const fileName in offchainConfig) {
//                 for (const contractName in offchainConfig[fileName]) {
//                     offchainConfig[fileName][contractName] = {
//                         address: randomAddress(),
//                         constructor_args: '0x',
//                     };
//                 }
//             }

//             fs.writeFileSync(
//                 'offchain_config.json',
//                 JSON.stringify(offchainConfig, null, 4)
//             );

//             logger.info(
//                 'Offchain config written to offchain_config.json, please edit it to specify the addresses of the contracts and press enter to continue'
//             );

//             // update offchain config
//             await new Promise((resolve) => {
//                 process.stdin.once('data', () => {
//                     offchainConfig = fs.readFileSync(
//                         'offchain_config.json',
//                         'utf8'
//                     );
//                     resolve();
//                 });
//             });
//             handleCreateTask(results, projectType, offchainConfig);
//         } catch (error) {
//             logger.error('Failed to upload file:', error.message);
//         }
//     });
//     archive.on('error', function (err) {
//         throw err;
//     });
//     // pipe archive data to the file
//     archive.pipe(output);
//     // append files from a sub-directory, putting its contents at the root of archive
//     archive.directory(projectPath, false);
//     // finalize the archive (ie we are done appending files but streams have to finish yet)
//     archive.finalize();
// }

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

    try {
        const response = await axios.post(
            `${BLAZ_BASE_URL}/task/onchain`,
            data,
            {
                headers: {
                    Authorization: BLAZ_API_KEY,
                },
            }
        );
        if (response.data.status === 'success') {
            console.log('Created onchain task Successfully');
            logger.info(
                `You can check the task detial at https://blaz.ai/project/${response.data.id}`
            );
        } else {
            logger.error(
                'Failed to create onchain task:',
                response.data.message
            );
        }
    } catch (error) {
        logger.error('Error while creating onchain task:', error.message);
    }
}

async function getSignedUrl(filename) {
    const {
        data: { uploadUrl },
    } = await axios.get(`${BLAZ_BASE_URL}/upload_url/${filename}`);
    return uploadUrl;
}

async function uploadBuildResult(filePath) {
    let buffer;
    const API_KEY = await getAPIKey();
    const {
        data: { uploadUrl },
    } = await axios.get(
        `${BLAZ_BASE_URL}/storage/upload_url/${'test_config.json'}`,
        {
            headers: {
                Authorization: API_KEY,
            },
        }
    );
    try {
        buffer = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        logger.error('uploaded file not found');
        return;
    }
    await axios.put(uploadUrl, buffer);
    return uploadUrl;
}

module.exports = {
    createOffchain,
    createOnchain,
    uploadBuildResult,
};
