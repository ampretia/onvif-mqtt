module.exports = {
    verbose: true,
    setupFiles: ['<rootDir>/test/setup-env.ts'],
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