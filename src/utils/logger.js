import winston from 'winston';

const level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

const format = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    process.env.NODE_ENV === 'production'
        ? winston.format.json()
        : winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message} ${info.stack ? '\n' + info.stack : ''}`)
);

const transports = [
    new winston.transports.Console({
         format: winston.format.combine(
             process.env.NODE_ENV !== 'production' ? winston.format.colorize() : winston.format.uncolorize(),
             format
         )
    })
    // Add File/CloudWatch/etc. transports for production here
];

const logger = winston.createLogger({
    level: level,
    format: format,
    transports: transports,
    exceptionHandlers: [ new winston.transports.Console() /* , new winston.transports.File({ filename: 'exceptions.log' }) */ ],
    rejectionHandlers: [ new winston.transports.Console() /* , new winston.transports.File({ filename: 'rejections.log' }) */ ],
    exitOnError: false,
});

logger.info(`Logger configured for ${process.env.NODE_ENV} environment with level ${level}`);

export default logger;