# Menjalankan Deteksi Kamera di GPU NVIDIA

Zip yang Anda upload hanya berisi `resources/` (Blade + JS + CSS) — tidak ada
kode backend (`app/Http/Controllers`, `routes/`, atau service Python yang
menjalankan model YOLO). Karena "ganti kamera pakai GPU NVIDIA" pada
dasarnya adalah perubahan **di sisi backend inferensi**, folder ini berisi
referensi lengkap yang bisa langsung Anda pasang, ATAU kirimkan backend Anda
yang sekarang supaya saya edit langsung bagian device-nya.

## Yang disediakan di sini

- `python/yolo_gpu_server.py` — microservice FastAPI yang menjalankan model
  YOLO (`ultralytics`) di `cuda:0` (GPU NVIDIA pertama) kalau tersedia,
  fallback otomatis ke CPU kalau tidak ada GPU/driver CUDA.
- `laravel/DetectionController.php` — controller Laravel referensi yang
  meneruskan (proxy) frame dari browser ke service Python di atas lewat
  HTTP, lalu meneruskan hasil JSON-nya apa adanya ke frontend.

Kontrak JSON keduanya **sudah disesuaikan** dengan yang dibaca oleh
`resources/js/cv/YoloDetector.js` dan `resources/js/camera-detection.js`
saat ini, jadi tidak perlu ubah kode JS sama sekali.

## Langkah pemasangan

1. **Siapkan environment Python** (di server/mesin yang punya GPU NVIDIA):
   ```bash
   pip install ultralytics fastapi "uvicorn[standard]" python-multipart
   # Pasang torch versi CUDA sesuai driver NVIDIA Anda, contoh CUDA 12.1:
   pip install torch --index-url https://download.pytorch.org/whl/cu121
   ```
2. Cek driver terpasang & terdeteksi:
   ```bash
   nvidia-smi
   python3 -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
   ```
3. Taruh file model terlatih Anda (`best.pt`) di folder yang sama dengan
   `yolo_gpu_server.py`, atau set `YOLO_MODEL_PATH=/path/ke/best.pt`.
4. Jalankan service:
   ```bash
   uvicorn yolo_gpu_server:app --host 0.0.0.0 --port 8000
   ```
   Cek: `curl http://127.0.0.1:8000/health` harus mengembalikan
   `"cuda_available": true` dan nama GPU Anda.
5. **Di sisi Laravel**, salin `laravel/DetectionController.php` ke
   `app/Http/Controllers/DetectionController.php` (atau sesuaikan
   controller yang sudah ada), pastikan route `detections.store` mengarah
   ke method `store`, dan tambahkan di `.env`:
   ```
   YOLO_GPU_SERVICE_URL=http://127.0.0.1:8000/detect
   ```
6. Jalankan ulang `npm run build` / `npm run dev` untuk memuat perubahan
   `resources/js/camera-detection.js` (menampilkan badge "Compute Device"
   di halaman kamera — akan menampilkan "GPU · NVIDIA GeForce ..." begitu
   backend GPU aktif).

## Kalau backend Anda sudah ada dan berbeda dari referensi ini

Upload saja file controller/inference-service yang sekarang Anda pakai
(Laravel controller-nya, atau script Python/Node inferensinya), saya akan
edit langsung bagian pemilihan device-nya ke GPU NVIDIA (`device=0` /
`cuda:0`) tanpa mengganti arsitektur yang sudah Anda punya.
