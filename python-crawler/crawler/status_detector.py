"""진행내역 키워드로 사건 상태 자동 판단"""

from . import config


def detect_status(
    all_progress: list[dict],
    current_status: str,
) -> str | None:
    """모든 진행내역에서 사건 상태를 판단한다.

    가장 최신(마지막) 매칭 키워드가 상태를 결정한다.

    Returns:
        변경이 있으면 새 상태, 없으면 None
    """
    # 날짜 오름차순 정렬
    sorted_rows = sorted(
        all_progress,
        key=lambda r: r.get("progress_date") or "",
    )

    detected = None
    for row in sorted_rows:
        content = row.get("content") or ""
        for status_key, keywords in config.STATUS_KEYWORDS.items():
            if any(kw in content for kw in keywords):
                detected = status_key
                break  # 한 row에서 첫 매칭만

    if detected and detected != current_status:
        return detected
    return None
