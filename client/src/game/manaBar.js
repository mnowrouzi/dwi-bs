export class ManaBar {
  constructor(scene, x, y, config) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.config = config;
    this.currentMana = config.mana.startMana;
    this.maxMana = config.mana.maxMana;
    
    this.createBar();
  }

  createBar() {
    // Background
    this.bg = this.scene.add.rectangle(this.x, this.y, 200, 20, 0x1c1f22);
    this.bg.setStrokeStyle(2, 0x3f5765);
    
    // Fill
    this.fill = this.scene.add.rectangle(
      this.x - 100 + (this.currentMana / this.maxMana) * 100,
      this.y,
      (this.currentMana / this.maxMana) * 200,
      18,
      0x4488ff
    );
    this.fill.setOrigin(0, 0.5);
    
    // Text
    this.text = this.scene.add.text(this.x, this.y - 25, 'مانا', {
      fontSize: '16px',
      color: '#fff',
      fontFamily: 'Vazirmatn, Tahoma'
    });
    
    this.valueText = this.scene.add.text(this.x + 110, this.y, `${this.currentMana}/${this.maxMana}`, {
      fontSize: '14px',
      color: '#ffd700',
      fontFamily: 'Vazirmatn, Tahoma'
    });
  }

  updateMana(newMana) {
    this.currentMana = newMana;
    
    // Animate fill
    this.scene.tweens.add({
      targets: this.fill,
      width: (this.currentMana / this.maxMana) * 200,
      x: this.x - 100 + (this.currentMana / this.maxMana) * 100,
      duration: 500,
      ease: 'Power2'
    });
    
    // Update text
    this.valueText.setText(`${this.currentMana}/${this.maxMana}`);
    
    // Color based on mana level
    if (this.currentMana < this.maxMana * 0.3) {
      this.fill.setFillStyle(0xff4444);
    } else if (this.currentMana < this.maxMana * 0.6) {
      this.fill.setFillStyle(0xffaa00);
    } else {
      this.fill.setFillStyle(0x4488ff);
    }
  }
}



