"""
yolo_gpu_server.py
-------------------
Microservice inferensi YOLO yang berjalan di NVIDIA GPU (CUDA) apabila
tersedia, dengan fallback otomatis ke CPU jika tidak ada GPU/CUDA terpasang.

Kontrak JSON respons SENGAJA dibuat sama persis dengan yang sudah dipakai
oleh frontend (resources/js/cv/YoloDetector.js dan camera-detection.js),
supaya server ini bisa langsung dipasang di belakang route Laravel
`detections.store` tanpa mengubah kode JS sama sekali:

{
  "detections": [
    {
      "class_id": 3,
      "class_name": "eraser",
      "confidence": 0.93,
      "x1": 120.0, "y1": 80.0, "x2": 340.0, "y2": 310.0
    },
    ...
  ],
  "image": { "width": 1280, "height": 720 },
  "inference_ms": 14.2,
  "model": "best.pt",
  "device": "cuda:0 (NVIDIA GeForce RTX 4070)"
}

Cara pakai:
  1. pip install fastapi uvicorn[standard] ultralytics python-multipart torch --extra-index-url https://download.pytorch.org/whl/cu121
     (sesuaikan versi CUDA wheel torch dengan driver NVIDIA yang terpasang)
  2. Taruh file model terlatih Anda sebagai `best.pt` di folder yang sama,
     atau set environment variable YOLO_MODEL_PATH.
  3. Jalankan:  uvicorn yolo_gpu_server:app --host 0.0.0.0 --port 8000
  4. Di Laravel, arahkan DetectionController untuk memanggil
     http://127.0.0.1:8000/detect (lihat laravel/DetectionController.php).
"""

import io
import os
import time

import torch
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image
from ultralytics import YOLO

MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", "best.pt")

app = FastAPI(title="YOLO GPU Inference Service")


def _resolve_device() -> str:
    """Prioritaskan NVIDIA GPU (CUDA). Kalau tidak ada, jatuh ke CPU."""
    if torch.cuda.is_available():
        return "cuda:0"
    return "cpu"


DEVICE = _resolve_device()
GPU_NAME = torch.cuda.get_device_name(0) if DEVICE.startswith("cuda") else None

print(f"[yolo_gpu_server] Memuat model '{MODEL_PATH}' pada device '{DEVICE}'"
      + (f" ({GPU_NAME})" if GPU_NAME else " (GPU NVIDIA tidak terdeteksi, memakai CPU)"))

model = YOLO(MODEL_PATH)
model.to(DEVICE)


def _device_label() -> str:
    if DEVICE.startswith("cuda"):
        return f"cuda:0 ({GPU_NAME})"
    return "cpu"


@app.post("/detect")
async def detect(frame: UploadFile = File(...), confidence: float = Form(0.25)):
    image_bytes = await frame.read()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    start = time.perf_counter()
    # device= dipaksa lagi di sini supaya setiap request pasti berjalan di
    # GPU NVIDIA yang sama, bukan device default ultralytics.
    results = model.predict(
        source=image,
        conf=confidence,
        device=DEVICE,
        verbose=False,
    )[0]
    inference_ms = (time.perf_counter() - start) * 1000

    detections = []
    for box in results.boxes:
        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
        class_id = int(box.cls[0].item())
        detections.append({
            "class_id": class_id,
            "class_name": results.names.get(class_id, str(class_id)),
            "confidence": float(box.conf[0].item()),
            "x1": x1, "y1": y1, "x2": x2, "y2": y2,
        })

    # Confidence tertinggi lebih dulu, supaya "label dengan persentase
    # tertinggi" gampang diambil oleh frontend (camera-detection.js).
    detections.sort(key=lambda d: d["confidence"], reverse=True)

    return JSONResponse({
        "detections": detections,
        "image": {"width": image.width, "height": image.height},
        "inference_ms": round(inference_ms, 2),
        "model": os.path.basename(MODEL_PATH),
        "device": _device_label(),
    })


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "device": _device_label(),
        "cuda_available": torch.cuda.is_available(),
    }
