<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * DeviceSessionController
 *
 * Backend untuk fitur "Tambah Device" (pairing HP <-> desktop lewat QR code)
 * yang dipakai oleh:
 *  - resources/js/device-pairing.js   (sisi desktop: buat sesi, render QR, polling)
 *  - resources/js/device-camera-pair.js (sisi HP: connect, kirim deteksi)
 *  - resources/js/editor.js           (live-sync di halaman /editor)
 *
 * File ini TIDAK ADA di upload sebelumnya sehingga seluruh alur "scan HP ->
 * otomatis generate model 3D" putus di sisi backend walaupun frontend-nya
 * sudah lengkap. Kontrak endpoint di bawah ini dibuat 1:1 mengikuti apa yang
 * sudah dipanggil oleh file-file JS di atas.
 *
 * PENTING soal IP/jaringan (baca juga catatan di store()):
 * join_url SELALU dibangun dari host yang sedang dipakai browser desktop
 * saat request datang ($request->getSchemeAndHttpHost()), BUKAN dari
 * config('app.url'). Jadi kalau desktop diakses lewat IP LAN yang berbeda
 * (WiFi kantor vs rumah vs hotspot), setiap kali tombol "Buat QR Baru"
 * ditekan, QR yang dihasilkan otomatis memakai IP yang sedang aktif itu --
 * tidak perlu ubah .env tiap ganti jaringan.
 *
 * PENTING soal penyimpanan sesi:
 * Sesi disimpan lewat Cache facade. INI HARUS memakai driver yang persist
 * ANTAR REQUEST seperti "file", "database", atau "redis". Driver "array"
 * (sering jadi default CACHE_STORE di .env baru / testing) hanya hidup
 * selama satu request PHP saja -- kalau itu yang dipakai, request dari HP
 * (connect/detection) TIDAK PERNAH terlihat oleh polling dari desktop, dan
 * gejalanya persis seperti laporan awal: "sudah terdeteksi tapi 3D Studio
 * tidak pernah update". Cek nilai CACHE_STORE di .env kamu.
 */
class DeviceSessionController extends Controller
{
    /**
     * Sesi pairing berumur panjang (30 hari) supaya HP yang sudah pernah
     * connect bisa dipakai lagi tanpa scan QR ulang (lihat komentar di
     * device-pairing.js soal "Sambung Ulang").
     */
    public const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 hari

    private function cacheKey(string $token): string
    {
        return "device_session:{$token}";
    }

    /**
     * POST /device-sessions
     * Dipanggil dari device-pairing.js (createNewSession) saat tombol
     * "Tambah Device" / "Buat QR Baru" ditekan di desktop.
     */
    public function store(Request $request): JsonResponse
    {
        $token = (string) Str::uuid();

        $session = [
            'token' => $token,
            'status' => 'pending', // pending -> connected
            'device_label' => null,
            'created_at' => now()->toIso8601String(),
            'sequence' => 0,
            'detection' => null, // diisi begitu HP publish deteksi pertama
            // Nomor sequence terakhir yang SUDAH selesai dibangun jadi mesh 3D
            // di /editor (diisi oleh acknowledge()). Dipakai HP untuk tahu
            // kapan objek yang baru dikirim benar-benar sudah tergenerate,
            // bukan cuma "terkirim".
            'processed_sequence' => 0,
        ];

        Cache::put($this->cacheKey($token), $session, self::TTL_SECONDS);

        // Dibangun dari request saat ini -> otomatis mengikuti IP/host yang
        // sedang dipakai (mis. http://192.168.1.7:8000), bukan APP_URL statis.
        $joinUrl = $request->getSchemeAndHttpHost() . '/camera-pair/' . $token;

        return response()->json([
            'token' => $token,
            'join_url' => $joinUrl,
        ]);
    }

    /**
     * GET /device-sessions/{token}
     * Dipakai untuk dua hal:
     *  - Polling status dari desktop (device-pairing.js::poll, editor.js::pollDeviceSession)
     *  - Cek sesi masih ada saat "Sambung Ulang" (device-pairing.js::reconnectDevice)
     */
    public function show(string $token): JsonResponse
    {
        $session = Cache::get($this->cacheKey($token));

        if (!$session) {
            return response()->json(['message' => 'Sesi tidak ditemukan atau sudah kedaluwarsa.'], 404);
        }

        return response()->json($session);
    }

