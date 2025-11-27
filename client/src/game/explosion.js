import { GRID_TILE_SIZE, GRID_OFFSET_X, GRID_OFFSET_Y } from '@shared/constants.js';

export class Explosion {
  constructor(scene, gridX, gridY, explosionType = 'default', config = null) {
    this.scene = scene;
    this.gridX = gridX;
    this.gridY = gridY;
    this.explosionType = explosionType;
    this.config = config;
    this.sprite = null;
  }

  play() {
    const x = GRID_OFFSET_X + this.gridX * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
    const y = GRID_OFFSET_Y + this.gridY * GRID_TILE_SIZE + GRID_TILE_SIZE / 2;
    
    // Try to use explosion sprites from config if available
    if (this.config && this.config.animations && this.config.animations.explosionSprites) {
      const sprites = this.config.animations.explosionSprites;
      const spriteIndex = this.explosionType === 'short' ? 0 : 
                         this.explosionType === 'medium' ? 1 : 
                         this.explosionType === 'long' ? 2 : 0;
      const spritePath = sprites[spriteIndex] || sprites[0];
      
      // Try to load sprite (if not already loaded)
      try {
        this.scene.load.image(`explosion_sprite_${this.explosionType}`, spritePath);
        this.scene.load.once('filecomplete-image-explosion_sprite_' + this.explosionType, () => {
          this.sprite = this.scene.add.image(x, y, `explosion_sprite_${this.explosionType}`);
          this.sprite.setDepth(200);
          this.sprite.setScale(2);
          // Fade out
          this.scene.tweens.add({
            targets: this.sprite,
            alpha: 0,
            scale: 3,
            duration: 1000,
            onComplete: () => {
              this.sprite.destroy();
            }
          });
        });
        this.scene.load.start();
        return;
      } catch (e) {
        // Fall back to default animation
      }
    }
    
    // Default explosion animation (fallback)
    const frames = this.config?.animations?.explosionFrames || 12;
    
    this.sprite = this.scene.add.sprite(x, y, 'explosion_0');
    this.sprite.setDepth(200);
    this.sprite.setScale(2);
    
    // Animate through frames
    let frameIndex = 0;
    const animTimer = this.scene.time.addEvent({
      delay: 100,
      callback: () => {
        frameIndex++;
        if (frameIndex < frames) {
          this.sprite.setTexture(`explosion_${frameIndex}`);
        } else {
          this.sprite.destroy();
          animTimer.remove();
        }
      },
      repeat: frames - 1
    });
  }
}

