import { GESTURE_MODE, DEFAULT_GESTURE_THRESHOLDS } from './config.js';
import {
    applyDeadZone,
    getPalmCenter,
    getPeaceCenter,
    getPinchCenter,
    isFist,
    isPeaceSign,
    isPinching,
    smoothPoint,
} from './gestureMath.js';

export class GestureInterpreter {
    constructor(options = {}) {
        this.thresholds = {
            ...DEFAULT_GESTURE_THRESHOLDS,
            ...options.thresholds,
        };
        this.mirrored = options.mirrored ?? true;
        this.reset();
    }

    reset() {
        this.activeMode = GESTURE_MODE.IDLE;
        this.candidateMode = GESTURE_MODE.IDLE;
        this.candidateFrames = 0;
        this.previousPoint = null;
        this.smoothedPoint = null;
    }

    update(results) {
        const hands = results?.landmarks ?? [];
        const detection = this.#detectMode(results, hands);
        const modeChanged = this.#stabilizeMode(detection.mode);

        if (modeChanged) {
            this.previousPoint = null;
            this.smoothedPoint = null;
        }

        const activeHand = this.#resolveActiveHand(results, hands, this.activeMode);
        if (!activeHand) {
            return this.#idleGesture(hands.length);
        }

        if (this.activeMode === GESTURE_MODE.ROTATE_OBJECT) {
            return this.#createPointerGesture(
                this.activeMode,
                activeHand.landmarks,
                'pinch',
                hands.length,
            );
        }

        if (this.activeMode === GESTURE_MODE.STRETCH) {
            return this.#createPointerGesture(
                this.activeMode,
                activeHand.landmarks,
                'peace',
                hands.length,
            );
        }

        if (this.activeMode === GESTURE_MODE.ORBIT_CAMERA) {
            return this.#createPointerGesture(
                this.activeMode,
                activeHand.landmarks,
                'palm',
                hands.length,
            );
        }

        return this.#idleGesture(hands.length);
    }

    #detectMode(results, hands) {
        // Fist diperiksa pertama karena ibu jari yang menutup dapat terlihat
        // dekat dengan telunjuk dan keliru dianggap sebagai pinch.
        const fistIndex = hands.findIndex(hand => isFist(hand, this.thresholds));
        if (fistIndex >= 0) {
            return { mode: GESTURE_MODE.ORBIT_CAMERA, handIndex: fistIndex };
        }

        const preferred = this.#getPreferredHand(results, hands);
        if (!preferred) {
            return { mode: GESTURE_MODE.IDLE, handIndex: -1 };
        }

        if (isPeaceSign(preferred.landmarks, this.thresholds)) {
            return { mode: GESTURE_MODE.STRETCH, handIndex: preferred.index };
        }

        if (isPinching(preferred.landmarks, this.thresholds.pinchRatio)) {
            return { mode: GESTURE_MODE.ROTATE_OBJECT, handIndex: preferred.index };
        }

        return { mode: GESTURE_MODE.IDLE, handIndex: -1 };
    }

    #resolveActiveHand(results, hands, mode) {
        if (mode === GESTURE_MODE.ORBIT_CAMERA) {
            const index = hands.findIndex(hand => isFist(hand, this.thresholds));
            return index >= 0 ? { index, landmarks: hands[index] } : null;
        }

        if (mode === GESTURE_MODE.ROTATE_OBJECT || mode === GESTURE_MODE.STRETCH) {
            return this.#getPreferredHand(results, hands);
        }

        return null;
    }

    #getPreferredHand(results, hands) {
        if (hands.length === 0) {
            return null;
        }

        // Saat hanya satu tangan terlihat, tetap gunakan tangan tersebut agar
        // kontrol tidak berhenti hanya karena label handedness MediaPipe sesaat
        // tertukar. Saat dua tangan terlihat, tangan kiri diprioritaskan.
        if (hands.length === 1) {
            return { index: 0, landmarks: hands[0] };
        }

        const preferredLabel = String(this.thresholds.preferredHand).toLowerCase();
        const index = (results?.handednesses ?? []).findIndex((categories) => {
            const category = categories?.[0];
            const label = String(category?.categoryName ?? category?.displayName ?? '').toLowerCase();
            return label === preferredLabel;
        });

        const resolvedIndex = index >= 0 ? index : 0;
        return { index: resolvedIndex, landmarks: hands[resolvedIndex] };
    }

    #stabilizeMode(detectedMode) {
        if (detectedMode !== this.candidateMode) {
            this.candidateMode = detectedMode;
            this.candidateFrames = 1;
            return false;
        }

        this.candidateFrames += 1;
        const requiredFrames = detectedMode === GESTURE_MODE.IDLE
            ? this.thresholds.idleStableFrames
            : this.thresholds.stableFrames;

        if (this.activeMode !== detectedMode && this.candidateFrames >= requiredFrames) {
            this.activeMode = detectedMode;
            return true;
        }

        return false;
    }

    #createPointerGesture(mode, landmarks, pointType, handCount) {
        let rawPoint;
        if (pointType === 'pinch') {
            rawPoint = getPinchCenter(landmarks, this.mirrored);
        } else if (pointType === 'peace') {
            rawPoint = getPeaceCenter(landmarks, this.mirrored);
        } else {
            rawPoint = getPalmCenter(landmarks, this.mirrored);
        }
        const point = smoothPoint(
            this.smoothedPoint,
            rawPoint,
            this.thresholds.pointSmoothing,
        );
        const previousPoint = this.previousPoint;
        this.smoothedPoint = point;
        this.previousPoint = point;

        if (!previousPoint) {
            return {
                mode,
                handCount,
                point,
                delta: { x: 0, y: 0 },
            };
        }

        return {
            mode,
            handCount,
            point,
            delta: {
                x: applyDeadZone(
                    point.x - previousPoint.x,
                    this.thresholds.movementDeadZone,
                ),
                y: applyDeadZone(
                    point.y - previousPoint.y,
                    this.thresholds.movementDeadZone,
                ),
            },
        };
    }

    #idleGesture(handCount) {
        return {
            mode: GESTURE_MODE.IDLE,
            handCount,
            point: null,
            delta: { x: 0, y: 0 },
        };
    }
}
