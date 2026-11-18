// ==========================================
// AR Game Interactions & Gesture Controller
// ==========================================

const GAME_MODES = [
  {id:'basket', name:'หยิบลงตะกร้า', icon:'fa-solid fa-basket-shopping', target:'ปล่อยคำตอบลงตะกร้า', kind:'drag'},
  {id:'portal', name:'ประตูมิติ', icon:'fa-solid fa-atom', target:'ส่งคำตอบผ่านประตูมิติ', kind:'drag'},
  {id:'rocket', name:'เติมพลังจรวด', icon:'fa-solid fa-rocket', target:'วางคำตอบเพื่อปล่อยจรวด', kind:'drag'},
  {id:'balloon', name:'บีบลูกโป่ง', icon:'fa-solid fa-bowling-ball', target:'จีบนิ้วบนลูกโป่งคำตอบ', kind:'tap'},
  {id:'star', name:'ชี้ดาวค้าง', icon:'fa-solid fa-star', target:'ชี้คำตอบค้าง 1 วินาที', kind:'dwell'},
  {id:'tap', name:'จีบนิ้วเลือก', icon:'fa-solid fa-hand-pointer', target:'ชี้คำตอบ แล้วจีบนิ้ว', kind:'tap'}
];

let chosenMode = 'mixed', activeMode = GAME_MODES[0];
let held = null, ghost = null, selected = null;
let dwellTarget = null, dwellSince = 0, dwellSlipTimer = null;
let pointerId = null, pointerStart = null, pointerMoved = false, suppressClick = false;
let suppressTimer, handTimer;

// DOM Setup
const modeBar = document.createElement('div');
modeBar.className = 'mode-bar';
modeBar.setAttribute('aria-label', 'เลือกรูปแบบเกม');
for (const mode of [{id:'mixed', name:'สลับเกม', icon:'fa-solid fa-shuffle'}, ...GAME_MODES]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mode-button ar-target';
  button.innerHTML = `<i class="${mode.icon}"></i> <span>${mode.name}</span>`;
  button.dataset.mode = mode.id;
  button.addEventListener('click', () => {
    if (isLocked) return;
    chosenMode = mode.id;
    configureRound(currentIndex);
  });
  modeBar.append(button);
}
document.querySelector('.question-box')?.after(modeBar);

const arena = document.querySelector('.ar-spacer');
const dropZone = document.createElement('button');
dropZone.type = 'button';
dropZone.className = 'drop-zone ar-target';
dropZone.addEventListener('click', () => {
  if (selected && !isLocked) {
    const button = selected;
    resetInteraction();
    submitChoice(button);
  }
});
arena?.append(dropZone);

const status = document.createElement('p');
status.className = 'interaction-status';
status.setAttribute('role', 'status');
document.querySelector('.answer-hint')?.before(status);

function configureRound(index) {
  resetInteraction();
  activeMode = GAME_MODES.find(m => m.id === chosenMode) || GAME_MODES[index % GAME_MODES.length];
  document.body.dataset.mode = activeMode.id;
  modeBar.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === chosenMode)));
  dropZone.hidden = activeMode.kind !== 'drag';
  dropZone.replaceChildren();

  const icon = document.createElement('i');
  icon.className = `target-icon ${activeMode.icon}`;

  const label = document.createElement('span');
  label.textContent = activeMode.target;
  dropZone.append(icon, label);

  const hintEl = document.querySelector('.answer-hint');
  if (hintEl) {
    hintEl.textContent = activeMode.kind === 'drag'
      ? 'จีบนิ้วค้างเพื่อหยิบ → ลาก → ปล่อยนิ้วในเป้าหมาย • หรือคลิกคำตอบแล้วคลิกเป้าหมาย'
      : activeMode.kind === 'dwell'
        ? 'ชี้คำตอบค้าง 1 วินาที หรือคลิกคำตอบ'
        : 'ชี้คำตอบแล้วจีบนิ้ว หรือคลิก / แตะคำตอบ';
  }

  status.innerHTML = `<i class="${activeMode.icon}"></i> <span>${activeMode.name}</span>`;
}

// Tactile Audio Synthesis for Interaction (Grab & Drop)
function playInteractionTone(type) {
  try {
    if (typeof ensureAudio === 'function') ensureAudio();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    if (type === 'grab') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(640, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'drop') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.09);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    }
  } catch (e) {}
}

// Forgiving Bounding Box Hit Test (with hysteresis and extra margin)
function containsPoint(el, x, y, extraPad = 0) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const isHovered = el.classList.contains('hovered');
  const pad = (isHovered ? 20 : 12) + extraPad;
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

function submitChoice(button) {
  if (isLocked) return;
  status.textContent = 'ส่งคำตอบแล้ว';
  button.classList.add('submitted');
  dropZone.classList.add('delivered');
  handleAnswer(button, button.dataset.choice);
}

function activateChoice(button) {
  if (isLocked || suppressClick) return;
  if (activeMode.kind !== 'drag') {
    submitChoice(button);
    return;
  }
  if (selected) selected.classList.remove('selected');
  selected = button;
  button.classList.add('selected');
  status.textContent = 'เลือกแล้ว! คลิกเป้าหมายเพื่อส่งคำตอบ หรือเลือกคำตอบใหม่';
}

function beginGrab(button, x, y) {
  if (isLocked) return;
  clearDwell();
  selected = null;
  document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
  held = button;
  button.classList.add('grabbed');

  ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = button.dataset.choice;
  document.body.append(ghost);

  playInteractionTone('grab');
  moveGrab(x, y);
  status.textContent = 'กำลังถือคำตอบ • ปล่อยนิ้วเมื่ออยู่ในเป้าหมาย';
}

