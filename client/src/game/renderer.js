import Phaser from 'phaser';
import { GRID_TILE_SIZE, GRID_OFFSET_X, GRID_OFFSET_Y } from '@shared/constants.js';
import { GAME_PHASES, MESSAGE_TYPES } from '@shared/types.js';
import { PathDrawer } from './pathDrawer.js';
import { UnitPlacement } from './unitPlacement.js';
import { ManaBar } from './manaBar.js';
import { Explosion } from './explosion.js';
import { AudioController } from './audioController.js';
import faTexts from '../i18n/fa.json';
import logger from '@shared/logger.js';

export class GameRenderer extends Phaser.Scene {
  constructor() {
    super({ key: 'GameRenderer' });
  }

  init(data) {
    if (!data || !data.config) {
      logger.error('GameRenderer.init: config is missing!', data);
      return;
    }
    
    this.config = data.config;
    this.gameState = data.gameState;
    this.onNotification = data.onNotification || (() => {});
    this.onPhaseChange = data.onPhaseChange || (() => {});
    
    this.gridSize = this.config.gridSize;
    this.playerUnits = { launchers: [], defenses: [] };
    this.opponentUnits = { launchers: [], defenses: [] };
    this.currentPhase = GAME_PHASES.BUILD;
    this.budget = this.config.budget;
    this.mana = this.config.mana.startMana;
    this.shotsThisTurn = 0;
    this.currentTurn = null;
    this.selectedLauncher = null;
    this.pathTiles = [];
    this.isDrawingPath = false;
    
    logger.info('GameRenderer initialized', { gridSize: this.gridSize, budget: this.budget });
  }

  preload() {
    // Check if config is available (should be set in init)
    if (!this.config) {
      logger.warn('GameRenderer.preload: config is not available yet, waiting...');
      // Retry after a short delay
      this.time.delayedCall(100, () => {
        if (this.config) {
          this.preload();
        }
      });
      return;
    }
    
    logger.info('GameRenderer.preload: Creating placeholder graphics...');
    
    // Create placeholder graphics
    this.createPlaceholderGraphics();
    
    // Load sounds (if available) - errors won't break the game
    try {
      this.audioController = new AudioController(this, this.config.sounds || {});
    } catch (e) {
      logger.warn('Audio controller initialization failed, continuing without sound:', e.message);
      // Create a minimal audio controller that does nothing
      this.audioController = {
        playSound: () => {},
        playBGM: () => {},
        stopBGM: () => {},
        setBGMVolume: () => {},
        setSFXVolume: () => {},
        toggleMute: () => {}
      };
    }
  }

  create() {
    // Check if config is available (should be set in init)
    if (!this.config || !this.gridSize) {
      logger.warn('GameRenderer.create: config or gridSize is not available, waiting...', {
        hasConfig: !!this.config,
        gridSize: this.gridSize
      });
      // Retry after a short delay
      this.time.delayedCall(100, () => {
        if (this.config && this.gridSize) {
          this.create();
        }
      });
      return;
    }
    
    logger.info('GameRenderer.create: Setting up game...', { gridSize: this.gridSize });
    
    // Setup grid
    this.setupGrid();
    
    // Setup UI
    this.setupUI();
    
    // Setup input
    this.setupInput();
    
    // Initialize systems
    this.pathDrawer = new PathDrawer(this);
    this.unitPlacement = new UnitPlacement(this, this.config);
    
    // Store logger reference for audio controller
    this.logger = logger;
    
    // Start build phase
    this.currentPhase = GAME_PHASES.BUILD;
    if (this.onPhaseChange) {
      this.onPhaseChange(this.currentPhase);
    }
    
    logger.info('GameRenderer.create: Game setup complete');
  }

