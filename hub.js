// ==========================================
// AR Hand Tracking Engine & Hub Controller
// ==========================================

const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('ar-canvas');
const canvasCtx = canvasElement.getContext('2d');
const cursor = document.getElementById('hand-cursor');

const startScreen = document.getElementById('start-screen');
const hubMenu = document.getElementById('hub-menu');
const gameContainer = document.getElementById('game-container');
const gameFrame = document.getElementById('game-frame');
const btnBack = document.getElementById('btn-back');
const btnStart = document.getElementById('btn-start-camera');
const loadingText = document.getElementById('loading-text');
const trackingHud = document.getElementById('tracking-hud');

// MediaPipe Hand Bone Connections (21 Landmarks)
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
    [0, 5], [5, 6], [6, 7], [7, 8],       // Index
    [0, 9], [9, 10], [10, 11], [11, 12],  // Middle
    [0, 13], [13, 14], [14, 15], [15, 16],// Ring
    [0, 17], [17, 18], [18, 19], [19, 20],// Pinky
    [5, 9], [9, 13], [13, 17]             // Palm base
];

// AR Interactive Particle System
class ARParticle {
    constructor(x, y, vx, vy, color, size, life) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.size = size;
        this.life = life;
        this.maxLife = life;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.95;
        this.vy *= 0.95;
        this.life--;
        return this.life > 0;
    }

    draw(ctx) {
        const alpha = Math.max(0, this.life / this.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.color;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * alpha, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

const arParticles = [];

function spawnStardust(x, y, count = 1, isGold = false) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2 + 0.5;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        const color = isGold
            ? (Math.random() > 0.5 ? '#facc15' : '#ffb36a')
            : (Math.random() > 0.5 ? '#38bdf8' : '#7dd3fc');
        const size = Math.random() * 3 + 1.5;
        const life = Math.floor(Math.random() * 15 + 15);
        arParticles.push(new ARParticle(x, y, vx, vy, color, size, life));
    }
    if (arParticles.length > 80) arParticles.splice(0, arParticles.length - 80);
}

function spawnPinchBurst(x, y) {
    for (let i = 0; i < 18; i++) {
        const angle = (Math.PI * 2 * i) / 18 + (Math.random() - 0.5) * 0.3;
        const speed = Math.random() * 4 + 2;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        const color = Math.random() > 0.4 ? '#facc15' : '#ffb36a';
        arParticles.push(new ARParticle(x, y, vx, vy, color, Math.random() * 4 + 2, 24));
    }
}

// Adaptive Velocity-Sensitive Filter (Rock-solid hovering + zero-lag flicking)
class AdaptiveFilter {
    constructor(minAlpha = 0.22, maxAlpha = 0.88, speedThreshold = 600) {
        this.minAlpha = minAlpha;
        this.maxAlpha = maxAlpha;
        this.speedThreshold = speedThreshold;
        this.x = null;
        this.y = null;
        this.lastTime = null;
    }

    filter(newX, newY, timestamp = performance.now()) {
        if (this.x === null || this.lastTime === null) {
            this.x = newX;
            this.y = newY;
            this.lastTime = timestamp;
            return { x: newX, y: newY, speed: 0 };
        }

        const dt = Math.max(1, timestamp - this.lastTime);
        const dist = Math.hypot(newX - this.x, newY - this.y);
        const speed = (dist / dt) * 1000;

        const factor = Math.min(1, speed / this.speedThreshold);
        const alpha = this.minAlpha + (this.maxAlpha - this.minAlpha) * (factor * factor);

        this.x = this.x + alpha * (newX - this.x);
        this.y = this.y + alpha * (newY - this.y);
        this.lastTime = timestamp;

        return { x: this.x, y: this.y, speed };
    }

    reset() {
        this.x = null;
        this.y = null;
        this.lastTime = null;
    }
}

const adaptiveFilter = new AdaptiveFilter();

// State variables
let wasPinching = false;
let smoothedPinchRatio = null;
let isProcessing = false;
let isHandPresent = false;
let lastTrackedTime = 0;
const TRACKING_LOST_GRACE_MS = 280;
let lastHoveredEl = null;
let isCameraActive = false;

