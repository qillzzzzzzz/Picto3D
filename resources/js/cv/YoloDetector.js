/**
 * Adapter between uploaded/editor images and the Laravel YOLO endpoint.
 * The local fallback only finds a foreground ROI; it never invents a trained class.
 */
export class YoloDetector {
    constructor(options = {}) {
        this.confidenceThreshold = options.confidenceThreshold ?? 0.25;
        this.yoloEndpoint = options.yoloEndpoint ?? '/api/detections';
        this.maxInputSize = options.maxInputSize ?? 1280;
        this.preferredClasses = new Set(
            (options.preferredClasses ?? []).map(value => String(value).trim().toLowerCase()),
        );
    }

    /**
     * @param {HTMLImageElement|string} imageSource
     * @returns {Promise<{
     *   label: string,
     *   confidence: number,
     *   bbox: {x: number, y: number, width: number, height: number, aspectRatio: number},
     *   croppedCanvas: HTMLCanvasElement,
     *   croppedDataUrl: string,
     *   source: string,
     *   model?: string
     * }>}
     */
    async detect(imageSource) {
        const image = await this.#loadHTMLImage(imageSource);

        try {
            return await this.#detectViaApi(image);
        } catch (error) {
            console.warn('Endpoint YOLO tidak dapat digunakan; memakai ROI fallback tanpa klasifikasi.', error);
            return this.#detectForegroundFallback(image);
        }
    }

    async #detectViaApi(image) {
        const inputCanvas = this.#createInputCanvas(image);
        const blob = await this.#canvasToBlob(inputCanvas, 'image/jpeg', 0.92);
        const formData = new FormData();
        formData.append('frame', blob, 'editor-source.jpg');
        formData.append('confidence', String(this.confidenceThreshold));

        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
        const abortController = new AbortController();
        const timeoutId = window.setTimeout(() => abortController.abort(), 12000);
        let response;