  createPlaceholderGraphics() {
    // Create colored rectangles for units
    this.add.graphics()
      .fillStyle(0xffba00)
      .fillRect(0, 0, GRID_TILE_SIZE, GRID_TILE_SIZE * 2)
      .generateTexture('launcher_short', GRID_TILE_SIZE, GRID_TILE_SIZE * 2);
    
    this.add.graphics()
      .fillStyle(0xff6600)
      .fillRect(0, 0, GRID_TILE_SIZE, GRID_TILE_SIZE * 2)
      .generateTexture('launcher_medium', GRID_TILE_SIZE, GRID_TILE_SIZE * 2);
    
    this.add.graphics()
      .fillStyle(0xff0000)
      .fillRect(0, 0, GRID_TILE_SIZE * 2, GRID_TILE_SIZE * 2)
      .generateTexture('launcher_long', GRID_TILE_SIZE * 2, GRID_TILE_SIZE * 2);
    
    // Defense units (with size support)
    if (this.config && this.config.defenses) {
      this.config.defenses.forEach(defense => {
        const [sizeX, sizeY] = defense.size || [1, 1];
        const width = sizeX * GRID_TILE_SIZE;
        const height = sizeY * GRID_TILE_SIZE;
        
        this.add.graphics()
          .fillStyle(Phaser.Display.Color.HexStringToColor(defense.color || '#66ccff').color)
          .fillRect(0, 0, width, height)
          .lineStyle(2, 0xffffff, 0.5)
          .strokeRect(0, 0, width, height)
          .generateTexture(`defense_${defense.id}`, width, height);
      });
    }
    
    // Missile
    this.add.graphics()
      .fillStyle(0xffaa00)
      .fillRect(0, 0, 8, 16)
      .generateTexture('missile', 8, 16);
    
    // Explosion frames
    for (let i = 0; i < 12; i++) {
      const size = 20 + (i * 5);
      const alpha = 1 - (i / 12);
      this.add.graphics()
        .fillStyle(0xff6600, alpha)
        .fillCircle(size / 2, size / 2, size / 2)
        .generateTexture(`explosion_${i}`, size, size);
    }
  }

  setupGrid() {
    const tileSize = GRID_TILE_SIZE;
    const offsetX = GRID_OFFSET_X;
    const offsetY = GRID_OFFSET_Y;
    
    // Player grid
    this.playerGrid = this.add.graphics();
    this.drawGrid(this.playerGrid, offsetX, offsetY, this.gridSize, tileSize, 0x3f5765);
    
    // Opponent grid (fog of war)
    const opponentOffsetX = offsetX + (this.gridSize * tileSize) + 50;
    this.opponentGrid = this.add.graphics();
    this.drawGrid(this.opponentGrid, opponentOffsetX, offsetY, this.gridSize, tileSize, 0x2b3a42);
    
    // Grid labels
    this.add.text(offsetX + (this.gridSize * tileSize) / 2, offsetY - 30, 'گرید شما', {
      fontSize: '20px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma'
    }).setOrigin(0.5);
    
    this.add.text(opponentOffsetX + (this.gridSize * tileSize) / 2, offsetY - 30, 'گرید حریف', {
      fontSize: '20px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma'
    }).setOrigin(0.5);
  }

