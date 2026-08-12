# Fitur "Tambah Device" (Kamera HP via QR Code)

## Apa yang dibuat

| # | Requirement | Bagaimana dipenuhi |
|---|---|---|
| 1 | Tambah device via scan QR di bagian Kamera 3D | Tombol **"Tambah Device"** baru di halaman `/camera` membuka modal berisi QR code. HP scan QR → langsung terhubung. |
| 2 | Fitur kamera HP untuk deteksi objek | Halaman baru `/camera/pair/{token}` — begitu dibuka (dari hasil scan), kamera HP **otomatis aktif** dan mendeteksi objek real-time, tanpa tombol lain. |
| 3 | Objek confidence tertinggi langsung ter-generate ke model 3D | Begitu satu label bertahan stabil beberapa frame, HP mengirim potongan gambarnya ke server. Desktop yang sedang polling langsung menyimpan gambar itu ke `localStorage['3d_editor_image']` (kunci yang sama sudah dipakai `editor.js`) dan redirect ke `/editor` — di mana proses rekonstruksi 3D yang sudah ada otomatis berjalan. |

Tidak ada WebSocket/Pusher yang dibutuhkan — pairing memakai polling HTTP ringan (setiap 1.5 detik) + Laravel Cache (bukan tabel DB baru), supaya plug-and-play di instalasi Laravel manapun.

## ⚠️ Wajib dibaca sebelum testing

### 1. Akses kamera HP butuh HTTPS

Browser (Chrome/Safari) **menolak `navigator.mediaDevices.getUserMedia`** (izin akses kamera) di halaman `http://` biasa — kecuali persis di `localhost`. Kalau kamu buka `/camera/pair/{token}` di HP lewat `http://192.168.x.x:8000`, kamera kemungkinan besar **gagal diminta izinnya sama sekali**, walau QR-nya sukses discan.

Solusi cepat untuk testing — pakai tunnel HTTPS gratis:

```bash
# 1) jalankan Laravel seperti biasa
php artisan serve

# 2) di terminal lain, buat tunnel HTTPS
ngrok http 8000
# atau: cloudflared tunnel --url http://localhost:8000
```

Set `APP_URL` di `.env` ke URL `https://...` yang diberikan ngrok/cloudflared, jalankan `php artisan config:clear`, lalu akses `/camera` lewat URL https itu (di laptop maupun saat scan QR dari HP). Untuk pemakaian jangka panjang, deploy ke domain dengan SSL asli (Let's Encrypt gratis).

### 2. Jangan pakai `127.0.0.1` di HP

`127.0.0.1` artinya "diri sendiri" — di HP itu merujuk ke HP itu sendiri, bukan ke laptop. Kalau tidak pakai tunnel HTTPS (opsi di atas), minimal HP harus mengakses **IP address laptop di jaringan WiFi** (misal `192.168.1.5:8000`), dan `APP_URL` di `.env` juga harus disetel ke alamat itu (karena isi QR code dibuat dari `APP_URL`, bukan dari URL yang sedang dibuka browser).

## Diketahui & sudah diperbaiki (v1.1)

- **Bug:** modal "Tambah Device" langsung tampil kosong dari awal & tidak bisa ditutup — atribut `hidden` di HTML ke-override oleh `display: flex` di CSS `.device-modal`. **Sudah diperbaiki** dengan menambahkan `.device-modal[hidden] { display: none; }`.
- **Bug kecil:** kalau pustaka QR gagal dimuat (mis. CDN diblokir), pesan errornya sempat ketimpa jadi "Menunggu HP…". Sudah diperbaiki supaya pesan error tetap tampil.

## File baru

- `app/Http/Controllers/DeviceSessionController.php` — kelola sesi pairing (buat sesi, cek status, terima deteksi, hapus sesi).
- `routes/device-sessions.php` — 5 route baru + 1 route halaman `/camera/pair/{token}`.
- `resources/views/camera-pair.blade.php` — halaman yang dibuka HP setelah scan QR.
- `resources/js/device-pairing.js` — sisi desktop: modal, generate QR, polling.
- `resources/js/device-camera-pair.js` — sisi HP: auto-connect, auto-start kamera, auto-publish saat deteksi stabil.

## File yang dimodifikasi

- `resources/views/camera.blade.php` — tambah tombol "Tambah Device" + modal QR.
- `resources/views/layouts/app.blade.php` — tambah `@yield('bodyClass')` di `<body>` (non-breaking, default kosong).
- `resources/js/app.js` — bootstrap halaman `device-pair-app` & modul `device-pairing.js`.
- `resources/js/camera-detection.js` — refactor: logic crop gambar diekstrak ke method `#buildCroppedDataUrl()` (dipakai ulang), plus hook baru `onStableDetection` untuk mode auto-publish. **Perilaku halaman `/camera` yang sudah ada TIDAK berubah** — hook hanya aktif kalau `onStableDetection` diberikan di constructor.
- `resources/css/app.css` — tambahan style di akhir file untuk modal, QR box, dan status badge halaman HP (termasuk fix `[hidden]` di atas).

## Langkah integrasi

1. **Salin file-file di atas** ke lokasi yang sama pada project Laravel kamu (timpa file yang dimodifikasi, karena isinya sudah termasuk kode lama + tambahan baru).

2. **Daftarkan route baru.** Di `routes/web.php`, tambahkan baris ini (paling bawah, setelah route `camera`, `editor`, `detections.store` yang sudah ada):

   ```php
   require __DIR__.'/device-sessions.php';
   ```

3. **Pastikan cache driver aktif** (default `file` di `.env` sudah cukup — tidak perlu Redis/Memcached). Cek `CACHE_STORE` (Laravel 11+) atau `CACHE_DRIVER` (Laravel ≤10) di `.env`.

4. **Build asset**:
   ```bash
   npm run build
   # atau saat development:
   npm run dev
   ```

5. **Testing manual** (pastikan sudah setup HTTPS/tunnel sesuai bagian ⚠️ di atas):
   - Buka `/camera` lewat URL https (ngrok/domain), klik **"Tambah Device"** → QR code muncul.
   - Scan QR pakai HP.
   - Di HP, izinkan akses kamera → arahkan ke sebuah objek.
   - Setelah beberapa detik terdeteksi stabil, HP menampilkan toast "✅ Terkirim ke 3D Studio".
   - Laptop otomatis redirect ke `/editor` dengan model 3D dari objek tersebut.

## Catatan teknis lain

- **QR code** digenerate 100% di browser (client-side) memakai library `qrcode` dari CDN jsDelivr — tidak perlu install package Composer/NPM tambahan.
- **Sesi pairing** kedaluwarsa otomatis setelah 15 menit (lihat `TTL_SECONDS` di `DeviceSessionController`), jadi tidak menumpuk data di cache.
- **Ukuran gambar** yang dikirim HP dibatasi ~4MB (base64) di sisi server sebagai guard sederhana.
- Kalau di kemudian hari ingin pairing real-time (tanpa polling) atau lintas-request lebih andal (bukan cache `file` driver di server dengan banyak worker), sesi ini bisa dipindah ke tabel database atau Redis — struktur data (`token`, `status`, `detection`, `build_sequence`) sudah dirancang agar mudah dipindah tanpa mengubah frontend.
