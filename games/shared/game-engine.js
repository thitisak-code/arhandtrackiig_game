// ==========================================
// AR Math Game Engine: 2-Minute Timer & Scoring (+10 / -10)
// ==========================================

const TOTAL_TIME_SECONDS = 120; // 2 Minutes Countdown
let timeRemaining = TOTAL_TIME_SECONDS;
let timerInterval = null;

let currentIndex = 0;
let score = 0;
let correctCount = 0;
let wrongCount = 0;
let isLocked = false;
let wasPinching = false;
let gameStartTime = 0;

// High-Fidelity Web Audio Synthesizer
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function ensureAudio() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// Sound: Answer Tone (Correct +10 / Wrong -10)
function playTone(isCorrect) {
    ensureAudio();
    const now = audioCtx.currentTime;

    if (isCorrect) {
        // Bright Harmonic Chime (Ascending Major Triad: E5 -> G#5 -> B5 -> E6)
        const notes = [659.25, 830.61, 987.77, 1318.51];
        notes.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.05);

            gain.gain.setValueAtTime(0, now + idx * 0.05);
            gain.gain.linearRampToValueAtTime(0.22 / (idx + 1), now + idx * 0.05 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.38);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start(now + idx * 0.05);
            osc.stop(now + idx * 0.05 + 0.38);
        });
    } else {
        // Low Descending Sawtooth Thud (-10)
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(175, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.28);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(450, now);
        filter.frequency.linearRampToValueAtTime(150, now + 0.28);

        gain.gain.setValueAtTime(0.28, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.3);
    }
}

// Sound: 10-Second Warning Tick-Tock
function playTickTone(isUrgent) {
    ensureAudio();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isUrgent ? 1100 : 880, now);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.04);
}

// Sound: Fanfare on Stage Completion or Timeout
function playFanfare(isWin) {
    ensureAudio();
    const now = audioCtx.currentTime;

    if (isWin) {
        // Triumphant Victory Chords
        const chordNotes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        chordNotes.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.08);

            gain.gain.setValueAtTime(0.2, now + idx * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.7);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start(now + idx * 0.08);
            osc.stop(now + idx * 0.08 + 0.7);
        });
    } else {
        // Time's up chime
        const notes = [440, 392, 349.23];
        notes.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.14);
            gain.gain.setValueAtTime(0.2, now + idx * 0.14);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.45);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now + idx * 0.14);
            osc.stop(now + idx * 0.14 + 0.45);
        });
    }
}

// Floating Score Animation (+10 / -10)
function spawnFloatingScore(text, isPositive, anchorEl) {
    const badge = document.createElement('div');
    badge.className = `floating-score ${isPositive ? 'plus' : 'minus'}`;
    badge.textContent = text;

    let posX = window.innerWidth / 2;
    let posY = window.innerHeight / 2;

    if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        posX = rect.left + rect.width / 2;
        posY = rect.top + rect.height / 3;
    } else {
        const scoreBadge = document.getElementById('score-badge');
        if (scoreBadge) {
            const rect = scoreBadge.getBoundingClientRect();
            posX = rect.left + rect.width / 2;
            posY = rect.bottom + 10;
        }
    }

    badge.style.left = `${posX}px`;
    badge.style.top = `${posY}px`;
    document.body.appendChild(badge);

    setTimeout(() => {
        badge.remove();
    }, 950);
}

