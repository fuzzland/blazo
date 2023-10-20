const { run_scribble_command, parse_scribble_json } = require("./scribble");
const {hardhat_build_json} = require("./hardhat");
const {forge_build_json} = require("./foundry");
const path = require('path');
const {globSync} = require('glob');
const { execSync, exec } = require('child_process');
const { exit } = require('process');
const fs = require('fs');
const {get_ast, get_invariants} = require('./ast');


async function auto_detect(task_dir) {
    if (fs.existsSync(path.join(task_dir, "forge.toml")) || fs.existsSync(path.join(task_dir, "foundry.toml"))) {
        return "forge"
    } 
    if (fs.existsSync(path.join(task_dir, "hardhat.config.js"))) {
        return "hardhat"
    }
    console.log("Unknown project, treating everything *.sol in this folder as smart contract.")
    return "solidity_folder"

}


async function build(project, task_dir, compiler_version) {
    if (project === "hardhat") {
        let promise = new Promise((resolve, reject) => {
            handle_build_info_task(task_dir, hardhat_build_json, resolve);
        });
        return await promise;
    }
    else if (project === "forge") {
        let promise = new Promise((resolve, reject) => {
            handle_build_info_task(task_dir, forge_build_json, resolve);
        });
        return await promise;
    } else if (project === "solidity_folder") {
        let promise = new Promise((resolve, reject) => {
            if (!compiler_version) {
                console.error("Compiler version not specified");
                exit(1);
            }
            handle_multi_build(task_dir, compiler_version, resolve);
        });
        return await promise;
    } else {
        console.error("Unknown project type", project);
        exit(1);
    }
}

async function handle_build_info_task(task_dir, build_func, resolve) {
    try {
      let result = await build_func(task_dir);
      if (!result.success) {
          console.error("Build failed", result.err);
          exit(1);
      } 
    let results = [];
    for (let data of result.contents) {
        let version_finder = /^(.+?)\+commit\.[0-9a-z]+/;
        let version = version_finder.exec(data["solcLongVersion"]);
        let result = await work_on_json("v"+version[0], data["input"], "");
        results.push(result);
    }
    resolve(results);
    } catch (error) {
        console.error(error);
        exit(1);
    }
  }

  async function handle_multi_build(task_dir, compiler_version, resolve) {
    let files = globSync(path.join(task_dir, '**/*.sol'));
    let build_sources = {};

    for (let file of files) {
        let content = fs.readFileSync(file, 'utf8');
        build_sources[file] = { content };
    }

    let remappings = [];
    let remappings_file = path.join(task_dir, 'remappings.txt');
    if (fs.existsSync(remappings_file)) {
        let remappings_lines = fs.readFileSync(remappings_file, 'utf8').split('\n');
        for (let line of remappings_lines) {
            if (line.trim().length > 0) {
                remappings.push(line.trim());
            }
        }
    }

    let result = await work_on_json(compiler_version, {
        language: 'Solidity',
        sources: build_sources,
        settings: {
            remappings
        }
    }, "");
    resolve(result);
}

function generate_settings(original = {}) {
    let basic = original;
    basic["outputSelection"] = {
        '*': {
            '*': [],
            "": [],
        }
    };
    basic["outputSelection"]["*"]["*"].push("ast");
    basic["outputSelection"]["*"]["*"].push("legacyAST");
    basic["outputSelection"]["*"][""].push("ast");
    basic["outputSelection"]["*"][""].push("legacyAST");
    basic["outputSelection"]["*"]["*"].push("evm.deployedBytecode.sourceMap");
    basic["outputSelection"]["*"]["*"].push("evm.bytecode");
    basic["outputSelection"]["*"]["*"].push("evm.deployedBytecode");
    basic["outputSelection"]["*"]["*"].push("abi");
    return basic
}

