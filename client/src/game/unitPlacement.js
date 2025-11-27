import { GRID_TILE_SIZE, GRID_OFFSET_X, GRID_OFFSET_Y } from '@shared/constants.js';
import { MESSAGE_TYPES } from '@shared/types.js';

export class UnitPlacement {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;
    this.selectedLauncherType = null;
    this.selectedDefenseType = null;
    this.placedUnits = [];
  }

  selectLauncherType(type) {
    this.selectedLauncherType = type;
    this.selectedDefenseType = null;
  }

  selectDefenseType(type) {
    this.selectedDefenseType = type;
    this.selectedLauncherType = null;
  }

  handleClick(pointer) {
    const gridX = Math.floor((pointer.x - GRID_OFFSET_X) / GRID_TILE_SIZE);
    const gridY = Math.floor((pointer.y - GRID_OFFSET_Y) / GRID_TILE_SIZE);
    
    if (gridX < 0 || gridX >= this.scene.gridSize || 
        gridY < 0 || gridY >= this.scene.gridSize) {
      return;
    }
    
    if (this.selectedLauncherType) {
      this.placeLauncher(gridX, gridY);
    } else if (this.selectedDefenseType) {
      this.placeDefense(gridX, gridY);
    }
  }

  placeLauncher(x, y) {
    const launcherConfig = this.config.launchers.find(l => l.id === this.selectedLauncherType);
    if (!launcherConfig) return;
    
    if (this.scene.budget < launcherConfig.cost) {
      this.scene.onNotification('بودجه کافی نیست');
      return;
    }
    
    // Check if position is valid (not overlapping)
    const [sizeX, sizeY] = launcherConfig.size;
    const canPlace = this.canPlaceUnit(x, y, sizeX, sizeY);
    
    if (!canPlace) {
      this.scene.onNotification('نمی‌توان در این موقعیت قرار داد');
      return;
    }
    
    // Add to placed units
    this.placedUnits.push({
      type: 'launcher',
      launcherType: this.selectedLauncherType,
      x,
      y
    });
    
    // Send to server
    this.scene.gameState.ws.send(JSON.stringify({
      type: MESSAGE_TYPES.PLACE_UNITS,
      units: this.placedUnits
    }));
  }

  placeDefense(x, y) {
    const defenseConfig = this.config.defenses.find(d => d.id === this.selectedDefenseType);
    if (!defenseConfig) return;
    
    if (this.scene.budget < defenseConfig.cost) {
      this.scene.onNotification('بودجه کافی نیست');
      return;
    }
    
    // Get size from config
    const [sizeX, sizeY] = defenseConfig.size || [1, 1];
    
    // Check if position is valid
    const canPlace = this.canPlaceUnit(x, y, sizeX, sizeY);
    
    if (!canPlace) {
      this.scene.onNotification('نمی‌توان در این موقعیت قرار داد');
      return;
    }
    
    // Add to placed units
    this.placedUnits.push({
      type: 'defense',
      defenseType: this.selectedDefenseType,
      x,
      y
    });
    
    // Send to server
    this.scene.gameState.ws.send(JSON.stringify({
      type: MESSAGE_TYPES.PLACE_UNITS,
      units: this.placedUnits
    }));
  }

  canPlaceUnit(x, y, sizeX, sizeY) {
    // Check bounds
    if (x + sizeX > this.scene.gridSize || y + sizeY > this.scene.gridSize) {
      return false;
    }
    
    // Check overlap with existing units
    for (const unit of this.placedUnits) {
      let unitSizeX = 1, unitSizeY = 1;
      if (unit.type === 'launcher') {
        const config = this.config.launchers.find(l => l.id === unit.launcherType);
        if (config) {
          unitSizeX = config.size[0];
          unitSizeY = config.size[1];
        }
      } else if (unit.type === 'defense') {
        const config = this.config.defenses.find(d => d.id === unit.defenseType);
        if (config) {
          unitSizeX = config.size[0] || 1;
          unitSizeY = config.size[1] || 1;
        }
      }
      
      // Check overlap
      if (!(x + sizeX <= unit.x || x >= unit.x + unitSizeX ||
            y + sizeY <= unit.y || y >= unit.y + unitSizeY)) {
        return false;
      }
    }
    
    return true;
  }
}



