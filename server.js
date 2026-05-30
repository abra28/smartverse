/**
 * SmartVerse 1.0 — Robust Backend
 * Express + Socket.io + In-Memory Session Store
 * Deploys to Render, Railway, Heroku, or any Node host
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// CORS — allow your frontend domain(s)
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:5500",
      "http://localhost:8080",
      "https://smartverse-y2ro.onrender.com",      // <-- YOUR DEPLOYED DOMAIN
      "https://your-church-site.com"           // <-- ADD YOUR CUSTOM DOMAIN
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===================== IN-MEMORY DATA STORE =====================
// In production, swap this for Redis or PostgreSQL
const sessions = new Map();        // sessionId -> Session
const verseCache = new Map();      // "ref:version" -> verse text
const apiKeys = new Set(['smartverse-demo-key-2026']); // Simple API key auth

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      id: sessionId,
      createdAt: Date.now(),
      currentVerse: null,
      queue: [],
      history: [],
      settings: {
        theme: 'dark',
        mode: 'center',
        fontSize: 28,
        cardOpacity: 88,
        bgOpacity: 100,
        smartThemes: false,
        qrEnabled: false
      },
      connectedClients: {
        controller: null,   // socket.id of controller
        displays: [],       // socket.ids of output windows
        viewers: 0          // count of congregation viewers
      }
    });
  }
  return sessions.get(sessionId);
}

function pruneOldSessions() {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  for (const [id, session] of sessions) {
    const hasController = session.connectedClients.controller;
    const hasDisplays = session.connectedClients.displays.length > 0;
    const age = now - session.createdAt;
    if (!hasController && !hasDisplays && age > ONE_HOUR) {
      sessions.delete(id);
      console.log('[Prune] Removed inactive session:', id);
    }
  }
}
setInterval(pruneOldSessions, 10 * 60 * 1000); // every 10 minutes

// ===================== MIDDLEWARE =====================
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.apiKey;
  if (!apiKeys.has(key)) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

// ===================== REST API =====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    activeSessions: sessions.size,
    timestamp: new Date().toISOString()
  });
});

// Get session state (for reconnection)
app.get('/api/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({
    id: session.id,
    currentVerse: session.currentVerse,
    queue: session.queue,
    history: session.history.slice(-20),
    settings: session.settings,
    viewerCount: session.connectedClients.viewers
  });
});

// Update session settings (REST fallback)
app.post('/api/session/:sessionId/settings', requireApiKey, (req, res) => {
  const session = getOrCreateSession(req.params.sessionId);
  const allowed = ['theme','mode','fontSize','cardOpacity','bgOpacity','smartThemes','qrEnabled'];
  allowed.forEach(k => {
    if (req.body[k] !== undefined) session.settings[k] = req.body[k];
  });
  io.to(req.params.sessionId).emit('settings_updated', session.settings);
  res.json({ success: true, settings: session.settings });
});

// Push verse via REST (for external integrations — e.g., ProPresenter, Planning Center)
app.post('/api/session/:sessionId/verse', requireApiKey, (req, res) => {
  const session = getOrCreateSession(req.params.sessionId);
  const { ref, text, version, book, chapter, verse } = req.body;
  if (!ref || !text) return res.status(400).json({ error: 'ref and text required' });

  const verseData = {
    ref, text, version: version || 'KJV',
    book, chapter, verse,
    timestamp: Date.now(),
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
  };

  session.currentVerse = verseData;
  session.history.unshift({
    ref, text, version: version || 'KJV',
    time: new Date().toLocaleTimeString()
  });
  if (session.history.length > 50) session.history.pop();

  // Broadcast to everyone in the room
  io.to(req.params.sessionId).emit('verse_changed', verseData);
  io.to(req.params.sessionId).emit('history_updated', session.history.slice(0, 20));

  res.json({ success: true, verse: verseData });
});

// Clear display
app.post('/api/session/:sessionId/clear', requireApiKey, (req, res) => {
  const session = getOrCreateSession(req.params.sessionId);
  session.currentVerse = null;
  io.to(req.params.sessionId).emit('display_cleared');
  res.json({ success: true });
});

// Update queue
app.post('/api/session/:sessionId/queue', requireApiKey, (req, res) => {
  const session = getOrCreateSession(req.params.sessionId);
  session.queue = req.body.queue || [];
  io.to(req.params.sessionId).emit('queue_updated', session.queue);
  res.json({ success: true, queue: session.queue });
});

// Get congregation view data (for QR code scanning)
app.get('/api/session/:sessionId/live', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({
    currentVerse: session.currentVerse,
    settings: {
      theme: session.settings.theme,
      mode: session.settings.mode
    },
    updatedAt: Date.now()
  });
});

// Bible verse lookup (lightweight — can be expanded to use a real Bible API)
app.get('/api/bible/:ref', (req, res) => {
  const { ref } = req.params;
  const version = req.query.version || 'kjv';
  const cacheKey = ref + ':' + version;

  if (verseCache.has(cacheKey)) {
    return res.json({ ref, version, text: verseCache.get(cacheKey), cached: true });
  }

  // In production, integrate with Bible API (ESV, API.Bible, etc.)
  // For now, return a placeholder that tells frontend to use inline data
  res.json({
    ref, version,
    text: null,
    message: 'Use frontend inline Bible data or integrate Bible API (ESV/API.Bible)',
    cached: false
  });
});

// ===================== SOCKET.IO REAL-TIME =====================

io.on('connection', (socket) => {
  console.log('[Socket] Connected:', socket.id);

  // Join a session room
  socket.on('join_session', ({ sessionId, role }) => {
    socket.sessionId = sessionId;
    socket.role = role || 'viewer';
    socket.join(sessionId);

    const session = getOrCreateSession(sessionId);

    if (role === 'controller') {
      session.connectedClients.controller = socket.id;
      console.log(`[Session ${sessionId}] Controller joined`);
    } else if (role === 'display') {
      session.connectedClients.displays.push(socket.id);
      console.log(`[Session ${sessionId}] Display joined`);
    } else {
      session.connectedClients.viewers++;
      console.log(`[Session ${sessionId}] Viewer joined (total: ${session.connectedClients.viewers})`);
    }

    // Send current state to the new client
    socket.emit('session_state', {
      currentVerse: session.currentVerse,
      queue: session.queue,
      history: session.history.slice(0, 20),
      settings: session.settings
    });

    // Notify others that someone joined
    socket.to(sessionId).emit('client_joined', { role, socketId: socket.id });
  });

  // Controller: change verse
  socket.on('change_verse', (data) => {
    const session = sessions.get(socket.sessionId);
    if (!session || socket.role !== 'controller') return;

    const verseData = {
      ...data,
      timestamp: Date.now(),
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
    };

    session.currentVerse = verseData;
    session.history.unshift({
      ref: data.ref,
      text: data.text,
      version: data.version || 'KJV',
      time: new Date().toLocaleTimeString()
    });
    if (session.history.length > 50) session.history.pop();

    // Broadcast to entire room (displays + viewers)
    io.to(socket.sessionId).emit('verse_changed', verseData);
    io.to(socket.sessionId).emit('history_updated', session.history.slice(0, 20));
  });

  // Controller: clear display
  socket.on('clear_display', () => {
    const session = sessions.get(socket.sessionId);
    if (!session || socket.role !== 'controller') return;
    session.currentVerse = null;
    io.to(socket.sessionId).emit('display_cleared');
  });

  // Controller: change theme/mode/settings
  socket.on('update_settings', (settings) => {
    const session = sessions.get(socket.sessionId);
    if (!session || socket.role !== 'controller') return;
    Object.assign(session.settings, settings);
    io.to(socket.sessionId).emit('settings_updated', session.settings);
  });

  // Controller: update queue
  socket.on('update_queue', (queue) => {
    const session = sessions.get(socket.sessionId);
    if (!session || socket.role !== 'controller') return;
    session.queue = queue || [];
    io.to(socket.sessionId).emit('queue_updated', session.queue);
  });

  // Controller: send queue item to display
  socket.on('send_queue_item', (index) => {
    const session = sessions.get(socket.sessionId);
    if (!session || socket.role !== 'controller') return;
    const item = session.queue[index];
    if (!item) return;

    const verseData = {
      ref: item.ref,
      text: item.text,
      version: item.version || 'KJV',
      timestamp: Date.now(),
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
    };

    session.currentVerse = verseData;
    session.history.unshift({
      ref: item.ref, text: item.text,
      version: item.version || 'KJV',
      time: new Date().toLocaleTimeString()
    });
    if (session.history.length > 50) session.history.pop();

    io.to(socket.sessionId).emit('verse_changed', verseData);
    io.to(socket.sessionId).emit('history_updated', session.history.slice(0, 20));
  });

  // Any client: heartbeat/ping
  socket.on('ping_server', (cb) => {
    if (typeof cb === 'function') cb({ time: Date.now() });
  });

  // Disconnect cleanup
  socket.on('disconnect', () => {
    console.log('[Socket] Disconnected:', socket.id);
    const session = sessions.get(socket.sessionId);
    if (!session) return;

    if (socket.role === 'controller' && session.connectedClients.controller === socket.id) {
      session.connectedClients.controller = null;
      io.to(socket.sessionId).emit('controller_disconnected');
    } else if (socket.role === 'display') {
      session.connectedClients.displays = session.connectedClients.displays.filter(id => id !== socket.id);
    } else {
      session.connectedClients.viewers = Math.max(0, session.connectedClients.viewers - 1);
    }
  });
});

// ===================== CONGREGATION VIEW PAGE =====================
// Simple HTML page for people scanning the QR code
app.get('/view/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="theme-color" content="#050508">
<title>SmartVerse Live</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#050508;color:#e8e8f0;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px 16px}
  .header{text-align:center;margin-bottom:24px}
  .header h1{font-size:22px;font-weight:700;background:linear-gradient(90deg,#a78bfa,#60a5fa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .header p{font-size:12px;color:#6b6b8a;margin-top:4px}
  .verse-card{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px 20px;width:100%;max-width:420px;backdrop-filter:blur(12px);margin-bottom:16px;transition:all 0.4s ease}
  .verse-card .ref{font-size:12px;color:#a78bfa;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}
  .verse-card .text{font-size:18px;line-height:1.7;color:#f0f0f5;font-weight:400}
  .verse-card .version{font-size:10px;color:#6b6b8a;margin-top:12px;text-align:right}
  .waiting{text-align:center;color:#6b6b8a;padding:40px 20px}
  .waiting .icon{font-size:48px;margin-bottom:16px;opacity:0.5}
  .connection-status{position:fixed;top:12px;right:12px;font-size:10px;padding:4px 10px;border-radius:20px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#6b6b8a}
  .connection-status.connected{background:rgba(34,197,94,0.15);color:#22c55e;border-color:rgba(34,197,94,0.3)}
  .connection-status.disconnected{background:rgba(239,68,68,0.15);color:#ef4444;border-color:rgba(239,68,68,0.3)}
  .pulse{animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
</style>
<script src="/socket.io/socket.io.js"></script>
</head>
<body>
  <div class="connection-status disconnected" id="status">Connecting...</div>
  <div class="header">
    <h1>SmartVerse Live</h1>
    <p>Follow along with today's service</p>
  </div>
  <div class="verse-card" id="verseCard" style="display:none">
    <div class="ref" id="vRef"></div>
    <div class="text" id="vText"></div>
    <div class="version" id="vVersion"></div>
  </div>
  <div class="waiting" id="waiting">
    <div class="icon">📖</div>
    <p class="pulse">Waiting for scripture...</p>
    <p style="font-size:11px;margin-top:8px;opacity:0.6">The pastor will share a verse shortly</p>
  </div>
<script>
  const sessionId = '${sessionId}';
  const socket = io();
  const statusEl = document.getElementById('status');
  const card = document.getElementById('verseCard');
  const waiting = document.getElementById('waiting');
  const vRef = document.getElementById('vRef');
  const vText = document.getElementById('vText');
  const vVersion = document.getElementById('vVersion');

  function showVerse(data){
    vRef.textContent = data.ref;
    vText.textContent = data.text;
    vVersion.textContent = data.version || 'KJV';
    waiting.style.display = 'none';
    card.style.display = 'block';
  }
  function clearVerse(){
    waiting.style.display = 'flex';
    card.style.display = 'none';
  }

  socket.on('connect', () => {
    statusEl.textContent = 'Connected';
    statusEl.className = 'connection-status connected';
    socket.emit('join_session', { sessionId, role: 'viewer' });
  });
  socket.on('disconnect', () => {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'connection-status disconnected';
  });
  socket.on('verse_changed', showVerse);
  socket.on('display_cleared', clearVerse);
  socket.on('session_state', (state) => {
    if(state.currentVerse) showVerse(state.currentVerse);
  });

  // Also poll REST as backup (every 3 seconds)
  setInterval(async () => {
    try{
      const res = await fetch('/api/session/' + sessionId + '/live');
      if(!res.ok) return;
      const data = await res.json();
      if(data.currentVerse) showVerse(data.currentVerse);
    }catch(e){}
  }, 3000);
</script>
</body>
</html>
  `);
});

// ===================== START SERVER =====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 SmartVerse 1.0 Backend running on port ${PORT}`);
  console.log(`📡 Socket.io real-time: ws://localhost:${PORT}`);
  console.log(`📖 Congregation view: http://localhost:${PORT}/view/YOUR_SESSION_ID`);
  console.log(`🔑 Demo API Key: smartverse-demo-key-2026`);
  console.log(`\n📋 Quick Test:`);
  console.log(`   curl http://localhost:${PORT}/api/health`);
  console.log(`   curl -X POST http://localhost:${PORT}/api/session/test123/verse \\n     -H "x-api-key: smartverse-demo-key-2026" \\n     -H "Content-Type: application/json" \\n     -d '{"ref":"John 3:16","text":"For God so loved the world...","version":"KJV"}'`);
});
