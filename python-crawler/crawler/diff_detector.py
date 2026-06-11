"""크롤링 결과와 기존 progress_data 비교 — 신규 진행내역 추출 및 result 변경 감지"""

import re


def normalize_date(date_str: str | None) -> str:
    """'2024.07.28' → '2024-07-28' 정규화"""
    if not date_str:
        return ""
    return re.sub(r"\.", "-", date_str.strip())


def normalize_row(row: dict) -> dict:
    """크롤링 원시 데이터를 정규화된 dict로 변환"""
    return {
        "progress_date": normalize_date(row.get("progress_date")),
        "content": " ".join((row.get("content") or "").strip().split()),
        "result": (row.get("result") or "").strip() or None,
        "notification": (row.get("notification") or "").strip() or None,
    }


def detect_new_progress(
    scraped_rows: list[dict],
    existing_data: list[dict],
) -> tuple[list[dict], list[dict]]:
    """크롤링 결과에서 신규 항목과 result가 변경된 기존 항목을 반환.

    Args:
        scraped_rows: 크롤링에서 추출한 rows (원시)
        existing_data: cases.progress_data JSON 배열

    Returns:
        (new_rows, updated_rows)
        - new_rows: 신규 rows (정규화된 상태)
        - updated_rows: result가 변경된 rows (정규화된 상태)
    """
    # (날짜, 내용) → result 매핑
    existing_map = {
        (row.get("progress_date", ""), row.get("content", "")): row.get("result")
        for row in existing_data
    }

    new_rows = []
    updated_rows = []
    for row in scraped_rows:
        norm = normalize_row(row)
        key = (norm["progress_date"], norm["content"])
        if key not in existing_map:
            new_rows.append(norm)
        elif norm["result"] != existing_map[key]:
            # 날짜+내용은 같지만 result가 바뀐 경우
            updated_rows.append(norm)

    return new_rows, updated_rows
