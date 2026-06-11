"""Supabase DB 조작 (service role key 사용)"""

import logging
from datetime import date, datetime, timedelta
from supabase import create_client, Client
from . import config

log = logging.getLogger(__name__)

_client: Client | None = None


def get_supabase() -> Client:
    global _client
    if _client is None:
        if not config.SUPABASE_URL or not config.SUPABASE_KEY:
            raise RuntimeError("SUPABASE_URL / SUPABASE_ANON_KEY 미설정")
        _client = create_client(config.SUPABASE_URL, config.SUPABASE_KEY)
        # 데스크탑 sidecar: 사용자 JWT로 RLS 통과 (service_role 미사용)
        if config.SUPABASE_ACCESS_TOKEN:
            try:
                _client.postgrest.auth(config.SUPABASE_ACCESS_TOKEN)
                log.info("[supabase] using user access_token (RLS-enforced)")
            except Exception as e:
                log.error(f"[supabase] postgrest.auth failed: {e}")
        else:
            log.warning("[supabase] no access_token — running as anon (limited RLS access)")
    return _client


# ── 조직 ──

def fetch_default_firm_id() -> str | None:
    """조직이 1개면 자동 반환, 여러 개면 None"""
    result = get_supabase().table("law_firms").select("id").limit(2).execute()
    rows = result.data or []
    if len(rows) == 1:
        return rows[0]["id"]
    return None


def fetch_org_managers(firm_id: str) -> list[str]:
    """조직의 manager/super_admin user_id 목록 반환"""
    result = (
        get_supabase()
        .table("profiles")
        .select("id")
        .eq("firm_id", firm_id)
        .in_("role", ["firm_admin", "super_admin"])
        .execute()
    )
    return [r["id"] for r in result.data or []]


# ── 사건 조회 ──

def fetch_case_by_id(case_id: str) -> dict | None:
    """단일 사건 조회"""
    try:
        result = (
            get_supabase()
            .table("cf_cases")
            .select("id, case_number, applicant_name, court_region, court_name, assigned_to, firm_id, status, progress_data, creditor_meeting")
            .eq("id", case_id)
            .single()
            .execute()
        )
        return result.data
    except Exception:
        return None


def fetch_case_by_number(case_number: str, applicant_name: str | None = None) -> dict | None:
    """사건번호(+당사자명)로 사건 조회"""
    try:
        q = (
            get_supabase()
            .table("cf_cases")
            .select("id, case_number, applicant_name, court_region, court_name, assigned_to, firm_id, status, progress_data")
            .eq("case_number", case_number)
        )
        if applicant_name:
            q = q.eq("applicant_name", applicant_name)
        result = q.limit(1).execute()
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as e:
        log.error(f"사건번호 조회 실패: {e}")
        return None


def insert_case(data: dict) -> str | None:
    """신규 사건 삽입. 삽입된 case id 반환"""
    try:
        result = get_supabase().table("cf_cases").insert(data).execute()
        if result.data:
            return result.data[0].get("id")
        return None
    except Exception as e:
        log.error(f"사건 삽입 실패: {e}")
        return None


def fetch_active_cases(firm_id: str | None = None, year: int | None = None) -> list[dict]:
    """크롤링 대상 사건 조회 (case_number가 있고 종결 상태가 아닌 것)"""
    q = (
        get_supabase()
        .table("cf_cases")
        .select("id, case_number, applicant_name, court_region, court_name, assigned_to, firm_id, status, progress_data")
        .not_.is_("case_number", "null")
    )
    if firm_id:
        q = q.eq("firm_id", firm_id)
    if year:
        q = q.like("case_number", f"{year}%")
    result = q.execute()
    # 종결 상태 필터 (클라이언트 측)
    terminal = {"discharged", "dismissed", "cancelled", "withdrawn"}
    return [c for c in (result.data or []) if c.get("status") not in terminal]


# ── 진행내역 (JSON) ──

def update_case_progress_data(case_id: str, progress_data: list[dict]) -> bool:
    """cases.progress_data 전체 덮어쓰기"""
    try:
        get_supabase().table("cf_cases").update(
            {"progress_data": progress_data}
        ).eq("id", case_id).execute()
        return True
    except Exception as e:
        log.error(f"progress_data 갱신 실패: {e}")
        return False


# ── 사건 상태 ──

def update_case_status(case_id: str, new_status: str) -> bool:
    try:
        get_supabase().table("cf_cases").update({"status": new_status}).eq("id", case_id).execute()
        return True
    except Exception as e:
        log.error(f"사건 상태 갱신 실패: {e}")
        return False


