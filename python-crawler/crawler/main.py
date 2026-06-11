"""크롤러 CLI 진입점

Usage:
    # DB에서 사건 조회 후 크롤링
    python -m crawler --case <case_id>

    # 직접 사건 정보 지정 (DB 저장 없이 크롤링만 확인)
    python -m crawler --dry-run --court "서울회생법원" --number "2023개회1140753" --name "김광휘"

    # DB의 전체 사건 크롤링 (org 단위)
    python -m crawler --org <firm_id>
    python -m crawler --org <firm_id> --workers 4
"""

import argparse
import json
import logging
import re
import sys
import threading
import time
import traceback as tb_module
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime

import httpx

from . import config
from .court_scraper import CourtScraper
from .diff_detector import detect_new_progress
from .correction_detector import (
    detect_delivery,
    detect_submission,
    detect_extension_request,
    build_correction_insert,
)
from .status_detector import detect_status
from .notification_builder import (
    build_progress_notification,
    build_correction_notification,
    build_status_change_notification,
)
from . import db

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ── 재판부 파싱 ──

def parse_judge_raw(raw: str | None) -> tuple[str | None, str | None]:
    """재판부 원문에서 재판부명과 전화번호를 분리한다.

    예: "제222단독(개인회생) (전화:인가전031-210-1438/인가후1216/면책1461)"
    → ("제222단독", "(전화:인가전031-210-1438/인가후1216/면책1461)")
    """
    if not raw:
        return None, None

    # 전화번호 부분 추출: (전화:...) 패턴
    phone = None
    phone_match = re.search(r"\(전화[:：].+?\)", raw)
    if phone_match:
        phone = phone_match.group(0)

    # 재판부명: 첫 번째 괄호 전까지
    name_match = re.match(r"^([^(（]+)", raw)
    judge_name = name_match.group(1).strip() if name_match else raw.strip()

    return judge_name or None, phone


# ── 채권자집회기일 감지 ──

_MEETING_KEYWORDS = ["채권자집회기일", "채권자집회", "집회기일"]


