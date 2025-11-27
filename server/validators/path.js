import { isValidPath } from '../../shared/utils.js';

export function validatePath(pathTiles, maxRange, gridSize) {
  if (!pathTiles || pathTiles.length < 2) {
    return { success: false, error: 'Path must have at least 2 tiles' };
  }

  // Check if path is valid (adjacent tiles)
  if (!isValidPath(pathTiles, maxRange)) {
    return { success: false, error: 'Invalid path: tiles must be adjacent and within range' };
  }

  // Check grid bounds
  for (const tile of pathTiles) {
    if (tile.x < 0 || tile.x >= gridSize || tile.y < 0 || tile.y >= gridSize) {
      return { success: false, error: 'Path out of bounds' };
    }
  }

  return { success: true };
}



