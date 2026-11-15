import os
import urllib.request
import logging
import hashlib

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("model_downloader")

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

# Official 100% Free & Open Source OpenCV Model Zoo & MiniFASNet models
MODEL_URLS = {
    "face_detection_yunet.onnx": "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "face_recognition_sface.onnx": "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
    "minifasnet_v2.onnx": "https://huggingface.co/danelcsb/face/resolve/main/minifasnet_v2.onnx"
}

# Cryptographic SHA-256 integrity checksums to guard against corrupt downloads or MITM attacks
EXPECTED_SHA256 = {
    "face_detection_yunet.onnx": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    "face_recognition_sface.onnx": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    "minifasnet_v2.onnx": "b32929adc2d9c34b9486f8c4c7bc97c1b69bc0ea9befefc380e4faae4e463907"
}

def verify_file_sha256(filepath: str, expected_hash: str) -> bool:
    sha256 = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha256.update(chunk)
    actual_hash = sha256.hexdigest().lower()
    return actual_hash == expected_hash.lower()

def ensure_models_downloaded():
    os.makedirs(MODELS_DIR, exist_ok=True)
    paths = {}
    for name, url in MODEL_URLS.items():
        dest = os.path.join(MODELS_DIR, name)
        expected_hash = EXPECTED_SHA256.get(name)

        if os.path.exists(dest) and os.path.getsize(dest) > 50000:
            if expected_hash and not verify_file_sha256(dest, expected_hash):
                logger.warning(f"SHA-256 mismatch for existing {name}! Re-downloading...")
                os.remove(dest)
            else:
                logger.info(f"Model already verified: {name} ({os.path.getsize(dest)} bytes)")
                paths[name] = dest
                continue

        try:
            logger.info(f"Downloading {name} from {url}...")
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as resp, open(dest, "wb") as f:
                f.write(resp.read())

            if expected_hash and not verify_file_sha256(dest, expected_hash):
                os.remove(dest)
                raise ValueError(f"Downloaded {name} failed SHA-256 verification. File removed.")

            logger.info(f"Verified & saved {name} ({os.path.getsize(dest)} bytes)")
            paths[name] = dest
        except Exception as e:
            logger.warning(f"Download for {name} failed: {e}")
    return paths

if __name__ == "__main__":
    ensure_models_downloaded()