        try {
            response = await fetch(this.yoloEndpoint, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'X-CSRF-TOKEN': csrfToken,
                },
                credentials: 'same-origin',
                body: formData,
                signal: abortController.signal,
            });
        } finally {
            window.clearTimeout(timeoutId);
        }

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
            throw new Error(payload?.message || `YOLO mengembalikan HTTP ${response.status}.`);
        }

        if (payload?.model_warning) {
            throw new Error(payload.model_warning);
        }

        const detections = Array.isArray(payload?.detections) ? payload.detections : [];
        const selected = this.#selectDetection(detections, payload?.image);

        if (!selected) {
            return this.#createFullImageResult(
                inputCanvas,
                'custom',
                0,
                'yolo-no-detection',
                payload?.model,
            );
        }

        const responseWidth = Math.max(1, Number(payload?.image?.width || inputCanvas.width));
        const responseHeight = Math.max(1, Number(payload?.image?.height || inputCanvas.height));
        const scaleX = inputCanvas.width / responseWidth;
        const scaleY = inputCanvas.height / responseHeight;
        const marginX = Math.max(2, (selected.x2 - selected.x1) * scaleX * 0.04);
        const marginY = Math.max(2, (selected.y2 - selected.y1) * scaleY * 0.04);

        const x1 = this.#clamp(selected.x1 * scaleX - marginX, 0, inputCanvas.width - 1);
        const y1 = this.#clamp(selected.y1 * scaleY - marginY, 0, inputCanvas.height - 1);
        const x2 = this.#clamp(selected.x2 * scaleX + marginX, x1 + 1, inputCanvas.width);
        const y2 = this.#clamp(selected.y2 * scaleY + marginY, y1 + 1, inputCanvas.height);

        return this.#createCroppedResult(inputCanvas, {
            label: String(selected.class_name || selected.label || 'custom'),
            confidence: Number(selected.confidence || 0),
            x: x1,
            y: y1,
            width: x2 - x1,
            height: y2 - y1,
            source: 'yolo',
            model: payload?.model,
        });
    }

    #selectDetection(detections, imageMetadata) {
        const imageArea = Math.max(
            1,
            Number(imageMetadata?.width || 1) * Number(imageMetadata?.height || 1),
        );

        return detections
            .filter(detection => Number(detection.confidence || 0) >= this.confidenceThreshold)
            .map((detection) => {
                const label = String(detection.class_name || detection.label || '').toLowerCase();
                const area = Math.max(0, detection.x2 - detection.x1)
                    * Math.max(0, detection.y2 - detection.y1);
                const areaScore = Math.min(1, Math.sqrt(area / imageArea));
                const preferredBonus = this.preferredClasses.has(label) ? 0.10 : 0;

                return {
                    detection,
                    score: Number(detection.confidence || 0) * 0.95 + areaScore * 0.05 + preferredBonus,
                };
            })
            .sort((first, second) => second.score - first.score)[0]?.detection ?? null;
    }

    #detectForegroundFallback(image) {
        const canvas = this.#createInputCanvas(image);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const corners = [
            0,
            (canvas.width - 1) * 4,
            ((canvas.height - 1) * canvas.width) * 4,
            ((canvas.height * canvas.width) - 1) * 4,
        ];
        const background = corners.reduce(
            (result, index) => ({
                r: result.r + data[index] / corners.length,
                g: result.g + data[index + 1] / corners.length,
                b: result.b + data[index + 2] / corners.length,
            }),
            { r: 0, g: 0, b: 0 },
        );

        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = -1;
        let maxY = -1;
        let foregroundPixels = 0;

        for (let y = 0; y < canvas.height; y += 1) {
            for (let x = 0; x < canvas.width; x += 1) {
                const index = (y * canvas.width + x) * 4;
                const alpha = data[index + 3];
                const colorDistance = Math.hypot(
                    data[index] - background.r,
                    data[index + 1] - background.g,
                    data[index + 2] - background.b,
                );

                if (alpha > 40 && colorDistance > 32) {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                    foregroundPixels += 1;
                }
            }
        }

        if (foregroundPixels < 64 || minX >= maxX || minY >= maxY) {
            return this.#createFullImageResult(canvas, 'custom', 0, 'fallback-full-image');
        }

        const margin = Math.max(2, Math.round(Math.max(maxX - minX, maxY - minY) * 0.04));

        return this.#createCroppedResult(canvas, {
            label: 'custom',
            confidence: 0,
            x: this.#clamp(minX - margin, 0, canvas.width - 1),
            y: this.#clamp(minY - margin, 0, canvas.height - 1),
            width: Math.min(canvas.width - Math.max(0, minX - margin), (maxX - minX) + margin * 2),
            height: Math.min(canvas.height - Math.max(0, minY - margin), (maxY - minY) + margin * 2),
            source: 'fallback-roi',
        });
    }

    #createInputCanvas(image) {
        const naturalWidth = image.naturalWidth || image.width;
        const naturalHeight = image.naturalHeight || image.height;
        const scale = Math.min(1, this.maxInputSize / Math.max(naturalWidth, naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(naturalHeight * scale));

        const context = canvas.getContext('2d', { alpha: false });
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        return canvas;
    }

    #createFullImageResult(canvas, label, confidence, source, model = undefined) {
        return this.#createCroppedResult(canvas, {
            label,
            confidence,
            x: 0,
            y: 0,
            width: canvas.width,
            height: canvas.height,
            source,
            model,
        });
    }

    #createCroppedResult(sourceCanvas, options) {
        const x = Math.floor(options.x);
        const y = Math.floor(options.y);
        const width = Math.max(1, Math.round(options.width));
        const height = Math.max(1, Math.round(options.height));
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = width;
        croppedCanvas.height = height;
        croppedCanvas.getContext('2d').drawImage(
            sourceCanvas,
            x,
            y,
            width,
            height,
            0,
            0,
            width,
            height,
        );

        return {
            label: options.label,
            confidence: Number(options.confidence.toFixed?.(4) ?? options.confidence),
            bbox: {
                x,
                y,
                width,
                height,
                aspectRatio: Number((width / Math.max(height, 1)).toFixed(4)),
            },
            croppedCanvas,
            croppedDataUrl: croppedCanvas.toDataURL('image/png'),
            source: options.source,
            model: options.model,
        };
    }

    #canvasToBlob(canvas, type, quality) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Gambar editor gagal dienkode untuk YOLO.'));
                }
            }, type, quality);
        });
    }

    #loadHTMLImage(source) {
        return new Promise((resolve, reject) => {
            if (source instanceof HTMLImageElement && source.complete && source.naturalWidth > 0) {
                resolve(source);
                return;
            }

            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Gambar sumber tidak dapat dimuat.'));
            image.src = typeof source === 'string' ? source : source.src;
        });
    }

    #clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
}
