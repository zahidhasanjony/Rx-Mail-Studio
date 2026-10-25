import type { AnalyticsFact, AnalysisFilters as Filters } from './analytics-model';
import { fieldCode, strengthKey } from './analytics-model';
import { normalizePreparation, preparationLabel } from './preparations';
const options = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
export function AnalysisFilters({ facts, value, onChange, disabled = false, doctor = false }: { facts: AnalyticsFact[]; value: Filters; onChange: (v: Filters) => void; disabled?: boolean; doctor?: boolean }) {
  const change = (key: keyof Filters, next: string) => onChange({ ...value, [key]:next, ...(key === 'form' ? {strength:''} : {}), ...(key === 'structure' ? {region:'',ase:'',mpe:''} : {}), ...(key === 'region' ? {ase:'',mpe:''} : {}), ...(key === 'ase' ? {mpe:''} : {}) });
  const selected = facts.filter(f => (!value.form || normalizePreparation(f.form) === value.form));
  const choose = (key: keyof Filters, label: string, items: string[], format = (v: string) => v) => <label key={key}>{label}<select aria-label={label} value={value[key]} disabled={disabled} onChange={e=>change(key,e.target.value)}><option value="">All</option>{options([...items,...(value[key] ? [value[key]] : [])]).map(v=><option key={v} value={v}>{format(v)}</option>)}</select></label>;
  return <div className="analysis-filters">
    {choose('form','Dosage form',facts.map(f=>normalizePreparation(f.form)),v=>preparationLabel([v]))}
    {choose('strength','Strength',selected.map(f=>strengthKey(f.strength)))}
    {!doctor && choose('specialty','Specialty',facts.map(f=>f.specialty))}
    {choose('structure','FF structure',['ACD','CCD'])}
    {value.structure && <>{choose('region','RSE region',facts.map(f=>fieldCode(f,value.structure as 'ACD'|'CCD','region')))}
      {choose('ase','ASE',facts.filter(f=>!value.region || fieldCode(f,value.structure as 'ACD'|'CCD','region')===value.region).map(f=>fieldCode(f,value.structure as 'ACD'|'CCD','ase')))}
      {choose('mpe','MPE',facts.filter(f=>(!value.region || fieldCode(f,value.structure as 'ACD'|'CCD','region')===value.region) && (!value.ase || fieldCode(f,value.structure as 'ACD'|'CCD','ase')===value.ase)).map(f=>fieldCode(f,value.structure as 'ACD'|'CCD','mpe')))}</>}
  </div>;
}
