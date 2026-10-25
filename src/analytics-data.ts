import { supabase } from './cloud-client';
import { createAnalyticsLoader } from './analytics-loader';

const loader = createAnalyticsLoader({
  async manifest(ids, months, cursor, signal) {
    if (!supabase) throw new Error('Cloud connection missing');
    const result = await supabase.from('rxm_fact_chunks').select('id,dataset_id,month')
      .in('dataset_id', ids).in('month', months).gt('id', cursor).order('id').limit(1000).abortSignal(signal);
    if (result.error) throw new Error(result.error.message);
    return result.data || [];
  },
  async chunks(ids, signal) {
    if (!supabase) throw new Error('Cloud connection missing');
    const result = await supabase.from('rxm_fact_chunks').select('id,dataset_id,month,payload')
      .in('id', ids).order('id').abortSignal(signal);
    if (result.error) throw new Error(result.error.message);
    return result.data || [];
  },
});
export const clearAnalyticsCache = loader.clear;
export const loadAnalytics = loader.load;
