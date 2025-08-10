// const socket = io();
// let sessionId = null;
// let isHost = false;

// // DOM elements
// const createBtn = document.getElementById('create-session');
// const joinBtn = document.getElementById('join-session');
// const sessionInput = document.getElementById('session-id-input');
// const sessionDisplay = document.getElementById('session-display');
// const startBtn = document.getElementById('start-btn');
// const pauseBtn = document.getElementById('pause-btn');
// const resetBtn = document.getElementById('reset-btn');
// const timeDisplay = document.getElementById('time-display');
// const phaseLabel = document.getElementById('phase-label');
// const workTotal = document.getElementById('work-total');
// const breakTotal = document.getElementById('break-total');
// const workMinutesInput = document.getElementById('work-minutes');
// const breakMinutesInput = document.getElementById('break-minutes');
// const longBreakMinutesInput = document.getElementById('long-break-minutes');
// const updateTimesBtn = document.getElementById('update-times');

// // Notification sound
// const sound = new Audio('notification.mp3');

// // Create session
// createBtn.addEventListener('click', () => {
//     socket.emit('createSession');
// });

// // Join session
// joinBtn.addEventListener('click', () => {
//     const id = sessionInput.value.trim().toUpperCase();
//     if (!id) return alert('Please enter a session ID');
//     socket.emit('joinSession', id);
// });

// // Timer controls
// startBtn.addEventListener('click', () => {
//     if (isHost) socket.emit('startTimer', { sessionId });
// });
// pauseBtn.addEventListener('click', () => {
//     if (isHost) socket.emit('pauseTimer', { sessionId });
// });
// resetBtn.addEventListener('click', () => {
//     if (isHost) socket.emit('resetTimer', { sessionId });
// });

// // Update times
// updateTimesBtn.addEventListener('click', () => {
//     if (!isHost) return alert('Only host can update times');
//     const workMinutes = parseInt(workMinutesInput.value);
//     const breakMinutes = parseInt(breakMinutesInput.value);
//     const longBreakMinutes = parseInt(longBreakMinutesInput.value);
//     socket.emit('updateTimes', { sessionId, workMinutes, breakMinutes, longBreakMinutes });
// });

// // Socket events
// socket.on('sessionCreated', ({ sessionId: id }) => {
//     sessionId = id;
//     isHost = true;
//     sessionDisplay.textContent = `Session: ${id}`;
//     enableControls();
// });

// socket.on('sessionJoined', ({ sessionId: id, state }) => {
//     sessionId = id;
//     isHost = false;
//     sessionDisplay.textContent = `Session: ${id}`;
//     updateUI(state);
// });

// socket.on('sessionError', ({ message }) => {
//     alert(message);
// });

// socket.on('timerUpdate', (state) => {
//     updateUI(state);
// });

// socket.on('phaseChange', (phase) => {
//     sound.play();
//     phaseLabel.textContent = formatPhase(phase);
// });

// socket.on('hostLeft', () => {
//     alert('Host has left the session.');
//     disableControls();
// });

// socket.on('longBreakEnded', () => {
//     alert('Long break ended. Session complete!');
// });

// // UI helpers
// function updateUI(state) {
//     const { phase, timeLeft, workTimeTotal: wTotal, breakTimeTotal: bTotal, settings } = state;
//     phaseLabel.textContent = formatPhase(phase);
//     timeDisplay.textContent = formatTime(timeLeft);
//     workTotal.textContent = Math.floor(wTotal / 60);
//     breakTotal.textContent = Math.floor(bTotal / 60);

//     if (isHost) {
//         startBtn.disabled = state.running;
//         pauseBtn.disabled = !state.running;
//         resetBtn.disabled = false;
//     } else {
//         startBtn.disabled = true;
//         pauseBtn.disabled = true;
//         resetBtn.disabled = true;
//     }

//     workMinutesInput.value = settings.workMinutes;
//     breakMinutesInput.value = settings.breakMinutes;
//     longBreakMinutesInput.value = settings.longBreakMinutes;
// }

// function enableControls() {
//     startBtn.disabled = false;
//     pauseBtn.disabled = true;
//     resetBtn.disabled = false;
// }

// function disableControls() {
//     startBtn.disabled = true;
//     pauseBtn.disabled = true;
//     resetBtn.disabled = true;
// }

// function formatPhase(phase) {
//     if (phase === 'work') return 'Work';
//     if (phase === 'shortBreak') return 'Short Break';
//     if (phase === 'longBreak') return 'Long Break';
//     return '';
// }

// function formatTime(seconds) {
//     const m = Math.floor(seconds / 60).toString().padStart(2, '0');
//     const s = (seconds % 60).toString().padStart(2, '0');
//     return `${m}:${s}`;
// }


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

