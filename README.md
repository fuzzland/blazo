# Blazo

Client for Blaz.ai (Smart Contract Fuzzing Service)

## Installation

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
  --help                  Show help
  --version               Show version

EXAMPLES
  $ blazo ./ -s
```

## Features

-   Support for hardhat and foundry projects
-   Use native compiler and support compilation caching
-   Generate coverage html

## Outputs
