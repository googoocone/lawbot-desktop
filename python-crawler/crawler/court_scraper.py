"""법원 사건 조회 Selenium 스크래퍼

기존 CourtWebScraper를 리팩토링하여 단일 사건 조회 후
list[dict]를 반환하는 구조로 변경.
"""

import time
import tempfile
import logging
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select
from selenium.common.exceptions import TimeoutException

from . import config
from .captcha_solver import solve_captcha

log = logging.getLogger(__name__)

# ── Element IDs ──
ID_PREFIX = "mf_ssgoTopMainTab_contents_content1_body_"
ID_COURT_SELECT = f"{ID_PREFIX}sbx_cortCd"
ID_CASE_INPUT_MODE = f"{ID_PREFIX}cbx_chkSanoInputMode_input_0"
ID_CASE_NUMBER = f"{ID_PREFIX}ibx_fullCsNo"
ID_PARTY_NAME = f"{ID_PREFIX}ibx_btprNm"
ID_CAPTCHA_IMG = f"{ID_PREFIX}img_captcha"
ID_CAPTCHA_INPUT = f"{ID_PREFIX}ibx_answer"
ID_SEARCH_BTN = f"{ID_PREFIX}btn_srchCs"
ID_DETAIL_PANEL = f"{ID_PREFIX}wfSsgoDetail"

DETAIL_PREFIX = f"{ID_DETAIL_PANEL}_ssgoCsDetailTab_"
ID_PROGRESS_TAB = f"{DETAIL_PREFIX}tab_ssgoTab2"
ID_PROGRESS_TBODY = (
    f"{DETAIL_PREFIX}contents_ssgoTab2_body_grd_csProgLst_body_tbody"
)
ID_DELIVERY_CHECKBOX = (
    f"{DETAIL_PREFIX}contents_ssgoTab2_body_cbx_dlvrView_input_0"
)
# 사건명 (개인회생, 개인파산 등) - data-title="사건명"인 td 안의 .txt span
CSS_CASE_TYPE = f"#{ID_DETAIL_PANEL} td[data-title='사건명'] span.txt"
# 재판부 / 회생위원 (span.txt는 display:none이므로 첫 번째 보이는 span 사용)
CSS_JUDGE = f"#{ID_DETAIL_PANEL} td[data-title='재판부'] span:not(.txt)"
CSS_COMMISSIONER = f"#{ID_DETAIL_PANEL} td[data-title='회생위원'] span:not(.txt)"


class CaseNotFoundError(Exception):
    """법원 시스템에서 사건을 찾을 수 없을 때 발생"""
    pass


