import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { GameRenderer } from '../game/renderer.js';
import { MESSAGE_TYPES, GAME_PHASES } from '../../../shared/types.js';
import faTexts from '../i18n/fa.json';
import logger from '../../../shared/logger.js';

export default function GameScene({ gameState, onBackToMenu }) {
  const gameRef = useRef(null);
  const phaserGameRef = useRef(null);
  const [config, setConfig] = useState(null);
  const [currentPhase, setCurrentPhase] = useState(GAME_PHASES.BUILD);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    logger.info('Loading game config...');
    // Load config from server
    fetch('http://localhost:3000/config.json')
      .then(res => res.json())
      .then(data => {
        logger.info('Config loaded successfully');
        setConfig(data);
      })
      .catch(err => {
        logger.error('Failed to load config from server:', err);
        // Fallback to local config
        fetch('/config.json')
          .then(res => res.json())
          .then(data => {
            logger.info('Config loaded from local fallback');
            setConfig(data);
          })
          .catch(e => logger.error('Failed to load local config:', e));
      });
  }, []);

  useEffect(() => {
    if (!config || !gameState.ws) return;

    const phaserConfig = {
      type: Phaser.AUTO,
      width: 1200,
      height: 800,
      parent: gameRef.current,
      backgroundColor: '#1c1f22',
      scene: GameRenderer,
      physics: {
        default: 'arcade',
        arcade: { debug: false }
      }
    };

    phaserGameRef.current = new Phaser.Game(phaserConfig);
    
    // Pass game state to scene
    phaserGameRef.current.scene.scenes[0].init({
      config,
      gameState,
      onNotification: (msg) => {
        setNotifications(prev => [...prev, { id: Date.now(), message: msg }]);
        setTimeout(() => {
          setNotifications(prev => prev.slice(1));
        }, 3000);
      },
      onPhaseChange: setCurrentPhase
    });

    // Handle WebSocket messages
    gameState.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      logger.websocket(`Received: ${data.type}`, data);
      phaserGameRef.current.scene.scenes[0].handleServerMessage(data);
    };

    return () => {
      if (phaserGameRef.current) {
        phaserGameRef.current.destroy(true);
      }
    };
  }, [config, gameState]);

  return (
    <div style={styles.container}>
      <div style={styles.hud}>
        <button style={styles.backButton} onClick={onBackToMenu}>
          {faTexts.buttons.back}
        </button>
        <div style={styles.phaseIndicator}>
          {currentPhase === GAME_PHASES.BUILD && faTexts.game.buildPhase}
          {currentPhase === GAME_PHASES.BATTLE && faTexts.game.battlePhase}
        </div>
      </div>
      
      <div ref={gameRef} style={styles.gameContainer} />
      
      <div style={styles.notifications}>
        {notifications.map(notif => (
          <div key={notif.id} style={styles.notification}>
            {notif.message}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: '100vw',
    height: '100vh',
    position: 'relative',
    background: '#1c1f22',
  },
  hud: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    zIndex: 1000,
    display: 'flex',
    gap: '1rem',
    alignItems: 'center',
  },
  backButton: {
    padding: '0.5rem 1rem',
    background: '#3f5765',
    color: '#fff',
    border: '1px solid #ffd700',
    borderRadius: '5px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  phaseIndicator: {
    padding: '0.5rem 1rem',
    background: 'rgba(43, 58, 66, 0.9)',
    color: '#ffd700',
    borderRadius: '5px',
    fontWeight: 'bold',
  },
  gameContainer: {
    width: '100%',
    height: '100%',
  },
  notifications: {
    position: 'absolute',
    top: '60px',
    right: '10px',
    zIndex: 1001,
  },
  notification: {
    padding: '0.8rem 1.2rem',
    background: 'rgba(43, 58, 66, 0.95)',
    color: '#fff',
    borderRadius: '5px',
    marginBottom: '0.5rem',
    boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
    animation: 'slideIn 0.3s ease-out',
  },
};

