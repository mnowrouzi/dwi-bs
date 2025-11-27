import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { GameRenderer } from '../game/renderer.js';
import { MESSAGE_TYPES, GAME_PHASES } from '@shared/types.js';
import faTexts from '../i18n/fa.json';
import logger from '@shared/logger.js';

export default function GameScene({ gameState, onBackToMenu }) {
  const gameRef = useRef(null);
  const phaserGameRef = useRef(null);
  const [config, setConfig] = useState(null);
  const [currentPhase, setCurrentPhase] = useState(GAME_PHASES.BUILD);
  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    logger.info('Loading game config...');
    setIsLoading(true);
    setError(null);
    
    // Load config from server
    fetch('http://localhost:3000/config.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        logger.info('Config loaded successfully');
        setConfig(data);
        setIsLoading(false);
      })
      .catch(err => {
        logger.error('Failed to load config from server:', err);
        // Fallback to local config
        fetch('/config.json')
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then(data => {
            logger.info('Config loaded from local fallback');
            setConfig(data);
            setIsLoading(false);
          })
          .catch(e => {
            logger.error('Failed to load local config:', e);
            setError('خطا در بارگذاری تنظیمات بازی');
            setIsLoading(false);
          });
      });
  }, []);

  useEffect(() => {
    if (!config || !gameState.ws || !gameRef.current) {
      logger.debug('Waiting for config, ws, or gameRef...', { config: !!config, ws: !!gameState.ws, gameRef: !!gameRef.current });
      return;
    }

    logger.info('Initializing Phaser game...');
    
    // Clean up previous game instance if exists
    if (phaserGameRef.current) {
      phaserGameRef.current.destroy(true);
      phaserGameRef.current = null;
    }

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

    try {
      phaserGameRef.current = new Phaser.Game(phaserConfig);
      
      // Wait for scene to be ready
      setTimeout(() => {
        if (phaserGameRef.current && phaserGameRef.current.scene.scenes[0]) {
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
            if (phaserGameRef.current && phaserGameRef.current.scene.scenes[0]) {
              phaserGameRef.current.scene.scenes[0].handleServerMessage(data);
            }
          };

          logger.info('Phaser game initialized successfully');
        }
      }, 100);
    } catch (error) {
      logger.error('Error initializing Phaser:', error);
      setError('خطا در راه‌اندازی بازی');
    }

    return () => {
      if (phaserGameRef.current) {
        logger.info('Destroying Phaser game instance');
        phaserGameRef.current.destroy(true);
        phaserGameRef.current = null;
      }
    };
  }, [config, gameState]);

  // Show loading state
  if (isLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingContainer}>
          <div style={styles.loadingText}>در حال بارگذاری بازی...</div>
          <div style={styles.loadingSpinner}>⏳</div>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.errorContainer}>
          <div style={styles.errorText}>{error}</div>
          <button style={styles.backButton} onClick={onBackToMenu}>
            {faTexts.buttons.back}
          </button>
        </div>
      </div>
    );
  }

  // Show game when config is loaded
  if (!config || !gameState.ws) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingContainer}>
          <div style={styles.loadingText}>در حال اتصال...</div>
        </div>
      </div>
    );
  }

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
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    gap: '2rem',
  },
  loadingText: {
    fontSize: '1.5rem',
    color: '#ffd700',
    fontFamily: 'Vazirmatn, Tahoma',
  },
  loadingSpinner: {
    fontSize: '3rem',
    animation: 'spin 1s linear infinite',
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    gap: '2rem',
  },
  errorText: {
    fontSize: '1.2rem',
    color: '#ff4444',
    fontFamily: 'Vazirmatn, Tahoma',
    textAlign: 'center',
    padding: '2rem',
    background: 'rgba(255, 68, 68, 0.1)',
    borderRadius: '10px',
  },
};