// Web Audio Feedback
let hubAudioCtx = null;
function playHubTone(type = 'select') {
    try {
        if (!hubAudioCtx) {
            hubAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (hubAudioCtx.state === 'suspended') hubAudioCtx.resume();
        const osc = hubAudioCtx.createOscillator();
        const gain = hubAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(hubAudioCtx.destination);

        if (type === 'hover') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(520, hubAudioCtx.currentTime);
            gain.gain.setValueAtTime(0.04, hubAudioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, hubAudioCtx.currentTime + 0.05);
            osc.start();
            osc.stop(hubAudioCtx.currentTime + 0.05);
        } else {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(587.33, hubAudioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(987.77, hubAudioCtx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.2, hubAudioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, hubAudioCtx.currentTime + 0.14);
            osc.start();
            osc.stop(hubAudioCtx.currentTime + 0.14);
        }
    } catch (e) {}
}

// Canvas HiDPI Resizing
function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvasElement.width = window.innerWidth * dpr;
    canvasElement.height = window.innerHeight * dpr;
    canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Video-to-Screen Geometry Matching (Matches video object-fit: cover 1:1)
function getVideoRenderBox() {
    const videoWidth = videoElement.videoWidth || 640;
    const videoHeight = videoElement.videoHeight || 480;
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    const videoRatio = videoWidth / videoHeight;
    const screenRatio = screenWidth / screenHeight;

    let renderWidth, renderHeight, offsetX = 0, offsetY = 0;

    if (screenRatio > videoRatio) {
        renderWidth = screenWidth;
        renderHeight = screenWidth / videoRatio;
        offsetY = (screenHeight - renderHeight) / 2;
    } else {
        renderHeight = screenHeight;
        renderWidth = screenHeight * videoRatio;
        offsetX = (screenWidth - renderWidth) / 2;
    }

    return { renderWidth, renderHeight, offsetX, offsetY, screenWidth, screenHeight };
}

// Map normalized landmark (0..1) to physical screen coordinates (Mirrored for selfie view)
function mapLandmarkToVideoScreen(normX, normY) {
    const { renderWidth, renderHeight, offsetX, offsetY } = getVideoRenderBox();
    return {
        x: (1 - normX) * renderWidth + offsetX,
        y: normY * renderHeight + offsetY
    };
}

// Ergonomic reach assist
function remapWithMargin(val, maxVal, margin = 40) {
    if (val <= margin) return 0;
    if (val >= maxVal - margin) return maxVal;
    return ((val - margin) / (maxVal - 2 * margin)) * maxVal;
}

// Update HUD Status Badge
function updateStatusHUD(found) {
    if (!trackingHud || !isCameraActive) return;
    trackingHud.classList.add('active');
    if (found) {
        trackingHud.classList.add('ready');
        trackingHud.querySelector('.hud-text').textContent = 'ตรวจพบมือ • พร้อมเล่น';
    } else {
        trackingHud.classList.remove('ready');
        trackingHud.querySelector('.hud-text').textContent = 'กำลังค้นหามือ • ยกมือขึ้นในกล้อง';
    }
}

// Draw futuristic AR hand skeleton overlay & particles on canvas
function drawHandSkeleton(screenPoints, isPinching, pinchRatio, cursorX, cursorY) {
    canvasCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // 1. Draw and update floating AR particles
    for (let i = arParticles.length - 1; i >= 0; i--) {
        const p = arParticles[i];
        if (!p.update()) {
            arParticles.splice(i, 1);
        } else {
            p.draw(canvasCtx);
        }
    }

    if (!screenPoints || screenPoints.length === 0) return;

    // Spawn subtle stardust trail near fingertip
    if (cursorX && cursorY && Math.random() > 0.4) {
        spawnStardust(cursorX, cursorY, 1, isPinching);
    }

    // 2. Hand Bones (holographic glowing lines)
    canvasCtx.save();
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';

    for (const [i, j] of HAND_CONNECTIONS) {
        const p1 = screenPoints[i];
        const p2 = screenPoints[j];
        if (!p1 || !p2) continue;

        canvasCtx.beginPath();
        canvasCtx.moveTo(p1.x, p1.y);
        canvasCtx.lineTo(p2.x, p2.y);
        canvasCtx.lineWidth = isPinching ? 3 : 2.5;
        canvasCtx.strokeStyle = isPinching
            ? 'rgba(255, 179, 106, 0.55)'
            : 'rgba(56, 189, 248, 0.38)';
        canvasCtx.stroke();
    }

    // 3. Joint Nodes
    for (let i = 0; i < screenPoints.length; i++) {
        if (i === 4 || i === 8 || i === 12 || i === 16 || i === 20) continue;
        const p = screenPoints[i];
        if (!p) continue;

        canvasCtx.beginPath();
        canvasCtx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        canvasCtx.fillStyle = 'rgba(186, 230, 253, 0.75)';
        canvasCtx.shadowColor = '#38bdf8';
        canvasCtx.shadowBlur = 6;
        canvasCtx.fill();
    }

    // 4. Fingertips (4 = thumb, 8 = index, 12 = middle)
    const tips = [4, 8, 12, 16, 20];
    for (const tip of tips) {
        const p = screenPoints[tip];
        if (!p) continue;
        const isInteractive = (tip === 4 || tip === 8);
        const r = isInteractive ? (isPinching ? 7.5 : 5.5) : 3.5;

        canvasCtx.beginPath();
        canvasCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
        canvasCtx.fillStyle = isInteractive
            ? (isPinching ? '#facc15' : '#38bdf8')
            : 'rgba(186, 230, 253, 0.8)';
        canvasCtx.shadowColor = isInteractive ? (isPinching ? '#facc15' : '#38bdf8') : 'transparent';
        canvasCtx.shadowBlur = isInteractive ? 12 : 0;
        canvasCtx.fill();

        if (isInteractive) {
            canvasCtx.beginPath();
            canvasCtx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
            canvasCtx.strokeStyle = isPinching ? 'rgba(250, 204, 21, 0.6)' : 'rgba(56, 189, 248, 0.4)';
            canvasCtx.lineWidth = 1.5;
            canvasCtx.stroke();
        }
    }

    // 5. Energy beam & burst between Thumb (4) and Index (8) when closing in to pinch
    if (screenPoints[4] && screenPoints[8] && pinchRatio < 0.7) {
        const p4 = screenPoints[4];
        const p8 = screenPoints[8];
        const alpha = Math.min(1, Math.max(0.2, (0.7 - pinchRatio) / 0.35));

        canvasCtx.beginPath();
        canvasCtx.moveTo(p4.x, p4.y);
        canvasCtx.lineTo(p8.x, p8.y);
        canvasCtx.strokeStyle = isPinching
            ? `rgba(250, 204, 21, ${alpha})`
            : `rgba(56, 189, 248, ${alpha * 0.85})`;
        canvasCtx.lineWidth = isPinching ? 4 : 2;
        canvasCtx.shadowColor = isPinching ? '#facc15' : '#38bdf8';
        canvasCtx.shadowBlur = 10;
        canvasCtx.stroke();

        if (isPinching) {
            const midX = (p4.x + p8.x) / 2;
            const midY = (p4.y + p8.y) / 2;
            canvasCtx.beginPath();
            canvasCtx.arc(midX, midY, 16, 0, Math.PI * 2);
            canvasCtx.strokeStyle = 'rgba(250, 204, 21, 0.75)';
            canvasCtx.lineWidth = 2;
            canvasCtx.stroke();
        }
    }

    canvasCtx.restore();
}

// Navigation
function launchGame(gamePath) {
    hubMenu.classList.remove('active');
    gameContainer.classList.add('active');
    gameFrame.src = gamePath;
}

function returnToHub() {
    gameFrame.src = '';
    gameContainer.classList.remove('active');
    hubMenu.classList.add('active');
}

btnBack.addEventListener('click', returnToHub);
document.querySelectorAll('.game-card').forEach(card => {
    card.addEventListener('click', () => {
        if (card.dataset.game) launchGame(card.dataset.game);
    });
});

// Interactive hover and pinch handling for Hub menu cards
function checkHubInteraction(x, y, isPinching) {
    const interactables = [...document.querySelectorAll('.screen.active .interactable')];
    let foundHovered = null;

    for (const el of interactables) {
        const rect = el.getBoundingClientRect();
        const wasElHovered = (el === lastHoveredEl);
        const pad = wasElHovered ? 22 : 12;
        const isInside = x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;

        if (isInside) {
            foundHovered = el;
            break;
        }
    }

    if (foundHovered !== lastHoveredEl) {
        if (lastHoveredEl) lastHoveredEl.classList.remove('hovered');
        if (foundHovered) {
            foundHovered.classList.add('hovered');
            playHubTone('hover');
        }
        lastHoveredEl = foundHovered;
    }

    cursor.classList.toggle('hovering', Boolean(foundHovered));

    if (foundHovered && isPinching && !wasPinching) {
        playHubTone('select');
        spawnPinchBurst(x, y);
        foundHovered.classList.add('pinched');
        setTimeout(() => foundHovered.classList.remove('pinched'), 220);
        if (foundHovered.dataset.game) launchGame(foundHovered.dataset.game);
        else if (foundHovered.id === 'btn-back') returnToHub();
        else foundHovered.click();
    }
}

// MediaPipe Results Processing Callback
function onResults(results) {
    const now = performance.now();
    const hasHand = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

    if (hasHand) {
        lastTrackedTime = now;
        if (!isHandPresent) {
            isHandPresent = true;
            updateStatusHUD(true);
        }

        const landmarks = results.multiHandLandmarks[0];
        const screenPoints = landmarks.map(lm => mapLandmarkToVideoScreen(lm.x, lm.y));

        const wrist = screenPoints[0];
        const middleMcp = screenPoints[9];
        const indexTip = screenPoints[8];
        const thumbTip = screenPoints[4];
        const middleTip = screenPoints[12];

        // 1. Distance-Invariant Scale: Wrist to Middle MCP
        const palmScale = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y);
        const refScale = Math.max(30, palmScale);

        // 2. Pinch Distance: Thumb to Index or Middle Tip
        const indexThumbDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
        const middleThumbDist = Math.hypot(middleTip.x - thumbTip.x, middleTip.y - thumbTip.y);
        const rawPinchDist = Math.min(indexThumbDist, middleThumbDist);
        const currentPinchRatio = rawPinchDist / refScale;

        if (smoothedPinchRatio === null) smoothedPinchRatio = currentPinchRatio;
        else smoothedPinchRatio = smoothedPinchRatio * 0.65 + currentPinchRatio * 0.35;

        // Hysteresis threshold: 0.36 to trigger, 0.50 to release
        const pinchThreshold = wasPinching ? 0.50 : 0.36;
        const isPinching = smoothedPinchRatio < pinchThreshold;

        // Spawn pinch burst particles on pinch down
        if (isPinching && !wasPinching) {
            const burstX = (indexTip.x + thumbTip.x) / 2;
            const burstY = (indexTip.y + thumbTip.y) / 2;
            spawnPinchBurst(burstX, burstY);
        }

        // 3. Anchor cursor during pinch: blend towards midpoint
        const isIndexPinch = (indexThumbDist <= middleThumbDist);
        const activeTip = isIndexPinch ? indexTip : middleTip;
        const pinchMidX = (activeTip.x + thumbTip.x) / 2;
        const pinchMidY = (activeTip.y + thumbTip.y) / 2;

        const blend = Math.max(0, Math.min(1, (0.58 - smoothedPinchRatio) / 0.23));
        const rawCursorX = activeTip.x * (1 - blend) + pinchMidX * blend;
        const rawCursorY = activeTip.y * (1 - blend) + pinchMidY * blend;

        // Ergonomic margin expansion to reach screen edges easily
        const remappedX = remapWithMargin(rawCursorX, window.innerWidth, 40);
        const remappedY = remapWithMargin(rawCursorY, window.innerHeight, 40);

        // Adaptive smoothing
        const { x: screenX, y: screenY } = adaptiveFilter.filter(remappedX, remappedY, now);

        // Draw AR skeleton overlay and particles
        drawHandSkeleton(screenPoints, isPinching, smoothedPinchRatio, screenX, screenY);

        // Update cursor
        cursor.style.display = 'block';
        cursor.style.left = `${screenX}px`;
        cursor.style.top = `${screenY}px`;
        cursor.classList.toggle('pinching', isPinching);

        // Hub screen interaction
        if (hubMenu.classList.contains('active')) {
            checkHubInteraction(screenX, screenY, isPinching);
        }

        // Post coordinates to active game iframe
        if (gameContainer.classList.contains('active') && gameFrame.contentWindow) {
            const frameRect = gameFrame.getBoundingClientRect();
            gameFrame.contentWindow.postMessage({
                type: 'HAND_DATA',
                x: screenX - frameRect.left,
                y: screenY - frameRect.top,
                isPinching: isPinching,
                pinchRatio: smoothedPinchRatio,
                rawX: screenX,
                rawY: screenY
            }, location.origin);
        }

        wasPinching = isPinching;
    } else {
        const elapsed = now - lastTrackedTime;
        if (isHandPresent && elapsed < TRACKING_LOST_GRACE_MS) {
            drawHandSkeleton([], false, 1);
            return;
        }

        if (isHandPresent) {
            isHandPresent = false;
            updateStatusHUD(false);
            if (lastHoveredEl) {
                lastHoveredEl.classList.remove('hovered');
                lastHoveredEl = null;
            }
        }

        canvasCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        cursor.style.display = 'none';
        adaptiveFilter.reset();
        smoothedPinchRatio = null;

        if (gameContainer.classList.contains('active') && gameFrame.contentWindow) {
            gameFrame.contentWindow.postMessage({ type: 'HAND_LOST' }, location.origin);
        }
        wasPinching = false;
    }
}

