# Isi halaman Chrome Web Store

## Nama
Browser Lock

## Ringkasan singkat (maks 132 karakter)
ID: Kunci Chrome dengan password atau Touch ID. Semua tab tertutup sampai lo buka. Tanpa akun, tanpa internet.
EN: Lock Chrome with a password or Touch ID. Every tab stays hidden until you unlock. No account, no network.

## Deskripsi (ID)
Browser Lock mengunci Chrome dengan password. Begitu Chrome dibuka, semua tab disembunyikan dan jendela kunci muncul. Baru setelah password benar, isi tab terlihat lagi.

FITUR
• Terkunci setiap Chrome dibuka
• Kunci otomatis saat komputer tidak dipakai atau layar dikunci
• Touch ID / sidik jari (opsional)
• Kunci per situs: bank atau email minta password lagi walau Chrome terbuka
• Tombol panik: satu pintasan untuk mengunci, mengecilkan jendela, dan mengosongkan clipboard
• Catatan percobaan gagal, dengan lencana di ikon
• Kode pemulihan kalau lupa password
• Indonesia dan English

PRIVASI
Tanpa akun, tanpa iklan, tanpa pelacakan, tanpa internet. Password disimpan sebagai hash (PBKDF2) hanya di komputer lo. Ekstensi tidak membaca isi halaman.

KEAMANAN
Password diketik di jendela milik ekstensi, bukan di halaman web, jadi skrip situs tidak bisa mengintip. Percobaan salah dibatasi (5 percobaan, lalu tunggu makin lama).

BATASAN (jujur)
Ini penutup tingkat browser, bukan pengaman sistem. Ekstensi bisa dimatikan lewat chrome://extensions. Incognito dan profil Chrome lain tidak tercakup. Untuk komputer bersama, tambahkan kunci layar komputer.

## Description (EN)
Browser Lock locks Chrome with a password. When Chrome opens, every tab is hidden and a lock window appears. Pages only show again after the right password.

FEATURES
• Locked every time Chrome starts
• Auto-lock when the computer is idle or the screen locks
• Touch ID / fingerprint (optional)
• Per-site lock: ask for the password again on your bank or email even when Chrome is unlocked
• Panic button: one shortcut to lock, minimize windows, and clear the clipboard
• Failed-attempt log with a badge on the icon
• Recovery code in case you forget the password
• Indonesian and English

PRIVACY
No account, no ads, no tracking, no network. The password is stored as a hash (PBKDF2) on your computer only. The extension never reads page content.

SECURITY
The password is typed in an extension-owned window, not on the web page, so site scripts can't snoop. Wrong attempts are rate-limited (5 tries, then increasing waits).

LIMITS (honest)
This is browser-level cover, not system-level security. The extension can be disabled at chrome://extensions. Incognito and other Chrome profiles aren't covered. On a shared computer, also lock the computer screen.

## Kategori
Productivity (Produktivitas) / Privacy

## Justifikasi izin (untuk formulir review)
- storage: simpan hash password dan pengaturan lokal.
- idle: kunci otomatis saat menganggur atau layar dikunci.
- tabs: tahu tab mana yang ditutup, alihkan tab chrome:// ke layar kunci.
- alarms: cek berkala kedaluwarsa kunci per situs.
- offscreen + clipboardWrite: kosongkan clipboard di tombol panik.
- host permission <all_urls>: tampilkan layar kunci di halaman web mana pun (tanpa membaca isi halaman).
- Tidak ada kode jarak jauh. Semua skrip ada di paket.

## Single purpose
Mengunci browser Chrome dengan password atau biometrik sampai pemilik membukanya.
