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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      connections: io.engine.clientsCount, 
      uptime: Math.floor(process.uptime()) 
    }));
    return;
  }

  // FIX: Strip query string FIRST, then check if it's root
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/' || urlPath === '') {
    urlPath = '/index.html';
  }

  const filePath = path.join(__dirname, 'public', urlPath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // File not found - serve index.html for SPA routing
        const indexPath = path.join(__dirname, 'public', 'index.html');
        fs.readFile(indexPath, (err2, indexContent) => {
          if (err2) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Server error: cannot load index.html');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(indexContent);
        });
        return;
      }
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error: ' + err.code);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

let currentState = { verse: null, mode: 'center', theme: 'dark' };

io.on('connection', (socket) => {
  console.log(`[Connect] ${socket.id}`);

  socket.on('join', (data) => {
    const role = data?.role || 'unknown';
    socket.role = role;
    console.log(`[Join] ${socket.id} as ${role}`);
    if (role === 'output') {
      socket.join('outputs');
      socket.emit('current_state', currentState);
    } else {
      socket.join('controllers');
    }
  });

  socket.on('display_verse', (data) => {
    currentState.verse = data;
    console.log(`[Verse] ${data.ref}`);
    io.to('outputs').emit('verse_update', data);
    io.to('controllers').emit('verse_update', data);
  });

  socket.on('clear_verse', () => {
    currentState.verse = null;
    console.log('[Clear]');
    io.to('outputs').emit('clear_verse');
    io.to('controllers').emit('clear_verse');
  });

  socket.on('set_mode', (data) => {
    if (data.mode) currentState.mode = data.mode;
    if (data.theme) currentState.theme = data.theme;
    console.log(`[Mode] ${data.mode} / ${data.theme}`);
    io.to('outputs').emit('mode_update', data);
  });

  socket.on('get_current_state', () => {
    socket.emit('current_state', currentState);
  });

  socket.on('disconnect', () => {
    console.log(`[Disconnect] ${socket.id} (${socket.role || 'unknown'})`);
  });
});

server.listen(PORT, () => {
  console.log(`SmartVerse Unified Server running on port ${PORT}`);
  console.log(`Controller: http://localhost:${PORT}`);
  console.log(`Output:     http://localhost:${PORT}/?view=output`);
});
