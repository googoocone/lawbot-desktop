import type { CaseCorrection } from '@/lib/caseflow/types';

export interface CorrectionDisplay {
  label: string;
  colorClass: string;
  sortPriority: number;
}

export function getCorrectionDisplay(
  corrections: Pick<CaseCorrection, 'status' | 'deadline_date' | 'overdue_days'>[]
): CorrectionDisplay {
  const active = corrections.filter(
    (c) => c.status !== 'submitted' && c.status !== 'dismissed'
  );

  if (active.length === 0) {
    const hasSubmitted = corrections.some((c) => c.status === 'submitted');
    if (hasSubmitted) {
      return { label: '✅ 완료', colorClass: 'text-green-600', sortPriority: 4 };
    }
    return { label: '— 없음', colorClass: 'text-gray-400', sortPriority: 5 };
  }

  const overdue = active.filter((c) => c.status === 'overdue');
  if (overdue.length > 0) {
    const maxOverdue = Math.max(...overdue.map((c) => c.overdue_days));
    return {
      label: `🔴 +${maxOverdue}`,
      colorClass: 'text-red-600 font-bold',
      sortPriority: 0,
    };
  }

  const approaching = active.filter((c) => c.status === 'approaching');
  if (approaching.length > 0) {
    const minDays = getMinDaysLeft(approaching);
    if (minDays !== null && minDays <= 3) {
      return {
        label: `🔴 D-${minDays}`,
        colorClass: 'text-red-600',
        sortPriority: 1,
      };
    }
    return {
      label: `🟡 D-${minDays ?? '?'}`,
      colorClass: 'text-yellow-600',
      sortPriority: 2,
    };
  }

  const pending = active.filter((c) => c.status === 'pending' && c.deadline_date);
  if (pending.length > 0) {
    const minDays = getMinDaysLeft(pending);
    if (minDays !== null && minDays <= 7) {
      return {
        label: `🟡 D-${minDays}`,
        colorClass: 'text-yellow-600',
        sortPriority: 3,
      };
    }
    return {
      label: `⏳ D-${minDays ?? '?'}`,
      colorClass: 'text-gray-600',
      sortPriority: 3,
    };
  }

  return { label: '— 없음', colorClass: 'text-gray-400', sortPriority: 5 };
}

function getMinDaysLeft(
  corrections: Pick<CaseCorrection, 'deadline_date'>[]
): number | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let min = Infinity;
  for (const c of corrections) {
    if (c.deadline_date) {
      const dl = new Date(c.deadline_date);
      dl.setHours(0, 0, 0, 0);
      const diff = Math.ceil(
        (dl.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diff < min) min = diff;
    }
  }
  return min === Infinity ? null : min;
}
