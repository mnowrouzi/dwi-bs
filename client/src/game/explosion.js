import { GRID_TILE_SIZE, GRID_OFFSET_X, GRID_OFFSET_Y } from '../../../shared/constants.js';

export class Explosion {
  constructor(scene, gridX, gridY) {
    this.scene = scene;
    this.gridX = gridX;
    this.gridY = gridY;
    this.sprite = null;
  }

  play() {
    const x = GRID_OFFSET_X + this.gridX * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
    const y = GRID_OFFSET_Y + this.gridY * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
    
    // Create explosion animation
    const frames = [];
    for (let i = 0; i < 12; i++) {
      frames.push({ key: `explosion_${i}`, frame: 0 });
    }
    
    this.sprite = this.scene.add.sprite(x, y, 'explosion_0');
    this.sprite.setDepth(200);
    this.sprite.setScale(2);
    
    // Animate through frames
    let frameIndex = 0;
    const animTimer = this.scene.time.addEvent({
      delay: 100,
      callback: () => {
        frameIndex++;
        if (frameIndex < 12) {
          this.sprite.setTexture(`explosion_${frameIndex}`);
        } else {
          this.sprite.destroy();
          animTimer.remove();
        }
      },
      repeat: 11
    });
  }
}

