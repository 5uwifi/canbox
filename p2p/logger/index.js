const { createLogger, format, transports } = require('winston');
const { combine, timestamp, splat, simple, printf } = format;

const logger = createLogger({
    'level': process.env['LOG_LEVEL'] || 'error',
    'format': combine(
        splat(),
        simple(),
        timestamp(),
        printf(info => {
          return `${info.timestamp} ${info.level}: ${info.message}`;
        })
    ),
    'transports': [
        new transports.Console()
    ]
});

module.exports = {
    logger
};