function moveGrab(x, y) {
  if (!ghost) return;
  ghost.style.left = `${x}px`;
  ghost.style.top = `${y}px`;
  // Generous drop zone detection (extra 35px padding)
  dropZone.classList.toggle('ready', containsPoint(dropZone, x, y, 35));
}

function endGrab(x, y) {
  if (!held) return;
  const button = held;
  const valid = containsPoint(dropZone, x, y, 35);
  resetInteraction();
  if (valid) {
    playInteractionTone('drop');
    submitChoice(button);
  } else {
    status.textContent = 'ยังไม่ลงเป้าหมาย ลองหยิบใหม่ได้ ไม่เสียคะแนน';
  }
}

function clearDwell() {
  if (dwellTarget) dwellTarget.style.removeProperty('--dwell');
  dwellTarget = null;
  dwellSince = 0;
  if (dwellSlipTimer) {
    clearTimeout(dwellSlipTimer);
    dwellSlipTimer = null;
  }
}

function resetInteraction() {
  clearTimeout(handTimer);
  ghost?.remove();
  ghost = null;
  held = null;
  selected = null;
  clearDwell();
  document.querySelectorAll('.grabbed, .selected, .hovered').forEach(b => b.classList.remove('grabbed', 'selected', 'hovered'));
  dropZone.classList.remove('ready', 'delivered');
  pointerId = null;
  pointerStart = null;
}

function blockSyntheticClick() {
  suppressClick = true;
  clearTimeout(suppressTimer);
  suppressTimer = setTimeout(() => suppressClick = false, 150);
}

// Mouse / Touch pointer support
function bindPointerChoice(button) {
  button.addEventListener('pointerdown', event => {
    if (activeMode.kind !== 'drag' || isLocked || event.button !== 0) return;
    pointerId = event.pointerId;
    pointerStart = {x: event.clientX, y: event.clientY};
    pointerMoved = false;
    button.setPointerCapture(event.pointerId);
  });

  button.addEventListener('pointermove', event => {
    if (pointerId !== event.pointerId || !pointerStart) return;
    if (!pointerMoved && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8) {
      pointerMoved = true;
      beginGrab(button, event.clientX, event.clientY);
    }
    if (pointerMoved) moveGrab(event.clientX, event.clientY);
  });

  button.addEventListener('pointerup', event => {
    if (pointerId !== event.pointerId) return;
    if (pointerMoved) {
      blockSyntheticClick();
      endGrab(event.clientX, event.clientY);
    }
    pointerId = null;
    pointerStart = null;
  });

  button.addEventListener('pointercancel', () => {
    blockSyntheticClick();
    resetInteraction();
  });

  button.addEventListener('lostpointercapture', () => {
    if (held) {
      blockSyntheticClick();
      resetInteraction();
    }
  });
}

// Main Hand Coordinates & Pinch Action Processor
function processHand(x, y, pinch, previousPinch) {
  clearTimeout(handTimer);
  handTimer = setTimeout(() => {
    resetInteraction();
    wasPinching = true;
  }, 600);

  // If holding an answer in drag mode
  if (held) {
    moveGrab(x, y);
    if (!pinch) endGrab(x, y);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'HOVER_STATE',
        isHovering: containsPoint(dropZone, x, y, 35)
      }, location.origin);
    }
    return;
  }

  // Find hovered target among active interactive elements
  const targets = [...document.querySelectorAll('.view.active .ar-target, .mode-button.ar-target')].filter(el => !el.hidden && !el.disabled);
  const target = targets.find(el => containsPoint(el, x, y));
  targets.forEach(el => el.classList.toggle('hovered', el === target));

  // Report hover status to parent window for cursor blooming
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({
      type: 'HOVER_STATE',
      isHovering: Boolean(target)
    }, location.origin);
  }

  // When game is finished and restart button is displayed
  if (isLocked) {
    clearDwell();
    if (target?.id === 'btn-restart' && pinch && !previousPinch) {
      target.click();
    }
    return;
  }

  // Target is a Choice Button
  if (target?.classList.contains('choice-btn')) {
    if (activeMode.kind === 'drag' && pinch && !previousPinch) {
      beginGrab(target, x, y);
    } else if (activeMode.kind === 'dwell') {
      if (dwellSlipTimer) {
        clearTimeout(dwellSlipTimer);
        dwellSlipTimer = null;
      }
      if (dwellTarget !== target) {
        clearDwell();
        dwellTarget = target;
        dwellSince = performance.now();
      }
      const fraction = Math.min(1, (performance.now() - dwellSince) / 1000);
      target.style.setProperty('--dwell', `${fraction * 100}%`);
      if (fraction === 1) {
        clearDwell();
        submitChoice(target);
      }
    } else if (activeMode.kind === 'tap' && pinch && !previousPinch) {
      submitChoice(target);
    }
  } else {
    if (activeMode.kind === 'dwell' && dwellTarget && !dwellSlipTimer) {
      dwellSlipTimer = setTimeout(() => {
        clearDwell();
      }, 180);
    } else if (activeMode.kind !== 'dwell') {
      clearDwell();
    }

    if (target && pinch && !previousPinch) {
      target.click();
    }
  }
}

// Window Event Listeners
window.addEventListener('blur', resetInteraction);
window.addEventListener('resize', resetInteraction);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetInteraction();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    resetInteraction();
    status.textContent = 'ยกเลิกการหยิบแล้ว';
  }
});
