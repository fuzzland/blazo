const {
    ASTReader,
    ASTWriter, CompileFailedError,
    compileSol,
    DefaultASTWriterMapping,
    LatestCompilerVersion,
    PrettyFormatter, compileJson
} = require("solc-typed-ast")
const {compileJsonData} = require("solc-typed-ast");


function write_ast_to_instrumented_code(ast) {
    const reader = new ASTReader();
    const sourceUnits = reader.read(ast.data);
    const formatter = new PrettyFormatter(4, 0);
    const writer = new ASTWriter(
        DefaultASTWriterMapping,
        formatter,
        ast.compilerVersion ? ast.compilerVersion : LatestCompilerVersion
    );

    let source_info = {};

    for (const sourceUnit of sourceUnits) {
        const file_name = sourceUnit.absolutePath;
        const header = [
            sourceUnit.vPragmaDirectives,
            sourceUnit.vImportDirectives,
            sourceUnit.vEnums,
            sourceUnit.vStructs,
            sourceUnit.vUserDefinedValueTypes,
            sourceUnit.vUsingForDirectives,
            sourceUnit.vVariables,
            sourceUnit.vErrors,
            sourceUnit.vFunctions,
        ].map(
            (nodes) => {
                return nodes.map(
                    (node) => writer.write(node)
                ).filter(
                    (x) => x.length > 0
                ).join("\n")
            }
        ).filter(
            (x) => x.length > 0
        ).join("\n");

        let contract_info = [];

        for (const contract of sourceUnit.vContracts) {
            const contract_header = [
                contract.vUsingForDirectives,
                contract.vEnums,
                contract.vUserDefinedValueTypes,
                contract.vErrors,
                contract.vEvents,
                contract.vStructs,
            ].map(
                (nodes) => {
                    return nodes.map(
                        (node) => writer.write(node)
                    )
                        .filter(x => x.length > 0)
                        .join("\n")
                }
            )
                .filter(x => x.length > 0)
                .join("\n");

            const state_variables = contract.vStateVariables.map(
                (x) => {
                    return {
                        "name": x.name,
                        "docs": typeof x.documentation === "string" ? x.documentation : writer.write(x.documentation),
                        "type": writer.write(x.vType),
                        "body": writer.write(x)
                    }
                }
            );
            const functions = contract.vFunctions.map(
                (x) => {
                    return {
                        "name": x.name,
                        "docs": typeof x.documentation === "string" ? x.documentation : writer.write(x.documentation),
                        "args": x.vParameters.vParameters.map(
                            (y) => {
                                return {
                                    "name": y.name,
                                    "type": writer.write(y.vType)
                                }
                            }),
                        "rets": x.vReturnParameters.vParameters.map(
                            (y) => {
                                return {
                                    "name": y.name,
                                    "type": writer.write(y.vType)
                                }
                            }),
                        "source": writer.write(x),
                        "constructor": x.isConstructor,
                        "implemented": x.implemented,
                        "visibility": x.visibility.toString(),
                        "virtual": x.virtual,
                    }
                }
            );

            const modifiers = contract.vModifiers.map(
                (x) => writer.write(x)
            );


            contract_info.push(
                {
                    "name": contract.name,
                    "docs": typeof contract.documentation === "string" ? contract.documentation : writer.write(contract.documentation),
                    contract_header,
                    modifiers,
                    state_variables,
                    functions,
                }
            );
        }


        source_info[file_name] = {
            "header": header,
            "contracts": contract_info
        }

    }

    return {
        ast: source_info,
        ast_tree: sourceUnits
    };
}


function get_scribble_args(call_node) {
    let args = call_node.arguments?.map(
        (x) => {
            return x.value || x.name
        }
    );

    if (args && args.length > 0) {
        return args.join(",");
    }

    let arg_tys = call_node.argumentTypes?.map(
        (x) => {
            return x.typeString.replace(/literal_string \"/g, "").slice(0, -1)
        }
    );
    if (arg_tys && arg_tys.length > 0) {
        return arg_tys.join(",");
    }

    return "Unknown Invariant"

}

async function get_invariants(sourceUnits) {
    let unnamed_counter = 0;
    const invariants_info = []
    for (const sourceUnit of sourceUnits) {
        for (const contract of sourceUnit.vContracts) {
            if (contract.name === "FuzzLand" || contract.name.startsWith("__ScribbleUtilsLib")) {
                continue;
            }

            for (const func of contract.vFunctions) {
                if (func.name.startsWith("echidna_")) {
                    invariants_info.push({
                        "name": func.name,
                        "type": "echidna"
                    })
                }

                func.walk((node) => {
                    if (
                        node.raw?.nodeType === "FunctionCall"
                    ) {
                        let function_name = node.raw?.expression?.name;
                        if (!function_name) {
                            let block_name = node.raw?.expression?.expression?.name;
                            let func_name = node.raw?.expression?.memberName;

                            if (block_name === "FuzzLand") {
                                if (func_name === "bug") {
                                    invariants_info.push({
                                        "name": `Unnamed Bug ${unnamed_counter}`,
                                        "type": "bug"
                                    })
                                    unnamed_counter += 1;
                                }

                                if (func_name === "typed_bug") {
                                    let args = get_scribble_args(node.raw)
                                    invariants_info.push({
                                        "name": args,
                                        "type": "typed_bug"
                                    })
                                }
                            }

                            if (block_name?.includes("Scribble")) {
                                if (func_name === "assertionFailed") {
                                    let args = get_scribble_args(node.raw)
                                    invariants_info.push({
                                        "name": args,
                                        "type": "scribble"
                                    })
                                }
                            }
                        }
                    }

                    if (
                        node.raw?.nodeType === "EmitStatement"
                    ) {
                        let event_call = node.raw?.eventCall?.expression;

                        if (event_call?.name === "AssertionFailed") {
                            let args = get_scribble_args(event_call);
                            invariants_info.push({
                                "name": args,
                                "type": "typed_bug"
                            })
                        } else if (event_call?.memberName === "AssertionFailed" && event_call?.expression?.name?.includes("Scribble")) {
                            let args = get_scribble_args(event_call);
                            invariants_info.push({
                                "name": args,
                                "type": "scribble"
                            })
                        }
                    }
                })
            }
        }
    }

    return invariants_info;
}


async function get_ast(source_json_with_ast) {
    try {
        let result = await compileJsonData("sample.json", source_json_with_ast, "auto", []);
        return write_ast_to_instrumented_code(result);
    } catch (e) {
        if (e instanceof CompileFailedError) {
            console.error("Compile errors encountered:");

            for (const failure of e.failures) {
                console.error(`Solc ${failure.compilerVersion}:`);

                for (const error of failure.errors) {
                    console.error(error);
                }
            }
        } else {
            console.error(e.message);
        }
    }
}

module.exports = {
    get_ast,
    get_invariants
}