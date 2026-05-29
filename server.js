const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

const PUBLIC_DIR = path.join(__dirname, 'public');

// ==================== STARTUP CHECKS ====================
console.log('[Startup] __dirname:', __dirname);
console.log('[Startup] PUBLIC_DIR:', PUBLIC_DIR);

if (!fs.existsSync(PUBLIC_DIR)) {
  console.error('[FATAL] public/ directory does NOT exist at:', PUBLIC_DIR);
  console.error('[FATAL] Server cannot start. Make sure public/ folder is deployed.');
  process.exit(1);
}

const indexPath = path.join(PUBLIC_DIR, 'index.html');
if (!fs.existsSync(indexPath)) {
  console.error('[FATAL] public/index.html does NOT exist at:', indexPath);
  console.error('[FATAL] Server cannot start.');
  process.exit(1);
}

console.log('[Startup] public/ directory OK');
console.log('[Startup] public/index.html OK');
console.log('[Startup] Server files found. Starting...');

// ==================== FILE SERVING ====================
function serveIndex(res) {
  fs.readFile(indexPath, (err, content) => {
    if (err) {
      console.error('[Error] Cannot read index.html:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error: cannot load index.html');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  });
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        console.log('[404] File not found:', filePath, '-> serving index.html');
        serveIndex(res);
        return;
      }
      if (err.code === 'EISDIR') {
        console.log('[EISDIR] Path is directory:', filePath, '-> serving index.html');
        serveIndex(res);
        return;
      }
      console.error('[Error] readFile:', err.code, filePath);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error: ' + err.code);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

// ==================== HTTP SERVER ====================
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      connections: io.engine.clientsCount, 
      uptime: Math.floor(process.uptime()) 
    }));
    return;
  }

  // Strip query string FIRST
  let urlPath = req.url.split('?')[0];

  // Decode URL (handles %20 spaces, etc.)
  urlPath = decodeURIComponent(urlPath);

  // Security: prevent directory traversal (../../etc/passwd)
  urlPath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '');

  // If root or empty, serve index.html
  if (urlPath === '/' || urlPath === '' || urlPath === '\\') {
    console.log('[Request] ROOT -> index.html');
    serveIndex(res);
    return;
  }

  // Build full file path
  const filePath = path.join(PUBLIC_DIR, urlPath);

  // Security check: make sure it's still inside PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    console.log('[Security] Blocked path outside public:', urlPath);
    serveIndex(res);
    return;
  }

  console.log('[Request]', req.url, '-> resolved:', filePath);

  // Check if path exists and what type it is
  fs.stat(filePath, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') {
        console.log('[404] Not found:', filePath, '-> SPA fallback to index.html');
        serveIndex(res);
        return;
      }
      console.error('[Error] stat:', err.code, filePath);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error: ' + err.code);
      return;
    }

    if (stats.isDirectory()) {
      // It's a directory - serve index.html from inside it
      const dirIndex = path.join(filePath, 'index.html');
      console.log('[Directory] Serving index.html from:', dirIndex);
      serveFile(res, dirIndex);
      return;
    }

    if (stats.isFile()) {
      // It's a file - serve it
      serveFile(res, filePath);
      return;
    }

    // Unknown type - fallback to index.html
    console.log('[Unknown] File type for:', filePath, '-> index.html');
    serveIndex(res);
  });
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