function shuffleArray(arr) {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function showToast(text, isCorrect) {
    const toast = document.getElementById('feedback-toast');
    if (!toast) return;
    toast.textContent = text;
    toast.className = `show ${isCorrect ? 'correct' : 'wrong'}`;
    setTimeout(() => {
        toast.className = '';
    }, 950);
}

// 2-Minute Timer Controller
function updateTimerUI() {
    const timerVal = document.getElementById('timer-val');
    const timerBarFill = document.getElementById('timer-bar-fill');
    const timerBadge = document.getElementById('timer-badge');

    const mins = Math.floor(timeRemaining / 60).toString().padStart(2, '0');
    const secs = (timeRemaining % 60).toString().padStart(2, '0');

    if (timerVal) {
        timerVal.textContent = `${mins}:${secs}`;
    }

    if (timerBarFill) {
        const percentage = Math.max(0, (timeRemaining / TOTAL_TIME_SECONDS) * 100);
        timerBarFill.style.width = `${percentage}%`;
    }

    if (timerBadge) {
        if (timeRemaining <= 10) {
            timerBadge.classList.add('urgent');
            timerBadge.classList.remove('warning');
        } else if (timeRemaining <= 30) {
            timerBadge.classList.add('warning');
            timerBadge.classList.remove('urgent');
        } else {
            timerBadge.classList.remove('warning', 'urgent');
        }
    }
}

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timeRemaining = TOTAL_TIME_SECONDS;
    updateTimerUI();

    timerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerUI();

        if (timeRemaining <= 10 && timeRemaining > 0) {
            playTickTone(true);
        } else if (timeRemaining === 30 || timeRemaining === 20) {
            playTickTone(false);
        }

        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            timeOutGame();
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// Initialize & Start Game
function startGame() {
    resetInteraction();
    score = 0;
    correctCount = 0;
    wrongCount = 0;
    currentIndex = 0;
    gameStartTime = Date.now();

    const scoreVal = document.getElementById('score-val');
    if (scoreVal) scoreVal.textContent = score;

    document.getElementById('result-view')?.classList.remove('active');
    document.getElementById('play-view')?.classList.add('active');

    startTimer();
    renderQuestion();
}

function renderQuestion() {
    resetInteraction();
    isLocked = false;
    const item = GAME_QUESTIONS[currentIndex];

    const progressBadge = document.getElementById('progress-badge');
    if (progressBadge) {
        progressBadge.textContent = `ข้อ ${currentIndex + 1} / ${GAME_QUESTIONS.length}`;
    }

    const qCatLabel = document.getElementById('q-cat-label');
    if (qCatLabel) qCatLabel.textContent = STAGE_TITLE;

    const qTextLabel = document.getElementById('q-text-label');
    if (qTextLabel) qTextLabel.textContent = item.q;

    const container = document.getElementById('choices-container');
    if (container) {
        container.innerHTML = '';
        shuffleArray(item.choices).forEach((choiceText, index) => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn ar-target';
            btn.type = 'button';

            const key = document.createElement('span');
            key.className = 'choice-key';
            key.textContent = index === 0 ? 'ก' : 'ข';
            key.setAttribute('aria-hidden', 'true');

            const label = document.createElement('span');
            label.className = 'choice-label';
            label.textContent = choiceText;

            btn.append(key, label);
            btn.dataset.choice = choiceText;

            btn.addEventListener('click', () => activateChoice(btn));
            bindPointerChoice(btn);
            container.appendChild(btn);
        });
    }

    configureRound(currentIndex);
}

// Process Player Choice (+10 / -10)
function handleAnswer(btnElement, selectedText) {
    if (isLocked) return;
    isLocked = true;
    document.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);

    const item = GAME_QUESTIONS[currentIndex];
    const isCorrect = (selectedText === item.ans);

    if (isCorrect) {
        score += 10;
        correctCount++;
        btnElement.classList.add('correct-ans');
        spawnFloatingScore('+10', true, btnElement);
        showToast('ถูกต้อง! +10 คะแนน 🌟', true);
        playTone(true);
    } else {
        score -= 10;
        wrongCount++;
        btnElement.classList.add('wrong-ans');
        spawnFloatingScore('-10', false, btnElement);
        document.querySelectorAll('.choice-btn').forEach(b => {
            if (b.dataset.choice === item.ans) b.classList.add('correct-ans');
        });
        showToast('ตอบผิด! -10 คะแนน 💥', false);
        playTone(false);
    }

    // Update Score Display with Pulse
    const scoreVal = document.getElementById('score-val');
    if (scoreVal) {
        scoreVal.textContent = score;
        scoreVal.parentElement.classList.add('score-pop');
        setTimeout(() => scoreVal.parentElement.classList.remove('score-pop'), 300);
    }

    setTimeout(() => {
        currentIndex++;
        if (currentIndex < GAME_QUESTIONS.length && timeRemaining > 0) {
            renderQuestion();
        } else {
            endGame(false);
        }
    }, 1100);
}

