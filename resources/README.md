# Perubahan: Model 3D dari public/models + catatan fitur kamera HP

## 1) Objek terdeteksi -> pakai model dari public/models (SUDAH DIKERJAKAN)

File baru:
- `resources/js/3d/ModelCatalog.js` — peta label YOLO -> file model di `public/models`.
- `resources/js/3d/ModelLibrary.js` — loader GLTF/GLB (pakai `GLTFLoader` dari `three/addons`), menormalkan ukuran & pivot model supaya kompatibel dengan sistem handle/parametric scaling yang sudah ada.

File diubah:
- `resources/js/editor.js`
  - Fungsi baru `reconstructFromDetection()`: cek dulu ke `ModelCatalog` apakah label yang terdeteksi (mis. `"pen"`, `"spidol"`, `"scissors"`) punya model siap pakai. Kalau ada -> load `.glb`/`.gltf` itu. Kalau tidak ada yang cocok -> otomatis fallback ke `ObjectReconstructor` (perilaku lama: bentuk 3D diekstrusi mengikuti foto). Jadi tidak ada fitur lama yang hilang.
  - `cleanUpCurrentMesh`, `updateStats`, `applyRenderMode`, tombol export OBJ disesuaikan supaya jalan baik untuk mesh tunggal (hasil rekonstruksi foto) maupun `THREE.Group` multi-mesh (model dari katalog).

### Cara kerja pemetaan label -> model
`ModelCatalog.js` mencocokkan label dari YOLO (setelah dinormalkan jadi slug, sama seperti yang sudah dipakai di `ObjectReconstructor.js`) ke entri berikut:

| Label (contoh) | Model yang dipakai |
|---|---|
| pen, drawing-pen, rapido, pulpen | `Pen_3.6.glb` |
| retractable-pen, click-pen | `pen_HQ_test.glb` |
| brush-pen, kuas, color-pen | `stablio_color_pen_high_quality/scene.gltf` |
| spidol, marker, board-marker | `capped_permanent_marker_pens/scene.gltf` |
| stabilo, highlighter | `germains_stabilo_boss/scene.gltf` |
| eraser, penghapus | `eraser_-_silgi/scene.gltf` |
| ruler, penggaris | `metal_ruler/scene.gltf` |
| clip, paper-clip, klip | `paper_clip/scene.gltf` |
| binder-clip | `binder_clip/scene.gltf` |
| scissors, gunting | `scissor/scene.gltf` |
| tape, selotip, correction-tape | `brown_tape/scene.gltf` |
| pencil, pensil | `pencil_sharpener/scene.gltf` (belum ada model pensil polos — ini yang paling dekat, tinggal ganti kalau sudah ada modelnya) |

**Belum ada model** untuk: `wrinkle`/`correction-pen` (tipe-x cair), `protractor` (busur derajat), `stapler`/`term`, dan `paper` (lembar kertas polos). Untuk label-label ini sistem otomatis tetap pakai rekonstruksi foto seperti sebelumnya.

**Menambah model baru:** taruh folder/`.glb` baru di `public/models/`, lalu tambahkan satu entri baru di `CATALOG` pada `ModelCatalog.js` — tidak perlu ubah kode lain.

## 2) Kamera HP tidak langsung kirim ke 3D Design Studio (PERLU FILE TAMBAHAN)

Saya sudah telusuri seluruh alur front-end-nya dan **secara logika alurnya sudah lengkap**:

1. `device-camera-pair.js` (halaman yang dibuka HP setelah scan QR) — begitu satu label bertahan stabil beberapa frame, otomatis `POST /device-sessions/{token}/detection`.
2. `device-pairing.js` (sisi desktop) — polling `GET /device-sessions/{token}` tiap 1.5 detik, begitu ada `detection` baru langsung simpan gambarnya ke `localStorage` dan redirect ke `/editor`.

Karena kedua endpoint itu ditangani oleh `DeviceSessionController` (Laravel) yang **tidak ada di file `resources.zip` yang diupload** — hanya route, view, dan JS-nya yang ter-include — saya tidak bisa memastikan di mana persisnya alur ini putus di sisi kamu. Kemungkinan penyebab paling umum untuk kasus "sudah terdeteksi tapi gagal terkirim":

- Session store (`DeviceSessionController`) memakai cache driver yang tidak persist antar-request (mis. `array`) — jadi desktop tidak pernah melihat status `connected` atau `detection` yang dikirim HP.
- CSRF token beda konteks: halaman `camera-pair` dibuka di *device* lain (HP), jadi meta `csrf-token` di halaman itu harus benar-benar valid untuk sesi tersebut, bukan sesi desktop.
- Payload gambar (`base64` PNG hasil crop) melebihi `post_max_size` / limit body FastAPI-Laravel, sehingga `publishDetection()` di HP melempar error yang tertelan jadi toast "Gagal mengirim ke 3D Studio" tanpa detail lebih lanjut.
- Route `device-sessions.detection` belum menyimpan `sequence` yang increment, sehingga `if (detection.sequence > this.lastSequence)` di `device-pairing.js` tidak pernah `true`.

**Supaya saya bisa perbaiki bagian ini secara pasti**, tolong upload juga:
- `app/Http/Controllers/DeviceSessionController.php`
- `app/Http/Controllers/DetectionController.php`
- Model/`Cache`/`Session` terkait device pairing (kalau ada, mis. `app/Models/DeviceSession.php`)
- File `.env` bagian `SESSION_DRIVER` / `CACHE_STORE` (boleh disensor value-nya, yang penting nama drivernya)

Dengan file itu saya bisa cek persis di baris mana proses "terima deteksi dari HP -> simpan -> desktop baca lewat polling" berhenti.
