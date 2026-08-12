const PALM_LANDMARKS = [0, 5, 9, 13, 17];
const FINGERS = Object.freeze([
    { name: 'index', mcp: 5, pip: 6, dip: 7, tip: 8 },
    { name: 'middle', mcp: 9, pip: 10, dip: 11, tip: 12 },
    { name: 'ring', mcp: 13, pip: 14, dip: 15, tip: 16 },
    { name: 'pinky', mcp: 17, pip: 18, dip: 19, tip: 20 },
]);

export function distance2D(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function averagePoint(points) {
    const sum = points.reduce(
        (result, point) => ({
            x: result.x + point.x,
            y: result.y + point.y,
            z: result.z + (point.z ?? 0),
        }),
        { x: 0, y: 0, z: 0 },
    );

    return {
        x: sum.x / points.length,
        y: sum.y / points.length,
        z: sum.z / points.length,
    };
}

export function mirrorPoint(point, mirrored = true) {
    return {
        x: mirrored ? 1 - point.x : point.x,
        y: point.y,
        z: point.z ?? 0,
    };
}

export function getPalmCenter(landmarks, mirrored = true) {
    return mirrorPoint(
        averagePoint(PALM_LANDMARKS.map(index => landmarks[index])),
        mirrored,
    );
}

export function getPinchCenter(landmarks, mirrored = true) {
    return mirrorPoint(averagePoint([landmarks[4], landmarks[8]]), mirrored);
}

export function getPeaceCenter(landmarks, mirrored = true) {
    return mirrorPoint(averagePoint([landmarks[8], landmarks[12]]), mirrored);
}

export function getPalmSize(landmarks) {
    return Math.max(distance2D(landmarks[0], landmarks[9]), 0.0001);
}

export function getPinchRatio(landmarks) {
    return distance2D(landmarks[4], landmarks[8]) / getPalmSize(landmarks);
}

export function isPinching(landmarks, threshold) {
    return getPinchRatio(landmarks) <= threshold;
}

export function angle2D(first, center, last) {
    const firstVector = { x: first.x - center.x, y: first.y - center.y };
    const lastVector = { x: last.x - center.x, y: last.y - center.y };
    const denominator = Math.max(
        Math.hypot(firstVector.x, firstVector.y) * Math.hypot(lastVector.x, lastVector.y),
        0.000001,
    );
    const cosine = clamp(
        (firstVector.x * lastVector.x + firstVector.y * lastVector.y) / denominator,
        -1,
        1,
    );

    return Math.acos(cosine) * 180 / Math.PI;
}

export function isFingerExtended(landmarks, finger, threshold) {
    const pipAngle = angle2D(
        landmarks[finger.mcp],
        landmarks[finger.pip],
        landmarks[finger.dip],
    );
    const dipAngle = angle2D(
        landmarks[finger.pip],
        landmarks[finger.dip],
        landmarks[finger.tip],
    );
    const wrist = landmarks[0];

    return pipAngle >= threshold
        && dipAngle >= threshold - 8
        && distance2D(landmarks[finger.tip], wrist) > distance2D(landmarks[finger.pip], wrist);
}

export function isFingerFolded(landmarks, finger, threshold) {
    const pipAngle = angle2D(
        landmarks[finger.mcp],
        landmarks[finger.pip],
        landmarks[finger.dip],
    );
    const tipToWrist = distance2D(landmarks[finger.tip], landmarks[0]);
    const pipToWrist = distance2D(landmarks[finger.pip], landmarks[0]);

    return pipAngle <= threshold || tipToWrist <= pipToWrist * 1.04;
}

/**
 * Peace / victory sign asli: jari TELUNJUK dan jari TENGAH sama-sama lurus
 * dan terbuka membentuk huruf V, ibu jari terlipat ke dalam telapak, serta
 * jari manis & kelingking terlipat. Sengaja TIDAK disyaratkan mencubit
 * (thumb-index bersentuhan) agar gesture ini tidak tertukar dengan gesture
 * "jari tengah" (hanya satu jari) ataupun gesture cubit biasa - keduanya
 * jelas berbeda dari peace sign dua jari yang terbuka lebar.
 */
export function isPeaceSign(landmarks, thresholds) {
    const indexExtended = isFingerExtended(
        landmarks,
        FINGERS[0],
        thresholds.fingerStraightAngle,
    );
    const middleExtended = isFingerExtended(
        landmarks,
        FINGERS[1],
        thresholds.fingerStraightAngle,
    );
    const ringFolded = isFingerFolded(
        landmarks,
        FINGERS[2],
        thresholds.foldedFingerAngle,
    );
    const pinkyFolded = isFingerFolded(
        landmarks,
        FINGERS[3],
        thresholds.foldedFingerAngle,
    );

    if (!indexExtended || !middleExtended || !ringFolded || !pinkyFolded) {
        return false;
    }

    const palmSize = getPalmSize(landmarks);

    // Ibu jari harus terlipat mendekati telapak (bukan direntangkan ke
    // samping), supaya gesture tidak keliru dianggap "open hand" / high-five.
    const thumbTucked = distance2D(landmarks[4], landmarks[9]) / palmSize
        <= thresholds.peaceThumbTuckRatio;

    // Ujung telunjuk & tengah harus benar-benar terpisah (membentuk huruf V),
    // bukan menempel rapat seperti dua jari yang dirapatkan.
    const tipSeparation = distance2D(landmarks[8], landmarks[12]) / palmSize;

    return thumbTucked && tipSeparation >= thresholds.peaceMiddleSeparationRatio;
}

export function isFist(landmarks, thresholds) {
    const foldedCount = FINGERS.reduce(
        (count, finger) => count + Number(
            isFingerFolded(landmarks, finger, thresholds.foldedFingerAngle),
        ),
        0,
    );

    return foldedCount === FINGERS.length;
}

export function smoothPoint(previous, current, factor) {
    if (!previous) {
        return current;
    }

    return {
        x: previous.x + (current.x - previous.x) * factor,
        y: previous.y + (current.y - previous.y) * factor,
        z: previous.z + (current.z - previous.z) * factor,
    };
}

export function applyDeadZone(value, deadZone) {
    return Math.abs(value) < deadZone ? 0 : value;
}

export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
