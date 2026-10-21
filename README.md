# UNO FLIP: Nusantara Edition (v1.1, ada multiplayer)

## File
**Baru:** `server.js`, `net.js`, `config.js`, `package.json`, `.env.example`, `.gitignore`, `README.md`
**Diubah:** `index.html` (layar online, lobi, chat, tombol mic), `game.js` (3 baris kecil), `style.css` (ditambah di bagian bawah)
**Tidak berubah:** `engine.js` (dipakai bersama oleh offline dan server, jadi aturannya sama).

Mode offline tidak memakai server. Cukup buka `index.html`.

## 1. Pasang Node.js
Unduh versi LTS (20 atau lebih baru) dari https://nodejs.org, lalu cek di terminal: `node -v`.

## 2. Jalankan lokal
```
npm install
npm start
```
Buka http://localhost:3000 di dua tab browser. Tab 1: Multiplayer Online, lalu Buat Room. Tab 2: masukkan kode, lalu Gabung. Host menekan Mulai.
Cek server: http://localhost:3000/health

## 3. Deploy ke internet (agar teman beda jaringan bisa main)
Server butuh hosting yang mendukung Node.js dan WebSocket (contoh: Render, Railway, Fly.io). Contoh di Render:
1. Taruh folder ini di repo GitHub (`.env` dan `node_modules` jangan ikut, sudah ada di `.gitignore`).
2. Render, New, Web Service, pilih repo. Build: `npm install`. Start: `npm start`.
3. Setelah jadi, kamu dapat alamat `https://nama.onrender.com` (sudah HTTPS). **Buka alamat itu langsung, game sudah bisa dimainkan**, dan itu cara termudah.

## 4. Pakai itch.io (opsional)
Mengunggah `server.js` ke itch.io **tidak** menjalankan backend, karena itch.io hanya hosting file statis. Caranya:
1. Deploy server dulu (langkah 3).
2. Edit `config.js`: `window.UNOFLIP_SERVER = "https://nama.onrender.com";`
3. ZIP hanya `index.html style.css engine.js game.js net.js config.js`, unggah sebagai HTML game.
4. Di server, `CORS_ORIGIN=*` dulu. Kalau mau diperketat, isi dengan origin yang tampil di pesan error CORS browser.
Server harus HTTPS karena halaman itch.io HTTPS.

## 5. Tes dua perangkat beda jaringan
Pakai alamat HTTPS dari langkah 3. HP A (Wi-Fi) buat room, HP B (data seluler) gabung dengan kode. Alamat `http://192.168...` tidak cocok untuk tes ini dan tidak bisa memakai mic.

## 6. Voice chat: HTTPS, STUN, TURN
- Browser hanya mengizinkan mic di HTTPS atau localhost. Izin diminta hanya saat tombol 🎤 ditekan.
- Tekan 🎤 sekali untuk menyalakan, tekan lagi untuk mute. 🔊 untuk membisukan suara orang lain. Hanya pemain yang menyalakan mic yang saling terhubung.
- STUN bawaan: server STUN publik Google. STUN cukup untuk banyak jaringan.
- Sebagian jaringan (Wi-Fi sekolah, sebagian data seluler) memblokir koneksi langsung, sehingga butuh server **TURN**. TURN memakai trafik besar, jadi biasanya berbayar atau gratis terbatas; ketersediaan gratis tidak dijamin. Isi `TURN_URL`, `TURN_USER`, `TURN_PASS` di environment server. Catatan: kredensial TURN dikirim ke browser pemain, jadi pakai kredensial khusus game ini, bukan akun utamamu.
- Audio tidak direkam dan tidak disimpan oleh server; server hanya meneruskan pesan penghubung (signaling).

## 7. Batasan
- Hosting gratis biasanya "tidur" bila sepi; koneksi pertama bisa butuh sekitar 1 menit. Ada batas jam dan trafik, cek halaman harga penyedia.
- Room disimpan di memori. Jika server restart, semua room hilang.
- Maksimal 4 pemain per room. Room publik, mute/blokir pemain, tombol lapor, dan batas waktu giliran belum dibuat.
- Pemain terputus ditunggu 45 detik, lalu dikeluarkan dari pertandingan.
- Pemain yang suaranya tidak tersambung kemungkinan butuh TURN.

## 8. Checklist pengujian
- [ ] Buat room, kode muncul, Salin dan Bagikan bekerja
- [ ] Kode salah, room penuh, dan room sudah mulai menampilkan pesan jelas
- [ ] 2 sampai 4 pemain bergabung, daftar pemain sama di semua layar
- [ ] Hanya host yang bisa Mulai
- [ ] Kartu dimainkan, giliran, jumlah kartu, buangan, warna, dan sisi sama di semua layar
- [ ] Efek Skip, Reverse, +1/+5, Wild, Wild Warna, dan Flip benar
- [ ] Tangan lawan tidak terlihat di tab Network
- [ ] UNO dan penalti +2
- [ ] Tutup tab saat bermain, lalu buka lagi dalam 45 detik: tersambung kembali
- [ ] Pemain keluar saat bermain: permainan lanjut, atau sisa 1 pemain langsung menang
- [ ] Chat sampai ke room yang benar saja; kirim `<b>tes</b>` tampil sebagai teks biasa
- [ ] Mic: izin ditolak, tanpa mic, dua pemain saling dengar, jaringan beda
- [ ] Layout di HP Android dan desktop; mode offline tetap jalan tanpa internet
