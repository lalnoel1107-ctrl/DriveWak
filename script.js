// DriveWake demo script.js
// Uses MediaPipe FaceMesh to estimate eye openness and detect drowsiness

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const alertBox = document.getElementById('alert');
const sensitivity = document.getElementById('sensitivity');
const sensVal = document.getElementById('sensVal');
const consecFrames = document.getElementById('consecFrames');
const frameCountVal = document.getElementById('frameCountVal');

let camera = null;
let faceMesh = null;
let detecting = false;
let consecCounter = 0;
let triggerFrames = parseInt(consecFrames?.value ?? '15', 10);
let earThreshold = parseFloat(sensitivity?.value ?? '0.25'); // lower = more tolerant
// user-configurable: enable/disable the visual/audio drowsiness alert
const showDrowsinessAlert = false;

const YAWN_TOP = 13;
const YAWN_BOTTOM = 14;
const MOUTH_LEFT = 78;
const MOUTH_RIGHT = 308;
let yawnFrames = 0;
let yawnAlertSent = false;
const YAWN_THRESHOLD = 0.45;
const YAWN_FRAMES = 6;

let lastFaceY = null;
let nodDown = false;
let nodAlertSent = false;
const NOD_DOWN_THRESHOLD = 0.018;
const NOD_UP_THRESHOLD = -0.008;

const yawnStatusEl = document.getElementById('yawnStatus');
const nodStatusEl = document.getElementById('nodStatus');

// Eye landmark indices (MediaPipe FaceMesh)
// left eye: [33, 160, 158, 133, 153, 144]
// right eye: [263, 387, 385, 362, 380, 373]
const L_EYE = [33, 160, 158, 133, 153, 144];
const R_EYE = [263, 387, 385, 362, 380, 373];

if (sensVal) sensVal.textContent = earThreshold.toFixed(2);
if (frameCountVal) frameCountVal.textContent = triggerFrames;

if (sensitivity) {
  sensitivity.addEventListener('input', () => {
    earThreshold = parseFloat(sensitivity.value);
    if (sensVal) sensVal.textContent = earThreshold.toFixed(2);
  });
}
if (consecFrames) {
  consecFrames.addEventListener('input', () => {
    triggerFrames = parseInt(consecFrames.value, 10);
    if (frameCountVal) frameCountVal.textContent = triggerFrames;
  });
}

if (startBtn) {
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    await startCamera();
  });
}
if (stopBtn) {
  stopBtn.addEventListener('click', () => {
    stopCamera();
  });
}

function startCamera(){
  if (!video || !canvas || !ctx || !window.FaceMesh || !window.Camera) return;
  // configure MediaPipe FaceMesh
  if (!faceMesh){
    faceMesh = new FaceMesh({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
      }
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    faceMesh.onResults(onResults);
  }

  canvas.width = video.clientWidth || 640;
  canvas.height = video.clientHeight || 480;

  camera = new Camera(video, {
    onFrame: async () => {
      await faceMesh.send({image: video});
    },
    width: 1280,
    height: 720
  });
  camera.start();
  detecting = true;
  if (stopBtn) stopBtn.disabled = false;
}

function stopCamera(){
  if (camera) camera.stop();
  detecting = false;
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  clearOverlay();
}

function clearOverlay(){
  if (!canvas || !ctx) return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (alertBox) alertBox.classList.add('hidden');
  consecCounter = 0;
}

function drawResults(landmarks){
  if (!canvas || !ctx) return;
  // overlays hidden: clear the overlay canvas so cyan landmarks are invisible
  ctx.clearRect(0,0,canvas.width,canvas.height);
  return;
}

function euclid(a,b){
  return Math.hypot(a.x-b.x, a.y-b.y);
}

function computeEAR(landmarks, indices){
  // indices arr: [p1,p2,p3,p4,p5,p6]
  const p1 = landmarks[indices[0]];
  const p2 = landmarks[indices[1]];
  const p3 = landmarks[indices[2]];
  const p4 = landmarks[indices[3]];
  const p5 = landmarks[indices[4]];
  const p6 = landmarks[indices[5]];
  // convert normalized to pixel coords for distance
  const A = euclid(p2,p6);
  const B = euclid(p3,p5);
  const C = euclid(p1,p4);
  const ear = (A + B) / (2.0 * C);
  return ear;
}

function onResults(results){
  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0){
    // no face
    clearOverlay();
    return;
  }
  const landmarks = results.multiFaceLandmarks[0];
  drawResults(landmarks);

  if (!ctx) return;

  // compute EAR for left and right
  const leftEAR = computeEAR(landmarks, L_EYE);
  const rightEAR = computeEAR(landmarks, R_EYE);
  const ear = (leftEAR + rightEAR) / 2.0;

  // debug overlay of EAR
  // debug overlay of EAR
  ctx.save();
  ctx.fillStyle = 'white';
  ctx.font = '16px Segoe UI';
  ctx.fillText(`EAR: ${ear.toFixed(3)}`, 10, 20);
  ctx.restore();

  // check threshold
  if (ear < earThreshold){
    consecCounter += 1;
  } else {
    consecCounter = Math.max(0, consecCounter - 1);
  }

  if (consecCounter >= triggerFrames){
    // trigger drowsiness alert (disabled by default per user request)
    if (showDrowsinessAlert && alertBox) {
      alertBox.classList.remove('hidden');
      playAlertSound();
    } else if (alertBox) {
      // keep hidden when alerts are turned off
      alertBox.classList.add('hidden');
    }
  } else if (alertBox) {
    alertBox.classList.add('hidden');
  }
}

