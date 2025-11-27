import React, { useState, useEffect } from 'react';
import faTexts from '../i18n/fa.json';
import logger from '@shared/logger.js';
import { MESSAGE_TYPES } from '@shared/types.js';

const API_URL = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000';

export default function MenuFA({ onStartGame }) {
  const [roomId, setRoomId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [version, setVersion] = useState('...');

  // Load version on mount
  useEffect(() => {
    fetch('http://localhost:3000/version')
      .then(res => res.json())
      .then(data => {
        setVersion(data.version || '0.0.0');
      })
      .catch(err => {
        logger.warn('Failed to load version:', err);
        setVersion('0.0.0');
      });
  }, []);

  const createRoom = async () => {
    setIsCreating(true);
    logger.info('Creating new room...');
    try {
      const ws = new WebSocket(WS_URL);
      
      ws.onopen = () => {
        logger.websocket('WebSocket connected');
        ws.send(JSON.stringify({
          type: MESSAGE_TYPES.CREATE_ROOM
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        logger.websocket('Received message:', data.type);
        if (data.type === MESSAGE_TYPES.ROOM_UPDATE) {
          logger.info(`Room created: ${data.roomId}, Player: ${data.playerId}`);
          onStartGame(data.roomId, data.playerId, ws);
        }
      };

      ws.onerror = (error) => {
        logger.error('WebSocket error:', error);
        setIsCreating(false);
      };
    } catch (error) {
      logger.error('Error creating room:', error);
      setIsCreating(false);
    }
  };

  const joinRoom = async () => {
    if (!roomId.trim()) {
      logger.warn('Room ID is empty');
      alert('لطفاً کد اتاق را وارد کنید');
      return;
    }

    setIsJoining(true);
    logger.info(`Joining room: ${roomId.trim()}`);
    try {
      const ws = new WebSocket(WS_URL);
      
      ws.onopen = () => {
        logger.websocket('WebSocket connected');
        ws.send(JSON.stringify({
          type: MESSAGE_TYPES.JOIN_ROOM,
          roomId: roomId.trim()
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        logger.websocket('Received message:', data.type);
        if (data.type === MESSAGE_TYPES.ROOM_UPDATE) {
          logger.info(`Joined room: ${data.roomId}, Player: player2`);
          onStartGame(data.roomId, 'player2', ws);
        } else if (data.type === MESSAGE_TYPES.ERROR) {
          logger.error('Join room error:', data.message);
          alert(data.message || 'روم پیدا نشد');
          setIsJoining(false);
        }
      };

      ws.onerror = (error) => {
        logger.error('WebSocket error:', error);
        setIsJoining(false);
      };
    } catch (error) {
      logger.error('Error joining room:', error);
      setIsJoining(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.menu}>
        <h1 style={styles.title}>{faTexts.menu.title}</h1>
        <div style={styles.version}>نسخه: v{version}</div>
        
        <button
          style={styles.button}
          onClick={createRoom}
          disabled={isCreating || isJoining}
        >
          {isCreating ? 'در حال ایجاد...' : faTexts.menu.createGame}
        </button>

        <div style={styles.joinSection}>
          <input
            type="text"
            placeholder="کد اتاق"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            style={styles.input}
            dir="ltr"
          />
          <button
            style={styles.button}
            onClick={joinRoom}
            disabled={isCreating || isJoining}
          >
            {isJoining ? 'در حال اتصال...' : faTexts.menu.joinGame}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: 'linear-gradient(135deg, #1c1f22 0%, #2b3a42 100%)',
  },
  menu: {
    background: 'rgba(43, 58, 66, 0.9)',
    padding: '3rem',
    borderRadius: '15px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
    textAlign: 'center',
    minWidth: '400px',
  },
  title: {
    fontSize: '2.5rem',
    marginBottom: '1rem',
    color: '#ffd700',
    textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
  },
  version: {
    fontSize: '1rem',
    marginBottom: '2rem',
    color: '#aaa',
    fontFamily: 'Vazirmatn, Tahoma',
    opacity: 0.8,
  },
  button: {
    width: '100%',
    padding: '1rem 2rem',
    fontSize: '1.2rem',
    fontWeight: 'bold',
    background: 'linear-gradient(135deg, #3f5765 0%, #2b3a42 100%)',
    color: '#fff',
    border: '2px solid #ffd700',
    borderRadius: '8px',
    cursor: 'pointer',
    marginBottom: '1rem',
    transition: 'all 0.3s',
    fontFamily: 'inherit',
  },
  joinSection: {
    marginTop: '2rem',
  },
  input: {
    width: '100%',
    padding: '0.8rem',
    fontSize: '1.1rem',
    marginBottom: '1rem',
    background: '#1c1f22',
    color: '#fff',
    border: '2px solid #3f5765',
    borderRadius: '8px',
    textAlign: 'center',
    fontFamily: 'inherit',
  },
};



