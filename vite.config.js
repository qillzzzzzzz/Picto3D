import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/js/app.js'],
            refresh: true,
        }),
        tailwindcss(),
    ],
    build: {
        target: 'es2020',
        minify: 'esbuild',
        cssMinify: true,
        cssCodeSplit: true,
        sourcemap: false,
        assetsInlineLimit: 4096,
        chunkSizeWarningLimit: 600,
        rolldownOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('@mediapipe/tasks-vision')) {
                        return 'vendor-mediapipe';
                    }

                    if (id.includes('/three/')) {
                        return 'vendor-three';
                    }

                    return undefined;
                },
            },
        },
    },
    server: {
        host: '0.0.0.0', 
        port: 5173,
        strictPort: false,
        hmr: {
            host: 'localhost'
        },
        allowedHosts: ['picto3d.onrender.com'],
        watch: {
            ignored: [
                '**/storage/framework/views/**',
                '**/ml-service/**',
                '**/.venv/**',
                '**/*.pt',
            ],
        },
    },
    preview: {
        allowedHosts: ['picto3d.onrender.com'],
    },
});
