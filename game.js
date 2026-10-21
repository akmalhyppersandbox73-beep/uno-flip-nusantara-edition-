/* UI: menu, tampilan, input pemain, giliran robot. Aturan ada di engine.js */
const $ = s => document.querySelector(s);
const AVS = ['🦅', '🐅', '🐘', '🦜', '🐉', '🦎'];
let st = Object.assign({ w: 0, g: 0, name: 'Pemain', av: 0, mute: false, anim: true }, JSON.parse(localStorage.getItem('unoflip') || '{}'));
let G = null, timer = null, lastSide = 'L';
const save = () => localStorage.setItem('unoflip', JSON.stringify(st));

/* Suara sederhana (WebAudio) */
const AC = window.AudioContext ? new AudioContext() : null;
function beep(f, d = .08) {
  if (st.mute || !AC) return;
  const o = AC.createOscillator(), g = AC.createGain();
  o.frequency.value = f; g.gain.value = .05; o.connect(g); g.connect(AC.destination);
  o.start(); o.stop(AC.currentTime + d);
}

/* Navigasi */
function show(id) { document.querySelectorAll('.scr').forEach(e => e.classList.toggle('on', e.id === id)); if (id === 'menu') refreshMenu(); }
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { beep(500); show(b.dataset.go); });
function refreshMenu() {
  $('#av').textContent = AVS[st.av]; $('#nm').value = st.name;
  $('#stat').textContent = `Menang ${st.w} dari ${st.g} permainan`;
  $('#netT').textContent = navigator.onLine ? 'Internet aktif' : 'Offline'; $('#net').className = 'dot ' + (navigator.onLine ? '' : 'off');
  $('#net').style.background = navigator.onLine ? '#43a047' : '';
  document.body.classList.toggle('noanim', !st.anim);
  $('#mute').checked = st.mute; $('#anim').checked = st.anim;
}
$('#av').onclick = () => { st.av = (st.av + 1) % AVS.length; save(); refreshMenu(); };
$('#nm').onchange = e => { st.name = e.target.value.trim().slice(0, 12) || 'Pemain'; save(); };
$('#mute').onchange = e => { st.mute = e.target.checked; save(); };
$('#anim').onchange = e => { st.anim = e.target.checked; save(); refreshMenu(); };
$('#onl').onclick = () => modal('<b>Multiplayer Online</b><p>Belum tersedia di versi 1. Fitur ini butuh server Node.js (Socket.IO). Itu tahap berikutnya.</p><button id="ok">OK</button>');
window.addEventListener('online', refreshMenu); window.addEventListener('offline', refreshMenu);

function modal(html) { $('#box').innerHTML = html; $('#modal').hidden = false; const ok = $('#ok'); if (ok) ok.onclick = () => $('#modal').hidden = true; }

/* Mulai game */
$('#start').onclick = () => {
  const n = +$('#bots').value, names = [st.name], bots = [false];
  for (let i = 1; i <= n; i++) { names.push(AVS[(st.av + i) % AVS.length] + ' Robot ' + i); bots.push(true); }
  G = new Game(names, bots); G.lv = $('#lv').value; lastSide = 'L';
  show('game'); loop();
};
$('#quit').onclick = () => modal('<b>Keluar dari pertandingan?</b><button id="y">Ya, keluar</button><button id="n">Lanjut main</button>') || ($('#y').onclick = () => { clearTimeout(timer); if (G && G.online) Net.leave(); G = null; $('#modal').hidden = true; show('menu'); }, $('#n').onclick = () => $('#modal').hidden = true);

