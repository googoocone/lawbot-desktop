"""크롤러 HTTP 서버 (Railway 배포용)

엔드포인트:
  POST /trigger       — 전체 크롤링 시작
  POST /trigger/case  — 단일 사건 크롤링
  GET  /status        — 현재 크롤링 상태
  GET  /health        — 헬스체크
"""

import logging
import threading
import time
from datetime import datetime

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel

from . import config, db
from .main import crawl_organization, crawl_single_case

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

app = FastAPI(title="CaseFlow Crawler", docs_url=None, redoc_url=None)

# ── 크롤링 상태 추적 ──

_crawl_lock = threading.Lock()
_crawl_state = {
    "running": False,
    "started_at": None,
    "firm_id": None,
}


def verify_secret(authorization: str | None):
    """CRON_SECRET 검증"""
    if not config.CRON_SECRET:
        return  # 시크릿 미설정 시 통과 (개발용)
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization 헤더 필요")
    token = authorization.replace("Bearer ", "")
    if token != config.CRON_SECRET:
        raise HTTPException(status_code=403, detail="인증 실패")


# ── 엔드포인트 ──

@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.get("/status")
def status():
    return {
        **_crawl_state,
        "timestamp": datetime.utcnow().isoformat(),
    }


class TriggerRequest(BaseModel):
    firm_id: str | None = None
    max_workers: int | None = None


@app.post("/trigger")
def trigger_crawl(
    body: TriggerRequest = TriggerRequest(),
    authorization: str | None = Header(None),
):
    verify_secret(authorization)

    with _crawl_lock:
        if _crawl_state["running"]:
            raise HTTPException(
                status_code=409,
                detail=f"이미 크롤링 진행 중 (시작: {_crawl_state['started_at']})"
            )

    firm_id = body.firm_id or db.fetch_default_firm_id()
    if not firm_id:
        raise HTTPException(status_code=400, detail="firm_id를 지정해주세요")

    max_workers = body.max_workers or config.WORKER_COUNT

    # 백그라운드 스레드로 실행
    def run():
        with _crawl_lock:
            _crawl_state["running"] = True
            _crawl_state["started_at"] = datetime.utcnow().isoformat()
            _crawl_state["firm_id"] = firm_id

        try:
            crawl_organization(firm_id, max_workers=max_workers, headless=True)
        except Exception as e:
            log.error(f"크롤링 예외: {e}")
        finally:
            with _crawl_lock:
                _crawl_state["running"] = False

    thread = threading.Thread(target=run, daemon=True)
    thread.start()

    return {
        "message": "크롤링 시작됨",
        "firm_id": firm_id,
        "max_workers": max_workers,
    }


class CaseTriggerRequest(BaseModel):
    case_id: str


@app.post("/trigger/case")
def trigger_single_case(
    body: CaseTriggerRequest,
    authorization: str | None = Header(None),
):
    verify_secret(authorization)

    result = crawl_single_case(body.case_id, headless=True)
    return result