class CourtScraper:
    """법원 사건 조회 스크래퍼"""

    def __init__(self, headless: bool | None = None):
        if headless is None:
            headless = config.HEADLESS

        chrome_options = Options()
        if headless:
            chrome_options.add_argument("--headless")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option("useAutomationExtension", False)

        self.driver = webdriver.Chrome(options=chrome_options)
        self.driver.implicitly_wait(10)
        log.info("Chrome 드라이버 초기화 완료")

    def scrape_case(
        self,
        court_name: str,
        case_number: str,
        applicant_name: str,
    ) -> dict | None:
        """단일 사건의 진행내역을 크롤링한다.

        Returns:
            성공 시 {"progress": [...], "case_type_name": "개인회생"}
            실패 시 None
        """
        try:
            # 1. 사이트 접속
            self.driver.get(config.TARGET_URL)
            time.sleep(2)

            # 2. 법원 선택
            if not self._select_court(court_name):
                return None

            # 3. 사건번호 입력모드
            if not self._enable_case_input_mode():
                return None

            # 4. 사건번호 + 당사자명 입력
            if not self._input_case_info(case_number, applicant_name):
                return None

            # 5. 캡차 + 검색 (재시도)
            if not self._search_with_captcha_retry(court_name, case_number, applicant_name):
                return None

            # 6. 사건명 / 재판부 / 위원 추출
            case_type_name = self._extract_case_type()
            judge_raw, commissioner = self._extract_judge_info()

            # 7. 진행내역 탭 → 데이터 추출
            if not self._click_progress_tab():
                return None

            progress = self._extract_progress_data()
            return {
                "progress": progress,
                "case_type_name": case_type_name,
                "judge_raw": judge_raw,
                "commissioner": commissioner,
            }

        except Exception as e:
            log.error(f"크롤링 실패 [{case_number}]: {e}")
            return None

    def close(self):
        """브라우저 종료"""
        if self.driver:
            self.driver.quit()
            log.info("Chrome 드라이버 종료")

    # ── private methods ──

    def _wait(self, element_id: str, timeout: int = 10, clickable: bool = False):
        condition = (
            EC.element_to_be_clickable((By.ID, element_id))
            if clickable
            else EC.presence_of_element_located((By.ID, element_id))
        )
        return WebDriverWait(self.driver, timeout).until(condition)

    def _select_court(self, court_name: str) -> bool:
        try:
            el = self._wait(ID_COURT_SELECT)
            Select(el).select_by_visible_text(court_name)
            time.sleep(1)
            log.debug(f"법원 선택: {court_name}")
            return True
        except Exception as e:
            log.error(f"법원 선택 실패: {e}")
            return False

    def _enable_case_input_mode(self) -> bool:
        try:
            cb = self._wait(ID_CASE_INPUT_MODE, clickable=True)
            if not cb.is_selected():
                cb.click()
            time.sleep(2)
            return True
        except Exception as e:
            log.error(f"입력모드 전환 실패: {e}")
            return False

    def _input_case_info(self, case_number: str, party_name: str) -> bool:
        try:
            cn = self._wait(ID_CASE_NUMBER)
            cn.clear()
            cn.send_keys(case_number)

            pn = self._wait(ID_PARTY_NAME)
            pn.clear()
            pn.send_keys(party_name)
            time.sleep(1)
            return True
        except Exception as e:
            log.error(f"사건정보 입력 실패: {e}")
            return False

    def _search_with_captcha_retry(
        self,
        court_name: str | None = None,
        case_number: str | None = None,
        applicant_name: str | None = None,
    ) -> bool:
        for attempt in range(1, config.CAPTCHA_MAX_RETRIES + 1):
            log.info(f"캡차 시도 {attempt}/{config.CAPTCHA_MAX_RETRIES}")

            # 2차 이후: 페이지 상태 초기화 후 재입력
            if attempt > 1 and court_name and case_number and applicant_name:
                log.info("페이지 초기화 후 재시도")
                self.driver.get(config.TARGET_URL)
                time.sleep(2)
                if not self._select_court(court_name):
                    continue
                if not self._enable_case_input_mode():
                    continue
                if not self._input_case_info(case_number, applicant_name):
                    continue

            image_bytes = self._capture_captcha()
            if not image_bytes:
                continue

            captcha_text = solve_captcha(image_bytes)
            if not captcha_text:
                log.warning("캡차 인식 실패")
                continue

            log.info(f"캡차 인식: {captcha_text}")

            try:
                ci = self._wait(ID_CAPTCHA_INPUT)
                ci.clear()
                ci.send_keys(captcha_text)
            except Exception:
                continue

            try:
                btn = self._wait(ID_SEARCH_BTN, clickable=True)
                btn.click()
            except Exception:
                continue

            if self._wait_for_result():
                log.info(f"검색 성공 (시도 {attempt})")
                return True

        log.error("캡차 최대 재시도 초과")
        return False

    # CaseNotFoundError는 _wait_for_result → _search_with_captcha_retry → scrape_case로 전파됨

    def _capture_captcha(self) -> bytes | None:
        try:
            img_el = self._wait(ID_CAPTCHA_IMG)
            time.sleep(1)
            # 임시 파일로 스크린샷
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                tmp_path = f.name
            img_el.screenshot(tmp_path)
            data = Path(tmp_path).read_bytes()
            Path(tmp_path).unlink(missing_ok=True)
            return data
        except Exception as e:
            log.error(f"캡차 캡처 실패: {e}")
            return None

    # 사건 없음 판별 키워드 (법원 사이트 alert 메시지)
    NOT_FOUND_KEYWORDS = [
        "사건이 없습니다",
        "검색된 사건이 없습니다",
        "조회된 사건이 없습니다",
        "해당 사건",
        "사건을 찾을 수 없",
        "검색결과가 없",
        "일치하는 사건",
    ]

    def _wait_for_result(self, timeout: int = 20) -> bool:
        time.sleep(2)

        # alert 체크
        try:
            alert = self.driver.switch_to.alert
            alert_text = alert.text
            log.warning(f"Alert: {alert_text}")
            alert.accept()

            # 사건 없음 판별
            if any(kw in alert_text for kw in self.NOT_FOUND_KEYWORDS):
                raise CaseNotFoundError(f"사건 없음: {alert_text}")

            return False
        except CaseNotFoundError:
            raise  # 재raise
        except Exception:
            pass

        # 결과 패널 대기
        try:
            WebDriverWait(self.driver, timeout).until(
                EC.presence_of_element_located((By.ID, ID_DETAIL_PANEL))
            )
            return True
        except TimeoutException:
            log.warning("검색 결과 타임아웃")
            return False

    def _extract_case_type(self) -> str | None:
        """사건명 추출 (개인회생, 개인파산 등)"""
        try:
            el = self.driver.find_element(By.CSS_SELECTOR, CSS_CASE_TYPE)
            text = el.text.strip()
            log.info(f"사건명: {text}")
            return text if text else None
        except Exception:
            log.debug("사건명 추출 실패 (무시)")
            return None

    def _extract_judge_info(self) -> tuple[str | None, str | None]:
        """재판부 원문 + 회생위원 추출

        Returns:
            (재판부 원문, 회생위원명)
            예: ("제222단독(개인회생) (전화:인가전031-210-1438/인가후1216/면책1461)", "홍윤영")
        """
        judge_raw = None
        commissioner = None
        try:
            els = self.driver.find_elements(By.CSS_SELECTOR, CSS_JUDGE)
            for el in els:
                text = el.text.strip()
                if text:
                    judge_raw = text
                    log.info(f"재판부: {judge_raw}")
                    break
        except Exception:
            log.debug("재판부 추출 실패 (무시)")
        try:
            els = self.driver.find_elements(By.CSS_SELECTOR, CSS_COMMISSIONER)
            for el in els:
                text = el.text.strip()
                if text:
                    commissioner = text
                    log.info(f"회생위원: {commissioner}")
                    break
        except Exception:
            log.debug("회생위원 추출 실패 (무시)")
        return judge_raw, commissioner

    def _click_progress_tab(self) -> bool:
        try:
            tab = self._wait(ID_PROGRESS_TAB, clickable=True)
            tab.click()
            time.sleep(2)
            # 송달결과 확인 체크박스 클릭 (도달 날짜 표시)
            try:
                cb = self._wait(ID_DELIVERY_CHECKBOX, timeout=5, clickable=True)
                if not cb.is_selected():
                    cb.click()
                    time.sleep(2)
            except Exception:
                log.debug("송달결과 확인 체크박스 없음 (무시)")
            return True
        except Exception as e:
            log.error(f"진행내역 탭 클릭 실패: {e}")
            return False

    def _extract_progress_data(self) -> list[dict]:
        try:
            # tbody가 존재할 뿐 아니라 첫 번째 tr이 실제로 로딩될 때까지 대기
            WebDriverWait(self.driver, 15).until(
                lambda d: len(d.find_element(By.ID, ID_PROGRESS_TBODY)
                              .find_elements(By.TAG_NAME, "tr")) > 0
            )
            tbody = self.driver.find_element(By.ID, ID_PROGRESS_TBODY)
            rows = tbody.find_elements(By.TAG_NAME, "tr")
            log.info(f"진행내역 {len(rows)}건 발견")

            data = []
            for row in rows:
                cells = row.find_elements(By.TAG_NAME, "td")
                if len(cells) >= 4:
                    data.append({
                        "progress_date": cells[0].text.strip(),
                        "content": cells[1].text.strip(),
                        "result": cells[2].text.strip() or None,
                        "notification": cells[3].text.strip() or None,
                    })
            return data

        except Exception as e:
            log.error(f"데이터 추출 실패: {e}")
            return []
