
const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

let currentLevel = LEVELS.info;

export function setLogLevel(level) {
    if (level === undefined || level === null) return;
    const normalized = String(level).toLowerCase().trim();
    if (normalized in LEVELS) {
        currentLevel = LEVELS[normalized];
    }
}

if (typeof process !== 'undefined' && process.env && process.env.LOG_LEVEL) {
    setLogLevel(process.env.LOG_LEVEL);
}

function emit(level, method, args) {
    if (LEVELS[level] <= currentLevel) {
        console[method](...args);
    }
}

export const logger = {
    error: (...args) => emit('error', 'error', args),
    warn: (...args) => emit('warn', 'warn', args),
    info: (...args) => emit('info', 'log', args),
    debug: (...args) => emit('debug', 'log', args),
};
