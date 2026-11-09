import os
import urllib.request
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("model_downloader")

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

# Official 100% Free & Open Source OpenCV Model Zoo & MiniFASNet models
MODEL_URLS = {
    "face_detection_yunet.onnx": "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "face_recognition_sface.onnx": "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
    "minifasnet_v2.onnx": "https://huggingface.co/danelcsb/face/resolve/main/minifasnet_v2.onnx"
}

def ensure_models_downloaded():
    os.makedirs(MODELS_DIR, exist_ok=True)
    paths = {}
    for name, url in MODEL_URLS.items():
        dest = os.path.join(MODELS_DIR, name)
        if os.path.exists(dest) and os.path.getsize(dest) > 50000:
            logger.info(f"Model already downloaded: {name} ({os.path.getsize(dest)} bytes)")
            paths[name] = dest
        else:
            try:
                logger.info(f"Downloading {name} from {url}...")
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=60) as resp, open(dest, "wb") as f:
                    f.write(resp.read())
                logger.info(f"Saved {name} ({os.path.getsize(dest)} bytes)")
                paths[name] = dest
            except Exception as e:
                logger.warning(f"Download for {name} skipped: {e}")
    return paths

if __name__ == "__main__":
    ensure_models_downloaded()
