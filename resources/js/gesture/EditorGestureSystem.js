import { GESTURE_MODE } from './config.js';
import { GestureInterpreter } from './GestureInterpreter.js';
import { MediaPipeHandTracker } from './MediaPipeHandTracker.js';
import { ThreeGestureController } from './ThreeGestureController.js';

const MODE_LABELS = Object.freeze({
    [GESTURE_MODE.IDLE]: 'Siap — tampilkan tangan ke kamera',
    [GESTURE_MODE.ROTATE_OBJECT]: 'Cubit telunjuk kiri · rotate objek',
    [GESTURE_MODE.STRETCH]: 'Peace sign (telunjuk + tengah) kiri · memanjangkan objek',
    [GESTURE_MODE.ORBIT_CAMERA]: 'Mengepal · rotate point of view',
});

export class EditorGestureSystem {
    constructor(options) {
        this.button = options.button;
        this.statusElement = options.statusElement;
        this.video = options.video;
        this.canvas = options.canvas;
        this.interpreter = new GestureInterpreter({ mirrored: true });
        this.controller = new ThreeGestureController({
            camera: options.camera,
            controls: options.controls,
            getObject: options.getObject,
            handleManager: options.handleManager,
            onStretch: options.onStretch,
        });
        this.enabled = false;
        this.lastStatus = '';

        this.tracker = new MediaPipeHandTracker({
            video: this.video,
            canvas: this.canvas,
            mirrored: true,
            onResults: results => this.#handleResults(results),
            onStateChange: (state, error) => this.#handleTrackerState(state, error),
        });

        this.handleToggle = () => this.toggle();
    }

    bind() {
        if (!this.button || !this.video) {
            return;
        }

        this.button.addEventListener('click', this.handleToggle);
        this.#setStatus('Gesture nonaktif');
    }

    async toggle() {
        if (this.enabled) {
            this.stop();
            return;
        }

        await this.start();
    }

    async start() {
        this.button.disabled = true;
        this.#setStatus('Memuat MediaPipe...');

        try {
            await this.tracker.start();
            this.enabled = true;
            this.controller.setEnabled(true);
            this.button.textContent = 'Nonaktifkan Gesture';
            this.button.classList.add('active');
            this.#setStatus(MODE_LABELS[GESTURE_MODE.IDLE]);
        } catch (error) {
            console.error('Gesture recognition gagal dimulai.', error);
            this.enabled = false;
            this.#setStatus(this.#formatCameraError(error));
        } finally {
            this.button.disabled = false;
        }
    }

    stop() {
        this.tracker.stop();
        this.interpreter.reset();
        this.controller.resetInteraction();
        this.enabled = false;
        this.button.textContent = 'Aktifkan Gesture';
        this.button.classList.remove('active');
        this.#setStatus('Gesture nonaktif');
    }

    destroy() {
        this.button?.removeEventListener('click', this.handleToggle);
        this.tracker.destroy();
        this.controller.resetInteraction();
    }

    #handleResults(results) {
        if (!this.enabled) {
            return;
        }

        const gesture = this.interpreter.update(results);
        this.controller.apply(gesture);

        if (gesture.mode === GESTURE_MODE.IDLE && gesture.handCount === 0) {
            this.#setStatus('Tangan belum terdeteksi');
            return;
        }

        this.#setStatus(MODE_LABELS[gesture.mode]);
    }

    #handleTrackerState(state, error) {
        if (state === 'requesting-camera') {
            this.#setStatus('Meminta izin kamera...');
        } else if (state === 'loading-model') {
            this.#setStatus('Memuat model tangan...');
        } else if (state === 'inference-error') {
            this.#setStatus(`Kesalahan deteksi: ${error?.message ?? 'unknown error'}`);
        }
    }

    #setStatus(message) {
        if (!this.statusElement || message === this.lastStatus) {
            return;
        }

        this.lastStatus = message;
        this.statusElement.textContent = message;
    }

    #formatCameraError(error) {
        if (error?.name === 'NotAllowedError') {
            return 'Izin kamera ditolak. Izinkan kamera lalu coba lagi.';
        }
        if (error?.name === 'NotFoundError') {
            return 'Kamera tidak ditemukan pada perangkat ini.';
        }
        return `Gesture gagal: ${error?.message ?? 'kesalahan tidak diketahui'}`;
    }
}