// Receive messages from child game iframe
window.addEventListener('message', event => {
    if (event.origin !== location.origin) return;
    if (event.data?.type === 'HOVER_STATE') {
        if (gameContainer.classList.contains('active')) {
            cursor.classList.toggle('hovering', Boolean(event.data.isHovering));
        }
    }
});

// Configure MediaPipe Hands
const hands = typeof Hands === 'function' ? new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
}) : null;

hands?.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

hands?.onResults(onResults);

// Frame Processing Loop
async function processVideoFrame() {
    if (videoElement.readyState >= 2 && !isProcessing && hands) {
        isProcessing = true;
        try {
            await hands.send({ image: videoElement });
        } catch (error) {
            // Soft ignore: do not trigger HAND_LOST on momentary frame drop
        } finally {
            isProcessing = false;
        }
    }
    requestAnimationFrame(processVideoFrame);
}

// Start Camera Flow
btnStart.addEventListener('click', async () => {
    btnStart.disabled = true;
    loadingText.style.display = 'block';

    try {
        if (!hands) throw new Error('Hand tracking library unavailable');

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 1280, max: 1920 },
                    height: { ideal: 720, max: 1080 },
                    frameRate: { ideal: 60, min: 30 }
                },
                audio: false
            });
        } catch (e) {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' },
                audio: false
            });
        }

        videoElement.srcObject = stream;
        await new Promise(resolve => {
            if (videoElement.readyState >= 2) resolve();
            else videoElement.onloadedmetadata = () => resolve();
        });
        await videoElement.play();

        isCameraActive = true;
        startScreen.classList.remove('active');
        hubMenu.classList.add('active');
        updateStatusHUD(false);
        processVideoFrame();
    } catch (err) {
        alert('ไม่สามารถเปิดกล้องได้ กรุณาตรวจสอบสิทธิ์กล้องหรือเปิดผ่าน HTTPS / localhost');
        btnStart.disabled = false;
        loadingText.style.display = 'none';
    }
});

// Mouse / Touch fallback
document.getElementById('btn-start-mouse').addEventListener('click', () => {
    startScreen.classList.remove('active');
    hubMenu.classList.add('active');
});
