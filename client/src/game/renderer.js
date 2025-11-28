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
    // Store scene data to be used in init
    this.sceneData = null;
  }

  init(data) {
    logger.info('GameRenderer.init called', { 
      hasData: !!data, 
      hasConfig: !!(data && data.config),
      hasSceneData: !!this.sceneData,
      dataKeys: data ? Object.keys(data) : []
    });
    
    // Use sceneData if data is not provided (Phaser calls init without data)
    const initData = data && data.config ? data : (this.sceneData || data);
    
    if (!initData || !initData.config) {
      logger.warn('GameRenderer.init: config is missing!', { 
        hasData: !!data,
        hasSceneData: !!this.sceneData,
        data: data ? Object.keys(data) : 'no data',
        config: initData?.config ? 'has config' : 'no config'
      });
      // Don't return, let it retry in preload/create
      return;
    }
    
    this.config = initData.config;
    this.gameState = initData.gameState || this.gameState;
    this.onNotification = initData.onNotification || this.onNotification || (() => {});
    this.onPhaseChange = initData.onPhaseChange || this.onPhaseChange || (() => {});
    
    // Log full config to debug
    logger.info('Config received in init:', {
      gridSize: this.config?.gridSize,
      buildBudget: this.config?.buildBudget,
      launchers: this.config?.launchers?.map(l => ({
        id: l.id,
        cost: l.cost,
        size: l.size,
        titleFA: l.titleFA
      }))
    });
    
    this.gridSize = this.config.gridSize;
    this.playerUnits = { launchers: [], defenses: [] };
    this.opponentUnits = { launchers: [], defenses: [] };
    this.currentPhase = GAME_PHASES.WAITING; // Start in WAITING, will be set to BUILD when server sends BUILD_PHASE_STATE
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
    // Multiple paths before shooting
    this.pendingShots = []; // Array of { launcher, pathTiles }
    this.selectedLauncherForShots = null;
    this.pathSelectionMode = false; // Whether we're selecting cells for path
    this.aimingMode = false; // Whether we're in aiming mode (launcher selected, ready to draw path)
    this.selectedLauncher = null;
    this.pathTiles = [];
    this.isDrawingPath = false;
    // Battle turn timer
    this.battleTurnTimer = null;
    this.battleTurnTimerText = null;
    this.turnTimeSeconds = this.config.battle?.turnTimeSeconds || 20;
    
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
    
    // Don't set phase here - wait for server to send BUILD_PHASE_STATE or ROOM_UPDATE
    // Phase will be set when:
    // - Player1: ROOM_UPDATE with players: 1
    // - Player2: BUILD_PHASE_STATE when joining
    // this.currentPhase is already set in init() (WAITING)
    if (this.onPhaseChange) {
      this.onPhaseChange(this.currentPhase);
    }
    
    logger.info('GameRenderer.create: Game setup complete', {
      currentPhase: this.currentPhase,
      playerId: this.gameState?.playerId,
      hasGameState: !!this.gameState,
      hasPlayerId: !!this.gameState?.playerId
    });
    
    // If we're player1, start timer immediately after create() completes
    // This ensures timer starts even if ROOM_UPDATE was received before create() completed
    if (this.gameState?.playerId === 'player1') {
      // Use a small delay to ensure everything is initialized (buttons, UI, etc.)
      this.time.delayedCall(200, () => {
        if (this.currentPhase === GAME_PHASES.WAITING || this.currentPhase === GAME_PHASES.BUILD) {
          logger.info('Player1: Starting timer after create() completes', {
            currentPhase: this.currentPhase,
            hasBuildPhaseTimer: !!this.buildPhaseTimer,
            hasTimerText: !!this.timerText,
            isReady: this.isReady
          });
          
          // Set phase to BUILD if still WAITING
          if (this.currentPhase === GAME_PHASES.WAITING) {
            this.currentPhase = GAME_PHASES.BUILD;
            this.onPhaseChange(this.currentPhase);
            this.showUnitPanelInBuild();
          }
          
          // Start timer if not already started
          if (!this.buildPhaseTimer && !this.timerText && !this.isReady) {
            this.startBuildPhaseTimer();
          }
        }
      });
    }
    
    // If we're player2, check if BUILD_PHASE_STATE was received before create() completed
    // This ensures timer starts even if BUILD_PHASE_STATE was received before create() completed
    if (this.gameState?.playerId === 'player2') {
      // Use a small delay to ensure everything is initialized (buttons, UI, etc.)
      this.time.delayedCall(500, () => {
        // If still WAITING after 500ms, force start build phase (BUILD_PHASE_STATE might have been missed)
        if (this.currentPhase === GAME_PHASES.WAITING) {
          logger.warn('Player2: Still in WAITING phase after 500ms, forcing BUILD phase start', {
            currentPhase: this.currentPhase,
            hasBuildPhaseTimer: !!this.buildPhaseTimer,
            hasTimerText: !!this.timerText,
            isReady: this.isReady,
            buildBudget: this.buildBudget
          });
          
          // Force set phase to BUILD and start timer
          this.currentPhase = GAME_PHASES.BUILD;
          this.onPhaseChange(this.currentPhase);
          this.showUnitPanelInBuild();
          
          // Hide FIRE button in build phase
          if (this.fireButton) {
            this.fireButton.setVisible(false);
            this.fireButtonText.setVisible(false);
          }
          
          // Start timer if not already started
          if (!this.buildPhaseTimer && !this.timerText && !this.isReady) {
            logger.info('Player2: Starting build phase timer (forced)');
            this.startBuildPhaseTimer();
          }
        } else if (this.currentPhase === GAME_PHASES.BUILD) {
          logger.info('Player2: Already in BUILD phase, starting timer if needed', {
            currentPhase: this.currentPhase,
            hasBuildPhaseTimer: !!this.buildPhaseTimer,
            hasTimerText: !!this.timerText,
            isReady: this.isReady,
            buildBudget: this.buildBudget
          });
          
          // Start timer if not already started
          if (!this.buildPhaseTimer && !this.timerText && !this.isReady) {
            this.startBuildPhaseTimer();
          }
        }
      });
    }
  }

  createPlaceholderGraphics() {
    // Create colored rectangles for units (textures only, not visible sprites)
    // Use size from config instead of hardcoded values
    // Only create if texture doesn't already exist (to avoid overriding loaded sprites)
    if (this.config && this.config.launchers) {
      logger.info('Creating placeholder graphics with config:', {
        launchers: this.config.launchers.map(l => ({
          id: l.id,
          size: l.size,
          cost: l.cost
        }))
      });
      
      this.config.launchers.forEach(launcher => {
        const textureKey = `launcher_${launcher.id}`;
        
        // Only create placeholder if texture doesn't exist
        // (will be created after load completes if sprite failed to load)
        if (!this.textures.exists(textureKey)) {
          const [sizeX, sizeY] = launcher.size || [1, 1];
          const width = sizeX * GRID_TILE_SIZE;
          const height = sizeY * GRID_TILE_SIZE;
          
          logger.info(`Creating placeholder for ${textureKey}`, {
            sizeFromConfig: launcher.size,
            calculatedSize: [sizeX, sizeY],
            width,
            height
          });
          
          const graphics = this.add.graphics();
          graphics.fillStyle(Phaser.Display.Color.HexStringToColor(launcher.color || '#ffba00').color);
          graphics.fillRect(0, 0, width, height);
          graphics.lineStyle(2, 0xffffff, 0.5);
          graphics.strokeRect(0, 0, width, height);
          graphics.generateTexture(textureKey, width, height);
          graphics.destroy();
          
          logger.info(`Created placeholder for ${textureKey} with size [${sizeX}, ${sizeY}]`);
        } else {
          logger.debug(`Texture ${textureKey} already exists, skipping placeholder`);
        }
      });
    } else {
      logger.warn('Cannot create placeholder graphics: config or launchers missing', {
        hasConfig: !!this.config,
        hasLaunchers: !!(this.config && this.config.launchers)
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
    
    // Grid labels with proper margin
    this.add.text(offsetX + (this.gridSize * tileSize) / 2, offsetY - 50, faTexts.game.playerField, {
      fontSize: '20px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma',
      padding: { x: 10, y: 5 }
    }).setOrigin(0.5).setDepth(100);
    
    this.add.text(opponentOffsetX + (this.gridSize * tileSize) / 2, offsetY - 50, faTexts.game.opponentField, {
      fontSize: '20px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma',
      padding: { x: 10, y: 5 }
    }).setOrigin(0.5).setDepth(100);
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
    // Mana bar - REMOVED as per user request
    
    // Build budget text - positioned above build phase timer (center between grids)
    const separatorWidth = 20;
    const gridWidth = this.gridSize * GRID_TILE_SIZE;
    const centerX = GRID_OFFSET_X + gridWidth + separatorWidth / 2;
    const buildTimerY = GRID_OFFSET_Y - 50; // Timer position
    const buildBudgetY = buildTimerY - 30; // Above timer
    
    // Build budget text (only shown in build phase)
    this.buildBudgetText = this.add.text(centerX, buildBudgetY, `بودجه ساخت: ${this.buildBudget}`, {
      fontSize: '18px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma'
    }).setOrigin(0.5, 0).setDepth(100); // Center horizontally
    
    // Hide build budget in battle phase
    if (this.currentPhase === GAME_PHASES.BATTLE) {
      this.buildBudgetText.setVisible(false);
    }
    
    // Baroot display for battle phase - positioned on right side, above FIRE button
    // FIRE button is at fireButtonX = 1000, fireButtonY = 600
    const panelX = 1000; // Right side, same as unit panel
    const fireButtonY = 600; // FIRE button Y position
    const barootY = fireButtonY - 300; // Above FIRE button (300)
    
    this.budgetText = this.add.text(panelX, barootY, 'مقدار باروت: 0', {
      fontSize: '24px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma',
      fontWeight: 'bold'
    }).setOrigin(0, 0).setDepth(100); // Left align at top-left corner
    
    logger.info('Baroot text created', {
      x: panelX,
      y: barootY,
      fireButtonY: fireButtonY,
      visible: this.currentPhase === GAME_PHASES.BATTLE
    });
    
    // Show baroot text in battle phase by default, hide in build phase
    if (this.currentPhase === GAME_PHASES.BATTLE) {
      this.budgetText.setVisible(true);
    } else {
      this.budgetText.setVisible(false);
    }
    
    // Turn indicator - positioned above battle timer in center between grids
    // Battle timer will be at turnTextY + 35
    // So turn text should be above timer
    const battleTimerY = GRID_OFFSET_Y - 120; // Timer position (below grid labels)
    const turnTextY = battleTimerY - 15; // Above battle timer
    
    this.turnText = this.add.text(centerX, turnTextY, '', {
      fontSize: '22px', // Larger size (was 18px)
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma',
      fontWeight: 'bold',
      padding: { x: 10, y: 5 }
    }).setOrigin(0.5, 0).setDepth(100); // Center horizontally
    
    // Battle timer will be positioned below turnText with same width as grid labels
    // Grid labels width is approximately gridWidth (400px for 10x10 grid)
    const gridLabelWidth = this.gridSize * GRID_TILE_SIZE; // Same width as grid labels
    
    // Remove any leftover explosion sprites from previous renders
    if (this.explosionSprites) {
      this.explosionSprites.forEach(sprite => {
        if (sprite && sprite.active) sprite.destroy();
      });
    }
    this.explosionSprites = [];
    
    // Unit selection panel
    this.setupUnitPanel();
    
    // FIRE button (only shown in battle phase)
    this.setupFireButton();
  }
  
  setupFireButton() {
    // FIRE button positioned below ready button or in battle area
    const fireButtonX = 1000;
    const fireButtonY = 600;
    
    this.fireButton = this.add.rectangle(fireButtonX, fireButtonY, 150, 50, 0xff0000)
      .setInteractive({ useHandCursor: true })
      .setStrokeStyle(3, 0xffffff)
      .setDepth(100)
      .setVisible(false) // Hidden by default, shown only in aiming mode
      .on('pointerdown', () => {
        logger.info('FIRE button clicked', {
          currentPhase: this.currentPhase,
          currentTurn: this.currentTurn,
          playerId: this.gameState.playerId,
          aimingMode: this.aimingMode,
          pathLength: this.currentPathTiles?.length || 0,
          selectedLauncher: this.selectedLauncherForShots?.id
        });
        
        if (this.currentPhase === GAME_PHASES.BATTLE && 
            this.currentTurn === this.gameState.playerId) {
          // If path is valid and launcher is selected, fire the shot
          if (this.aimingMode && this.currentPathTiles && this.currentPathTiles.length >= 2 && this.selectedLauncherForShots) {
            logger.info('FIRE button: Calling fireAllShots', {
              pathLength: this.currentPathTiles.length,
              launcherId: this.selectedLauncherForShots.id
            });
            this.fireAllShots();
          } else {
            // No valid path - end turn without firing
            logger.info('FIRE button: No valid path, ending turn', {
              aimingMode: this.aimingMode,
              pathLength: this.currentPathTiles?.length || 0,
              selectedLauncher: this.selectedLauncherForShots?.id
            });
            this.endTurn();
          }
        } else {
          logger.warn('FIRE button: Not in battle phase or not player\'s turn', {
            currentPhase: this.currentPhase,
            currentTurn: this.currentTurn,
            playerId: this.gameState.playerId
          });
        }
      })
      .on('pointerover', () => {
        this.fireButton.setFillStyle(0xff3333);
      })
      .on('pointerout', () => {
        this.fireButton.setFillStyle(0xff0000);
      });
    
    this.fireButtonText = this.add.text(fireButtonX, fireButtonY, 'شلیک (F)', {
      fontSize: '20px',
      color: '#ffffff',
      fontFamily: 'Vazirmatn, Tahoma',
      fontWeight: 'bold'
    }).setOrigin(0.5).setDepth(101).setVisible(false);
  }

  setupUnitPanel() {
    // Position panel on the right side to avoid overlap with grid
    const panelX = 1000; // Right side
    const panelY = 150; // More space from top
    const buttonSpacing = 90; // More space between buttons
    const buttonWidth = 80;
    const buttonHeight = 70;
    
    // Launchers section with proper margin
    const launcherLabel = this.add.text(panelX, panelY - 50, faTexts.units.launcher, {
      fontSize: '18px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma',
      fontWeight: 'bold',
      padding: { x: 10, y: 5 }
    }).setOrigin(0, 0).setDepth(100); // Higher depth to appear above buttons
    
    this.launcherButtons = [];
    
    // Log full config before iterating
    logger.info('Full config.launchers before setup:', JSON.stringify(this.config.launchers, null, 2));
    
    this.config.launchers.forEach((launcher, index) => {
      // Log launcher config to debug - log the actual values
      logger.info(`Setting up launcher button: ${launcher.id}`, { 
        cost: launcher.cost, 
        size: launcher.size,
        titleFA: launcher.titleFA,
        fullLauncher: JSON.stringify(launcher)
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
        }
        // In BATTLE phase, buttons are hidden
      })
      .on('pointerover', () => {
        if (this.currentPhase === GAME_PHASES.BUILD) {
          btn.setFillStyle(0x4a6a7a);
        }
      })
      .on('pointerout', () => {
        if (this.currentPhase === GAME_PHASES.BUILD) {
          btn.setFillStyle(0x3f5765);
        }
      });
      
      const titleText = this.add.text(btnX, btnY - 20, launcher.titleFA, {
        fontSize: '11px',
        color: '#fff',
        fontFamily: 'Vazirmatn, Tahoma',
        wordWrap: { width: 70 },
        align: 'center'
      }).setOrigin(0.5).setDepth(60); // Above button but below label
      
      // Use cost from config (launcher.cost)
      const costText = this.add.text(btnX, btnY + 20, `💰${launcher.cost}`, {
        fontSize: '13px',
        color: '#ffd700',
        fontFamily: 'Vazirmatn, Tahoma'
      }).setOrigin(0.5).setDepth(60);
      
      this.launcherButtons.push({ btn, titleText, costText });
    });
    
    // Store references to hide/show in battle phase
    this.launcherButtonsGroup = {
      label: launcherLabel,
      buttons: this.launcherButtons
    };
    
    // Defenses section (positioned below launchers) with proper margin
    const defensesStartY = panelY + 20 + Math.ceil(this.config.launchers.length / 2) * (buttonHeight + 15) + 50;
    
    const defenseLabel = this.add.text(panelX, defensesStartY - 50, faTexts.units.defense, {
      fontSize: '18px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma',
      fontWeight: 'bold',
      padding: { x: 10, y: 5 }
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
        // In BATTLE phase, buttons are hidden
      })
      .on('pointerover', () => {
        if (this.currentPhase === GAME_PHASES.BUILD) {
          btn.setFillStyle(0x4a6a7a);
        }
      })
      .on('pointerout', () => {
        if (this.currentPhase === GAME_PHASES.BUILD) {
          btn.setFillStyle(0x3f5765);
        }
      });
      
      const defenseTitleText = this.add.text(btnX, btnY - 15, defense.titleFA, {
        fontSize: '11px',
        color: '#fff',
        fontFamily: 'Vazirmatn, Tahoma',
        wordWrap: { width: 70 },
        align: 'center'
      }).setOrigin(0.5).setDepth(60);
      
      const defenseCostText = this.add.text(btnX, btnY + 20, `💰${defense.cost}`, {
        fontSize: '13px',
        color: '#ffd700',
        fontFamily: 'Vazirmatn, Tahoma'
      }).setOrigin(0.5).setDepth(60);
      
      this.defenseButtons.push({ btn, titleText: defenseTitleText, costText: defenseCostText });
    });
    
    // Store references to hide/show in battle phase
    this.defenseButtonsGroup = {
      label: defenseLabel,
      buttons: this.defenseButtons
    };
    
    // Ready button (positioned at bottom)
    const readyButtonY = defensesStartY + 35 + Math.ceil(this.config.defenses.length / 2) * (buttonHeight + 10) + 30;
    this.readyButton = this.add.rectangle(panelX, readyButtonY, 150, 45, 0x2b3a42)
      .setInteractive({ useHandCursor: true })
      .setStrokeStyle(2, 0xffd700)
      .on('pointerdown', () => {
        if (this.currentPhase === GAME_PHASES.BUILD && !this.isReady) {
          // Check if player has at least one launcher before allowing ready
          const launchers = this.playerUnits?.launchers || [];
          const aliveLaunchers = launchers.filter(l => !l.destroyed);
          
          if (aliveLaunchers.length === 0) {
            this.onNotification('قبل از آماده شدن باید حداقل یک موشک‌انداز در زمین قرار دهید');
            this.audioController.playSound('error');
            logger.warn('Cannot ready - no launchers placed', {
              playerId: this.gameState.playerId,
              launchersCount: launchers.length
            });
            return;
          }
          
          this.sendReady();
        }
      })
      .on('pointerover', () => {
        if (!this.isReady) {
          this.readyButton.setFillStyle(0x3a4a5a);
        }
      })
      .on('pointerout', () => {
        if (!this.isReady) {
          this.readyButton.setFillStyle(0x2b3a42);
        }
      });
    
    this.readyButtonText = this.add.text(this.readyButton.x, this.readyButton.y, faTexts.buttons.ready, {
      fontSize: '18px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma',
      fontWeight: 'bold'
    }).setOrigin(0.5);
    
    // Initialize ready state
    this.isReady = false;
    this.buildPhaseTimer = null;
  }

  setupInput() {
    // Build phase - click to place units
    this.input.on('pointerdown', (pointer) => {
      this.isPointerDown = true; // Track pointer down state
      if (this.currentPhase === GAME_PHASES.BUILD) {
        this.unitPlacement.handleClick(pointer);
      } else if (this.currentPhase === GAME_PHASES.BATTLE) {
        this.handleBattlePointerDown(pointer);
      }
    });
    
    // Battle phase - drag for path drawing
    // Use pointermove with manual tracking
    this.input.on('pointermove', (pointer) => {
      if (this.currentPhase === GAME_PHASES.BATTLE) {
        // Disabled: Too verbose - logs every pointer move
        // logger.info('Pointer move in battle phase', {
        //   pointerX: pointer.x,
        //   pointerY: pointer.y,
        //   pointerIsDown: pointer.isDown,
        //   pointerLeftButtonDown: pointer.leftButtonDown(),
        //   isPointerDown: this.isPointerDown,
        //   aimingMode: this.aimingMode,
        //   isDrawingPath: this.isDrawingPath,
        //   selectedLauncher: this.selectedLauncherForShots?.id
        // });
        
        // Allow drawing if in aiming mode and drawing is enabled
        // Check both manual tracking and Phaser's pointer state
        const isDragging = this.isPointerDown || pointer.isDown || pointer.leftButtonDown();
        
        if (this.aimingMode && this.isDrawingPath && isDragging) {
          logger.info('Calling handleBattleDrag from pointermove', {
            isPointerDown: this.isPointerDown,
            pointerIsDown: pointer.isDown,
            pointerLeftButtonDown: pointer.leftButtonDown(),
            isDragging
          });
          this.handleBattleDrag(pointer);
        } else {
          // Disabled: Too verbose - logs every pointer move when not dragging
          // logger.info('Drag not triggered from pointermove', {
          //   reason: !this.aimingMode ? 'not in aiming mode' : 
          //           !this.isDrawingPath ? 'not drawing path' : 
          //           !isDragging ? 'pointer not down' : 'unknown',
          //   aimingMode: this.aimingMode,
          //   isDrawingPath: this.isDrawingPath,
          //   isDragging
          // });
        }
      }
    });
    
    this.input.on('pointerup', (pointer) => {
      this.isPointerDown = false; // Reset pointer down state
      if (this.currentPhase === GAME_PHASES.BATTLE && this.aimingMode) {
        this.handleBattlePointerUp(pointer);
      }
    });
    
    // F key to fire (only in aiming mode)
    this.input.keyboard?.on('keydown-F', () => {
      if (this.aimingMode && this.currentPhase === GAME_PHASES.BATTLE && 
          this.currentTurn === this.gameState.playerId) {
        // If path is empty, do nothing
        if (!this.currentPathTiles || this.currentPathTiles.length < 2) {
          return;
        }
        // If path is valid, execute shot
        this.fireAllShots();
      }
    });
  }

  // Check if a tile is within launcher bounds
  // IMPORTANT: Launcher is always in player grid, so tile must also be in player grid
  isTileInLauncherArea(tileX, tileY, launcher, isPlayerGrid = true) {
    // Launcher is always in player grid - if tile is in enemy grid, it cannot be in launcher area
    if (!isPlayerGrid) return false;
    
    const launcherConfig = this.config.launchers.find(c => c.id === launcher.type);
    if (!launcherConfig) return false;
    
    const [sizeX, sizeY] = launcherConfig.size;
    return tileX >= launcher.x && tileX < launcher.x + sizeX &&
           tileY >= launcher.y && tileY < launcher.y + sizeY;
  }
  
  // Find first adjacent tile outside launcher area
  findFirstAdjacentTile(clickX, clickY, launcher) {
    const launcherConfig = this.config.launchers.find(c => c.id === launcher.type);
    if (!launcherConfig) return null;
    
    const [sizeX, sizeY] = launcherConfig.size;
    
    // Check if click is inside launcher area
    const isInsideLauncher = this.isTileInLauncherArea(clickX, clickY, launcher);
    
    if (!isInsideLauncher) {
      // Click is already outside launcher, use it as start
      return { x: clickX, y: clickY };
    }
    
    // Click is inside launcher, find first adjacent tile outside launcher
    // Check tiles around launcher perimeter (8 directions)
    const candidates = [
      // Right side
      { x: launcher.x + sizeX, y: launcher.y },
      { x: launcher.x + sizeX, y: launcher.y + Math.floor(sizeY / 2) },
      { x: launcher.x + sizeX, y: launcher.y + sizeY - 1 },
      // Left side
      { x: launcher.x - 1, y: launcher.y },
      { x: launcher.x - 1, y: launcher.y + Math.floor(sizeY / 2) },
      { x: launcher.x - 1, y: launcher.y + sizeY - 1 },
      // Bottom side
      { x: launcher.x, y: launcher.y + sizeY },
      { x: launcher.x + Math.floor(sizeX / 2), y: launcher.y + sizeY },
      { x: launcher.x + sizeX - 1, y: launcher.y + sizeY },
      // Top side
      { x: launcher.x, y: launcher.y - 1 },
      { x: launcher.x + Math.floor(sizeX / 2), y: launcher.y - 1 },
      { x: launcher.x + sizeX - 1, y: launcher.y - 1 }
    ];
    
    // Find first valid candidate (within grid bounds and outside launcher)
    for (const candidate of candidates) {
      if (candidate.x >= 0 && candidate.x < this.gridSize &&
          candidate.y >= 0 && candidate.y < this.gridSize &&
          !this.isTileInLauncherArea(candidate.x, candidate.y, launcher)) {
        return candidate;
      }
    }
    
    // Fallback: use tile to the right of launcher
    const rightX = launcher.x + sizeX;
    if (rightX < this.gridSize && rightX >= 0) {
      return { x: rightX, y: launcher.y };
    }
    
    // Fallback: use tile below launcher
    const bottomY = launcher.y + sizeY;
    if (bottomY < this.gridSize && bottomY >= 0) {
      return { x: launcher.x, y: bottomY };
    }
    
    return null;
  }

  handleBattlePointerDown(pointer) {
    logger.info('Battle pointer down', {
      pointerX: pointer.x,
      pointerY: pointer.y,
      phase: this.currentPhase,
      currentTurn: this.currentTurn,
      playerId: this.gameState.playerId
    });
    
    // Check if click is on UI buttons (right side) or fire button
    if (pointer.x > 950) {
      logger.info('Click on UI area, ignoring', { pointerX: pointer.x });
      return;
    }
    
    // Check if it's player's turn
    if (this.currentTurn !== this.gameState.playerId) {
      logger.info('Not player turn', { 
        currentTurn: this.currentTurn, 
        playerId: this.gameState.playerId 
      });
      this.onNotification('نوبت شما نیست');
      return;
    }
    
    // Check both player and opponent grids (now attached)
    const separatorWidth = 4;
    const opponentOffsetX = GRID_OFFSET_X + (this.gridSize * GRID_TILE_SIZE) + separatorWidth;
    
    // Determine which grid was clicked
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
    
    logger.info('Grid cell clicked', {
      gridX,
      gridY,
      isPlayerGrid,
      pointerX: pointer.x,
      pointerY: pointer.y,
      aimingMode: this.aimingMode,
      selectedLauncher: this.selectedLauncherForShots?.id,
      currentPathLength: this.currentPathTiles?.length || 0
    });
    
    if (gridX < 0 || gridX >= this.gridSize || gridY < 0 || gridY >= this.gridSize) {
      logger.info('Click outside grids', { gridX, gridY, gridSize: this.gridSize });
      return; // Outside grids
    }
    
    // If no launcher selected, check if clicking on a launcher
    if (!this.selectedLauncherForShots) {
      // Check both playerUnits and unitPlacement for launchers
      const allLaunchers = [];
      
      // Get launchers from playerUnits (from server)
      if (this.playerUnits && this.playerUnits.launchers) {
        allLaunchers.push(...this.playerUnits.launchers);
      }
      
      // Also check unitPlacement for placed units (client-side)
      if (this.unitPlacement && this.unitPlacement.placedUnits) {
        const placedLaunchers = this.unitPlacement.placedUnits
          .filter(u => u.type === 'launcher')
          .map(u => ({
            id: `placed_${u.x}_${u.y}`,
            type: u.launcherType,
            x: u.x,
            y: u.y,
            destroyed: false
          }));
        allLaunchers.push(...placedLaunchers);
      }
      
      logger.info('=== Checking for launcher click ===', {
        isPlayerGrid,
        gridX,
        gridY,
        hasPlayerUnits: !!this.playerUnits,
        playerUnitsLaunchersCount: this.playerUnits?.launchers?.length || 0,
        unitPlacementLaunchersCount: this.unitPlacement?.placedUnits?.filter(u => u.type === 'launcher').length || 0,
        allLaunchersCount: allLaunchers.length,
        allLaunchers: allLaunchers.map(l => ({
          id: l.id,
          type: l.type,
          x: l.x,
          y: l.y,
          destroyed: l.destroyed
        }))
      });
      
      if (isPlayerGrid) {
        if (allLaunchers.length === 0) {
          logger.warn('No launchers found in playerUnits or unitPlacement');
          return;
        }
        const clickedLauncher = allLaunchers.find(l => {
          if (l.destroyed) {
            logger.info('Launcher destroyed, skipping', { launcherId: l.id });
            return false;
          }
          const config = this.config.launchers.find(c => c.id === l.type);
          if (!config) {
            logger.info('Launcher config not found', { launcherType: l.type });
            return false;
          }
          const [sizeX, sizeY] = config.size;
          const isOnLauncher = gridX >= l.x && gridX < l.x + sizeX &&
                 gridY >= l.y && gridY < l.y + sizeY;
          
          logger.info('Checking launcher bounds', {
            launcherId: l.id,
            launcherPos: { x: l.x, y: l.y },
            launcherSize: { sizeX, sizeY },
            clickPos: { gridX, gridY },
            isOnLauncher
          });
          
          return isOnLauncher;
        });
        
        if (clickedLauncher) {
          logger.info('=== LAUNCHER FOUND! ===', {
            launcherId: clickedLauncher.id,
            launcherType: clickedLauncher.type,
            launcherPosition: { x: clickedLauncher.x, y: clickedLauncher.y },
            clickPosition: { gridX, gridY, isPlayerGrid }
          });
          
          // Select launcher for shots
          const launcherConfig = this.config.launchers.find(c => c.id === clickedLauncher.type);
          if (launcherConfig) {
            logger.info('Launcher clicked in battle phase', {
              launcherId: clickedLauncher.id,
              launcherType: clickedLauncher.type,
              launcherConfig: launcherConfig.titleFA,
              manaCost: launcherConfig.manaCost,
              currentMana: this.mana,
              launcherPosition: { x: clickedLauncher.x, y: clickedLauncher.y },
              clickPosition: { gridX, gridY, isPlayerGrid },
              clickScreenPosition: { x: pointer.x, y: pointer.y }
            });
            
            // Check if enough mana to fire this launcher
            if (this.mana < launcherConfig.manaCost) {
              const requiredMana = launcherConfig.manaCost;
              this.onNotification(`مانا کافی نیست، مقدار لازم ${requiredMana} واحد`);
              logger.warn('Cannot select launcher - insufficient mana', {
                currentMana: this.mana,
                requiredMana: launcherConfig.manaCost,
                launcherType: clickedLauncher.type
              });
              return;
            }
            
            // Check how many shots already planned for this launcher
            const shotsForThisLauncher = this.pendingShots.filter(s => s.launcherId === clickedLauncher.id).length;
            const maxShotsPerLauncher = this.config.mana.maxShotsPerLauncherPerTurn || 1;
            
            if (shotsForThisLauncher >= maxShotsPerLauncher) {
              this.onNotification(`حداکثر ${maxShotsPerLauncher} شلیک از این موشک‌انداز در این نوبت امکان‌پذیر است`);
              return;
            }
            
            // Check total shots
            if (this.pendingShots.length >= this.config.mana.maxShotsPerTurn) {
              this.onNotification(`حداکثر ${this.config.mana.maxShotsPerTurn} شلیک در این نوبت امکان‌پذیر است`);
              return;
            }
            
            // Enter aiming mode immediately - no second click needed
            logger.info('=== SETTING AIMING MODE ===', {
              before: {
                aimingMode: this.aimingMode,
                isDrawingPath: this.isDrawingPath,
                selectedLauncher: this.selectedLauncherForShots?.id
              }
            });
            
            this.selectedLauncherForShots = clickedLauncher;
            this.currentPathTiles = []; // Start with empty path - will be filled by drag
            this.aimingMode = true;
            this.pathSelectionMode = true;
            this.isDrawingPath = true; // Enable drawing immediately after launcher selection
            
            logger.info('=== AIMING MODE SET ===', {
              after: {
                aimingMode: this.aimingMode,
                isDrawingPath: this.isDrawingPath,
                selectedLauncher: this.selectedLauncherForShots?.id
              }
            });
            
            // Initialize path highlight graphics
            if (!this.pathHighlightGraphics) {
              this.pathHighlightGraphics = this.add.graphics();
              this.pathHighlightGraphics.setDepth(40);
            }
            
            // Draw highlight around selected launcher
            this.drawLauncherHighlight(clickedLauncher, launcherConfig);
            
            // Show and update baroot amount based on launcher
            this.updateBarootDisplay(launcherConfig.manaCost);
            
            // Keep FIRE button enabled (it's always active during player's turn)
            // User can fire if path is drawn, or end turn if no path
            if (this.fireButton && this.currentTurn === this.gameState.playerId) {
              this.fireButton.setAlpha(1.0);
              this.fireButtonText.setAlpha(1.0);
              this.fireButton.setInteractive({ useHandCursor: true });
            }
            
            // Hide unit panel buttons in battle phase
            this.hideUnitPanelInBattle();
            
            // Don't start path yet - wait for user to drag from an adjacent tile
            // Path will start when user drags from a tile adjacent to launcher
            logger.info('Aiming mode activated, ready for drag', {
              launcherId: clickedLauncher.id,
              launcherPosition: { x: clickedLauncher.x, y: clickedLauncher.y },
              clickGridPosition: { gridX, gridY, isPlayerGrid },
              clickScreenPosition: { x: pointer.x, y: pointer.y },
              isDrawingPath: this.isDrawingPath,
              aimingMode: this.aimingMode
            });
            
            // Initialize empty path - will be filled when user drags from adjacent tile
            this.currentPathTiles = [];
            
            logger.info('Aiming mode ready - path will start when dragging from adjacent tile', {
              launcherId: clickedLauncher.id,
              launcherPosition: { x: clickedLauncher.x, y: clickedLauncher.y },
              clickPosition: { gridX, gridY, isPlayerGrid },
              pathLength: this.currentPathTiles.length,
              isDrawingPath: this.isDrawingPath,
              aimingMode: this.aimingMode
            });
            
            // Set up drag tracking - don't return, allow pointer to continue tracking
            // The pointermove handler will catch the drag
          }
        }
      }
      // If not clicking on launcher and not in aiming mode, do nothing
            return;
          }
    
    // If in aiming mode and clicking on grid (not on launcher), continue path
    if (this.aimingMode && this.selectedLauncherForShots && this.isDrawingPath) {
      // Continue drawing path from this tile
      const newTile = { x: gridX, y: gridY, isPlayerGrid };
      
      // Add tile if not already in path
      const existingIndex = this.currentPathTiles.findIndex(t => t.x === newTile.x && t.y === newTile.y);
      if (existingIndex === -1) {
        // Check if adjacent to last tile
        if (this.currentPathTiles.length > 0) {
          const lastTile = this.currentPathTiles[this.currentPathTiles.length - 1];
          const isAdj = Math.abs(newTile.x - lastTile.x) <= 1 && 
                        Math.abs(newTile.y - lastTile.y) <= 1 &&
                        !(newTile.x === lastTile.x && newTile.y === lastTile.y);
          
          if (isAdj) {
            this.currentPathTiles.push(newTile);
            this.drawPathHighlight();
            this.updateBarootDisplay();
          }
        } else {
          // First tile
          this.currentPathTiles = [newTile];
          this.drawPathHighlight();
          this.updateBarootDisplay();
        }
      } else if (existingIndex >= 0 && existingIndex < this.currentPathTiles.length - 1) {
        // Backward click - reset path to this cell
        this.currentPathTiles = this.currentPathTiles.slice(0, existingIndex + 1);
        this.drawPathHighlight();
        this.updateBarootDisplay();
      }
    }
  }
  
  // Helper function to get all intermediate tiles between two points
  // Uses Bresenham-like line algorithm to fill gaps when dragging fast
  getIntermediateTiles(startTile, endTile) {
    const tiles = [];
    const dx = endTile.x - startTile.x;
    const dy = endTile.y - startTile.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    
    if (steps <= 1) {
      // Already adjacent, no intermediate tiles
      return tiles;
    }
    
    // Generate intermediate tiles
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = Math.round(startTile.x + dx * t);
      const y = Math.round(startTile.y + dy * t);
      
      // Only add if it's different from start and end, and within bounds
      if ((x !== startTile.x || y !== startTile.y) && 
          (x !== endTile.x || y !== endTile.y)) {
        tiles.push({ x, y, isPlayerGrid: startTile.isPlayerGrid });
      }
    }
    
    return tiles;
  }

  handleBattleDrag(pointer) {
    logger.info('=== handleBattleDrag called ===', {
      pointerX: pointer.x,
      pointerY: pointer.y,
      pointerIsDown: pointer.isDown,
      aimingMode: this.aimingMode,
      selectedLauncher: this.selectedLauncherForShots?.id,
      selectedLauncherPosition: this.selectedLauncherForShots ? { x: this.selectedLauncherForShots.x, y: this.selectedLauncherForShots.y } : null,
      isDrawingPath: this.isDrawingPath,
      currentPathLength: this.currentPathTiles?.length || 0
    });
    
    if (!this.aimingMode || !this.selectedLauncherForShots || !this.isDrawingPath) {
      logger.warn('Drag blocked in handleBattleDrag', {
        aimingMode: this.aimingMode,
        selectedLauncher: this.selectedLauncherForShots?.id,
        isDrawingPath: this.isDrawingPath
      });
      return;
    }
    
    const separatorWidth = 4;
    const opponentOffsetX = GRID_OFFSET_X + (this.gridSize * GRID_TILE_SIZE) + separatorWidth;
    const playerGridEndX = GRID_OFFSET_X + (this.gridSize * GRID_TILE_SIZE);
    const enemyGridEndX = opponentOffsetX + (this.gridSize * GRID_TILE_SIZE);
    
    // Determine which grid the pointer is on
    let gridX, gridY, isPlayerGrid;
    
    if (pointer.x >= GRID_OFFSET_X && pointer.x < playerGridEndX) {
      // Player grid
      gridX = Math.floor((pointer.x - GRID_OFFSET_X) / GRID_TILE_SIZE);
      gridY = Math.floor((pointer.y - GRID_OFFSET_Y) / GRID_TILE_SIZE);
      isPlayerGrid = true;
    } else if (pointer.x >= opponentOffsetX && pointer.x < enemyGridEndX) {
      // Enemy grid
      gridX = Math.floor((pointer.x - opponentOffsetX) / GRID_TILE_SIZE);
      gridY = Math.floor((pointer.y - GRID_OFFSET_Y) / GRID_TILE_SIZE);
      isPlayerGrid = false;
    } else {
      // Outside both grids
      logger.info('Drag outside grids', { 
        pointerX: pointer.x,
        pointerY: pointer.y,
        playerGridRange: { start: GRID_OFFSET_X, end: playerGridEndX },
        enemyGridRange: { start: opponentOffsetX, end: enemyGridEndX }
      });
      return;
    }
    
    // Validate grid coordinates
    if (gridX < 0 || gridX >= this.gridSize || gridY < 0 || gridY >= this.gridSize) {
      logger.info('Drag outside grid bounds', { gridX, gridY, gridSize: this.gridSize, isPlayerGrid });
      return;
    }
    
    logger.info('Drag on grid cell', {
      gridX,
      gridY,
      isPlayerGrid,
      pointerX: pointer.x,
      pointerY: pointer.y,
      currentPathLength: this.currentPathTiles?.length || 0
    });
    
      const newTile = { x: gridX, y: gridY, isPlayerGrid };
      
    // Check if new tile is inside launcher area
    // IMPORTANT: Launcher is always in player grid, so only check if tile is in player grid
    if (this.selectedLauncherForShots && this.isTileInLauncherArea(gridX, gridY, this.selectedLauncherForShots, isPlayerGrid)) {
      // If path exists and user drags into launcher area, clear the path
      // Shooting always starts from a tile adjacent to launcher, not from inside launcher
      if (this.currentPathTiles && this.currentPathTiles.length > 0) {
        logger.info('Dragging into launcher area - clearing path (path must start from outside launcher)', {
          tile: { x: gridX, y: gridY },
          launcher: { x: this.selectedLauncherForShots.x, y: this.selectedLauncherForShots.y },
          currentPathLength: this.currentPathTiles.length,
          clearedPath: this.currentPathTiles.map(t => ({ x: t.x, y: t.y, isPlayerGrid: t.isPlayerGrid }))
        });
        // Clear the path - user must start from a tile adjacent to launcher
        // IMPORTANT: Don't clear launcher highlight - launcher selection should remain
        this.currentPathTiles = [];
        this.drawPathHighlight();
        this.updateBarootDisplay();
        return;
      } else {
        // Path is empty, just skip - cannot start path from inside launcher
        logger.info('Tile inside launcher area, cannot start path from here', {
          tile: { x: gridX, y: gridY },
          launcher: { x: this.selectedLauncherForShots.x, y: this.selectedLauncherForShots.y }
        });
        return;
      }
    }
    
    logger.info('🔍 Processing tile (not in launcher area)', {
      tile: { x: gridX, y: gridY, isPlayerGrid },
      currentPathLength: this.currentPathTiles?.length || 0,
      hasPath: !!(this.currentPathTiles && this.currentPathTiles.length > 0)
    });
    
    // If path is empty, check if this tile is adjacent to launcher
    if (!this.currentPathTiles || this.currentPathTiles.length === 0) {
      if (!this.selectedLauncherForShots) {
        return; // No launcher selected
      }
      
      // IMPORTANT: Path must always start from player grid (launcher is in player grid)
      // Cannot start path from enemy grid
      if (!isPlayerGrid) {
        logger.info('Cannot start path from enemy grid - path must start from player grid adjacent to launcher', {
          tile: { x: gridX, y: gridY, isPlayerGrid },
          launcher: { x: this.selectedLauncherForShots.x, y: this.selectedLauncherForShots.y }
        });
        return;
      }
      
      // Check if this tile is adjacent to launcher (outside launcher area)
      // IMPORTANT: Launcher is always in player grid, so only check if tile is in player grid
      if (this.isTileInLauncherArea(gridX, gridY, this.selectedLauncherForShots, isPlayerGrid)) {
        logger.info('Cannot start path from inside launcher area', {
          tile: { x: gridX, y: gridY },
          launcher: { x: this.selectedLauncherForShots.x, y: this.selectedLauncherForShots.y }
        });
        return;
      }
      
      // Check if tile is adjacent to launcher perimeter
      const launcherConfig = this.config.launchers.find(c => c.id === this.selectedLauncherForShots.type);
      if (!launcherConfig) return;
      
      const [sizeX, sizeY] = launcherConfig.size;
      const launcher = this.selectedLauncherForShots;
      
      // Check if tile is adjacent to launcher (8 directions)
      // IMPORTANT: Launcher is always in player grid, so tile must also be in player grid
      const isAdjacentToLauncher = 
        // Right side
        (gridX === launcher.x + sizeX && gridY >= launcher.y && gridY < launcher.y + sizeY) ||
        // Left side
        (gridX === launcher.x - 1 && gridY >= launcher.y && gridY < launcher.y + sizeY) ||
        // Bottom side
        (gridY === launcher.y + sizeY && gridX >= launcher.x && gridX < launcher.x + sizeX) ||
        // Top side
        (gridY === launcher.y - 1 && gridX >= launcher.x && gridX < launcher.x + sizeX) ||
        // Corners
        (gridX === launcher.x - 1 && gridY === launcher.y - 1) ||
        (gridX === launcher.x + sizeX && gridY === launcher.y - 1) ||
        (gridX === launcher.x - 1 && gridY === launcher.y + sizeY) ||
        (gridX === launcher.x + sizeX && gridY === launcher.y + sizeY);
      
      if (!isAdjacentToLauncher) {
        logger.info('Tile not adjacent to launcher, cannot start path', {
          tile: { x: gridX, y: gridY, isPlayerGrid },
          launcher: { x: launcher.x, y: launcher.y, sizeX, sizeY },
          reason: 'Tile is not adjacent to launcher perimeter'
        });
        // IMPORTANT: Clear any existing path highlight if tile is not adjacent
        // This prevents showing green color for non-adjacent tiles
        if (this.currentPathTiles && this.currentPathTiles.length > 0) {
          this.currentPathTiles = [];
          this.drawPathHighlight(); // Clear the highlight
        }
        return;
      }
      
      // Start path from this adjacent tile
      // IMPORTANT: Only start path if tile is actually adjacent to launcher
      this.currentPathTiles = [newTile];
      this.drawPathHighlight();
      this.updateBarootDisplay();
      logger.info('Path started from adjacent tile', { 
        tile: newTile,
        gridX,
        gridY,
        isPlayerGrid
      });
      return;
    }
    
    // Check if tile is already in path (backward drag - reset to that cell)
    // BUT: Only check this AFTER we've verified the tile is not in launcher area
    // and is adjacent to the last tile. This prevents false truncation.
    const existingIndex = this.currentPathTiles.findIndex(t => 
      t.x === newTile.x && t.y === newTile.y && t.isPlayerGrid === newTile.isPlayerGrid
    );
    
    // Only process backward drag if tile is actually in path AND we're going backward
    // Don't truncate if we're just hovering or if tile is adjacent and new
    if (existingIndex >= 0) {
        const lastTile = this.currentPathTiles[this.currentPathTiles.length - 1];
      const isLastTile = existingIndex === this.currentPathTiles.length - 1;
      
      if (isLastTile) {
        // Hovering over the last tile - don't do anything, allow continuing
        logger.info('Hovering over last tile, allowing continue', {
          tile: { x: newTile.x, y: newTile.y, isPlayerGrid: newTile.isPlayerGrid },
          pathLength: this.currentPathTiles.length,
          existingIndex
        });
        return;
      } else {
        // Backward drag - reset path to this cell
        // Only truncate if we're actually going backward (not just passing through)
        const distanceFromLast = this.currentPathTiles.length - 1 - existingIndex;
        
        // IMPORTANT: If truncating to index 0 (first tile), check if it's still adjacent to launcher
        // If first tile is no longer adjacent to launcher (e.g., user dragged back too far),
        // we should clear the path entirely and let user start fresh from a valid adjacent tile
        if (existingIndex === 0) {
          // Check if first tile is still adjacent to launcher
          const firstTile = this.currentPathTiles[0];
          const launcherConfig = this.config.launchers.find(c => c.id === this.selectedLauncherForShots?.type);
          if (launcherConfig && this.selectedLauncherForShots) {
            const [sizeX, sizeY] = launcherConfig.size;
            const launcher = this.selectedLauncherForShots;
            const isFirstTileAdjacentToLauncher = 
              // Right side
              (firstTile.x === launcher.x + sizeX && firstTile.y >= launcher.y && firstTile.y < launcher.y + sizeY) ||
              // Left side
              (firstTile.x === launcher.x - 1 && firstTile.y >= launcher.y && firstTile.y < launcher.y + sizeY) ||
              // Bottom side
              (firstTile.y === launcher.y + sizeY && firstTile.x >= launcher.x && firstTile.x < launcher.x + sizeX) ||
              // Top side
              (firstTile.y === launcher.y - 1 && firstTile.x >= launcher.x && firstTile.x < launcher.x + sizeX) ||
              // Corners
              (firstTile.x === launcher.x - 1 && firstTile.y === launcher.y - 1) ||
              (firstTile.x === launcher.x + sizeX && firstTile.y === launcher.y - 1) ||
              (firstTile.x === launcher.x - 1 && firstTile.y === launcher.y + sizeY) ||
              (firstTile.x === launcher.x + sizeX && firstTile.y === launcher.y + sizeY);
            
            if (!isFirstTileAdjacentToLauncher) {
              // First tile is no longer adjacent to launcher - clear path
              logger.info('First tile no longer adjacent to launcher - clearing path', {
                firstTile: { x: firstTile.x, y: firstTile.y, isPlayerGrid: firstTile.isPlayerGrid },
                launcher: { x: launcher.x, y: launcher.y, sizeX, sizeY },
                pathLength: this.currentPathTiles.length
              });
              this.currentPathTiles = [];
              this.drawPathHighlight();
              this.updateBarootDisplay();
          return;
        }
          }
          
          // First tile is still valid - don't truncate, preserve it
          logger.info('Cannot truncate to before first tile (adjacent to launcher) - preserving first tile', {
            tile: { x: newTile.x, y: newTile.y, isPlayerGrid: newTile.isPlayerGrid },
            existingIndex,
            pathLength: this.currentPathTiles.length,
            firstTile: { x: this.currentPathTiles[0].x, y: this.currentPathTiles[0].y, isPlayerGrid: this.currentPathTiles[0].isPlayerGrid }
          });
          return; // Don't truncate, preserve the first tile
        }
        
        if (distanceFromLast > 1) {
          // Actually going backward - truncate (but never to before index 0)
          const truncateTo = Math.max(1, existingIndex + 1); // At least keep the first tile
          this.currentPathTiles = this.currentPathTiles.slice(0, truncateTo);
          this.drawPathHighlight();
          this.updateBarootDisplay();
          logger.info('Path truncated by backward drag', { 
            newLength: this.currentPathTiles.length,
            truncatedTo: { gridX, gridY, isPlayerGrid },
            existingIndex,
            distanceFromLast,
            truncateTo,
            lastTileBeforeTruncate: { x: lastTile.x, y: lastTile.y, isPlayerGrid: lastTile.isPlayerGrid },
            firstTilePreserved: { x: this.currentPathTiles[0].x, y: this.currentPathTiles[0].y, isPlayerGrid: this.currentPathTiles[0].isPlayerGrid },
            fullPath: this.currentPathTiles.map(t => ({ x: t.x, y: t.y, isPlayerGrid: t.isPlayerGrid }))
          });
        return;
        } else {
          // Tile is immediately before last tile (existingIndex = length - 2)
          // This might be a duplicate or we're going back one step
          // Allow it to continue - don't truncate for single step backward
          logger.info('Tile is one step back from last - allowing continue without truncation', {
            tile: { x: newTile.x, y: newTile.y, isPlayerGrid: newTile.isPlayerGrid },
            existingIndex,
            pathLength: this.currentPathTiles.length,
            distanceFromLast: distanceFromLast
          });
          // Don't return - allow the tile to be processed normally (might be a duplicate, will be filtered by existingIndex check later)
        }
      }
    }
    
    // Check if adjacent to last tile (can be in different grids)
      if (this.currentPathTiles.length > 0) {
        const lastTile = this.currentPathTiles[this.currentPathTiles.length - 1];
      
      // Adjacency check: tiles are adjacent if they are next to each other
      // For tiles in different grids: check if they are at the boundary
      let isAdj = false;
      
      if (newTile.isPlayerGrid === lastTile.isPlayerGrid) {
        // Same grid: check normal adjacency (horizontal, vertical, or diagonal)
        const dx = Math.abs(newTile.x - lastTile.x);
        const dy = Math.abs(newTile.y - lastTile.y);
        isAdj = (dx === 1 && dy === 0) ||  // Horizontal
                (dx === 0 && dy === 1) ||   // Vertical
                (dx === 1 && dy === 1);     // Diagonal
        
        // If not adjacent but on a straight line (horizontal, vertical, or diagonal),
        // we should fill intermediate tiles
        const isStraightLine = (dx > 0 && dy === 0) ||  // Horizontal line
                               (dx === 0 && dy > 0) ||  // Vertical line
                               (dx === dy && dx > 0);    // Diagonal line
        
        if (!isAdj && isStraightLine) {
          // Fill intermediate tiles
          const intermediateTiles = this.getIntermediateTiles(lastTile, newTile);
          logger.info('Filling intermediate tiles for fast drag', {
            lastTile: { x: lastTile.x, y: lastTile.y, isPlayerGrid: lastTile.isPlayerGrid },
            newTile: { x: newTile.x, y: newTile.y, isPlayerGrid: newTile.isPlayerGrid },
            dx, dy,
            intermediateCount: intermediateTiles.length,
            intermediateTiles: intermediateTiles.map(t => ({ x: t.x, y: t.y }))
          });
          
          // Add intermediate tiles one by one (they will be validated individually)
          for (const intermediateTile of intermediateTiles) {
            // Check if intermediate tile is already in path
            const intermediateIndex = this.currentPathTiles.findIndex(t => 
              t.x === intermediateTile.x && t.y === intermediateTile.y && t.isPlayerGrid === intermediateTile.isPlayerGrid
            );
            
            if (intermediateIndex === -1) {
              // Check range for each intermediate tile
              const currentPathLength = this.currentPathTiles.length;
              const pathLengthAfterAdd = currentPathLength + 1;
              
              let withinRange = true;
              if (this.selectedLauncherForShots) {
                const launcherConfig = this.config.launchers.find(l => l.id === this.selectedLauncherForShots.type);
                if (launcherConfig && launcherConfig.range) {
                  withinRange = pathLengthAfterAdd <= launcherConfig.range;
                }
              }
              
              if (withinRange) {
                this.currentPathTiles.push(intermediateTile);
                logger.info('✅ Intermediate tile added to path', {
                  tile: { x: intermediateTile.x, y: intermediateTile.y, isPlayerGrid: intermediateTile.isPlayerGrid },
                  pathLength: this.currentPathTiles.length
                });
              } else {
                logger.warn('Intermediate tile exceeds range, stopping', {
                  tile: { x: intermediateTile.x, y: intermediateTile.y },
                  pathLengthAfterAdd,
                  maxRange: this.selectedLauncherForShots ? (this.config.launchers.find(l => l.id === this.selectedLauncherForShots.type)?.range || 0) : 0
                });
                break; // Stop adding intermediate tiles if range exceeded
              }
            }
          }
          
          // After adding intermediate tiles, update the path display
          this.drawPathHighlight();
          this.updateBarootDisplay();
          
          // After adding intermediate tiles, the newTile should now be adjacent to the last tile
          const updatedLastTile = this.currentPathTiles[this.currentPathTiles.length - 1];
          const updatedDx = Math.abs(newTile.x - updatedLastTile.x);
          const updatedDy = Math.abs(newTile.y - updatedLastTile.y);
          isAdj = (updatedDx === 1 && updatedDy === 0) ||  // Horizontal
                  (updatedDx === 0 && updatedDy === 1) ||   // Vertical
                  (updatedDx === 1 && updatedDy === 1);     // Diagonal
          
          // If newTile is now adjacent after filling intermediate tiles, we should add it
          // But first check if it's already in path (might have been added as intermediate)
          const newTileInPath = this.currentPathTiles.findIndex(t => 
            t.x === newTile.x && t.y === newTile.y && t.isPlayerGrid === newTile.isPlayerGrid
          ) !== -1;
          
          if (isAdj && !newTileInPath) {
            // newTile is adjacent and not in path - add it
            const currentPathLength = this.currentPathTiles.length;
            const pathLengthAfterAdd = currentPathLength + 1;
            
            let withinRange = true;
            if (this.selectedLauncherForShots) {
              const launcherConfig = this.config.launchers.find(l => l.id === this.selectedLauncherForShots.type);
              if (launcherConfig && launcherConfig.range) {
                withinRange = pathLengthAfterAdd <= launcherConfig.range;
              }
            }
            
            if (withinRange) {
      this.currentPathTiles.push(newTile);
      this.drawPathHighlight();
              this.updateBarootDisplay();
              logger.info('✅ New tile added after intermediate tiles', {
                tile: { x: newTile.x, y: newTile.y, isPlayerGrid: newTile.isPlayerGrid },
                pathLength: this.currentPathTiles.length
              });
            }
          }
        }
        
        logger.info('Same grid adjacency check', {
          lastTile: { x: lastTile.x, y: lastTile.y, isPlayerGrid: lastTile.isPlayerGrid },
          newTile: { x: newTile.x, y: newTile.y, isPlayerGrid: newTile.isPlayerGrid },
          dx, dy, isAdj,
          filledIntermediate: !isAdj && isStraightLine
        });
      } else {
        // Different grids: tiles are adjacent if they are at the boundary between grids
        // The grids are side by side, so tiles at the right edge of player grid (x=gridSize-1)
        // are adjacent to tiles at the left edge of enemy grid (x=0) with the same y
        if (lastTile.isPlayerGrid && !newTile.isPlayerGrid) {
          // From player grid to enemy grid: right edge of player grid to left edge of enemy grid
          isAdj = (lastTile.x === this.gridSize - 1 && newTile.x === 0 && lastTile.y === newTile.y);
          logger.info('Player to enemy grid adjacency check', {
            lastTile: { x: lastTile.x, y: lastTile.y, isPlayerGrid: lastTile.isPlayerGrid },
            newTile: { x: newTile.x, y: newTile.y, isPlayerGrid: newTile.isPlayerGrid },
            isAdj,
            condition: `lastTile.x (${lastTile.x}) === gridSize-1 (${this.gridSize - 1}) && newTile.x (${newTile.x}) === 0 && lastTile.y (${lastTile.y}) === newTile.y (${newTile.y})`
          });
        } else if (!lastTile.isPlayerGrid && newTile.isPlayerGrid) {
          // From enemy grid to player grid: left edge of enemy grid to right edge of player grid
          isAdj = (lastTile.x === 0 && newTile.x === this.gridSize - 1 && lastTile.y === newTile.y);
          logger.info('Enemy to player grid adjacency check', {
            lastTile: { x: lastTile.x, y: lastTile.y, isPlayerGrid: lastTile.isPlayerGrid },
            newTile: { x: newTile.x, y: newTile.y, isPlayerGrid: newTile.isPlayerGrid },
            isAdj,
            condition: `lastTile.x (${lastTile.x}) === 0 && newTile.x (${newTile.x}) === gridSize-1 (${this.gridSize - 1}) && lastTile.y (${lastTile.y}) === newTile.y (${newTile.y})`
          });
        } else {
          // Both in enemy grid but different isPlayerGrid flags? Should not happen, but log it
          logger.warn('Unexpected grid state in adjacency check', {
            lastTile: { x: lastTile.x, y: lastTile.y, isPlayerGrid: lastTile.isPlayerGrid },
            newTile: { x: newTile.x, y: newTile.y, isPlayerGrid: newTile.isPlayerGrid }
          });
        }
      }
      
      // Check range limit (path length, not Manhattan distance)
      // Range = maximum number of tiles in the path (simple count of colored tiles)
      // Path starts from first adjacent tile, so path length = number of colored tiles
      let withinRange = true;
      if (this.selectedLauncherForShots) {
        const launcherConfig = this.config.launchers.find(l => l.id === this.selectedLauncherForShots.type);
        if (launcherConfig && launcherConfig.range) {
          // Simple calculation: path length = number of tiles in currentPathTiles
          // After adding new tile, path length will be currentPathTiles.length + 1
          const currentPathLength = this.currentPathTiles.length;
          const pathLengthAfterAdd = currentPathLength + 1;
          
          // Range is the maximum number of tiles in the path (including first adjacent tile)
          // So if range = 15, we can have 15 tiles total
          withinRange = pathLengthAfterAdd <= launcherConfig.range;
          
          logger.info('Range check (simple tile count)', {
            currentPathLength,
            pathLengthAfterAdd,
            maxRange: launcherConfig.range,
            launcherType: launcherConfig.id,
            withinRange,
            calculation: `${pathLengthAfterAdd} <= ${launcherConfig.range} = ${withinRange}`,
            pathTiles: this.currentPathTiles.map((t, idx) => ({ 
              index: idx + 1, 
              x: t.x, 
              y: t.y, 
              isPlayerGrid: t.isPlayerGrid 
            }))
          });
          
          if (!withinRange) {
            logger.warn('Path length exceeds range - BLOCKING TILE', {
              currentPathLength,
              pathLengthAfterAdd,
              maxRange: launcherConfig.range,
              launcherType: launcherConfig.id,
              reason: `Cannot add tile ${pathLengthAfterAdd} because max range is ${launcherConfig.range}`
            });
          }
        }
      }
      
      logger.info('Checking adjacency and range', {
        newTile: { x: newTile.x, y: newTile.y, isPlayerGrid: newTile.isPlayerGrid },
        lastTile: { x: lastTile.x, y: lastTile.y, isPlayerGrid: lastTile.isPlayerGrid },
        isAdj,
        withinRange,
        existingIndex,
        currentPathLength: this.currentPathTiles.length,
        maxRange: this.selectedLauncherForShots ? (this.config.launchers.find(l => l.id === this.selectedLauncherForShots.type)?.range || 0) : 0
      });
      
      if (isAdj && withinRange && existingIndex === -1) {
        // Add new adjacent tile
        this.currentPathTiles.push(newTile);
        this.drawPathHighlight();
        this.updateBarootDisplay();
        const finalPathLength = this.currentPathTiles.length;
        logger.info('✅ Tile added to path', { 
          newTile: { gridX, gridY, isPlayerGrid },
          pathLength: finalPathLength,
          maxRange: this.selectedLauncherForShots ? (this.config.launchers.find(l => l.id === this.selectedLauncherForShots.type)?.range || 0) : 0,
          canAddMore: finalPathLength < (this.selectedLauncherForShots ? (this.config.launchers.find(l => l.id === this.selectedLauncherForShots.type)?.range || 0) : 0),
          fullPath: this.currentPathTiles.map((t, idx) => ({ 
            index: idx + 1, 
            x: t.x, 
            y: t.y, 
            isPlayerGrid: t.isPlayerGrid 
          }))
        });
      } else {
        const reason = !isAdj ? 'not adjacent' : !withinRange ? 'outside range' : existingIndex !== -1 ? 'already exists' : 'unknown';
        logger.warn('❌ Tile NOT added to path', {
          reason,
          newTile: { gridX, gridY, isPlayerGrid },
          lastTile: { x: lastTile.x, y: lastTile.y, isPlayerGrid: lastTile.isPlayerGrid },
          currentPathLength: this.currentPathTiles.length,
          pathLengthAfterAdd: this.currentPathTiles.length + 1,
          maxRange: this.selectedLauncherForShots ? (this.config.launchers.find(l => l.id === this.selectedLauncherForShots.type)?.range || 0) : 0,
          isAdj,
          withinRange,
          existingIndex,
          details: {
            isAdjCheck: isAdj,
            withinRangeCheck: withinRange,
            existingIndexCheck: existingIndex === -1,
            allConditionsMet: isAdj && withinRange && existingIndex === -1
          }
        });
      }
    }
  }
  
  drawLauncherHighlight(launcher, launcherConfig) {
    // Clear previous highlight
    if (this.launcherHighlightGraphics) {
      this.launcherHighlightGraphics.destroy();
    }
    
    // Create new graphics for launcher highlight
    this.launcherHighlightGraphics = this.add.graphics();
    this.launcherHighlightGraphics.setDepth(50); // Above units but below path
    
    const [sizeX, sizeY] = launcherConfig.size;
    const startX = GRID_OFFSET_X + launcher.x * GRID_TILE_SIZE;
    const startY = GRID_OFFSET_Y + launcher.y * GRID_TILE_SIZE;
    const width = sizeX * GRID_TILE_SIZE;
    const height = sizeY * GRID_TILE_SIZE;
    
    // Draw border around launcher (thick, animated color)
    this.launcherHighlightGraphics.lineStyle(4, 0x00ff00, 1.0); // Green, thick line
    this.launcherHighlightGraphics.strokeRect(startX, startY, width, height);
    
    // Draw corner markers for better visibility
    const cornerSize = 8;
    this.launcherHighlightGraphics.fillStyle(0x00ff00, 1.0);
    
    // Top-left corner
    this.launcherHighlightGraphics.fillRect(startX - 2, startY - 2, cornerSize, cornerSize);
    // Top-right corner
    this.launcherHighlightGraphics.fillRect(startX + width - cornerSize + 2, startY - 2, cornerSize, cornerSize);
    // Bottom-left corner
    this.launcherHighlightGraphics.fillRect(startX - 2, startY + height - cornerSize + 2, cornerSize, cornerSize);
    // Bottom-right corner
    this.launcherHighlightGraphics.fillRect(startX + width - cornerSize + 2, startY + height - cornerSize + 2, cornerSize, cornerSize);
    
    logger.info('Launcher highlight drawn', {
      launcherId: launcher.id,
      position: { x: launcher.x, y: launcher.y },
      size: { sizeX, sizeY },
      screenPosition: { startX, startY },
      dimensions: { width, height }
    });
  }
  
  clearLauncherHighlight() {
    if (this.launcherHighlightGraphics) {
      this.launcherHighlightGraphics.destroy();
      this.launcherHighlightGraphics = null;
    }
  }
  
  updateBarootDisplay(barootAmount = null) {
    if (this.currentPhase !== GAME_PHASES.BATTLE) return;
    
    if (!this.budgetText) return;
    
    // Baroot should show current mana (available mana for this turn)
    // Not the launcher cost, but the player's current mana
    let baroot = this.mana || 0;
    
    // Ensure position is correct (right side, above FIRE button)
    const panelX = 1000; // Right side
    const fireButtonY = 600; // FIRE button Y position
    const barootY = fireButtonY - 300; // Above FIRE button (300)
    
    this.budgetText.setPosition(panelX, barootY);
    this.budgetText.setText(`مقدار باروت: ${baroot}`);
    this.budgetText.setVisible(true);
    
    logger.info('Baroot display updated', {
      x: panelX,
      y: barootY,
      baroot: baroot,
      currentMana: this.mana
    });
  }
  
  handleBattlePointerUp(pointer) {
    logger.info('Battle pointer up', {
      pointerX: pointer.x,
      pointerY: pointer.y,
      aimingMode: this.aimingMode,
      isDrawingPath: this.isDrawingPath,
      currentPathLength: this.currentPathTiles?.length || 0
    });
    
    this.isPointerDown = false; // Reset pointer down state
    
    if (!this.aimingMode) {
      logger.info('Pointer up but not in aiming mode');
      return;
    }
    
    // Don't disable drawing path on pointer up - keep it enabled for continuous drawing
    // Only disable when explicitly resetting (e.g., after firing or turn change)
    // this.isDrawingPath = false; // REMOVED - keep drawing enabled
    
    // Update baroot display based on final path
    this.updateBarootDisplay();
    
    // Path drawing complete - enable FIRE button if path is valid
    if (this.currentPathTiles && this.currentPathTiles.length >= 2) {
      const finalPathLength = this.currentPathTiles.length;
      const expectedMaxRange = this.selectedLauncherForShots ? 
        (this.config.launchers.find(l => l.id === this.selectedLauncherForShots.type)?.range || 0) : 0;
      
      logger.info('Path complete, enabling FIRE button', {
        pathLength: finalPathLength,
        expectedMaxRange: expectedMaxRange,
        canAddMore: finalPathLength < expectedMaxRange,
        path: this.currentPathTiles.map((t, idx) => ({ 
          index: idx + 1,
          x: t.x, 
          y: t.y, 
          isPlayerGrid: t.isPlayerGrid 
        }))
      });
      
      if (finalPathLength < expectedMaxRange) {
        logger.warn('⚠️ Path is shorter than max range!', {
          currentLength: finalPathLength,
          expectedMax: expectedMaxRange,
          missing: expectedMaxRange - finalPathLength,
          launcherType: this.selectedLauncherForShots?.type
        });
      }
      // Path is valid - FIRE button is already enabled (always enabled during player's turn)
      if (this.fireButton && this.currentTurn === this.gameState.playerId) {
        this.fireButton.setAlpha(1.0);
        this.fireButton.setFillStyle(0xff0000);
        this.fireButtonText.setAlpha(1.0);
        this.fireButton.setInteractive({ useHandCursor: true });
      }
    } else {
      logger.info('Path too short, but FIRE button remains enabled (can end turn)', {
        pathLength: this.currentPathTiles?.length || 0
      });
      // Path too short - but FIRE button stays enabled (can end turn without firing)
      if (this.fireButton && this.currentTurn === this.gameState.playerId) {
        this.fireButton.setAlpha(1.0);
        this.fireButtonText.setAlpha(1.0);
        this.fireButton.setInteractive({ useHandCursor: true });
      }
    }
  }
  
  hideUnitPanelInBattle() {
    // Hide launcher buttons and their texts
    if (this.launcherButtonsGroup) {
      if (this.launcherButtonsGroup.label) {
        this.launcherButtonsGroup.label.setVisible(false);
      }
      this.launcherButtonsGroup.buttons.forEach(buttonData => {
        if (buttonData.btn) buttonData.btn.setVisible(false);
        if (buttonData.titleText) buttonData.titleText.setVisible(false);
        if (buttonData.costText) buttonData.costText.setVisible(false);
      });
    }
    
    // Hide build budget text (only for build phase)
    if (this.buildBudgetText) {
      this.buildBudgetText.setVisible(false);
    }
    
    // Baroot text will be shown when launcher is selected (handled in updateBarootDisplay)
    
    // Hide defense buttons and their texts
    if (this.defenseButtonsGroup) {
      if (this.defenseButtonsGroup.label) {
        this.defenseButtonsGroup.label.setVisible(false);
      }
      this.defenseButtonsGroup.buttons.forEach(buttonData => {
        if (buttonData.btn) buttonData.btn.setVisible(false);
        if (buttonData.titleText) buttonData.titleText.setVisible(false);
        if (buttonData.costText) buttonData.costText.setVisible(false);
      });
    }
    
    // Hide ready button
    if (this.readyButton) {
      this.readyButton.setVisible(false);
      this.readyButtonText.setVisible(false);
    }
  }
  
  showUnitPanelInBuild() {
    // Show launcher buttons and their texts
    if (this.launcherButtonsGroup) {
      if (this.launcherButtonsGroup.label) {
        this.launcherButtonsGroup.label.setVisible(true);
      }
      this.launcherButtonsGroup.buttons.forEach(buttonData => {
        if (buttonData.btn) buttonData.btn.setVisible(true);
        if (buttonData.titleText) buttonData.titleText.setVisible(true);
        if (buttonData.costText) buttonData.costText.setVisible(true);
      });
    }
    
    // Show build budget text
    if (this.buildBudgetText) {
      this.buildBudgetText.setVisible(true);
    }
    
    // Hide baroot text (only for battle phase)
    if (this.budgetText) {
      this.budgetText.setVisible(false);
    }
    
    // Show defense buttons and their texts
    if (this.defenseButtonsGroup) {
      if (this.defenseButtonsGroup.label) {
        this.defenseButtonsGroup.label.setVisible(true);
      }
      this.defenseButtonsGroup.buttons.forEach(buttonData => {
        if (buttonData.btn) buttonData.btn.setVisible(true);
        if (buttonData.titleText) buttonData.titleText.setVisible(true);
        if (buttonData.costText) buttonData.costText.setVisible(true);
      });
    }
    
    // Show ready button
    if (this.readyButton) {
      this.readyButton.setVisible(true);
      this.readyButtonText.setVisible(true);
    }
  }
  
  drawPathHighlight() {
    if (!this.pathHighlightGraphics) return;
    
    this.pathHighlightGraphics.clear();
    
    if (!this.currentPathTiles || this.currentPathTiles.length === 0) return;
    
    const separatorWidth = 4;
    const opponentOffsetX = GRID_OFFSET_X + (this.gridSize * GRID_TILE_SIZE) + separatorWidth;
    
    // Draw transparent overlay for path cells (more visible)
    this.currentPathTiles.forEach((tile, index) => {
      const offsetX = tile.isPlayerGrid ? GRID_OFFSET_X : opponentOffsetX;
      const x = offsetX + tile.x * GRID_TILE_SIZE;
      const y = GRID_OFFSET_Y + tile.y * GRID_TILE_SIZE;
      
      // Different opacity for start/end vs middle
      const alpha = (index === 0 || index === this.currentPathTiles.length - 1) ? 0.7 : 0.5;
      const color = index === 0 ? 0x00ff00 : (index === this.currentPathTiles.length - 1 ? 0xff0000 : 0xffaa00);
      
      this.pathHighlightGraphics.fillStyle(color, alpha);
      this.pathHighlightGraphics.fillRect(x, y, GRID_TILE_SIZE, GRID_TILE_SIZE);
      
      // Draw border
      this.pathHighlightGraphics.lineStyle(2, color, 0.9);
      this.pathHighlightGraphics.strokeRect(x, y, GRID_TILE_SIZE, GRID_TILE_SIZE);
    });
    
    // Draw lines connecting path (thicker, more visible)
    this.pathHighlightGraphics.lineStyle(4, 0xffaa00, 0.8);
    for (let i = 0; i < this.currentPathTiles.length - 1; i++) {
      const start = this.currentPathTiles[i];
      const end = this.currentPathTiles[i + 1];
      
      const startOffsetX = start.isPlayerGrid ? GRID_OFFSET_X : opponentOffsetX;
      const endOffsetX = end.isPlayerGrid ? GRID_OFFSET_X : opponentOffsetX;
      
      const startX = startOffsetX + start.x * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
      const startY = GRID_OFFSET_Y + start.y * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
      const endX = endOffsetX + end.x * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
      const endY = GRID_OFFSET_Y + end.y * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
      
      this.pathHighlightGraphics.moveTo(startX, startY);
      this.pathHighlightGraphics.lineTo(endX, endY);
    }
  }
  
  finishPathSelection() {
    // Path is ready, but don't add to pending - just keep it ready for fire
    // The path is already in currentPathTiles, ready to fire
    if (this.currentPathTiles.length < 2) {
      return; // Path too short, do nothing
    }
    
    // Path is valid and ready - FIRE button will fire it
    this.isDrawingPath = false;
  }

  finishPathDrawing() {
    this.isDrawingPath = false;
    
    if (!this.selectedLauncher) {
      this.pathDrawer.clear();
      this.pathTiles = [];
      return;
    }
    
    if (this.pathTiles.length < 2) {
      this.onNotification('مسیر باید حداقل 2 خانه باشد');
      this.pathDrawer.clear();
      this.pathTiles = [];
      this.selectedLauncher = null;
      return;
    }
    
    // Validate mana again before sending
    const launcherConfig = this.config.launchers.find(c => c.id === this.selectedLauncher.type);
    if (launcherConfig && this.mana < launcherConfig.manaCost) {
      this.onNotification(`مانا کافی نیست. نیاز به ${launcherConfig.manaCost} مانا دارید.`);
      this.pathDrawer.clear();
      this.pathTiles = [];
      this.selectedLauncher = null;
      return;
    }
    
    // Send shot request
    this.sendShotRequest();
    this.pathTiles = [];
    this.selectedLauncher = null;
    this.pathDrawer.clear();
  }

  selectLauncherForShot(launcherType) {
    // This method is now used when clicking launcher button - but we prefer clicking on grid
    // Keep for backward compatibility but prefer grid click
    const launcher = this.playerUnits.launchers.find(l => 
      l.type === launcherType && !l.destroyed
    );
    
    if (launcher) {
      const launcherConfig = this.config.launchers.find(c => c.id === launcherType);
      if (launcherConfig && this.mana >= launcherConfig.manaCost) {
        this.selectedLauncher = launcher;
        this.onNotification(`موشک‌انداز ${launcherConfig.titleFA} انتخاب شد. روی زمین بازی کلیک کنید و drag کنید.`);
      } else if (launcherConfig) {
        this.onNotification(`مانا کافی نیست. نیاز به ${launcherConfig.manaCost} مانا دارید.`);
      }
    }
  }

  sendReady() {
    if (this.isReady) return; // Already ready
    
    this.isReady = true;
    this.gameState.ws.send(JSON.stringify({
      type: MESSAGE_TYPES.READY
    }));
    
    // Disable ready button
    this.readyButton.setFillStyle(0x1a2a3a);
    this.readyButton.setStrokeStyle(2, 0x666666);
    this.readyButton.disableInteractive();
    this.readyButtonText.setText(faTexts.notifications.waitingForOpponent);
    this.readyButtonText.setColor('#999999');
    
    // Hide build phase UI elements when ready
    this.hideBuildPhaseUI();
    
    this.onNotification(faTexts.notifications.waitingForOpponent);
  }
  
  hideBuildPhaseUI() {
    // Hide build phase timer
    if (this.buildPhaseTimer) {
      clearInterval(this.buildPhaseTimer);
      this.buildPhaseTimer = null;
    }
    if (this.timerText) {
      this.timerText.destroy();
      this.timerText = null;
    }
    
    // Hide build budget text
    if (this.buildBudgetText) {
      this.buildBudgetText.setVisible(false);
    }
    
    // Hide unit panel (launcher and defense buttons)
    this.hideUnitPanelInBattle();
  }

  placeRandomLauncher() {
    logger.info('placeRandomLauncher called', {
      buildBudget: this.buildBudget,
      configBuildBudget: this.config?.buildBudget,
      currentPhase: this.currentPhase
    });
    
    // Get available launchers from config
    const availableLaunchers = this.config.launchers || [];
    if (availableLaunchers.length === 0) {
      logger.warn('No launchers available in config for random placement');
      return;
    }
    
    // Select cheapest launcher to ensure we can place it
    const cheapestLauncher = availableLaunchers.reduce((cheapest, launcher) => {
      return (!cheapest || launcher.cost < cheapest.cost) ? launcher : cheapest;
    }, null);
    
    if (!cheapestLauncher) {
      logger.warn('No launcher found for random placement');
      return;
    }
    
    // If budget is 0 or not set, use config value as fallback
    let availableBudget = this.buildBudget;
    if (availableBudget === 0 || availableBudget === undefined || availableBudget === null) {
      availableBudget = this.config?.buildBudget || 10;
      logger.warn('Budget is 0, using config fallback', {
        fallbackBudget: availableBudget,
        originalBudget: this.buildBudget
      });
      this.buildBudget = availableBudget;
    }
    
    // Check if we have enough budget
    if (availableBudget < cheapestLauncher.cost) {
      logger.warn('Not enough budget for random launcher placement', {
        budget: availableBudget,
        cost: cheapestLauncher.cost,
        cheapestLauncher: cheapestLauncher.id
      });
      return;
    }
    
    const randomLauncher = cheapestLauncher; // Use cheapest to ensure placement
    
    // Find a random valid position on player's grid (left side)
    // Player grid is from (0, 0) to (gridSize/2 - 1, gridSize - 1)
    const maxX = Math.floor(this.gridSize / 2) - 1;
    const maxY = this.gridSize - 1;
    const [sizeX, sizeY] = randomLauncher.size || [1, 1];
    
    // Try to find a valid position (not overlapping with existing units)
    let attempts = 0;
    let placed = false;
    
    while (attempts < 50 && !placed) {
      const x = Math.floor(Math.random() * (maxX - sizeX + 1));
      const y = Math.floor(Math.random() * (maxY - sizeY + 1));
      
      // Check if position is valid (not overlapping)
      const canPlace = this.unitPlacement.canPlaceUnit(x, y, sizeX, sizeY);
      
      if (canPlace) {
        logger.info('Placing random launcher', {
          launcherType: randomLauncher.id,
          position: { x, y },
          cost: randomLauncher.cost,
          budget: this.buildBudget
        });
        
        // Place the launcher (silently, no notification)
        placed = this.unitPlacement.placeLauncher(x, y, randomLauncher.id);
        
        if (placed) {
          logger.info('Random launcher placed successfully', {
            launcherType: randomLauncher.id,
            position: { x, y },
            remainingBudget: this.buildBudget
          });
        } else {
          logger.warn('Failed to place random launcher', {
            launcherType: randomLauncher.id,
            position: { x, y }
          });
        }
      }
      
      attempts++;
    }
    
    if (!placed) {
      logger.warn('Could not find valid position for random launcher after 50 attempts');
    } else {
      this.onNotification(`یک موشک‌انداز ${randomLauncher.titleFA} به صورت خودکار قرار گرفت`);
    }
  }

  endTurn() {
    logger.info('Ending turn without firing', {
      currentTurn: this.currentTurn,
      playerId: this.gameState.playerId
    });
    
    // Clear any partial path
    this.currentPathTiles = [];
    this.selectedLauncherForShots = null;
    this.pathSelectionMode = false;
    this.aimingMode = false;
    this.isDrawingPath = false;
    if (this.pathHighlightGraphics) {
      this.pathHighlightGraphics.clear();
    }
    this.clearLauncherHighlight();
    
    // Request turn switch from server
    this.gameState.ws.send(JSON.stringify({
      type: MESSAGE_TYPES.END_TURN
    }));
  }

  fireAllShots() {
    logger.info('fireAllShots called', {
      currentPathTiles: this.currentPathTiles?.length || 0,
      selectedLauncher: this.selectedLauncherForShots?.id,
      currentTurn: this.currentTurn,
      playerId: this.gameState.playerId,
      mana: this.mana
    });
    
    // Fire the current path (only one shot per turn)
    if (!this.currentPathTiles || this.currentPathTiles.length < 2 || !this.selectedLauncherForShots) {
      logger.warn('fireAllShots: No valid path to fire', {
        currentPathTiles: this.currentPathTiles?.length || 0,
        selectedLauncher: this.selectedLauncherForShots?.id
      });
      return; // No valid path to fire
    }
    
    // Check if it's player's turn
    if (this.currentTurn !== this.gameState.playerId) {
      logger.warn('fireAllShots: Not player\'s turn', {
        currentTurn: this.currentTurn,
        playerId: this.gameState.playerId
      });
      return;
    }
    
    // Get launcher config for mana cost
    const launcherConfig = this.config.launchers.find(c => c.id === this.selectedLauncherForShots.type);
    if (!launcherConfig) {
      logger.warn('fireAllShots: Launcher config not found', {
        launcherType: this.selectedLauncherForShots.type
      });
      return;
    }
    
    // Check if enough mana
    if (this.mana < launcherConfig.manaCost) {
      logger.warn('fireAllShots: Not enough mana', {
        mana: this.mana,
        required: launcherConfig.manaCost
      });
      return; // Not enough mana
    }
    
    // Send the shot
    logger.info('Sending shot request to server', {
      launcherId: this.selectedLauncherForShots.id,
      pathLength: this.currentPathTiles.length,
      pathTiles: this.currentPathTiles.map(t => ({ x: t.x, y: t.y }))
    });
      this.gameState.ws.send(JSON.stringify({
        type: MESSAGE_TYPES.REQUEST_SHOT,
      launcherId: this.selectedLauncherForShots.id,
      pathTiles: this.currentPathTiles.map(t => ({ x: t.x, y: t.y }))
    }));
    
    // Add to pending shots (for tracking multiple shots per turn)
    this.pendingShots.push({
      launcherId: this.selectedLauncherForShots.id,
      pathTiles: [...this.currentPathTiles]
    });
    
    // Clear current aiming state but allow selecting another launcher
    this.selectedLauncherForShots = null;
    this.currentPathTiles = [];
    this.pathSelectionMode = false;
    this.aimingMode = false;
    this.isDrawingPath = false;
    if (this.pathHighlightGraphics) {
      this.pathHighlightGraphics.clear();
    }
    // Clear launcher highlight
    this.clearLauncherHighlight();
    
    // Check if we can fire more shots
    const remainingShots = this.config.mana.maxShotsPerTurn - this.pendingShots.length;
    if (remainingShots > 0) {
      // FIRE button stays enabled (can fire more or end turn)
      if (this.fireButton && this.currentTurn === this.gameState.playerId) {
        this.fireButton.setAlpha(1.0);
        this.fireButtonText.setAlpha(1.0);
        this.fireButton.setInteractive({ useHandCursor: true });
      }
      logger.info('Shot fired, can fire more shots', {
        remainingShots,
        totalShots: this.pendingShots.length,
        maxShots: this.config.mana.maxShotsPerTurn
      });
    } else {
      // All shots fired, but FIRE button stays enabled (can end turn)
      if (this.fireButton && this.currentTurn === this.gameState.playerId) {
        this.fireButton.setAlpha(1.0);
        this.fireButtonText.setAlpha(1.0);
        this.fireButton.setInteractive({ useHandCursor: true });
      }
      logger.info('All shots fired for this turn, but can still end turn', {
        totalShots: this.pendingShots.length,
        maxShots: this.config.mana.maxShotsPerTurn
      });
    }
    
    // Stop timer
    this.stopBattleTurnTimer();
  }
  
  sendShotRequest() {
    // Legacy method - now we use fireAllShots
    this.fireAllShots();
  }

  handleServerMessage(data) {
    logger.info('handleServerMessage called', {
      messageType: data.type,
      playerId: this.gameState?.playerId,
      currentPhase: this.currentPhase,
      hasData: !!data
    });
    
    switch (data.type) {
      case MESSAGE_TYPES.ROOM_UPDATE:
        this.handleRoomUpdate(data);
        break;
      
      case MESSAGE_TYPES.BUILD_PHASE_STATE:
        logger.info('BUILD_PHASE_STATE message received, calling handleBuildPhaseState', {
          data: data,
          playerId: this.gameState?.playerId,
          currentPhase: this.currentPhase
        });
        this.handleBuildPhaseState(data);
        break;
      
      case MESSAGE_TYPES.BATTLE_STATE:
        this.handleBattleState(data);
        break;
      
      case MESSAGE_TYPES.MANA_UPDATE:
        // Update mana for current player (mana bar removed, just update internal state)
        if (data.mana && typeof data.mana === 'object') {
          // New format: { player1: X, player2: Y }
          this.mana = data.mana[this.gameState?.playerId] || this.mana;
        } else {
          // Old format: single number
          this.mana = data.mana || this.mana;
        }
        logger.info('Mana updated from server', {
          newMana: this.mana,
          playerId: this.gameState?.playerId,
          dataMana: data.mana
        });
        // Update baroot display with new mana
        if (this.currentPhase === GAME_PHASES.BATTLE) {
          this.updateBarootDisplay();
        }
        break;
      
      case MESSAGE_TYPES.TURN_CHANGE:
        logger.info('TURN_CHANGE received from server', {
          currentTurn: data.currentTurn,
          playerId: this.gameState.playerId,
          isMyTurn: data.currentTurn === this.gameState.playerId,
          mana: data.mana
        });
        this.currentTurn = data.currentTurn;
        this.mana = data.mana[this.gameState.playerId];
        this.shotsThisTurn = 0;
        // Mana bar removed - no need to update UI
        this.updateTurnIndicator();
        this.audioController.playSound('turnChange');
        
        // Reset pending shots on turn change
        this.pendingShots = [];
        this.selectedLauncherForShots = null;
        this.currentPathTiles = [];
        this.pathSelectionMode = false;
    this.aimingMode = false;
        if (this.pathHighlightGraphics) {
          this.pathHighlightGraphics.clear();
        }
    // Clear launcher highlight on turn change
    this.clearLauncherHighlight();
    
        // Disable FIRE button when not in aiming mode (keep visible in battle phase)
        if (this.fireButton && this.currentPhase === GAME_PHASES.BATTLE) {
          this.fireButton.setAlpha(0.5);
          this.fireButtonText.setAlpha(0.5);
        }
        
        // Hide baroot display on turn change
        if (this.budgetText && this.currentPhase === GAME_PHASES.BATTLE) {
          this.budgetText.setVisible(false);
        }
    
    // Start battle turn timer if it's player's turn
    if (this.currentTurn === this.gameState.playerId && this.currentPhase === GAME_PHASES.BATTLE) {
      this.startBattleTurnTimer();
    } else {
      this.stopBattleTurnTimer();
        }
        break;
      
      case MESSAGE_TYPES.APPLY_DAMAGE:
        this.handleDamage(data);
        break;
      
      case MESSAGE_TYPES.SHOT_REJECTED:
        logger.warn('Shot rejected by server', {
          reason: data.reason,
          currentMana: this.mana,
          pendingShots: this.pendingShots.length
        });
        // Remove the rejected shot from pending shots
        if (this.pendingShots.length > 0) {
          this.pendingShots.pop();
        }
        // Reset aiming state
        this.selectedLauncherForShots = null;
        this.currentPathTiles = [];
        this.aimingMode = false;
        this.isDrawingPath = false;
        if (this.pathHighlightGraphics) {
          this.pathHighlightGraphics.clear();
        }
        this.clearLauncherHighlight();
        this.onNotification(faTexts.notifications.shotRejected + ': ' + data.reason);
        this.audioController.playSound('error');
        break;
      
      case MESSAGE_TYPES.GAME_OVER:
        this.handleGameOver(data);
        break;
      
      case MESSAGE_TYPES.ERROR:
        if (data.message) {
          this.onNotification(data.message);
          if (this.audioController) {
            this.audioController.playSound('error');
          }
        }
        logger.warn('Server error message', { message: data.message });
        
        // If error occurs during build phase and we're ready, reset ready state
        // This allows timer to restart if needed
        if (this.currentPhase === GAME_PHASES.BUILD && this.isReady) {
          this.isReady = false;
          // Re-enable ready button
          if (this.readyButton) {
            this.readyButton.setFillStyle(0x2b3a42);
            this.readyButton.setStrokeStyle(2, 0xffd700);
            this.readyButton.setInteractive({ useHandCursor: true });
            this.readyButtonText.setText(faTexts.buttons.ready);
            this.readyButtonText.setColor('#ffd700');
          }
          // Clear timer if it exists (it should be cleared already, but just in case)
          if (this.buildPhaseTimer) {
            clearInterval(this.buildPhaseTimer);
            this.buildPhaseTimer = null;
          }
          if (this.timerText) {
            this.timerText.destroy();
            this.timerText = null;
          }
          // Restart timer if we're still in build phase
          if (this.currentPhase === GAME_PHASES.BUILD && !this.buildPhaseTimer && !this.timerText) {
            this.startBuildPhaseTimer();
          }
        }
        break;
    }
  }
  
  handleRoomUpdate(data) {
    logger.info('handleRoomUpdate called', {
      players: data.players,
      currentPhase: this.currentPhase,
      playerId: this.gameState.playerId,
      hasBuildPhaseTimer: !!this.buildPhaseTimer,
      hasTimerText: !!this.timerText
    });
    
    // Check if opponent connected
    if (data.players === 2) {
      if (this.currentPhase === GAME_PHASES.BUILD || this.currentPhase === GAME_PHASES.WAITING) {
        this.onNotification(faTexts.notifications.opponentConnected);
      }
    }
    
    // Player1: Start timer immediately when room is created (players === 1)
    // This happens when player1 creates a room and enters the game screen
    // Check both data.playerId and this.gameState.playerId to ensure we're player1
    const isPlayer1 = (data.playerId === 'player1' || this.gameState?.playerId === 'player1');
    
    if (data.players === 1 && isPlayer1) {
      logger.info('Player1: Room created, starting build phase timer', {
        currentPhase: this.currentPhase,
        hasBuildPhaseTimer: !!this.buildPhaseTimer,
        hasTimerText: !!this.timerText,
        playerId: this.gameState.playerId,
        isReady: this.isReady
      });
      
      // Set phase to BUILD (player1 enters build phase immediately)
      // Don't check if already BUILD - always set it to ensure consistency
      this.currentPhase = GAME_PHASES.BUILD;
      this.onPhaseChange(this.currentPhase);
      
      // Show unit panel buttons
      this.showUnitPanelInBuild();
      
      // Hide FIRE button in build phase
      if (this.fireButton) {
        this.fireButton.setVisible(false);
        this.fireButtonText.setVisible(false);
      }
      
      // Start timer if not already started (30 seconds for player1)
      // Force start timer even if it seems to exist (in case of stale state)
      if (!this.isReady) {
        if (this.buildPhaseTimer) {
          clearInterval(this.buildPhaseTimer);
          this.buildPhaseTimer = null;
        }
        if (this.timerText) {
          this.timerText.destroy();
          this.timerText = null;
        }
        logger.info('Player1: Starting 30-second build phase timer');
        this.startBuildPhaseTimer();
      } else {
        logger.info('Player1: Already ready, skipping timer start');
      }
    }
  }

  handleBuildPhaseState(data) {
    logger.info('handleBuildPhaseState called', {
      currentPhase: this.currentPhase,
      playerId: this.gameState?.playerId,
      dataPlayerId: data.playerId,
      buildBudget: data.buildBudget,
      phase: data.phase,
      hasBuildPhaseTimer: !!this.buildPhaseTimer,
      hasTimerText: !!this.timerText,
      isReady: this.isReady,
      hasGameState: !!this.gameState
    });
    
    // Set phase to BUILD if not already
    if (this.currentPhase !== GAME_PHASES.BUILD) {
      logger.info('Setting phase to BUILD', {
        previousPhase: this.currentPhase,
        playerId: this.gameState?.playerId
      });
      this.currentPhase = GAME_PHASES.BUILD;
      this.onPhaseChange(this.currentPhase);
      
      // Show unit panel buttons in build phase
      this.showUnitPanelInBuild();
      
      // Hide FIRE button in build phase
      if (this.fireButton) {
        this.fireButton.setVisible(false);
        this.fireButtonText.setVisible(false);
      }
      
      // Reset aiming mode
      this.aimingMode = false;
      
      // Stop battle timer if running
      this.stopBattleTurnTimer();
    }
    
    // Update budget from server (which uses config)
    if (data.buildBudget !== undefined) {
      this.buildBudget = data.buildBudget;
      if (this.buildBudgetText) {
        this.buildBudgetText.setText(`بودجه ساخت: ${this.buildBudget}`);
        // Keep position fixed - don't change it
      }
      logger.info('Build budget updated from server', { buildBudget: this.buildBudget, serverBudget: data.buildBudget });
    }
    
    if (data.units) {
      this.playerUnits = data.units;
      this.renderUnits();
    }
    
    // Also update build budget display if it changed (only in build phase)
    if (this.buildBudgetText && this.budget !== undefined && this.currentPhase === GAME_PHASES.BUILD) {
      this.buildBudgetText.setText(`${faTexts.game.budget}: ${this.budget}`);
    }
    
    // Start 30-second timer for build phase
    // Player1: timer starts when they create room (handled in handleRoomUpdate)
    // Player2: timer starts when they join (BUILD_PHASE_STATE is sent when player2 joins)
    // Check if timer hasn't started yet and we're in build phase and not ready
    if (this.currentPhase === GAME_PHASES.BUILD && !this.buildPhaseTimer && !this.timerText && !this.isReady) {
      logger.info('Starting build phase timer from handleBuildPhaseState', {
        playerId: this.gameState?.playerId,
        currentPhase: this.currentPhase,
        isReady: this.isReady,
        buildBudget: this.buildBudget
      });
      this.startBuildPhaseTimer();
    } else {
      logger.info('Timer not started in handleBuildPhaseState', {
        playerId: this.gameState?.playerId,
        currentPhase: this.currentPhase,
        hasBuildPhaseTimer: !!this.buildPhaseTimer,
        hasTimerText: !!this.timerText,
        isReady: this.isReady,
        reason: this.currentPhase !== GAME_PHASES.BUILD ? 'not in BUILD phase' : 
                this.buildPhaseTimer || this.timerText ? 'timer already exists' : 
                this.isReady ? 'already ready' : 'unknown'
      });
    }
  }
  
  startBuildPhaseTimer() {
    // Clear any existing timer
    if (this.buildPhaseTimer) {
      clearInterval(this.buildPhaseTimer);
      this.buildPhaseTimer = null;
    }
    if (this.timerText) {
      this.timerText.destroy();
      this.timerText = null;
    }
    
    logger.info('startBuildPhaseTimer called', {
      playerId: this.gameState.playerId,
      currentPhase: this.currentPhase,
      isReady: this.isReady
    });
    
    // Start 30-second countdown - position timer below budget text to avoid overlap
    let timeLeft = 30;
    // Position timer in center between two grids (above "زمین شما" and "زمین حریف")
    const separatorWidth = 20;
    const gridWidth = this.gridSize * GRID_TILE_SIZE;
    const centerX = GRID_OFFSET_X + gridWidth + separatorWidth / 2;
    const centerY = GRID_OFFSET_Y - 50; // Above grid labels
    
    this.timerText = this.add.text(centerX, centerY, `زمان باقی‌مانده: ${timeLeft} ثانیه`, {
      fontSize: '16px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma',
      fontWeight: 'bold',
      padding: { x: 10, y: 5 }
    }).setOrigin(0.5, 0).setDepth(100); // Center horizontally
    
    logger.info('Timer text created', {
      x: centerX,
      y: centerY,
      timeLeft,
      timerTextVisible: this.timerText.visible
    });
    
    const countdown = setInterval(() => {
      timeLeft--;
      if (timeLeft > 0) {
        this.timerText.setText(`زمان باقی‌مانده: ${timeLeft} ثانیه`);
      } else {
        clearInterval(countdown);
        this.buildPhaseTimer = null;
        if (this.timerText) {
          this.timerText.destroy();
          this.timerText = null;
        }
        
        logger.info('Build phase timer expired', {
          playerId: this.gameState.playerId,
          isReady: this.isReady
        });
        
        // Hide build phase UI elements when timer expires
        this.hideBuildPhaseUI();
        
        // Check if player has any launchers
        const launchers = this.playerUnits?.launchers || [];
        const aliveLaunchers = launchers.filter(l => !l.destroyed);
        
        if (aliveLaunchers.length === 0) {
          // No launchers - place a random launcher automatically
          logger.info('Timer expired with no launchers - placing random launcher');
          this.placeRandomLauncher();
          // Wait a bit for the launcher to be placed and sent to server
          this.time.delayedCall(500, () => {
        if (!this.isReady) {
              logger.info('Auto-sending ready after random launcher placement');
          this.sendReady();
        }
          });
        } else {
          // Has launchers - auto-send ready if not already ready
          if (!this.isReady) {
            logger.info('Timer expired, player has launchers - auto-sending ready');
            this.sendReady();
          }
        }
        
        // Note: Server will check if both players are ready and start battle phase
        // We don't need to send READY_TO_START here - just READY is enough
      }
    }, 1000);
    
    this.buildPhaseTimer = countdown;
  }

  handleBattleState(data) {
    this.currentPhase = GAME_PHASES.BATTLE;
    this.onPhaseChange(this.currentPhase);
    this.currentTurn = data.currentTurn;
    this.mana = data.mana[this.gameState.playerId];
        // Mana bar removed - no need to update UI
    this.updateTurnIndicator();
    
    // Update units from server (they should persist from build phase)
    if (data.units) {
      this.playerUnits = data.units;
      this.renderUnits(); // Render units in battle phase
    }
    
    // Hide build budget in battle phase
    if (this.buildBudgetText) {
      this.buildBudgetText.setVisible(false);
    }
    
      // Show baroot display in battle phase (by default)
      // Also update position to ensure it's in the right place
      if (this.budgetText) {
        const panelX = 1000; // Right side
        const fireButtonY = 600; // FIRE button Y position
        const barootY = fireButtonY - 300; // Above FIRE button (300)
      
      // Update position to ensure it's correct
      this.budgetText.setPosition(panelX, barootY);
      this.budgetText.setVisible(true);
      // Update baroot display to show current value (0 if no launcher selected)
      this.updateBarootDisplay();
      
      logger.info('Baroot text position updated in handleBattleState', {
        x: panelX,
        y: barootY,
        visible: true
      });
    }
    
    // Hide unit panel buttons in battle phase
    this.hideUnitPanelInBattle();
    
    // Show FIRE button in battle phase (will be enabled when aiming mode is active)
    if (this.fireButton) {
      this.fireButton.setVisible(true);
      this.fireButtonText.setVisible(true);
      // Disable initially (will be enabled when path is ready)
      this.fireButton.setAlpha(0.5);
      this.fireButtonText.setAlpha(0.5);
    }
    
    // Start battle turn timer if it's player's turn
    if (this.currentTurn === this.gameState.playerId) {
      this.startBattleTurnTimer();
    }
  }
  
  startBattleTurnTimer() {
    // Only start timer if it's the player's turn
    if (this.currentTurn !== this.gameState.playerId) {
      logger.info('Not starting battle timer - not player turn', {
        currentTurn: this.currentTurn,
        playerId: this.gameState.playerId
      });
      this.stopBattleTurnTimer();
      return;
    }
    
    // Clear existing timer
    this.stopBattleTurnTimer();
    
    const turnTime = this.turnTimeSeconds;
    let timeLeft = turnTime;
    
    // Position battle timer below turnText, centered between grids, with same width as grid labels
    const separatorWidth = 20;
    const gridWidth = this.gridSize * GRID_TILE_SIZE;
    const centerX = GRID_OFFSET_X + gridWidth + separatorWidth / 2;
    const battleTimerY = GRID_OFFSET_Y - 20; // Timer position (below grid labels)
    const timerY = battleTimerY; // At battle timer position
    const gridLabelWidth = this.gridSize * GRID_TILE_SIZE; // Same width as grid labels (same as "زمین شما" and "زمین حریف")
    
    // Create or update timer text
    if (!this.battleTurnTimerText) {
      this.battleTurnTimerText = this.add.text(centerX, timerY, `زمان نوبت: ${timeLeft} ثانیه`, {
        fontSize: '18px',
        color: '#ffd700',
        fontFamily: 'Vazirmatn, Tahoma',
        fontWeight: 'bold',
        padding: { x: 10, y: 5 },
        backgroundColor: '#1c1f22',
        fixedWidth: gridLabelWidth, // Same width as grid labels
        align: 'center'
      }).setOrigin(0.5, 0).setDepth(100);
    } else {
      // Update position to ensure it's at battle timer position
      const separatorWidth = 20;
      const gridWidth = this.gridSize * GRID_TILE_SIZE;
      const centerX = GRID_OFFSET_X + gridWidth + separatorWidth / 2;
      const battleTimerY = GRID_OFFSET_Y - 20; // Timer position (below grid labels)
      const timerY = battleTimerY;
      const gridLabelWidth = this.gridSize * GRID_TILE_SIZE; // Same width as grid labels
      
      this.battleTurnTimerText.setPosition(centerX, timerY);
      this.battleTurnTimerText.setVisible(true);
      this.battleTurnTimerText.setText(`زمان نوبت: ${timeLeft} ثانیه`);
      this.battleTurnTimerText.setColor('#ffd700'); // Reset color
      this.battleTurnTimerText.setFixedSize(gridLabelWidth, 0); // Same width as grid labels
    }
    
    // Update timer every second
    this.battleTurnTimer = this.time.addEvent({
      delay: 1000,
      callback: () => {
        timeLeft--;
        if (this.battleTurnTimerText) {
          if (timeLeft > 5) {
            this.battleTurnTimerText.setText(`زمان نوبت: ${timeLeft} ثانیه`);
            this.battleTurnTimerText.setColor('#ffd700');
          } else if (timeLeft > 0) {
            this.battleTurnTimerText.setText(`زمان نوبت: ${timeLeft} ثانیه`);
            this.battleTurnTimerText.setColor('#ff0000'); // Red when time is running out
          } else {
            // Time's up - auto-fire if valid path exists
            this.handleTurnTimerExpired();
          }
        }
      },
      repeat: turnTime - 1
    });
  }
  
  stopBattleTurnTimer() {
    if (this.battleTurnTimer) {
      this.battleTurnTimer.destroy();
      this.battleTurnTimer = null;
    }
    if (this.battleTurnTimerText) {
      this.battleTurnTimerText.setVisible(false);
    }
  }
  
  handleTurnTimerExpired() {
    logger.info('Turn timer expired', {
      currentTurn: this.currentTurn,
      playerId: this.gameState.playerId,
      hasValidPath: !!(this.currentPathTiles && this.currentPathTiles.length >= 2 && this.selectedLauncherForShots),
      pathLength: this.currentPathTiles?.length || 0,
      selectedLauncher: this.selectedLauncherForShots?.id
    });
    this.stopBattleTurnTimer();
    
    // Check if there's a valid path ready to fire
    if (this.currentPathTiles && this.currentPathTiles.length >= 2 && this.selectedLauncherForShots) {
      // Auto-fire the current path
      logger.info('Auto-firing due to timer expiry', {
        pathLength: this.currentPathTiles.length,
        launcherId: this.selectedLauncherForShots.id
      });
      this.fireAllShots();
    } else {
      // No valid path - do nothing, no mana consumed
      logger.info('Timer expired but no valid path - sending END_TURN', {
        pathLength: this.currentPathTiles?.length || 0,
        selectedLauncher: this.selectedLauncherForShots?.id
      });
      // Clear any partial path
      this.currentPathTiles = [];
      this.selectedLauncherForShots = null;
      this.pathSelectionMode = false;
      this.aimingMode = false;
      this.isDrawingPath = false;
      if (this.pathHighlightGraphics) {
        this.pathHighlightGraphics.clear();
      }
      // Clear launcher highlight when timer expires without valid path
      this.clearLauncherHighlight();
      // Disable FIRE button (keep visible but disabled)
      if (this.fireButton) {
        this.fireButton.setAlpha(0.5);
        this.fireButtonText.setAlpha(0.5);
      }
      // Request turn switch from server (end turn without firing)
      this.gameState.ws.send(JSON.stringify({
        type: MESSAGE_TYPES.END_TURN
      }));
    }
  }

  handleDamage(data) {
    logger.info('handleDamage called', {
      intercepted: data.intercepted,
      launcherId: data.launcherId,
      attackerId: data.attackerId,
      pathLength: data.pathTiles?.length || 0,
      hasDamage: !!data.damage,
      isMyShot: data.attackerId === this.gameState.playerId
    });
    
    // Remove shot from pending shots if it's our shot
    if (data.attackerId === this.gameState.playerId) {
      const shotIndex = this.pendingShots.findIndex(s => s.launcherId === data.launcherId);
      if (shotIndex >= 0) {
        this.pendingShots.splice(shotIndex, 1);
        logger.info('Removed shot from pending shots', {
          launcherId: data.launcherId,
          remainingShots: this.pendingShots.length
        });
      }
    }
    
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
    
    // Note: Turn change is handled separately via TURN_CHANGE message from server
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
    
    // Get missile move time per tile from config (default: 100ms = 0.1s per tile)
    const moveTimePerTile = this.config.battle?.missileMoveTimePerTile || 100;
    
    for (let i = 1; i < points.length; i++) {
      timeline.add({
        targets: missile,
        x: points[i].x,
        y: points[i].y,
        duration: moveTimePerTile,
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

