import * as THREE from 'three';
import { cssColor } from './theme.js';

/**
 * Manages corner/edge handles around the current mesh. Besides pointer dragging,
 * it exposes screen-space corner selection so MediaPipe can choose a transform pivot.
 */
export class TransformHandleManager {
    constructor({ scene, camera, renderer, controls, onTransformUpdate, onSelectionChange }) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.controls = controls;
        this.onTransformUpdate = onTransformUpdate;
        this.onSelectionChange = onSelectionChange;
        this.targetMesh = null;
        this.handleGroup = new THREE.Group();
        this.handleGroup.name = 'TransformHandleGroup';
        this.scene.add(this.handleGroup);

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.dimensions = { width: 6, height: 4.5, depth: 2.5 };
        this.originalAspect = 6 / 4.5;
        this.lockAspect = true;
        this.snapEnabled = false;
        this.snapStep = 0.1;
        this.handlesVisible = true;

        this.activeHandle = null;
        this.hoveredHandle = null;
        this.selectedHandleId = null;
        this.isDragging = false;
        this.dragPlane = new THREE.Plane();
        this.initialDragPoint = new THREE.Vector3();
        this.initialDimensions = { ...this.dimensions };

        this.cornerHandles = [];
        this.edgeHandles = [];
        this.boxHelperLines = null;
        this.colors = {
            corner: cssColor('--color-primary'),
            selected: cssColor('--color-purple-bright'),
            edgeX: cssColor('--color-danger-bright'),
            edgeY: cssColor('--color-success'),
            edgeZ: cssColor('--color-primary-medium'),
            hover: cssColor('--color-warning-bright'),
            boxLine: cssColor('--color-text-muted'),
        };

