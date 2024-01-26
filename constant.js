const INVARIANTS_ITEMS = {
    'Common Vulnerabilities': [
        {
            name: 'Balance Extraction',
            description: 'Detect whether the attackers can steal ETH / native tokens from the contract.',
        },
        {
            name: 'Token Extraction',
            description: 'Detect whether the attackers can steal ERC20 / ERC721 tokens from the contract.',
        },
        {
            name: 'Uniswap Pair Issues',
            description: 'Identify misuse of Uniswap pair that could lead to price manipulation attacks.',
        },
        {
            name: 'ChainLink Issues',
            description: 'Identify misuse of Chainlink that could lead to a range of different attacks.',
        },
        {
            name: 'Arbitrary Selfdestruct',
            description: 'Detect whether the attackers can make contract self-destruct.',
        },
    ],
    'Custom Invariants': [
        {
            name: 'FuzzLand Violations',
            description:
                'You can insert <code>emit AssertionFailed(string)</code> into your code to indicate that the invariant is broken and the violation has happened. Blaz uses this event to determine whether a violation has happened.',
            keys: ['bug', 'typed_bug'],
        },
        {
            name: 'Echidna Violations',
            description:
                'You can insert Echidna invariants into your code. Blaz will use those invariant functions to determine whether a violation has happened.',
            keys: ['echidna'],
        },
        {
            name: 'Scribble Violations',
            description:
                'You can insert Scribble assertions into your code and Blaz would check those assertions. Note that you need to upload the Scribble instrumented file to Blaz.',
            keys: ['scribble'],
        },
    ],
};

module.exports = {
    INVARIANTS_ITEMS,
};
