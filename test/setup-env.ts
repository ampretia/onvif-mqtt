// Keep tests quiet and avoid starting the pino-pretty worker thread (which can keep Jest workers alive)
process.env.PINO_LOG_LEVEL = 'silent';
process.env.LOG_FORMAT = 'json';
