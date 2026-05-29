const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ==================== STARTUP CHECKS ====================
console.log('[Startup] __dirname:', __dirname);
console.log('[Startup] CWD:', process.cwd());

const publicDir = path.join(__dirname, 'public');
console.log('[Startup] public dir:', publicDir);

const fs = require('fs');
if (!fs.existsSync(publicDir)) {
  console.error('[FATAL] public/ directory does NOT exist!');
  console.error('[FATAL] Expected at:', publicDir);
  console.error('[FATAL] Files in __dirname:', fs.readdirSync(__dirname));
  process.exit(1);
}

if (!fs.existsSync(path.join(publicDir, 'index.html'))) {
  console.error('[FATAL] public/index.html does NOT exist!');
  console.error('[FATAL] Files in public/:', fs.readdirSync(publicDir));
  process.exit(1);
}

console.log('[Startup] public/ directory OK');
console.log('[Startup] public/index.html OK');

// ==================== EXPRESS MIDDLEWARE ====================
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connections: io.engine.clientsCount, 
    uptime: Math.floor(process.uptime()) 
  });
});

// Serve static files from public/ folder
app.use(express.static(publicDir, { fallthrough: true }));

// SPA fallback: for ANY unmatched route, serve index.html
app.get('*', (req, res) => {
  console.log('[SPA Fallback]', req.url, '-> index.html');
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[Express Error]', err.message);
  res.status(500).send('Server error: ' + err.message);
});

// ==================== SOCKET.IO ====================
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

let currentState = { verse: null, mode: 'center', theme: 'dark' };

io.on('connection', (socket) => {
  console.log(`[Socket] Connect: ${socket.id}`);

  socket.on('join', (data) => {
    const role = data?.role || 'unknown';
    socket.role = role;
    console.log(`[Socket] Join: ${socket.id} as ${role}`);
    if (role === 'output') {
      socket.join('outputs');
      socket.emit('current_state', currentState);
    } else {
      socket.join('controllers');
    }
  });

  socket.on('display_verse', (data) => {
    currentState.verse = data;
    console.log(`[Socket] Verse: ${data.ref}`);
    io.to('outputs').emit('verse_update', data);
    io.to('controllers').emit('verse_update', data);
  });

  socket.on('clear_verse', () => {
    currentState.verse = null;
    console.log('[Socket] Clear');
    io.to('outputs').emit('clear_verse');
    io.to('controllers').emit('clear_verse');
  });

  socket.on('set_mode', (data) => {
    if (data.mode) currentState.mode = data.mode;
    if (data.theme) currentState.theme = data.theme;
    console.log(`[Socket] Mode: ${data.mode} / ${data.theme}`);
    io.to('outputs').emit('mode_update', data);
  });

  socket.on('get_current_state', () => {
    socket.emit('current_state', currentState);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnect: ${socket.id} (${socket.role || 'unknown'})`);
  });
});

server.listen(PORT, () => {
  console.log('=====================================');
  console.log('SmartVerse Server RUNNING');
  console.log('Port:', PORT);
  console.log('Controller: http://localhost:' + PORT);
  console.log('Output:     http://localhost:' + PORT + '/?view=output');
  console.log('=====================================');
});
