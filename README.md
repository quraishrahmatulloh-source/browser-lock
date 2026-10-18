# Browser Lock

Ekstensi Chrome yang mengunci browser dengan password. Begitu Chrome dibuka, semua tab tertutup sampai password benar.
Gratis, tanpa akun, tanpa internet. Semua data tersimpan di komputer.

## Cara kerja
- **Chrome dibuka** → semua tab disembunyikan dan jendela kunci muncul. Sesi tidak bertahan setelah Chrome ditutup, jadi selalu terkunci.
- **Kunci otomatis** saat komputer tidak dipakai (1 menit sampai 1 jam) dan saat layar komputer dikunci.
- **Kunci cepat** lewat tombol gembok atau pintasan `Ctrl+Shift+L` (Mac: `⌘+Shift+L`).
- **Lupa password** → pakai kode pemulihan yang ditampilkan sekali saat membuat password.

## Pasang (belum lewat Chrome Web Store)
1. Buka `chrome://extensions` lalu aktifkan **Developer mode** (kanan atas).
2. Klik **Load unpacked** lalu pilih folder ini.
3. Halaman pengaturan terbuka sendiri. Buat password dan **simpan kode pemulihannya**.
4. Pin ikon gembok di toolbar (ikon puzzle → pin).

## Keamanan
- Password disimpan sebagai **PBKDF2-SHA256 (250.000 iterasi)** dengan salt acak, tidak pernah sebagai teks asli.
- Percobaan salah dibatasi: 5 gratis, lalu tunggu 30 dtk, 1 mnt, 2 mnt, … maksimal 15 mnt. Berlaku juga untuk kode pemulihan.
- **Password tidak diketik di halaman web.** Layar kunci di halaman cuma tombol; password diketik di jendela milik ekstensi, jadi skrip situs tidak bisa mengintip ketikan.
- Isi halaman **disembunyikan** (`visibility: hidden`), bukan sekadar ditutup, dan ditandai `inert` supaya tidak bisa difokus dengan Tab.
- Aksi sensitif (buka kunci, ganti password, pengaturan) hanya diterima dari halaman ekstensi ini. Pesan dari skrip di halaman web ditolak.
- Tidak ada permintaan jaringan, analitik, atau pelacakan. Kodenya semua di folder ini.

## Batasan (jujur)
- Ini **penutup tingkat browser**, bukan pengaman sistem. Ekstensi bisa dimatikan atau dihapus lewat `chrome://extensions`. Untuk komputer bersama, tambahkan kunci layar komputer.
- **Incognito** dan **profil Chrome lain** tidak tercakup. Untuk Incognito aktifkan *Izinkan di Incognito* di detail ekstensi.
- Halaman `chrome://` dan Web Store tidak bisa ditutup overlay. Tab itu dialihkan ke halaman kunci lalu dikembalikan setelah unlock.
- File `file://` hanya tertutup kalau *Allow access to file URLs* diaktifkan untuk ekstensi.
- Lupa password **dan** kode pemulihan: satu-satunya jalan menghapus ekstensi lalu memasangnya lagi.
- Ekstensi meminta izin "baca dan ubah data di semua situs" karena harus menutup semua halaman. Ekstensi **tidak membaca** isi halaman. Silakan periksa `content.js`.

## Uji
```bash
node --test tests/auth.test.mjs                         # 13 uji logika password (Node 20+)
CHROME_BIN="/path/ke/Google Chrome for Testing" node tests/e2e.mjs   # 35 uji end-to-end di Chrome sungguhan (~45 dtk)
```
Uji end-to-end butuh [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/), karena Chrome biasa (137+) menonaktifkan `--load-extension`.
Ikon dibuat ulang dengan `python3 tools/make_icons.py` (butuh Pillow).

## Struktur
`background.js` service worker (status kunci, tab, auto-lock) · `content.js` penutup halaman · `lib/auth.js` logika password ·
`lock.*` jendela kunci · `options.*` pengaturan · `popup.*` popup toolbar · `ui.css` gaya bersama.

## Lisensi
MIT, lihat [LICENSE](LICENSE). Font [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) berlisensi SIL Open Font License 1.1.

Dibuat oleh madebyuloh.
