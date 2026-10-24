import type { Batch } from './types';
export interface BatchSummary {
  id: string; createdAt: string; brand: string; generic: string; month: string;
  endMonth?: string; period?: string; periodLabel?: string;
  mailCount: number; openedCount: number; failedCount: number; preparedCount: number;
}
export function summarizeBatch(batch: Batch): BatchSummary {
  return { id: batch.id, createdAt: batch.createdAt, brand: batch.brand, generic: batch.generic,
    month: batch.month, endMonth: batch.endMonth, period: batch.period, periodLabel: batch.periodLabel,
    mailCount: batch.mails.length, openedCount: batch.mails.filter(m => m.status === 'Opened').length,
    failedCount: batch.mails.filter(m => m.status === 'Failed').length,
    preparedCount: batch.mails.filter(m => m.status === 'Prepared').length };
}
