export class AudioController {
  constructor(scene, soundConfig) {
    this.scene = scene;
    this.soundConfig = soundConfig;
    this.sounds = {};
    this.bgm = null;
    this.bgmVolume = 0.5;
    this.sfxVolume = 0.7;
    this.muted = false;
    
    this.loadSounds();
  }

  loadSounds() {
    // Try to load BGM
    if (this.soundConfig.bgm) {
      try {
        this.bgm = this.scene.sound.add('bgm', { loop: true, volume: this.bgmVolume });
      } catch (e) {
        console.warn('BGM not found, using placeholder');
      }
    }
    
    // Create placeholder sounds
    this.createPlaceholderSounds();
  }

  createPlaceholderSounds() {
    // Create simple beep sounds as placeholders
    // In production, these would be loaded from assets
    this.sounds.launch = { volume: this.sfxVolume };
    this.sounds.explosion = { volume: this.sfxVolume };
    this.sounds.defense_intercept = { volume: this.sfxVolume };
    this.sounds.turnChange = { volume: this.sfxVolume };
    this.sounds.error = { volume: this.sfxVolume };
    this.sounds.uiClick = { volume: this.sfxVolume };
  }

  playSound(soundName) {
    if (this.muted) return;
    
    try {
      if (this.sounds[soundName]) {
        // Try to play actual sound file if available
        try {
          const sound = this.scene.sound.get(soundName);
          if (sound) {
            sound.play({ volume: this.sounds[soundName].volume });
            return;
          }
        } catch (e) {
          // Sound file not found, continue with placeholder
        }
        
        // Fallback: just log (no error thrown)
        if (this.scene && this.scene.logger) {
          this.scene.logger.debug(`Sound file not found: ${soundName}, continuing without sound`);
        } else {
          console.log(`Sound file not found: ${soundName}, continuing without sound`);
        }
      }
    } catch (e) {
      // Log error but don't break the game
      if (this.scene && this.scene.logger) {
        this.scene.logger.warn(`Error playing sound ${soundName}:`, e.message);
      } else {
        console.warn(`Error playing sound ${soundName}:`, e.message);
      }
    }
  }

  playBGM() {
    if (this.bgm && !this.muted) {
      this.bgm.play();
    }
  }

  stopBGM() {
    if (this.bgm) {
      this.bgm.stop();
    }
  }

  setBGMVolume(volume) {
    this.bgmVolume = volume;
    if (this.bgm) {
      this.bgm.setVolume(volume);
    }
  }

  setSFXVolume(volume) {
    this.sfxVolume = volume;
    Object.keys(this.sounds).forEach(key => {
      this.sounds[key].volume = volume;
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopBGM();
    } else {
      this.playBGM();
    }
  }
}



