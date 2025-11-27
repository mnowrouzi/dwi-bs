import { getAOECells } from '../../shared/utils.js';

export function calculateAOEDamage(centerX, centerY, aoe, opponentUnits, gridSize) {
  const [aoeWidth, aoeHeight] = aoe;
  const targetCells = getAOECells(centerX, centerY, aoeWidth, aoeHeight, gridSize);
  
  const damage = {
    launchers: [],
    defenses: []
  };

  // Check each cell in AoE
  for (const cell of targetCells) {
    // Check launchers
    for (const launcher of opponentUnits.launchers) {
      if (launcher.destroyed) continue;
      
      // Check if launcher occupies this cell (considering size)
      const [sizeX, sizeY] = launcher.config.size;
      for (let dy = 0; dy < sizeY; dy++) {
        for (let dx = 0; dx < sizeX; dx++) {
          if (launcher.x + dx === cell.x && launcher.y + dy === cell.y) {
            launcher.destroyed = true;
            damage.launchers.push({
              id: launcher.id,
              x: launcher.x,
              y: launcher.y
            });
            break;
          }
        }
      }
    }

    // Check defenses (with size support)
    for (const defense of opponentUnits.defenses) {
      if (defense.destroyed) continue;
      
      // Check if defense occupies this cell (considering size)
      const [sizeX, sizeY] = defense.config.size || [1, 1];
      for (let dy = 0; dy < sizeY; dy++) {
        for (let dx = 0; dx < sizeX; dx++) {
          if (defense.x + dx === cell.x && defense.y + dy === cell.y) {
            defense.destroyed = true;
            damage.defenses.push({
              id: defense.id,
              x: defense.x,
              y: defense.y
            });
            break;
          }
        }
      }
    }
  }

  return { damage, targetCells };
}



