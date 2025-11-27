// Centralized logging system with production toggle
// Usage: import logger from './shared/logger.js';

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

class Logger {
  constructor() {
    // Enable logging by default, can be disabled via environment variable
    this.enabled = process.env.NODE_ENV !== 'production' || process.env.ENABLE_LOGS === 'true';
    this.level = this.enabled ? LOG_LEVELS.DEBUG : LOG_LEVELS.NONE;
    this.prefix = '[DWI-BS]';
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.level = enabled ? LOG_LEVELS.DEBUG : LOG_LEVELS.NONE;
  }

  setLevel(level) {
    if (!this.enabled) return;
    this.level = LOG_LEVELS[level] ?? LOG_LEVELS.DEBUG;
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    return `${this.prefix} [${timestamp}] [${levelStr}] ${message}`;
  }

  debug(message, ...args) {
    if (this.level <= LOG_LEVELS.DEBUG && this.enabled) {
      console.debug(this.formatMessage('DEBUG', message), ...args);
    }
  }

  info(message, ...args) {
    if (this.level <= LOG_LEVELS.INFO && this.enabled) {
      console.info(this.formatMessage('INFO', message), ...args);
    }
  }

  warn(message, ...args) {
    if (this.level <= LOG_LEVELS.WARN && this.enabled) {
      console.warn(this.formatMessage('WARN', message), ...args);
    }
  }

  error(message, ...args) {
    if (this.level <= LOG_LEVELS.ERROR && this.enabled) {
      console.error(this.formatMessage('ERROR', message), ...args);
    }
  }

  // Game-specific logging methods
  game(message, ...args) {
    this.info(`[GAME] ${message}`, ...args);
  }

  websocket(message, ...args) {
    this.debug(`[WS] ${message}`, ...args);
  }

  player(playerId, message, ...args) {
    this.info(`[PLAYER:${playerId}] ${message}`, ...args);
  }

  room(roomId, message, ...args) {
    this.info(`[ROOM:${roomId}] ${message}`, ...args);
  }
}

// Client-side logger (for browser)
class ClientLogger {
  constructor() {
    // Enable in development, disable in production by default
    this.enabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_LOGS === 'true';
    this.level = this.enabled ? LOG_LEVELS.DEBUG : LOG_LEVELS.NONE;
    this.prefix = '[DWI-BS]';
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.level = enabled ? LOG_LEVELS.DEBUG : LOG_LEVELS.NONE;
  }

  setLevel(level) {
    if (!this.enabled) return;
    this.level = LOG_LEVELS[level] ?? LOG_LEVELS.DEBUG;
  }

  formatMessage(level, message) {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    return `${this.prefix} [${timestamp}] [${levelStr}] ${message}`;
  }

  debug(message, ...args) {
    if (this.level <= LOG_LEVELS.DEBUG && this.enabled) {
      console.debug(this.formatMessage('DEBUG', message), ...args);
    }
  }

  info(message, ...args) {
    if (this.level <= LOG_LEVELS.INFO && this.enabled) {
      console.info(this.formatMessage('INFO', message), ...args);
    }
  }

  warn(message, ...args) {
    if (this.level <= LOG_LEVELS.WARN && this.enabled) {
      console.warn(this.formatMessage('WARN', message), ...args);
    }
  }

  error(message, ...args) {
    if (this.level <= LOG_LEVELS.ERROR && this.enabled) {
      console.error(this.formatMessage('ERROR', message), ...args);
    }
  }

  game(message, ...args) {
    this.info(`[GAME] ${message}`, ...args);
  }

  websocket(message, ...args) {
    this.debug(`[WS] ${message}`, ...args);
  }
}

// Export appropriate logger based on environment
let logger;
if (typeof window === 'undefined') {
  // Server-side
  logger = new Logger();
} else {
  // Client-side
  logger = new ClientLogger();
}

export default logger;

