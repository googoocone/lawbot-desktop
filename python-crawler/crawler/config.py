"""크롤러 설정 및 상수"""

import os
from pathlib import Path
from dotenv import load_dotenv

# .env 로드 (상위 Next.js 프로젝트의 .env.local 우선)
_project_root = Path(__file__).resolve().parent.parent
_env_local = _project_root / ".env.local"
_env_file = Path(__file__).resolve().parent / ".env"

if _env_local.exists():
    load_dotenv(_env_local)
elif _env_file.exists():
    load_dotenv(_env_file)

# ── Supabase ──
# 데스크탑 sidecar 모드: anon key + 사용자 access_token (RLS 통과)
# 서버 모드(레거시): service_role key 단독 — SUPABASE_KEY로 받음
SUPABASE_URL = (
    os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    or os.getenv("SUPABASE_URL", "")
)
SUPABASE_ANON_KEY = (
    os.getenv("SUPABASE_ANON_KEY")
    or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
)
SUPABASE_ACCESS_TOKEN = os.getenv("SUPABASE_ACCESS_TOKEN", "")
# 레거시 서버 모드 호환 — anon이 없을 때만 fallback
SUPABASE_KEY = (
    SUPABASE_ANON_KEY
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

# ── Gemini ──
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_GEMINI_API_KEY", "")

# ── Cron ──
CRON_SECRET = os.getenv("CRON_SECRET", "")
APP_URL = os.getenv("APP_URL", "http://localhost:3000")

# ── 크롤러 설정 ──
TARGET_URL = "https://ssgo.scourt.go.kr/ssgo/index.on"
WORKER_COUNT = int(os.getenv("CRAWLER_WORKER_COUNT", "6"))
CAPTCHA_MAX_RETRIES = 3
HEADLESS = os.getenv("CRAWLER_HEADLESS", "true").lower() == "true"

# ── 법원 매핑 ──
COURT_MAPPING = {
    "서울": "서울회생법원",
    "수원": "수원회생법원",
    "부산": "부산회생법원",
    "인천": "인천지방법원",
    "대전": "대전회생법원",
    "의정부": "의정부지방법원",
    "대구": "대구회생법원",
    "광주": "광주회생법원",
    "춘천": "춘천지방법원",
    "청주": "청주지방법원",
    "제주": "제주지방법원",
    "전주": "전주지방법원",
    "강릉": "강릉지방법원",
    "창원": "창원지방법원",
    "울산": "울산지방법원",
}

# ── 송달문서 분류 ──
DOCUMENT_CLASSIFICATION = {
    # 보정/예납
    "보정권고": {"category": "correction", "default_days": 14},
    "보정명령등본": {"category": "correction", "default_days": 14},
    "주소보정명령등본": {"category": "correction", "default_days": 14},
    "보정명령(인지대,송달료)등본": {"category": "correction", "default_days": 7},
    "예납명령정본": {"category": "correction", "default_days": 14},
    "예납명령등본": {"category": "correction", "default_days": 14},
    # 결정 (개인회생)
    "개시결정/개시결정통지서": {"category": "decision", "default_days": None},
    "면책결정": {"category": "decision", "default_days": None},
    # 결정 (파산)
    "파산선고결정통지서/결정등본": {"category": "decision", "default_days": None},
}

# ── 송달 감지 패턴 ──
DELIVERY_PATTERNS = [
    r"(.+?)에게\s+(.+?)\s+송달",
]

# ── 사건 상태 키워드 ──
STATUS_KEYWORDS = {
    "filed": ["신청서접수"],
    "commenced": ["개인회생절차개시결정", "개시결정"],
    "approved": ["변제계획인가결정", "인가결정"],
    "declared": ["파산선고결정", "파산선고결정 공고"],
    "discharged": ["면책결정"],
    "dismissed": ["파산폐지", "이시파산폐지결정", "파산폐지 공고"],
    "withdrawn": ["취하"],
}
