/* NET: klien multiplayer. Dimuat setelah game.js. Mode offline TIDAK memakai file ini. */
const Net = { sock: null, state: null, ice: [], wasIn: false, phase: null, counted: false, unread: 0 };
const V = { on: false, stream: null, peers: {}, deaf: false };
const SK = 'unoflip_s';
const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const sess = () => { try { return JSON.parse(sessionStorage.getItem(SK)); } catch (e) { return null; } };
const srvUrl = () => (localStorage.getItem('unoflip_srv') || window.UNOFLIP_SERVER || '').trim().replace(/\/$/, '');
const emit = (ev, d) => Net.sock && Net.sock.emit(ev, d);
const nameOf = pid => ((Net.state && Net.state.players.find(p => p.pid === pid)) || {}).name || '?';
const vstat = t => $('#vstat').textContent = t;

/* ---------- Koneksi ---------- */
function loadIO(url) {
  return new Promise((ok, no) => {
    if (window.io) return ok();
    const s = document.createElement('script'); s.src = url + '/socket.io/socket.io.js';
    s.onload = ok; s.onerror = () => no(new Error('Server tidak bisa dihubungi. Cek alamat server atau coba lagi.'));
    document.head.append(s);
  });
}
async function connect() {
  if (Net.sock && Net.sock.connected) return;
  if (!Net.sock) { await loadIO(srvUrl()); Net.sock = io(srvUrl() || undefined, { reconnection: true }); wire(); }
  await new Promise((ok, no) => {
    if (Net.sock.connected) return ok();
    const t = setTimeout(() => no(new Error('Server tidak merespons. Server gratis kadang perlu 1 menit untuk bangun, coba lagi.')), 20000);
    Net.sock.once('connect', () => { clearTimeout(t); ok(); });
  });
}
function wire() {
  const s = Net.sock;
  s.on('state', onState);
  s.on('chat', addChat);
  s.on('err', m => { $('#onMsg').textContent = m; $('#lw').textContent = m; if (G && G.online) { G.log = m; render(); } });
  s.on('connect', () => { // sambung ulang otomatis
    const x = sess(); if (!Net.wasIn || !x) return;
    s.emit('room:resume', x, r => { if (r.ok) Net.ice = r.ice; else { toMenu(); $('#onMsg').textContent = r.error; } });
  });
  s.on('disconnect', () => { voiceStop(true); if (G && G.online) { G.log = 'Koneksi terputus, mencoba menyambung lagi...'; render(); } $('#lw').textContent = 'Koneksi terputus, menyambung lagi...'; });
  s.on('rtc', onRtc);
  s.on('voice:left', ({ pid }) => closePeer(pid));
}
async function tryResume() { // setelah refresh halaman
  const x = sess(); if (!x) return;
  try { await connect(); } catch (e) { return; }
  Net.sock.emit('room:resume', x, r => { if (r.ok) { Net.ice = r.ice; Net.wasIn = true; } else sessionStorage.removeItem(SK); });
}

/* ---------- Layar online & lobi ---------- */
$('#onl').onclick = () => { $('#srv').value = localStorage.getItem('unoflip_srv') || ''; $('#srv').placeholder = window.UNOFLIP_SERVER || 'kosong = server yang sama'; $('#onMsg').textContent = ''; show('online'); };
async function enter(kind, extra) {
  const m = $('#onMsg'); m.textContent = 'Menghubungkan...';
  localStorage.setItem('unoflip_srv', $('#srv').value.trim());
  try { await connect(); } catch (e) { m.textContent = e.message; return; }
  Net.sock.emit(kind, Object.assign({ name: st.name, av: st.av }, extra), r => {
    if (!r.ok) { m.textContent = r.error; return; }
    m.textContent = ''; Net.ice = r.ice; Net.wasIn = true; sessionStorage.setItem(SK, JSON.stringify(r.session));
  });
}
$('#mk').onclick = () => enter('room:create', {});
$('#jn').onclick = () => enter('room:join', { code: $('#jc').value.trim().toUpperCase() });
$('#go').onclick = () => Net.sock.emit('room:start', {}, r => { if (!r.ok) $('#lw').textContent = r.error; });
$('#lv2').onclick = () => leave();
$('#cp').onclick = () => navigator.clipboard && navigator.clipboard.writeText(Net.state.code).then(() => $('#lw').textContent = 'Kode disalin!');
$('#sh').onclick = () => {
  const t = 'Ayo main UNO FLIP Nusantara! Kode room: ' + Net.state.code;
  if (navigator.share) navigator.share({ title: 'UNO FLIP Nusantara', text: t, url: location.href }).catch(() => { });
  else navigator.clipboard && navigator.clipboard.writeText(t + ' ' + location.href).then(() => $('#lw').textContent = 'Undangan disalin!');
};
function lobbyUI(s) {
  $('#rc').textContent = s.code; const pl = $('#plist'); pl.innerHTML = '';
  s.players.forEach(p => {
    const d = document.createElement('div'); d.className = 'opp';
    d.textContent = `${AVS[p.av] || '🦅'} ${p.name}${p.pid === s.host ? ' 👑' : ''}${p.pid === s.you ? ' (kamu)' : ''}${p.connected ? '' : ' ⚠️ putus'}`; pl.append(d);
  });
  const host = s.host === s.you; $('#go').style.display = host ? '' : 'none';
  $('#lw').textContent = host ? (s.players.length < 2 ? 'Tunggu minimal 1 teman lagi...' : '') : 'Menunggu host memulai...';
}
function leave() {
  voiceStop(); emit('room:leave', {}); sessionStorage.removeItem(SK);
  Net.wasIn = false; Net.state = null; Net.phase = null; G = null;
  $('#onbar').hidden = true; $('#chat').hidden = true; $('#clog').innerHTML = ''; $('#modal').hidden = true; show('menu');
}
const toMenu = leave;
Net.leave = leave;

