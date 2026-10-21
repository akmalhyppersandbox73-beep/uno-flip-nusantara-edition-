'use strict';
/* SERVER UNO FLIP NUSANTARA: room, game (pakai engine.js yang sama), chat, signaling suara. */
const path = require('path'), http = require('http'), crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Game } = require('./engine.js');

const PORT = +process.env.PORT || 3000;
const MAX_PLAYERS = Math.min(4, +process.env.MAX_PLAYERS || 4);
const CORS = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
const GRACE_MS = 45000; // waktu menunggu pemain terputus sebelum dikeluarkan
const ICE = [{ urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',') }];
if (process.env.TURN_URL) ICE.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });

const app = express();
app.disable('x-powered-by');
// Hanya file frontend yang dilayani (server.js dan .env TIDAK pernah ikut terkirim)
const FILES = ['index.html', 'style.css', 'engine.js', 'game.js', 'net.js', 'config.js'];
app.get('/', (q, s) => s.sendFile(path.join(__dirname, 'index.html')));
FILES.forEach(f => app.get('/' + f, (q, s) => s.sendFile(path.join(__dirname, f))));
app.get('/health', (q, s) => s.json({ ok: true, rooms: rooms.size, uptime: process.uptime() | 0 }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS.includes('*') ? true : CORS }, maxHttpBufferSize: 2e4 });