def update_case_last_crawled(case_id: str) -> bool:
    try:
        get_supabase().table("cf_cases").update(
            {"last_crawled_at": datetime.utcnow().isoformat()}
        ).eq("id", case_id).execute()
        return True
    except Exception as e:
        log.error(f"last_crawled_at 갱신 실패: {e}")
        return False


def update_case_type_name(case_id: str, case_type_name: str) -> bool:
    """사건명 업데이트 (개인회생, 개인파산 등)"""
    try:
        get_supabase().table("cf_cases").update(
            {"case_type": case_type_name}
        ).eq("id", case_id).execute()
        return True
    except Exception as e:
        log.error(f"사건명 갱신 실패: {e}")
        return False


def update_judge_info(case_id: str, judge_info: str, judge_phone: str | None = None) -> bool:
    """재판부/위원 + 전화번호 업데이트"""
    try:
        data: dict = {"judge_info": judge_info}
        if judge_phone is not None:
            data["judge_phone"] = judge_phone
        get_supabase().table("cf_cases").update(data).eq("id", case_id).execute()
        return True
    except Exception as e:
        log.error(f"재판부/위원 갱신 실패: {e}")
        return False


def update_creditor_meeting(case_id: str, meeting_date: str) -> bool:
    """채권자집회기일 업데이트"""
    try:
        get_supabase().table("cf_cases").update(
            {"creditor_meeting": meeting_date}
        ).eq("id", case_id).execute()
        return True
    except Exception as e:
        log.error(f"채권자집회기일 갱신 실패: {e}")
        return False


def update_unseen_changes(case_id: str, count: int) -> bool:
    try:
        get_supabase().table("cf_cases").update(
            {"unseen_changes": count}
        ).eq("id", case_id).execute()
        return True
    except Exception as e:
        log.error(f"unseen_changes 갱신 실패: {e}")
        return False


# ── 보정 ──

def fetch_active_corrections(case_id: str) -> list[dict]:
    """미완료 보정 조회"""
    result = (
        get_supabase()
        .table("cf_case_corrections")
        .select("id, document_type, served_date, deadline_date, status")
        .eq("case_id", case_id)
        .in_("status", ["pending", "approaching", "overdue"])
        .execute()
    )
    return result.data or []


def fetch_all_corrections(case_id: str) -> list[dict]:
    """전체 보정 조회 (연장신청 감지용)"""
    result = (
        get_supabase()
        .table("cf_case_corrections")
        .select("id, document_type, served_date, deadline_date, status")
        .eq("case_id", case_id)
        .execute()
    )
    return result.data or []


def check_correction_exists(case_id: str, document_type: str, served_date: str) -> bool:
    """동일 보정 존재 여부 확인 (중복 방지)"""
    result = (
        get_supabase()
        .table("cf_case_corrections")
        .select("id", count="exact")
        .eq("case_id", case_id)
        .eq("document_type", document_type)
        .eq("served_date", served_date)
        .execute()
    )
    return (result.count or 0) > 0


def insert_correction(data: dict) -> str | None:
    """보정 레코드 삽입"""
    try:
        result = get_supabase().table("cf_case_corrections").insert(data).execute()
        if result.data:
            return result.data[0].get("id")
        return None
    except Exception as e:
        log.error(f"보정 삽입 실패: {e}")
        return None


def update_correction_arrival_date(
    case_id: str,
    document_type: str,
    served_date: str,
    arrival_date: str,
    arrival_raw: str | None = None,
) -> bool:
    """도달일 확인 시 기존 보정의 기한을 재계산한다. received_date가 없는 경우에만 업데이트."""
    try:
        bd = date.fromisoformat(arrival_date)
        # 0시 도달 = 당일 기산, 일반 도달 = 익일 기산 (기산일 포함 7일)
        is_midnight = arrival_raw and "0시" in arrival_raw
        start = bd if is_midnight else bd + timedelta(days=1)
        d7 = (start + timedelta(days=6)).isoformat()
        deadline = d7

        today = date.today()
        diff = (date.fromisoformat(deadline) - today).days
        if diff < 0:
            status = "overdue"
            overdue_days = abs(diff)
        elif diff <= 3:
            status = "approaching"
            overdue_days = 0
        else:
            status = "pending"
            overdue_days = 0

        result = (
            get_supabase()
            .table("cf_case_corrections")
            .update({
                "received_date": arrival_date,
                "arrival_raw": arrival_raw,
                "deadline_7d": d7,
                "deadline_date": deadline,
                "status": status,
                "overdue_days": overdue_days,
            })
            .eq("case_id", case_id)
            .eq("document_type", document_type)
            .eq("served_date", served_date)
            .is_("received_date", "null")
            .neq("manual_submit", True)
            .not_.in_("status", ["submitted", "dismissed"])
            .execute()
        )
        return bool(result.data)
    except Exception as e:
        log.error(f"도달일 업데이트 실패: {e}")
        return False


