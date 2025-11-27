import { Launcher, Defense, GAME_PHASES, MESSAGE_TYPES } from '../shared/types.js';
import { validatePath } from './validators/path.js';
import { checkDefenseInterception } from './validators/defense.js';
import { calculateAOEDamage } from './validators/aoe.js';
import { validateMana } from './validators/mana.js';
import { checkWinCondition } from './validators/win.js';
import logger from '../shared/logger.js';

export class GameManager {
  constructor(roomId, config) {
    this.roomId = roomId;
    this.config = config;
    this.players = new Map(); // playerId -> { ws, units, ready, mana, shotsThisTurn }
    this.phase = GAME_PHASES.WAITING;
    this.currentTurn = null;
  }

  addPlayer(playerId, ws) {
    this.players.set(playerId, {
      ws,
      units: {
        launchers: [],
        defenses: []
      },
      ready: false,
      mana: this.config.mana.startMana,
      shotsThisTurn: 0,
      budget: this.config.budget
    });
  }

  getPlayerCount() {
    return this.players.size;
  }

  broadcast(message) {
    this.players.forEach((player) => {
      if (player.ws.readyState === 1) { // WebSocket.OPEN
        player.ws.send(JSON.stringify(message));
      }
    });
  }

  startBuildPhase() {
    this.phase = GAME_PHASES.BUILD;
    logger.room(this.roomId, 'Build phase started');
    this.broadcast({
      type: MESSAGE_TYPES.BUILD_PHASE_STATE,
      phase: GAME_PHASES.BUILD,
      budget: this.config.budget,
      gridSize: this.config.gridSize
    });
  }

  placeUnits(playerId, units) {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    if (this.phase !== GAME_PHASES.BUILD) {
      return { success: false, error: 'Not in build phase' };
    }

    let totalCost = 0;
    const placedUnits = {
      launchers: [],
      defenses: []
    };

    // Validate and calculate cost
    for (const unit of units) {
      const unitConfig = unit.type === 'launcher'
        ? this.config.launchers.find(l => l.id === unit.launcherType)
        : this.config.defenses.find(d => d.id === unit.defenseType);

      if (!unitConfig) {
        return { success: false, error: `Invalid unit type: ${unit.type}` };
      }

      totalCost += unitConfig.cost;

      if (unit.type === 'launcher') {
        placedUnits.launchers.push(new Launcher(
          `launcher_${Date.now()}_${Math.random()}`,
          unit.launcherType,
          unit.x,
          unit.y,
          playerId,
          unitConfig
        ));
      } else {
        placedUnits.defenses.push(new Defense(
          `defense_${Date.now()}_${Math.random()}`,
          unit.defenseType,
          unit.x,
          unit.y,
          playerId,
          unitConfig
        ));
      }
    }

    if (totalCost > player.budget) {
      return { success: false, error: 'Insufficient budget' };
    }

    // Validate grid bounds
    for (const launcher of placedUnits.launchers) {
      if (launcher.x < 0 || launcher.x >= this.config.gridSize ||
          launcher.y < 0 || launcher.y >= this.config.gridSize) {
        return { success: false, error: 'Unit out of bounds' };
      }
    }

    for (const defense of placedUnits.defenses) {
      if (defense.x < 0 || defense.x >= this.config.gridSize ||
          defense.y < 0 || defense.y >= this.config.gridSize) {
        return { success: false, error: 'Unit out of bounds' };
      }
    }

    // Place units
    player.units.launchers = placedUnits.launchers;
    player.units.defenses = placedUnits.defenses;
    player.budget -= totalCost;

    return {
      success: true,
      units: placedUnits,
      remainingBudget: player.budget
    };
  }

