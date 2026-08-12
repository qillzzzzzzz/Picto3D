#!/bin/bash
set -e
 
# Jalankan migration otomatis saat startup (opsional, hapus kalau tidak mau)
php artisan config:cache
php artisan route:cache
php artisan view:cache
 
# Jalankan PHP-FPM di background
php-fpm -D
 
# Jalankan Nginx di foreground (biar container tetap hidup)
nginx -g "daemon off;"
 
