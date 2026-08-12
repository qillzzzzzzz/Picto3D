<?php

/**
 * Tambahkan blok ini ke routes/web.php (gabungkan use-statement di atas
 * kalau sudah ada use Illuminate\Support\Facades\Route lain).
 *
 * Route 'camera.pair' HARUS ada karena join_url yang dibuat
 * DeviceSessionController::store() mengarah ke /camera-pair/{token}, dan
 * camera-pair.blade.php sendiri butuh $token untuk mengisi data-connect-url
 * / data-publish-url lewat route('device-sessions.connect'/'detection', $token).
 */

use App\Http\Controllers\DeviceSessionController;

Route::get('/camera-pair/{token}', function (string $token) {
    return view('camera-pair', ['token' => $token]);
})->name('camera.pair');

Route::post('/device-sessions', [DeviceSessionController::class, 'store'])
    ->name('device-sessions.store');

Route::get('/device-sessions/{token}', [DeviceSessionController::class, 'show'])
    ->name('device-sessions.show');

Route::post('/device-sessions/{token}/connect', [DeviceSessionController::class, 'connect'])
    ->name('device-sessions.connect');

Route::post('/device-sessions/{token}/detection', [DeviceSessionController::class, 'detection'])
    ->name('device-sessions.detection');

Route::post('/device-sessions/{token}/ack', [DeviceSessionController::class, 'acknowledge'])
    ->name('device-sessions.ack');

Route::delete('/device-sessions/{token}', [DeviceSessionController::class, 'destroy'])
    ->name('device-sessions.destroy');
