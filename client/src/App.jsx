import React, { useState, useEffect } from 'react';
import MenuFA from './components/MenuFA.jsx';
import GameScene from './components/GameScene.jsx';
import { GAME_PHASES } from '../../shared/types.js';

function App() {
  const [gameState, setGameState] = useState({
    phase: null,
    roomId: null,
    playerId: null,
    ws: null
  });

  const handleStartGame = (roomId, playerId, ws) => {
    setGameState({
      phase: GAME_PHASES.BUILD,
      roomId,
      playerId,
      ws
    });
  };

  const handleBackToMenu = () => {
    if (gameState.ws) {
      gameState.ws.close();
    }
    setGameState({
      phase: null,
      roomId: null,
      playerId: null,
      ws: null
    });
  };

  if (!gameState.phase) {
    return <MenuFA onStartGame={handleStartGame} />;
  }

  return (
    <GameScene
      gameState={gameState}
      onBackToMenu={handleBackToMenu}
    />
  );
}

export default App;



