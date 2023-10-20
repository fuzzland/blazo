const { v4: uuidv4 } = require('uuid');

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');


function run_scribble_command(source_json_with_ast, compiler_version, build) {
    let fp = path.join(__dirname, `../.tmp/${uuidv4()}.json`);
    if (!fs.existsSync(path.join(__dirname, '../tmp'))){
        fs.mkdirSync(path.join(__dirname, '../tmp'));
    }

    let fd = fs.openSync(fp, 'w');
    fs.writeSync(fd, JSON.stringify(source_json_with_ast));
    fs.closeSync(fd);


    compiler_version = /v([0-9|\.]+)\+/.exec(compiler_version)[1];

    let cmd = `scribble -i json ${fp} --compiler-version ${compiler_version} --output -- `;

    if (build) {
        cmd += " -m json";
    } else {
        cmd += " -m flat";
    }

    try {
        let buffer = execSync(cmd);
        return {
            success: true,
            results: buffer.toString()
        }
    } catch (err) {
        console.log(err);
        return {
            success: false,
            err: err.stderr.toString()
        };
    }
}


function parse_scribble_json(json, orig_file_contract_mappings) {
    let contracts_to_files = {}

    let instrumentation_order = json["instrumentationMetadata"]["originalSourceList"];
    for (let file of instrumentation_order) {
        for (let _file of Object.keys(orig_file_contract_mappings)) {
            console.log(file, _file);
            if (file != _file) {
                continue;
            }
            for (let contract of Object.keys(orig_file_contract_mappings[file])) {
                contracts_to_files[contract] = contracts_to_files[contract] || [];
                if (Object.keys(orig_file_contract_mappings[file]).includes(contract)) {
                    contracts_to_files[contract].push(file);
                }
            }
        }
    }

    let collected = {};

    let contract = json["contracts"]["flattened.sol"];
    let encounterance = {};

    for (let c in contract) {
        let filename = contracts_to_files[c];
        let contract_name = c;
        encounterance[contract_name] = encounterance[contract_name] || 0;
        if (!filename) {
            // try remove the last _xxx
            let last_underscore = c.lastIndexOf("_");
            if (last_underscore > 0) {
                let real_contract_name = c.substring(0, last_underscore);
                if (!contracts_to_files[real_contract_name]) {
                    console.log(`Cannot find contract ${real_contract_name} in contracts_to_files`);
                    continue;
                }
                let file = contracts_to_files[real_contract_name][encounterance[real_contract_name]];
                filename = file;
                contract_name = real_contract_name;
            }
        } else {
            filename = filename[0]
        }
        encounterance[contract_name] += 1;

        collected[filename] = collected[filename] || {};
        collected[filename][contract_name] = {
            abi: contract[c]["abi"],
            runtime_bytecode: contract[c]["evm"]["deployedBytecode"]["object"],
            sourcemap: contract[c]["evm"]["deployedBytecode"]["sourceMap"],
            bytecode: contract[c]["evm"]["bytecode"]["object"],
            replaces: json["instrumentationMetadata"]["instrToOriginalMap"],
        }
    }
    return collected;
}


module.exports = {run_scribble_command, parse_scribble_json};