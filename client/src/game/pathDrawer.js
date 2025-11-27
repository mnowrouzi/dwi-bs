import { GRID_TILE_SIZE, GRID_OFFSET_X, GRID_OFFSET_Y } from '../../../shared/constants.js';
import { isAdjacent } from '../../../shared/utils.js';

export class PathDrawer {
  constructor(scene) {
    this.scene = scene;
    this.pathGraphics = null;
    this.currentPath = [];
  }

  startPath(initialTile) {
    this.currentPath = [initialTile];
    if (!this.pathGraphics) {
      this.pathGraphics = this.scene.add.graphics();
      this.pathGraphics.setDepth(50);
    }
    this.drawPath();
  }

  handleMove(pointer) {
    const gridX = Math.floor((pointer.x - GRID_OFFSET_X) / GRID_TILE_SIZE);
    const gridY = Math.floor((pointer.y - GRID_OFFSET_Y) / GRID_TILE_SIZE);
    
    if (gridX < 0 || gridX >= this.scene.gridSize || 
        gridY < 0 || gridY >= this.scene.gridSize) {
      return;
    }
    
    const lastTile = this.currentPath[this.currentPath.length - 1];
    const newTile = { x: gridX, y: gridY };
    
    // Check if adjacent to last tile
    if (isAdjacent(lastTile.x, lastTile.y, newTile.x, newTile.y)) {
      // Check if not already in path (avoid loops)
      const exists = this.currentPath.some(t => t.x === newTile.x && t.y === newTile.y);
      if (!exists) {
        this.currentPath.push(newTile);
        this.drawPath();
      }
    }
  }

  drawPath() {
    if (!this.pathGraphics) return;
    
    this.pathGraphics.clear();
    this.pathGraphics.lineStyle(3, 0xffd700, 0.8);
    
    const opponentOffsetX = GRID_OFFSET_X + (this.scene.gridSize * GRID_TILE_SIZE) + 50;
    
    for (let i = 0; i < this.currentPath.length - 1; i++) {
      const start = this.currentPath[i];
      const end = this.currentPath[i + 1];
      
      const startOffsetX = start.isPlayerGrid !== false ? GRID_OFFSET_X : opponentOffsetX;
      const endOffsetX = end.isPlayerGrid !== false ? GRID_OFFSET_X : opponentOffsetX;
      
      const startX = startOffsetX + start.x * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
      const startY = GRID_OFFSET_Y + start.y * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
      const endX = endOffsetX + end.x * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
      const endY = GRID_OFFSET_Y + end.y * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
      
      this.pathGraphics.moveTo(startX, startY);
      this.pathGraphics.lineTo(endX, endY);
    }
    
    // Draw glow effect
    this.pathGraphics.lineStyle(5, 0xffaa00, 0.3);
    for (let i = 0; i < this.currentPath.length - 1; i++) {
      const start = this.currentPath[i];
      const end = this.currentPath[i + 1];
      
      const startOffsetX = start.isPlayerGrid !== false ? GRID_OFFSET_X : opponentOffsetX;
      const endOffsetX = end.isPlayerGrid !== false ? GRID_OFFSET_X : opponentOffsetX;
      
      const startX = startOffsetX + start.x * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
      const startY = GRID_OFFSET_Y + start.y * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
      const endX = endOffsetX + end.x * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
      const endY = GRID_OFFSET_Y + end.y * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
      
      this.pathGraphics.moveTo(startX, startY);
      this.pathGraphics.lineTo(endX, endY);
    }
    
    // Update scene path tiles (remove isPlayerGrid for server)
    this.scene.pathTiles = this.currentPath.map(t => ({ x: t.x, y: t.y }));
  }

  clear() {
    if (this.pathGraphics) {
      this.pathGraphics.clear();
    }
    this.currentPath = [];
  }
}