    /**
     * POST /device-sessions/{token}/connect
     * Dipanggil dari device-camera-pair.js begitu halaman /camera-pair/{token}
     * dibuka di HP (setelah scan QR atau buka bookmark).
     */
    public function connect(Request $request, string $token): JsonResponse
    {
        $key = $this->cacheKey($token);
        $session = Cache::get($key);

        if (!$session) {
            return response()->json(['message' => 'Sesi tidak ditemukan atau sudah kedaluwarsa.'], 404);
        }

        $session['status'] = 'connected';
        $session['device_label'] = $session['device_label'] ?? $this->guessDeviceLabel($request);
        $session['connected_at'] = now()->toIso8601String();

        Cache::put($key, $session, self::TTL_SECONDS);

        return response()->json($session);
    }

    /**
     * POST /device-sessions/{token}/detection
     * Dipanggil dari device-camera-pair.js (publishDetection) tiap kali HP
     * mendapat deteksi yang stabil. sequence di-increment di server supaya
     * device-pairing.js & editor.js bisa tahu ini deteksi BARU (bukan yang
     * sudah pernah diproses) lewat perbandingan `sequence > lastSequence`.
     */
    public function detection(Request $request, string $token): JsonResponse
    {
        $key = $this->cacheKey($token);
        $session = Cache::get($key);

        if (!$session) {
            return response()->json(['message' => 'Sesi tidak ditemukan atau sudah kedaluwarsa.'], 404);
        }

        $validated = $request->validate([
            'label' => 'required|string|max:100',
            'confidence' => 'required|numeric|min:0|max:1',
            // Data URL base64 hasil crop dari kamera HP. Batas 8MB kira-kira
            // cukup untuk gambar hasil kompres JPEG dari camera-detection.js;
            // naikkan kalau kamu menaikkan capture-max-width di camera-pair.blade.php.
            'image' => 'required|string|max:11000000',
        ]);

        $session['sequence'] = (int) ($session['sequence'] ?? 0) + 1;
        $session['status'] = 'connected';
        $session['detection'] = [
            'label' => $validated['label'],
            'confidence' => $validated['confidence'],
            'image' => $validated['image'],
            'sequence' => $session['sequence'],
        ];

        Cache::put($key, $session, self::TTL_SECONDS);

        return response()->json(['ok' => true, 'sequence' => $session['sequence']]);
    }

    /**
     * POST /device-sessions/{token}/ack
     * Dipanggil dari editor.js SETELAH mesh 3D untuk sebuah deteksi selesai
     * dibangun di scene (bukan sekadar diterima). HP (device-camera-pair.js)
     * lalu polling endpoint show() dan membandingkan `processed_sequence`
     * dengan sequence yang baru dia kirim -- begitu sama/lebih besar, HP
     * menampilkan notif "Model 3D berhasil dibuat".
     */
    public function acknowledge(Request $request, string $token): JsonResponse
    {
        $key = $this->cacheKey($token);
        $session = Cache::get($key);

        if (!$session) {
            return response()->json(['message' => 'Sesi tidak ditemukan atau sudah kedaluwarsa.'], 404);
        }

        $validated = $request->validate([
            'sequence' => ['required', 'integer', 'min:1'],
        ]);

        $session['processed_sequence'] = max(
            (int) ($session['processed_sequence'] ?? 0),
            $validated['sequence'],
        );

        Cache::put($key, $session, self::TTL_SECONDS);

        return response()->json(['ok' => true, 'processed_sequence' => $session['processed_sequence']]);
    }

    /**
     * DELETE /device-sessions/{token}
     * Dipanggil dari desktop ("Batalkan Sesi") maupun HP ("Akhiri Sesi").
     */
    public function destroy(string $token): JsonResponse
    {
        Cache::forget($this->cacheKey($token));

        return response()->json(['ok' => true]);
    }

    private function guessDeviceLabel(Request $request): string
    {
        $agent = (string) $request->userAgent();

        return match (true) {
            str_contains($agent, 'iPhone') => 'iPhone',
            str_contains($agent, 'iPad') => 'iPad',
            str_contains($agent, 'Android') => 'HP Android',
            default => 'Perangkat',
        };
    }
}
