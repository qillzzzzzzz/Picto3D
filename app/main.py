from __future__ import annotations

import asyncio
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from ultralytics import YOLO

SERVICE_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = SERVICE_ROOT.parent if SERVICE_ROOT.name == "ml-service" else SERVICE_ROOT

load_dotenv(PROJECT_ROOT / ".env")
if SERVICE_ROOT != PROJECT_ROOT:
    load_dotenv(SERVICE_ROOT / ".env", override=True)


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def resolve_model_path(configured_path: str) -> Path:
    candidate = Path(configured_path).expanduser()
    search_roots = [
        SERVICE_ROOT,
        SERVICE_ROOT / "weights",
        PROJECT_ROOT,
        PROJECT_ROOT / "weights",
        PROJECT_ROOT / "ml-service",
        PROJECT_ROOT / "storage" / "app" / "weights",
        Path.cwd(),
        Path.cwd() / "weights",
        Path.cwd() / "ml-service",
    ]
    candidates = [candidate] if candidate.is_absolute() else [
        root / candidate for root in search_roots
    ]

    for model_path in candidates:
        if model_path.is_file():
            return model_path.resolve()

    checked = ", ".join(str(path) for path in candidates)
    raise RuntimeError(
        f"Model YOLO tidak ditemukan. YOLO_MODEL={configured_path!r}; lokasi diperiksa: {checked}."
    )


DEFAULT_MODEL_SETTING = "best.pt" if (SERVICE_ROOT / "best.pt").is_file() else "ml-service/best.pt"
MODEL_PATH_SETTING = os.getenv("YOLO_MODEL", DEFAULT_MODEL_SETTING)
MODEL_DEVICE = os.getenv("YOLO_DEVICE", "cpu")
IMAGE_SIZE = env_int("YOLO_IMAGE_SIZE", 960)
IOU_THRESHOLD = env_float("YOLO_IOU_THRESHOLD", 0.45)
MAX_DETECTIONS = env_int("YOLO_MAX_DETECTIONS", 50)
MIN_BOX_AREA_RATIO = env_float("YOLO_MIN_BOX_AREA_RATIO", 0.00015)
MAX_BOX_AREA_RATIO = env_float("YOLO_MAX_BOX_AREA_RATIO", 0.95)
AUTO_ENHANCE = env_bool("YOLO_AUTO_ENHANCE", True)
ADAPTIVE_RETRY = env_bool("YOLO_ADAPTIVE_RETRY", True)
RETRY_CONFIDENCE = env_float("YOLO_RETRY_CONFIDENCE", 0.42)
RETRY_TTA = env_bool("YOLO_RETRY_TTA", False)
USE_HALF_PRECISION = env_bool("YOLO_HALF", MODEL_DEVICE.lower() not in {"cpu", "mps"})
API_TOKEN = os.getenv("YOLO_API_TOKEN", "")
MAX_IMAGE_BYTES = env_int("MAX_IMAGE_BYTES", 4 * 1024 * 1024)
STRICT_CLASS_MATCH = env_bool("YOLO_STRICT_CLASSES", True)

EXPECTED_CLASS_TOKENS = {
    token.strip().lower()
    for token in os.getenv(
        "YOLO_EXPECTED_CLASSES",
        "eraser,wrinkle,correction tape,spidol,brush pen,drawing pen,board marker,"
        "pencil,stabilo,ruler,protractor,paper clip,binder clip,scissors,term,tape",
    ).split(",")
    if token.strip()
}
ALLOWED_CLASS_TOKENS = {
    token.strip().lower()
    for token in os.getenv("YOLO_ALLOWED_CLASSES", "").split(",")
    if token.strip()
}

# Alias hanya untuk validasi/metadata. Nama kelas hasil inference tetap mengikuti
# label yang benar-benar tertanam di best.pt agar tidak mengarang kelas baru.
CLASS_ALIASES = {
    "protactor": "protractor",
    "paper": "paper clip",
    "clip": "paper clip",
    "scissor": "scissors",
}
REVERSE_CLASS_ALIASES: dict[str, list[str]] = {}
for alias, canonical in CLASS_ALIASES.items():
    REVERSE_CLASS_ALIASES.setdefault(canonical, []).append(alias)

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "application/octet-stream",
}


class ImageMetadata(BaseModel):
    width: int
    height: int


class Detection(BaseModel):
    class_id: int
    class_name: str
    aliases: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    x1: float
    y1: float
    x2: float
    y2: float


class DetectionResponse(BaseModel):
    model: str
    image: ImageMetadata
    inference_ms: float
    preprocessed: bool = False
    preprocessing: list[str] = Field(default_factory=list)
    adaptive_retry: bool = False
    model_warning: str | None = None
    detections: list[Detection]


class FrameAnalysis(BaseModel):
    luminance: float
    contrast: float
    sharpness: float


