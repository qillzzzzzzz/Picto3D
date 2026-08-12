import * as THREE from 'three';
import { cssColor } from '../theme.js';

/**
 * PrimitiveFactory.js
 * 3D Primitive Generator Module.
 * 
 * Provides built-in 3D primitive geometry creation:
 * 1. Kubus (Box / Cube)
 * 2. Bola (Sphere)
 * 3. Segitiga 3D (Pyramid / Triangular Prism / Tetrahedron)
 */
export class PrimitiveFactory {
    /**
     * Creates a 3D Primitive Mesh with default MeshStandardMaterial.
     * @param {'cube'|'sphere'|'triangle'} type 
     * @param {{ width: number, height: number, depth: number, color?: THREE.ColorRepresentation, roughness?: number, metalness?: number }} options 
     * @returns {THREE.Mesh}
     */
    static createPrimitive(type, options = {}) {
        const width = options.width || 4;
        const height = options.height || 4;
        const depth = options.depth || 4;

        let geometry;

        switch (type.toLowerCase()) {
            case 'cube':
            case 'box':
            case 'kubus':
                geometry = new THREE.BoxGeometry(width, height, depth);
                break;

            case 'sphere':
            case 'bola':
                // Sphere geometry using width radius
                const radius = Math.min(width, height, depth) / 2;
                geometry = new THREE.SphereGeometry(radius, 32, 32);
                break;

            case 'triangle':
            case 'segitiga':
            case 'pyramid':
            case 'prisma':
                // 4-sided Pyramid / 3D Triangle
                geometry = new THREE.ConeGeometry(width / 2, height, 4);
                break;

            default:
                geometry = new THREE.BoxGeometry(width, height, depth);
                break;
        }

        // Center geometry then shift up so bottom sits on Y=0 (grid floor)
        geometry.center();
        geometry.translate(0, height / 2, 0);

        const material = new THREE.MeshStandardMaterial({
            color: options.color || cssColor('--color-primary-medium'),
            roughness: options.roughness !== undefined ? options.roughness : 0.3,
            metalness: options.metalness !== undefined ? options.metalness : 0.2,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `Primitive_${type}_${Date.now()}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // Store original base dimensions for parametric scaling (P x L x T)
        mesh.userData = {
            isPrimitive: true,
            primitiveType: type,
            baseWidth: width,
            baseHeight: height,
            baseDepth: depth
        };

        return mesh;
    }
}
