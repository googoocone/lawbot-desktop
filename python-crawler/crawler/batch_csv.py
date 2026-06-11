"""CSV 파일에서 사건 목록을 읽어 배치 크롤링 테스트

실패한 사건은 자동으로 재시도하며, 법원에 존재하지 않는 사건은 별도 리포트.

Usage:
    # dry-run (DB 저장 없이 크롤링만 확인)
    python -m crawler.batch_csv --csv 의뢰인목록/crawling_test.csv --dry-run

    # 워커 수 / 재시도 횟수 옵션
    python -m crawler.batch_csv --csv 의뢰인목록/crawling_test.csv --dry-run --workers 3 --max-rounds 5

    # 처음 N건만 테스트
    python -m crawler.batch_csv --csv 의뢰인목록/crawling_test.csv --dry-run --limit 5

    # DB 저장 포함 크롤링
    python -m crawler.batch_csv --csv 의뢰인목록/crawling_test.csv --org <firm_id>
"""

import argparse
import csv
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
from pathlib import Path

from . import config
from .court_scraper import CourtScraper, CaseNotFoundError
from .correction_detector import detect_delivery
from .status_detector import detect_status

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# 사건번호 패턴 (예: 2025개회50454, 2026하단5312, 2026회단120, 2025라30381)
CASE_NUMBER_RE = re.compile(r"^\d{3,4}(개회|하단|회단|라)\d+$")


# ── 결과 카테고리 ──

RESULT_SUCCESS = "success"
RESULT_NOT_FOUND = "not_found"      # 법원에 사건이 없음 (재시도 불필요)
RESULT_FAILED = "failed"            # 일시적 실패 (재시도 대상)


@dataclass
class BatchStats:
    total: int = 0
    success: int = 0
    failed: int = 0
    not_found: int = 0
    success_list: list = field(default_factory=list)
    failed_list: list = field(default_factory=list)
    not_found_list: list = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def record(self, entry: dict, result_type: str, detail: dict | None = None):
        with self._lock:
            info = {
                "id": entry["id"],
                "name": entry["name"],
                "court": entry["court_region"],
                "case_number": entry["case_number"],
                **(detail or {}),
            }
            if result_type == RESULT_SUCCESS:
                self.success += 1
                self.success_list.append(info)
            elif result_type == RESULT_NOT_FOUND:
                self.not_found += 1
                self.not_found_list.append(info)
            else:
                self.failed += 1
                self.failed_list.append(info)


def parse_csv(csv_path: str) -> tuple[list[dict], list[dict]]:
    """CSV 파일을 파싱. (크롤링 대상, 스킵 목록) 반환."""
    entries = []
    skipped = []

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) < 5:
                continue

            entry_id = row[0].strip()
            case_type = row[1].strip()
            name = row[2].strip()
            court_region = row[3].strip()
            raw_value = row[4].strip()

            # 사건번호가 아닌 경우 스킵
            if not CASE_NUMBER_RE.match(raw_value):
                skipped.append({
                    "id": entry_id, "name": name,
                    "court_region": court_region, "reason": raw_value,
                })
                continue

            court_name = config.COURT_MAPPING.get(court_region)
            if not court_name:
                skipped.append({
                    "id": entry_id, "name": name,
                    "court_region": court_region, "reason": f"법원 매핑 불가: {court_region}",
                })
                continue

            entries.append({
                "id": entry_id,
                "case_type": case_type,
                "name": name,
                "court_region": court_region,
                "court_name": court_name,
                "case_number": raw_value,
            })

    return entries, skipped


