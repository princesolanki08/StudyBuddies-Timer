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

// sessions store: per-session settings and timer state
const sessions = {}; // { sessionId: { hostId, phase, timeLeft, running, pomodoroCount, workTimeTotal, breakTimeTotal, timerRef, settings } }

function makeId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function emitState(sessionId) {
  const s = sessions[sessionId];
  if (!s) return;
  // send a clean state object
  io.to(sessionId).emit('timerUpdate', {
    timeLeft: s.timeLeft,
    phase: s.phase,
    running: s.running,
    pomodoroCount: s.pomodoroCount,
    workTimeTotal: s.workTimeTotal,
    breakTimeTotal: s.breakTimeTotal,
    hostId: s.hostId,
    settings: s.settings
  });
}

function startSessionTimer(sessionId) {
  const s = sessions[sessionId];
  if (!s || s.running) return;
  s.running = true;

  if (s.timerRef) clearInterval(s.timerRef);
  s.timerRef = setInterval(() => {
    if (s.timeLeft > 0) {
      s.timeLeft = s.timeLeft - 1;
      if (s.phase === 'work') s.workTimeTotal++;
      else s.breakTimeTotal++;
    }

    if (s.timeLeft <= 0) {
      // phase finished -> switch
      if (s.phase === 'work') {
        s.pomodoroCount++;
        // decide short or long break
        if (s.pomodoroCount % 4 === 0) {
          s.phase = 'longBreak';
          s.timeLeft = s.settings.longBreakMinutes * 60;
          io.to(sessionId).emit('playSound', { type: 'longBreak' });
        } else {
          s.phase = 'shortBreak';
          s.timeLeft = s.settings.breakMinutes * 60;
          io.to(sessionId).emit('playSound', { type: 'shortBreak' });
        }
      } else if (s.phase === 'shortBreak') {
        s.phase = 'work';
        s.timeLeft = s.settings.workMinutes * 60;
        io.to(sessionId).emit('playSound', { type: 'work' });
      } else if (s.phase === 'longBreak') {
        // After long break: stop and reset to work-phase (per preference)
        s.phase = 'work';
        s.timeLeft = s.settings.workMinutes * 60;
        s.running = false;
        if (s.timerRef) {
          clearInterval(s.timerRef);
          s.timerRef = null;
        }
        io.to(sessionId).emit('playSound', { type: 'sessionEnd' });
        emitState(sessionId);
        io.to(sessionId).emit('longBreakEnded');
        return;
      }
    }

    emitState(sessionId);
  }, 1000);

  emitState(sessionId);
}

function pauseSessionTimer(sessionId) {
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
  s.timeLeft = s.settings.workMinutes * 60;
  s.running = false;
  s.pomodoroCount = 0;
  s.workTimeTotal = 0;
  s.breakTimeTotal = 0;
  emitState(sessionId);
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('createSession', () => {
    const sessionId = makeId();
    sessions[sessionId] = {
      hostId: socket.id,
      phase: 'work',
      timeLeft: 25 * 60,
      running: false,
      pomodoroCount: 0,
      workTimeTotal: 0,
      breakTimeTotal: 0,
      timerRef: null,
      settings: { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15 }
    };
    socket.join(sessionId);
    socket.emit('sessionCreated', { sessionId });
    emitState(sessionId);
    console.log(`Session ${sessionId} created by ${socket.id}`);
  });

  socket.on('joinSession', (sessionId) => {
    const s = sessions[sessionId];
    if (!s) {
      socket.emit('sessionError', { message: 'Session not found' });
      return;
    }
    socket.join(sessionId);
    // inform the joiner with current state
    socket.emit('sessionJoined', { sessionId, state: {
      timeLeft: s.timeLeft, phase: s.phase, running: s.running,
      pomodoroCount: s.pomodoroCount, workTimeTotal: s.workTimeTotal,
      breakTimeTotal: s.breakTimeTotal, hostId: s.hostId, settings: s.settings
    }});
    // broadcast current state to room too (so UI for everyone consistent)
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
    pauseSessionTimer(sessionId);
    console.log(`Host ${socket.id} paused timer for ${sessionId}`);
  });

  socket.on('resetTimer', ({ sessionId }) => {
    const s = sessions[sessionId];
    if (!s) return socket.emit('sessionError', { message: 'Session not found' });
    if (socket.id !== s.hostId) return socket.emit('sessionError', { message: 'Only host can reset' });
    resetSession(sessionId);
    console.log(`Host ${socket.id} reset session ${sessionId}`);
  });

  socket.on('updateTimes', ({ sessionId, workMinutes, breakMinutes, longBreakMinutes }) => {
    const s = sessions[sessionId];
    if (!s) return socket.emit('sessionError', { message: 'Session not found' });
    if (socket.id !== s.hostId) return socket.emit('sessionError', { message: 'Only host can update times' });

    // Validate numeric inputs
    workMinutes = Math.max(1, parseInt(workMinutes, 10) || s.settings.workMinutes);
    breakMinutes = Math.max(1, parseInt(breakMinutes, 10) || s.settings.breakMinutes);
    longBreakMinutes = Math.max(1, parseInt(longBreakMinutes, 10) || s.settings.longBreakMinutes);

    s.settings = { workMinutes, breakMinutes, longBreakMinutes };

    // If timer is not running, adjust timeLeft to match current phase
    if (!s.running) {
      if (s.phase === 'work') s.timeLeft = workMinutes * 60;
      else if (s.phase === 'shortBreak') s.timeLeft = breakMinutes * 60;
      else if (s.phase === 'longBreak') s.timeLeft = longBreakMinutes * 60;
    }

    emitState(sessionId);
    console.log(`Host ${socket.id} updated times for ${sessionId}:`, s.settings);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    // If disconnected was host, try to assign a new host from room members
    Object.keys(sessions).forEach((sid) => {
      const s = sessions[sid];
      if (s.hostId === socket.id) {
        // find another socket in the room
        const room = io.sockets.adapter.rooms.get(sid); // Set of socket ids
        let newHost = null;
        if (room && room.size > 0) {
          for (const sidInRoom of room) {
            if (sidInRoom !== socket.id) {
              newHost = sidInRoom;
              break;
            }
          }
        }
        s.hostId = newHost;
        io.to(sid).emit('hostLeft', { newHostId: newHost });
        // stop running timer when host leaves to avoid uncontrolled state
        if (s.timerRef) {
          clearInterval(s.timerRef);
          s.timerRef = null;
          s.running = false;
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
