// public/script.js
const socket = io();

// DOM
const createBtn = document.getElementById('create-session');
const joinBtn = document.getElementById('join-session');
const sessionInput = document.getElementById('session-id-input');
const sessionDisplay = document.getElementById('session-display');

const phaseLabel = document.getElementById('phase-label');
const timeDisplay = document.getElementById('time-display');
const dotsEl = document.getElementById('dots');

const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const resetBtn = document.getElementById('reset-btn');

const workTotalEl = document.getElementById('work-total');
const breakTotalEl = document.getElementById('break-total');

const historyList = document.getElementById('history-list');
// New time update controls
const workMinutesInput = document.getElementById('work-minutes');
const breakMinutesInput = document.getElementById('break-minutes');
const updateTimesBtn = document.getElementById('update-times');

updateTimesBtn.addEventListener('click', () => {
  const newWork = parseInt(workMinutesInput.value, 10);
  const newBreak = parseInt(breakMinutesInput.value, 10);

  if (isNaN(newWork) || isNaN(newBreak) || newWork <= 0 || newBreak <= 0) {
    alert('Please enter valid positive numbers for both times.');
    return;
  }

  if (!currentSession) {
    alert('Create or join a session first.');
    return;
  }

  socket.emit('updateTimes', {
    sessionId: currentSession,
    workMinutes: newWork,
    breakMinutes: newBreak
  });
});


// state
let currentSession = null;
let isHost = false;

// helpers
function pad(n) { return String(n).padStart(2, '0'); }
function formatTime(sec) {
  if (typeof sec !== 'number') sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${pad(m)}:${pad(s)}`;
}

function renderDots(pomodoroCount) {
  const filled = pomodoroCount % 4;
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += (i < filled) ? '● ' : '○ ';
  }
  dotsEl.textContent = out.trim();
}

// local history stored per-day: { "YYYY-MM-DD": { workSeconds: X, breakSeconds: Y } }
function saveDailyHistory(state) {
  const today = new Date().toISOString().split('T')[0];
  const raw = localStorage.getItem('pomodoroHistory');
  const history = raw ? JSON.parse(raw) : {};
  history[today] = {
    workSeconds: state.workTimeTotal || 0,
    breakSeconds: state.breakTimeTotal || 0
  };
  localStorage.setItem('pomodoroHistory', JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const raw = localStorage.getItem('pomodoroHistory');
  if (!raw) {
    historyList.textContent = 'No history yet';
    return;
  }
  const history = JSON.parse(raw);
  const dates = Object.keys(history).sort((a, b) => b.localeCompare(a));
  if (dates.length === 0) {
    historyList.textContent = 'No history yet';
    return;
  }
  let out = '';
  for (const d of dates) {
    const w = Math.floor((history[d].workSeconds || 0) / 60);
    const br = Math.floor((history[d].breakSeconds || 0) / 60);
    out += `${d} — Work: ${w}m, Break: ${br}m\n`;
  }
  historyList.textContent = out;
}

// UI update from server state object
function updateUIFromState(state) {
  if (!state) return;
  timeDisplay.textContent = formatTime(state.timeLeft);
  phaseLabel.textContent = state.phase === 'work' ? 'Work' : (state.phase === 'shortBreak' ? 'Short Break' : 'Long Break');
  renderDots(state.pomodoroCount || 0);

  workTotalEl.textContent = Math.floor((state.workTimeTotal || 0) / 60);
  breakTotalEl.textContent = Math.floor((state.breakTimeTotal || 0) / 60);

  // update who is host
  isHost = (state.hostId === socket.id) || isHost; // keep true if we created session
  // enable/disable controls based on host and running flag
  startBtn.disabled = !(isHost && !state.running);
  pauseBtn.disabled = !(isHost && state.running);
  resetBtn.disabled = !isHost;

  saveDailyHistory(state);
}

// socket events
socket.on('connect', () => {
  // console.log('connected', socket.id);
});

socket.on('sessionCreated', ({ sessionId }) => {
  currentSession = sessionId;
  isHost = true;
  sessionDisplay.textContent = `Session: ${sessionId} (you are host)`;
  // enable controls (server will send state soon)
  startBtn.disabled = false;
  resetBtn.disabled = false;
  pauseBtn.disabled = true;
});

socket.on('sessionJoined', ({ sessionId, state }) => {
  currentSession = sessionId;
  isHost = (state.hostId === socket.id);
  sessionDisplay.textContent = `Session: ${sessionId}`;
  updateUIFromState(state);

  // Show time settings only if host
  const timeSettingsBox = document.getElementById('time-settings');
  if (timeSettingsBox) {
    timeSettingsBox.style.display = isHost ? 'block' : 'none';
  }
});


socket.on('timerUpdate', (state) => {
  // state has: timeLeft, phase, running, pomodoroCount, workTimeTotal, breakTimeTotal, hostId
  updateUIFromState(state);
});

socket.on('sessionError', ({ message }) => {
  alert('Session error: ' + (message || 'Unknown'));
});

socket.on('hostLeft', () => {
  alert('Host left the session. Controls disabled until a new host is set.');
  isHost = false;
  startBtn.disabled = true;
  pauseBtn.disabled = true;
  resetBtn.disabled = true;
});

socket.on('longBreakEnded', () => {
  // server stopped timer after long break
  alert('Long break finished. The timer is stopped. Host can start the next cycle.');
});

// UI handlers
createBtn.addEventListener('click', () => {
  socket.emit('createSession');
});

joinBtn.addEventListener('click', () => {
  const id = (sessionInput.value || '').trim().toUpperCase();
  if (!id) { alert('Enter session id'); return; }
  socket.emit('joinSession', id);
});

startBtn.addEventListener('click', () => {
  if (!currentSession) return alert('Create or join a session first');
  socket.emit('startTimer', { sessionId: currentSession });
});

pauseBtn.addEventListener('click', () => {
  if (!currentSession) return;
  socket.emit('pauseTimer', { sessionId: currentSession });
});

resetBtn.addEventListener('click', () => {
  if (!currentSession) return;
  socket.emit('resetTimer', { sessionId: currentSession });
});

// initial render
renderDots(0);
renderHistory();

document.getElementById('update-times-btn').addEventListener('click', () => {
  const work = parseInt(document.getElementById('work-mins').value);
  const shortBreak = parseInt(document.getElementById('short-break-mins').value);
  const longBreak = parseInt(document.getElementById('long-break-mins').value);

  socket.emit('updateTimes', {
    sessionId: currentSessionId,
    workMinutes: work,
    breakMinutes: shortBreak,
    longBreakMinutes: longBreak
  });
});
