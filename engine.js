/* ENGINE + AI: logika murni, tanpa DOM. Nanti server Node.js bisa memakai file ini juga. */
const SIDES = {
  L: { R: '#e53935', Y: '#fdd835', G: '#43a047', B: '#1e88e5' },   // Sisi terang
  D: { P: '#5e2a84', O: '#fb8c00', K: '#ec407a', N: '#1a237e' }    // Sisi gelap
};
const NAMES = { R: 'Merah', Y: 'Kuning', G: 'Hijau', B: 'Biru', P: 'Ungu', O: 'Jingga', K: 'Pink', N: 'Biru Tua' };
const ATTACK = ['+1', '+5', 'W2', 'WC', 'S'];

function faces(side) {
  const a = [], acts = side === 'L' ? ['S', 'R', '+1', 'F'] : ['S', 'R', '+5', 'F'];
  for (const c of Object.keys(SIDES[side])) {
    for (let n = 1; n <= 9; n++) for (let k = 0; k < 2; k++) a.push({ c, v: String(n) });
    for (const v of acts) for (let k = 0; k < 2; k++) a.push({ c, v });
  }
  for (let k = 0; k < 4; k++) { a.push({ c: 'W', v: 'W' }); a.push({ c: 'W', v: side === 'L' ? 'W2' : 'WC' }); }
  return a; // 112 muka kartu
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
function newDeck() { const l = faces('L'), d = shuffle(faces('D')); return shuffle(l.map((f, i) => ({ id: i, L: f, D: d[i] }))); }
function bestColor(hand, side) {
  const cnt = {};
  for (const c of hand) { const f = c[side]; if (f.c !== 'W') cnt[f.c] = (cnt[f.c] || 0) + 1; }
  const k = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
  return k[0] || Object.keys(SIDES[side])[0];
}

class Game {
  constructor(names, bots) {
    this.p = names.map((n, i) => ({ name: n, bot: !!bots[i], hand: [], uno: false }));
    this.draw = newDeck(); this.disc = []; this.side = 'L'; this.dir = 1; this.cur = 0;
    this.drawn = null; this.winner = -1; this.log = 'Permainan dimulai!';
    for (const p of this.p) for (let i = 0; i < 7; i++) p.hand.push(this.draw.pop());
    let c;
    do { c = this.draw.pop(); if (c.L.c === 'W') { this.draw.unshift(c); c = null; } } while (!c);
    this.disc.push(c); this.color = c.L.c; // kartu pembuka tidak memicu efek
  }
  top() { return this.disc[this.disc.length - 1]; }
  face(c) { return c[this.side]; }
  canPlay(c) { const f = this.face(c); return f.c === 'W' || f.c === this.color || f.v === this.face(this.top()).v; }
  legal(i) { return this.p[i].hand.filter(c => (!this.drawn || c === this.drawn) && this.canPlay(c)); }
  next(from = this.cur, steps = 1) { const n = this.p.length; return (((from + this.dir * steps) % n) + n) % n; }
  drawCards(i, n) {
    for (; n > 0; n--) {
      if (!this.draw.length) { const t = this.disc.pop(); this.draw = shuffle(this.disc); this.disc = [t]; }
      if (!this.draw.length) break;
      this.p[i].hand.push(this.draw.pop());
    }
    if (this.p[i].hand.length > 1) this.p[i].uno = false;
  }
  callUno(i) { if (this.p[i].hand.length <= 2) { this.p[i].uno = true; return true; } return false; }
  play(i, id, color) {
    if (this.winner >= 0 || i !== this.cur) return 'Bukan giliranmu';
    const p = this.p[i], c = p.hand.find(x => x.id === id);
    if (!c || !this.legal(i).includes(c)) return 'Kartu tidak cocok';
    const f = this.face(c);
    if (f.c === 'W' && !(color in SIDES[this.side])) return 'Pilih warna dulu';
    p.hand.splice(p.hand.indexOf(c), 1); this.disc.push(c); this.drawn = null;
    this.color = f.c === 'W' ? color : f.c;
    let msg = p.name + ' main ' + (f.c === 'W' ? 'Wild' : NAMES[f.c]) + ' ' + f.v;
    if (p.hand.length === 1 && !p.uno) { this.drawCards(i, 2); msg += ' | lupa UNO! +2 kartu'; }
    if (!p.hand.length) { this.winner = i; this.log = msg; return ''; }
    const v = f.v, nx = this.next(); let skip = 0;
    if (v === 'R') { this.dir *= -1; if (this.p.length === 2) skip = 1; msg += ' | arah berbalik'; }
    else if (v === 'S') { skip = this.side === 'L' ? 1 : this.p.length - 1; msg += this.side === 'L' ? ' | skip' : ' | semua dilewati'; }
    else if (v === '+1') { this.drawCards(nx, 1); skip = 1; msg += ` | ${this.p[nx].name} ambil 1`; }
    else if (v === '+5') { this.drawCards(nx, 5); skip = 1; msg += ` | ${this.p[nx].name} ambil 5`; }
    else if (v === 'W2') { this.drawCards(nx, 2); skip = 1; msg += ` | ${this.p[nx].name} ambil 2`; }
    else if (v === 'WC') {
      let n = 0; do { const before = this.p[nx].hand.length; this.drawCards(nx, 1); if (this.p[nx].hand.length === before) break; n++; }
      while (this.p[nx].hand[this.p[nx].hand.length - 1].D.c !== color);
      skip = 1; msg += ` | ${this.p[nx].name} ambil ${n} sampai dapat ${NAMES[color]}`;
    }
    else if (v === 'F') {
      this.side = this.side === 'L' ? 'D' : 'L';
      this.color = c[this.side].c === 'W' ? bestColor(p.hand, this.side) : c[this.side].c;
      msg += ' | FLIP ke sisi ' + (this.side === 'L' ? 'TERANG' : 'GELAP');
    }
    this.cur = this.next(this.cur, 1 + skip); this.log = msg; return '';
  }
  drawAct(i) {
    if (this.winner >= 0 || i !== this.cur) return 'Bukan giliranmu';
    if (this.drawn) return 'Kamu sudah mengambil kartu';
    if (this.legal(i).length) return 'Kamu masih punya kartu yang cocok';
    const h = this.p[i].hand, n = h.length; this.drawCards(i, 1);
    this.log = this.p[i].name + ' ambil kartu';
    if (h.length > n && this.canPlay(h[h.length - 1])) this.drawn = h[h.length - 1]; else this.cur = this.next();
    return '';
  }
  pass(i) {
    if (i !== this.cur || !this.drawn) return 'Ambil kartu dulu';
    this.drawn = null; this.cur = this.next(); return '';
  }
}

/* AI: easy = acak, normal = suka kartu aksi, hard = menyerang saat lawan hampir menang */
function aiMove(g, i, lv) {
  const L = g.legal(i); if (!L.length) return null;
  if (lv === 'easy') return L[Math.random() * L.length | 0];
  const nxt = g.p[g.next()].hand.length, hand = g.p[i].hand; let best = null, bs = -99;
  for (const c of L) {
    const f = g.face(c); let s = Math.random(), act = isNaN(f.v);
    if (act && f.c !== 'W') s += 2;
    if (f.c === 'W') s += hand.length <= 3 ? 3 : -1.5;
    if (lv === 'hard') {
      if (nxt <= 2 && ATTACK.includes(f.v)) s += 6;
      s += hand.filter(h => g.face(h).c === f.c).length * 0.4;
    } else if (nxt <= 2 && act) s += 2;
    if (s > bs) { bs = s; best = c; }
  }
  return best;
}
if (typeof module !== 'undefined') module.exports = { Game, aiMove, bestColor, SIDES, NAMES };
