<?php

use App\Http\Controllers\DetectionController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('home');
})->name('home');

Route::get('/camera', function () {
    return view('camera');
})->name('camera');

Route::get('/editor', function () {
    return view('editor');
})->name('editor');

Route::post('/api/detections', DetectionController::class)
    ->middleware('throttle:600,1')
    ->name('detections.store');

require __DIR__.'/device-sessions.php';