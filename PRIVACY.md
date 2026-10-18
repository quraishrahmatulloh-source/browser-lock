# Kebijakan Privasi Browser Lock

*Terakhir diperbarui: 18 Oktober 2026*

**Browser Lock tidak mengumpulkan, mengirim, atau membagikan data apa pun.**

## Data yang disimpan, hanya di komputer lo
Disimpan lewat `chrome.storage` di profil Chrome lo dan tidak pernah meninggalkan komputer:
- Hash password (PBKDF2-SHA256, salt acak). Password aslinya tidak pernah disimpan.
- Hash kode pemulihan.
- Pengaturan: durasi kunci otomatis, daftar situs yang dikunci per situs, bahasa, opsi tombol panik.
- Catatan percobaan gagal (waktu dan jenis, maksimal 50 entri). Tanpa foto, tanpa lokasi.
- Kunci publik Touch ID kalau lo mengaktifkannya. Sidik jari tidak pernah diakses ekstensi, itu urusan sistem operasi.

## Data yang tidak dikumpulkan
Tidak ada analitik, pelacakan, iklan, akun, atau permintaan jaringan. Ekstensi tidak membaca isi halaman web, riwayat, atau formulir.

## Izin dan alasannya
| Izin | Alasan |
|---|---|
| `storage` | Menyimpan hash password dan pengaturan di komputer lo. |
| `idle` | Mengunci otomatis saat komputer tidak dipakai atau layar dikunci. |
| `tabs` | Mengetahui tab mana yang harus ditutup, dan mengalihkan tab `chrome://` ke layar kunci. |
| `alarms` | Memeriksa tiap menit apakah izin buka per situs sudah kedaluwarsa. |
| `offscreen`, `clipboardWrite` | Mengosongkan clipboard saat tombol panik ditekan. |
| Akses ke semua situs (`<all_urls>`) | Menampilkan layar kunci di atas halaman web mana pun. Skrip hanya menyembunyikan halaman dan menampilkan layar kunci, tidak membaca atau mengubah isinya. |

## Kontak
Pertanyaan: <https://faquloh.site/>

## Perubahan
Kalau kebijakan ini berubah, tanggal di atas diperbarui dan perubahan dicatat di repositori.