def verify_service_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    if not API_TOKEN:
        raise HTTPException(
            status_code=500,
            detail="YOLO_API_TOKEN belum dikonfigurasi pada layanan inference.",
        )

    scheme, _, supplied_token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not supplied_token:
        raise HTTPException(status_code=401, detail="Bearer token diperlukan.")
    if not secrets.compare_digest(supplied_token, API_TOKEN):
        raise HTTPException(status_code=403, detail="Bearer token tidak valid.")


def analyze_frame(image: np.ndarray) -> FrameAnalysis:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return FrameAnalysis(
        luminance=round(float(gray.mean()), 2),
        contrast=round(float(gray.std()), 2),
        sharpness=round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 2),
    )


def enhance_frame(
    image: np.ndarray,
    *,
    force: bool = False,
) -> tuple[np.ndarray, list[str]]:
    if not AUTO_ENHANCE:
        return image, []

    analysis = analyze_frame(image)
    enhanced = image.copy()
    steps: list[str] = []

    needs_lighting = force or analysis.luminance < 92 or analysis.contrast < 34
    if needs_lighting:
        lab = cv2.cvtColor(enhanced, cv2.COLOR_BGR2LAB)
        lightness, channel_a, channel_b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=1.7, tileGridSize=(8, 8))
        lightness = clahe.apply(lightness)
        enhanced = cv2.cvtColor(
            cv2.merge((lightness, channel_a, channel_b)),
            cv2.COLOR_LAB2BGR,
        )
        steps.append("adaptive-contrast")

    if force or analysis.luminance < 70:
        gamma = 0.76
        lookup = np.array(
            [((index / 255.0) ** gamma) * 255 for index in range(256)],
            dtype=np.uint8,
        )
        enhanced = cv2.LUT(enhanced, lookup)
        steps.append("gamma-lighting")

    if force or analysis.sharpness < 85:
        blurred = cv2.GaussianBlur(enhanced, (0, 0), 1.0)
        enhanced = cv2.addWeighted(enhanced, 1.35, blurred, -0.35, 0)
        steps.append("mild-sharpen")

    return enhanced, steps


def run_prediction(
    model: YOLO,
    image: np.ndarray,
    confidence: float,
    *,
    augment: bool = False,
):
    return model.predict(
        source=image,
        conf=confidence,
        iou=IOU_THRESHOLD,
        imgsz=IMAGE_SIZE,
        device=MODEL_DEVICE,
        max_det=MAX_DETECTIONS,
        half=USE_HALF_PRECISION,
        augment=augment,
        agnostic_nms=True,
        verbose=False,
    )[0]


def class_is_allowed(class_id: int, class_name: str) -> bool:
    if not ALLOWED_CLASS_TOKENS:
        return True
    return str(class_id) in ALLOWED_CLASS_TOKENS or class_name.lower() in ALLOWED_CLASS_TOKENS


def box_iou(first: dict[str, Any], second: dict[str, Any]) -> float:
    x1 = max(first["x1"], second["x1"])
    y1 = max(first["y1"], second["y1"])
    x2 = min(first["x2"], second["x2"])
    y2 = min(first["y2"], second["y2"])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    first_area = max(0.0, first["x2"] - first["x1"]) * max(0.0, first["y2"] - first["y1"])
    second_area = max(0.0, second["x2"] - second["x1"]) * max(0.0, second["y2"] - second["y1"])
    union = first_area + second_area - intersection
    return intersection / union if union > 0 else 0.0


def extract_candidates(result: Any, image_area: int) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    if result.boxes is None:
        return candidates

    coordinates = result.boxes.xyxy.cpu().tolist()
    confidences = result.boxes.conf.cpu().tolist()
    class_ids = result.boxes.cls.cpu().tolist()

    for box, score, class_id_value in zip(coordinates, confidences, class_ids, strict=True):
        class_id = int(class_id_value)
        class_name = str(result.names[class_id])
        x1, y1, x2, y2 = map(float, box)
        area_ratio = max(0.0, x2 - x1) * max(0.0, y2 - y1) / max(image_area, 1)

        if area_ratio < MIN_BOX_AREA_RATIO or area_ratio > MAX_BOX_AREA_RATIO:
            continue
        if not class_is_allowed(class_id, class_name):
            continue

        candidates.append(
            {
                "class_id": class_id,
                "class_name": class_name,
                "confidence": float(score),
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
            }
        )

    return candidates


def merge_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    for candidate in sorted(candidates, key=lambda item: item["confidence"], reverse=True):
        duplicate = any(
            (
                candidate["class_id"] == existing["class_id"]
                and box_iou(candidate, existing) >= 0.55
            )
            or box_iou(candidate, existing) >= 0.72
            for existing in kept
        )
        if not duplicate:
            kept.append(candidate)
        if len(kept) >= MAX_DETECTIONS:
            break
    return kept


def normalized_expected_classes() -> set[str]:
    return {CLASS_ALIASES.get(name, name) for name in EXPECTED_CLASS_TOKENS}