  setPlayerReady(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      player.ready = true;
    }
  }

  allPlayersReady() {
    if (this.players.size < 2) return false;
    for (const player of this.players.values()) {
      if (!player.ready) return false;
    }
    return true;
  }

  startBattlePhase() {
    this.phase = GAME_PHASES.BATTLE;
    this.currentTurn = 'player1';
    logger.room(this.roomId, 'Battle phase started');
    
    // Reset mana and shots for both players
    this.players.forEach((player) => {
      player.mana = this.config.mana.startMana;
      player.shotsThisTurn = 0;
    });

    logger.room(this.roomId, `Turn: ${this.currentTurn}`);
    this.broadcast({
      type: MESSAGE_TYPES.BATTLE_STATE,
      phase: GAME_PHASES.BATTLE,
      currentTurn: this.currentTurn,
      mana: {
        player1: this.players.get('player1').mana,
        player2: this.players.get('player2').mana
      }
    });
  }

  processShot(playerId, launcherId, pathTiles) {
    logger.player(playerId, `Shot request: launcher=${launcherId}, pathLength=${pathTiles.length}`);
    
    if (this.phase !== GAME_PHASES.BATTLE) {
      logger.warn(`Shot rejected: Not in battle phase (phase=${this.phase})`);
      return { success: false, error: 'Not in battle phase' };
    }

    if (this.currentTurn !== playerId) {
      logger.warn(`Shot rejected: Not player's turn (current=${this.currentTurn}, requested=${playerId})`);
      return { success: false, error: 'Not your turn' };
    }

    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    // Find launcher
    const launcher = player.units.launchers.find(l => l.id === launcherId);
    if (!launcher) {
      return { success: false, error: 'Launcher not found' };
    }

    if (launcher.destroyed) {
      return { success: false, error: 'Launcher is destroyed' };
    }

    // Validate mana
    const manaCheck = validateMana(player, launcher.config, this.config.mana);
    if (!manaCheck.success) {
      return { success: false, error: manaCheck.error };
    }

    // Validate shots per turn
    if (player.shotsThisTurn >= this.config.mana.maxShotsPerTurn) {
      return { success: false, error: 'Max shots per turn reached' };
    }

    // Validate path
    const pathCheck = validatePath(pathTiles, launcher.config.range, this.config.gridSize);
    if (!pathCheck.success) {
      return { success: false, error: pathCheck.error };
    }

    // Get opponent
    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
    const opponent = this.players.get(opponentId);

    // Check defense interception
    const interception = checkDefenseInterception(
      pathTiles,
      opponent.units.defenses,
      this.config.gridSize
    );

    let damage = null;
    let targetCells = [];

    if (!interception.intercepted) {
      // Calculate AoE damage
      const lastTile = pathTiles[pathTiles.length - 1];
      const aoeResult = calculateAOEDamage(
        lastTile.x,
        lastTile.y,
        launcher.config.aoe,
        opponent.units,
        this.config.gridSize
      );
      damage = aoeResult.damage;
      targetCells = aoeResult.targetCells;
    }

    // Update shots
    player.shotsThisTurn++;

    return {
      success: true,
      intercepted: interception.intercepted,
      damage,
      targetCells,
      interceptionDefense: interception.defenseId
    };
  }

  updateManaAfterShot(playerId, launcherId) {
    const player = this.players.get(playerId);
    if (!player) return;

    const launcher = player.units.launchers.find(l => l.id === launcherId);
    if (launcher) {
      player.mana -= launcher.config.manaCost;
      player.mana = Math.max(0, player.mana);
    }

    this.broadcast({
      type: MESSAGE_TYPES.MANA_UPDATE,
      playerId,
      mana: player.mana
    });
  }

  switchTurn() {
    this.currentTurn = this.currentTurn === 'player1' ? 'player2' : 'player1';
    logger.room(this.roomId, `Turn switched to: ${this.currentTurn}`);
    
    // Reset shots and add mana per turn
    this.players.forEach((player, playerId) => {
      player.shotsThisTurn = 0;
      if (playerId === this.currentTurn) {
        const oldMana = player.mana;
        player.mana = Math.min(
          player.mana + this.config.mana.manaPerTurn,
          this.config.mana.maxMana
        );
        logger.player(playerId, `Mana updated: ${oldMana} -> ${player.mana}`);
      }
    });

    this.broadcast({
      type: MESSAGE_TYPES.TURN_CHANGE,
      currentTurn: this.currentTurn,
      mana: {
        player1: this.players.get('player1').mana,
        player2: this.players.get('player2').mana
      }
    });
  }

  checkWinCondition() {
    for (const [playerId, player] of this.players.entries()) {
      const aliveLaunchers = player.units.launchers.filter(l => !l.destroyed);
      if (aliveLaunchers.length === 0) {
        return playerId === 'player1' ? 'player2' : 'player1';
      }
    }
    return null;
  }
}