def detect_creditor_meeting(progress: list[dict]) -> str | None:
    """진행내역에서 채권자집회기일을 감지하여 날짜(YYYY-MM-DD)를 반환한다.

    여러 건이 있으면 가장 최근(마지막) 날짜를 반환한다.
    """
    meeting_date = None
    for row in progress:
        content = row.get("content") or ""
        if any(kw in content for kw in _MEETING_KEYWORDS):
            pd = row.get("progress_date") or ""
            # progress_date가 YYYY-MM-DD 형식인지 확인
            if re.match(r"\d{4}-\d{2}-\d{2}", pd):
                meeting_date = pd
            # content 안에 날짜가 포함된 경우 (예: "채권자집회기일 지정 2026.05.10")
            m = re.search(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", content)
            if m:
                meeting_date = f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"
    return meeting_date


# ── 결과 추적 ──

@dataclass
class CrawlStats:
    """스레드 안전한 크롤링 통계"""
    total: int = 0
    success: int = 0
    failed: int = 0
    new_progress: int = 0
    new_corrections: int = 0
    errors: dict = field(default_factory=dict)
    notifications: list = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def record_success(self, case_id: str, result: dict):
        with self._lock:
            self.success += 1
            self.new_progress += result.get("new_progress", 0)
            self.new_corrections += result.get("new_corrections", 0)
            self.notifications.extend(result.get("notifications", []))

    def record_failure(self, case_id: str, error: str, case: dict | None = None, traceback: str | None = None):
        with self._lock:
            self.failed += 1
            self.errors[case_id] = {
                "case_number": (case or {}).get("case_number", ""),
                "applicant_name": (case or {}).get("applicant_name", ""),
                "court": (case or {}).get("court_name") or (case or {}).get("court_region", ""),
                "error": error,
                "traceback": traceback,
            }


# ── 단일 사건 처리 (scraper를 외부에서 받는 버전) ──

def process_case(case: dict, scraper: CourtScraper, manager_ids: list[str] | None = None) -> dict:
    """사건 하나를 처리한다. scraper 인스턴스는 워커가 공유."""
    case_id = case["id"]
    case_number = case.get("case_number")
    applicant_name = case.get("applicant_name")
    court_name = case.get("court_name")
    court_region = case.get("court_region")
    firm_id = case.get("firm_id", "")

    if not case_number or not applicant_name:
        return {"success": False, "error": "사건번호/신청인 없음"}

    if not court_name and court_region:
        court_name = config.COURT_MAPPING.get(court_region)
    if not court_name:
        return {"success": False, "error": f"법원 매핑 불가: {court_region}"}

    # 1. 크롤링
    scrape_result = scraper.scrape_case(court_name, case_number, applicant_name)
    if not scrape_result:
        return {"success": False, "error": "크롤링 실패 (결과 없음)"}

    scraped = scrape_result.get("progress") or []
    case_type_name = scrape_result.get("case_type_name")
    judge_raw = scrape_result.get("judge_raw")
    commissioner = scrape_result.get("commissioner")

    if not scraped:
        return {"success": False, "error": "크롤링 실패 (진행내역 없음)"}

    # 사건명 업데이트 (개인회생, 개인파산 등)
    if case_type_name:
        db.update_case_type_name(case_id, case_type_name)

    # 재판부/위원 업데이트
    if judge_raw or commissioner:
        judge_name, judge_phone = parse_judge_raw(judge_raw)
        judge_info = " ".join(filter(None, [judge_name, commissioner]))
        if judge_info:
            db.update_judge_info(case_id, judge_info, judge_phone)

    # 2. 기존 데이터와 비교
    existing = case.get("progress_data") or []
    new_rows, updated_rows = detect_new_progress(scraped, existing)

    if not new_rows and not updated_rows:
        # 변경 없어도 미완료 보정의 제출 여부는 확인
        active_corrections = db.fetch_active_corrections(case_id)
        if active_corrections:
            submissions_processed = 0
            pending_corrs = sorted(active_corrections, key=lambda c: c.get("served_date", ""))
            submitted_ids = set()
            for row in sorted(existing, key=lambda r: r.get("progress_date", "")):
                submitted_date = detect_submission(row)
                if submitted_date:
                    for corr in pending_corrs:
                        if corr["id"] not in submitted_ids and corr.get("served_date", "") <= submitted_date:
                            if db.update_correction_submitted(corr["id"], submitted_date):
                                submitted_ids.add(corr["id"])
                                submissions_processed += 1
                                log.info(f"보정 제출 감지: {corr['document_type']} (송달 {corr['served_date']}) → {submitted_date}")
            if submissions_processed > 0:
                db.update_case_correction_counts(case_id)

        # 연장 신청 감지 (가장 최근 보정에만 매칭)
        active_after = db.fetch_active_corrections(case_id)
        if active_after:
            sorted_corrs = sorted(active_after, key=lambda c: c.get("served_date", ""), reverse=True)
            for row in existing:
                ext_date = detect_extension_request(row)
                if ext_date:
                    for corr in sorted_corrs:
                        if corr.get("served_date", "") <= ext_date:
                            if not db.check_extension_exists(corr["id"], ext_date):
                                ext_id = db.insert_extension_request(corr["id"], ext_date)
                                if ext_id:
                                    log.info(f"연장 신청 감지: {corr['document_type']} → {ext_date}")
                            break

        # 채권자집회기일 감지 (변경 없는 경우에도)
        latest_meeting = detect_creditor_meeting(existing)
        if latest_meeting:
            current_meeting = case.get("creditor_meeting") or ""
            if latest_meeting != current_meeting:
                db.update_creditor_meeting(case_id, latest_meeting)
                log.info(f"채권자집회기일 갱신: {latest_meeting}")

        db.update_case_last_crawled(case_id)
        return {"success": True, "case_number": case_number, "new_progress": 0,
                "new_corrections": 0, "status_changed": False, "notifications": []}

    # 3. progress_data 덮어쓰기 (기존 + 신규, result 변경분 반영)
    update_map = {
        (r["progress_date"], r["content"]): r
        for r in updated_rows
    }
    merged = [
        update_map.get((r.get("progress_date", ""), r.get("content", "")), r)
        for r in existing
    ]
    all_progress = merged + new_rows
    if new_rows or updated_rows:
        db.update_case_progress_data(case_id, all_progress)

    # 4. 보정/제출 감지 (신규 항목만)
    new_corrections = 0
    arrival_updates = 0
    notifications = []

    # 4a. 도달일 업데이트 (updated_rows: result가 새로 생긴 기존 행)
    for row in updated_rows:
        detected = detect_delivery(row)
        if detected and detected.arrival_date and detected.document_category == "correction":
            updated = db.update_correction_arrival_date(
                case_id,
                detected.document_type,
                detected.served_date,
                detected.arrival_date,
                detected.arrival_raw,
            )
            if updated:
                arrival_updates += 1
                log.info(
                    f"도달일 기한 재계산: {detected.document_type} "
                    f"송달 {detected.served_date} → 도달 {detected.arrival_date} 기준"
                )

    # 전체 progress에서 누락된 보정 생성 + 도달일 업데이트
    for row in all_progress:
        detected = detect_delivery(row)
        if detected and detected.served_date and detected.document_category == "correction":
            if not db.check_correction_exists(case_id, detected.document_type, detected.served_date):
                corr_data = build_correction_insert(case_id, firm_id, detected)
                corr_id = db.insert_correction(corr_data)
                if corr_id:
                    new_corrections += 1
                    notifications.extend(build_correction_notification(
                        case, detected.document_type, detected.document_category,
                        manager_ids=manager_ids,
                    ))
                    closed = db.close_overdue_corrections_of_type(
                        case_id, detected.document_type,
                        before_served_date=detected.served_date,
                        submitted_date=detected.served_date,
                    )
                    if closed:
                        log.info(f"이전 시간도과 보정 소급 처리: {detected.document_type} {closed}건")
            elif detected.arrival_date:
                updated = db.update_correction_arrival_date(
                    case_id, detected.document_type, detected.served_date,
                    detected.arrival_date, detected.arrival_raw,
                )
                if updated:
                    arrival_updates += 1
                    log.info(
                        f"[new_rows] 도달일 기한 재계산: {detected.document_type} "
                        f"송달 {detected.served_date} → 도달 {detected.arrival_date} 기준"
                    )

    # 4b. 제출 감지 (시간순: 제출 1건 → 그 시점까지 미제출 보정 전부 처리)
    active_corrections = db.fetch_active_corrections(case_id)
    if active_corrections:
        submissions_processed = 0
        pending_corrs = sorted(active_corrections, key=lambda c: c.get("served_date", ""))
        submitted_ids = set()

        for row in sorted(all_progress, key=lambda r: r.get("progress_date", "")):
            submitted_date = detect_submission(row)
            if submitted_date:
                for corr in pending_corrs:
                    if corr["id"] not in submitted_ids and corr.get("served_date", "") <= submitted_date:
                        if db.update_correction_submitted(corr["id"], submitted_date):
                            submitted_ids.add(corr["id"])
                            submissions_processed += 1
                            log.info(f"보정 제출 감지: {corr['document_type']} (송달 {corr['served_date']}) → {submitted_date}")
        if submissions_processed > 0:
            db.update_case_correction_counts(case_id)

    # 4c. 연장 신청 감지 (모든 행에서, 가장 최근 보정에만 매칭)
    active_after_submit = db.fetch_active_corrections(case_id)
    if active_after_submit:
        # 송달일 기준 내림차순 정렬 → 가장 최근 보정이 먼저
        sorted_corrs = sorted(active_after_submit, key=lambda c: c.get("served_date", ""), reverse=True)
        for row in all_progress:
            ext_date = detect_extension_request(row)
            if ext_date:
                # 연장신청일 이전에 송달된 보정 중 가장 최근 것에만 매칭
                for corr in sorted_corrs:
                    if corr.get("served_date", "") <= ext_date:
                        if not db.check_extension_exists(corr["id"], ext_date):
                            ext_id = db.insert_extension_request(corr["id"], ext_date)
                            if ext_id:
                                log.info(f"연장 신청 감지: {corr['document_type']} → {ext_date}")
                        break  # 가장 최근 보정에만 매칭

    # 4d. 채권자집회기일 감지 (진행내역에서 가장 최근 집회기일 추출)
    latest_meeting = detect_creditor_meeting(all_progress)
    if latest_meeting:
        current_meeting = case.get("creditor_meeting") or ""
        if latest_meeting != current_meeting:
            db.update_creditor_meeting(case_id, latest_meeting)
            log.info(f"채권자집회기일 갱신: {latest_meeting}")

    # 5. 상태 판단
    current_status = case.get("status", "pending")
    new_status = detect_status(all_progress, current_status)
    if new_status:
        db.update_case_status(case_id, new_status)

        # 종결 상태면 미완료 보정 전부 제출완료 처리
        terminal = {"approved", "discharged", "dismissed", "withdrawn"}
        if new_status in terminal:
            close_date = max((r.get("progress_date", "") for r in all_progress), default="")
            remaining = db.fetch_active_corrections(case_id)
            for corr in remaining:
                db.update_correction_submitted(corr["id"], close_date)
            if remaining:
                db.update_case_correction_counts(case_id)
                log.info(f"종결 처리: 미완료 보정 {len(remaining)}건 → 제출완료 ({close_date})")

    # 6. 알림 수집
    notifications.extend(build_progress_notification(case, new_rows, manager_ids=manager_ids))

    if new_status:
        notifications.extend(build_status_change_notification(
            case, current_status, new_status, manager_ids=manager_ids
        ))

    # 7. 후처리
    db.update_case_last_crawled(case_id)
    if new_corrections > 0:
        db.update_case_correction_counts(case_id)
    if new_rows:
        db.update_unseen_changes(case_id, len(new_rows))

    return {
        "success": True,
        "case_number": case_number,
        "new_progress": len(new_rows),
        "updated_progress": len(updated_rows),
        "new_corrections": new_corrections,
        "arrival_updates": arrival_updates,
        "status_changed": new_status is not None,
        "notifications": notifications,
    }


# ── 워커 함수 ──

def run_worker(
    worker_id: int,
    cases: list[dict],
    stats: CrawlStats,
    headless: bool,
    manager_ids: list[str] | None = None,
):
    """워커 스레드: 자기 담당 사건들을 순차 처리."""
    tag = f"W{worker_id}"
    log.info(f"[{tag}] 시작 — {len(cases)}건 담당")

    scraper = CourtScraper(headless=headless)
    consecutive_fails = 0

    try:
        for i, case in enumerate(cases, 1):
            cnum = case.get("case_number", "?")
            cname = case.get("applicant_name", "?")
            log.info(f"[{tag}] ({i}/{len(cases)}) {cnum} {cname}")

            result = None
            for attempt in range(1, 3):  # 최대 2회 시도
                try:
                    result = process_case(case, scraper, manager_ids=manager_ids)
                except Exception as e:
                    trace = tb_module.format_exc()
                    result = {"success": False, "error": str(e), "_traceback": trace}

                if result["success"]:
                    break

                # 크롤링 실패(서버 disconnect 등)면 브라우저 재시작 후 1회 재시도
                if "크롤링 실패" in result.get("error", "") and attempt == 1:
                    log.warning(f"[{tag}]   → 크롤링 실패, 15초 후 브라우저 재시작하여 재시도...")
                    time.sleep(15)
                    try:
                        scraper.close()
                    except Exception:
                        pass
                    scraper = CourtScraper(headless=headless)
                else:
                    break

            if result["success"]:
                stats.record_success(case["id"], result)
                consecutive_fails = 0
                np = result.get("new_progress", 0)
                up = result.get("updated_progress", 0)
                nc = result.get("new_corrections", 0)
                au = result.get("arrival_updates", 0)
                if np > 0 or up > 0 or nc > 0 or au > 0:
                    log.info(f"[{tag}]   → 신규 {np}건, result변경 {up}건, 보정 {nc}건, 도달일재계산 {au}건")
            else:
                err_msg = result.get("error", "알 수 없는 오류")
                trace = result.get("_traceback")
                stats.record_failure(case["id"], err_msg, case=case, traceback=trace)
                log.warning(f"[{tag}]   → 최종 실패: {err_msg}")
                consecutive_fails += 1

            # 연속 3회 실패 시 scraper 재생성
            if consecutive_fails >= 3:
                log.warning(f"[{tag}] 연속 {consecutive_fails}회 실패 — 브라우저 재시작")
                try:
                    scraper.close()
                except Exception:
                    pass
                scraper = CourtScraper(headless=headless)
                consecutive_fails = 0

            # 사건 간 간격 (서버 부하 방지)
            time.sleep(1)

    finally:
        try:
            scraper.close()
        except Exception:
            pass

    log.info(f"[{tag}] 완료")


# ── 전체 크롤링 ──

def auto_worker_count(case_count: int, max_workers: int = 8) -> int:
    """사건 수에 따라 워커 수를 자동 결정한다."""
    return max_workers


def crawl_organization(firm_id: str | None = None, max_workers: int = 4, headless: bool = True, year: int | None = None) -> dict:
    """전체 사건을 병렬 크롤링한다. firm_id 지정 시 해당 조직만."""
    start_time = datetime.utcnow()

    # 1. 대상 사건 조회
    cases = db.fetch_active_cases(firm_id, year=year)
    if not cases:
        log.warning("크롤링 대상 사건이 없습니다")
        return {"success": True, "total": 0}

    # 팀장/관리자 목록 (알림 수신자)
    manager_ids = db.fetch_org_managers(firm_id) if firm_id else []
    log.info(f"알림 수신 관리자: {len(manager_ids)}명")

    # 워커 수 자동 결정
    worker_count = auto_worker_count(len(cases), max_workers)

    scope = f"firm {firm_id}" if firm_id else "전체"
    log.info("=" * 60)
    log.info(f"크롤링 시작 ({scope}): {len(cases)}건, 워커 {worker_count}대 (최대 {max_workers})")
    log.info("=" * 60)

    # 2. 크롤링 로그 생성
    crawl_log_id = db.create_crawl_log(firm_id, worker_count) if firm_id else None

    # 3. 사건을 워커 수만큼 분배
    stats = CrawlStats(total=len(cases))
    chunks = [[] for _ in range(worker_count)]
    for i, case in enumerate(cases):
        chunks[i % worker_count].append(case)

    # 4. 병렬 실행
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = []
        for wid, chunk in enumerate(chunks, 1):
            if chunk:
                f = executor.submit(run_worker, wid, chunk, stats, headless, manager_ids)
                futures.append(f)

        # 완료 대기
        for f in as_completed(futures):
            try:
                f.result()  # 예외 전파
            except Exception as e:
                log.error(f"워커 예외: {e}")

    # 5. 알림 배치 삽입
    if stats.notifications:
        log.info(f"알림 {len(stats.notifications)}건 삽입 중...")
        db.insert_notifications(stats.notifications)

    # 6. 크롤링 로그 마감
    end_time = datetime.utcnow()
    elapsed = (end_time - start_time).total_seconds()
    final_status = "completed" if stats.failed < stats.total * 0.5 else "failed"

    if crawl_log_id:
        db.update_crawl_log(
            crawl_log_id,
            finished_at=end_time.isoformat(),
            status=final_status,
            total_cases=stats.total,
            success_count=stats.success,
            fail_count=stats.failed,
            new_progress=stats.new_progress,
            new_corrections=stats.new_corrections,
            error_log=stats.errors if stats.errors else None,
        )

    # 7. 기한 재계산 트리거 (기존 TS cron 활용)
    trigger_deadline_update()

    # 8. 결과 출력
    summary = {
        "success": True,
        "status": final_status,
        "total": stats.total,
        "success_count": stats.success,
        "failed_count": stats.failed,
        "new_progress": stats.new_progress,
        "new_corrections": stats.new_corrections,
        "elapsed_seconds": round(elapsed, 1),
        "elapsed_human": f"{int(elapsed // 60)}분 {int(elapsed % 60)}초",
    }

    log.info(f"=" * 60)
    log.info(f"크롤링 완료!")
    log.info(json.dumps(summary, ensure_ascii=False, indent=2))
    if stats.errors:
        log.warning(f"실패 {len(stats.errors)}건 상세:")
        for cid, info in stats.errors.items():
            cnum = info.get("case_number", cid)
            cname = info.get("applicant_name", "")
            court = info.get("court", "")
            err = info.get("error", "")
            log.warning(f"  [{cnum}] {cname} ({court}) → {err}")
            if info.get("traceback"):
                log.debug(f"    traceback:\n{info['traceback']}")
    log.info(f"=" * 60)

    return summary


def trigger_deadline_update():
    """기존 Next.js 기한 재계산 API 호출"""
    url = f"{config.APP_URL}/api/cron/update-deadlines"
    headers = {}
    if config.CRON_SECRET:
        headers["Authorization"] = f"Bearer {config.CRON_SECRET}"

    try:
        log.info("기한 재계산 트리거 중...")
        resp = httpx.post(url, headers=headers, timeout=120)
        if resp.status_code == 200:
            data = resp.json()
            log.info(f"기한 재계산 완료: {data}")
        else:
            log.warning(f"기한 재계산 응답: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        log.warning(f"기한 재계산 호출 실패 (수동 실행 필요): {e}")


# ── 복수 사건 (ID 목록 지정) ──

def crawl_cases(case_ids: list[str], max_workers: int = 8, headless: bool = True) -> dict:
    """지정된 case_id 목록을 병렬 크롤링한다. 실패 건 재시도용."""
    start_time = datetime.utcnow()

    cases = []
    for cid in case_ids:
        case = db.fetch_case_by_id(cid)
        if case:
            cases.append(case)
        else:
            log.warning(f"사건 조회 실패 (스킵): {cid}")

    if not cases:
        log.warning("크롤링 대상 사건이 없습니다")
        return {"success": True, "total": 0}

    worker_count = min(max_workers, len(cases))

    log.info("=" * 60)
    log.info(f"지정 크롤링 시작: {len(cases)}건, 워커 {worker_count}대")
    log.info("=" * 60)

    stats = CrawlStats(total=len(cases))
    chunks = [[] for _ in range(worker_count)]
    for i, case in enumerate(cases):
        chunks[i % worker_count].append(case)

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = []
        for wid, chunk in enumerate(chunks, 1):
            if chunk:
                f = executor.submit(run_worker, wid, chunk, stats, headless)
                futures.append(f)

        for f in as_completed(futures):
            try:
                f.result()
            except Exception as e:
                log.error(f"워커 예외: {e}")

    if stats.notifications:
        log.info(f"알림 {len(stats.notifications)}건 삽입 중...")
        db.insert_notifications(stats.notifications)

    elapsed = (datetime.utcnow() - start_time).total_seconds()
    summary = {
        "success": True,
        "total": stats.total,
        "success_count": stats.success,
        "failed_count": stats.failed,
        "new_progress": stats.new_progress,
        "new_corrections": stats.new_corrections,
        "elapsed_human": f"{int(elapsed // 60)}분 {int(elapsed % 60)}초",
    }

    log.info("=" * 60)
    log.info(f"지정 크롤링 완료!")
    log.info(json.dumps(summary, ensure_ascii=False, indent=2))
    if stats.errors:
        log.info(f"실패 건수: {len(stats.errors)}건")
        for cid, err in stats.errors.items():
            log.info(f"  {cid}: {err}")
    log.info("=" * 60)

    return summary


# ── 단일 사건 (기존) ──

def crawl_single_case(case_id: str, headless: bool = True) -> dict:
    """DB에서 사건 정보를 가져와 크롤링하고, 결과를 DB에 반영한다."""
    case = db.fetch_case_by_id(case_id)
    if not case:
        return {"success": False, "error": "사건을 찾을 수 없습니다"}

    log.info(f"=== 단일 크롤링: {case.get('case_number')} {case.get('applicant_name')} ===")

    firm_id = case.get("firm_id", "")
    manager_ids = db.fetch_org_managers(firm_id) if firm_id else []

    scraper = CourtScraper(headless=headless)
    try:
        result = process_case(case, scraper, manager_ids=manager_ids)
    finally:
        scraper.close()

    # 알림 삽입
    notifs = result.get("notifications", [])
    if notifs:
        log.info(f"알림 {len(notifs)}건 삽입")
        db.insert_notifications(notifs)

    log.info(json.dumps(result, ensure_ascii=False, indent=2))
    return result


# ── 사건번호 직접 지정 크롤링 (DB 저장) ──

def crawl_by_number(court_name: str, case_number: str, applicant_name: str,
                    headless: bool = True, firm_id: str | None = None) -> dict:
    """법원명/사건번호/당사자명으로 크롤링하고 DB에 저장한다.
    사건이 DB에 없으면 신규 삽입, 있으면 progress_data 업데이트."""
    case = db.fetch_case_by_number(case_number, applicant_name=applicant_name)

    if case:
        # ── 기존 사건: 업데이트 ──
        if not case.get("court_name"):
            case = {**case, "court_name": court_name}
        log.info(f"=== 기존 사건 크롤링 (DB 업데이트): {case_number} {applicant_name} ===")
        resolved_firm_id = case.get("firm_id", "")
        manager_ids = db.fetch_org_managers(resolved_firm_id) if resolved_firm_id else []

        scraper = CourtScraper(headless=headless)
        try:
            result = process_case(case, scraper, manager_ids=manager_ids)
        finally:
            scraper.close()

        notifs = result.get("notifications", [])
        if notifs:
            db.insert_notifications(notifs)

        log.info(json.dumps(result, ensure_ascii=False, indent=2))
        return result

    # ── 신규 사건: 스크래핑 후 삽입 ──
    log.info(f"=== 신규 사건 크롤링 + DB 삽입: {court_name} / {case_number} / {applicant_name} ===")

    # firm_id 결정
    if not firm_id:
        firm_id = db.fetch_default_firm_id()
    if not firm_id:
        return {"success": False, "error": "firm_id를 특정할 수 없습니다. --org 옵션을 지정해주세요."}

    scraper = CourtScraper(headless=headless)
    try:
        scrape_result = scraper.scrape_case(court_name, case_number, applicant_name)
    finally:
        scraper.close()

    if scrape_result is None:
        return {"success": False, "error": "크롤링 실패"}

    scraped = scrape_result.get("progress") or []
    case_type_name = scrape_result.get("case_type_name")

    # 초기 상태 판단
    initial_status = detect_status(scraped, "pending") or "pending"

    # 사건 삽입
    insert_data: dict = {
        "case_number": case_number,
        "applicant_name": applicant_name,
        "court_name": court_name,
        "firm_id": firm_id,
        "status": initial_status,
        "progress_data": scraped,
        "last_crawled_at": datetime.utcnow().isoformat(),
    }
    if case_type_name:
        insert_data["case_type"] = case_type_name
    case_id = db.insert_case(insert_data)
    if not case_id:
        return {"success": False, "error": "사건 DB 삽입 실패"}

    log.info(f"사건 삽입 완료: {case_id}")

    # 보정 감지 및 삽입
    new_corrections = 0
    for row in scraped:
        detected = detect_delivery(row)
        if detected and detected.served_date and detected.document_category == "correction":
            if not db.check_correction_exists(case_id, detected.document_type, detected.served_date):
                corr_data = build_correction_insert(case_id, firm_id, detected)
                if db.insert_correction(corr_data):
                    new_corrections += 1

    if new_corrections:
        db.update_case_correction_counts(case_id)

    result = {
        "success": True,
        "case_id": case_id,
        "case_number": case_number,
        "new_progress": len(scraped),
        "new_corrections": new_corrections,
        "status": initial_status,
    }
    log.info(json.dumps(result, ensure_ascii=False, indent=2))
    return result


# ── Dry Run ──

def dry_run(court_name: str, case_number: str, applicant_name: str, headless: bool = True):
    """DB 저장 없이 크롤링만 수행하여 결과를 출력한다."""
    log.info(f"=== DRY RUN: {court_name} / {case_number} / {applicant_name} ===")

    scraper = CourtScraper(headless=headless)
    try:
        scrape_result = scraper.scrape_case(court_name, case_number, applicant_name)
    finally:
        scraper.close()

    if scrape_result is None:
        log.error("크롤링 실패")
        return

    data = scrape_result.get("progress") or []
    case_type_name = scrape_result.get("case_type_name")
    if case_type_name:
        log.info(f"사건명: {case_type_name}")

    log.info(f"총 {len(data)}건의 진행내역:")
    print()
    for i, row in enumerate(data, 1):
        d = row.get("progress_date", "")
        c = row.get("content", "")
        r = row.get("result", "")
        n = row.get("notification", "")
        print(f"  {i:3d}. [{d}] {c}")
        if r:
            print(f"       처리결과: {r}")
        if n:
            print(f"       통지: {n}")

        detected = detect_delivery(row)
        if detected:
            print(f"       -> 송달감지: {detected.document_type} ({detected.document_category}, 기한 {detected.default_days}일)")

    new_status = detect_status(data, "pending")
    if new_status:
        print(f"\n  자동 판단 상태: {new_status}")


# ── CLI ──

def main():
    parser = argparse.ArgumentParser(description="CaseFlow 크롤러")

    group = parser.add_mutually_exclusive_group()
    group.add_argument("--case", help="단일 사건 ID 크롤링")
    group.add_argument("--cases", nargs="+", help="여러 사건 ID 크롤링 (실패 건 재시도용)")
    group.add_argument("--firm", help="firm_id (생략 시 자동 감지)")
    group.add_argument("--dry-run", action="store_true", help="DB 저장 없이 크롤링 테스트")
    group.add_argument("--crawl", action="store_true", help="법원명/사건번호/당사자명으로 DB 사건 찾아 크롤링 후 저장")

    # dry-run / crawl 공용
    parser.add_argument("--court", help="법원명 (dry-run / --crawl 용)")
    parser.add_argument("--number", help="사건번호 (dry-run / --crawl 용)")
    parser.add_argument("--name", help="당사자명 (dry-run / --crawl 용)")

    # 전체 크롤링 옵션
    parser.add_argument("--max-workers", type=int, default=config.WORKER_COUNT, help=f"최대 워커 수 (기본값: {config.WORKER_COUNT})")
    parser.add_argument("--year", type=int, default=None, help="특정 연도 사건만 크롤링 (예: --year 2025)")

    # 공통
    parser.add_argument("--no-headless", action="store_true", help="브라우저 화면 표시")

    args = parser.parse_args()
    headless = not args.no_headless

    if args.dry_run:
        if not all([args.court, args.number, args.name]):
            parser.error("--dry-run에는 --court, --number, --name이 필요합니다")
        dry_run(args.court, args.number, args.name, headless=headless)

    elif args.crawl:
        if not all([args.court, args.number, args.name]):
            parser.error("--crawl에는 --court, --number, --name이 필요합니다")
        result = crawl_by_number(args.court, args.number, args.name, headless=headless, firm_id=args.firm)
        if not result["success"]:
            log.error(f"실패: {result.get('error')}")
            sys.exit(1)

    elif args.case:
        result = crawl_single_case(args.case, headless=headless)
        if not result["success"]:
            log.error(f"실패: {result.get('error')}")
            sys.exit(1)

    elif args.cases:
        result = crawl_cases(args.cases, max_workers=args.max_workers, headless=headless)
        if not result["success"]:
            sys.exit(1)

    else:
        firm_id = args.firm or None
        result = crawl_organization(firm_id, max_workers=args.max_workers, headless=headless, year=args.year)
        if not result["success"]:
            sys.exit(1)


if __name__ == "__main__":
    main()
