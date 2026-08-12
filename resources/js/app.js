import '../css/app.css';
import { createIcons } from './icons.js';

function initializeGlobalUi() {
    createIcons();

    const mobileToggleButton = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');

    mobileToggleButton?.addEventListener('click', () => {
        mobileMenu?.classList.toggle('open');
    });
}

async function initializeCurrentPage() {
    if (document.getElementById('three-container')) {
        const { initEditorPage } = await import('./editor.js');
        initEditorPage();
        return;
    }

    // Halaman yang dibuka HP setelah scan QR "Tambah Device". Dicek lebih
    // dulu karena elemen di dalamnya (mis. #camera-video) juga cocok dengan
    // kondisi kamera biasa di bawah.
    if (document.getElementById('device-pair-app')) {
        const { initDeviceCameraPairPage } = await import('./device-camera-pair.js');
        initDeviceCameraPairPage();
        return;
    }

    // Halaman "3D Kamera" (desktop). Tidak lagi punya kamera browser sendiri
    // — satu-satunya cara memindai objek adalah menyambungkan kamera HP lewat
    // modal "Tambah Device", jadi hanya device-pairing.js yang diinisialisasi.
    if (document.getElementById('camera-app')) {
        const { initDevicePairing } = await import('./device-pairing.js');
        initDevicePairing();
        return;
    }

    if (document.getElementById('camera-video') || document.getElementById('webcam-video')) {
        const { initCameraPage } = await import('./camera.js');
        initCameraPage();
        return;
    }

    if (document.getElementById('drop-zone')) {
        const { initHomePage } = await import('./home.js');
        initHomePage();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    initializeGlobalUi();

    try {
        await initializeCurrentPage();
    } catch (error) {
        console.error('Gagal menginisialisasi halaman.', error);
    }
});
