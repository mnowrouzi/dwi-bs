import { isValidPath, isAdjacent } from '../../shared/utils.js';

export function validatePath(pathTiles, maxRange, gridSize) {
  if (!pathTiles || pathTiles.length < 2) {
    return { success: false, error: 'Path must have at least 2 tiles' };
  }

  // Log path for debugging
  console.log('validatePath called', {
    pathLength: pathTiles.length,
    maxRange,
    gridSize,
    pathTiles: pathTiles.map(t => ({ x: t.x, y: t.y }))
  });

  // Check if path is valid (adjacent tiles)
  const pathValid = isValidPath(pathTiles, maxRange);
  if (!pathValid) {
    console.log('Path validation failed - checking adjacency and range', {
      pathLength: pathTiles.length,
      maxRange,
      pathTiles: pathTiles.map((t, i) => ({
        index: i,
        x: t.x,
        y: t.y,
        prevTile: i > 0 ? { x: pathTiles[i-1].x, y: pathTiles[i-1].y } : null,
        isAdjacent: i > 0 ? isAdjacent(
          pathTiles[i-1].x, pathTiles[i-1].y, t.x, t.y
        ) : null
      }))
    });
    return { success: false, error: 'Invalid path: tiles must be adjacent and within range' };
  }

  // Check grid bounds - path can span both player and opponent grids
  // Path tiles are relative coordinates (0 to gridSize-1 for each grid)
  // When path crosses from player grid to opponent grid, tiles are still 0 to gridSize-1
  // So we just need to check that x and y are within 0 to gridSize-1
  for (const tile of pathTiles) {
    if (tile.x < 0 || tile.x >= gridSize || tile.y < 0 || tile.y >= gridSize) {
      console.log('Path out of bounds', { tile, gridSize });
      return { success: false, error: 'Path out of bounds' };
    }
  }

  console.log('Path validation passed');
  return { success: true };
}



