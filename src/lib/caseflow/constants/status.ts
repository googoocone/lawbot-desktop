import type {
  CaseStatus,
  CorrectionStatus,
  DocumentCategory,
  NotificationType,
} from '@/lib/caseflow/types';

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  pending: '접수전',
  filed: '접수',
  commenced: '개시',
  approved: '인가',
  discharged: '면책',
  dismissed: '기각',
  cancelled: '취소/반환',
  withdrawn: '폐지/취하',
};

export const CASE_STATUS_COLORS: Record<CaseStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  filed: 'bg-blue-100 text-blue-700',
  commenced: 'bg-indigo-100 text-indigo-700',
  approved: 'bg-green-100 text-green-700',
  discharged: 'bg-emerald-100 text-emerald-700',
  dismissed: 'bg-red-100 text-red-700',
  cancelled: 'bg-stone-100 text-stone-700',
  withdrawn: 'bg-orange-100 text-orange-700',
};

export const CORRECTION_STATUS_LABELS: Record<CorrectionStatus, string> = {
  pending: '대기중',
  approaching: '기한임박',
  overdue: '기한도과',
  submitted: '제출완료',
  dismissed: '기각',
};

export const NOTIFICATION_TYPE_ICONS: Record<NotificationType, string> = {
  progress_update: '📋',
  status_change: '🔄',
  correction_new: '📩',
  deadline_approaching: '⏰',
  deadline_overdue: '🚨',
  system: '⚙️',
};

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  correction: '보정(보정필요)',
  order: '명령',
  decision: '결정',
  notice: '통지',
  other: '기타',
};

export const CASE_TYPES = [
  { value: '회', label: '회생' },
  { value: '파', label: '파산' },
  { value: '항', label: '항고' },
  { value: '일회', label: '일반회생' },
  { value: '일', label: '일반' },
] as const;