def update_correction_submitted(correction_id: str, submitted_date: str) -> bool:
    try:
        get_supabase().table("cf_case_corrections").update(
            {"status": "submitted", "submitted_date": submitted_date}
        ).eq("id", correction_id).neq("manual_submit", True).execute()
        return True
    except Exception as e:
        log.error(f"보정 제출 처리 실패: {e}")
        return False


def check_extension_exists(correction_id: str, extension_date: str) -> bool:
    """동일 연장 신청 존재 여부 확인 (중복 방지)"""
    result = (
        get_supabase()
        .table("cf_correction_extensions")
        .select("id", count="exact")
        .eq("correction_id", correction_id)
        .eq("extension_date", extension_date)
        .execute()
    )
    return (result.count or 0) > 0


def insert_extension_request(correction_id: str, extension_date: str) -> str | None:
    """연장 신청 기록 삽입 (new_deadline은 null → 사용자가 직접 입력)"""
    try:
        # 현재 연장 차수 계산
        existing = (
            get_supabase()
            .table("cf_correction_extensions")
            .select("extension_number")
            .eq("correction_id", correction_id)
            .order("extension_number", desc=True)
            .limit(1)
            .execute()
        )
        next_num = (existing.data[0]["extension_number"] + 1) if existing.data else 1

        result = get_supabase().table("cf_correction_extensions").insert({
            "correction_id": correction_id,
            "extension_number": next_num,
            "extension_date": extension_date,
            "extension_days": None,
            "new_deadline": None,
        }).execute()

        if result.data:
            # 연장신청일 + 7일을 임시 기한으로 설정
            try:
                ext_d = date.fromisoformat(extension_date)
                temp_deadline = (ext_d + timedelta(days=7)).isoformat()
                get_supabase().table("cf_case_corrections").update({
                    "deadline_date": temp_deadline,
                }).eq("id", correction_id).execute()
            except Exception:
                pass
            return result.data[0].get("id")
        return None
    except Exception as e:
        log.error(f"연장 신청 기록 실패: {e}")
        return None


def close_overdue_corrections_of_type(
    case_id: str, document_type: str, before_served_date: str, submitted_date: str
) -> int:
    """동일 유형의 이전 시간도과 보정을 제출완료 처리한다.
    새 보정이 도착했다는 건 이전 보정이 처리됐다는 증거이므로 자동 소급 처리."""
    try:
        result = (
            get_supabase()
            .table("cf_case_corrections")
            .update({"status": "submitted", "submitted_date": submitted_date})
            .eq("case_id", case_id)
            .eq("document_type", document_type)
            .eq("status", "overdue")
            .neq("manual_submit", True)
            .lt("served_date", before_served_date)
            .execute()
        )
        return len(result.data or [])
    except Exception as e:
        log.error(f"이전 시간도과 보정 소급 처리 실패: {e}")
        return 0


def update_case_correction_counts(case_id: str) -> None:
    """비정규화 보정 카운트 갱신"""
    db = get_supabase()

    active = db.table("cf_case_corrections").select(
        "*", count="exact"
    ).eq("case_id", case_id).in_(
        "status", ["pending", "approaching", "overdue"]
    ).execute()

    overdue = db.table("cf_case_corrections").select(
        "*", count="exact"
    ).eq("case_id", case_id).eq("status", "overdue").execute()

    db.table("cf_cases").update({
        "active_corrections_count": active.count or 0,
        "overdue_corrections_count": overdue.count or 0,
    }).eq("id", case_id).execute()


# ── 알림 ──

def insert_notifications(notifications: list[dict]) -> int:
    """알림 배치 삽입"""
    if not notifications:
        return 0
    try:
        result = get_supabase().table("cf_notifications").insert(notifications).execute()
        return len(result.data or [])
    except Exception as e:
        log.error(f"알림 배치 삽입 실패: {e}")
        return 0


# ── 크롤링 로그 ──

def create_crawl_log(firm_id: str, worker_count: int = 1) -> str | None:
    try:
        result = get_supabase().table("cf_crawl_logs").insert({
            "firm_id": firm_id,
            "started_at": datetime.utcnow().isoformat(),
            "status": "running",
            "worker_count": worker_count,
        }).execute()
        if result.data:
            return result.data[0].get("id")
        return None
    except Exception as e:
        log.error(f"크롤링 로그 생성 실패: {e}")
        return None


def update_crawl_log(log_id: str, **kwargs) -> None:
    try:
        get_supabase().table("cf_crawl_logs").update(kwargs).eq("id", log_id).execute()
    except Exception as e:
        log.error(f"크롤링 로그 갱신 실패: {e}")