/* ---------- Util ---------- */
const rooms = new Map();
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => { let c; do { c = Array.from({ length: 5 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join(''); } while (rooms.has(c)); return c; };
const rnd = n => crypto.randomBytes(n).toString('hex');
const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f<>&"'`\\/]/g, '').trim().slice(0, 12) || 'Pemain';
const cleanText = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const cleanAv = a => (Number.isInteger(a) && a >= 0 && a <= 5 ? a : 0);
const byPid = (room, pid) => room.players.find(p => p.pid === pid);
const sys = (room, text) => io.to(room.code).emit('chat', { sys: true, text, t: Date.now() });

function allow(socket) { // batas frekuensi: burst 10, isi ulang 5/detik
  const now = Date.now(), b = socket.data.b || (socket.data.b = { t: 10, l: now });
  b.t = Math.min(10, b.t + (now - b.l) / 200); b.l = now;
  if (b.t < 1) return false; b.t -= 1; return true;
}
function on(socket, ev, fn) {
  socket.on(ev, (d, cb) => {
    if (typeof cb !== 'function') cb = r => { if (r && r.ok === false) socket.emit('err', r.error); };
    if (!allow(socket)) return cb({ ok: false, error: 'Terlalu cepat, pelan-pelan ya' });
    try { fn(d && typeof d === 'object' ? d : {}, cb); }
    catch (e) { console.error('[error]', ev, e.message); cb({ ok: false, error: 'Terjadi kesalahan di server' }); }
  });
}
function ctx(socket) {
  const room = rooms.get(socket.data.code);
  const player = room && room.players.find(p => p.pid === socket.data.pid && p.sid === socket.id);
  return player ? { room, player } : null;
}

/* ---------- State per pemain (tangan lawan TIDAK dikirim) ---------- */
function view(room, pid) {
  const g = room.game, seat = room.seats.indexOf(pid);
  const v = {
    code: room.code, phase: room.phase, host: room.host, you: pid,
    players: room.players.map(p => ({ pid: p.pid, name: p.name, av: p.av, connected: p.connected }))
  };
  if (g && seat >= 0 && room.phase !== 'lobby') {
    const n = g.p.length, myTurn = g.cur === seat && g.winner < 0;
    v.gv = {
      players: Array.from({ length: n }, (_, k) => {
        const j = (seat + k) % n, pl = byPid(room, room.seats[j]) || {};
        return { pid: pl.pid, name: pl.name || '?', av: pl.av || 0, count: g.p[j].hand.length, connected: pl.connected !== false };
      }),
      cur: (g.cur - seat + n) % n, winner: g.winner < 0 ? -1 : (g.winner - seat + n) % n,
      side: g.side, color: g.color, dir: g.dir, top: g.top(), hand: g.p[seat].hand,
      legal: myTurn ? g.legal(seat).map(c => c.id) : [], drawn: myTurn && g.drawn ? g.drawn.id : null,
      uno: g.p[seat].uno, log: g.log, left: g.draw.length
    };
  }
  return v;
}
function broadcast(room) {
  for (const p of room.players) if (p.connected && p.sid) io.to(p.sid).emit('state', view(room, p.pid));
}

/* ---------- Room & pemain ---------- */
function addPlayer(room, d) {
  const base = cleanName(d.name); let name = base, k = 1;
  while (room.players.some(p => p.name === name)) name = base.slice(0, 10) + (++k);
  const p = { pid: rnd(6), token: rnd(24), name, av: cleanAv(d.av), sid: null, connected: false, timer: null };
  room.players.push(p); return p;
}
function attach(socket, room, p) {
  clearTimeout(p.timer); p.sid = socket.id; p.connected = true;
  socket.join(room.code); socket.data.code = room.code; socket.data.pid = p.pid;
}
function dropFromGame(g, idx) { // pemain keluar saat pertandingan berjalan
  const wasCur = g.cur === idx;
  g.draw.unshift(...g.p[idx].hand); g.p.splice(idx, 1);
  if (g.p.length < 2) { g.winner = 0; g.log = 'Pemain lain keluar. Kamu menang!'; return; }
  if (idx < g.cur) g.cur--;
  else if (wasCur) { g.drawn = null; g.cur = g.dir === 1 ? idx % g.p.length : (idx - 1 + g.p.length) % g.p.length; }
  g.log = 'Seorang pemain keluar dari pertandingan';
}
function removePlayer(room, pid) {
  if (!rooms.has(room.code)) return;
  const p = byPid(room, pid); if (!p) return;
  clearTimeout(p.timer); room.players = room.players.filter(x => x !== p);
  if (p.sid) io.in(p.sid).socketsLeave(room.code);
  if (room.voice.delete(pid)) io.to(room.code).emit('voice:left', { pid });
  const seat = room.seats.indexOf(pid);
  if (seat >= 0) {
    if (room.phase === 'play') { dropFromGame(room.game, seat); room.seats.splice(seat, 1); if (room.game.winner >= 0) room.phase = 'end'; }
    else { room.phase = 'lobby'; room.game = null; room.seats = []; }
  }
  if (!room.players.length) { rooms.delete(room.code); return; }
  if (room.host === pid) room.host = room.players[0].pid;
  sys(room, p.name + ' keluar'); broadcast(room);
}
const session = (room, p) => ({ code: room.code, pid: p.pid, token: p.token });

/* ---------- Socket.IO ---------- */
io.on('connection', socket => {
  on(socket, 'room:create', (d, cb) => {
    const old = ctx(socket); if (old) removePlayer(old.room, old.player.pid);
    if (rooms.size >= 500) return cb({ ok: false, error: 'Server penuh, coba lagi nanti' });
    const room = { code: newCode(), host: null, players: [], seats: [], game: null, phase: 'lobby', voice: new Set() };
    rooms.set(room.code, room);
    const p = addPlayer(room, d); room.host = p.pid; attach(socket, room, p);
    cb({ ok: true, session: session(room, p), ice: ICE }); broadcast(room);
  });

  on(socket, 'room:join', (d, cb) => {
    const code = String(d.code || '').toUpperCase();
    if (!/^[A-Z2-9]{5}$/.test(code)) return cb({ ok: false, error: 'Kode room harus 5 huruf/angka' });
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: 'Room tidak ditemukan' });
    if (room.phase === 'play') return cb({ ok: false, error: 'Pertandingan sudah dimulai' });
    if (room.players.length >= MAX_PLAYERS) return cb({ ok: false, error: 'Room penuh' });
    const old = ctx(socket); if (old) removePlayer(old.room, old.player.pid);
    const p = addPlayer(room, d); attach(socket, room, p);
    sys(room, p.name + ' bergabung');
    cb({ ok: true, session: session(room, p), ice: ICE }); broadcast(room);
  });

  on(socket, 'room:resume', (d, cb) => { // reconnect aman: butuh pid DAN token rahasia
    const room = rooms.get(String(d.code || '').toUpperCase());
    const p = room && typeof d.pid === 'string' && byPid(room, d.pid);
    if (!p || typeof d.token !== 'string' || !crypto.timingSafeEqual(hash(d.token), hash(p.token)))
      return cb({ ok: false, error: 'Sesi tidak valid atau room sudah ditutup' });
    attach(socket, room, p); sys(room, p.name + ' tersambung kembali');
    cb({ ok: true, session: session(room, p), ice: ICE }); broadcast(room);
  });

  on(socket, 'room:leave', (d, cb) => { const c = ctx(socket); if (c) removePlayer(c.room, c.player.pid); socket.data.code = null; cb({ ok: true }); });

  on(socket, 'room:start', (d, cb) => {
    const c = ctx(socket); if (!c) return cb({ ok: false, error: 'Kamu tidak ada di room' });
    const { room, player } = c;
    if (room.host !== player.pid) return cb({ ok: false, error: 'Hanya host yang bisa memulai' });
    if (room.phase === 'play') return cb({ ok: false, error: 'Pertandingan sudah berjalan' });
    if (room.players.length < 2) return cb({ ok: false, error: 'Minimal 2 pemain' });
    if (room.players.some(p => !p.connected)) return cb({ ok: false, error: 'Ada pemain yang sedang terputus' });
    room.seats = room.players.map(p => p.pid);
    room.game = new Game(room.players.map(p => p.name), room.players.map(() => false));
    room.phase = 'play'; cb({ ok: true }); broadcast(room);
  });

  // Aksi permainan: semua divalidasi oleh Game (engine.js) di server
  function act(fn) {
    const c = ctx(socket); if (!c) return 'Kamu tidak ada di room';
    const { room, player } = c, seat = room.seats.indexOf(player.pid);
    if (room.phase !== 'play' || !room.game) return 'Pertandingan belum berjalan';
    if (seat < 0) return 'Kamu bukan pemain pertandingan ini';
    const e = fn(room.game, seat); if (e) return e;
    if (room.game.winner >= 0) room.phase = 'end';
    broadcast(room); return '';
  }
  const res = e => (e ? { ok: false, error: e } : { ok: true });
  on(socket, 'game:play', (d, cb) => {
    if (!Number.isInteger(d.id)) return cb({ ok: false, error: 'Data kartu salah' });
    const col = typeof d.color === 'string' && d.color.length <= 2 ? d.color : null;
    cb(res(act((g, s) => g.play(s, d.id, col))));
  });
  on(socket, 'game:draw', (d, cb) => cb(res(act((g, s) => g.drawAct(s)))));
  on(socket, 'game:pass', (d, cb) => cb(res(act((g, s) => g.pass(s)))));
  on(socket, 'game:uno', (d, cb) => cb(res(act((g, s) => { g.callUno(s); g.log = g.p[s].name + ' bilang UNO!'; return ''; }))));

  on(socket, 'chat', (d, cb) => {
    const c = ctx(socket); if (!c) return cb({ ok: false, error: 'Kamu tidak ada di room' });
    const now = Date.now(); if (now - (socket.data.lc || 0) < 800) return cb({ ok: false, error: 'Pesan terlalu cepat' });
    const text = cleanText(d.text); if (!text) return cb({ ok: true });
    socket.data.lc = now;
    io.to(c.room.code).emit('chat', { pid: c.player.pid, name: c.player.name, av: c.player.av, text, t: now });
    cb({ ok: true });
  });

  /* Signaling WebRTC: hanya antar anggota room yang sama dan sama-sama aktif suara */
  on(socket, 'voice:join', (d, cb) => {
    const c = ctx(socket); if (!c) return cb({ ok: false, error: 'Kamu tidak ada di room' });
    const peers = [...c.room.voice].filter(x => x !== c.player.pid);
    c.room.voice.add(c.player.pid); cb({ ok: true, peers });
  });
  on(socket, 'voice:leave', (d, cb) => {
    const c = ctx(socket); if (c && c.room.voice.delete(c.player.pid)) io.to(c.room.code).emit('voice:left', { pid: c.player.pid });
    cb({ ok: true });
  });
  on(socket, 'rtc', (d, cb) => {
    const c = ctx(socket); if (!c || !c.room.voice.has(c.player.pid)) return cb({ ok: false, error: 'Aktifkan suara dulu' });
    const to = typeof d.to === 'string' && byPid(c.room, d.to);
    if (!to || !to.connected || !c.room.voice.has(to.pid)) return cb({ ok: false, error: 'Pemain tujuan tidak tersedia' });
    if (!d.data || typeof d.data !== 'object' || JSON.stringify(d.data).length > 10000) return cb({ ok: false, error: 'Data suara tidak valid' });
    io.to(to.sid).emit('rtc', { from: c.player.pid, data: d.data }); cb({ ok: true });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.code), p = room && byPid(room, socket.data.pid);
    if (!p || p.sid !== socket.id) return;
    p.connected = false;
    if (room.voice.delete(p.pid)) io.to(room.code).emit('voice:left', { pid: p.pid });
    p.timer = setTimeout(() => removePlayer(room, p.pid), GRACE_MS);
    sys(room, p.name + ' terputus'); broadcast(room);
  });
});

server.listen(PORT, () => console.log('UNO FLIP server berjalan di port ' + PORT));
