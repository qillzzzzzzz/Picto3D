<?php

namespace App\Http\Controllers;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

final class DetectionController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'frame' => ['required', 'file', 'image', 'mimes:jpeg,jpg,png,webp', 'max:4096'],
            'confidence' => ['nullable', 'numeric', 'min:0.05', 'max:1'],
        ]);

        $frame = $request->file('frame');
        $confidence = (string) ($validated['confidence'] ?? 0.18);
        $serviceUrl = rtrim((string) config('yolo.url'), '/');
        $token = (string) config('yolo.token');

        if ($token === '') {
            return response()->json([
                'message' => 'YOLO_API_TOKEN belum dikonfigurasi pada Laravel.',
            ], 500);
        }

        $postData = [
            'confidence' => $confidence,
        ];

        try {
            $response = Http::acceptJson()
                ->withToken($token)
                ->connectTimeout((int) config('yolo.connect_timeout', 3))
                ->timeout((int) config('yolo.timeout', 20))
                ->attach(
                    'file',
                    file_get_contents($frame->getRealPath()),
                    $frame->getClientOriginalName() ?: 'frame.jpg',
                    ['Content-Type' => $frame->getMimeType() ?: 'image/jpeg'],
                )
                ->post("{$serviceUrl}/detect", $postData);
        } catch (ConnectionException $error) {
            report($error);

            return response()->json([
                'message' => 'Layanan YOLO tidak dapat dihubungi. Pastikan FastAPI sedang berjalan.',
            ], 502);
        }

        if ($response->failed()) {
            return response()->json([
                'message' => $response->json('detail')
                    ?? $response->json('message')
                    ?? 'Layanan YOLO gagal memproses frame.',
                'errors' => $response->json('detail'),
            ], $response->status());
        }

        return response()->json($response->json());
    }
}