const workMinutesInput = document.getElementById('work-minutes');
const breakMinutesInput = document.getElementById('break-minutes');
const longBreakMinutesInput = document.getElementById('long-break-minutes');
const updateTimesBtn = document.getElementById('update-times');

// audio element (from index.html)
const notificationAudio = document.getElementById('notification-sound');

let currentSession = null;
let isHost = false;
let lastPhase = null; // to detect phase changes locally if needed

function pad(n){ return String(n).padStart(2,'0'); }
function formatTime(sec){
  if (typeof sec !== 'number') sec = 0;
  const m = Math.floor(sec/60);
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

function renderHistory() {
  const raw = localStorage.getItem('pomodoroHistory');
  if (!raw) {
    historyList.textContent = 'No history yet';
    return;
  }
  const history = JSON.parse(raw);
  const dates = Object.keys(history).sort((a,b)=>b.localeCompare(a));
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

function updateUIFromState(state) {
  if (!state) return;
  // Notification sound if phase changed
  if (lastPhase !== null && lastPhase !== state.phase) {
    // we'll also play sound when server emits playSound, but keep this guard
    // attempt to play (some browsers block autoplay until user interacts)
    try { notificationAudio.play().catch(()=>{}); } catch(e){}
  }
  lastPhase = state.phase;

  timeDisplay.textContent = formatTime(state.timeLeft);
  phaseLabel.textContent = state.phase === 'work' ? 'Work' : (state.phase === 'shortBreak' ? 'Short Break' : 'Long Break');
  renderDots(state.pomodoroCount || 0);

  workTotalEl.textContent = Math.floor((state.workTimeTotal || 0) / 60);
  breakTotalEl.textContent = Math.floor((state.breakTimeTotal || 0) / 60);

  isHost = (state.hostId === socket.id);
  currentSession = currentSession || state.sessionId; // keep local

  // enable/disable controls
  startBtn.disabled = !(isHost && !state.running);
  pauseBtn.disabled = !(isHost && state.running);
  resetBtn.disabled = !isHost;

  // update input values from settings (so clients see current durations)
  if (state.settings) {
    workMinutesInput.value = state.settings.workMinutes;
    breakMinutesInput.value = state.settings.breakMinutes;
    longBreakMinutesInput.value = state.settings.longBreakMinutes;
  }

  saveDailyHistory(state);
}

// sockets
socket.on('connect', () => {
  console.log('connected', socket.id);
});

socket.on('sessionCreated', ({ sessionId }) => {
  currentSession = sessionId;
  isHost = true;
  sessionDisplay.textContent = `Session: ${sessionId} (you are host)`;
  // enable controls for host (start/reset)
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = false;
});

socket.on('sessionJoined', ({ sessionId, state }) => {
  currentSession = sessionId;
  isHost = (state.hostId === socket.id);
  sessionDisplay.textContent = `Session: ${sessionId}` + (isHost ? ' (you are host)' : '');
  updateUIFromState(state);
});

socket.on('timerUpdate', (state) => {
  // state carries settings too
  updateUIFromState(state);
});

socket.on('playSound', ({ type }) => {
  // try to play the audio element (one file). If you want different sounds per type,
  // replace logic to choose different audio sources or multiple <audio> elements.
  try {
    notificationAudio.currentTime = 0;
    notificationAudio.play().catch(()=>{});
  } catch(e){}
});

socket.on('sessionError', ({ message }) => {
  alert('Session error: ' + (message || 'Unknown'));
});

socket.on('hostLeft', ({ newHostId }) => {
  alert('Host left the session. Host transferred (or null). Controls disabled for non-hosts.');
  // UI will be updated when a timerUpdate arrives; for safety disable controls
  startBtn.disabled = true;
  pauseBtn.disabled = true;
  resetBtn.disabled = true;
});

socket.on('longBreakEnded', () => {
  alert('Long break finished. The cycle is paused (host can start next).');
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

updateTimesBtn.addEventListener('click', () => {
  const newWork = parseInt(workMinutesInput.value, 10);
  const newBreak = parseInt(breakMinutesInput.value, 10);
  const newLongBreak = parseInt(longBreakMinutesInput.value, 10);

  if (!currentSession) { alert('Create or join a session first.'); return; }
  if (!isHost) { alert('Only host can update times.'); return; }

  if (isNaN(newWork) || isNaN(newBreak) || isNaN(newLongBreak) || newWork <= 0 || newBreak <= 0 || newLongBreak <= 0) {
    alert('Please enter valid positive numbers for all times.');
    return;
  }

  socket.emit('updateTimes', { sessionId: currentSession, workMinutes: newWork, breakMinutes: newBreak, longBreakMinutes: newLongBreak });
});

// initial small render
renderDots(0);
renderHistory();
