# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for caseflow crawler sidecar.

block_cipher = None

a = Analysis(
    ['entry.py'],
    pathex=['.'],
    binaries=[],
    datas=[
        # Tesseract 바이너리 + tessdata를 번들에 포함
        # (런타임에 sys._MEIPASS/tesseract/ 에 풀림)
        ('vendored/tesseract', 'tesseract'),
    ],
    hiddenimports=[
        # Selenium
        'selenium.webdriver.chrome.service',
        'selenium.webdriver.chrome.options',
        'selenium.webdriver.common.by',
        'selenium.webdriver.support.ui',
        'selenium.webdriver.support.expected_conditions',
        # webdriver-manager
        'webdriver_manager.chrome',
        'webdriver_manager.core',
        # Supabase 스택 — 동적 import 많음
        'supabase',
        'supabase._sync',
        'supabase._async',
        'postgrest',
        'gotrue',
        'realtime',
        'storage3',
        'supafunc',
        # Tesseract OCR
        'pytesseract',
        # crawler 모듈들 (명시적으로 묶음 — PyInstaller가 다 잡도록)
        'crawler.config',
        'crawler.court_scraper',
        'crawler.correction_detector',
        'crawler.diff_detector',
        'crawler.status_detector',
        'crawler.captcha_solver',
        'crawler.notification_builder',
        'crawler.db',
        'crawler.batch_csv',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Sidecar에선 HTTP 서버 불필요 — 빌드 크기 감축
        'fastapi',
        'uvicorn',
        'starlette',
        # 기타 GUI / 테스트 도구
        'tkinter',
        'pytest',
        'IPython',
        'matplotlib',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='crawler',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,         # stdout 캡쳐용 (Tauri sidecar는 콘솔 출력을 stdout으로 받음)
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