        this.#initMaterialsAndGeometries();
        this.#bindEvents();
    }

    #initMaterialsAndGeometries() {
        this.cornerGeo = new THREE.SphereGeometry(0.22, 16, 16);
        this.cornerMat = new THREE.MeshStandardMaterial({
            color: this.colors.corner,
            roughness: 0.2,
            metalness: 0.3,
            emissive: cssColor('--color-primary-hover'),
            emissiveIntensity: 0.2,
        });
        this.edgeGeoX = new THREE.BoxGeometry(0.4, 0.18, 0.18);
        this.edgeGeoY = new THREE.BoxGeometry(0.18, 0.4, 0.18);
        this.edgeGeoZ = new THREE.BoxGeometry(0.18, 0.18, 0.4);
        this.edgeMatX = new THREE.MeshStandardMaterial({ color: this.colors.edgeX, roughness: 0.3, emissive: cssColor('--color-danger-dark'), emissiveIntensity: 0.2 });
        this.edgeMatY = new THREE.MeshStandardMaterial({ color: this.colors.edgeY, roughness: 0.3, emissive: cssColor('--color-success-dark'), emissiveIntensity: 0.2 });
        this.edgeMatZ = new THREE.MeshStandardMaterial({ color: this.colors.edgeZ, roughness: 0.3, emissive: cssColor('--color-primary-strong'), emissiveIntensity: 0.2 });
    }

    attach(mesh, dimensions, aspect) {
        this.targetMesh = mesh;
        this.dimensions = dimensions ? { ...dimensions } : this.dimensions;
        this.originalAspect = aspect || this.originalAspect;
        this.selectedHandleId = null;
        this.rebuildHandles();
        this.#emitSelectionChange();
    }

    detach() {
        this.targetMesh = null;
        this.selectedHandleId = null;
        this.clearGroup();
        this.#emitSelectionChange();
    }

    clearGroup() {
        for (const child of [...this.handleGroup.children]) {
            this.handleGroup.remove(child);

            if (child === this.boxHelperLines) {
                child.geometry?.dispose();
                child.material?.dispose();
            } else {
                child.material?.dispose();
            }
        }

        this.cornerHandles = [];
        this.edgeHandles = [];
        this.boxHelperLines = null;
        this.hoveredHandle = null;
        this.activeHandle = null;
    }

    setDimensions(width, height, depth) {
        this.dimensions.width = Math.max(0.2, width);
        this.dimensions.height = Math.max(0.2, height);
        this.dimensions.depth = Math.max(0.1, depth);
        this.updateHandlePositions();
    }

    setLockAspect(lock) {
        this.lockAspect = lock;
    }

    setSnapSettings(enabled, step = 0.1) {
        this.snapEnabled = enabled;
        this.snapStep = step;
    }

    setHandlesVisible(visible) {
        this.handlesVisible = visible;

        if (visible && this.targetMesh && this.cornerHandles.length === 0) {
            this.rebuildHandles();
        }

        this.handleGroup.visible = visible;
    }

    rebuildHandles() {
        const selectedId = this.selectedHandleId;
        this.clearGroup();

        if (!this.targetMesh || !this.handlesVisible) {
            return;
        }

        const width = this.dimensions.width / 2;
        const depth = this.dimensions.depth / 2;
        const centerY = this.dimensions.height / 2;
        const cornerSigns = [
            { x: -1, y: -1, z: -1, id: 'C_BLB' },
            { x: 1, y: -1, z: -1, id: 'C_BRB' },
            { x: -1, y: 1, z: -1, id: 'C_TLB' },
            { x: 1, y: 1, z: -1, id: 'C_TRB' },
            { x: -1, y: -1, z: 1, id: 'C_BLF' },
            { x: 1, y: -1, z: 1, id: 'C_BRF' },
            { x: -1, y: 1, z: 1, id: 'C_TLF' },
            { x: 1, y: 1, z: 1, id: 'C_TRF' },
        ];

        for (const corner of cornerSigns) {
            const mesh = new THREE.Mesh(this.cornerGeo, this.cornerMat.clone());
            mesh.userData = {
                type: 'corner',
                id: corner.id,
                signX: corner.x,
                signY: corner.y,
                signZ: corner.z,
                baseColor: this.colors.corner,
            };
            mesh.position.set(
                corner.x * width,
                corner.y === 1 ? this.dimensions.height : 0,
                corner.z * depth,
            );
            this.handleGroup.add(mesh);
            this.cornerHandles.push(mesh);
        }

        const edgeSpecs = [
            { id: 'E_X_RIGHT', axis: 'X', sign: 1, pos: [width, centerY, 0], geo: this.edgeGeoX, mat: this.edgeMatX },
            { id: 'E_X_LEFT', axis: 'X', sign: -1, pos: [-width, centerY, 0], geo: this.edgeGeoX, mat: this.edgeMatX },
            { id: 'E_Y_TOP', axis: 'Y', sign: 1, pos: [0, this.dimensions.height, 0], geo: this.edgeGeoY, mat: this.edgeMatY },
            { id: 'E_Y_BOTTOM', axis: 'Y', sign: -1, pos: [0, 0, 0], geo: this.edgeGeoY, mat: this.edgeMatY },
            { id: 'E_Z_FRONT', axis: 'Z', sign: 1, pos: [0, centerY, depth], geo: this.edgeGeoZ, mat: this.edgeMatZ },
            { id: 'E_Z_BACK', axis: 'Z', sign: -1, pos: [0, centerY, -depth], geo: this.edgeGeoZ, mat: this.edgeMatZ },
        ];

        for (const edge of edgeSpecs) {
            const baseColor = edge.axis === 'X'
                ? this.colors.edgeX
                : edge.axis === 'Y' ? this.colors.edgeY : this.colors.edgeZ;
            const mesh = new THREE.Mesh(edge.geo, edge.mat.clone());
            mesh.userData = {
                type: 'edge',
                id: edge.id,
                axis: edge.axis,
                sign: edge.sign,
                baseColor,
            };
            mesh.position.set(...edge.pos);
            this.handleGroup.add(mesh);
            this.edgeHandles.push(mesh);
        }

        this.#createBoundingLines(width, this.dimensions.height, depth);
        this.selectedHandleId = this.cornerHandles.some(handle => handle.userData.id === selectedId)
            ? selectedId
            : null;
        this.syncTransformFromTarget();
        this.#refreshAllHandleVisuals();
    }

    #createBoundingLines(width, height, depth) {
        const points = [
            new THREE.Vector3(-width, 0, -depth), new THREE.Vector3(width, 0, -depth),
            new THREE.Vector3(width, 0, -depth), new THREE.Vector3(width, 0, depth),
            new THREE.Vector3(width, 0, depth), new THREE.Vector3(-width, 0, depth),
            new THREE.Vector3(-width, 0, depth), new THREE.Vector3(-width, 0, -depth),
            new THREE.Vector3(-width, height, -depth), new THREE.Vector3(width, height, -depth),
            new THREE.Vector3(width, height, -depth), new THREE.Vector3(width, height, depth),
            new THREE.Vector3(width, height, depth), new THREE.Vector3(-width, height, depth),
            new THREE.Vector3(-width, height, depth), new THREE.Vector3(-width, height, -depth),
            new THREE.Vector3(-width, 0, -depth), new THREE.Vector3(-width, height, -depth),
            new THREE.Vector3(width, 0, -depth), new THREE.Vector3(width, height, -depth),
            new THREE.Vector3(width, 0, depth), new THREE.Vector3(width, height, depth),
            new THREE.Vector3(-width, 0, depth), new THREE.Vector3(-width, height, depth),
        ];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: this.colors.boxLine,
            transparent: true,
            opacity: 0.6,
        });
        this.boxHelperLines = new THREE.LineSegments(geometry, material);
        this.handleGroup.add(this.boxHelperLines);
    }

    updateHandlePositions() {
        if (!this.targetMesh || !this.handlesVisible) {
            return;
        }

        const width = this.dimensions.width / 2;
        const height = this.dimensions.height;
        const depth = this.dimensions.depth / 2;
        const centerY = height / 2;

        this.cornerHandles.forEach((mesh) => {
            const data = mesh.userData;
            mesh.position.set(
                data.signX * width,
                data.signY === 1 ? height : 0,
                data.signZ * depth,
            );
        });

        this.edgeHandles.forEach((mesh) => {
            const data = mesh.userData;
            if (data.axis === 'X') mesh.position.set(data.sign * width, centerY, 0);
            if (data.axis === 'Y') mesh.position.set(0, data.sign === 1 ? height : 0, 0);
            if (data.axis === 'Z') mesh.position.set(0, centerY, data.sign * depth);
        });

        if (this.boxHelperLines) {
            this.handleGroup.remove(this.boxHelperLines);
            this.boxHelperLines.geometry.dispose();
            this.boxHelperLines.material.dispose();
            this.#createBoundingLines(width, height, depth);
        }

        this.syncTransformFromTarget();
    }

    syncTransformFromTarget() {
        if (!this.targetMesh) {
            return;
        }

        this.handleGroup.position.copy(this.targetMesh.position);
        this.handleGroup.quaternion.copy(this.targetMesh.quaternion);
        this.handleGroup.scale.set(1, 1, 1);
        this.handleGroup.updateMatrixWorld(true);
    }

    selectNearestCorner(point, maximumDistance = 0.18) {
        if (!point || !this.targetMesh || !this.handlesVisible) {
            return null;
        }

        this.syncTransformFromTarget();
        this.camera.updateMatrixWorld(true);
        let best = null;

        for (const handle of this.cornerHandles) {
            const projected = new THREE.Vector3();
            handle.getWorldPosition(projected);
            projected.project(this.camera);
            const screenX = (projected.x + 1) / 2;
            const screenY = (1 - projected.y) / 2;
            const distance = Math.hypot(screenX - point.x, screenY - point.y);

            if (!best || distance < best.distance) {
                best = { handle, distance };
            }
        }

        if (!best || best.distance > maximumDistance) {
            return this.selectedHandleId;
        }

        this.setSelectedCorner(best.handle.userData.id);
        return this.selectedHandleId;
    }

    setSelectedCorner(handleId) {
        const nextId = this.cornerHandles.some(handle => handle.userData.id === handleId)
            ? handleId
            : null;

        if (nextId === this.selectedHandleId) {
            return;
        }

        this.selectedHandleId = nextId;
        this.#refreshAllHandleVisuals();
        this.#emitSelectionChange();
    }

    getSelectedCornerId() {
        return this.selectedHandleId;
    }

    getSelectedAnchorLocalPosition() {
        if (!this.targetMesh || !this.selectedHandleId) {
            return null;
        }

        const handle = this.cornerHandles.find(item => item.userData.id === this.selectedHandleId);
        if (!handle) {
            return null;
        }

        const baseWidth = this.targetMesh.userData.baseWidth || this.dimensions.width;
        const baseHeight = this.targetMesh.userData.baseHeight || this.dimensions.height;
        const baseDepth = this.targetMesh.userData.baseDepth || this.dimensions.depth;

        return new THREE.Vector3(
            handle.userData.signX * baseWidth / 2,
            handle.userData.signY === 1 ? baseHeight : 0,
            handle.userData.signZ * baseDepth / 2,
        );
    }

    getSelectedAnchorWorldPosition() {
        const local = this.getSelectedAnchorLocalPosition();
        return local && this.targetMesh ? this.targetMesh.localToWorld(local.clone()) : null;
    }

    #emitSelectionChange() {
        this.onSelectionChange?.(this.selectedHandleId);
    }

    #bindEvents() {
        const element = this.renderer.domElement;
        this.boundPointerMove = event => this.#onPointerMove(event);
        this.boundPointerDown = event => this.#onPointerDown(event);
        this.boundPointerUp = event => this.#onPointerUp(event);
        element.addEventListener('pointermove', this.boundPointerMove);
        element.addEventListener('pointerdown', this.boundPointerDown);
        window.addEventListener('pointerup', this.boundPointerUp);
    }

    #updateMouse(event) {
        const rectangle = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rectangle.left) / rectangle.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rectangle.top) / rectangle.height) * 2 + 1;
    }

    #onPointerMove(event) {
        this.#updateMouse(event);

        if (this.isDragging && this.activeHandle) {
            this.#handleDrag();
            return;
        }

        if (!this.handlesVisible) {
            return;
        }

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersections = this.raycaster.intersectObjects([...this.cornerHandles, ...this.edgeHandles]);
        const hit = intersections[0]?.object ?? null;

        if (hit !== this.hoveredHandle) {
            this.hoveredHandle = hit;
            this.#refreshAllHandleVisuals();
            this.renderer.domElement.style.cursor = hit ? 'pointer' : 'default';
        }
    }

    #onPointerDown(event) {
        if (event.button !== 0 || !this.handlesVisible) {
            return;
        }

        this.#updateMouse(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersections = this.raycaster.intersectObjects([...this.cornerHandles, ...this.edgeHandles]);

        if (intersections.length === 0) {
            return;
        }

        event.stopPropagation();
        this.activeHandle = intersections[0].object;
        this.isDragging = true;
        this.initialDimensions = { ...this.dimensions };

        if (this.activeHandle.userData.type === 'corner') {
            this.setSelectedCorner(this.activeHandle.userData.id);
        }

        if (this.controls) {
            this.controls.enabled = false;
        }

        const handlePosition = new THREE.Vector3();
        this.activeHandle.getWorldPosition(handlePosition);
        const planeNormal = new THREE.Vector3();
        this.camera.getWorldDirection(planeNormal).negate();
        this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, handlePosition);

        if (this.raycaster.ray.intersectPlane(this.dragPlane, this.initialDragPoint)) {
            this.renderer.domElement.style.cursor = 'grabbing';
        }
    }

    #handleDrag() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const currentPoint = new THREE.Vector3();

        if (!this.raycaster.ray.intersectPlane(this.dragPlane, currentPoint)) {
            return;
        }

        const worldDelta = new THREE.Vector3().subVectors(currentPoint, this.initialDragPoint);
        const localDelta = worldDelta.applyQuaternion(this.handleGroup.quaternion.clone().invert());
        const data = this.activeHandle.userData;
        let width = this.initialDimensions.width;
        let height = this.initialDimensions.height;
        let depth = this.initialDimensions.depth;

        if (data.type === 'edge') {
            if (data.axis === 'X') {
                width = Math.max(0.5, width + localDelta.x * data.sign * 2);
                if (this.lockAspect) height = width / this.originalAspect;
            } else if (data.axis === 'Y') {
                height = Math.max(0.5, height + localDelta.y * data.sign * 2);
                if (this.lockAspect) width = height * this.originalAspect;
            } else if (data.axis === 'Z') {
                depth = Math.max(0.2, depth + localDelta.z * data.sign * 2);
            }
        } else {
            const deltaX = localDelta.x * data.signX;
            const deltaY = localDelta.y * data.signY;
            const factor = Math.max(0.1, 1 + (deltaX + deltaY) * 0.25);
            width = Math.max(0.5, width * factor);
            height = this.lockAspect
                ? width / this.originalAspect
                : Math.max(0.5, height * Math.max(0.1, 1 + deltaY * 0.25));
            depth = Math.max(0.2, depth * Math.max(0.1, 1 + localDelta.z * data.signZ * 0.25));
        }

        if (this.snapEnabled && this.snapStep > 0) {
            width = Math.max(0.2, Math.round(width / this.snapStep) * this.snapStep);
            height = Math.max(0.2, Math.round(height / this.snapStep) * this.snapStep);
            depth = Math.max(0.1, Math.round(depth / this.snapStep) * this.snapStep);
        }

        this.setDimensions(width, height, depth);
        this.onTransformUpdate?.({
            width,
            height,
            depth,
            activeHandleId: data.id,
            isDragging: true,
        });
    }

    #onPointerUp() {
        if (!this.isDragging) {
            return;
        }

        this.isDragging = false;
        this.activeHandle = null;
        if (this.controls) this.controls.enabled = true;
        this.renderer.domElement.style.cursor = 'default';
        this.hoveredHandle = null;
        this.#refreshAllHandleVisuals();
        this.onTransformUpdate?.({
            width: this.dimensions.width,
            height: this.dimensions.height,
            depth: this.dimensions.depth,
            isDragging: false,
        });
    }

    #refreshAllHandleVisuals() {
        for (const handle of [...this.cornerHandles, ...this.edgeHandles]) {
            const selected = handle.userData.id === this.selectedHandleId;
            const hovered = handle === this.hoveredHandle;
            const color = hovered
                ? this.colors.hover
                : selected ? this.colors.selected : handle.userData.baseColor;
            handle.material.color.setHex(color);
            handle.scale.setScalar(hovered ? 1.3 : selected ? 1.18 : 1);
        }
    }

    destroy() {
        this.renderer.domElement.removeEventListener('pointermove', this.boundPointerMove);
        this.renderer.domElement.removeEventListener('pointerdown', this.boundPointerDown);
        window.removeEventListener('pointerup', this.boundPointerUp);
        this.clearGroup();
        this.cornerGeo.dispose();
        this.edgeGeoX.dispose();
        this.edgeGeoY.dispose();
        this.edgeGeoZ.dispose();
        this.cornerMat.dispose();
        this.edgeMatX.dispose();
        this.edgeMatY.dispose();
        this.edgeMatZ.dispose();
        this.handleGroup.removeFromParent();
    }
}
