// server.js (CommonJS)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

const DURATIONS = {
  work: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 30 * 60,
};

const sessions = {}; // sessionId -> session object

function makeId() {
  return crypto.randomBytes(3).toString('hex'); // 6 chars
}

function emitState(sessionId) {
  const s = sessions[sessionId];
  if (!s) return;
  io.to(sessionId).emit('timerUpdate', {
    timeLeft: s.timeLeft,
    phase: s.phase,
    running: s.running,
    pomodoroCount: s.pomodoroCount,
    workTimeTotal: s.workTimeTotal,
    breakTimeTotal: s.breakTimeTotal,
    hostId: s.hostId,
  });
}

function startSessionTimer(sessionId) {
  const s = sessions[sessionId];
  if (!s || s.running) return;
  s.running = true;

  if (s.timerRef) clearInterval(s.timerRef);
  s.timerRef = setInterval(() => {
    // tick
    s.timeLeft = Math.max(0, s.timeLeft - 1);

    // accumulate totals (1 second)
    if (s.phase === 'work') s.workTimeTotal++;
    else s.breakTimeTotal++;

    // finished this phase?
    if (s.timeLeft <= 0) {
      if (s.phase === 'work') {
        s.pomodoroCount++;
        // after 4 pomodoros -> long break
        if (s.pomodoroCount % 4 === 0) {
          s.phase = 'longBreak';
          s.timeLeft = DURATIONS.longBreak;
        } else {
          s.phase = 'shortBreak';
          s.timeLeft = DURATIONS.shortBreak;
        }
      } else if (s.phase === 'shortBreak') {
        s.phase = 'work';
        s.timeLeft = DURATIONS.work;
      } else if (s.phase === 'longBreak') {
        // stop after long break
        s.running = false;
        clearInterval(s.timerRef);
        s.timerRef = null;
        // Reset phase to work and set timeLeft to work length (but do not start)
        s.phase = 'work';
        s.timeLeft = DURATIONS.work;
        io.to(sessionId).emit('longBreakEnded');
        emitState(sessionId);
        return;
      }
    }

    emitState(sessionId);
  }, 1000);

  emitState(sessionId);
}

function stopSessionTimer(sessionId) {
  const s = sessions[sessionId];
  if (!s) return;
  s.running = false;
  if (s.timerRef) {
    clearInterval(s.timerRef);
    s.timerRef = null;
  }
  emitState(sessionId);
}

function resetSession(sessionId) {
  const s = sessions[sessionId];
  if (!s) return;
  if (s.timerRef) {
    clearInterval(s.timerRef);
    s.timerRef = null;
  }
  s.phase = 'work';
  s.timeLeft = DURATIONS.work;
  s.running = false;
  s.pomodoroCount = 0;
  s.workTimeTotal = 0;
  s.breakTimeTotal = 0;
  emitState(sessionId);
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('createSession', () => {
    const sessionId = makeId().toUpperCase();
    sessions[sessionId] = {
      hostId: socket.id,
      timeLeft: DURATIONS.work,
      phase: 'work',
      running: false,
      pomodoroCount: 0,
      workTimeTotal: 0,
      breakTimeTotal: 0,
      timerRef: null,
    };
    socket.join(sessionId);
    socket.emit('sessionCreated', { sessionId });
    emitState(sessionId);
    console.log(`Session created ${sessionId} by ${socket.id}`);
  });

  socket.on('joinSession', (sessionId) => {
    const s = sessions[sessionId];
    if (!s) {
      socket.emit('sessionError', { message: 'Session not found' });
      return;
    }
    socket.join(sessionId);
    socket.emit('sessionJoined', {
      sessionId,
      state: {
        timeLeft: s.timeLeft,
        phase: s.phase,
        running: s.running,
        pomodoroCount: s.pomodoroCount,
        workTimeTotal: s.workTimeTotal,
        breakTimeTotal: s.breakTimeTotal,
        hostId: s.hostId,
      },
    });
    // Also send current state to the room (so new client sees same)
    emitState(sessionId);
    console.log(`Socket ${socket.id} joined ${sessionId}`);
  });

  socket.on('startTimer', ({ sessionId }) => {
    const s = sessions[sessionId];
    if (!s) return socket.emit('sessionError', { message: 'Session not found' });
    if (socket.id !== s.hostId) return socket.emit('sessionError', { message: 'Only host can start' });
    if (s.running) return;
    startSessionTimer(sessionId);
    console.log(`Host ${socket.id} started timer for ${sessionId}`);
  });

  socket.on('pauseTimer', ({ sessionId }) => {
    const s = sessions[sessionId];
    if (!s) return socket.emit('sessionError', { message: 'Session not found' });
    if (socket.id !== s.hostId) return socket.emit('sessionError', { message: 'Only host can pause' });
    stopSessionTimer(sessionId);
    console.log(`Host ${socket.id} paused timer for ${sessionId}`);
  });

  socket.on('resetTimer', ({ sessionId }) => {
    const s = sessions[sessionId];
    if (!s) return socket.emit('sessionError', { message: 'Session not found' });
    if (socket.id !== s.hostId) return socket.emit('sessionError', { message: 'Only host can reset' });
    resetSession(sessionId);
    console.log(`Host ${socket.id} reset session ${sessionId}`);
  });

  socket.on('updateTimes', ({ sessionId, workMinutes, breakMinutes }) => {
  const s = sessions[sessionId];
  if (!s) return socket.emit('sessionError', { message: 'Session not found' });
  if (socket.id !== s.hostId) return socket.emit('sessionError', { message: 'Only host can update times' });

  // Update durations in seconds
  DURATIONS.work = workMinutes * 60;
  DURATIONS.shortBreak = breakMinutes * 60;

  // If we're not running, reset timeLeft to new work duration
  if (!s.running && s.phase === 'work') {
    s.timeLeft = DURATIONS.work;
  } else if (!s.running && s.phase === 'shortBreak') {
    s.timeLeft = DURATIONS.shortBreak;
  }

  emitState(sessionId);
  console.log(`Host ${socket.id} updated times for ${sessionId}: Work=${workMinutes}m Break=${breakMinutes}m`);
});


  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    // Mark host as null if host left
    Object.keys(sessions).forEach((sid) => {
      const s = sessions[sid];
      if (s.hostId === socket.id) {
        s.hostId = null;
        io.to(sid).emit('hostLeft');
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server listening on port', PORT);
});
