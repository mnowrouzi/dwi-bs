// Utility functions

export function getDistance(x1, y1, x2, y2) {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

export function getManhattanDistance(x1, y1, x2, y2) {
  return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}

export function isAdjacent(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}

export function isValidPath(path, maxRange) {
  if (path.length < 2) return false;
  
  // Check adjacency
  for (let i = 1; i < path.length; i++) {
    if (!isAdjacent(path[i-1].x, path[i-1].y, path[i].x, path[i].y)) {
      return false;
    }
  }
  
  // Check range (path length, not Manhattan distance)
  // Range = maximum number of tiles in the path
  return path.length <= maxRange;
}

export function getAOECells(centerX, centerY, aoeWidth, aoeHeight, gridSize) {
  const cells = [];
  const halfWidth = Math.floor(aoeWidth / 2);
  const halfHeight = Math.floor(aoeHeight / 2);
  
  for (let dy = -halfHeight; dy <= halfHeight; dy++) {
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      const x = centerX + dx;
      const y = centerY + dy;
      if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
        cells.push({ x, y });
      }
    }
  }
  
  return cells;
}

export function isInCoverage(defenseX, defenseY, targetX, targetY, coverage) {
  const distance = getManhattanDistance(defenseX, defenseY, targetX, targetY);
  return distance <= coverage;
}

export function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

