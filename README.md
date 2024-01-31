# Blazo

Client for Blaz.ai (Smart Contract Fuzzing Service)

## Installation

**Requirements:**

- Python 3
- Node

```sh-session
$ npm i blazo -g
```

## Usage

```sh-session
$ blazo <project_directory>
```

## Commands

### Start command

```
USAGE
  $ blazo <project_directory>

OPTIONS
  -t, --project-type      Type of the project
  -c, --compiler-version  Specify the compiler version to use
  -s, --auto-start        Automatically run ityfuzz after building
  -f, --setup-file        Specify the setup file to use
  -p, --printing          Print the output in real-time if true
  -b, --blaz              Automatically run blaz services, create offchain task
  -o, --offchain-config   Specify the config file to use
  --help                  Show help
  --version               Show version

EXAMPLES
  $ blazo ./ -s
  $ blazo . --setup-file test/A.t.sol:InvariantExample1
  $ blazo . --offchain-config offchain-config.json
```

```
USAGE
  $ blazo create <type>

OPTIONS
  -n, --chain                 Chain for onchain type (e.g., ETH)
  -b, --block-number          Block number for onchain type
  -t, --contract-addresses    Contract addresses for onchain type (Multiple comma-separated)
```

If you are going to create a task from local, you need to set up your **API_KEY**, you can get the API key from https://blaz.ai/account/apikeys, and run the command below:

```sh-session
$ blazo configure
```

## Features

- Support for hardhat and foundry projects
- Use native compiler and support compilation caching
- Generate coverage html
- Run blaz services, support create task locally

## Outputs

**ityfuzz** generates the following files in the workdir directory, and results.json in root directory.

```
├── abis.json
├── corpus
├── coverage
├── coverage.html
├── coverage.json
├── coverage.txt
├── files.json
├── relations.log
└── traces
```

`results.json`

```json
[
  {
    "success": true,
    "remappings": [],
    "ast": {},
    "sourcemap": {},
    "sources": {},
    "bytecode": {},
    "runtime_bytecode": {},
    "abi": {},
    "invariants": [],
    "compiler_args": {},
    "address": {}
  }
]
```
