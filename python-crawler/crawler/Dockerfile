FROM python:3.12-slim

# Chrome 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg2 unzip fonts-nanum \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python 의존성
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 크롤러 코드
COPY . /app/crawler/

ENV PYTHONUNBUFFERED=1
ENV CRAWLER_HEADLESS=true

EXPOSE 8000

CMD ["uvicorn", "crawler.server:app", "--host", "0.0.0.0", "--port", "8000"]
