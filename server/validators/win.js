export function checkWinCondition(players) {
  for (const [playerId, player] of players.entries()) {
    const aliveLaunchers = player.units.launchers.filter(l => !l.destroyed);
    if (aliveLaunchers.length === 0) {
      return playerId === 'player1' ? 'player2' : 'player1';
    }
  }
  return null;
}



