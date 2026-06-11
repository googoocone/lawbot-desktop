"""Tesseract OCR을 이용한 캡차 인식.

- PyInstaller 번들 실행 시: sys._MEIPASS/tesseract/tesseract.exe 사용
- 개발 환경(Python 직접): python-crawler/vendored/tesseract/ 사용
- 둘 다 없으면: 시스템 PATH의 tesseract 사용
"""

import io
import os
import re
import sys
from pathlib import Path

from PIL import Image
import pytesseract


def _resolve_tesseract_cmd() -> str:
    # 1) PyInstaller 번들 임시 디렉터리
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        bundled = Path(meipass) / "tesseract" / "tesseract.exe"
        if bundled.exists():
            os.environ["TESSDATA_PREFIX"] = str(bundled.parent / "tessdata")
            return str(bundled)

    # 2) 개발 환경: 프로젝트 루트의 vendored 폴더
    project_root = Path(__file__).resolve().parent.parent  # crawler/ 의 상위
    vendored = project_root / "vendored" / "tesseract" / "tesseract.exe"
    if vendored.exists():
        os.environ["TESSDATA_PREFIX"] = str(vendored.parent / "tessdata")
        return str(vendored)

    # 3) 시스템 PATH (fallback)
    return "tesseract"


_TESSERACT_CMD = _resolve_tesseract_cmd()
pytesseract.pytesseract.tesseract_cmd = _TESSERACT_CMD


def solve_captcha(image_bytes: bytes) -> str | None:
    """캡차 이미지(PNG bytes)에서 숫자만 추출하여 반환.

    Returns:
        인식된 숫자 문자열, 실패 시 None
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        # psm 7: 한 줄의 텍스트, whitelist: 숫자만
        config = "--psm 7 -c tessedit_char_whitelist=0123456789"
        text = pytesseract.image_to_string(img, config=config)
        digits = re.sub(r"\D", "", text).strip()
        return digits if digits else None
    except Exception as e:
        print(f"[captcha] error: {e}", file=sys.stderr)
        return None
