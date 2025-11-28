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
    this.players = new Map(); // playerId -> { ws, units, ready, mana, shotsThisTurn, launcherShotsThisTurn, buildBudget }
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
      launcherShotsThisTurn: new Map(), // launcherId -> count
      buildBudget: this.config.buildBudget // Each player has their own build budget
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
    // Reset each player's budget when build phase starts
    this.players.forEach((player, playerId) => {
      player.buildBudget = this.config.buildBudget;
      logger.player(playerId, `Build budget reset to ${player.buildBudget}`);
    });
    logger.room(this.roomId, 'Build phase started', {
      playerCount: this.players.size,
      playerIds: Array.from(this.players.keys())
    });
    
    // Send build phase state to each player with their own budget
    this.players.forEach((player, playerId) => {
      const message = {
        type: MESSAGE_TYPES.BUILD_PHASE_STATE,
        phase: GAME_PHASES.BUILD,
        buildBudget: player.buildBudget,
        gridSize: this.config.gridSize,
        playerId: playerId // Include playerId in message
      };
      logger.player(playerId, 'Sending BUILD_PHASE_STATE', message);
      player.ws.send(JSON.stringify(message));
    });
  }

  placeUnits(playerId, units) {
    const player = this.players.get(playerId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    logger.room(this.roomId, `placeUnits called by ${playerId}`, {
      currentPhase: this.phase,
      expectedPhase: GAME_PHASES.BUILD,
      playerCount: this.players.size,
      unitsCount: units?.length || 0
    });

    if (this.phase !== GAME_PHASES.BUILD) {
      logger.room(this.roomId, `Cannot place units - not in build phase`, {
        currentPhase: this.phase,
        expectedPhase: GAME_PHASES.BUILD
      });
      return { success: false, error: 'Not in build phase' };
    }

    // Calculate total cost of new units
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

    // Calculate cost of old units (to refund)
    let oldCost = 0;
    for (const launcher of player.units.launchers) {
      oldCost += launcher.config.cost;
    }
    for (const defense of player.units.defenses) {
      oldCost += defense.config.cost;
    }

    // Refund old units cost and deduct new units cost
    const costDifference = totalCost - oldCost;
    
    // Check if player has enough budget for the difference
    if (costDifference > player.buildBudget) {
      return { success: false, error: 'Insufficient budget' };
    }

    // Validate grid bounds (with size support)
    for (const launcher of placedUnits.launchers) {
      const [sizeX, sizeY] = launcher.config.size;
      if (launcher.x < 0 || launcher.x + sizeX > this.config.gridSize ||
          launcher.y < 0 || launcher.y + sizeY > this.config.gridSize) {
        return { success: false, error: 'Launcher out of bounds' };
      }
    }

    for (const defense of placedUnits.defenses) {
      const [sizeX, sizeY] = defense.config.size || [1, 1];
      if (defense.x < 0 || defense.x + sizeX > this.config.gridSize ||
          defense.y < 0 || defense.y + sizeY > this.config.gridSize) {
        return { success: false, error: 'Defense out of bounds' };
      }
    }

    // Place units
    player.units.launchers = placedUnits.launchers;
    player.units.defenses = placedUnits.defenses;
    
    // Update player's budget (refund old, deduct new)
    player.buildBudget -= costDifference;
    
    // Send updated budget only to the player who placed units
    player.ws.send(JSON.stringify({
      type: MESSAGE_TYPES.BUILD_PHASE_STATE,
      phase: GAME_PHASES.BUILD,
      buildBudget: player.buildBudget,
      gridSize: this.config.gridSize
    }));

    return {
      success: true,
      units: placedUnits,
      remainingBudget: player.buildBudget
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

  // Check if all players have at least one launcher
  allPlayersHaveLaunchers() {
    for (const [playerId, player] of this.players.entries()) {
      const launchers = player.units.launchers || [];
      const aliveLaunchers = launchers.filter(l => !l.destroyed);
      if (aliveLaunchers.length === 0) {
        logger.room(this.roomId, `Player ${playerId} has no launchers`);
        return false;
      }
    }
    return true;
  }

  startBattlePhase() {
    // Check if all players have at least one launcher before starting battle
    if (!this.allPlayersHaveLaunchers()) {
      logger.room(this.roomId, 'Cannot start battle phase - not all players have launchers');
      
      // Ensure we're in BUILD phase
      this.phase = GAME_PHASES.BUILD;
      
      // Reset ready state so players can add launchers and try again
      this.players.forEach((player, playerId) => {
        player.ready = false;
        logger.room(this.roomId, `Reset ready state for ${playerId} - need to add launchers`);
      });
      
      // Broadcast error and keep in BUILD phase
      this.broadcast({
        type: MESSAGE_TYPES.ERROR,
        message: 'همه بازیکنان باید حداقل یک موشک‌انداز در زمین داشته باشند'
      });
      
      // Send BUILD_PHASE_STATE to each player with their own budget
      this.players.forEach((player, playerId) => {
        player.ws.send(JSON.stringify({
          type: MESSAGE_TYPES.BUILD_PHASE_STATE,
          phase: GAME_PHASES.BUILD,
          buildBudget: player.buildBudget,
          gridSize: this.config.gridSize
        }));
      });
      
      return;
    }
    
    this.phase = GAME_PHASES.BATTLE;
    this.currentTurn = 'player1';
    logger.room(this.roomId, 'Battle phase started');
    
    // Reset mana and shots for both players
    // Player1 gets manaPerTurn added because they're starting the first turn
    // Player2 starts with startMana only (they'll get manaPerTurn when their turn starts)
    this.players.forEach((player, playerId) => {
      if (playerId === 'player1') {
        // Player1 gets startMana + manaPerTurn for their first turn
        player.mana = Math.min(
          this.config.mana.startMana + this.config.mana.manaPerTurn,
          this.config.mana.maxMana
        );
        logger.player(playerId, `First turn mana: ${this.config.mana.startMana} + ${this.config.mana.manaPerTurn} = ${player.mana}`);
      } else {
        // Player2 starts with just startMana (will get manaPerTurn when turn switches to them)
        player.mana = this.config.mana.startMana;
        logger.player(playerId, `Initial mana: ${player.mana} (will get +${this.config.mana.manaPerTurn} when turn starts)`);
      }
      player.shotsThisTurn = 0;
      player.launcherShotsThisTurn = new Map();
    });

    logger.room(this.roomId, `Turn: ${this.currentTurn}`);
    
    // Send battle state to each player with their own units
    this.players.forEach((player, playerId) => {
      player.ws.send(JSON.stringify({
        type: MESSAGE_TYPES.BATTLE_STATE,
        phase: GAME_PHASES.BATTLE,
        currentTurn: this.currentTurn,
        mana: {
          player1: this.players.get('player1').mana,
          player2: this.players.get('player2').mana
        },
        units: {
          launchers: player.units.launchers.map(l => ({
            id: l.id,
            type: l.type,
            x: l.x,
            y: l.y,
            destroyed: l.destroyed
          })),
          defenses: player.units.defenses.map(d => ({
            id: d.id,
            type: d.type,
            x: d.x,
            y: d.y,
            destroyed: d.destroyed
          }))
        }
      }));
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
    
    // Validate shots per launcher per turn
    const launcherShots = player.launcherShotsThisTurn.get(launcherId) || 0;
    const maxShotsPerLauncher = this.config.mana.maxShotsPerLauncherPerTurn || 1;
    if (launcherShots >= maxShotsPerLauncher) {
      return { success: false, error: `Max shots per launcher per turn reached (${maxShotsPerLauncher})` };
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
    // launcherShots already calculated above, just increment
    player.launcherShotsThisTurn.set(launcherId, launcherShots + 1);

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
    const oldTurn = this.currentTurn;
    this.currentTurn = this.currentTurn === 'player1' ? 'player2' : 'player1';
    logger.room(this.roomId, `Turn switched from ${oldTurn} to: ${this.currentTurn}`);
    
    // Reset shots and add mana per turn
    this.players.forEach((player, playerId) => {
      player.shotsThisTurn = 0;
      player.launcherShotsThisTurn = new Map();
      if (playerId === this.currentTurn) {
        const oldMana = player.mana;
        player.mana = Math.min(
          player.mana + this.config.mana.manaPerTurn,
          this.config.mana.maxMana
        );
        logger.player(playerId, `Mana updated: ${oldMana} -> ${player.mana}`);
      }
    });

    const turnChangeMessage = {
      type: MESSAGE_TYPES.TURN_CHANGE,
      currentTurn: this.currentTurn,
      mana: {
        player1: this.players.get('player1').mana,
        player2: this.players.get('player2').mana
      }
    };
    
    logger.room(this.roomId, 'Broadcasting TURN_CHANGE', turnChangeMessage);
    this.broadcast(turnChangeMessage);
  }

  checkWinCondition() {
    // Win condition: All launchers of a team must be destroyed
    // Defenses don't count for win condition
    for (const [playerId, player] of this.players.entries()) {
      const aliveLaunchers = player.units.launchers.filter(l => !l.destroyed);
      if (aliveLaunchers.length === 0) {
        const winner = playerId === 'player1' ? 'player2' : 'player1';
        logger.room(this.roomId, `All launchers destroyed for ${playerId}. Winner: ${winner}`);
        return winner;
      }
    }
    return null;
  }
}

