import { GameManager } from './gameManager.js';
import { MESSAGE_TYPES, GAME_PHASES } from '../shared/types.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from '../shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load config
const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));

const rooms = new Map(); // roomId -> GameManager
const playerToRoom = new Map(); // ws -> roomId
const playerToId = new Map(); // ws -> playerId

export async function handleWebSocketConnection(ws, data) {
  switch (data.type) {
    case MESSAGE_TYPES.CREATE_ROOM:
      handleCreateRoom(ws, data);
      break;
    
    case MESSAGE_TYPES.JOIN_ROOM:
      handleJoinRoom(ws, data);
      break;
    
    case MESSAGE_TYPES.PLACE_UNITS:
      handlePlaceUnits(ws, data);
      break;
    
    case MESSAGE_TYPES.READY:
      handleReady(ws, data);
      break;
    
    case MESSAGE_TYPES.READY_TO_START:
      handleReadyToStart(ws, data);
      break;
    
    case MESSAGE_TYPES.REQUEST_SHOT:
      handleRequestShot(ws, data);
      break;
    
    case MESSAGE_TYPES.END_TURN:
      handleEndTurn(ws, data);
      break;
    
    default:
      ws.send(JSON.stringify({
        type: MESSAGE_TYPES.ERROR,
        message: 'Unknown message type'
      }));
  }
}

function handleCreateRoom(ws, data) {
  const roomId = generateRoomId();
  logger.room(roomId, 'Room created');
  const gameManager = new GameManager(roomId, config);
  
  const playerId = 'player1';
  gameManager.addPlayer(playerId, ws);
  
  rooms.set(roomId, gameManager);
  playerToRoom.set(ws, roomId);
  playerToId.set(ws, playerId);
  
  logger.room(roomId, `Player 1 joined (${playerId})`);
  
  // Start build phase for player1 immediately
  gameManager.startBuildPhase();
  
  ws.send(JSON.stringify({
    type: MESSAGE_TYPES.ROOM_UPDATE,
    roomId,
    playerId,
    players: 1,
    maxPlayers: 2
  }));
}

function handleJoinRoom(ws, data) {
  const { roomId } = data;
  logger.room(roomId, 'Join room request');
  const gameManager = rooms.get(roomId);
  
  if (!gameManager) {
    logger.warn(`Room not found: ${roomId}`);
    ws.send(JSON.stringify({
      type: MESSAGE_TYPES.ERROR,
      message: 'Room not found'
    }));
    return;
  }
  
  if (gameManager.getPlayerCount() >= 2) {
    logger.warn(`Room ${roomId} is full`);
    ws.send(JSON.stringify({
      type: MESSAGE_TYPES.ERROR,
      message: 'Room is full'
    }));
    return;
  }
  
  const playerId = 'player2';
  gameManager.addPlayer(playerId, ws);
  
  playerToRoom.set(ws, roomId);
  playerToId.set(ws, playerId);
  
  logger.room(roomId, `Player 2 joined (${playerId})`);
  
  // Notify both players
  gameManager.broadcast({
    type: MESSAGE_TYPES.ROOM_UPDATE,
    roomId,
    players: 2,
    maxPlayers: 2
  });
  
  // Start build phase (this will send BUILD_PHASE_STATE to both players)
  logger.room(roomId, 'Starting build phase for both players');
  gameManager.startBuildPhase();
  
  // Log to verify player2 received the message
  logger.room(roomId, `Player2 joined, build phase should be started. Phase: ${gameManager.phase}`);
}

function handlePlaceUnits(ws, data) {
  const roomId = playerToRoom.get(ws);
  if (!roomId) return;
  
  const gameManager = rooms.get(roomId);
  if (!gameManager) return;
  
  const playerId = playerToId.get(ws);
  const result = gameManager.placeUnits(playerId, data.units);
  
  if (result.success) {
    // Budget is already broadcasted in placeUnits, but send confirmation to the player
    ws.send(JSON.stringify({
      type: MESSAGE_TYPES.BUILD_PHASE_STATE,
      playerId,
      units: result.units,
      buildBudget: result.remainingBudget
    }));
  } else {
    ws.send(JSON.stringify({
      type: MESSAGE_TYPES.ERROR,
      message: result.error
    }));
  }
}

