import { supabase } from './cloud-client';
import type { Dataset, RxFact } from './types';
import { reportingMonths } from './reporting';
import { normalize } from './engine';
import { normalizePreparation } from './preparations';
import { strengthKey } from './analytics-model';

// One bounded period cache, independent of login and the fast summary request.
let cached: { key: string; datasets: Dataset[] } | undefined;
export function clearAnalyticsCache() { cached = undefined; }
export async function loadAnalytics(datasets: Dataset[], from: string, to: string, signal: AbortSignal, progress: (count: number) => void, owner: string) {
  if (!supabase) throw new Error('Cloud connection missing');
  const sources = datasets.filter(d => d.active && d.from.slice(0,7) <= to && d.to.slice(0,7) >= from);
  const key = JSON.stringify([owner, from, to, sources.map(d => [d.id,d.hash,d.importedAt])]);
  if (cached?.key === key) return cached.datasets;
  const groups = new Map<string, Map<string, RxFact>>(), ids = sources.map(d => d.id);
  if (!ids.length) return [];
  let cursor = 0, count = 0;
  while (true) {
    const result = await supabase.from('rxm_fact_chunks').select('id,dataset_id,payload')
      .in('dataset_id', ids).in('month', reportingMonths(from,to)).gt('id',cursor).order('id').limit(12).abortSignal(signal);
    if (result.error) throw new Error(result.error.message);
    for (const chunk of result.data || []) {
      const group = groups.get(chunk.dataset_id) || new Map<string,RxFact>();
      for (const f of chunk.payload as RxFact[]) {
        // Monthly doctor/product aggregates omit source-row arrays and unused fields.
        // Never combine ACD and CCD rows or sum either structure into the other.
        const key = JSON.stringify([f.date.slice(0,7),normalize(f.doctorCode),normalize(f.generic),normalize(f.brand),normalize(f.company),normalizePreparation(f.form),strengthKey(f.strength),normalize(f.specialty),f.acdRegion,f.acdAse,f.acdMpe,f.ccdRegion,f.ccdAse,f.ccdMpe]);
        const previous = group.get(key);
        if (previous) { previous.count += f.count; previous.dailyCounts![f.date] = (previous.dailyCounts![f.date] || 0) + f.count; if (f.date > previous.date) { previous.date = f.date; previous.doctorName = f.doctorName; } }
        else group.set(key, { date:f.date,generic:f.generic,brand:f.brand,company:f.company,form:f.form,strength:f.strength,doctorCode:f.doctorCode,doctorName:f.doctorName,specialty:f.specialty,
          acdRegion:f.acdRegion,acdAse:f.acdAse,acdMpe:f.acdMpe,ccdRegion:f.ccdRegion,ccdAse:f.ccdAse,ccdMpe:f.ccdMpe,count:f.count,dailyCounts:{[f.date]:f.count},sourceRow:0,sheet:'' });
        count++;
      }
      groups.set(chunk.dataset_id,group); cursor = chunk.id;
    }
    progress(count);
    if ((result.data?.length || 0) < 12) break;
    await new Promise<void>(resolve => setTimeout(resolve,0));
    if (signal.aborted) throw new DOMException('Cancelled','AbortError');
  }
  const hydrated = sources.map(d => ({ ...d, facts:[...(groups.get(d.id)?.values() || [])] }));
  cached = { key, datasets:hydrated };
  return hydrated;
}
