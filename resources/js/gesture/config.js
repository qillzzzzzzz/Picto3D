const viteEnv = typeof import.meta.env === 'object' ? import.meta.env : {};

export const GESTURE_MODE = Object.freeze({
    IDLE: 'idle',
    // Jempol + telunjuk tangan kiri mencubit lalu digerakkan.
    ROTATE_OBJECT: 'rotate-object',
    // Peace sign tangan kiri: jari telunjuk + jari tengah terbuka (huruf V).
    STRETCH: 'stretch',
    // Tangan mengepal lalu digerakkan untuk mengorbit sudut pandang.
    ORBIT_CAMERA: 'orbit-camera',
});

export const DEFAULT_MEDIAPIPE_CONFIG = Object.freeze({
    wasmPath: viteEnv.VITE_MEDIAPIPE_WASM_PATH
        ?? '/mediapipe/wasm',
    modelPath: viteEnv.VITE_MEDIAPIPE_HAND_MODEL_PATH
        ?? 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    delegate: 'GPU',
    numHands: 2,
    minHandDetectionConfidence: 0.72,
    minHandPresenceConfidence: 0.7,
    minTrackingConfidence: 0.68,
    inferenceIntervalMs: 34,
});

export const DEFAULT_GESTURE_THRESHOLDS = Object.freeze({
    preferredHand: 'Left',
    pinchRatio: 0.3,
    pinchReleaseRatio: 0.42,
    // Rasio jarak minimum antar ujung telunjuk & tengah (dibagi ukuran telapak)
    // agar dianggap membentuk huruf V yang benar-benar terbuka.
    peaceMiddleSeparationRatio: 0.32,
    // Rasio jarak maksimum ujung ibu jari ke pusat telapak agar dianggap
    // terlipat (tucked-in) saat melakukan peace sign.
    peaceThumbTuckRatio: 0.62,
    fingerStraightAngle: 158,
    foldedFingerAngle: 138,
    stableFrames: 5,
    idleStableFrames: 3,
    movementDeadZone: 0.004,
    pointSmoothing: 0.38,
});
