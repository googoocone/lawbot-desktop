"""송달문서 감지 → 보정 레코드 생성"""

import re
import logging
from dataclasses import dataclass
from datetime import date, timedelta
from . import config

log = logging.getLogger(__name__)


@dataclass
class DetectedCorrection:
    document_type: str
    document_category: str
    served_date: str  # YYYY-MM-DD
    arrival_date: str | None  # 도달일 (결과 컬럼에서 파싱)
    arrival_raw: str | None   # 도달 원문 (예: "2026.03.27 도달", "2026.03.27 0시 도달")
    default_days: int | None


def parse_arrival(result: str | None) -> tuple[str | None, str | None]:
    """결과 컬럼에서 도달일을 파싱한다.

    Returns:
        (도달일 ISO, 원문) 예: ('2026-01-14', '2026.01.14 0시 도달')
    """
    if not result:
        return None, None
    m = re.search(r"(\d{4})\.(\d{2})\.(\d{2})\s*(0시\s*)?도달", result)
    if m:
        iso_date = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        raw = m.group(0).strip()
        return iso_date, raw
    return None, None


def detect_delivery(row: dict) -> DetectedCorrection | None:
    """진행내역 row에서 송달문서를 감지한다.

    Returns:
        DetectedCorrection 또는 None
    """
    content = row.get("content") or ""
    progress_date = row.get("progress_date") or ""
    arrival, arrival_raw = parse_arrival(row.get("result"))

    # 1차: "~에게 ~문서~ 송달" 패턴
    for pattern in config.DELIVERY_PATTERNS:
        m = re.search(pattern, content)
        if m:
            doc_type = m.group(2).strip()
            cls = config.DOCUMENT_CLASSIFICATION.get(doc_type)
            if cls:
                return DetectedCorrection(
                    document_type=doc_type,
                    document_category=cls["category"],
                    served_date=progress_date,
                    arrival_date=arrival,
                    arrival_raw=arrival_raw,
                    default_days=cls["default_days"],
                )

    # 2차: content에 분류 키워드가 직접 포함되는 경우
    for doc_type, cls in config.DOCUMENT_CLASSIFICATION.items():
        if doc_type in content and "송달" in content:
            return DetectedCorrection(
                document_type=doc_type,
                document_category=cls["category"],
                served_date=progress_date,
                arrival_date=arrival,
                arrival_raw=arrival_raw,
                default_days=cls["default_days"],
            )

    return None


def detect_submission(row: dict) -> str | None:
    """진행내역 row에서 보정서 제출을 감지한다.

    '~보정서(채권자목록 및 변제계획안) 제출' 같은 패턴을 잡는다.

    Returns:
        제출일(progress_date) 또는 None
    """
    content = row.get("content") or ""

    if "제출" not in content:
        return None

    # 연장 신청은 제출이 아님
    if "연장" in content:
        return None

    # 신청서 제출은 제출이 아님 (금지명령 신청서, 기간연장 신청서 등)
    if "신청서" in content and "보정서" not in content:
        return None

    # 보정 관련 제출인지 확인
    if any(kw in content for kw in ["보정서", "보정", "예납", "납부"]):
        return row.get("progress_date") or None

    return None


def detect_extension_request(row: dict) -> str | None:
    """진행내역 row에서 보정기간 연장 신청을 감지한다.

    Returns:
        신청일(progress_date) 또는 None
    """
    content = row.get("content") or ""

    if "제출" not in content:
        return None

    if "연장" in content and any(kw in content for kw in ["보정", "기간", "기한"]):
        return row.get("progress_date") or None

    return None


def build_correction_insert(
    case_id: str,
    firm_id: str,
    detected: DetectedCorrection,
) -> dict:
    """DB 삽입용 보정 레코드를 생성한다.

    기한 계산 기준:
    - 도달일(arrival_date)이 있으면 도달일 기준
    - 없으면 송달일(served_date) 기준
    - 기본 기한: 14일 (default_days가 지정되어 있으면 그 값 사용)
    """
    served = detected.served_date
    arrival = detected.arrival_date
    arrival_raw = detected.arrival_raw
    base_date_str = arrival or served  # 도달일 우선
    d7 = deadline = None

    if base_date_str:
        try:
            bd = date.fromisoformat(base_date_str)
            # 0시 도달 = 당일 기산, 일반 도달 = 익일 기산 (기산일 포함 7일)
            is_midnight = arrival_raw and "0시" in arrival_raw
            start = bd if is_midnight else bd + timedelta(days=1)
            d7 = (start + timedelta(days=6)).isoformat()
            deadline = d7
        except ValueError:
            pass

    # 초기 상태 결정
    status = "pending"
    overdue_days = 0
    if deadline:
        today = date.today()
        dl = date.fromisoformat(deadline)
        diff = (dl - today).days
        if diff < 0:
            status = "overdue"
            overdue_days = abs(diff)
        elif diff <= 3:
            status = "approaching"

    return {
        "case_id": case_id,
        "firm_id": firm_id,
        "document_type": detected.document_type,
        "document_category": detected.document_category,
        "served_date": served,
        "received_date": arrival,
        "arrival_raw": detected.arrival_raw,
        "auto_confirmed": True,
        "deadline_7d": d7,
        "deadline_date": deadline,
        "status": status,
        "overdue_days": overdue_days,
    }


