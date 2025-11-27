import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { setupWebSocket } from './websocket.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import logger from '../shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load version
const version = readFileSync(join(__dirname, '../VERSION'), 'utf-8').trim();
logger.info(`Starting DWI-BS Server v${version}`);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files
app.use(express.static(join(__dirname, '../client/public')));
app.use(express.json());

// Serve config.json
app.get('/config.json', (req, res) => {
  logger.debug('Serving config.json');
  res.sendFile(join(__dirname, 'config.json'));
});

// Setup WebSocket
setupWebSocket(wss);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT} (v${version})`);
});

