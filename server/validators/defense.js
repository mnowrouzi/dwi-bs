import { isInCoverage } from '../../shared/utils.js';

export function checkDefenseInterception(pathTiles, defenses, gridSize) {
  // Check each tile in path against each defense
  for (const tile of pathTiles) {
    for (const defense of defenses) {
      if (defense.destroyed) continue;

      const inCoverage = isInCoverage(
        defense.x,
        defense.y,
        tile.x,
        tile.y,
        defense.config.coverage
      );

      if (inCoverage) {
        // Roll for interception
        const roll = Math.random();
        if (roll <= defense.config.interceptChance) {
          return {
            intercepted: true,
            defenseId: defense.id,
            interceptedAt: { x: tile.x, y: tile.y }
          };
        }
      }
    }
  }

  return { intercepted: false };
}



