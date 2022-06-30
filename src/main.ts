/*
SPDX-License-Identifier: Apache-2.0
*/

import * as sourceMapSupport from 'source-map-support';
sourceMapSupport.install();

// import * as env from 'env-var';
import { logger } from './logger';
import chalk = require('chalk');
import { readFileSync } from 'fs';
import path = require('path');

logger.debug('Starting runhfsc...');

const pjson = readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8');
const version = JSON.parse(pjson).version;

console.log(
    chalk.blue.bold(`
                    _ ____                            __  __ 
  ____  ____ _   __(_) __/           ____ ___  ____ _/ /_/ /_
 / __ \\/ __ \\ | / / / /_   ______   / __ \`__ \\/ __ \`/ __/ __/
/ /_/ / / / / |/ / / __/  /_____/  / / / / / / /_/ / /_/ /_  
\\____/_/ /_/|___/_/_/             /_/ /_/ /_/\\__, /\\__/\\__/  
                                               /_/           
`) +
        `
runhfsc ${version}
`,
);

/** Main function */
const main = async () => {
    logger.info('hello');
};

main().catch((e: any) => {
    console.log(e);
    process.exit(1);
});
