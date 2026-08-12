<?php

namespace App\Services;

use Illuminate\Http\Client\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use RuntimeException;

final class YoloClient
{
    /**
     * @return array<string, mixed>
     */
    public function detect(UploadedFile $frame, float $confidence, ?string $model = null): array
    {
        $baseUrl = rtrim((string) config('services.yolo.url'), '/');
        $token = (string) config('services.yolo.token');
        $timeout = (float) config('services.yolo.timeout', 15);

        if ($baseUrl === '') {
            throw new RuntimeException('YOLO service URL belum dikonfigurasi.');
        }

        if ($token === '') {
            throw new RuntimeException('YOLO service token belum dikonfigurasi.');
        }

        $contents = file_get_contents($frame->getRealPath());

        if ($contents === false) {
            throw new RuntimeException('Frame upload tidak dapat dibaca.');
        }

        $formFields = [
            'confidence' => (string) $confidence,
        ];

        if ($model !== null && $model !== '') {
            $formFields['model'] = $model;
        }

        $response = Http::acceptJson()
            ->withToken($token)
            ->connectTimeout(2)
            ->timeout($timeout)
            ->attach(
                'file',
                $contents,
                'frame.jpg',
                ['Content-Type' => $frame->getMimeType() ?: 'image/jpeg'],
            )
            ->post("{$baseUrl}/detect", $formFields);

        return $this->decodeResponse($response);
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeResponse(Response $response): array
    {
        $response->throw();

        $payload = $response->json();

        if (! is_array($payload)) {
            throw new RuntimeException('Respons YOLO bukan JSON object yang valid.');
        }

        return $payload;
    }
}