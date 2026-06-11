"""크롤링 결과에 따른 알림 페이로드 생성

알림 타입:
- progress_update : 새 진행내역 감지
- correction_new  : 보정 문서 자동 감지 (urgent)
- status_change   : 사건 상태 변경
"""

STATUS_LABELS = {
    "pending": "접수전",
    "filed": "접수",
    "commenced": "개시",
    "approved": "인가",
    "discharged": "면책",
    "dismissed": "기각",
    "cancelled": "폐지",
    "withdrawn": "취하",
}


def _fmt_date(date_str: str | None) -> str:
    """'2026-02-10' → '2026.02.10'"""
    if not date_str:
        return ""
    return date_str.replace("-", ".")


def fan_out(base: dict | None, extra_ids: list[str]) -> list[dict]:
    """알림 1건을 여러 수신자에게 복제한다.

    base의 user_id(담당 직원) + extra_ids(팀장/관리자)로 발송.
    중복 user_id는 자동 제거.
    """
    if not base:
        return []
    seen = {base["user_id"]}
    results = [base]
    for uid in extra_ids:
        if uid not in seen:
            results.append({**base, "user_id": uid})
            seen.add(uid)
    return results


def build_progress_notification(
    case: dict,
    new_rows: list[dict],
    manager_ids: list[str] | None = None,
) -> list[dict]:
    """새 진행내역 알림 — 담당 직원 + 팀장/관리자"""
    user_id = case.get("assigned_to")
    if not new_rows:
        return []

    case_number = case.get("case_number") or case.get("applicant_name", "")
    count = len(new_rows)
    latest = new_rows[0]
    date_str = _fmt_date(latest.get("progress_date"))
    content = latest.get("content") or ""

    title = f"새 진행내역 {count}건" if count > 1 else "새 진행내역"
    message = f"{case_number} | {date_str} {content}".strip()
    if count > 1:
        message += f" 외 {count - 1}건"

    # 수신자: 담당 직원이 있으면 포함, 없으면 관리자에게만
    recipients = list(manager_ids or [])
    if user_id and user_id not in recipients:
        recipients.insert(0, user_id)

    return [
        {
            "user_id": uid,
            "case_id": case["id"],
            "firm_id": case.get("firm_id"),
            "type": "progress_update",
            "priority": "normal",
            "title": title,
            "message": message,
        }
        for uid in recipients
    ]


def build_correction_notification(
    case: dict,
    document_type: str,
    document_category: str,
    manager_ids: list[str] | None = None,
) -> list[dict]:
    """보정 문서 자동 감지 알림 — 담당 직원 + 팀장/관리자"""
    user_id = case.get("assigned_to")
    case_label = case.get("case_number") or case.get("applicant_name", "")
    is_urgent = document_category == "correction"

    recipients = list(manager_ids or [])
    if user_id and user_id not in recipients:
        recipients.insert(0, user_id)

    return [
        {
            "user_id": uid,
            "case_id": case["id"],
            "firm_id": case.get("firm_id"),
            "type": "correction_new",
            "priority": "urgent" if is_urgent else "normal",
            "title": f"송달문서 감지: {document_type}",
            "message": case_label,
        }
        for uid in recipients
    ]


def build_status_change_notification(
    case: dict,
    old_status: str,
    new_status: str,
    manager_ids: list[str] | None = None,
) -> list[dict]:
    """사건 상태 변경 알림 — 담당 직원 + 팀장/관리자"""
    user_id = case.get("assigned_to")
    case_label = case.get("case_number") or case.get("applicant_name", "")
    old_label = STATUS_LABELS.get(old_status, old_status)
    new_label = STATUS_LABELS.get(new_status, new_status)

    recipients = list(manager_ids or [])
    if user_id and user_id not in recipients:
        recipients.insert(0, user_id)

    return [
        {
            "user_id": uid,
            "case_id": case["id"],
            "firm_id": case.get("firm_id"),
            "type": "status_change",
            "priority": "normal",
            "title": f"상태 변경: {old_label} → {new_label}",
            "message": case_label,
        }
        for uid in recipients
    ]
