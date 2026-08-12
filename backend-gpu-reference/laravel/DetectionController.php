<?php
/**
 * DetectionController.php (referensi)
 * ------------------------------------
 * Controller ini meneruskan (proxy) frame yang diupload dari browser
 * (resources/js/cv/YoloDetector.js & camera-detection.js, route
 * `detections.store`) ke microservice Python `yolo_gpu_server.py` yang
 * menjalankan inferensi YOLO di GPU NVIDIA (CUDA).
 *
 * PENTING: Ini adalah referensi/starter. Kalau proyek Anda sudah punya
 * DetectionController sendiri (mis. memanggil model lewat proses PHP-ML,
 * ONNX Runtime, atau service lain), kirimkan file itu ke saya supaya saya
 * ubah bagian device-nya langsung ke GPU NVIDIA, alih-alih memakai file
 * referensi ini.
 *
 * Pasang di routes/web.php atau routes/api.php:
 *   Route::post('/api/detections', [DetectionController::class, 'store'])
 *       ->name('detections.store');
 *
 * Set di .env:
 *   YOLO_GPU_SERVICE_URL=http://127.0.0.1:8000/detect
 */

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Http;

class DetectionController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'frame' => ['required', 'file', 'image', 'max:15360'], // 15MB
            'confidence' => ['nullable', 'numeric', 'min:0', 'max:1'],
        ]);

        $serviceUrl = config('services.yolo_gpu.url', env('YOLO_GPU_SERVICE_URL', 'http://127.0.0.1:8000/detect'));
        $confidence = (float) $request->input('confidence', 0.25);

        try {
            $response = Http::timeout(15)
                ->attach(
                    'frame',
                    file_get_contents($request->file('frame')->getRealPath()),
                    'frame.jpg'
                )
                ->asMultipart()
                ->post($serviceUrl, [
                    ['name' => 'confidence', 'contents' => (string) $confidence],
                ]);
        } catch (\Illuminate\Http\Client\ConnectionException $exception) {
            // Service GPU Python sedang mati / tidak bisa dihubungi.
            return response()->json([
                'message' => 'Layanan inferensi GPU (yolo_gpu_server.py) tidak dapat dihubungi. '
                    . 'Pastikan service tersebut sedang berjalan (uvicorn yolo_gpu_server:app).',
            ], 502);
        }

        if ($response->failed()) {
            return response()->json([
                'message' => 'Layanan inferensi GPU mengembalikan error.',
                'detail' => $response->body(),
            ], 502);
        }

        // Struktur JSON dari yolo_gpu_server.py sudah cocok 1:1 dengan yang
        // diharapkan frontend, jadi tinggal diteruskan apa adanya.
        return response()->json($response->json());
    }
}