def crawl_one(entry: dict, scraper: CourtScraper) -> tuple[str, dict]:
    """사건 1건 크롤링. (result_type, detail) 반환."""
    try:
        data = scraper.scrape_case(
            entry["court_name"],
            entry["case_number"],
            entry["name"],
        )
    except CaseNotFoundError as e:
        return RESULT_NOT_FOUND, {"error": str(e)}
    except Exception as e:
        return RESULT_FAILED, {"error": f"예외: {e}"}

    if data is None:
        return RESULT_FAILED, {"error": "크롤링 실패 (결과 없음)"}

    progress = data.get("progress") or [] if isinstance(data, dict) else data

    # 성공 — 요약 정보 수집
    status = detect_status(progress, "pending")
    corrections = []
    for row in progress:
        detected = detect_delivery(row)
        if detected:
            corrections.append(detected.document_type)

    return RESULT_SUCCESS, {
        "progress_count": len(progress),
        "status": status,
        "corrections": corrections,
    }


def worker_fn(
    worker_id: int,
    entries: list[dict],
    stats: BatchStats,
    headless: bool,
) -> list[dict]:
    """워커: 담당 사건을 순차 크롤링. 실패 건 목록을 반환."""
    tag = f"W{worker_id}"
    log.info(f"[{tag}] 시작 — {len(entries)}건 담당")

    scraper = CourtScraper(headless=headless)
    consecutive_fails = 0
    retry_later = []  # 이번 라운드 실패 → 다음 라운드 재시도 대상

    try:
        for i, entry in enumerate(entries, 1):
            log.info(
                f"[{tag}] ({i}/{len(entries)}) "
                f"[{entry['id']}] {entry['name']} — {entry['court_name']} {entry['case_number']}"
            )

            result_type, detail = crawl_one(entry, scraper)

            # 실패 시 1회 재시도 (브라우저 재시작 후)
            if result_type == RESULT_FAILED:
                log.warning(f"[{tag}]   → 실패: {detail.get('error')}, 15초 후 재시도...")
                time.sleep(15)
                try:
                    scraper.close()
                except Exception:
                    pass
                scraper = CourtScraper(headless=headless)
                result_type, detail = crawl_one(entry, scraper)

            # 결과 처리
            if result_type == RESULT_SUCCESS:
                consecutive_fails = 0
                stats.record(entry, RESULT_SUCCESS, detail)
                pc = detail.get("progress_count", 0)
                st = detail.get("status") or "pending"
                corr = detail.get("corrections", [])
                corr_str = f", 보정감지: {corr}" if corr else ""
                log.info(f"[{tag}]   → 진행내역 {pc}건, 상태: {st}{corr_str}")

            elif result_type == RESULT_NOT_FOUND:
                consecutive_fails = 0
                stats.record(entry, RESULT_NOT_FOUND, detail)
                log.warning(f"[{tag}]   → ⚠ 사건 없음: {detail.get('error')}")

            else:
                consecutive_fails += 1
                # 이번 라운드에선 포기, 다음 라운드에서 재시도
                retry_later.append(entry)
                log.warning(f"[{tag}]   → 최종 실패 (다음 라운드 재시도): {detail.get('error')}")

                if consecutive_fails >= 3:
                    log.warning(f"[{tag}] 연속 {consecutive_fails}회 실패 — 브라우저 재시작")
                    try:
                        scraper.close()
                    except Exception:
                        pass
                    time.sleep(10)
                    scraper = CourtScraper(headless=headless)
                    consecutive_fails = 0

            time.sleep(1)

    finally:
        try:
            scraper.close()
        except Exception:
            pass

    log.info(f"[{tag}] 완료 (성공 {len(entries) - len(retry_later) - sum(1 for e in entries if e in retry_later)}건)")
    return retry_later


