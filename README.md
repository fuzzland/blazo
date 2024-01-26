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
  -d, --daemon            Run in daemon mode
  -s, --auto-start        Automatically run ityfuzz after building
  -f, --setup-file        Specify the setup file to use
  -p, --printing          Print the output in real-time if true
  --help                  Show help
  --version               Show version

EXAMPLES
  $ blazo ./ -s
```

```
USAGE
  $ blazo create <type>

OPTIONS
  -n, --chain                 Chain for onchain type (e.g., ETH)
  -b, --block-number          Block number for onchain type
  -t, --contract-addresses    Contract addresses for onchain type (Multiple comma-separated)
  -p, --project-type          Type of the project for offchain
  -f, --file                  File path for offchain
  -c, --compiler-version      Compiler version for offchain
```

If you are going to create a task from local, you need to set up your **BLAZ_API_KEY** as an environment variable. You can get the API key from https://blaz.ai/account/apikeys

```sh-session
$ export BLAZ_API_KEY=YOUR_BLAZ_API_KEY
$ blazo create offchain ./ -c v0.8.21+commit.d9974bed
```

## Features

- Support for hardhat and foundry projects
- Use native compiler and support compilation caching
- Generate coverage html
- Create task from local

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
