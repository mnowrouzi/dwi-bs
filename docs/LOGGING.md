# سیستم لاگ (Logging System)

سیستم لاگ مرکزی برای ارتباط و دیباگ در بازی.

## فعال/غیرفعال کردن لاگ

### در حالت Development (پیش‌فرض فعال)
لاگ به صورت پیش‌فرض در حالت development فعال است.

### در حالت Production (پیش‌فرض غیرفعال)
برای جلوگیری از افت کیفیت در production، لاگ به صورت پیش‌فرض غیرفعال است.

#### فعال کردن لاگ در Production (Server)
```bash
ENABLE_LOGS=true npm start
```

یا در `.env`:
```
ENABLE_LOGS=true
NODE_ENV=production
```

#### فعال کردن لاگ در Production (Client)
در `client/.env`:
```
VITE_ENABLE_LOGS=true
```

## استفاده از Logger

### Server-side
```javascript
import logger from '../shared/logger.js';

// لاگ‌های عمومی
logger.debug('پیام دیباگ');
logger.info('پیام اطلاعاتی');
logger.warn('هشدار');
logger.error('خطا');

// لاگ‌های مخصوص بازی
logger.game('وضعیت بازی');
logger.websocket('پیام WebSocket');
logger.player('player1', 'عملیات بازیکن');
logger.room('ROOM123', 'وضعیت اتاق');
```

### Client-side
```javascript
import logger from '../../shared/logger.js';

logger.info('پیام از کلاینت');
logger.game('وضعیت بازی');
logger.websocket('اتصال WebSocket');
```

## سطح لاگ (Log Levels)

```javascript
// تنظیم سطح لاگ
logger.setLevel('DEBUG');  // همه لاگ‌ها
logger.setLevel('INFO');   // INFO, WARN, ERROR
logger.setLevel('WARN');   // WARN, ERROR
logger.setLevel('ERROR');  // فقط ERROR
```

## مثال‌های استفاده

### لاگ اتصال WebSocket
```javascript
logger.websocket('New connection established');
logger.websocket('Message received', { type: 'joinRoom' });
```

### لاگ عملیات بازیکن
```javascript
logger.player('player1', 'Placed unit', { type: 'launcher', x: 5, y: 3 });
logger.player('player1', 'Shot fired', { launcherId: 'launcher_1' });
```

### لاگ وضعیت اتاق
```javascript
logger.room('ROOM123', 'Build phase started');
logger.room('ROOM123', 'Turn switched to player2');
logger.room('ROOM123', 'Game over! Winner: player1');
```

## خاموش کردن کامل لاگ

```javascript
logger.setEnabled(false);
```

## نکات

- لاگ‌ها در console نمایش داده می‌شوند
- در production، لاگ به صورت پیش‌فرض غیرفعال است برای جلوگیری از افت عملکرد
- می‌توانید لاگ را برای دیباگ موقت فعال کنید
- لاگ‌ها شامل timestamp و level هستند