def run_batch(
    entries: list[dict],
    csv_path: str,
    workers: int = 3,
    headless: bool = True,
    max_rounds: int = 5,
    dry_run: bool = True,
    firm_id: str | None = None,
):
    """배치 크롤링. 실패 건은 max_rounds까지 자동 재시도."""
    start_time = datetime.now()
    mode_str = "DRY-RUN" if dry_run else "DB 저장"
    stats = BatchStats(total=len(entries))

    remaining = list(entries)

    for round_num in range(1, max_rounds + 1):
        if not remaining:
            break

        log.info("")
        log.info("=" * 60)
        log.info(f"[{mode_str}] 라운드 {round_num}/{max_rounds}: {len(remaining)}건, 워커 {workers}대")
        log.info("=" * 60)

        if dry_run:
            round_failed = _run_dry_round(remaining, stats, workers, headless)
        else:
            round_failed = _run_db_round(remaining, stats, workers, headless, firm_id)

        remaining = round_failed
        if not remaining:
            log.info(f"라운드 {round_num} — 실패 건 없음! 완료.")
            break
        log.info(f"라운드 {round_num} 완료 — 실패 {len(round_failed)}건 → 다음 라운드에서 재시도")

        if round_num < max_rounds:
            wait = min(30 * round_num, 120)
            log.info(f"{wait}초 대기 후 다음 라운드 시작...")
            time.sleep(wait)

    # 최종 결과 요약
    elapsed = (datetime.now() - start_time).total_seconds()
    _print_summary(stats, elapsed, csv_path, remaining)


def _run_dry_round(
    entries: list[dict],
    stats: BatchStats,
    workers: int,
    headless: bool,
) -> list[dict]:
    """dry-run 1라운드. 실패 건 목록 반환."""
    all_retry = []
    chunks = [[] for _ in range(workers)]
    for i, entry in enumerate(entries):
        chunks[i % workers].append(entry)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {}
        for wid, chunk in enumerate(chunks, 1):
            if chunk:
                f = executor.submit(worker_fn, wid, chunk, stats, headless)
                futures[f] = wid

        for f in as_completed(futures):
            try:
                retry = f.result()
                all_retry.extend(retry)
            except Exception as e:
                log.error(f"워커 예외: {e}")

    return all_retry


def _run_db_round(
    entries: list[dict],
    stats: BatchStats,
    workers: int,
    headless: bool,
    firm_id: str | None,
) -> list[dict]:
    """DB 저장 모드 1라운드. crawl_by_number 사용."""
    from .main import crawl_by_number

    failed = []
    for i, entry in enumerate(entries, 1):
        log.info(
            f"({i}/{len(entries)}) [{entry['id']}] {entry['name']} "
            f"— {entry['court_name']} {entry['case_number']}"
        )

        try:
            result = crawl_by_number(
                court_name=entry["court_name"],
                case_number=entry["case_number"],
                applicant_name=entry["name"],
                headless=headless,
                firm_id=firm_id,
            )

            if result.get("success"):
                stats.record(entry, RESULT_SUCCESS, {
                    "progress_count": result.get("new_progress", 0),
                    "status": result.get("status"),
                })
            else:
                err = result.get("error", "")
                if "사건 없음" in err or "not found" in err.lower():
                    stats.record(entry, RESULT_NOT_FOUND, {"error": err})
                else:
                    stats.record(entry, RESULT_FAILED, {"error": err})
                    failed.append(entry)
        except CaseNotFoundError as e:
            stats.record(entry, RESULT_NOT_FOUND, {"error": str(e)})
        except Exception as e:
            stats.record(entry, RESULT_FAILED, {"error": str(e)})
            failed.append(entry)

        time.sleep(1)

    return failed


