# بازی استراتژیک نوبتی - Multiplayer Turn-Based Strategy Game

A complete, fully playable, config-driven, web-based, multiplayer, turn-based strategy game with Persian (Farsi) UI and RTL layout support.

## Features

- **Persian (Farsi) Language**: All UI text, menus, buttons, and notifications are in Persian
- **RTL Layout**: Full right-to-left text alignment and layout support
- **Config-Driven**: All gameplay elements (launchers, defenses, mana, etc.) are loaded from `config.json`
- **Multiplayer**: Online 1v1 gameplay using WebSockets
- **Turn-Based**: Strategic turn-based combat with mana system
- **Path-Based Missiles**: Players draw missile paths tile-by-tile
- **Semi-Realistic Graphics**: Modern military-tech visual style with animations
- **Sound System**: Background music and sound effects (configurable)
- **Comprehensive Logging**: Centralized logging system with production toggle
- **Version Management**: Semantic versioning starting from 0.0.0

## Project Structure

```
DWI-BS/
├── server/              # Node.js WebSocket server
│   ├── index.js        # Express server setup
│   ├── websocket.js    # WebSocket connection handling
│   ├── rooms.js        # Room management
│   ├── gameManager.js  # Game state and logic
│   ├── validators/     # Game validation logic
│   └── config.json     # Server-side config
├── client/             # React + Phaser client
│   ├── src/
│   │   ├── components/ # React components
│   │   ├── game/       # Phaser game logic
│   │   └── i18n/       # Persian translations
│   └── public/         # Static assets
└── shared/             # Shared code
    ├── types.js        # Type definitions
    ├── constants.js    # Constants
    └── utils.js        # Utility functions
```

## Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Server Setup

```bash
cd server
npm install
npm start
```

The server will run on `http://localhost:3000`

### Client Setup

```bash
cd client
npm install
npm run dev
```

The client will run on `http://localhost:5173`

## How to Play

1. **Start the server** (port 3000)
2. **Start the client** (port 5173)
3. **Open two browser windows** to play 1v1
4. **Player 1**: Click "ایجاد بازی" (Create Game) - you'll get a room code
5. **Player 2**: Enter the room code and click "ورود به بازی" (Join Game)
6. **Build Phase**: Place launchers and defenses on your grid using budget
7. **Click "آماده" (Ready)** when done placing units
8. **Battle Phase**: 
   - Select a launcher type
   - Click on your grid to start drawing a path
   - Drag to draw the missile path (must be adjacent tiles)
   - Path must be within launcher range
   - Missile will follow the path and explode at the end
   - Defenses may intercept missiles

## Configuration

All gameplay elements are configured in `server/config.json`:

- **gridSize**: Grid dimensions (default: 10x10)
- **budget**: Starting budget for unit placement
- **mana**: Mana system configuration
- **launchers**: Array of launcher types (unlimited)
- **defenses**: Array of defense types (unlimited)
- **animations**: Animation timing settings
- **sounds**: Sound file paths
- **visualTheme**: Color palette and theme

### Adding New Unit Types

Simply add entries to the `launchers` or `defenses` arrays in `config.json`. No code changes needed!

Example:
```json
{
  "id": "customLauncher",
  "titleFA": "موشک سفارشی",
  "cost": 15,
  "manaCost": 5,
  "range": 12,
  "aoe": [4, 4],
  "size": [1, 2],
  "color": "#00ff00",
  ...
}
```

## Game Rules

- **Grid**: Each player has a private 10×10 grid
- **Build Phase**: Place units using budget
- **Battle Phase**: Turn-based combat
- **Mana System**: 
  - Start with `startMana`
  - Gain `manaPerTurn` each turn
  - Max `maxMana`
  - Max `maxShotsPerTurn` shots per turn
- **Path Shooting**: 
  - Select launcher
  - Draw path on your grid (drag)
  - Path must be adjacent tiles
  - Must be within launcher range
- **Defense**: Defenses intercept missiles in their coverage zone
- **Win Condition**: Destroy all enemy launchers

## Technical Details

### Server
- Node.js with Express
- WebSocket (ws library)
- Authoritative game logic
- Room-based matchmaking

### Client
- React 18
- Phaser 3 (game engine)
- Vite (build tool)
- Persian fonts (Vazirmatn)

### Communication Protocol

**Client → Server:**
- `createRoom`: Create new game room
- `joinRoom`: Join existing room
- `placeUnits`: Place units during build phase
- `ready`: Player is ready
- `requestShot`: Request to fire missile

**Server → Client:**
- `roomUpdate`: Room status update
- `buildPhaseState`: Build phase state
- `battleState`: Battle phase state
- `manaUpdate`: Mana update
- `turnChange`: Turn changed
- `applyDamage`: Damage applied
- `shotRejected`: Shot was rejected
- `gameOver`: Game ended

## Development

### Adding Features

The codebase is modular and extensible:

- **New unit types**: Add to config.json
- **New game phases**: Extend `GAME_PHASES` in `shared/types.js`
- **New animations**: Add to `client/src/game/animations.js`
- **New UI components**: Add to `client/src/components/`

### Debugging

- Server logs to console
- Client uses browser console
- WebSocket messages are logged

## Version Management

The project uses semantic versioning starting from `0.0.0`. Version is stored in:
- `VERSION` file (root)
- `server/package.json`
- `client/package.json`

### Bumping Version

```bash
node scripts/bump-version.js [major|minor|patch]
```

Example:
```bash
node scripts/bump-version.js patch  # 0.0.0 -> 0.0.1
node scripts/bump-version.js minor  # 0.0.1 -> 0.1.0
node scripts/bump-version.js major  # 0.1.0 -> 1.0.0
```

## Logging System

The game includes a comprehensive logging system that can be toggled on/off for production.

- **Development**: Logging enabled by default
- **Production**: Logging disabled by default (can be enabled via `ENABLE_LOGS=true`)

See [docs/LOGGING.md](docs/LOGGING.md) for detailed documentation.

## License

This project is provided as-is for educational and development purposes.

## Notes

- Placeholder graphics are generated programmatically
- Sound files should be placed in `client/public/assets/audio/`
- Sprite files should be placed in `client/public/assets/sprites/`
- The game supports unlimited launcher and defense types via config
- Logging is disabled in production by default to prevent performance degradation



