/**
 * SmartVerse 1.0 — Socket.io Client Bridge
 * Fixes: session sync, DOM ready checks, instant verse display
 */

(function(){
  'use strict';

  // Use a FIXED session ID by default so controller + output always match
  // Users can override via ?session=xxx URL param
  const urlParams = new URLSearchParams(window.location.search);
  const urlSession = urlParams.get('session');
  const storedSession = localStorage.getItem('smartverse_session_id');

  // Priority: URL param > localStorage > fixed default
  // Fixed default ensures cross-browser sync works out of the box
  const SESSION_ID = urlSession || storedSession || 'smartverse-live';

  // Persist for future page loads
  if(!storedSession) localStorage.setItem('smartverse_session_id', SESSION_ID);

  const CONFIG = {
    SERVER_URL: window.location.hostname === 'localhost' 
      ? 'http://localhost:3000' 
      : 'https://smartverse-y2ro.onrender.com',
    SESSION_ID: SESSION_ID,
    RECONNECT_DELAY: 2000,
    MAX_RECONNECT_ATTEMPTS: 10
  };

  const isOutput = window.location.search.includes('view=output');
  const isController = !isOutput;

  let socket = null;
  let isConnected = false;
  let reconnectAttempts = 0;
  let fallbackMode = false;
  let domReady = false;

  console.log('[SV Bridge] Starting. Mode:', isOutput ? 'OUTPUT' : 'CONTROLLER', 'Session:', CONFIG.SESSION_ID);

  // ===================== DOM READY =====================
  function onDomReady(fn){
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  // ===================== SOCKET CONNECTION =====================
  function initSocket(){
    if(typeof io === 'undefined'){
      console.warn('[SV Bridge] Socket.io not loaded. Loading from CDN...');
      loadSocketIOFromCDN();
      return;
    }
    connect();
  }

  function loadSocketIOFromCDN(){
    const script = document.createElement('script');
    script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
    script.onload = () => { console.log('[SV Bridge] Socket.io loaded from CDN'); connect(); };
    script.onerror = () => { console.error('[SV Bridge] Failed to load Socket.io'); enableFallback(); };
    document.head.appendChild(script);
  }

  function connect(){
    if(typeof io === 'undefined'){ enableFallback(); return; }

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
      console.log('[SV Bridge] ✅ CONNECTED to server:', CONFIG.SERVER_URL);

      const role = isOutput ? 'display' : 'controller';
      socket.emit('join_session', {
        sessionId: CONFIG.SESSION_ID,
        role: role
      });
      console.log('[SV Bridge] Joined session', CONFIG.SESSION_ID, 'as', role);

      showConnectionStatus('connected');
      if(isOutput) updateOutputBadge('connected');
    });

    socket.on('disconnect', (reason) => {
      isConnected = false;
      console.warn('[SV Bridge] ❌ DISCONNECTED:', reason);
      showConnectionStatus('disconnected');
      if(isOutput) updateOutputBadge('disconnected');
    });

    socket.on('connect_error', (err) => {
      console.warn('[SV Bridge] Connection error:', err.message);
      if(reconnectAttempts >= 3 && !fallbackMode){
        enableFallback();
      }
    });

    // ===================== RECEIVE EVENTS FROM SERVER =====================

    socket.on('verse_changed', (data) => {
      console.log('[SV Bridge] ⬇️ RECEIVED verse_changed:', data.ref);
      if(isOutput){
        onDomReady(() => {
          handleServerVerse(data);
          updateOutputBadge('live');
        });
      }
    });

    socket.on('display_cleared', () => {
      console.log('[SV Bridge] ⬇️ RECEIVED display_cleared');
      if(isOutput){
        onDomReady(() => {
          const outCard = document.getElementById('outCard');
          const outEmpty = document.getElementById('output-empty');
          if(outCard) outCard.style.display = 'none';
          if(outEmpty) outEmpty.style.display = 'flex';
          updateOutputBadge('waiting');
        });
      }
    });

    socket.on('settings_updated', (settings) => {
      console.log('[SV Bridge] ⬇️ Settings updated:', settings);
      if(settings.theme){
        document.documentElement.setAttribute('data-theme', settings.theme);
        const selT = document.getElementById('selTheme');
        if(selT) selT.value = settings.theme;
      }
      if(settings.mode){
        const stage = document.getElementById('stage');
        if(stage){
          Array.from(stage.classList).forEach(c => { if(c.startsWith('mode-')) stage.classList.remove(c); });
          stage.classList.add('mode-' + settings.mode);
        }
      }
    });

    socket.on('session_state', (state) => {
      console.log('[SV Bridge] ⬇️ Session state. Current verse:', state.currentVerse ? state.currentVerse.ref : 'none');
      if(isOutput && state.currentVerse){
        onDomReady(() => {
          handleServerVerse(state.currentVerse);
          updateOutputBadge('live');
        });
      }
    });

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
    console.log('[SV Bridge] Switched to FALLBACK mode (localStorage only)');
    showConnectionStatus('fallback');
    if(isOutput) updateOutputBadge('offline');
  }

  // ===================== BROADCAST HOOK (CONTROLLER) =====================
  function broadcastHook(data){
    if(!isConnected || !socket){
      console.log('[SV Bridge] Hook: not connected, skipping server broadcast');
      return;
    }

    console.log('[SV Bridge] ⬆️ SENDING via Socket.io:', data.type, data.ref || '');

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
      console.warn('[SV Bridge] Socket emit failed:', e.message);
    }
  }

  // Register hook so original broadcast() calls us
  window._svBroadcastHook = broadcastHook;
  console.log('[SV Bridge] Hook registered on window._svBroadcastHook');

  // ===================== OUTPUT WINDOW: UPDATE DOM =====================
  function handleServerVerse(data){
    console.log('[SV Bridge] Updating OUTPUT DOM for:', data.ref);

    const outRef = document.getElementById('outRef');
    const outBody = document.getElementById('outBody');
    const outMeta = document.getElementById('outMeta');
    const outCard = document.getElementById('outCard');
    const outEmpty = document.getElementById('output-empty');
    const outStage = document.getElementById('outStage');

    // Debug: log what we found
    console.log('[SV Bridge] DOM elements:', {
      outRef: !!outRef, outBody: !!outBody, outMeta: !!outMeta,
      outCard: !!outCard, outEmpty: !!outEmpty, outStage: !!outStage
    });

    if(outRef) outRef.textContent = data.ref + (data.version ? ' • ' + data.version : '');
    if(outBody) outBody.textContent = data.text || '[No text]';
    if(outMeta) outMeta.textContent = 'SmartVerse Display';

    // CRITICAL: Show card, hide empty state
    if(outCard){
      outCard.style.display = 'block';
      console.log('[SV Bridge] ✅ outCard shown');
    } else {
      console.warn('[SV Bridge] ❌ outCard not found!');
    }

    if(outEmpty){
      outEmpty.style.display = 'none';
      console.log('[SV Bridge] ✅ output-empty hidden');
    }

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
        const refOnly = (data.ref || '').includes('•') ? data.ref.split('•')[0].trim() : (data.ref || '');
        const qrData = refOnly + '\n\n' + (data.text || '');
        img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(qrData);
      }
    }

    // Update status text
    const statusEl = document.getElementById('output-status');
    if(statusEl) statusEl.textContent = 'Live: ' + data.ref;

    console.log('[SV Bridge] ✅ OUTPUT updated successfully');
  }

  // ===================== OUTPUT BADGE =====================
  function updateOutputBadge(state){
    const badge = document.getElementById('sync-badge');
    if(!badge) return;

    const styles = 'display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:600;margin-bottom:8px;';

    if(state === 'connected'){
      badge.textContent = '● Server Connected';
      badge.style.cssText = styles + 'background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3);';
    } else if(state === 'live'){
      badge.textContent = '● Live Sync Active';
      badge.style.cssText = styles + 'background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3);';
    } else if(state === 'disconnected'){
      badge.textContent = '● Reconnecting...';
      badge.style.cssText = styles + 'background:rgba(234,179,8,0.15);color:#eab308;border:1px solid rgba(234,179,8,0.3);';
    } else if(state === 'offline'){
      badge.textContent = '● Offline Mode';
      badge.style.cssText = styles + 'background:rgba(107,107,138,0.15);color:#6b6b8a;border:1px solid rgba(107,107,138,0.3);';
    } else if(state === 'waiting'){
      badge.textContent = '● Waiting for verse...';
      badge.style.cssText = styles + 'background:rgba(107,107,138,0.15);color:#6b6b8a;border:1px solid rgba(107,107,138,0.3);';
    }
  }

  // ===================== CONTROLLER INDICATOR =====================
  function showConnectionStatus(status){
    if(isOutput) return;

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
  function start(){
    if(typeof io === 'undefined'){
      const script = document.createElement('script');
      script.src = CONFIG.SERVER_URL + '/socket.io/socket.io.js';
      script.onload = () => { console.log('[SV Bridge] Socket.io loaded from server'); initSocket(); };
      script.onerror = () => {
        console.warn('[SV Bridge] Server Socket.io failed, trying CDN...');
        loadSocketIOFromCDN();
      };
      document.head.appendChild(script);
    } else {
      initSocket();
    }
  }

  // Start immediately
  start();

  // Expose for debugging
  window.SmartVerseBridge = {
    config: CONFIG,
    socket: () => socket,
    isConnected: () => isConnected,
    reconnect: () => { if(socket) socket.connect(); },
    forceSync: () => {
      const raw = localStorage.getItem('smartverse_last_verse_v14');
      if(raw && socket && isConnected){
        try{
          const data = JSON.parse(raw);
          if(data.type === 'verse'){
            socket.emit('change_verse', {
              ref: data.ref, text: data.text, version: data.version,
              theme: document.documentElement.getAttribute('data-theme') || 'dark',
              mode: 'center'
            });
            console.log('[SV Bridge] Force synced verse to server:', data.ref);
          }
        }catch(e){}
      }
    }
  };

  console.log('[SV Bridge] Initialized. Session:', CONFIG.SESSION_ID);

})();
