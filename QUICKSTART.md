# Quick Start Guide

## Installation & Running

### Quick Start (Recommended)

```bash
# Install all dependencies
cd server && npm install && cd ../client && npm install && cd ..

# Start both server and client
npm start
# or
./scripts/restart.sh
```

Server: `http://localhost:3000`  
Client: `http://localhost:5173`

### Manual Setup

#### 1. Install Server Dependencies
```bash
cd server
npm install
```

#### 2. Install Client Dependencies
```bash
cd ../client
npm install
```

#### 3. Start the Server
```bash
cd server
npm start
```
Server will run on `http://localhost:3000`

#### 4. Start the Client (in a new terminal)
```bash
cd client
npm run dev
```
Client will run on `http://localhost:5173`

### Restart After Changes

```bash
# Stop everything
npm run stop
# or
./scripts/stop.sh

# Start again
npm start
# or
./scripts/restart.sh
```

## Playing the Game

1. Open `http://localhost:5173` in **two different browser windows** (or use incognito mode for the second window)

2. **Window 1 (Player 1)**:
   - Click "ایجاد بازی" (Create Game)
   - Note the room code that appears (or check console)

3. **Window 2 (Player 2)**:
   - Enter the room code from Player 1
   - Click "ورود به بازی" (Join Game)

4. **Build Phase**:
   - Both players place launchers and defenses on their grids
   - Click on unit type buttons, then click on grid to place
   - Budget is shown at top
   - Click "آماده" (Ready) when done

5. **Battle Phase**:
   - Select a launcher type button
   - Click on your grid to start drawing a path
   - Drag to draw the missile path (must be adjacent tiles)
   - Path must be within launcher range
   - Release to fire
   - Missile follows path and explodes
   - Defenses may intercept

6. **Win Condition**: Destroy all enemy launchers

## Configuration

Edit `server/config.json` to customize:
- Grid size
- Budget
- Mana system
- Launcher types (add unlimited types)
- Defense types (add unlimited types)
- Animation speeds
- Sound files
- Colors

## Troubleshooting

- **WebSocket connection failed**: Make sure server is running on port 3000
- **Config not loading**: Check that server is serving config.json at `/config.json`
- **Units not placing**: Check browser console for errors
- **Path not drawing**: Make sure you're in battle phase and have selected a launcher

## Notes

- All UI text is in Persian (Farsi)
- Layout is RTL (Right-To-Left)
- Graphics are placeholder (programmatically generated)
- Sound files are referenced but placeholders are used
- The game is fully config-driven - modify `config.json` to change gameplay