/* ---------- Sinkron state ke tampilan game.js ---------- */
function viewFrom(v) { // objek mirip Game agar render() di game.js bisa dipakai ulang
  const p = v.players.map((q, i) => ({ name: q.name, bot: false, connected: q.connected, hand: i === 0 ? v.hand : Array(q.count).fill(null), uno: i === 0 && v.uno }));
  const g = {
    online: true, p, cur: v.cur, winner: v.winner, side: v.side, color: v.color, log: v.log,
    top: () => v.top, face: c => c[g.side], legal: () => v.legal.map(id => v.hand.find(c => c.id === id)).filter(Boolean),
    drawn: v.drawn == null ? null : v.hand.find(c => c.id === v.drawn),
    play: (i, id, col) => { emit('game:play', { id, color: col }); return ''; },
    drawAct: () => { emit('game:draw'); return ''; }, pass: () => { emit('game:pass'); return ''; },
    callUno: () => { emit('game:uno'); return false; }
  };
  return g;
}
function onState(s) {
  Net.state = s; $('#onbar').hidden = false;
  if (!s.gv) { G = null; Net.phase = s.phase; lobbyUI(s); show('lobby'); return; }
  const first = !G || !G.online, afterEnd = Net.phase === 'end';
  G = viewFrom(s.gv);
  if (first) { lastSide = G.side; Net.counted = false; }
  if (s.phase === 'play' && afterEnd) { $('#modal').hidden = true; Net.counted = false; }
  Net.phase = s.phase;
  if (!$('#game').classList.contains('on')) show('game');
  loop();
}
function onlineEnd() { // dipanggil dari end() di game.js
  const won = G.winner === 0;
  if (!Net.counted) { Net.counted = true; st.g++; if (won) st.w++; save(); beep(won ? 900 : 200, .5); }
  const host = Net.state && Net.state.host === Net.state.you;
  modal(`<h2>${won ? '🎉 KAMU MENANG!' : '😢 ' + esc(G.p[G.winner].name) + ' menang'}</h2>` +
    (host ? '<button id="again">Main Lagi</button>' : '<p>Menunggu host untuk main lagi...</p>') + '<button id="home">Keluar Room</button>');
  if (host) $('#again').onclick = () => { $('#modal').hidden = true; Net.sock.emit('room:start', {}, r => { if (!r.ok) { G.log = r.error; render(); } }); };
  $('#home').onclick = () => leave();
}

/* ---------- Chat ---------- */
function addChat(m) {
  const d = document.createElement('div');
  if (m.sys) { d.style.opacity = .7; d.textContent = '• ' + m.text; }
  else { const t = new Date(m.t); d.textContent = `${AVS[m.av] || ''} ${m.name} (${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}): ${m.text}`; }
  $('#clog').append(d); $('#clog').scrollTop = 1e9;
  if ($('#chat').hidden && !m.sys) { Net.unread++; $('#unr').textContent = Net.unread; }
}
function sendChat(text) { text = text.trim(); if (text) emit('chat', { text }); }
$('#chatB').onclick = () => { const c = $('#chat'); c.hidden = !c.hidden; if (!c.hidden) { Net.unread = 0; $('#unr').textContent = ''; } };
$('#cs').onclick = () => { sendChat($('#ct').value); $('#ct').value = ''; };
$('#ct').onkeydown = e => { if (e.key === 'Enter') $('#cs').click(); };
['Giliranmu!', 'Mantap!', 'Ayo main!', 'UNO!', 'GG!'].forEach(t => { const b = document.createElement('button'); b.textContent = t; b.onclick = () => sendChat(t); $('#qc').append(b); });

