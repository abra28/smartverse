# SmartVerse Unified

**One server. Everything works.** Frontend + Socket.IO backend in a single deploy.

## Deploy to Render (Free)

1. Go to [render.com](https://render.com) → Sign up
2. Click **New → Web Service**
3. Upload this entire folder (or connect GitHub)
4. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free
5. Click **Create Web Service**
6. Done! Your URL is live (e.g. `https://smartverse.onrender.com`)

## How to use

### Controller (your laptop)
Open: `https://your-app.onrender.com`
- Speak or type a verse reference
- Auto-connects to same server via Socket.IO
- No backend URL needed — auto-detects

### vMix / OBS Browser Source
Add Browser Source with:
- **URL:** `https://your-app.onrender.com/?view=output`
- **Width:** 1920
- **Height:** 1080
- The output auto-connects and receives verses in real-time

### Test locally first
```bash
npm install
node server.js
# Open http://localhost:3000
# Output: http://localhost:3000/?view=output
```

## Why this works when nothing else did

| Method | Why it fails |
|--------|-------------|
| `localStorage` | Browser Sources are isolated — no shared storage |
| `BroadcastChannel` | Only works within same browser instance |
| Popup window | OBS Browser Source is a separate Chromium process |
| **Socket.IO backend** | Works across ANY browser, ANY device, ANY network |

## Files

```
smartverse/
├── server.js          # Express + Socket.IO server
├── package.json       # Dependencies (express + socket.io)
├── public/
│   └── index.html     # SmartVerse frontend (controller + output)
├── render.yaml        # Render deploy config
└── README.md          # This file
```