async function work_on_json(compiler_version, compiler_json, contract_name) {
    let promise = new Promise((resolve, reject) => {
        let starting = process.hrtime();
        // run node ./compiler.js 0.7.0 test.sol
        if (!fs.existsSync(".tmp")) {
            fs.mkdirSync(".tmp");
        }

        let currentFile = `.tmp/${process.pid}.json`;
        compiler_json["settings"] = generate_settings(original = compiler_json["settings"]);
        fs.writeFileSync(currentFile, JSON.stringify(compiler_json));

        starting = process.hrtime();
        exec(`node ./compiler.js ${compiler_version} ${currentFile} --stack-size=65500`, async (err, stdout, stderr) => {
            if (err) {
                console.log("Error loading solc", stderr);
                resolve({ success: false, err: stderr })
            } else {
                const output = JSON.parse(fs.readFileSync(currentFile, 'utf8'));

                for (let error of output?.errors || []) {
                    if (error["severity"] === "error") {
                        console.log(error["formattedMessage"])
                        resolve({ success: false, err: err })
                        return;
                    }
                }

                Object.entries(compiler_json["sources"]).forEach(([fn, contract]) => {
                    output["sources"][fn]["source"] = contract["content"];
                });
                let elapsed = process.hrtime(starting)
                console.info("Compiling took", elapsed.toString());
                starting = process.hrtime()
                let {ast: ast, ast_tree: ast_tree} = await get_ast(output);
                elapsed = process.hrtime(starting)
                console.log("Analyzing AST took", elapsed.toString());
                let invariants = null;
                try {
                    invariants = await get_invariants(ast_tree);
                } catch (e) {
                    console.error(e)
                }

                let sourcemap = null;

                if (contract_name) {
                    for (let [fn, contract] of Object.entries(output["contracts"])) {
                        for (let [_contract_name, contract_info] of Object.entries(contract)) {
                            if (_contract_name === contract_name) {
                                sourcemap = contract_info["evm"]["deployedBytecode"]["sourceMap"]
                            }
                        }
                    }
                } else {
                    sourcemap = {}
                    for (let [fn, contract] of Object.entries(output["contracts"])) {
                        sourcemap[fn] = {}
                        for (let [contract_name, contract_info] of Object.entries(contract)) {
                            sourcemap[fn][contract_name] = contract_info["evm"]["deployedBytecode"]["sourceMap"]
                        }
                    }
                }

                let bytecode = null;
                if (contract_name) {
                    for (let [fn, contract] of Object.entries(output["contracts"])) {
                        for (let [_contract_name, contract_info] of Object.entries(contract)) {
                            if (_contract_name === contract_name) {
                                bytecode = contract_info["evm"]["bytecode"]["object"]
                            }
                        }
                    }
                } else {
                    bytecode = {}
                    for (let [fn, contract] of Object.entries(output["contracts"])) {
                        bytecode[fn] = {}
                        for (let [contract_name, contract_info] of Object.entries(contract)) {
                            bytecode[fn][contract_name] = contract_info["evm"]["bytecode"]["object"]
                        }
                    }
                }

                let runtime_bytecode = null;
                if (contract_name) {
                    for (let [fn, contract] of Object.entries(output["contracts"])) {
                        for (let [_contract_name, contract_info] of Object.entries(contract)) {
                            if (_contract_name === contract_name) {
                                runtime_bytecode = contract_info["evm"]["deployedBytecode"]["object"]
                            }
                        }
                    }
                } else {
                    runtime_bytecode = {}
                    for (let [fn, contract] of Object.entries(output["contracts"])) {
                        runtime_bytecode[fn] = {}
                        for (let [contract_name, contract_info] of Object.entries(contract)) {
                            runtime_bytecode[fn][contract_name] = contract_info["evm"]["deployedBytecode"]["object"]
                        }
                    }
                }

                let abi = null;
                if (contract_name) {
                    for (let [fn, contract] of Object.entries(output["contracts"])) {
                        for (let [_contract_name, contract_info] of Object.entries(contract)) {
                            if (_contract_name === contract_name) {
                                abi = contract_info["abi"]
                            }
                        }
                    }
                } else {
                    abi = {}
                    for (let [fn, contract] of Object.entries(output["contracts"])) {
                        abi[fn] = {}
                        for (let [contract_name, contract_info] of Object.entries(contract)) {
                            abi[fn][contract_name] = contract_info["abi"]
                        }
                    }
                }
                let sources = null;
                sources = {};

                for (let [fn, contract] of Object.entries(output["sources"])) {
                    sources[fn] = {
                        id: contract["id"],
                        source: contract["source"]
                    };
                }

                let compiler_args = null;
                compiler_args = {
                    "version": compiler_version,
                    compiler_json
                }

                resolve({ success: true, remappings: compiler_json.settings["remappings"], ast, sourcemap, sources, bytecode, runtime_bytecode, abi, invariants, compiler_args })
            }
            
        });
    });

    return await promise;

}

module.exports = {
    build,
    auto_detect
}
