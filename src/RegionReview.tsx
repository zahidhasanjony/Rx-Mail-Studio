import { ArrowDown, ArrowRight, Eye } from "lucide-react";
import { belowNational } from "./engine";
import type { NationalRxShare, RegionReport } from "./types";

export default function RegionReview({ report, brand, recipient, national, blocked, onPreview }: {
  report?: RegionReport;
  brand: string;
  recipient?: string;
  national: NationalRxShare;
  blocked?: string;
  onPreview: () => void;
}) {
  if (!report) return null;
  const below = report.doctors.filter(d => belowNational(d, national)).length;
  return <aside className="card region-review" aria-label="Regional email review">
    <header className="card-header"><div><h2>{report.region}</h2><p>{report.structure} · {recipient || "RSE not assigned"}</p></div><Eye size={19} /></header>
    <div className="review-content">
      <div className="review-benchmark">
        <div><span>Region {brand} share</span><strong>{report.total ? (report.own / report.total * 100).toFixed(1) + "%" : "N/A"}</strong></div>
        <div><span>National share</span><strong>{national.available && national.share !== null ? national.share.toFixed(1) + "%" : "N/A"}</strong></div>
      </div>
      <p className={national.available && below ? "below-note" : "review-note"}>{national.available ? `${below} of ${report.doctors.length} prescriber entries below national` : "National benchmark unavailable"}</p>
      <div className="review-shares" aria-label="Regional brand shares">{report.shares.map((b, i) => <div className={`share-tile share-${i}`} key={b.brand}><span>{b.brand}</span><strong>{report.total ? b.share.toFixed(1) + "%" : "—"}</strong></div>)}</div>
      <table className="review-table"><thead><tr><th>Doctor code</th><th>{brand} share</th></tr></thead><tbody>{report.doctors.slice(0, 5).map(d => {
        const flag = belowNational(d, national);
        return <tr key={JSON.stringify([d.mpe, d.code])} className={flag ? "below-national" : ""}><td>{d.code}</td><td>{flag && <ArrowDown size={13} aria-label="Below national" />}{d.genericCount ? (d.ownCount / d.genericCount * 100).toFixed(1) + "%" : "N/A"}</td></tr>;
      })}</tbody></table>
      {!report.doctors.length && <p className="review-note">No Rx records in this region.</p>}
      {report.doctors.length > 5 && <p className="review-note">Showing 5 of {report.doctors.length} entries</p>}
      {blocked && <p className="review-note">{blocked}</p>}
      <button className="button" disabled={!!blocked} onClick={onPreview}>Review email <ArrowRight size={16} /></button>
    </div>
  </aside>;
}
