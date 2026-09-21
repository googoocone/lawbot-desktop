const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 업무 날짜는 PC 시간대와 무관하게 KST(UTC+9) 기준이다.
// 날짜만 있는 값은 시각으로 변환하지 않고 그 날짜 그대로 유지한다.
export function kstDateStr(value: Date | string = new Date()): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = typeof value === 'string' ? new Date(value) : value;
  // 파싱 불가한 값(크롤링 원문 등)은 그대로 돌려줘 toISOString()이 throw하지 않게 한다.
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '';
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return kstDateStr(dateStr).slice(5).replace('-', '.');
}

export function formatFullDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return kstDateStr(dateStr).replace(/-/g, '.');
}

export function formatDateTime(dateStr: string): string {
  const ms = new Date(dateStr).getTime();
  if (Number.isNaN(ms)) return dateStr;
  const iso = new Date(ms + KST_OFFSET_MS).toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '.')} ${iso.slice(11, 16)}`;
}

export function relativeTime(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간전`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return '어제';
  if (diffDay < 30) return `${diffDay}일전`;
  return formatDate(dateStr);
}

export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = (Date.parse(kstDateStr(dateStr)) - Date.parse(todayStr())) / DAY_MS;
  return Number.isNaN(diff) ? null : diff;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(kstDateStr(dateStr));
  if (Number.isNaN(d.getTime())) return dateStr;
  // 날짜 연산용 UTC 사용: PC 시간대나 서머타임에 영향받지 않게 한다.
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

export function todayStr(): string {
  return kstDateStr();
}