// Time Ran Out Handler
function timeOutGame() {
    if (isLocked) return;
    isLocked = true;
    document.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);

    showToast('⏰ หมดเวลา 2 นาที!', false);
    playFanfare(false);

    setTimeout(() => {
        endGame(true);
    }, 1000);
}

// Final Game Summary Display
function endGame(isTimedOut) {
    stopTimer();
    resetInteraction();
    isLocked = true;

    document.getElementById('play-view')?.classList.remove('active');
    const resultView = document.getElementById('result-view');
    if (!resultView) return;
    resultView.classList.add('active');

    // Time calculations
    const timeSpentSeconds = TOTAL_TIME_SECONDS - timeRemaining;
    const spentMins = Math.floor(timeSpentSeconds / 60);
    const spentSecs = timeSpentSeconds % 60;
    const timeFormatted = `${spentMins} นาที ${spentSecs} วินาที`;

    // Accuracy Calculation
    const totalAnswered = correctCount + wrongCount;
    const accuracy = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

    // Elements Population
    const finalScoreVal = document.getElementById('final-score-val');
    if (finalScoreVal) {
        finalScoreVal.textContent = `${score > 0 ? '+' : ''}${score}`;
    }

    const resultTitle = document.getElementById('result-title');
    if (resultTitle) {
        resultTitle.textContent = isTimedOut ? '⏰ หมดเวลา 2 นาที!' : '🏆 พิชิตด่านสำเร็จ!';
    }

    const resultSubtitle = document.getElementById('result-subtitle');
    if (resultSubtitle) {
        resultSubtitle.textContent = isTimedOut
            ? `สรุปคะแนนในเวลา 2 นาที ตอบไปได้ ${totalAnswered} ข้อ`
            : `ตอบครบทุกข้อได้อย่างยอดเยี่ยม!`;
    }

    // Detailed Stats
    const statTime = document.getElementById('stat-time');
    if (statTime) statTime.textContent = timeFormatted;

    const statCorrect = document.getElementById('stat-correct');
    if (statCorrect) statCorrect.textContent = `${correctCount} ข้อ`;

    const statWrong = document.getElementById('stat-wrong');
    if (statWrong) statWrong.textContent = `${wrongCount} ข้อ`;

    const statAccuracy = document.getElementById('stat-accuracy');
    if (statAccuracy) statAccuracy.textContent = `${accuracy}%`;

    // Dynamic Rank Rating
    const scoreGrade = document.getElementById('score-grade');
    if (scoreGrade) {
        if (score >= 80) {
            scoreGrade.textContent = '🌟 ระดับ: อัจฉริยะคณิตศาสตร์!';
            scoreGrade.className = 'score-grade-pill master';
        } else if (score >= 50) {
            scoreGrade.textContent = '✨ ระดับ: ยอดเยี่ยมมาก!';
            scoreGrade.className = 'score-grade-pill expert';
        } else if (score >= 20) {
            scoreGrade.textContent = '👍 ระดับ: ผ่านเกณฑ์ได้ดี!';
            scoreGrade.className = 'score-grade-pill skilled';
        } else {
            scoreGrade.textContent = '💪 ระดับ: ฝึกฝนอีกนิด พิชิตได้แน่นอน!';
            scoreGrade.className = 'score-grade-pill rookie';
        }
    }

    playFanfare(score >= 50);
}

// Receive hand coordinates from hub.js via postMessage
window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    if (event.data?.type === 'HAND_LOST') {
        resetInteraction();
        wasPinching = true;
        return;
    }
    if (event.data?.type !== 'HAND_DATA') return;
    const { x, y, isPinching } = event.data;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    processHand(x, y, isPinching, wasPinching);
    wasPinching = isPinching;
});

// Event Listeners
document.getElementById('btn-restart')?.addEventListener('click', startGame);
window.addEventListener('DOMContentLoaded', startGame);
window.addEventListener('beforeunload', stopTimer);
