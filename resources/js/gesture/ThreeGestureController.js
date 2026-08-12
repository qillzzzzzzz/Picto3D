import * as THREE from 'three';
import { GESTURE_MODE } from './config.js';
import { clamp } from './gestureMath.js';

export class ThreeGestureController {
    constructor(options) {
        this.camera = options.camera;
        this.controls = options.controls;
        this.getObject = options.getObject;
        this.handleManager = options.handleManager ?? null;
        this.onStretch = options.onStretch ?? (() => {});
        this.rotateObjectSpeed = options.rotateObjectSpeed ?? 8;
        this.orbitSpeed = options.orbitSpeed ?? 5.5;
        this.stretchSpeed = options.stretchSpeed ?? 7;
        this.minScale = options.minScale ?? 0.25;
        this.maxScale = options.maxScale ?? 4;
        this.enabled = true;
        this.previousMode = GESTURE_MODE.IDLE;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.controls.enabled = true;
        this.previousMode = GESTURE_MODE.IDLE;
    }

    apply(gesture) {
        if (!this.enabled) {
            return {};
        }

        const active = gesture.mode !== GESTURE_MODE.IDLE;
        this.controls.enabled = !active;

        if (gesture.mode === GESTURE_MODE.ROTATE_OBJECT) {
            this.#rotateObject(gesture.delta);
        } else if (gesture.mode === GESTURE_MODE.STRETCH) {
            this.#stretchObject(gesture.delta);
        } else if (gesture.mode === GESTURE_MODE.ORBIT_CAMERA) {
            this.#orbitCamera(gesture.delta);
        }

        if (this.previousMode !== gesture.mode && !active) {
            this.controls.update();
        }

        this.previousMode = gesture.mode;
        return {};
    }

    resetInteraction() {
        this.previousMode = GESTURE_MODE.IDLE;
        this.controls.enabled = true;
    }

    #rotateObject(delta) {
        const object = this.getObject();
        if (!object || (delta.x === 0 && delta.y === 0)) {
            return;
        }

        const cameraUp = new THREE.Vector3(0, 1, 0)
            .applyQuaternion(this.camera.quaternion)
            .normalize();
        const cameraRight = new THREE.Vector3(1, 0, 0)
            .applyQuaternion(this.camera.quaternion)
            .normalize();
        const yaw = new THREE.Quaternion().setFromAxisAngle(
            cameraUp,
            delta.x * this.rotateObjectSpeed,
        );
        const pitch = new THREE.Quaternion().setFromAxisAngle(
            cameraRight,
            delta.y * this.rotateObjectSpeed,
        );

        object.quaternion.premultiply(yaw).premultiply(pitch).normalize();
        object.updateMatrixWorld(true);
        this.handleManager?.syncTransformFromTarget();
    }

    #stretchObject(delta) {
        const object = this.getObject();
        if (!object || delta.y === 0) {
            return;
        }

        const currentScaleY = Math.max(Math.abs(object.scale.y), 0.0001);
        const factor = clamp(
            1 - delta.y * this.stretchSpeed,
            this.minScale / currentScaleY,
            this.maxScale / currentScaleY,
        );

        if (Math.abs(factor - 1) < 0.0001) {
            return;
        }

        const anchorLocal = this.handleManager?.getSelectedAnchorLocalPosition() ?? null;
        const anchorBefore = anchorLocal ? object.localToWorld(anchorLocal.clone()) : null;

        object.scale.y *= factor;
        object.updateMatrixWorld(true);

        if (anchorLocal && anchorBefore) {
            const anchorAfter = object.localToWorld(anchorLocal.clone());
            object.position.add(anchorBefore.sub(anchorAfter));
        }

        object.updateMatrixWorld(true);
        this.onStretch(factor);
        this.handleManager?.syncTransformFromTarget();
    }

    #orbitCamera(delta) {
        if (delta.x === 0 && delta.y === 0) {
            return;
        }

        const offset = this.camera.position.clone().sub(this.controls.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta -= delta.x * this.orbitSpeed;
        spherical.phi = clamp(
            spherical.phi + delta.y * this.orbitSpeed,
            0.12,
            Math.PI - 0.12,
        );

        offset.setFromSpherical(spherical);
        this.camera.position.copy(this.controls.target).add(offset);
        this.camera.lookAt(this.controls.target);
        this.controls.update();
    }
}