function playAlertSound(){
  // short beep repeated
  try{
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    setTimeout(()=>{ o.stop(); audioCtx.close(); }, 350);
  }catch(e){ console.warn('Audio failed', e); }
}

const locationStatus = document.getElementById('locationStatus');
const destinationInput = document.getElementById('destinationInput');
const setRouteBtn = document.getElementById('setRouteBtn');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
const aiStatus = document.getElementById('aiStatus');
const chatMessages = document.getElementById('chatMessages');
const connectHeartRateBtn = document.getElementById('connectHeartRate');
const disconnectHeartRateBtn = document.getElementById('disconnectHeartRate');
const heartRateStatus = document.getElementById('heartRateStatus');
const heartRateValue = document.getElementById('heartRateValue');
let worldMap = null;
let locationMarker = null;
let routeLine = null;
let destinationMarker = null;
let routeTarget = null;
let liveLocation = null;
let locationWatchId = null;
let hasInitialLocation = false;
let heartRateDevice = null;
let heartRateCharacteristic = null;

function initWorldMap() {
  if (!window.L || worldMap) return;
  worldMap = L.map('worldMap', {
    worldCopyJump: true,
    minZoom: 2,
    maxZoom: 18,
    zoomControl: true
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(worldMap);
  worldMap.setView([20, 0], 2);
}

function computeBearing(lat1, lon1, lat2, lon2) {
  // returns bearing in degrees from north
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (d) => d * 180 / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLambda = toRad(lon2 - lon1);
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return (toDeg(theta) + 360) % 360;
}

function createCarMarker(label, isCurrent, bearing = 0) {
  const emoji = isCurrent ? '🚙' : '🚗';
  const rot = Math.round(bearing || 0);
  const html = `<span style="transform:rotate(${rot}deg)">${emoji}</span>`;
  return L.divIcon({
    className: `route-car-marker${isCurrent ? ' current' : ''}`,
    html: html,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -12]
  });
}

function updateMapLocation(lat, lon) {
  if (!worldMap || !window.L) return;
  const prev = liveLocation ? {lat: liveLocation.lat, lon: liveLocation.lon} : null;
  liveLocation = {lat, lon};
  let bearing = 0;
  if (prev) {
    bearing = computeBearing(prev.lat, prev.lon, lat, lon);
  }

  if (!locationMarker) {
    locationMarker = L.marker([lat, lon], {icon: createCarMarker('Current', true, bearing)}).addTo(worldMap);
  } else {
    locationMarker.setLatLng([lat, lon]);
    locationMarker.setIcon(createCarMarker('Current', true, bearing));
  }
  if (routeTarget) {
    drawRouteLine();
  }
  worldMap.setView([lat, lon], 17, {animate: true, duration: 1.2});
}

let routeProgressMarker = null;
let routeProgressTimer = null;

function animateRouteProgress(duration = 6000) {
  if (!routeTarget || !liveLocation || !worldMap) return;
  if (routeProgressMarker) {
    worldMap.removeLayer(routeProgressMarker);
    routeProgressMarker = null;
  }
  if (routeProgressTimer) {
    clearInterval(routeProgressTimer);
    routeProgressTimer = null;
  }

  const start = [liveLocation.lat, liveLocation.lon];
  const end = [routeTarget.lat, routeTarget.lon];
  const steps = Math.max(40, Math.floor(duration / 50));
  let step = 0;

  routeProgressMarker = L.marker(start, {icon: createCarMarker('Progress', true, 0)}).addTo(worldMap);

  routeProgressTimer = setInterval(() => {
    step += 1;
    const t = Math.min(1, step / steps);
    const lat = start[0] + (end[0] - start[0]) * t;
    const lon = start[1] + (end[1] - start[1]) * t;
    // compute bearing for visual
    const bearing = computeBearing(start[0] + (end[0] - start[0]) * Math.max(0, t - 0.01), start[1] + (end[1] - start[1]) * Math.max(0, t - 0.01), lat, lon);
    routeProgressMarker.setLatLng([lat, lon]);
    routeProgressMarker.setIcon(createCarMarker('Progress', true, bearing));
    if (t >= 1) {
      clearInterval(routeProgressTimer);
      routeProgressTimer = null;
    }
  }, Math.max(30, Math.floor(duration / steps)));
}

function drawRouteLine() {
  if (!worldMap || !window.L || !routeTarget || !liveLocation) return;
  if (routeLine) {
    worldMap.removeLayer(routeLine);
  }
  if (destinationMarker) {
    worldMap.removeLayer(destinationMarker);
  }

  routeLine = L.polyline([
    [liveLocation.lat, liveLocation.lon],
    [routeTarget.lat, routeTarget.lon]
  ], {
    color: '#ef4444',
    weight: 5,
    opacity: 0.9,
    dashArray: '12 10'
  }).addTo(worldMap);

  destinationMarker = L.marker([routeTarget.lat, routeTarget.lon], {icon: createCarMarker('Destination', false)}).addTo(worldMap);
  destinationMarker.bindPopup(routeTarget.label || 'Destination');
  worldMap.fitBounds(routeLine.getBounds(), {padding: [35, 35], maxZoom: 18});
}

async function setRouteToDestination() {
  const query = destinationInput.value.trim();
  if (!query) {
    locationStatus.textContent = 'Type a destination city or address to show a route.';
    return;
  }

  if (!liveLocation) {
    locationStatus.textContent = 'Waiting for your current location before drawing a route.';
    return;
  }

  try {
    const match = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    let lat;
    let lon;
    let label = query;

    if (match) {
      lat = parseFloat(match[1]);
      lon = parseFloat(match[2]);
    } else {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error('Destination lookup failed');
      const results = await response.json();
      if (!results || results.length === 0) {
        throw new Error('No destination found');
      }
      lat = parseFloat(results[0].lat);
      lon = parseFloat(results[0].lon);
      label = results[0].display_name || query;
    }

    routeTarget = {lat, lon, label};
    drawRouteLine();
    // start a short animated preview along the route
    animateRouteProgress(6000);
    locationStatus.textContent = `Route to ${label}: ${liveLocation.lat.toFixed(4)}, ${liveLocation.lon.toFixed(4)} → ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  } catch (err) {
    console.warn('Route lookup failed', err);
    locationStatus.textContent = 'Could not find that destination. Try a city, address, or "lat,lon".';
  }
}

// ========== Location detection ==========
function updateGPSPanel(lat, lon, accuracy, altitude, speed, timestamp) {
  document.getElementById('gpsLat').textContent = lat != null ? lat.toFixed(6) : '—';
  document.getElementById('gpsLon').textContent = lon != null ? lon.toFixed(6) : '—';
  document.getElementById('gpsAcc').textContent = accuracy != null ? `${Math.round(accuracy)} m` : '—';
  document.getElementById('gpsAlt').textContent = altitude != null ? `${altitude.toFixed(1)} m` : '—';
  document.getElementById('gpsSpeed').textContent = speed != null ? `${(speed*3.6).toFixed(1)} km/h` : '—';
  document.getElementById('gpsTime').textContent = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
}

function updateLiveLocationStatus(lat, lon, accuracy, altitude, speed) {
  const fmt = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  const accuracyText = accuracy ? ` (±${Math.round(accuracy)}m)` : '';
  locationStatus.textContent = `Live location: ${fmt}${accuracyText}`;
  updateGPSPanel(lat, lon, accuracy, altitude, speed, Date.now());
}

async function initLocation() {
  if ('geolocation' in navigator) {
    const handleLocationSuccess = async (position) => {
      const {latitude, longitude, accuracy} = position.coords;
      updateMapLocation(latitude, longitude);
      updateLiveLocationStatus(latitude, longitude, accuracy);

      if (!hasInitialLocation) {
        hasInitialLocation = true;
        locationStatus.textContent = `Live location: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}${accuracy ? ` (±${Math.round(accuracy)}m)` : ''} — looking up address...`;
        await reverseGeocode(latitude, longitude);
      }
    };

    const handleLocationError = async () => {
      locationStatus.textContent = 'Location permission denied or unavailable. Falling back to IP-based location…';
      await lookupLocationByIP();
    };

    navigator.geolocation.getCurrentPosition(handleLocationSuccess, handleLocationError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    });

    if ('watchPosition' in navigator) {
      locationWatchId = navigator.geolocation.watchPosition(handleLocationSuccess, handleLocationError, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 3000
      });
    }
  } else {
    await lookupLocationByIP();
  }
}

async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Reverse geocode failed');
    const data = await resp.json();
    const address = data.display_name || `Latitude ${lat.toFixed(4)}, Longitude ${lon.toFixed(4)}`;
    locationStatus.textContent = `Live location: ${lat.toFixed(4)}, ${lon.toFixed(4)} — ${address}`;
  } catch (err) {
    console.warn('Reverse geocode error', err);
    locationStatus.textContent = `Live location: ${lat.toFixed(4)}, ${lon.toFixed(4)} (address lookup failed)`;
  }
}

async function lookupLocationByIP() {
  try {
    const resp = await fetch('https://ipapi.co/json/');
    if (!resp.ok) throw new Error('IP location fetch failed');
    const data = await resp.json();
    const parts = [data.city, data.region, data.country_name].filter(Boolean);
    const coords = data.latitude && data.longitude ? ` (${parseFloat(data.latitude).toFixed(4)}, ${parseFloat(data.longitude).toFixed(4)})` : '';
    if (data.latitude && data.longitude) {
      const lat = parseFloat(data.latitude);
      const lon = parseFloat(data.longitude);
      updateMapLocation(lat, lon);
      updateGPSPanel(lat, lon, null, null, null, Date.now());
    }
    locationStatus.textContent = parts.length > 0 ? `${parts.join(', ')}${coords}` : `IP location: ${data.ip}${coords}`;
  } catch (err) {
    console.warn('IP location error', err);
    locationStatus.textContent = 'Unable to determine location from browser.';
  }
}

async function connectHeartRateMonitor() {
  if (!navigator.bluetooth) {
    updateHeartRateStatus('Bluetooth not supported in this browser.');
    return;
  }

  try {
    updateHeartRateStatus('Requesting watch...');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{services: ['heart_rate']}],
      optionalServices: ['battery_service']
    });

    heartRateDevice = device;
    heartRateDevice.addEventListener('gattserverdisconnected', handleHeartRateDisconnect);
    updateHeartRateStatus(`Connecting to ${device.name || 'watch'}...`);

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    heartRateCharacteristic = await service.getCharacteristic('heart_rate_measurement');

    await heartRateCharacteristic.startNotifications();
    heartRateCharacteristic.addEventListener('characteristicvaluechanged', handleHeartRateChanged);

    updateHeartRateStatus('Connected — waiting for measurement...');
    connectHeartRateBtn.disabled = true;
    disconnectHeartRateBtn.disabled = false;
  } catch (error) {
    console.error('Heart rate connect failed', error);
    updateHeartRateStatus(`Connection failed: ${error.message || error}`);
  }
}

function handleHeartRateDisconnect() {
  updateHeartRateStatus('Watch disconnected.');
  heartRateValue.textContent = '—';
  connectHeartRateBtn.disabled = false;
  disconnectHeartRateBtn.disabled = true;
}

async function disconnectHeartRateMonitor() {
  if (heartRateCharacteristic) {
    try {
      await heartRateCharacteristic.stopNotifications();
      heartRateCharacteristic.removeEventListener('characteristicvaluechanged', handleHeartRateChanged);
    } catch (error) {
      console.warn('Stopping heart rate notifications failed', error);
    }
  }
  if (heartRateDevice && heartRateDevice.gatt.connected) {
    heartRateDevice.gatt.disconnect();
  }

  heartRateDevice = null;
  heartRateCharacteristic = null;
  updateHeartRateStatus('Disconnected.');
  heartRateValue.textContent = '—';
  connectHeartRateBtn.disabled = false;
  disconnectHeartRateBtn.disabled = true;
}

function handleHeartRateChanged(event) {
  const value = event.target.value;
  const heartRate = parseHeartRateMeasurement(value);
  if (heartRate !== null) {
    heartRateValue.textContent = `${heartRate} bpm`;
    updateHeartRateStatus('Live heart rate');
  } else {
    heartRateValue.textContent = 'Unknown';
    updateHeartRateStatus('Received unsupported heart rate data');
  }
}

function parseHeartRateMeasurement(dataView) {
  const flags = dataView.getUint8(0);
  const rate16Bits = flags & 0x1;
  if (rate16Bits) {
    return dataView.getUint16(1, true);
  }
  return dataView.getUint8(1);
}

function updateHeartRateStatus(text) {
  heartRateStatus.textContent = text;
}

window.addEventListener('load', () => {
  initWorldMap();
  initLocation();
  setRouteBtn?.addEventListener('click', setRouteToDestination);
  destinationInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      setRouteToDestination();
    }
  });
  saveApiKeyBtn?.addEventListener('click', saveApiKey);
  apiKeyInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      saveApiKey();
    }
  });
  sendChatBtn?.addEventListener('click', sendChatMessage);
  chatInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      sendChatMessage();
    }
  });
  if (apiKeyInput) {
    const savedKey = getStoredApiKey();
    apiKeyInput.value = savedKey;
    setAiStatus(savedKey ? 'AI mode: external model connected' : 'AI mode: local fallback');
  }
  connectHeartRateBtn?.addEventListener('click', connectHeartRateMonitor);
  disconnectHeartRateBtn?.addEventListener('click', disconnectHeartRateMonitor);
});

function addChatMessage(role, text) {
  if (!chatMessages) return;
  const row = document.createElement('div');
  row.className = `chatRow ${role}`;
  const label = document.createElement('span');
  label.className = 'chatLabel';
  label.textContent = role === 'human' ? 'Human' : 'Wakemate';
  const bubble = document.createElement('div');
  bubble.className = 'chatBubble';
  bubble.textContent = text;
  row.appendChild(label);
  row.appendChild(bubble);
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setAiStatus(message, state = 'info') {
  if (!aiStatus) return;
  aiStatus.textContent = message;
  aiStatus.dataset.state = state;
}

function getStoredApiKey() {
  try {
    return localStorage.getItem('drivewake-openrouter-key') || '';
  } catch (error) {
    return '';
  }
}

function saveApiKey() {
  if (!apiKeyInput) return;
  const value = apiKeyInput.value.trim();
  try {
    if (value) {
      localStorage.setItem('drivewake-openrouter-key', value);
      setAiStatus('AI mode: external model connected', 'success');
    } else {
      localStorage.removeItem('drivewake-openrouter-key');
      setAiStatus('AI mode: local fallback', 'info');
    }
  } catch (error) {
    console.warn('Could not save AI key', error);
    setAiStatus('AI mode: unable to save key locally', 'warning');
  }
}

function getAiReply(text) {
  const value = text.trim().toLowerCase();
  if (!value) return 'Hello! I am here to help you drive safely.';
  if (/(hello|hi|hey)/.test(value)) return 'Hi! I can help you stay safe on the road. What do you need?';
  if (/(dark|night|too dark|very dark|dim)/.test(value)) return 'It is very dark. Please turn on your headlights, slow down, and keep a wider following distance.';
  if (/(sleepy|tired|drowsy|yawn|sleep)/.test(value)) return 'You should pull over somewhere safe, stretch, drink water, and take a short rest if you feel sleepy.';
  if (/(help.*drive|drive well|drive safely|safe driving|help me drive)/.test(value)) return 'Sure — keep your eyes on the road, maintain a safe following distance, avoid distractions, and take breaks if you feel tired.';
  if (/(thank|thanks)/.test(value)) return 'You are welcome. Stay focused and safe on the road.';
  if (/(angry|stress|panic|scared)/.test(value)) return 'Take a breath, slow down, and focus on one safe action at a time. Pull over if you need to calm down.';
  return 'Sure — stay alert, keep a safe distance, and take a break if you feel tired or distracted.';
}

async function askExternalAi(message) {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    return { text: getAiReply(message), usingFallback: true };
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://drivewake.local',
        'X-Title': 'DriveWake'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are Wakemate, a calm and helpful driving safety assistant. Provide brief, practical, and safe driving guidance. Keep replies short and friendly.'
          },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 220
      })
    });

    if (!response.ok) {
      throw new Error(`AI request failed (${response.status})`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error('Empty AI response');
    }

    const safeText = text.replace(/\s+/g, ' ').trim();
    setAiStatus('AI mode: live model response', 'success');
    return { text: safeText, usingFallback: false };
  } catch (error) {
    console.warn('External AI request failed, using fallback.', error);
    setAiStatus('AI mode: live model unavailable, fallback active', 'warning');
    return { text: getAiReply(message), usingFallback: true };
  }
}

async function sendChatMessage() {
  if (!chatInput || !chatMessages) return;
  const text = chatInput.value.trim();
  if (!text) return;
  addChatMessage('human', text);
  chatInput.value = '';

  const replyText = await askExternalAi(text);
  setTimeout(() => {
    addChatMessage('ai', replyText.text);
  }, 200);
}

window.addEventListener('beforeunload', () => {
  stopCamera();
});
