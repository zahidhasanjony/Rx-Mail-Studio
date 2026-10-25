import { useMemo, useState, type ReactNode } from 'react';
import type { BrandProfile, Hierarchy, Structure } from './types';
import type { AnalyticsFact, AnalysisFilters as Filters, Market } from './analytics-model';
import { brandCounts, comparableMonths, csvText, divisionShares, doctorKey, emptyAnalysisFilters, ffPerformance, fieldCode, filterFacts, inMarket, opportunities, prescribers, share, specialtyProductivity, sumRx, summaryRows } from './analytics-model';
import { AnalysisFilters } from './AnalysisFilters';
import { useNavigationState } from './navigation';
import { normalize } from './engine';
import { isBeximcoCompany } from './catalogue';
import { dashboardBrands, dashboardGroups } from './dashboard-model';
import { preparationLabel, preparationMarket } from './preparations';
import { reportingPeriod } from './reporting';
import './analytics.css';

export const fmt = (n: number) => n.toLocaleString('en-GB');
const dec = (n: number | null) => n === null ? 'N/A' : n.toFixed(2);
const pct = (n: number | null) => n === null ? 'N/A' : n.toFixed(1) + '%';
const brandList = (rows: ReturnType<typeof brandCounts>) => rows.map(r=>`${r.brand} (${fmt(r.count)})`).join(', ');
function downloadTable(name: string, headers: string[], rows: unknown[][]) {
  const url = URL.createObjectURL(new Blob([csvText(headers,rows)], {type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href=url; a.download=name+'.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Table({ headers, children }: { headers: string[]; children: ReactNode }) { return <div className="analysis-table-wrap"><table className="analysis-table"><thead><tr>{headers.map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Empty({ children = 'No records match these filters.' }: {children?:ReactNode}) { return <p className="analysis-empty">{children}</p>; }
function getSaved<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
export type AnalysisRoute = { page: 'dashboard'|'prescribers'|'doctor'|'specialty'|'ff'|'targets'; market?: Market; doctor?: string };
interface Props {
  facts: AnalyticsFact[]; ready: boolean; loading: boolean; error?: string; progress: number;
  filters: Filters; onFilters: (v: Filters)=>void; route: AnalysisRoute; onRoute:(v:AnalysisRoute)=>void;
  profiles:BrandProfile[]; hierarchies:Hierarchy[]; storageKey:string; periodLabel:string; from:string; to:string;
  periodControls:ReactNode; dashboard:ReactNode; onRetry:()=>void; dates:string[];
  onPresetPeriod:(from:string,to:string)=>void;
}
export default function NativeAnalytics(p: Props) {
  const {facts,filters,onFilters,route,onRoute}=p;
  const selected=useMemo(()=>filterFacts(facts,filters),[facts,filters]);
  const comparisonDates=useMemo(()=>[...new Set(filterFacts(facts,filters,false).flatMap(f=>Object.keys(f.dailyCounts||{[f.date]:f.count})))],[facts,filters]);
  const markets=useMemo(()=>{
    const result=new Map<string,Market>();
    for(const profile of p.profiles) for(const form of profile.forms) { const m={brand:profile.brand,generic:profile.generic,marketKey:preparationMarket(form)};result.set(JSON.stringify(m),m); }
    return [...result.values()].sort((a,b)=>a.brand.localeCompare(b.brand));
  },[p.profiles]);
  const [chosen,setChosen]=useNavigationState<Market|null>('analysis-market',null,false);
  const market=route.market || chosen || markets[0] || {generic:'',brand:'',marketKey:''};
  const [presetName,setPresetName]=useState(''),[notice,setNotice]=useState('');
  const [presets,setPresets]=useState<{name:string;filters:Filters;from:string;to:string}[]>(()=>getSaved(p.storageKey+':presets',[]));
  const savePreset=()=>{if(!presetName.trim())return;const next=[...presets.filter(v=>v.name!==presetName.trim()),{name:presetName.trim(),filters,from:p.from,to:p.to}];try{localStorage.setItem(p.storageKey+':presets',JSON.stringify(next));setPresets(next);setPresetName('');setNotice('Filter preset saved on this device.');}catch{setNotice('This browser could not save the preset.');}};
  const openDoctor=(code:string)=>onRoute({page:'doctor',doctor:code,market});
  const tabs=[['dashboard','Rx dashboard'],['specialty','Specialty & productivity'],['ff','Field force'],['targets','Doctor targeting']] as const;
  return <div className="analysis-native">
    <nav className="analysis-tabs" aria-label="Analysis pages">{tabs.map(([page,label])=><button key={page} aria-pressed={route.page===page} onClick={()=>onRoute({page})}>{label}</button>)}</nav>
    {p.periodControls}
    <AnalysisFilters facts={facts} value={filters} onChange={onFilters} disabled={!p.ready} doctor={route.page==='doctor'}/>
    <details><summary>Saved filters</summary><div className="analysis-toolbar"><label className="analysis-control">Preset name<input value={presetName} onChange={e=>setPresetName(e.target.value)} maxLength={60}/></label><button className="analysis-action" onClick={savePreset} disabled={!presetName.trim()}>Save filters</button><label className="analysis-control">Load preset<select value="" onChange={e=>{const s=presets[Number(e.target.value)];if(s){onFilters(s.filters);p.onPresetPeriod(s.from,s.to);}}}><option value="">Choose saved filters</option>{presets.map((s,i)=><option key={s.name} value={i}>{s.name}</option>)}</select></label></div><p className="analysis-muted">Saved on this device for this account.</p></details>
    {notice&&<p role="status">{notice}</p>}
    {p.loading&&<p role="status" className="analysis-notice">Loading doctor and FF analysis… {fmt(p.progress)} records read. The summary remains available.</p>}
    {p.error&&<div className="analysis-notice" role="alert">Detailed analysis unavailable: {p.error} <button className="analysis-action" onClick={p.onRetry}>Retry analysis</button></div>}
    {p.ready&&facts.some(f=>f.strength==='Not specified')&&<p className="analysis-muted">Some strengths are not specified. Earlier imports need re-importing to recover strength values.</p>}
    {route.page!=='dashboard'&&<div className="analysis-toolbar"><button className="analysis-action" onClick={()=>history.back()}>Back</button><strong>{p.periodLabel}</strong></div>}
    {(route.page==='specialty'||route.page==='prescribers')&&<label className="analysis-control">Beximco brand / generic market<select aria-label="Analysis market" value={JSON.stringify(market)} onChange={e=>{const next=JSON.parse(e.target.value) as Market;setChosen(next);onRoute({...route,market:next});}}>{!markets.some(m=>JSON.stringify(m)===JSON.stringify(market))&&<option value={JSON.stringify(market)}>{market.brand} · {market.generic}</option>}{markets.map(m=><option key={JSON.stringify(m)} value={JSON.stringify(m)}>{m.brand} · {m.generic} · {m.marketKey.replace('FORM:','')}</option>)}</select></label>}
    {p.ready&&<PeriodComparison facts={route.page==='doctor'?selected.filter(f=>doctorKey(f)===route.doctor):route.page==='specialty'||route.page==='prescribers'?selected.filter(f=>inMarket(f,market)):selected} dates={comparisonDates} brand={route.page==='specialty'||route.page==='prescribers'?market.brand:''}/>}
    {route.page==='dashboard'?p.dashboard:!p.ready?<Empty>{p.loading?'Preparing complete results…':'Analysis is unavailable. Retry to load the selected period.'}</Empty>:<>
      {route.page==='prescribers'&&<PrescriberPage key={JSON.stringify(market)} facts={selected} market={market} onDoctor={openDoctor}/>}
      {route.page==='doctor'&&<DoctorProfile facts={facts} selected={selected} code={route.doctor||''} profiles={p.profiles} storageKey={p.storageKey} from={p.from} to={p.to} hierarchies={p.hierarchies}/>}
      {route.page==='specialty'&&<SpecialtyPage facts={facts} filters={filters} market={market} onSpecialty={specialty=>{onFilters({...filters,specialty});onRoute({page:'prescribers',market});}}/>}
      {route.page==='ff'&&<FieldForcePage facts={selected} filters={filters} onFilters={onFilters} onDoctor={openDoctor} profiles={p.profiles} onMarket={market=>onRoute({page:'prescribers',market})} hierarchies={p.hierarchies} from={p.from} to={p.to}/>}
      {route.page==='targets'&&<TargetPage facts={selected} profiles={p.profiles} onDoctor={openDoctor}/>}
    </>}
  </div>;
}
export function DivisionKpis({ facts, ready }: {facts:AnalyticsFact[];ready:boolean}) {
  return <section className="analysis-kpis" aria-label="ACD and CCD Rx shares">{divisionShares(facts).map(r=><article className="analysis-kpi" key={r.structure}><span>{r.structure} Rx share</span><strong>{ready?pct(r.share):'…'}</strong><small>{ready?`${fmt(r.own)} Beximco / ${fmt(r.total)} market Rx`:'Loading structure totals'}</small></article>)}</section>;
}
function PrescriberPage({facts,market,onDoctor}:{facts:AnalyticsFact[];market:Market;onDoctor:(code:string)=>void}) {
  const [brand,setBrand]=useNavigationState('prescriber-brand:'+JSON.stringify(market),'',false),[search,setSearch]=useNavigationState('prescriber-search:'+JSON.stringify(market),'',false),[limit,setLimit]=useState(50);
  const brands=brandCounts(facts.filter(f=>inMarket(f,market)));
  const rows=prescribers(facts,market,brand).filter(d=>normalize(d.name+' '+d.code).includes(normalize(search)));
  const headers=['Rank','Doctor / SFE ID','Specialty','FF assignment (RSE / ASE / MPE)','Generic Rx','Preferred brands',market.brand+' Rx / share'];
  return <section className="analysis-panel"><h2>Top 50 generic prescribers</h2><p>{market.generic} · Beximco brand: {market.brand}</p>
    <div className="analysis-toolbar"><label className="analysis-control">Brand filter<select aria-label="Prescriber brand" value={brand} onChange={e=>{setBrand(e.target.value);setLimit(50);}}><option value="">All brands</option>{brands.map(b=><option key={JSON.stringify([normalize(b.brand),normalize(b.company)])} value={JSON.stringify([normalize(b.brand),normalize(b.company)])}>{b.brand} ({b.company})</option>)}</select></label><label className="analysis-control">Search doctor or SFE ID<input value={search} onChange={e=>{setSearch(e.target.value);setLimit(50);}}/></label><button className="analysis-action" onClick={()=>downloadTable('prescribers',headers,rows.map((d,i)=>[i+1,d.name+' / '+d.code,d.specialty,d.assignments.join('; '),d.total,brandList(d.brands),`${d.own} / ${pct(d.share)}`]))}>Export table</button></div>
    <Table headers={headers}>{rows.slice(0,limit).map((d,i)=><tr key={d.code}><td>{i+1}</td><td><button onClick={()=>onDoctor(d.code)}>{d.name}</button><small>{d.code}</small></td><td>{d.specialty}</td><td>{d.assignments.map(a=><small key={a}>{a}</small>)}</td><td>{fmt(d.total)}{brand&&<small>Selected brand: {fmt(d.ranked)}</small>}</td><td>{brandList(d.brands)}</td><td>{market.brand} ({fmt(d.own)}, {pct(d.share)})</td></tr>)}</Table>
    {!rows.length&&<Empty/>}{rows.length>limit&&<button className="analysis-action" onClick={()=>setLimit(n=>n+50)}>Show next 50 ({fmt(rows.length)} total)</button>}<p className="analysis-muted">Ranking follows the brand filter. Beximco share always uses the selected generic market. Counts are recorded product occurrences.</p>
  </section>;
}
function SpecialtyPage({facts,filters,market,onSpecialty}:{facts:AnalyticsFact[];filters:Filters;market:Market;onSpecialty:(v:string)=>void}) {
  const [mode,setMode]=useNavigationState('productivity-mode','rx',false),[standing,setStanding]=useState(false);
  const rows=useMemo(()=>specialtyProductivity(facts,filters,market),[facts,filters,market]);
  const latestSpecialty=useMemo(()=>{const map=new Map<string,AnalyticsFact>();for(const f of filterFacts(facts,filters,false,false)){const prev=map.get(doctorKey(f));if(!prev||f.date>prev.date)map.set(doctorKey(f),f);}return map;},[facts,filters]);
  const headers=['Specialty','Doctors','% of specialty','% of generic Rx','% of '+market.brand+' Rx','Generic index','Brand index','Generic Rx/doctor','Brand Rx/doctor'];
  const max=Math.max(mode==='index'?1:0,...rows.flatMap(r=>mode==='index'?[r.genericIndex||0,r.brandIndex||0]:[r.genericProductivity||0,r.brandProductivity||0]))*1.1 || 1;
  return <>
    <section className="analysis-panel"><h2>Specialty productivity</h2><p>{market.generic} vs {market.brand}</p><div className="analysis-toolbar"><button className="analysis-action" onClick={()=>downloadTable('specialty-productivity',headers,rows.map(r=>[r.specialty,r.doctors,pct(r.doctorPct),pct(r.genericPct),pct(r.brandPct),dec(r.genericIndex),dec(r.brandIndex),dec(r.genericProductivity),dec(r.brandProductivity)]))}>Export table</button><button className="analysis-action" onClick={()=>setStanding(!standing)}>{standing?'Hide':'Show'} Rx standing</button></div>
    <Table headers={headers}>{rows.map(r=><tr key={r.specialty}><td><button onClick={()=>onSpecialty(r.specialty)}>{r.specialty}</button></td><td>{fmt(r.doctors)}</td><td>{pct(r.doctorPct)}</td><td>{pct(r.genericPct)}</td><td>{pct(r.brandPct)}</td><td>{dec(r.genericIndex)}</td><td>{dec(r.brandIndex)}</td><td>{dec(r.genericProductivity)}</td><td>{dec(r.brandProductivity)}</td></tr>)}</Table>
    {!rows.length&&<Empty/>}<p className="analysis-muted">Rx/doctor includes every observed doctor of the specialty, including non-prescribers. Each doctor uses their latest recorded specialty. Product filters do not shrink that population. Specialty selection keeps the overall benchmark.</p>
    {standing&&<Table headers={['Specialty','Generic Rx','Generic prescribers','Brand Rx','Brand prescribers','Brand share','Brand rank','Leading brands']}>{rows.map(r=>{const marketRows=filterFacts(facts,filters,true,false).filter(f=>inMarket(f,market)&&latestSpecialty.get(doctorKey(f))?.specialty===r.specialty);const brands=brandCounts(marketRows);const rank=brands.findIndex(b=>normalize(b.brand)===normalize(market.brand)&&isBeximcoCompany(b.company));return <tr key={r.specialty}><td>{r.specialty}</td><td>{fmt(r.generic)}</td><td>{r.genericPrescribers}</td><td>{fmt(r.brand)}</td><td>{r.brandPrescribers}</td><td>{pct(r.brandShare)}</td><td>{rank<0?'N/A':rank+1}</td><td>{brandList(brands.slice(0,3))}</td></tr>;})}</Table>}
    </section>
    <section className="analysis-panel"><h2>Generic vs Beximco brand productivity</h2><label className="analysis-control">Chart measure<select value={mode} onChange={e=>setMode(e.target.value)}><option value="rx">Rx per doctor</option><option value="index">Productivity index</option></select></label><div className="analysis-legend"><span><i className="analysis-blue"/>{market.generic}</span><span><i className="analysis-green"/>{market.brand}</span></div>
    {mode==='index'&&<p className="analysis-muted">Dashed line: 1.0, the overall average.</p>}
    <div className="analysis-bars" role="img" aria-label="Specialty-wise generic versus Beximco brand productivity; exact figures in the preceding table">{rows.map(r=><div className="analysis-bar-row" key={r.specialty}><span>{r.specialty}</span><div>{(mode==='index'?[r.genericIndex,r.brandIndex]:[r.genericProductivity,r.brandProductivity]).map((v,i)=><div className="analysis-bar-track" key={i}><i className={i?'analysis-green':'analysis-blue'} style={{width:`${(v||0)/max*100}%`}}/><span>{dec(v)}</span>{mode==='index'&&<b style={{left:`${100/max}%`}}/>}</div>)}</div></div>)}</div>
    </section>
  </>;
}
function DoctorProfile({facts,selected,code,profiles,storageKey,from,to,hierarchies}:{facts:AnalyticsFact[];selected:AnalyticsFact[];code:string;profiles:BrandProfile[];storageKey:string;from:string;to:string;hierarchies:Hierarchy[]}) {
  const all=facts.filter(f=>doctorKey(f)===code), rows=selected.filter(f=>doctorKey(f)===code), latest=all.reduce<AnalyticsFact|undefined>((a,b)=>!a||b.date>a.date?b:a,undefined);
  const noteKey=storageKey+':doctor:'+code;
  const [notes,setNotes]=useState<Record<string,{status:string;note:string}>>(()=>getSaved(storageKey+':notes',{})),[message,setMessage]=useState('');
  const note=notes[noteKey]||{status:'',note:''};
  const edit=(field:'status'|'note',v:string)=>{const next={...notes,[noteKey]:{...note,[field]:v}};setNotes(next);try{localStorage.setItem(storageKey+':notes',JSON.stringify(next));setMessage('Saved on this device.');}catch{setMessage('Could not save on this device.');}};
  if(!latest)return <Empty>Doctor not found in this period.</Empty>;
  const genericNames=[...new Set(rows.map(f=>f.generic))].sort((a,b)=>sumRx(rows.filter(f=>f.generic===b))-sumRx(rows.filter(f=>f.generic===a)));
  const own=sumRx(rows.filter(f=>isBeximcoCompany(f.company))),total=sumRx(rows),suggestions=opportunities(rows,profiles,1);
  const months=[...new Set(rows.map(f=>f.date.slice(0,7)))].sort();
  return <><section className="analysis-panel"><h2>{latest.doctorName}</h2><p>{code} · {latest.specialty}</p><p className="analysis-muted">Latest observed prescription: {latest.date}</p>
    {(['ACD','CCD']as const).map(s=>{const assignments=[...new Set(all.filter(f=>fieldCode(f,s,'region')).map(f=>`${fieldCode(f,s,'region')} / ${fieldCode(f,s,'ase')||'—'} / ${fieldCode(f,s,'mpe')||'—'}`))];return <p key={s}>{s} RSE / ASE / MPE: {assignments.join('; ')||'Not recorded'} {hierarchies.filter(h=>h.effectiveFrom<=to+'-31').sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.rows.filter(r=>r.structure===s&&r.region===fieldCode(latest,s,'region')).map(r=><small key={r.region}> · {r.rseName}</small>)}</p>;})}
    <div className="analysis-kpis"><article className="analysis-kpi"><span>Product Rx</span><strong>{fmt(total)}</strong></article><article className="analysis-kpi"><span>Beximco Rx</span><strong>{fmt(own)}</strong></article><article className="analysis-kpi"><span>Beximco share</span><strong>{pct(share(own,total))}</strong></article></div><p className="analysis-muted">Recorded product occurrences, not unique prescription slips. FF assignments shown are those observed in the period.</p>
    </section><div className="analysis-profile-grid"><section className="analysis-panel analysis-wide"><h2>Preferred generics and brands</h2><Table headers={['Generic','Rx','Preferred brands','Beximco brands (Rx, share)']}>{genericNames.map(g=>{const fs=rows.filter(f=>f.generic===g),brands=brandCounts(fs),total=sumRx(fs);const ownBrands=[...new Set([...brands.filter(b=>isBeximcoCompany(b.company)).map(b=>b.brand),...profiles.filter(p=>normalize(p.generic)===normalize(g)&&p.forms.some(form=>fs.some(f=>preparationMarket(f.form)===preparationMarket(form)))).map(p=>p.brand)])];return <tr key={g}><td>{g}</td><td>{fmt(total)}</td><td>{brandList(brands)}</td><td>{ownBrands.map(b=>{const n=brands.filter(v=>normalize(v.brand)===normalize(b)&&isBeximcoCompany(v.company)).reduce((s,v)=>s+v.count,0);return <small key={b}>{b} ({fmt(n)}, {pct(share(n,total))})</small>;})}</td></tr>;})}</Table></section>
    <section className="analysis-panel"><h2>Monthly trend</h2><p className="analysis-muted">{reportingPeriod(from,to)} · Compare complete equivalent periods.</p><Table headers={['Month','Rx','Beximco Rx','Share']}>{months.map(m=>{const fs=rows.filter(f=>f.date.startsWith(m)),total=sumRx(fs),own=sumRx(fs.filter(f=>isBeximcoCompany(f.company)));return <tr key={m}><td>{m}</td><td>{fmt(total)}</td><td>{fmt(own)}</td><td>{pct(share(own,total))}</td></tr>;})}</Table><details><summary>Generic and brand trends</summary><Table headers={['Month','Generic','Brand','Rx']}>{months.flatMap(m=>genericNames.flatMap(g=>brandCounts(rows.filter(f=>f.date.startsWith(m)&&f.generic===g)).map(b=><tr key={JSON.stringify([m,g,b.brand,b.company])}><td>{m}</td><td>{g}</td><td>{b.brand} <small>({b.company})</small></td><td>{fmt(b.count)}</td></tr>)))}</Table></details></section>
    <section className="analysis-panel"><h2>Follow-up</h2><label className="analysis-control">Status<select value={note.status} onChange={e=>edit('status',e.target.value)}><option value="">Not set</option><option>Target</option><option>Follow-up</option><option>Reviewed</option></select></label><label className="analysis-control">Note<textarea value={note.note} maxLength={2000} onChange={e=>edit('note',e.target.value)}/></label><p className="analysis-muted" role="status">{message||'Notes are private to this account on this device.'}</p><h3>Brands for field review</h3>{suggestions.length?suggestions.map(s=><p key={JSON.stringify([s.generic,s.brand,s.marketKey])}><strong>{s.brand}</strong> · {s.generic} ({s.marketKey})<small className="analysis-muted"> · {s.reason}. Verify the required strength in the brand library.</small></p>):<Empty>No matching opportunity under the current filters.</Empty>}</section></div></>;
}
function FieldForcePage({facts,filters,onFilters,onDoctor,profiles,onMarket,hierarchies,from,to}:{facts:AnalyticsFact[];filters:Filters;onFilters:(f:Filters)=>void;onDoctor:(code:string)=>void;profiles:BrandProfile[];onMarket:(m:Market)=>void;hierarchies:Hierarchy[];from:string;to:string}) {
  const [view,setView]=useNavigationState('ff-view','overall',false),[level,setLevel]=useNavigationState<'region'|'ase'|'mpe'>('ff-level','region',false),[tg,setTg]=useNavigationState('ff-tg','',false),[brand,setBrand]=useNavigationState('ff-brand','',false);
  const structure=filters.structure||'ACD', tgs=[...new Set(facts.map(f=>f.tg))].sort();
  const ownBrands=[...new Set(facts.filter(f=>isBeximcoCompany(f.company)).map(f=>f.brand))].sort();
  const structureFacts=facts.filter(f=>!!fieldCode(f,structure,'region'));
  const brandMarkets=new Set(structureFacts.filter(f=>f.brand===brand&&isBeximcoCompany(f.company)).map(f=>JSON.stringify([normalize(f.generic),preparationMarket(f.form)])));
  const brandFacts=brand?structureFacts.filter(f=>brandMarkets.has(JSON.stringify([normalize(f.generic),preparationMarket(f.form)]))):structureFacts;
  const selection=view==='tg-ff'&&tg?structureFacts.filter(f=>f.tg===tg):view==='brand-ff'?brandFacts:structureFacts;
  const performance=ffPerformance(selection,structure,level,view==='brand-ff'?brand:'');
  const effective=hierarchies.filter(h=>h.effectiveFrom<=to+'-31').sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const ownLabel=view==='brand-ff'&&brand?brand:'Beximco';
  const headers=['FF code','Market Rx',ownLabel+' Rx','Rx share','Observed doctors',ownLabel+' prescribers',ownLabel+' Rx/doctor'];
  const groups=dashboardGroups(summaryRows(structureFacts));
  const open=(code:string)=>{history.pushState({...history.state},'');onFilters({...filters,structure,[level]:code,...(level==='region'?{ase:'',mpe:''}:level==='ase'?{mpe:''}:{})});if(level==='region')setLevel('ase');else if(level==='ase')setLevel('mpe');else setView('doctors');};
  return <section className="analysis-panel"><h2>Field Force Dashboard</h2><div className="analysis-toolbar"><label className="analysis-control">View<select value={view} onChange={e=>setView(e.target.value)}>{[['overall','FF overall Rx'],['ff-tg','FF → TG'],['tg-ff','TG → FF'],['ff-brand','FF → Brand'],['brand-ff','Brand → FF'],['doctors','Doctor targeting']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label className="analysis-control">Structure<select value={structure} onChange={e=>onFilters({...filters,structure:e.target.value as Structure,region:'',ase:'',mpe:''})}><option>ACD</option><option>CCD</option></select></label><label className="analysis-control">FF level<select value={level} onChange={e=>setLevel(e.target.value as typeof level)}><option value="region">RSE</option><option value="ase">ASE</option><option value="mpe">MPE</option></select></label>
    {view==='tg-ff'&&<label className="analysis-control">TG<select value={tg} onChange={e=>setTg(e.target.value)}><option value="">All TGs</option>{tgs.map(t=><option key={t}>{t}</option>)}</select></label>}{view==='brand-ff'&&<label className="analysis-control">Beximco brand<select value={brand} onChange={e=>setBrand(e.target.value)}><option value="">All brands</option>{ownBrands.map(b=><option key={b}>{b}</option>)}</select></label>}</div>
    <p className="analysis-muted">Use RSE / ASE / MPE filters above to select a territory. Each Rx is counted once in the selected structure. {reportingPeriod(from,to)}</p>
    {view==='doctors'?<TargetPage facts={structureFacts} profiles={profiles} onDoctor={onDoctor}/>:view==='ff-tg'?<Table headers={['TG','Market Rx','Beximco Rx','Share']}>{groups.map(g=><tr key={g.name}><td><button onClick={()=>{setTg(g.name);setView('tg-ff');}}>{g.name}</button></td><td>{fmt(g.market)}</td><td>{fmt(g.own)}</td><td>{pct(g.share)}</td></tr>)}</Table>:view==='ff-brand'?<Table headers={['TG','Brand','Generic','Rx','Share of generic market']}>{groups.flatMap(g=>dashboardBrands(summaryRows(structureFacts),g.name).map(b=><tr key={JSON.stringify([g.name,b.name,b.generic,b.marketKey])}><td>{g.name}</td><td><button onClick={()=>onMarket({brand:b.name,generic:b.generic,marketKey:b.marketKey})}>{b.name}</button><small>({b.companies.join(', ')})</small></td><td>{b.generic}</td><td>{fmt(b.own)}</td><td>{pct(b.share)}</td></tr>))}</Table>:<><button className="analysis-action" onClick={()=>downloadTable('field-force',headers,performance.map(r=>[r.code,r.total,r.own,pct(r.share),r.doctors,r.ownDoctors,dec(r.rxPerDoctor)]))}>Export table</button><Table headers={headers}>{performance.map(r=><tr key={r.code}><td><button onClick={()=>open(r.code)}>{r.code}</button>{level==='region'&&<small>{effective?.rows.find(h=>h.structure===structure&&h.region===r.code)?.rseName||''}</small>}</td><td>{fmt(r.total)}</td><td>{fmt(r.own)}</td><td>{pct(r.share)}</td><td>{r.doctors}</td><td>{r.ownDoctors}</td><td>{dec(r.rxPerDoctor)}</td></tr>)}</Table>{!performance.length&&<Empty/>}</>}
  </section>;
}
function TargetPage({facts,profiles,onDoctor}:{facts:AnalyticsFact[];profiles:BrandProfile[];onDoctor:(v:string)=>void}) {
  const [minimum,setMinimum]=useNavigationState('target-minimum',5,false),[generic,setGeneric]=useNavigationState('target-generic','',false),[limit,setLimit]=useState(50);
  const rows=useMemo(()=>opportunities(facts,profiles,minimum,generic),[facts,profiles,minimum,generic]);
  const headers=['Doctor / SFE ID','Specialty','FF assignment','Generic','Generic Rx','Preferred brands','Beximco brand (Rx, share)','Reason'];
  return <section className="analysis-panel"><h2>Doctors to target</h2><div className="analysis-toolbar"><label className="analysis-control">Minimum generic Rx<input type="number" min="1" step="1" value={minimum} onChange={e=>setMinimum(Math.max(1,Math.floor(Number(e.target.value)||1)))}/></label><label className="analysis-control">Preferred generic<select value={generic} onChange={e=>{setGeneric(e.target.value);setLimit(50);}}><option value="">All generics</option>{[...new Set(profiles.map(p=>p.generic))].sort().map(g=><option key={g}>{g}</option>)}</select></label><button className="analysis-action" onClick={()=>downloadTable('doctor-targeting',headers,rows.map(r=>[r.name+' / '+r.code,r.specialty,r.assignments.join('; '),r.generic,r.total,brandList(r.brands),`${r.brand} (${r.own}, ${pct(r.share)})`,r.reason]))}>Export table</button></div>
    <Table headers={headers}>{rows.slice(0,limit).map(r=><tr key={JSON.stringify([r.code,r.generic,r.brand,r.marketKey])}><td><button onClick={()=>onDoctor(r.code)}>{r.name}</button><small>{r.code}</small></td><td>{r.specialty}</td><td>{r.assignments.map(a=><small key={a}>{a}</small>)}</td><td>{r.generic}<small>{r.marketKey}</small></td><td>{fmt(r.total)}</td><td>{brandList(r.brands)}</td><td>{r.brand} ({fmt(r.own)}, {pct(r.share)})</td><td>{r.reason}<small>Confirm strength before targeting.</small></td></tr>)}</Table>{!rows.length&&<Empty/>}{rows.length>limit&&<button className="analysis-action" onClick={()=>setLimit(n=>n+50)}>Show next 50</button>}<p className="analysis-muted">Priority: no recorded brand Rx, low brand share, then declining observed share; sorted by generic Rx within each group. These are field-review suggestions based on observed prescriptions.</p>
  </section>;
}

function PeriodComparison({facts,dates,brand}:{facts:AnalyticsFact[];dates:string[];brand:string}) {
  const months=[...new Set(dates.map(d=>d.slice(0,7)))].sort();
  const [first,setFirst]=useState(''),[second,setSecond]=useState('');
  const a=months.includes(first)?first:months.at(-2)||'',b=months.includes(second)?second:months.at(-1)||'';
  const result=comparableMonths(facts,dates,a,b,brand);
  return <details className="analysis-panel"><summary>Compare equivalent periods</summary>
    {months.length<2?<p className="analysis-muted">Select a range containing at least two months.</p>:<><div className="analysis-toolbar"><label className="analysis-control">Previous month<select value={a} onChange={e=>setFirst(e.target.value)}>{months.map(m=><option key={m}>{m}</option>)}</select></label><label className="analysis-control">Current month<select value={b} onChange={e=>setSecond(e.target.value)}>{months.map(m=><option key={m}>{m}</option>)}</select></label></div>
    {a>=b?<p>Select a current month after the previous month.</p>:!result.days.length?<p>No matching reporting days are available.</p>:<><p className="analysis-muted">Uses the same {result.days.length} day numbers in both months: {result.days.join(', ')}. Missing days are excluded from both sides.</p><Table headers={['Period','Market Rx',(brand||'Beximco')+' Rx','Share']}><tr><td>{a}</td><td>{fmt(result.previous.total)}</td><td>{fmt(result.previous.own)}</td><td>{pct(result.previous.share)}</td></tr><tr><td>{b}</td><td>{fmt(result.current.total)}</td><td>{fmt(result.current.own)}</td><td>{pct(result.current.share)}</td></tr></Table><p>Share change: {result.change===null?'N/A':result.change.toFixed(1)+' percentage points'}</p></>}
    </>}
  </details>;
}