function handleReady(ws, data) {
  const roomId = playerToRoom.get(ws);
  if (!roomId) return;
  
  const gameManager = rooms.get(roomId);
  if (!gameManager) return;
  
  const playerId = playerToId.get(ws);
  gameManager.setPlayerReady(playerId);
  
  // Notify all players about ready status
  gameManager.broadcast({
    type: MESSAGE_TYPES.ROOM_UPDATE,
    roomId,
    players: gameManager.getPlayerCount(),
    readyPlayers: Array.from(gameManager.players.entries())
      .filter(([_, player]) => player.ready)
      .map(([id, _]) => id)
  });
  
  // Check if both ready, start battle
  if (gameManager.allPlayersReady()) {
    gameManager.startBattlePhase();
  }
}

function handleReadyToStart(ws, data) {
  const roomId = playerToRoom.get(ws);
  if (!roomId) return;
  
  const gameManager = rooms.get(roomId);
  if (!gameManager) return;
  
  // Check if all players have launchers before forcing battle phase
  if (!gameManager.allPlayersHaveLaunchers()) {
    logger.room(roomId, 'Cannot force start battle - not all players have launchers');
    // Ensure we're in BUILD phase
    gameManager.phase = GAME_PHASES.BUILD;
    // Don't mark players as ready, keep them in build phase
    gameManager.broadcast({
      type: MESSAGE_TYPES.ERROR,
      message: 'همه بازیکنان باید حداقل یک موشک‌انداز در زمین داشته باشند'
    });
    // Keep in BUILD phase - don't reset ready states here, let players manually ready
    // Send BUILD_PHASE_STATE to each player with their own budget
    gameManager.players.forEach((player, playerId) => {
      player.ws.send(JSON.stringify({
        type: MESSAGE_TYPES.BUILD_PHASE_STATE,
        phase: GAME_PHASES.BUILD,
        buildBudget: player.buildBudget,
        gridSize: gameManager.config.gridSize
      }));
    });
    return;
  }
  
  // Force start battle phase after 30 seconds
  // Mark all players as ready
  gameManager.players.forEach((player, playerId) => {
    player.ready = true;
  });
  
  // Start battle phase
  gameManager.startBattlePhase();
}

function handleRequestShot(ws, data) {
  const roomId = playerToRoom.get(ws);
  if (!roomId) return;
  
  const gameManager = rooms.get(roomId);
  if (!gameManager) return;
  
  const playerId = playerToId.get(ws);
  logger.room(roomId, `Shot request from ${playerId}`, {
    launcherId: data.launcherId,
    pathLength: data.pathTiles?.length || 0
  });
  const result = gameManager.processShot(playerId, data.launcherId, data.pathTiles);
  
  if (!result.success) {
    logger.room(roomId, `Shot rejected: ${result.error}`, {
      playerId,
      launcherId: data.launcherId,
      pathLength: data.pathTiles?.length || 0
    });
    ws.send(JSON.stringify({
      type: MESSAGE_TYPES.SHOT_REJECTED,
      reason: result.error
    }));
    return;
  }
  
  if (result.success) {
    logger.room(roomId, `Shot successful, intercepted: ${result.intercepted}`);
    gameManager.broadcast({
      type: MESSAGE_TYPES.APPLY_DAMAGE,
      attackerId: playerId,
      launcherId: data.launcherId,
      pathTiles: data.pathTiles,
      damage: result.damage,
      intercepted: result.intercepted,
      targetCells: result.targetCells
    });
    
    // Update mana
    gameManager.updateManaAfterShot(playerId, data.launcherId);
    
    // Switch turn after shot
    gameManager.switchTurn();
    
    // Check win condition
    const winner = gameManager.checkWinCondition();
    if (winner) {
      logger.room(roomId, `Game over! Winner: ${winner}`);
      gameManager.broadcast({
        type: MESSAGE_TYPES.GAME_OVER,
        winner
      });
    } else {
      // Switch turn after shot
      logger.room(roomId, 'Switching turn after shot');
      gameManager.switchTurn();
    }
  } else {
    logger.warn(`Shot rejected: ${result.error}`);
    ws.send(JSON.stringify({
      type: MESSAGE_TYPES.SHOT_REJECTED,
      reason: result.error
    }));
  }
}

function handleEndTurn(ws, data) {
  const roomId = playerToRoom.get(ws);
  if (!roomId) return;
  
  const gameManager = rooms.get(roomId);
  if (!gameManager) return;
  
  const playerId = playerToId.get(ws);
  
  // Only allow ending turn if it's the player's turn
  if (gameManager.currentTurn !== playerId) {
    return;
  }
  
  // Switch turn without firing
  gameManager.switchTurn();
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