/* Menggambar kartu */
const SYM = { S: '⊘', R: '⇄', F: '⟲', W: '★', W2: '+2', WC: '★?' };
function cardEl(c, side, ok) {
  const f = c[side], d = document.createElement('div');
  d.className = 'card ' + f.c + (ok ? ' ok' : '');
  if (f.c !== 'W') d.style.background = SIDES[side][f.c];
  d.textContent = SYM[f.v] || f.v; return d;
}
function render() {
  const g = G, me = g.p[0], myTurn = g.cur === 0 && g.winner < 0;
  document.body.classList.toggle('dark', g.side === 'D');
  if (g.side !== lastSide) { lastSide = g.side; document.body.classList.add('fl'); setTimeout(() => document.body.classList.remove('fl'), 650); beep(700, .2); }
  $('#side').textContent = g.side === 'L' ? '☀ SISI TERANG' : '🌙 SISI GELAP';
  $('#col').style.background = SIDES[g.side][g.color]; $('#col').title = NAMES[g.color];
  $('#opps').innerHTML = '';
  g.p.forEach((p, i) => {
    if (!i) return;
    const e = document.createElement('div'); e.className = 'opp' + (g.cur === i ? ' turn' : '');
    e.append(p.name, document.createElement('br'), '🂠 ' + p.hand.length + (g.cur === i ? ' 🤔' : '') + (p.connected === false ? ' ⚠️ putus' : '')); $('#opps').append(e);
  });
  $('#disc').innerHTML = ''; const t = cardEl(g.top(), g.side, false); t.classList.add('deal'); $('#disc').append(t);
  const legal = myTurn ? g.legal(0) : [];
  $('#hand').innerHTML = '';
  me.hand.forEach(c => { const e = cardEl(c, g.side, legal.includes(c)); e.onclick = () => humanPlay(c); $('#hand').append(e); });
  $('#msg').textContent = g.log + (myTurn ? (g.drawn ? ' | Mainkan kartu barumu atau Lewati' : legal.length ? ' | Giliranmu!' : ' | Tidak ada kartu cocok, ambil kartu!') : '');
  $('#deck').classList.toggle('hint', myTurn && !legal.length && !g.drawn);
  $('#drawB').disabled = !myTurn || !!legal.length || !!g.drawn;
  $('#pass').style.display = myTurn && g.drawn ? '' : 'none';
  $('#uno').disabled = !myTurn || me.hand.length > 2; $('#uno').classList.toggle('on', me.uno);
}

/* Alur permainan */
function loop() {
  if (!G) return;
  render();
  if (G.winner >= 0) return end();
  if (G.p[G.cur].bot) timer = setTimeout(botTurn, 1000);
}
function botTurn() {
  if (!G) return;
  const i = G.cur, p = G.p[i], act = () => {
    const c = aiMove(G, i, G.lv); if (!c) return;
    if (p.hand.length === 2 && (G.lv !== 'easy' || Math.random() > .25)) p.uno = true;
    const col = G.face(c).c === 'W' ? bestColor(p.hand.filter(h => h !== c), G.side) : null;
    G.play(i, c.id, col); beep(400 + Math.random() * 200);
  };
  if (G.legal(i).length) act();
  else { G.drawAct(i); beep(300); if (G.drawn && G.cur === i) { if (G.lv !== 'easy' || Math.random() > .3) act(); else G.pass(i); } }
  loop();
}
function humanPlay(c) {
  if (!G || G.cur !== 0 || G.winner >= 0) return;
  if (G.face(c).c === 'W') {
    if (!G.legal(0).includes(c)) return;
    const cols = Object.keys(SIDES[G.side]);
    modal('<b>Pilih warna</b><div class="cols">' + cols.map(k => `<button data-k="${k}" style="background:${SIDES[G.side][k]}">${NAMES[k]}</button>`).join('') + '</div>');
    document.querySelectorAll('.cols button').forEach(b => b.onclick = () => { $('#modal').hidden = true; doPlay(c, b.dataset.k); });
  } else doPlay(c, null);
}
function doPlay(c, col) {
  const err = G.play(0, c.id, col);
  if (err) { G.log = err; beep(150, .15); } else beep(600);
  loop();
}
$('#deck').onclick = $('#drawB').onclick = () => { const e = G && G.drawAct(0); if (e) G.log = e; beep(300); loop(); };
$('#pass').onclick = () => { const e = G.pass(0); if (e) G.log = e; loop(); };
$('#uno').onclick = () => { if (G.callUno(0)) { G.log = 'Kamu bilang UNO!'; beep(880, .25); } loop(); };

function end() {
  if (G.online) return onlineEnd();
  const won = G.winner === 0; st.g++; if (won) st.w++; save(); beep(won ? 900 : 200, .5);
  modal(`<h2>${won ? '🎉 KAMU MENANG!' : '😢 ' + G.p[G.winner].name + ' menang'}</h2><button id="again">Main Lagi</button><button id="home">Menu</button>`);
  $('#again').onclick = () => { $('#modal').hidden = true; $('#start').onclick(); };
  $('#home').onclick = () => { $('#modal').hidden = true; G = null; show('menu'); };
}
refreshMenu();
