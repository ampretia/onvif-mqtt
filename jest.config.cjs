module.exports = {
    verbose: true,
    transform: {
        '^.+\\.tsx?$': [
            '@swc/jest',
            {
                jsc: {
                    parser: { syntax: 'typescript', tsx: true },
                    target: 'es2022',
                },
                module: { type: 'commonjs' },
            },
        ],
    },
};