@asynccontextmanager
async def lifespan(app: FastAPI):
    model_path = resolve_model_path(MODEL_PATH_SETTING)
    model = YOLO(str(model_path))
    raw_names = model.names
    model_names = raw_names.values() if isinstance(raw_names, dict) else raw_names
    model_class_names = {str(name).strip().lower() for name in model_names}
    missing_classes = sorted(normalized_expected_classes() - model_class_names)

    app.state.model_path = model_path
    app.state.model = model
    app.state.model_class_names = sorted(model_class_names)
    app.state.inference_lock = asyncio.Lock()
    app.state.model_warning = (
        f"Model tidak memiliki kelas training yang diharapkan: {', '.join(missing_classes)}"
        if missing_classes
        else None
    )

    if missing_classes and STRICT_CLASS_MATCH:
        raise RuntimeError(
            f"Model {model_path.name} tidak cocok dengan konfigurasi kelas. "
            f"Kelas hilang: {', '.join(missing_classes)}"
        )

    warmup = np.zeros((IMAGE_SIZE, IMAGE_SIZE, 3), dtype=np.uint8)
    await run_in_threadpool(run_prediction, model, warmup, 0.18)

    yield

    app.state.model = None


app = FastAPI(
    title="YOLO Camera Inference Service",
    version="2.1.0",
    lifespan=lifespan,
)


@app.get("/health")
def health(request: Request) -> dict[str, object]:
    model_path: Path | None = getattr(request.app.state, "model_path", None)
    return {
        "status": "ok",
        "model": model_path.name if model_path else MODEL_PATH_SETTING,
        "device": MODEL_DEVICE,
        "image_size": IMAGE_SIZE,
        "iou_threshold": IOU_THRESHOLD,
        "min_box_area_ratio": MIN_BOX_AREA_RATIO,
        "max_box_area_ratio": MAX_BOX_AREA_RATIO,
        "max_detections": MAX_DETECTIONS,
        "auto_enhance": AUTO_ENHANCE,
        "adaptive_retry": ADAPTIVE_RETRY,
        "retry_confidence": RETRY_CONFIDENCE,
        "model_warning": getattr(request.app.state, "model_warning", None),
        "classes": getattr(request.app.state, "model_class_names", []),
        "class_aliases": CLASS_ALIASES,
        "ready": request.app.state.model is not None,
    }


@app.post(
    "/detect",
    response_model=DetectionResponse,
    dependencies=[Depends(verify_service_token)],
)
async def detect(
    request: Request,
    file: Annotated[UploadFile, File(description="Frame kamera")],
    confidence: Annotated[float, Form(ge=0.05, le=1.0)] = 0.18,
) -> DetectionResponse:
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Frame harus berupa JPEG, PNG, atau WebP.",
        )

    contents = await file.read()
    await file.close()
    if not contents:
        raise HTTPException(status_code=422, detail="File frame kosong.")
    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Ukuran frame terlalu besar.")

    encoded = np.frombuffer(contents, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=422, detail="Frame tidak dapat didekode.")

    height, width = image.shape[:2]
    image_area = max(1, width * height)
    primary_image, primary_steps = enhance_frame(image)
    started_at = time.perf_counter()

    async with request.app.state.inference_lock:
        primary_result = await run_in_threadpool(
            run_prediction,
            request.app.state.model,
            primary_image,
            confidence,
        )
        candidates = extract_candidates(primary_result, image_area)
        best_confidence = max((item["confidence"] for item in candidates), default=0.0)
        retried = False
        all_steps = list(primary_steps)

        if ADAPTIVE_RETRY and best_confidence < RETRY_CONFIDENCE:
            retry_image, retry_steps = enhance_frame(image, force=True)
            if not np.array_equal(retry_image, primary_image) or RETRY_TTA:
                retry_result = await run_in_threadpool(
                    run_prediction,
                    request.app.state.model,
                    retry_image,
                    confidence,
                    augment=RETRY_TTA,
                )
                candidates.extend(extract_candidates(retry_result, image_area))
                retried = True
                all_steps.extend(step for step in retry_steps if step not in all_steps)

    merged = merge_candidates(candidates)
    detections = [
        Detection(
            class_id=item["class_id"],
            class_name=item["class_name"],
            aliases=REVERSE_CLASS_ALIASES.get(item["class_name"].lower(), []),
            confidence=round(item["confidence"], 4),
            x1=round(item["x1"], 2),
            y1=round(item["y1"], 2),
            x2=round(item["x2"], 2),
            y2=round(item["y2"], 2),
        )
        for item in merged
    ]

    return DetectionResponse(
        model=request.app.state.model_path.name,
        image=ImageMetadata(width=width, height=height),
        inference_ms=round((time.perf_counter() - started_at) * 1000, 2),
        preprocessed=bool(all_steps),
        preprocessing=all_steps,
        adaptive_retry=retried,
        model_warning=getattr(request.app.state, "model_warning", None),
        detections=detections,
    )