/* ---------- Voice chat (WebRTC mesh, signaling lewat server) ---------- */
$('#micB').onclick = () => {
  if (!V.on) return voiceStart();
  const t = V.stream.getAudioTracks()[0]; t.enabled = !t.enabled;
  $('#micB').textContent = t.enabled ? '🎤' : '🔇'; vstat(t.enabled ? 'Mic menyala' : 'Mic dimatikan');
};
$('#spkB').onclick = () => { V.deaf = !V.deaf; $('#spkB').textContent = V.deaf ? '🔇' : '🔊'; Object.values(V.peers).forEach(p => p.audio.muted = V.deaf); };
async function voiceStart() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return vstat('Mic butuh HTTPS (atau localhost)');
  try { V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { return vstat(e.name === 'NotAllowedError' ? 'Izin mic ditolak' : e.name === 'NotFoundError' ? 'Mic tidak ditemukan' : 'Mic gagal: ' + e.name); }
  V.on = true; vstat('Mic menyala');
  Net.sock.emit('voice:join', {}, async r => { if (r.ok) for (const pid of r.peers) await callPeer(pid); });
}
function voiceStop(quiet) {
  Object.keys(V.peers).forEach(closePeer);
  if (V.stream) V.stream.getTracks().forEach(t => t.stop());
  if (V.on && !quiet) emit('voice:leave', {});
  V.on = false; V.stream = null; $('#micB').textContent = '🎤'; vstat(''); $('#speaking').textContent = '';
}
function peer(pid) {
  if (V.peers[pid]) return V.peers[pid].pc;
  const pc = new RTCPeerConnection({ iceServers: Net.ice }), audio = new Audio(); audio.autoplay = true; audio.muted = V.deaf;
  V.peers[pid] = { pc, audio, q: [] };
  V.stream.getTracks().forEach(t => pc.addTrack(t, V.stream));
  pc.onicecandidate = e => e.candidate && emit('rtc', { to: pid, data: { ice: e.candidate } });
  pc.ontrack = e => { audio.srcObject = e.streams[0]; audio.play().catch(() => { }); watch(pid, e.streams[0]); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') vstat('Suara tersambung ke ' + nameOf(pid));
    if (pc.connectionState === 'failed') vstat('Suara ke ' + nameOf(pid) + ' gagal (jaringan mungkin butuh TURN)');
  };
  return pc;
}
async function callPeer(pid) {
  const pc = peer(pid); const o = await pc.createOffer(); await pc.setLocalDescription(o);
  emit('rtc', { to: pid, data: { sdp: pc.localDescription } });
}
async function onRtc({ from, data }) {
  if (!V.on) return;
  const pc = peer(from), P = V.peers[from];
  try {
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      for (const c of P.q.splice(0)) await pc.addIceCandidate(c);
      if (data.sdp.type === 'offer') { const a = await pc.createAnswer(); await pc.setLocalDescription(a); emit('rtc', { to: from, data: { sdp: pc.localDescription } }); }
    } else if (data.ice) { if (pc.remoteDescription) await pc.addIceCandidate(data.ice); else P.q.push(data.ice); }
  } catch (e) { vstat('Kesalahan suara: ' + e.message); }
}
function closePeer(pid) {
  const p = V.peers[pid]; if (!p) return;
  clearInterval(p.iv); if (p.ac) p.ac.close().catch(() => { });
  p.pc.close(); p.audio.srcObject = null; delete V.peers[pid]; showTalk();
}
function watch(pid, stream) { // indikator siapa yang sedang bicara
  if (!window.AudioContext) return;
  const ac = new AudioContext(), an = ac.createAnalyser(), buf = new Uint8Array(an.frequencyBinCount);
  ac.createMediaStreamSource(stream).connect(an); const p = V.peers[pid]; p.ac = ac;
  p.iv = setInterval(() => { an.getByteFrequencyData(buf); p.talk = buf.reduce((a, b) => a + b, 0) / buf.length > 15; showTalk(); }, 300);
}
function showTalk() {
  const n = Object.keys(V.peers).filter(k => V.peers[k].talk).map(nameOf);
  $('#speaking').textContent = n.length ? '🔊 ' + n.join(', ') : '';
}

tryResume();
