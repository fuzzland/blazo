#!/usr/bin/env node
const {build, auto_detect} = require('./builder');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const { table } = require('table');

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

async function build_with_autodetect(project, projectType, compiler_version) {
    if (!projectType) {
        projectType = await auto_detect(project);
    }
    let results = await build(projectType, project, compiler_version);
    fs.writeFileSync("results.json", JSON.stringify(results, null, 4));
    visualize(results);
    console.log("Results written to results.json")
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
                await build_with_autodetect(argv.project, argv.projectType);
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
    .demandOption(['project'], 'Please provide the project argument to proceed')
    .help()
    .argv;