def _print_summary(stats: BatchStats, elapsed: float, csv_path: str, still_failed: list[dict]):
    """최종 결과 요약 출력 및 파일 저장."""
    log.info("")
    log.info("=" * 60)
    log.info("최종 결과")
    log.info("=" * 60)
    log.info(f"  전체 대상: {stats.total}건")
    log.info(f"  ✓ 성공:    {stats.success}건")
    log.info(f"  ✗ 실패:    {stats.failed}건 (재시도 후에도 실패)")
    log.info(f"  ⚠ 사건없음: {stats.not_found}건")
    log.info(f"  소요시간:  {int(elapsed // 60)}분 {int(elapsed % 60)}초")
    log.info("=" * 60)

    if stats.not_found_list:
        log.info("")
        log.info(f"⚠ 사건 없음 ({stats.not_found}건) — 사건번호 확인 필요:")
        for item in stats.not_found_list:
            log.info(f"  [{item['id']}] {item['name']} ({item['court']}) {item['case_number']} → {item.get('error', '')}")

    if still_failed:
        log.info("")
        log.info(f"✗ 최종 실패 ({len(still_failed)}건) — 수동 확인 필요:")
        for item in still_failed:
            log.info(f"  [{item['id']}] {item['name']} ({item['court_region']}) {item['case_number']}")

    # JSON 결과 저장
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = Path(csv_path).parent
    output_path = output_dir / f"crawl_result_{timestamp}.json"

    output = {
        "run_at": datetime.now().isoformat(),
        "total": stats.total,
        "success": stats.success,
        "failed": stats.failed,
        "not_found": stats.not_found,
        "elapsed_seconds": round(elapsed, 1),
        "success_list": stats.success_list,
        "failed_list": stats.failed_list,
        "not_found_list": stats.not_found_list,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    log.info(f"\n결과 JSON: {output_path}")

    # 사건 없음 목록 별도 저장 (있을 때만)
    if stats.not_found_list:
        nf_path = output_dir / f"not_found_{timestamp}.csv"
        with open(nf_path, "w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["ID", "이름", "법원", "사건번호", "사유"])
            for item in stats.not_found_list:
                writer.writerow([
                    item["id"], item["name"], item["court"],
                    item["case_number"], item.get("error", ""),
                ])
        log.info(f"사건없음 CSV: {nf_path}")

    # 최종 실패 목록 별도 저장 (있을 때만)
    if still_failed:
        fail_path = output_dir / f"still_failed_{timestamp}.csv"
        with open(fail_path, "w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["ID", "이름", "법원", "사건번호"])
            for item in still_failed:
                writer.writerow([
                    item["id"], item["name"],
                    item["court_region"], item["case_number"],
                ])
        log.info(f"최종실패 CSV: {fail_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CSV 배치 크롤링 (자동 재시도)")
    parser.add_argument("--csv", required=True, help="CSV 파일 경로")
    parser.add_argument("--dry-run", action="store_true", help="DB 저장 없이 크롤링만 확인")
    parser.add_argument("--firm", help="firm_id (DB 저장 모드)")
    parser.add_argument("--workers", type=int, default=3, help="워커 수 (기본값: 3)")
    parser.add_argument("--max-rounds", type=int, default=5, help="최대 재시도 라운드 (기본값: 5)")
    parser.add_argument("--no-headless", action="store_true", help="브라우저 화면 표시")
    parser.add_argument("--limit", type=int, help="처음 N건만 테스트")

    args = parser.parse_args()

    if not args.dry_run and not args.firm:
        parser.error("DB 저장 모드에서는 --org <firm_id>가 필요합니다. 테스트만 하려면 --dry-run을 사용하세요.")

    csv_path = args.csv

    # CSV 파싱
    entries, skipped = parse_csv(csv_path)

    if skipped:
        log.info(f"스킵 ({len(skipped)}건 — 사건번호 없음):")
        for s in skipped:
            log.info(f"  [{s['id']}] {s['name']} ({s['court_region']}) → {s['reason']}")

    log.info(f"\n크롤링 대상: {len(entries)}건")

    if args.limit:
        entries = entries[:args.limit]
        log.info(f"--limit {args.limit} 적용 → {len(entries)}건만 실행")

    if not entries:
        log.error("크롤링 대상이 없습니다")
        sys.exit(1)

    headless = not args.no_headless
    run_batch(
        entries,
        csv_path=csv_path,
        workers=args.workers,
        headless=headless,
        max_rounds=args.max_rounds,
        dry_run=args.dry_run,
        firm_id=args.firm,
    )