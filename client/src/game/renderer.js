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
    logger.info('GameRenderer.init called', { hasData: !!data, hasConfig: !!(data && data.config) });
    
    if (!data || !data.config) {
      logger.warn('GameRenderer.init: config is missing!', { data });
      // Don't return, let it retry in preload/create
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
    // Use budgets from config
    this.buildBudget = this.config.buildBudget || 10;
    this.shotBudget = this.config.shotBudget || 5;
    this.mana = this.config.mana.startMana;
    logger.info('Budget initialized from config', { 
      buildBudget: this.buildBudget, 
      shotBudget: this.shotBudget,
      configBuildBudget: this.config.buildBudget,
      configShotBudget: this.config.shotBudget
    });
    this.shotsThisTurn = 0;
    this.currentTurn = null;
    this.selectedLauncher = null;
    this.pathTiles = [];
    this.isDrawingPath = false;
    
    logger.info('GameRenderer initialized', { 
      gridSize: this.gridSize, 
      buildBudget: this.buildBudget,
      shotBudget: this.shotBudget,
      launchers: this.config.launchers?.length,
      defenses: this.config.defenses?.length
    });
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
    
    logger.info('GameRenderer.preload: Loading sprites from config...');
    
    // Load launcher sprites from config
    if (this.config.launchers) {
      this.config.launchers.forEach(launcher => {
        if (launcher.launcherSprite) {
          try {
            // Use absolute path from server
            const spritePath = launcher.launcherSprite.startsWith('http') 
              ? launcher.launcherSprite 
              : `http://localhost:3000/${launcher.launcherSprite}`;
            this.load.image(`launcher_${launcher.id}`, spritePath);
            logger.info(`Loading launcher sprite: ${spritePath} for ${launcher.id}`);
          } catch (e) {
            logger.warn(`Failed to load launcher sprite for ${launcher.id}: ${launcher.launcherSprite}`, e);
          }
        }
        // Load missile sprites from config
        if (launcher.missileSprite) {
          try {
            const spritePath = launcher.missileSprite.startsWith('http') 
              ? launcher.missileSprite 
              : `http://localhost:3000/${launcher.missileSprite}`;
            this.load.image(`missile_${launcher.id}`, spritePath);
            logger.info(`Loading missile sprite: ${spritePath} for ${launcher.id}`);
          } catch (e) {
            logger.warn(`Failed to load missile sprite for ${launcher.id}: ${launcher.missileSprite}`, e);
          }
        }
      });
    }
    
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
    
    logger.info('GameRenderer.create: Setting up game...', { 
      gridSize: this.gridSize,
      launchers: this.config.launchers?.map(l => ({ id: l.id, cost: l.cost, size: l.size }))
    });
    
    // After load completes, create placeholders for any missing textures
    this.load.once('complete', () => {
      logger.info('Load complete, checking for missing textures...');
      this.createPlaceholderGraphics();
    });
    
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
    // Create colored rectangles for units (textures only, not visible sprites)
    // Use size from config instead of hardcoded values
    // Only create if texture doesn't already exist (to avoid overriding loaded sprites)
    if (this.config && this.config.launchers) {
      this.config.launchers.forEach(launcher => {
        const textureKey = `launcher_${launcher.id}`;
        
        // Only create placeholder if texture doesn't exist
        // (will be created after load completes if sprite failed to load)
        if (!this.textures.exists(textureKey)) {
          const [sizeX, sizeY] = launcher.size || [1, 1];
          const width = sizeX * GRID_TILE_SIZE;
          const height = sizeY * GRID_TILE_SIZE;
          
          const graphics = this.add.graphics();
          graphics.fillStyle(Phaser.Display.Color.HexStringToColor(launcher.color || '#ffba00').color);
          graphics.fillRect(0, 0, width, height);
          graphics.lineStyle(2, 0xffffff, 0.5);
          graphics.strokeRect(0, 0, width, height);
          graphics.generateTexture(textureKey, width, height);
          graphics.destroy();
          
          logger.debug(`Created placeholder for ${textureKey} with size [${sizeX}, ${sizeY}]`);
        } else {
          logger.debug(`Texture ${textureKey} already exists, skipping placeholder`);
        }
      });
    }
    
    // Defense units (with size support)
    if (this.config && this.config.defenses) {
      this.config.defenses.forEach(defense => {
        const [sizeX, sizeY] = defense.size || [1, 1];
        const width = sizeX * GRID_TILE_SIZE;
        const height = sizeY * GRID_TILE_SIZE;
        
        const defGraphics = this.add.graphics();
        defGraphics.fillStyle(Phaser.Display.Color.HexStringToColor(defense.color || '#66ccff').color);
        defGraphics.fillRect(0, 0, width, height);
        defGraphics.lineStyle(2, 0xffffff, 0.5);
        defGraphics.strokeRect(0, 0, width, height);
        defGraphics.generateTexture(`defense_${defense.id}`, width, height);
        defGraphics.destroy();
      });
    }
    
    // Missile
    const missileGraphics = this.add.graphics();
    missileGraphics.fillStyle(0xffaa00);
    missileGraphics.fillRect(0, 0, 8, 16);
    missileGraphics.generateTexture('missile', 8, 16);
    missileGraphics.destroy();
    
    // Explosion frames (textures only, not visible)
    const explosionFrames = this.config?.animations?.explosionFrames || 12;
    for (let i = 0; i < explosionFrames; i++) {
      const size = 20 + (i * 5);
      const alpha = 1 - (i / explosionFrames);
      const expGraphics = this.add.graphics();
      expGraphics.fillStyle(0xff6600, alpha);
      expGraphics.fillCircle(size / 2, size / 2, size / 2);
      expGraphics.generateTexture(`explosion_${i}`, size, size);
      expGraphics.destroy();
    }
  }

  setupGrid() {
    const tileSize = GRID_TILE_SIZE;
    const offsetX = GRID_OFFSET_X;
    const offsetY = GRID_OFFSET_Y;
    
    // Player grid
    this.playerGrid = this.add.graphics();
    this.drawGrid(this.playerGrid, offsetX, offsetY, this.gridSize, tileSize, 0x3f5765);
    
    // Opponent grid (attached with separator line)
    const separatorWidth = 4;
    const opponentOffsetX = offsetX + (this.gridSize * tileSize) + separatorWidth;
    this.opponentGrid = this.add.graphics();
    this.drawGrid(this.opponentGrid, opponentOffsetX, offsetY, this.gridSize, tileSize, 0x2b3a42);
    
    // Draw separator line between grids
    const separatorGraphics = this.add.graphics();
    separatorGraphics.lineStyle(separatorWidth, 0xffd700, 0.8);
    separatorGraphics.moveTo(offsetX + (this.gridSize * tileSize), offsetY);
    separatorGraphics.lineTo(offsetX + (this.gridSize * tileSize), offsetY + (this.gridSize * tileSize));
    separatorGraphics.setDepth(10);
    
    // Grid labels
    this.add.text(offsetX + (this.gridSize * tileSize) / 2, offsetY - 30, faTexts.game.playerField, {
      fontSize: '20px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma'
    }).setOrigin(0.5);
    
    this.add.text(opponentOffsetX + (this.gridSize * tileSize) / 2, offsetY - 30, faTexts.game.opponentField, {
      fontSize: '20px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma'
    }).setOrigin(0.5);
  }

  drawGrid(graphics, x, y, size, tileSize, color) {
    graphics.clear();
    
    // Draw grid background (darker)
    graphics.fillStyle(0x0a0d0f, 1);
    graphics.fillRect(x, y, size * tileSize, size * tileSize);
    
    // Draw alternating tiles for checkerboard pattern
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const isEven = (row + col) % 2 === 0;
        graphics.fillStyle(isEven ? 0x1c1f22 : 0x252a2e, 1);
        graphics.fillRect(
          x + col * tileSize,
          y + row * tileSize,
          tileSize,
          tileSize
        );
      }
    }
    
    // Draw grid lines (more visible)
    graphics.lineStyle(2, color, 0.8);
    
    for (let i = 0; i <= size; i++) {
      // Vertical lines
      graphics.moveTo(x + i * tileSize, y);
      graphics.lineTo(x + i * tileSize, y + size * tileSize);
      
      // Horizontal lines
      graphics.moveTo(x, y + i * tileSize);
      graphics.lineTo(x + size * tileSize, y + i * tileSize);
    }
    
    // Add subtle border
    graphics.lineStyle(3, color, 1);
    graphics.strokeRect(x, y, size * tileSize, size * tileSize);
  }

  setupUI() {
    // Mana bar
    this.manaBar = new ManaBar(this, 50, 50, this.config);
    
    // Budget display - positioned above grid, left side with small spacing
    const budgetLabel = this.currentPhase === GAME_PHASES.BUILD ? 'بودجه ساخت' : 'بودجه شلیک';
    const budgetValue = this.currentPhase === GAME_PHASES.BUILD ? this.buildBudget : this.shotBudget;
    this.budgetText = this.add.text(GRID_OFFSET_X, GRID_OFFSET_Y - 35, `${budgetLabel}: ${budgetValue}`, {
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
    
    // Remove any leftover explosion sprites from previous renders
    if (this.explosionSprites) {
      this.explosionSprites.forEach(sprite => {
        if (sprite && sprite.active) sprite.destroy();
      });
    }
    this.explosionSprites = [];
    
    // Unit selection panel
    this.setupUnitPanel();
  }

  setupUnitPanel() {
    // Position panel on the right side to avoid overlap with grid
    const panelX = 1000; // Right side
    const panelY = 150; // More space from top
    const buttonSpacing = 90; // More space between buttons
    const buttonWidth = 80;
    const buttonHeight = 70;
    
    // Launchers section
    const launcherLabel = this.add.text(panelX, panelY - 30, faTexts.units.launcher, {
      fontSize: '18px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma',
      fontWeight: 'bold'
    }).setOrigin(0, 0).setDepth(100); // Higher depth to appear above buttons
    
    this.launcherButtons = [];
    this.config.launchers.forEach((launcher, index) => {
      // Log launcher config to debug
      logger.info(`Setting up launcher button: ${launcher.id}`, { 
        cost: launcher.cost, 
        size: launcher.size,
        titleFA: launcher.titleFA 
      });
      
      const btnX = panelX + (index % 2) * buttonSpacing;
      const btnY = panelY + 20 + Math.floor(index / 2) * (buttonHeight + 15); // Space from label
      
      const btn = this.add.rectangle(
        btnX,
        btnY,
        buttonWidth,
        buttonHeight,
        0x3f5765
      )
      .setInteractive({ useHandCursor: true })
      .setStrokeStyle(2, 0x5a7a8a)
      .on('pointerdown', () => {
        if (this.currentPhase === GAME_PHASES.BUILD) {
          this.unitPlacement.selectLauncherType(launcher.id);
          logger.info('Launcher selected for placement:', launcher.id, { cost: launcher.cost });
          this.onNotification(`موشک‌انداز ${launcher.titleFA} انتخاب شد. روی زمین بازی کلیک کنید.`);
        } else if (this.currentPhase === GAME_PHASES.BATTLE) {
          this.selectLauncherForShot(launcher.id);
        }
      })
      .on('pointerover', () => {
        btn.setFillStyle(0x4a6a7a);
      })
      .on('pointerout', () => {
        btn.setFillStyle(0x3f5765);
      });
      
      this.add.text(btnX, btnY - 20, launcher.titleFA, {
        fontSize: '11px',
        color: '#fff',
        fontFamily: 'Vazirmatn, Tahoma',
        wordWrap: { width: 70 },
        align: 'center'
      }).setOrigin(0.5).setDepth(60); // Above button but below label
      
      // Use cost from config (launcher.cost)
      this.add.text(btnX, btnY + 20, `💰${launcher.cost}`, {
        fontSize: '13px',
        color: '#ffd700',
        fontFamily: 'Vazirmatn, Tahoma'
      }).setOrigin(0.5).setDepth(60);
      
      this.launcherButtons.push(btn);
    });
    
    // Defenses section (positioned below launchers)
    const defensesStartY = panelY + 20 + Math.ceil(this.config.launchers.length / 2) * (buttonHeight + 15) + 50;
    
    const defenseLabel = this.add.text(panelX, defensesStartY - 30, faTexts.units.defense, {
      fontSize: '18px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma',
      fontWeight: 'bold'
    }).setOrigin(0, 0).setDepth(100); // Higher depth to appear above buttons
    
    this.defenseButtons = [];
    this.config.defenses.forEach((defense, index) => {
      const btnX = panelX + (index % 2) * buttonSpacing;
      const btnY = defensesStartY + 20 + Math.floor(index / 2) * (buttonHeight + 15); // Space from label
      
      const btn = this.add.rectangle(
        btnX,
        btnY,
        buttonWidth,
        buttonHeight,
        0x3f5765
      )
      .setInteractive({ useHandCursor: true })
      .setStrokeStyle(2, 0x5a7a8a)
      .setDepth(50) // Lower depth than labels
      .on('pointerdown', () => {
        if (this.currentPhase === GAME_PHASES.BUILD) {
          this.unitPlacement.selectDefenseType(defense.id);
          logger.info('Defense selected for placement:', defense.id);
          this.onNotification(`پدافند ${defense.titleFA} انتخاب شد. روی زمین بازی کلیک کنید.`);
        }
      })
      .on('pointerover', () => {
        btn.setFillStyle(0x4a6a7a);
      })
      .on('pointerout', () => {
        btn.setFillStyle(0x3f5765);
      });
      
      this.add.text(btnX, btnY - 15, defense.titleFA, {
        fontSize: '11px',
        color: '#fff',
        fontFamily: 'Vazirmatn, Tahoma',
        wordWrap: { width: 70 },
        align: 'center'
      }).setOrigin(0.5).setDepth(60);
      
      this.add.text(btnX, btnY + 20, `💰${defense.cost}`, {
        fontSize: '13px',
        color: '#ffd700',
        fontFamily: 'Vazirmatn, Tahoma'
      }).setOrigin(0.5).setDepth(60);
      
      this.defenseButtons.push(btn);
    });
    
    // Ready button (positioned at bottom)
    const readyButtonY = defensesStartY + 35 + Math.ceil(this.config.defenses.length / 2) * (buttonHeight + 10) + 30;
    this.readyButton = this.add.rectangle(panelX, readyButtonY, 150, 45, 0x2b3a42)
      .setInteractive({ useHandCursor: true })
      .setStrokeStyle(2, 0xffd700)
      .on('pointerdown', () => {
        if (this.currentPhase === GAME_PHASES.BUILD) {
          this.sendReady();
        }
      })
      .on('pointerover', () => {
        this.readyButton.setFillStyle(0x3a4a5a);
      })
      .on('pointerout', () => {
        this.readyButton.setFillStyle(0x2b3a42);
      });
    
    this.add.text(this.readyButton.x, this.readyButton.y, faTexts.buttons.ready, {
      fontSize: '18px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma',
      fontWeight: 'bold'
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
    if (!this.selectedLauncher) {
      this.onNotification('لطفاً ابتدا موشک‌انداز را انتخاب کنید');
      return;
    }
    
    // Check if click is on UI buttons (right side)
    if (pointer.x > 950) {
      return;
    }
    
    // Check both player and opponent grids (now attached)
    const separatorWidth = 4;
    const opponentOffsetX = GRID_OFFSET_X + (this.gridSize * GRID_TILE_SIZE) + separatorWidth;
    
    let gridX = Math.floor((pointer.x - GRID_OFFSET_X) / GRID_TILE_SIZE);
    let gridY = Math.floor((pointer.y - GRID_OFFSET_Y) / GRID_TILE_SIZE);
    let isPlayerGrid = true;
    
    // Check if click is on player grid
    if (gridX < 0 || gridX >= this.gridSize || gridY < 0 || gridY >= this.gridSize) {
      // Check opponent grid
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
    // Update budget from server (which uses config)
    if (data.buildBudget !== undefined) {
      this.buildBudget = data.buildBudget;
      if (this.budgetText) {
        this.budgetText.setText(`بودجه ساخت: ${this.buildBudget}`);
        // Update position if needed
        this.budgetText.setX(GRID_OFFSET_X);
        this.budgetText.setY(GRID_OFFSET_Y - 35);
      }
      logger.info('Build budget updated from server', { buildBudget: this.buildBudget, serverBudget: data.buildBudget });
    }
    
    if (data.units) {
      this.playerUnits = data.units;
      this.renderUnits();
    }
    
    // Also update budget display if it changed
    if (this.budgetText && this.budget !== undefined) {
      this.budgetText.setText(`${faTexts.game.budget}: ${this.budget}`);
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
        // Animate missile - get launcher type from damage data
        const launcher = this.playerUnits.launchers.find(l => l.id === data.launcherId) ||
                        this.opponentUnits.launchers.find(l => l.id === data.launcherId);
        const launcherType = launcher ? launcher.type : null;
        
        // Animate missile with launcher type to use correct sprite
        this.animateMissile(data.pathTiles, () => {
          // Show explosion
          const lastTile = data.pathTiles[data.pathTiles.length - 1];
          // Determine explosion type based on launcher
          const explosionType = launcherType || 'default';
          this.showExplosion(lastTile.x, lastTile.y, explosionType);
          this.audioController.playSound('explosion');
        }, launcherType);
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

  animateMissile(pathTiles, onComplete, launcherType = null) {
    // Use missile sprite from config if available, otherwise use placeholder
    const missileKey = launcherType && this.textures.exists(`missile_${launcherType}`) 
      ? `missile_${launcherType}` 
      : 'missile';
    
    const missile = this.add.image(0, 0, missileKey);
    missile.setDepth(100);
    
    // Set missile size to tile size (as per user requirement - missile should be tile-sized)
    missile.setDisplaySize(GRID_TILE_SIZE, GRID_TILE_SIZE);
    
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

  showExplosion(x, y, explosionType = 'default') {
    const explosion = new Explosion(this, x, y, explosionType, this.config);
    explosion.play();
  }

  renderUnits() {
    // Clear existing unit sprites
    if (this.unitSprites) {
      this.unitSprites.forEach(sprite => sprite.destroy());
    }
    this.unitSprites = [];
    
    // First, render units from unitPlacement (for immediate feedback)
    if (this.unitPlacement && this.unitPlacement.placedUnits) {
      this.unitPlacement.placedUnits.forEach(unit => {
        if (unit.type === 'launcher') {
          const config = this.config.launchers.find(l => l.id === unit.launcherType);
          if (!config) return;
          
          const [sizeX, sizeY] = config.size;
          const spriteKey = `launcher_${unit.launcherType}`;
          
          let sprite;
          if (this.textures.exists(spriteKey)) {
            sprite = this.add.image(
              GRID_OFFSET_X + unit.x * GRID_TILE_SIZE + (sizeX * GRID_TILE_SIZE) / 2,
              GRID_OFFSET_Y + unit.y * GRID_TILE_SIZE + (sizeY * GRID_TILE_SIZE) / 2,
              spriteKey
            );
            sprite.setDisplaySize(sizeX * GRID_TILE_SIZE, sizeY * GRID_TILE_SIZE);
          } else {
            sprite = this.add.image(
              GRID_OFFSET_X + unit.x * GRID_TILE_SIZE + (sizeX * GRID_TILE_SIZE) / 2,
              GRID_OFFSET_Y + unit.y * GRID_TILE_SIZE + (sizeY * GRID_TILE_SIZE) / 2,
              spriteKey
            );
            sprite.setTint(Phaser.Display.Color.HexStringToColor(config.color).color);
            sprite.setDisplaySize(sizeX * GRID_TILE_SIZE, sizeY * GRID_TILE_SIZE);
          }
          
          this.unitSprites.push(sprite);
        } else if (unit.type === 'defense') {
          const config = this.config.defenses.find(d => d.id === unit.defenseType);
          if (!config) return;
          
          const [sizeX, sizeY] = config.size || [1, 1];
          const spriteKey = `defense_${unit.defenseType}`;
          
          const sprite = this.add.image(
            GRID_OFFSET_X + unit.x * GRID_TILE_SIZE + (sizeX * GRID_TILE_SIZE) / 2,
            GRID_OFFSET_Y + unit.y * GRID_TILE_SIZE + (sizeY * GRID_TILE_SIZE) / 2,
            spriteKey
          );
          sprite.setTint(Phaser.Display.Color.HexStringToColor(config.color).color);
          sprite.setDisplaySize(sizeX * GRID_TILE_SIZE, sizeY * GRID_TILE_SIZE);
          this.unitSprites.push(sprite);
        }
      });
    }
    
    // Also render from server data (authoritative)
    if (this.playerUnits && this.playerUnits.launchers) {
      this.playerUnits.launchers.forEach(unit => {
        if (unit.destroyed) return;
        const config = this.config.launchers.find(l => l.id === unit.type);
        if (!config) return;
        
        const [sizeX, sizeY] = config.size;
        const spriteKey = `launcher_${unit.type}`;
        
        let sprite;
        if (this.textures.exists(spriteKey)) {
          sprite = this.add.image(
            GRID_OFFSET_X + unit.x * GRID_TILE_SIZE + (sizeX * GRID_TILE_SIZE) / 2,
            GRID_OFFSET_Y + unit.y * GRID_TILE_SIZE + (sizeY * GRID_TILE_SIZE) / 2,
            spriteKey
          );
          sprite.setDisplaySize(sizeX * GRID_TILE_SIZE, sizeY * GRID_TILE_SIZE);
        } else {
          sprite = this.add.image(
            GRID_OFFSET_X + unit.x * GRID_TILE_SIZE + (sizeX * GRID_TILE_SIZE) / 2,
            GRID_OFFSET_Y + unit.y * GRID_TILE_SIZE + (sizeY * GRID_TILE_SIZE) / 2,
            spriteKey
          );
          sprite.setTint(Phaser.Display.Color.HexStringToColor(config.color).color);
          sprite.setDisplaySize(sizeX * GRID_TILE_SIZE, sizeY * GRID_TILE_SIZE);
        }
        
        this.unitSprites.push(sprite);
      });
    }
    
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

