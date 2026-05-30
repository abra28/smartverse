/**
 * SmartVerse 1.0 — Socket.io Client Bridge
 * Drop this into your index.html BEFORE the closing </body> tag
 * It intercepts localStorage broadcasts and sends them via Socket.io
 * Falls back to localStorage if the server is unreachable
 */

(function(){
  'use strict';

  const CONFIG = {
    // CHANGE THIS to your deployed backend URL
    // Examples:
    //   'https://smartverse-backend.onrender.com'
    //   'http://localhost:3000'
    //   'https://api.yourchurch.com'
    SERVER_URL: window.location.hostname === 'localhost' 
      ? 'http://localhost:3000' 
      : 'https://smartverse-y2ro.onrender.com',

    SESSION_ID: new URLSearchParams(window.location.search).get('session') 
      || localStorage.getItem('smartverse_session_id') 
      || 'default-session-' + Math.random().toString(36).substr(2, 8),

    RECONNECT_DELAY: 3000,
    MAX_RECONNECT_ATTEMPTS: 10
  };

  // Persist session ID
  localStorage.setItem('smartverse_session_id', CONFIG.SESSION_ID);

  let socket = null;
  let isConnected = false;
  let reconnectAttempts = 0;
  let fallbackMode = false;

  // ===================== SOCKET CONNECTION =====================
  function initSocket(){
    if(typeof io === 'undefined'){
      console.warn('[SmartVerse Bridge] Socket.io client not loaded. Using fallback mode.');
      enableFallback();
      return;
    }

    socket = io(CONFIG.SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: CONFIG.MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay: CONFIG.RECONNECT_DELAY,
      timeout: 10000
    });

    socket.on('connect', () => {
      isConnected = true;
      reconnectAttempts = 0;
      fallbackMode = false;
      console.log('[SmartVerse Bridge] Connected to server:', CONFIG.SERVER_URL);

      // Determine role from URL
      const isOutput = window.location.search.includes('view=output');
      const role = isOutput ? 'display' : 'controller';

      socket.emit('join_session', {
        sessionId: CONFIG.SESSION_ID,
        role: role
      });

      // Show connection indicator
      showConnectionStatus('connected');
    });

    socket.on('disconnect', () => {
      isConnected = false;
      console.warn('[SmartVerse Bridge] Disconnected from server');
      showConnectionStatus('disconnected');

      // If we were connected before, try to reconnect
      if(reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS){
        reconnectAttempts++;
        setTimeout(() => {
          if(!isConnected){
            console.log('[SmartVerse Bridge] Reconnect attempt', reconnectAttempts);
            socket.connect();
          }
        }, CONFIG.RECONNECT_DELAY);
      } else {
        enableFallback();
      }
    });

    socket.on('connect_error', (err) => {
      console.warn('[SmartVerse Bridge] Connection error:', err.message);
      if(reconnectAttempts >= 3 && !fallbackMode){
        enableFallback();
      }
    });

    // ===================== RECEIVE EVENTS FROM SERVER =====================

    // Verse changed (from controller → display/viewers)
    socket.on('verse_changed', (data) => {
      if(window.location.search.includes('view=output')){
        // We're in the output window — display the verse
        handleServerVerse(data);
      }
    });

    // Display cleared
    socket.on('display_cleared', () => {
      if(window.location.search.includes('view=output')){
        const outCard = document.getElementById('outCard');
        const outEmpty = document.getElementById('output-empty');
        if(outCard) outCard.style.display = 'none';
        if(outEmpty) outEmpty.style.display = 'flex';
      }
    });

    // Settings updated
    socket.on('settings_updated', (settings) => {
      if(settings.theme){
        document.documentElement.setAttribute('data-theme', settings.theme);
        const selT = document.getElementById('selTheme');
        if(selT) selT.value = settings.theme;
      }
      if(settings.mode){
        const stage = document.getElementById('stage');
        if(stage){
          Array.from(stage.classList).forEach(c => {
            if(c.startsWith('mode-')) stage.classList.remove(c);
          });
          stage.classList.add('mode-' + settings.mode);
        }
      }
    });

    // Session state (on reconnect)
    socket.on('session_state', (state) => {
      if(state.currentVerse && window.location.search.includes('view=output')){
        handleServerVerse(state.currentVerse);
      }
    });

    // Queue updated
    socket.on('queue_updated', (queue) => {
      if(window.App && window.App.state){
        window.App.state.queue = queue || [];
        if(window.App.renderQueue) window.App.renderQueue();
      }
    });
  }

  // ===================== FALLBACK MODE =====================
  function enableFallback(){
    if(fallbackMode) return;
    fallbackMode = true;
    console.log('[SmartVerse Bridge] Switched to fallback mode (localStorage)');
    showConnectionStatus('fallback');

    // The original localStorage-based system will continue working
    // We just won't send/receive via Socket.io
  }

  // ===================== INTERCEPT BROADCASTS =====================
  // Override the original broadcast function in the App
  function patchBroadcast(){
    if(!window.App || !window.App.broadcast){
      console.warn('[SmartVerse Bridge] App not ready, will retry...');
      setTimeout(patchBroadcast, 500);
      return;
    }

    const originalBroadcast = window.App.broadcast;

    window.App.broadcast = function(data){
      // Always do the original localStorage broadcast (for redundancy)
      originalBroadcast(data);

      // Also send via Socket.io if connected
      if(isConnected && socket){
        try{
          if(data.type === 'verse'){
            socket.emit('change_verse', {
              ref: data.ref,
              text: data.text,
              version: data.version,
              theme: data.theme,
              mode: data.mode
            });
          } else if(data.type === 'clear'){
            socket.emit('clear_display');
          } else if(data.type === 'mode'){
            socket.emit('update_settings', { mode: data.mode, theme: data.theme });
          } else if(data.type === 'theme'){
            socket.emit('update_settings', { theme: data.theme });
          } else if(data.type === 'qr'){
            socket.emit('update_settings', { qrEnabled: data.enabled });
          } else if(data.type === 'smartThemes'){
            socket.emit('update_settings', { smartThemes: data.enabled });
          }
        } catch(e){
          console.warn('[SmartVerse Bridge] Socket emit failed:', e.message);
        }
      }
    };

    console.log('[SmartVerse Bridge] Broadcast patched successfully');
  }

  // ===================== OUTPUT WINDOW HANDLER =====================
  function handleServerVerse(data){
    const outRef = document.getElementById('outRef');
    const outBody = document.getElementById('outBody');
    const outMeta = document.getElementById('outMeta');
    const outCard = document.getElementById('outCard');
    const outEmpty = document.getElementById('output-empty');
    const outStage = document.getElementById('outStage');

    if(outRef) outRef.textContent = data.ref + (data.version ? ' • ' + data.version : '');
    if(outBody) outBody.textContent = data.text || '[No text]';
    if(outMeta) outMeta.textContent = 'SmartVerse Display';
    if(outCard) outCard.style.display = 'block';
    if(outEmpty) outEmpty.style.display = 'none';

    if(outStage && data.mode){
      Array.from(outStage.classList).forEach(c => {
        if(c.startsWith('mode-')) outStage.classList.remove(c);
      });
      outStage.classList.add('mode-' + data.mode);
    }

    if(data.theme){
      document.documentElement.setAttribute('data-theme', data.theme);
    }

    // Update QR if enabled
    const qrOverlay = document.getElementById('qr-overlay');
    if(qrOverlay && qrOverlay.style.display !== 'none'){
      const img = document.getElementById('qr-code-img');
      if(img){
        const refOnly = data.ref.includes('•') ? data.ref.split('•')[0].trim() : data.ref;
        const qrData = refOnly + '\n\n' + (data.text || '');
        img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(qrData);
      }
    }
  }

  // ===================== UI INDICATOR =====================
  function showConnectionStatus(status){
    let el = document.getElementById('sv-connection-status');
    if(!el){
      el = document.createElement('div');
      el.id = 'sv-connection-status';
      el.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:9999;padding:4px 10px;border-radius:20px;font-size:10px;font-weight:600;letter-spacing:0.5px;transition:all 0.3s;backdrop-filter:blur(8px);';
      document.body.appendChild(el);
    }

    if(status === 'connected'){
      el.textContent = '● Live Sync';
      el.style.cssText += 'background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3);';
    } else if(status === 'disconnected'){
      el.textContent = '● Reconnecting...';
      el.style.cssText += 'background:rgba(234,179,8,0.15);color:#eab308;border:1px solid rgba(234,179,8,0.3);';
    } else if(status === 'fallback'){
      el.textContent = '● Offline Mode';
      el.style.cssText += 'background:rgba(107,107,138,0.15);color:#6b6b8a;border:1px solid rgba(107,107,138,0.3);';
    }
  }

  // ===================== INIT =====================
  // Load Socket.io client from CDN if not already loaded
  if(typeof io === 'undefined'){
    const script = document.createElement('script');
    script.src = CONFIG.SERVER_URL + '/socket.io/socket.io.js';
    script.onload = () => {
      initSocket();
      patchBroadcast();
    };
    script.onerror = () => {
      console.warn('[SmartVerse Bridge] Failed to load Socket.io client');
      enableFallback();
    };
    document.head.appendChild(script);
  } else {
    initSocket();
    patchBroadcast();
  }

  // Also try to load from CDN as backup
  setTimeout(() => {
    if(typeof io === 'undefined'){
      const script = document.createElement('script');
      script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
      script.onload = () => {
        initSocket();
        patchBroadcast();
      };
      document.head.appendChild(script);
    }
  }, 2000);

  // Expose config for debugging
  window.SmartVerseBridge = {
    config: CONFIG,
    socket: () => socket,
    isConnected: () => isConnected,
    reconnect: () => { if(socket) socket.connect(); }
  };

})();
