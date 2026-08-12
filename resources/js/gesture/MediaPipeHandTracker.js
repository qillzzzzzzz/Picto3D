import { cssColor } from '../theme.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { DEFAULT_MEDIAPIPE_CONFIG } from './config.js';

const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17],
];

export class MediaPipeHandTracker {
    constructor(options) {
        if (!options?.video) {
            throw new Error('Elemen video wajib diberikan ke MediaPipeHandTracker.');
        }

        this.video = options.video;
        this.canvas = options.canvas ?? null;
        this.onResults = options.onResults ?? (() => {});
        this.onStateChange = options.onStateChange ?? (() => {});
        this.mirrored = options.mirrored ?? true;
        this.config = {
            ...DEFAULT_MEDIAPIPE_CONFIG,
            ...options.config,
        };

        this.handLandmarker = null;
        this.stream = null;
        this.animationFrameId = null;
        this.running = false;
        this.lastVideoTime = -1;
        this.lastInferenceAt = 0;
    }

    async initialize() {
        if (this.handLandmarker) {
            return;
        }

        this.onStateChange('loading-model');

        const vision = await FilesetResolver.forVisionTasks(this.config.wasmPath);
        const baseOptions = {
            modelAssetPath: this.config.modelPath,
            delegate: this.config.delegate,
        };

        try {
            this.handLandmarker = await this.#createLandmarker(vision, baseOptions);
        } catch (gpuError) {
            console.warn(
                'MediaPipe GPU delegate gagal. Mencoba CPU delegate.',
                gpuError,
            );

            this.handLandmarker = await this.#createLandmarker(vision, {
                ...baseOptions,
                delegate: 'CPU',
            });
        }

        this.onStateChange('model-ready');
    }

    async start() {
        if (this.running) {
            return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Browser tidak mendukung akses kamera melalui getUserMedia().');
        }

        await this.initialize();
        this.onStateChange('requesting-camera');

        this.stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'user',
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 30, max: 30 },
            },
            audio: false,
        });

        this.video.srcObject = this.stream;
        await this.video.play();

        this.#resizeCanvas();
        this.running = true;
        this.lastVideoTime = -1;
        this.lastInferenceAt = 0;
        this.onStateChange('running');
        this.#scheduleNextFrame();
    }

    stop() {
        this.running = false;

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        this.video.pause();
        this.video.srcObject = null;
        this.#clearCanvas();
        this.onStateChange('stopped');
    }

    destroy() {
        this.stop();
        this.handLandmarker?.close?.();
        this.handLandmarker = null;
    }

    async #createLandmarker(vision, baseOptions) {
        return HandLandmarker.createFromOptions(vision, {
            baseOptions,
            runningMode: 'VIDEO',
            numHands: this.config.numHands,
            minHandDetectionConfidence: this.config.minHandDetectionConfidence,
            minHandPresenceConfidence: this.config.minHandPresenceConfidence,
            minTrackingConfidence: this.config.minTrackingConfidence,
        });
    }

    #scheduleNextFrame() {
        this.animationFrameId = requestAnimationFrame(timestamp => {
            this.#detectFrame(timestamp);
        });
    }

    #detectFrame(timestamp) {
        if (!this.running) {
            return;
        }

        const isVideoReady = this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
        const isNewFrame = this.video.currentTime !== this.lastVideoTime;
        const intervalElapsed = timestamp - this.lastInferenceAt >= this.config.inferenceIntervalMs;

        if (isVideoReady && isNewFrame && intervalElapsed) {
            this.lastVideoTime = this.video.currentTime;
            this.lastInferenceAt = timestamp;

            try {
                const results = this.handLandmarker.detectForVideo(this.video, timestamp);
                this.#drawResults(results);
                this.onResults(results);
            } catch (error) {
                console.error('MediaPipe gagal memproses frame kamera.', error);
                this.onStateChange('inference-error', error);
            }
        }

        this.#scheduleNextFrame();
    }

    #resizeCanvas() {
        if (!this.canvas) {
            return;
        }

        this.canvas.width = this.video.videoWidth || 640;
        this.canvas.height = this.video.videoHeight || 480;
    }

    #clearCanvas() {
        if (!this.canvas) {
            return;
        }

        this.canvas.getContext('2d')?.clearRect(
            0,
            0,
            this.canvas.width,
            this.canvas.height,
        );
    }

    #drawResults(results) {
        if (!this.canvas) {
            return;
        }

        if (
            this.canvas.width !== this.video.videoWidth
            || this.canvas.height !== this.video.videoHeight
        ) {
            this.#resizeCanvas();
        }

        const context = this.canvas.getContext('2d');
        if (!context) {
            return;
        }

        context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        context.lineWidth = 3;
        context.lineCap = 'round';
        context.strokeStyle = cssColor('--gesture-line');
        context.fillStyle = cssColor('--gesture-point');

        for (const landmarks of results?.landmarks ?? []) {
            for (const [fromIndex, toIndex] of HAND_CONNECTIONS) {
                const from = this.#toCanvasPoint(landmarks[fromIndex]);
                const to = this.#toCanvasPoint(landmarks[toIndex]);

                context.beginPath();
                context.moveTo(from.x, from.y);
                context.lineTo(to.x, to.y);
                context.stroke();
            }

            for (const landmark of landmarks) {
                const point = this.#toCanvasPoint(landmark);
                context.beginPath();
                context.arc(point.x, point.y, 4, 0, Math.PI * 2);
                context.fill();
                context.stroke();
            }
        }
    }

    #toCanvasPoint(landmark) {
        return {
            x: (this.mirrored ? 1 - landmark.x : landmark.x) * this.canvas.width,
            y: landmark.y * this.canvas.height,
        };
    }
}
