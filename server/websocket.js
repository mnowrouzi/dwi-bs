import { handleWebSocketConnection } from './rooms.js';
import logger from '../shared/logger.js';

export function setupWebSocket(wss) {
  wss.on('connection', (ws) => {
    logger.websocket('New WebSocket connection');
    
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        logger.websocket(`Received message: ${data.type}`, data);
        await handleWebSocketConnection(ws, data);
      } catch (error) {
        logger.error('Error handling message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format'
        }));
      }
    });

    ws.on('close', () => {
      logger.websocket('WebSocket connection closed');
    });

    ws.on('error', (error) => {
      logger.error('WebSocket error:', error);
    });
  });
}



