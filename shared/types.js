// Game state types and constants

export const GAME_PHASES = {
  WAITING: 'waiting',
  BUILD: 'build',
  BATTLE: 'battle',
  GAME_OVER: 'gameOver'
};

export const MESSAGE_TYPES = {
  // Client -> Server
  JOIN_ROOM: 'joinRoom',
  CREATE_ROOM: 'createRoom',
  PLACE_UNITS: 'placeUnits',
  READY: 'ready',
  REQUEST_SHOT: 'requestShot',
  
  // Server -> Client
  ROOM_UPDATE: 'roomUpdate',
  BUILD_PHASE_STATE: 'buildPhaseState',
  BATTLE_STATE: 'battleState',
  MANA_UPDATE: 'manaUpdate',
  TURN_CHANGE: 'turnChange',
  APPLY_DAMAGE: 'applyDamage',
  SHOT_REJECTED: 'shotRejected',
  GAME_OVER: 'gameOver',
  ERROR: 'error'
};

export class Unit {
  constructor(id, type, x, y, playerId) {
    this.id = id;
    this.type = type;
    this.x = x;
    this.y = y;
    this.playerId = playerId;
    this.health = 100;
    this.destroyed = false;
  }
}

export class Launcher extends Unit {
  constructor(id, type, x, y, playerId, config) {
    super(id, type, x, y, playerId);
    this.config = config;
    this.health = 100;
  }
}

export class Defense extends Unit {
  constructor(id, type, x, y, playerId, config) {
    super(id, type, x, y, playerId);
    this.config = config;
    this.health = 100;
  }
}

