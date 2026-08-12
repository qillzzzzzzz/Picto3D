<?php

return [
    'url' => env('YOLO_SERVICE_URL', 'http://127.0.0.1:8001'),
    'token' => env('YOLO_API_TOKEN', ''),
    'connect_timeout' => (int) env('YOLO_CONNECT_TIMEOUT', 3),
    'timeout' => (int) env('YOLO_REQUEST_TIMEOUT', 20),
];