  drawGrid(graphics, x, y, size, tileSize, color) {
    graphics.clear();
    graphics.lineStyle(1, color, 0.3);
    
    for (let i = 0; i <= size; i++) {
      // Vertical lines
      graphics.moveTo(x + i * tileSize, y);
      graphics.lineTo(x + i * tileSize, y + size * tileSize);
      
      // Horizontal lines
      graphics.moveTo(x, y + i * tileSize);
      graphics.lineTo(x + size * tileSize, y + i * tileSize);
    }
    
    // Fill tiles with semi-realistic look
    graphics.fillStyle(0x1c1f22, 0.5);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        graphics.fillRect(
          x + col * tileSize + 1,
          y + row * tileSize + 1,
          tileSize - 2,
          tileSize - 2
        );
      }
    }
  }

  setupUI() {
    // Mana bar
    this.manaBar = new ManaBar(this, 50, 50, this.config);
    
    // Budget display
    this.budgetText = this.add.text(50, 100, `${faTexts.game.budget}: ${this.budget}`, {
      fontSize: '18px',
      color: '#fff',
      fontFamily: 'Vazirmatn, Tahoma'
    });
    
    // Turn indicator
    this.turnText = this.add.text(50, 130, '', {
      fontSize: '18px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma'
    });
    
    // Unit selection panel
    this.setupUnitPanel();
  }

  setupUnitPanel() {
    const panelX = 50;
    const panelY = 200;
    
    // Launchers
    this.add.text(panelX, panelY, faTexts.units.launcher, {
      fontSize: '16px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma'
    });
    
    this.launcherButtons = [];
    this.config.launchers.forEach((launcher, index) => {
      const btn = this.add.rectangle(
        panelX + index * 80,
        panelY + 30,
        70,
        60,
        0x3f5765
      )
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        if (this.currentPhase === GAME_PHASES.BUILD) {
          this.unitPlacement.selectLauncherType(launcher.id);
        } else if (this.currentPhase === GAME_PHASES.BATTLE) {
          this.selectLauncherForShot(launcher.id);
        }
      });
      
      this.add.text(btn.x, btn.y - 10, launcher.titleFA, {
        fontSize: '10px',
        color: '#fff',
        fontFamily: 'Vazirmatn, Tahoma',
        wordWrap: { width: 60 }
      }).setOrigin(0.5);
      
      this.add.text(btn.x, btn.y + 15, `💰${launcher.cost}`, {
        fontSize: '12px',
        color: '#ffd700',
        fontFamily: 'Vazirmatn, Tahoma'
      }).setOrigin(0.5);
      
      this.launcherButtons.push(btn);
    });
    
    // Defenses
    this.add.text(panelX, panelY + 100, faTexts.units.defense, {
      fontSize: '16px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma'
    });
    
    this.defenseButtons = [];
    this.config.defenses.forEach((defense, index) => {
      const btn = this.add.rectangle(
        panelX + index * 80,
        panelY + 130,
        70,
        60,
        0x3f5765
      )
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        if (this.currentPhase === GAME_PHASES.BUILD) {
          this.unitPlacement.selectDefenseType(defense.id);
        }
      });
      
      this.add.text(btn.x, btn.y - 10, defense.titleFA, {
        fontSize: '10px',
        color: '#fff',
        fontFamily: 'Vazirmatn, Tahoma',
        wordWrap: { width: 60 }
      }).setOrigin(0.5);
      
      this.add.text(btn.x, btn.y + 15, `💰${defense.cost}`, {
        fontSize: '12px',
        color: '#ffd700',
        fontFamily: 'Vazirmatn, Tahoma'
      }).setOrigin(0.5);
      
      this.defenseButtons.push(btn);
    });
    
    // Ready button
    this.readyButton = this.add.rectangle(panelX, panelY + 200, 150, 40, 0x2b3a42)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        if (this.currentPhase === GAME_PHASES.BUILD) {
          this.sendReady();
        }
      });
    
    this.add.text(this.readyButton.x, this.readyButton.y, faTexts.buttons.ready, {
      fontSize: '16px',
      color: '#fff',
      fontFamily: 'Vazirmatn, Tahoma'
    }).setOrigin(0.5);
  }

  setupInput() {
    this.input.on('pointerdown', (pointer) => {
      if (this.currentPhase === GAME_PHASES.BUILD) {
        this.unitPlacement.handleClick(pointer);
      } else if (this.currentPhase === GAME_PHASES.BATTLE) {
        this.handleBattleClick(pointer);
      }
    });
    
    this.input.on('pointermove', (pointer) => {
      if (this.currentPhase === GAME_PHASES.BATTLE && this.isDrawingPath) {
        this.pathDrawer.handleMove(pointer);
      }
    });
    
    this.input.on('pointerup', () => {
      if (this.isDrawingPath) {
        this.finishPathDrawing();
      }
    });
  }

  handleBattleClick(pointer) {
    if (!this.selectedLauncher) return;
    
    // Check both player and opponent grids
    let gridX = Math.floor((pointer.x - GRID_OFFSET_X) / GRID_TILE_SIZE);
    let gridY = Math.floor((pointer.y - GRID_OFFSET_Y) / GRID_TILE_SIZE);
    let isPlayerGrid = true;
    
    // Check opponent grid
    const opponentOffsetX = GRID_OFFSET_X + (this.gridSize * GRID_TILE_SIZE) + 50;
    if (gridX < 0 || gridX >= this.gridSize || gridY < 0 || gridY >= this.gridSize) {
      gridX = Math.floor((pointer.x - opponentOffsetX) / GRID_TILE_SIZE);
      gridY = Math.floor((pointer.y - GRID_OFFSET_Y) / GRID_TILE_SIZE);
      isPlayerGrid = false;
    }
    
    if (gridX >= 0 && gridX < this.gridSize && gridY >= 0 && gridY < this.gridSize) {
      this.isDrawingPath = true;
      this.pathTiles = [{ x: gridX, y: gridY, isPlayerGrid }];
      this.pathDrawer.startPath(this.pathTiles);
    }
  }

  finishPathDrawing() {
    this.isDrawingPath = false;
    
    if (this.pathTiles.length < 2) {
      this.pathTiles = [];
      return;
    }
    
    // Send shot request
    this.sendShotRequest();
    this.pathTiles = [];
  }

  selectLauncherForShot(launcherType) {
    const launcher = this.playerUnits.launchers.find(l => 
      l.type === launcherType && !l.destroyed
    );
    
    if (launcher) {
      this.selectedLauncher = launcher;
      this.onNotification(faTexts.game.selectLauncher);
    }
  }

  sendReady() {
    this.gameState.ws.send(JSON.stringify({
      type: MESSAGE_TYPES.READY
    }));
  }

  sendShotRequest() {
    if (!this.selectedLauncher) return;
    
    this.gameState.ws.send(JSON.stringify({
      type: MESSAGE_TYPES.REQUEST_SHOT,
      launcherId: this.selectedLauncher.id,
      pathTiles: this.pathTiles
    }));
  }

  handleServerMessage(data) {
    switch (data.type) {
      case MESSAGE_TYPES.BUILD_PHASE_STATE:
        this.handleBuildPhaseState(data);
        break;
      
      case MESSAGE_TYPES.BATTLE_STATE:
        this.handleBattleState(data);
        break;
      
      case MESSAGE_TYPES.MANA_UPDATE:
        this.mana = data.mana;
        this.manaBar.updateMana(data.mana);
        break;
      
      case MESSAGE_TYPES.TURN_CHANGE:
        this.currentTurn = data.currentTurn;
        this.mana = data.mana[this.gameState.playerId];
        this.shotsThisTurn = 0;
        this.manaBar.updateMana(this.mana);
        this.updateTurnIndicator();
        this.audioController.playSound('turnChange');
        break;
      
      case MESSAGE_TYPES.APPLY_DAMAGE:
        this.handleDamage(data);
        break;
      
      case MESSAGE_TYPES.SHOT_REJECTED:
        this.onNotification(faTexts.notifications.shotRejected + ': ' + data.reason);
        this.audioController.playSound('error');
        break;
      
      case MESSAGE_TYPES.GAME_OVER:
        this.handleGameOver(data);
        break;
    }
  }

  handleBuildPhaseState(data) {
    this.budget = data.budget;
    this.budgetText.setText(`${faTexts.game.budget}: ${this.budget}`);
    
    if (data.units) {
      this.playerUnits = data.units;
      this.renderUnits();
    }
  }

  handleBattleState(data) {
    this.currentPhase = GAME_PHASES.BATTLE;
    this.onPhaseChange(this.currentPhase);
    this.currentTurn = data.currentTurn;
    this.mana = data.mana[this.gameState.playerId];
    this.manaBar.updateMana(this.mana);
    this.updateTurnIndicator();
  }

  handleDamage(data) {
    if (data.intercepted) {
      this.onNotification(faTexts.notifications.missileIntercepted);
      this.audioController.playSound('defense_intercept');
    } else {
      // Animate missile
      this.animateMissile(data.pathTiles, () => {
        // Show explosion
        const lastTile = data.pathTiles[data.pathTiles.length - 1];
        this.showExplosion(lastTile.x, lastTile.y);
        this.audioController.playSound('explosion');
      });
    }
    
    // Update units
    if (data.damage) {
      if (data.damage.launchers) {
        data.damage.launchers.forEach(dmg => {
          const unit = this.playerUnits.launchers.find(u => u.id === dmg.id) ||
                      this.opponentUnits.launchers.find(u => u.id === dmg.id);
          if (unit) unit.destroyed = true;
        });
      }
      if (data.damage.defenses) {
        data.damage.defenses.forEach(dmg => {
          const unit = this.playerUnits.defenses.find(u => u.id === dmg.id) ||
                      this.opponentUnits.defenses.find(u => u.id === dmg.id);
          if (unit) unit.destroyed = true;
        });
      }
      this.renderUnits();
    }
  }

  handleGameOver(data) {
    if (data.winner === this.gameState.playerId) {
      this.onNotification(faTexts.notifications.youWon);
    } else {
      this.onNotification(faTexts.notifications.youLost);
    }
    this.currentPhase = GAME_PHASES.GAME_OVER;
  }

  animateMissile(pathTiles, onComplete) {
    const missile = this.add.image(0, 0, 'missile');
    missile.setDepth(100);
    
    const startX = GRID_OFFSET_X + pathTiles[0].x * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
    const startY = GRID_OFFSET_Y + pathTiles[0].y * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
    missile.setPosition(startX, startY);
    
    const points = pathTiles.map(tile => ({
      x: GRID_OFFSET_X + tile.x * GRID_TILE_SIZE + GRID_TILE_SIZE / 2,
      y: GRID_OFFSET_Y + tile.y * GRID_TILE_SIZE + GRID_TILE_SIZE / 2
    }));
    
    const timeline = this.tweens.timeline({
      onComplete: () => {
        missile.destroy();
        if (onComplete) onComplete();
      }
    });
    
    for (let i = 1; i < points.length; i++) {
      timeline.add({
        targets: missile,
        x: points[i].x,
        y: points[i].y,
        duration: 200,
        ease: 'Linear'
      });
    }
    
    timeline.play();
    this.audioController.playSound('launch');
  }

  showExplosion(x, y) {
    const explosion = new Explosion(this, x, y);
    explosion.play();
  }

  renderUnits() {
    // Clear existing unit sprites
    if (this.unitSprites) {
      this.unitSprites.forEach(sprite => sprite.destroy());
    }
    this.unitSprites = [];
    
    // Render player units
    this.playerUnits.launchers.forEach(unit => {
      if (unit.destroyed) return;
      const config = this.config.launchers.find(l => l.id === unit.type);
      const sprite = this.add.image(
        GRID_OFFSET_X + unit.x * GRID_TILE_SIZE + (config.size[0] * GRID_TILE_SIZE) / 2,
        GRID_OFFSET_Y + unit.y * GRID_TILE_SIZE + (config.size[1] * GRID_TILE_SIZE) / 2,
        `launcher_${unit.type}`
      );
      sprite.setTint(Phaser.Display.Color.HexStringToColor(config.color).color);
      this.unitSprites.push(sprite);
    });
    
    this.playerUnits.defenses.forEach(unit => {
      if (unit.destroyed) return;
      const config = this.config.defenses.find(d => d.id === unit.type);
      if (!config) return;
      
      const [sizeX, sizeY] = config.size || [1, 1];
      const sprite = this.add.image(
        GRID_OFFSET_X + unit.x * GRID_TILE_SIZE + (sizeX * GRID_TILE_SIZE) / 2,
        GRID_OFFSET_Y + unit.y * GRID_TILE_SIZE + (sizeY * GRID_TILE_SIZE) / 2,
        `defense_${unit.type}`
      );
      sprite.setTint(Phaser.Display.Color.HexStringToColor(config.color).color);
      this.unitSprites.push(sprite);
    });
  }

  updateTurnIndicator() {
    if (this.currentTurn === this.gameState.playerId) {
      this.turnText.setText(faTexts.game.yourTurn);
      this.turnText.setColor('#00ff00');
    } else {
      this.turnText.setText(faTexts.game.opponentTurn);
      this.turnText.setColor('#ff0000');
    }
  }
}

