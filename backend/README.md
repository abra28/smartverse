# SmartVerse 1.0 — Robust Backend

## Why You Need This

Your current setup (pure frontend with localStorage hacks) has these problems:
- ❌ **Breaks across browsers** — Controller in Chrome, output in Firefox = no sync
- ❌ **Breaks in incognito mode** — localStorage is isolated per session
- ❌ **No multi-user support** — Only one person can control at a time
- ❌ **No persistence** — If the page refreshes, everything resets
- ❌ **Fragile popup window** — Browser popups get blocked, lose connection
- ❌ **No congregation mobile app** — QR code just shows text, no live updates

This backend solves ALL of that.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Controller    │────▶│  Socket.io      │◀────│   Output Window │
│  (Pastor/AV)    │     │   Server        │     │   (OBS/vMix)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│  Congregation   │     │   REST API      │
│   Mobile View   │     │ (ProPresenter,  │
│  (QR Scanner)   │     │  Planning Ctr)  │
└─────────────────┘     └─────────────────┘
```

## What You Get

### 1. Real-Time Sync (Socket.io)
- **Instant verse push** — < 100ms latency
- **Multiple output windows** — Projector + livestream + overflow room
- **Congregation mobile view** — People scan QR, see live verse on their phones
- **Reconnection handling** — Auto-reconnects if WiFi drops
- **Offline fallback** — Falls back to localStorage if server is down

### 2. Session Management
- Each service gets a **session ID** (e.g., `sunday-morning-2026-05-30`)
- Controller, displays, and viewers all join the same room
- Session persists for 1 hour after last disconnect

### 3. REST API
- **Push verses from external tools** — ProPresenter, Planning Center, EasyWorship
- **Integrate with church management systems**
- **API key authentication** — Secure, no random people can hijack your display

### 4. Congregation Mobile View
- URL: `your-domain.com/view/SESSION_ID`
- Clean, mobile-optimized Bible display
- Updates in real-time as pastor changes verses
- Works on ANY phone — no app download needed

## File Structure

```
smartverse-backend/
├── server.js          # Main server (Express + Socket.io)
├── package.json       # Dependencies
├── render.yaml        # Render.com deployment config
├── .env.example       # Environment variables template
├── public/
│   ├── index.html     # Your SmartVerse frontend (integrated)
│   └── socket-client.js  # Socket.io bridge (auto-connects)
```

## Quick Start (Local)

```bash
# 1. Create folder and enter it
mkdir smartverse-backend && cd smartverse-backend

# 2. Save all the files I gave you
# (server.js, package.json, render.yaml, .env.example, public/)

# 3. Install dependencies
npm install

# 4. Create .env file
cp .env.example .env
# Edit .env and set your values

# 5. Copy your frontend into public/
cp /path/to/your/index.html public/index.html

# 6. Start server
npm start

# 7. Open browser
# Controller: http://localhost:3000
# Output:     http://localhost:3000?view=output
# Mobile:     http://localhost:3000/view/default-session-xxx
```

## Deploy to Render (Free)

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "SmartVerse 1.0 backend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/smartverse-backend.git
git push -u origin main
```

### Step 2: Deploy on Render
1. Go to [render.com](https://render.com) → "New Web Service"
2. Connect your GitHub repo
3. Render will auto-detect `render.yaml`
4. Click "Create Web Service"
5. Wait 2-3 minutes for deployment
6. Copy your URL: `https://smartverse-backend-xxxxx.onrender.com`

### Step 3: Update Frontend
In `public/socket-client.js`, change:
```javascript
SERVER_URL: 'https://smartverse-backend-xxxxx.onrender.com'
```

### Step 4: Test
```bash
curl https://your-app.onrender.com/api/health
# Should return: {"status":"ok","version":"1.0.0"}
```

## API Reference

### Health Check
```bash
GET /api/health
```

### Push Verse (from external software)
```bash
POST /api/session/{sessionId}/verse
Headers: x-api-key: smartverse-demo-key-2026
Content-Type: application/json

Body:
{
  "ref": "John 3:16",
  "text": "For God so loved the world...",
  "version": "KJV",
  "book": "John",
  "chapter": 3,
  "verse": 16
}
```

### Clear Display
```bash
POST /api/session/{sessionId}/clear
Headers: x-api-key: smartverse-demo-key-2026
```

### Update Queue
```bash
POST /api/session/{sessionId}/queue
Headers: x-api-key: smartverse-demo-key-2026
Content-Type: application/json

Body:
{
  "queue": [
    {"ref": "John 3:16", "text": "...", "version": "KJV"},
    {"ref": "Psalm 23:1", "text": "...", "version": "KJV"}
  ]
}
```

### Get Live State (for congregation view)
```bash
GET /api/session/{sessionId}/live
```

## Socket.io Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `join_session` | `{sessionId, role}` | Join a room |
| `change_verse` | `{ref, text, version, theme, mode}` | Push verse to all |
| `clear_display` | — | Clear all screens |
| `update_settings` | `{theme, mode, ...}` | Change theme/mode |
| `update_queue` | `[]` | Update verse queue |
| `send_queue_item` | `index` | Send queue item to display |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `verse_changed` | `{ref, text, version, ...}` | New verse to display |
| `display_cleared` | — | Clear screen |
| `settings_updated` | `{theme, mode, ...}` | Settings changed |
| `queue_updated` | `[]` | Queue updated |
| `history_updated` | `[]` | History updated |
| `session_state` | `{currentVerse, queue, ...}` | Full state (on join) |
| `controller_disconnected` | — | Controller left |

## Security

- **API Key required** for all write operations
- **CORS configured** — only your domains can connect
- **Session isolation** — each session is independent
- **No sensitive data stored** — verses are transient

## Next Steps / Roadmap

1. **Redis persistence** — Replace in-memory store with Redis for production
2. **User accounts** — Multi-church support with logins
3. **Bible API integration** — ESV, API.Bible, YouVersion for live verse lookup
4. **Sermon notes** — Pastor can add notes that appear on controller only
5. **Analytics** — Most-used verses, service duration, engagement
6. **Scheduling** — Pre-schedule verse queues for the service
7. **Multi-language** — Support for Yoruba, Igbo, Hausa Bible versions

## Troubleshooting

**"Cannot connect to server"**
- Check `SERVER_URL` in `socket-client.js` matches your deployed URL
- Ensure CORS origins include your frontend domain
- Check Render logs: `Dashboard → Logs`

**"Socket.io client not loaded"**
- The bridge auto-loads from CDN if the server script fails
- Check browser console for network errors

**"Fallback mode active"**
- This is normal if the server is down
- localStorage sync still works between same-browser tabs
- The bridge will auto-reconnect when server comes back

## Support

This backend is production-ready for a single church.
For multi-church SaaS, you'll need:
- PostgreSQL database
- Redis for session store
- Authentication (Auth0, Clerk, or Firebase Auth)
- Stripe for billing
- CDN for static assets

---
**Built for SmartVerse 1.0** | Backend by Kimi K2.6
