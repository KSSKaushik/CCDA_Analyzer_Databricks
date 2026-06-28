import "./ccda.css";
import { useState, useRef, useEffect, useCallback, Component } from "react";
import { ccdaApi } from "../api";
import JSZip from "jszip";

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{ padding:32, fontFamily:"monospace", color:"#d63b10", background:"#fff", border:"1px solid #d63b10", borderRadius:8, margin:16 }}>
        <strong>Render error (check browser console for full trace):</strong><br/>
        {String(this.state.error)}
      </div>
    );
    return this.props.children;
  }
}
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  RadialLinearScale, PointElement, LineElement, ArcElement,
  Title, Tooltip, Legend, Filler,
} from "chart.js";
import { Bar, Radar, Doughnut } from "react-chartjs-2";

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  RadialLinearScale, PointElement, LineElement, ArcElement,
  Title, Tooltip, Legend, Filler
);


// ─── palette ──────────────────────────────────────────────────────────────────
const C = { red:"#d63b10", blue:"#1a5fa8", green:"#1a6b44", amber:"#8c5600", purple:"#7c3cb8" };
const VS_COLORS = { numerator: C.green, denominator: C.blue, exclusion: C.red };

function scoreColor(s) { return s >= 80 ? C.green : s >= 60 ? C.amber : C.red; }
function scoreClass(s) { return s >= 80 ? "g" : s >= 60 ? "a" : "t"; }

const LOINC_NAMES = {
  "4548-4":"HbA1c","39156-5":"BMI","8480-6":"Systolic BP","8462-4":"Diastolic BP",
  "2089-1":"LDL-C","1920-8":"AST","1742-6":"ALT","33914-3":"eGFR","2951-2":"Sodium",
  "2823-3":"Potassium","2160-0":"Creatinine","718-7":"Hemoglobin","24606-6":"Mammography",
  "2335-8":"FOBT","77353-1":"FIT-DNA","55284-4":"BP Panel","44249-1":"PHQ-9",
  "44250-9":"PHQ-2","57905-2":"Colonoscopy report","14956-5":"Microalbumin",
};

const NAV_META = {
  input:     { title:"Data Ingestion",        sub:"Choose your data source to load CCDA XML files" },
  quality:   { title:"CCDA Quality Analysis", sub:"Per-file scoring across 4 clinical dimensions" },
  hedis:     { title:"HEDIS Dashboard",       sub:"Measure impact, numerator / denominator analysis" },
  loinc:     { title:"LOINC Analysis",        sub:"Lab result code coverage and completeness" },
  narrative: { title:"Narrative Intelligence",sub:"Free-text provider notes · unstructured findings · structured gap analysis" },
  fhir:      { title:"FHIR Conversion",       sub:"CCDA XML → FHIR R4 resources · read, store and export" },
  sql:       { title:"SQL Server Loader",     sub:"Load FHIR R4 resources into local SQL Server database" },
};

// ─── Gauge SVG ─────────────────────────────────────────────────────────────────
function Gauge({ score, size = 80 }) {
  const r = size * 0.36, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const col = scoreColor(score);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ display:"block", margin:"0 auto" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e0d9cf" strokeWidth={size * 0.075}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={col} strokeWidth={size * 0.075}
        strokeDasharray={`${circ.toFixed(1)}`} strokeDashoffset={offset.toFixed(1)}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>
      <text x={cx} y={cy - 1} textAnchor="middle" dominantBaseline="middle"
        fill={col} fontFamily="'Fira Code',monospace" fontSize={size * 0.22} fontWeight="600">{score}</text>
    </svg>
  );
}

// ─── ScoreBar ──────────────────────────────────────────────────────────────────
function ScoreBar({ score, cls }) {
  const col = cls === "g" ? C.green : cls === "a" ? C.amber : C.red;
  return (
    <div className="score-bar">
      <span className="score-num" style={{ color: col }}>{score}</span>
      <div className="score-track">
        <div className="score-fill" style={{ width: `${score}%`, background: col }}/>
      </div>
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────────────
function Modal({ open, title, children, onClose }) {
  return (
    <div className={`moverlay${open?" on":""}`} onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="mhead">
          <div className="mtit">{title}</div>
          <button className="mclose" onClick={onClose}>✕</button>
        </div>
        <div className="mbody">{children}</div>
      </div>
    </div>
  );
}

// ─── IssueCard ─────────────────────────────────────────────────────────────────
const SEV_LABEL = { critical:"● Critical", warning:"▲ Warning", info:"○ Info" };
const DIM_LABEL = { terminology:"Terminology", completeness:"Completeness", accuracy:"Accuracy", structure:"Structure" };

function EvidenceBlock({ ev }) {
  if (!ev) return null;
  if (ev.type === "table") {
    if (!ev.rows?.length) return <div style={{ padding:"8px 14px", fontSize:11, color:"var(--muted)" }}>No data rows to display.</div>;
    const statusCi = (ev.cols?.length || 1) - 1;
    return (
      <div className="ev-wrap">
        <table className="ev-tbl">
          <thead><tr>{(ev.cols||[]).map((c,i) => <th key={i}>{c}</th>)}</tr></thead>
          <tbody>
            {ev.rows.map((row, ri) => {
              const rowCls = ({bad:"rb",warn:"wb",ok:"gb","":""})[row.st||""] || "";
              return (
                <tr key={ri} className={rowCls}>
                  {(row.cells||[]).map((c, ci) => {
                    if (ci === 0) return <td key={ci}><span className="ev-code">{c}</span></td>;
                    if (ci === statusCi && row.st === "bad") return <td key={ci} className="ev-bad">{c}</td>;
                    if (ci === statusCi && row.st === "warn") return <td key={ci} className="ev-warn">{c}</td>;
                    if (ci === statusCi && row.st === "ok") return <td key={ci} className="ev-ok">{c}</td>;
                    return <td key={ci}>{c}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  if (ev.type === "kv") {
    return (
      <div className="ev-wrap">
        {(ev.items||[]).map((item, i) => (
          <div key={i} className="ev-kv-row">
            <span className="ev-kv-k">{item.k}</span>
            <span className={`ev-kv-v${item.st==="bad"?" ev-bad":item.st==="warn"?" ev-warn":item.st==="ok"?" ev-ok":""}`}>{item.v}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

function IssueCard({ issue }) {
  const [open, setOpen] = useState(false);
  const sev = issue.sev || "info";
  const hasEvidence = !!(issue.evidence || issue.remediation);
  return (
    <div className="icard">
      <div className="icard-header" onClick={() => setOpen(o => !o)}>
        <span className={`sev-chip ${sev}`}>{SEV_LABEL[sev]||sev}</span>
        {issue.dim && <span className={`dim-chip ${issue.dim}`}>{DIM_LABEL[issue.dim]||issue.dim}</span>}
        <span className="icard-title">{issue.title}</span>
        <span className="icard-toggle">{open ? "▾ Hide" : (hasEvidence ? "▸ Show data" : "▸ Details")}</span>
      </div>
      <div className={`icard-body ${open ? "open" : ""}`}>
        {issue.detail && (
          <div className="icard-sec">
            <div className="icard-sec-lbl">What was found</div>
            <div className="icard-text">{issue.detail}</div>
          </div>
        )}
        {issue.evidence && (
          <div className="icard-sec" style={{ padding:0, background:"var(--white)" }}>
            <div style={{ padding:"10px 14px 6px" }}><div className="icard-sec-lbl">Affected Data</div></div>
            <EvidenceBlock ev={issue.evidence}/>
          </div>
        )}
        {issue.remediation && (
          <div className="icard-sec">
            <div className="icard-fix"><strong>Fix:</strong> {issue.remediation}</div>
            {issue.impact && <div className="icard-impact" style={{ marginTop:6 }}><strong>Impact:</strong> {issue.impact}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FileItem ──────────────────────────────────────────────────────────────────
function FileItem({ name, size, onRemove }) {
  return (
    <div className="fli">
      <div className="fli-ico">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="var(--blue)">
          <path d="M9 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6L9 1zm0 1.5L12.5 6H9V2.5z"/>
        </svg>
      </div>
      <span className="fli-name">{name}</span>
      {size != null && <span className="fli-size">{size < 1024 ? `${size} B` : `${(size/1024).toFixed(1)} KB`}</span>}
      {onRemove && <button className="fli-del" onClick={onRemove}>×</button>}
    </div>
  );
}

// ─── EmptyState ────────────────────────────────────────────────────────────────
function EmptyState({ icon, title, sub }) {
  return (
    <div className="empty" style={{ padding:"80px 20px" }}>
      {icon && <svg width="52" height="52" viewBox="0 0 52 52" fill="none">{icon}</svg>}
      <div className="empty-t">{title}</div>
      <div className="empty-s">{sub}</div>
    </div>
  );
}

// ─── MetCard ───────────────────────────────────────────────────────────────────
function MetCard({ cls, label, val, sub }) {
  return (
    <div className={`met ${cls}`}>
      <div className="met-lbl">{label}</div>
      <div className="met-val">{val}</div>
      {sub && <div className="met-sub">{sub}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INPUT PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function InputPanel({ fileQueue, setFileQueue, onRun, navTo, loading, progressMsg, progressPct, analysisComplete, results, valueSets }) {
  const [ingest, setIngest] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [folderPicked, setFolderPicked] = useState(null); // { name, count } or { error }
  const fileRef = useRef();
  const dirRef = useRef();

  // ── Databricks state ────────────────────────────────────────────────
  const dbxHostRef    = useRef();
  const dbxTokenRef   = useRef();
  const dbxPathRef    = useRef();
  const dbxPatternRef = useRef();
  const [dbxStatus, setDbxStatus]         = useState("");
  const [dbxResult, setDbxResult]         = useState(null); // {msg, type:"ok"|"err"|"warn"}
  const [dbxBrowserOpen, setDbxBrowserOpen] = useState(false);
  const [dbxCurrentPath, setDbxCurrentPath] = useState("/");
  const dbxStackRef    = useRef([]);          // navigation stack [{path}]
  const dbxSelectedRef = useRef(new Set());   // selected DBFS paths
  const [dbxEntries,   setDbxEntries]     = useState([]);
  const [dbxFilter,    setDbxFilter]      = useState("");
  const [dbxBrowseLoading, setDbxBrowseLoading] = useState(false);
  const [dbxBrowseError,   setDbxBrowseError]   = useState(null);
  const [dbxSelCount,      setDbxSelCount]       = useState(0); // mirrors dbxSelectedRef.size for re-render
  const [dbxLoadSelBusy,   setDbxLoadSelBusy]    = useState(false);

  function dbxFormatSize(bytes) {
    if (bytes == null) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function dbxGetCredentials() {
    return {
      host:  (dbxHostRef.current?.value  || "").trim().replace(/\/+$/, ""),
      token: (dbxTokenRef.current?.value || "").trim(),
    };
  }

  async function dbxApiFetch(endpoint, body) {
    const { host, token } = dbxGetCredentials();
    return fetch(`${host}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(body),
    });
  }

  async function databricksLoad() {
    const { host, token } = dbxGetCredentials();
    const rawPath = (dbxPathRef.current?.value    || "").trim();
    const pattern = (dbxPatternRef.current?.value || "*.xml").trim();
    if (!host || !token || !rawPath) {
      setDbxStatus(""); setDbxResult({ msg: "Host, token and path are all required.", type: "err" }); return;
    }
    const apiPath = rawPath.replace(/^dbfs:/, "");
    setDbxStatus("Listing files…"); setDbxResult(null);
    try {
      const listResp = await fetch(`${host}/api/2.0/dbfs/list`, {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ path: apiPath }),
      });
      if (!listResp.ok) { const err = await listResp.json().catch(() => ({})); throw new Error(err.message || `HTTP ${listResp.status}`); }
      const listData = await listResp.json();
      const ext = pattern.replace(/^\*/, "");
      const files = (listData.files || []).filter(f => {
        if (f.is_dir) return false;
        return (f.path.split("/").pop() || "").toLowerCase().endsWith(ext.toLowerCase());
      });
      if (!files.length) { setDbxStatus(""); setDbxResult({ msg: "No matching XML files found at that path.", type: "warn" }); return; }
      setDbxStatus(`Found ${files.length} file${files.length !== 1 ? "s" : ""}. Downloading…`);
      let loaded = 0, failed = 0;
      await Promise.all(files.map(async f => {
        try {
          const fname = f.path.split("/").pop();
          let offset = 0; const chunks = [];
          while (true) {
            const r = await fetch(`${host}/api/2.0/dbfs/read`, {
              method: "POST",
              headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
              body: JSON.stringify({ path: f.path, offset, length: 1048576 }),
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const d = await r.json(); if (!d.data) break;
            chunks.push(atob(d.data)); offset += d.bytes_read;
            if (d.bytes_read < 1048576) break;
          }
          const xml = chunks.join("");
          const blob = new Blob([xml], { type: "text/xml" });
          const file = new File([blob], fname, { type: "text/xml" });
          setFileQueue(prev => prev.some(x => x.name === fname) ? prev : [...prev, { name: fname, size: file.size, file }]);
          loaded++;
        } catch(e) { console.warn("Databricks file error", f.path, e); failed++; }
      }));
      setDbxStatus("");
      setDbxResult(loaded > 0
        ? { msg: `✓ Loaded ${loaded} file${loaded !== 1 ? "s" : ""}${failed > 0 ? " (" + failed + " failed)" : ""} from Databricks.`, type: "ok" }
        : { msg: "Failed to download files. Check token permissions and path.", type: "err" });
    } catch(e) {
      setDbxStatus(""); setDbxResult({ msg: "Error: " + e.message + ". Ensure the Databricks host allows browser requests (CORS) or use a proxy.", type: "err" });
    }
  }

  async function dbxNavTo(path) {
    const stack = dbxStackRef.current;
    const cur = stack.length ? stack[stack.length - 1] : null;
    if (!cur || cur.path !== path) dbxStackRef.current = [...stack, { path }];
    setDbxCurrentPath(path);
    setDbxBrowseLoading(true); setDbxBrowseError(null); setDbxEntries([]);
    try {
      const resp = await dbxApiFetch("/api/2.0/dbfs/list", { path });
      if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || err.message || `HTTP ${resp.status}`); }
      const data = await resp.json();
      setDbxEntries((data.files || []).sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.path.localeCompare(b.path);
      }));
    } catch(e) { setDbxBrowseError(e.message); }
    finally { setDbxBrowseLoading(false); }
  }

  function dbxNavBack() {
    const stack = dbxStackRef.current;
    if (stack.length > 1) {
      stack.pop();
      const prev = stack[stack.length - 1];
      stack.pop(); // dbxNavTo will re-push it
      dbxStackRef.current = [...stack];
      dbxNavTo(prev.path);
    }
  }

  async function dbxBrowse() {
    const { host, token } = dbxGetCredentials();
    if (!host || !token) { alert("Please enter a Databricks Host and Personal Access Token before browsing."); return; }
    const startPath = (dbxPathRef.current?.value || "").trim().replace(/^dbfs:/, "") || "/";
    dbxStackRef.current = [];
    dbxSelectedRef.current = new Set();
    setDbxFilter(""); setDbxSelCount(0); setDbxBrowserOpen(true);
    await dbxNavTo(startPath);
  }

  function dbxToggleFile(path) {
    if (dbxSelectedRef.current.has(path)) dbxSelectedRef.current.delete(path);
    else dbxSelectedRef.current.add(path);
    setDbxSelCount(dbxSelectedRef.current.size);
  }

  function dbxSelectAllVisible() {
    const filter = dbxFilter.toLowerCase();
    dbxEntries.forEach(e => {
      const name = e.path.split("/").pop() || "";
      if (e.is_dir || !name.toLowerCase().endsWith(".xml")) return;
      if (filter && !name.toLowerCase().includes(filter)) return;
      dbxSelectedRef.current.add(e.path);
    });
    setDbxSelCount(dbxSelectedRef.current.size);
  }

  function dbxDeselectAll() { dbxSelectedRef.current = new Set(); setDbxSelCount(0); }

  async function dbxLoadSelected() {
    const paths = [...dbxSelectedRef.current];
    if (!paths.length) return;
    setDbxLoadSelBusy(true);
    let loaded = 0, failed = 0;
    await Promise.all(paths.map(async filePath => {
      try {
        const fname = filePath.split("/").pop();
        let offset = 0; const chunks = [];
        while (true) {
          const r = await dbxApiFetch("/api/2.0/dbfs/read", { path: filePath, offset, length: 1048576 });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const d = await r.json(); if (!d.data) break;
          chunks.push(atob(d.data)); offset += d.bytes_read;
          if (d.bytes_read < 1048576) break;
        }
        const xml = chunks.join("");
        const blob = new Blob([xml], { type: "text/xml" });
        const file = new File([blob], fname, { type: "text/xml" });
        setFileQueue(prev => prev.some(x => x.name === fname) ? prev : [...prev, { name: fname, size: file.size, file }]);
        loaded++;
      } catch(e) { console.warn("Failed to load", filePath, e); failed++; }
    }));
    setDbxBrowserOpen(false);
    setDbxLoadSelBusy(false);
    setDbxResult(loaded > 0
      ? { msg: `✓ Loaded ${loaded} file${loaded !== 1 ? "s" : ""}${failed > 0 ? " (" + failed + " failed)" : ""} from Databricks workspace.`, type: "ok" }
      : { msg: "Failed to download selected files. Check token and proxy settings.", type: "err" });
  }

  function addFiles(fileList) {
    const arr = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith(".xml"));
    setFileQueue(prev => {
      const names = new Set(prev.map(x => x.name));
      return [...prev, ...arr.filter(f => !names.has(f.name)).map(f => ({ name: f.name, size: f.size, file: f }))];
    });
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }

  function selectSource(src) {
    setIngest(prev => prev === src ? null : src);
    if (src === "local") setTimeout(() => fileRef.current?.click(), 50);
  }

  async function pickFolder() {
    if (window.showDirectoryPicker) {
      try {
        const dir = await window.showDirectoryPicker({ mode: "read" });
        const count = await scanDirectory(dir, "");
        setFolderPicked({ name: dir.name, count });
      } catch(e) {
        if (e.name !== "AbortError") setFolderPicked({ error: e.message });
      }
    } else {
      dirRef.current?.click();
    }
  }

  async function scanDirectory(dirHandle, prefix) {
    let count = 0;
    const pending = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === "file" && name.toLowerCase().endsWith(".xml")) {
        pending.push((async () => {
          try {
            const file = await handle.getFile();
            const fullName = prefix ? prefix + "/" + name : name;
            setFileQueue(prev => {
              if (prev.some(x => x.name === fullName)) return prev;
              return [...prev, { name: fullName, size: file.size, file }];
            });
            count++;
          } catch(e) { console.warn("Could not read", name, e); }
        })());
      } else if (handle.kind === "directory") {
        const sub = prefix ? prefix + "/" + name : name;
        pending.push(scanDirectory(handle, sub).then(n => { count += n; }));
      }
    }
    await Promise.all(pending);
    return count;
  }

  const analyzed = results ? results.length : 0;

  return (
    <div className="row" style={{ alignItems:"flex-start" }}>
      {/* ── Left column ── */}
      <div className="col">
        {/* ingestion tiles */}
        <div style={{ marginBottom:18 }}>
          <div className="sec-lbl" style={{ marginBottom:12 }}>Select Ingestion Source</div>
          <div className="g2" style={{ marginBottom:14 }}>
            {/* Local */}
            <div className={`ingest-tile${ingest==="local"?" active-local":""}`} onClick={() => selectSource("local")} title="Load CCDA files from local disk">
              <div className="ingest-tile-icon" style={{ background:"rgba(214,59,16,.08)", border:"1.5px solid rgba(214,59,16,.18)" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 9l2.5 2.5L14 7"/>
                </svg>
              </div>
              <div className="ingest-tile-label">Local Path</div>
              <div className="ingest-tile-sub">Browse files on this machine</div>
            </div>
            {/* Share Drive */}
            <div className={`ingest-tile${ingest==="share"?" active-share":""}`} onClick={() => selectSource("share")} title="Load CCDA files from a network share">
              <div className="ingest-tile-icon" style={{ background:"rgba(26,95,168,.08)", border:"1.5px solid rgba(26,95,168,.18)" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 20h16"/><rect x="2" y="4" width="20" height="12" rx="2"/>
                  <path d="M8 10h8M8 13h5"/><circle cx="18" cy="7" r="2.5"/><path d="M18 9.5v2"/>
                </svg>
              </div>
              <div className="ingest-tile-label">Share Drive</div>
              <div className="ingest-tile-sub">Mount a network share path</div>
            </div>
            {/* Cloud Storage */}
            <div className={`ingest-tile${ingest==="gcs"?" active-gcs":""}`} onClick={() => setIngest(p => p==="gcs"?null:"gcs")} title="Load CCDA files from Google Cloud Storage">
              <div className="ingest-tile-icon" style={{ background:"rgba(140,86,0,.07)", border:"1.5px solid rgba(140,86,0,.18)" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.amber} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.3 6H8.3A7 7 0 0 1 12 2z"/>
                  <path d="M8.3 15a4 4 0 1 0 7.4 0"/>
                  <path d="M9 18h6M10 21h4"/>
                </svg>
              </div>
              <div className="ingest-tile-label">Cloud Storage</div>
              <div className="ingest-tile-sub">Google Cloud Storage bucket</div>
            </div>
            {/* Azure Databricks */}
            <div className={`ingest-tile${ingest==="databricks"?" active-databricks":""}`} onClick={() => selectSource("databricks")} title="Load CCDA files from Azure Databricks">
              <div className="ingest-tile-icon" style={{ background:"rgba(8,145,178,.08)", border:"1.5px solid rgba(8,145,178,.22)" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l9 5v5l-9 5-9-5V7z"/>
                  <path d="M3 12l9 5 9-5"/>
                  <path d="M12 17v5"/>
                </svg>
              </div>
              <div className="ingest-tile-label">Azure Databricks</div>
              <div className="ingest-tile-sub">Sandbox DBFS / Volume path</div>
            </div>
          </div>

          {/* local drop zone */}
          {ingest === "local" && (
            <div className="card mb18">
              <div className="chead" style={{ padding:"13px 16px" }}>
                <span className="ctit"><span className="ctit-dot"/>Local Path · Drop or Browse</span>
                <button className="btn btn-s btn-xs" onClick={() => setIngest(null)}>✕ Close</button>
              </div>
              <div style={{ padding:16 }}>
                <div className={`upzone${dragOver?" over":""}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}>
                  <div className="up-icon">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M10 14V6M7 9l3-3 3 3"/><rect x="3" y="3" width="14" height="14" rx="3" fill="none"/>
                    </svg>
                  </div>
                  <div className="up-title">Drop CCDA XML files here</div>
                  <div className="up-sub">Click to browse · Multiple files supported · .xml format</div>
                </div>
                <input ref={fileRef} type="file" multiple accept=".xml" style={{ display:"none" }}
                  onChange={e => { addFiles(e.target.files); e.target.value = ""; }}/>
                <div style={{ marginTop:10, fontSize:11, color:"var(--muted)", lineHeight:1.5 }}>
                  Select individual <code style={{ fontFamily:"var(--mono)", background:"var(--cream)", padding:"1px 5px", borderRadius:3 }}>.xml</code> files from a local path on this machine. No data leaves your browser.
                </div>
              </div>
            </div>
          )}
          {/* share drive picker */}
          {ingest === "share" && (
            <div className="card mb18">
              <div className="chead" style={{ padding:"13px 16px" }}>
                <span className="ctit"><span className="ctit-dot blue"/>Share Drive · Folder Picker</span>
                <button className="btn btn-s btn-xs" onClick={() => { setIngest(null); setFolderPicked(null); }}>✕ Close</button>
              </div>
              <div style={{ padding:16 }}>
                {folderPicked && (
                  <div style={{ marginBottom:10 }}>
                    {folderPicked.error ? (
                      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 11px", background:"var(--redbg)", border:"1px solid var(--redbrd)", borderRadius:6, fontSize:12 }}>
                        <span style={{ color:"var(--red)", fontWeight:600 }}>Error: {folderPicked.error}</span>
                      </div>
                    ) : (
                      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 11px", background:"var(--greenbg)", border:"1px solid var(--greenbrd)", borderRadius:6, fontSize:12 }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="var(--green)"><path d="M1 4h5l2 2h7v8H1z"/></svg>
                        <span style={{ color:"var(--green)", fontWeight:600, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{folderPicked.name}</span>
                        <span style={{ color:"var(--green)", fontFamily:"var(--mono)", fontSize:10 }}>{folderPicked.count} XML file{folderPicked.count !== 1 ? "s" : ""}</span>
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
                  <button className="btn btn-p btn-sm" onClick={pickFolder}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1 4h5l2 2h7v8H1z"/></svg>
                    Pick Folder…
                  </button>
                  <button className="btn btn-s btn-sm" onClick={() => dirRef.current?.click()}>Fallback Picker</button>
                </div>
                <input ref={dirRef} type="file" multiple webkitdirectory="" style={{ display:"none" }}
                  onChange={e => {
                    const files = [...e.target.files].filter(f => f.name.toLowerCase().endsWith(".xml"));
                    if (files.length) {
                      addFiles(files);
                      const folder = files[0].webkitRelativePath?.split("/")[0] || "Selected folder";
                      setFolderPicked({ name: folder, count: files.length });
                    }
                    e.target.value = "";
                  }}/>
                <div style={{ fontSize:11, color:"var(--muted)", lineHeight:1.5 }}>
                  Recursively scans the selected folder for <code style={{ fontFamily:"var(--mono)", background:"var(--cream)", padding:"1px 5px", borderRadius:3 }}>.xml</code> files.
                  Works with local drives and mounted network shares (<code style={{ fontFamily:"var(--mono)", background:"var(--cream)", padding:"1px 5px", borderRadius:3 }}>\\server\share</code>).
                  Uses the browser's File System Access API — no data leaves your machine.
                </div>
              </div>
            </div>
          )}
          {/* GCS panel */}
          {ingest === "gcs" && (
            <div className="card mb18">
              <div className="chead" style={{ padding:"13px 16px" }}>
                <span className="ctit"><span className="ctit-dot amber"/>Google Cloud Storage</span>
                <button className="btn btn-s btn-xs" onClick={() => setIngest(null)}>✕ Close</button>
              </div>
              <div style={{ padding:16 }}>
                <div className="igrp"><label className="ilbl">Bucket Name</label>
                  <input className="ifield" placeholder="my-clinical-data-bucket"/></div>
                <div className="igrp"><label className="ilbl">Path Prefix</label>
                  <input className="ifield" placeholder="ccda/2024/"/></div>
                <div className="igrp"><label className="ilbl">Service Account Key (JSON)</label>
                  <textarea className="ifield" rows="2" placeholder='{"type":"service_account",...}'></textarea></div>
                <button className="btn btn-s btn-sm" onClick={() => alert("GCS requires server-side proxying. Provide the service account key to a backend Cloud Function that lists and streams the CCDA files.")}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/></svg>
                  Connect to GCS
                </button>
              </div>
            </div>
          )}
          {/* Databricks panel */}
          {ingest === "databricks" && (
            <div className="card mb18">
              <div className="chead" style={{ padding:"13px 16px" }}>
                <span className="ctit"><span className="ctit-dot" style={{ background:"#0891b2" }}/>Azure Databricks · Sandbox</span>
                <button className="btn btn-s btn-xs" onClick={() => setIngest(null)}>✕ Close</button>
              </div>
              <div style={{ padding:16 }}>
                <div className="igrp">
                  <label className="ilbl">Databricks Host</label>
                  <input className="ifield" ref={dbxHostRef} placeholder="https://adb-xxxxxxxxxxxx.azuredatabricks.net"/>
                </div>
                <div className="igrp">
                  <label className="ilbl">Personal Access Token</label>
                  <input className="ifield" ref={dbxTokenRef} type="password" placeholder="dapi••••••••••••••••••••••••••••"/>
                </div>
                <div className="igrp">
                  <label className="ilbl">DBFS / Volume Path</label>
                  <input className="ifield" ref={dbxPathRef} placeholder="/Volumes/catalog/schema/volume/ccda  or  dbfs:/mnt/ccda/"/>
                </div>
                <div className="igrp" style={{ marginBottom:12 }}>
                  <label className="ilbl">File Pattern <span style={{ fontWeight:400, color:"var(--muted)" }}>(optional glob)</span></label>
                  <input className="ifield" ref={dbxPatternRef} placeholder="*.xml"/>
                </div>
                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:12 }}>
                  <button className="btn btn-sm" style={{ background:"#0891b2", color:"#fff", borderColor:"#0891b2" }} onClick={databricksLoad}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l9 5v5l-9 5-9-5V7z"/><path d="M3 12l9 5 9-5"/></svg>
                    Connect &amp; Load All
                  </button>
                  <button className="btn btn-s btn-sm" style={{ borderColor:"#0891b2", color:"#0891b2" }} onClick={dbxBrowse}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6h5l2 2h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6z"/><path d="M16 13l-4 4-4-4m4 4V9"/></svg>
                    Browse &amp; Pick Files
                  </button>
                  {dbxStatus && <span style={{ fontSize:11, color:"var(--muted)" }}>{dbxStatus}</span>}
                </div>
                {dbxResult && (
                  <div style={{
                    display:"block", padding:"8px 11px", borderRadius:6, fontSize:12, marginBottom:10,
                    background: dbxResult.type==="ok" ? "var(--greenbg)" : dbxResult.type==="warn" ? "var(--amberbg)" : "var(--redbg)",
                    border: `1px solid ${dbxResult.type==="ok" ? "var(--greenbrd)" : dbxResult.type==="warn" ? "var(--amberb)" : "var(--redbrd)"}`,
                    color: dbxResult.type==="ok" ? "var(--green)" : dbxResult.type==="warn" ? "var(--amber)" : "var(--red)",
                  }}>{dbxResult.msg}</div>
                )}
                <div style={{ fontSize:11, color:"var(--muted)", lineHeight:1.6 }}>
                  Connects to your Azure Databricks sandbox via the{" "}
                  <code style={{ fontFamily:"var(--mono)", background:"var(--cream)", padding:"1px 5px", borderRadius:3 }}>DBFS Files API</code>.
                  The Personal Access Token is used only for this session and never stored.
                  Ensure your sandbox cluster allows REST API access and the path contains{" "}
                  <code style={{ fontFamily:"var(--mono)", background:"var(--cream)", padding:"1px 5px", borderRadius:3 }}>.xml</code> CCDA files.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* HEDIS Value Sets */}
        <div className="card">
          <div className="ctit mb12" style={{ marginBottom:12 }}>
            <span className="ctit-dot" style={{ background:C.purple }}/>
            HEDIS Value Sets · NCQA 2024
          </div>
          <div style={{ fontSize:11, color:"var(--text2)", lineHeight:1.6, marginBottom:10 }}>
            All HEDIS evaluation uses <strong>bundled NCQA HEDIS 2024</strong> value sets — numerator,
            denominator, and exclusion codes for 10 measures sourced from the NLM Value Set Authority Center (VSAC).
          </div>
          <div style={{ borderTop:"1px solid var(--border)", paddingTop:10 }}>
            <div className="sec-lbl" style={{ marginBottom:8 }}>Loaded Value Sets</div>
            <div style={{ maxHeight:260, overflowY:"auto" }}>
              {valueSets.length === 0 && (
                <div style={{ fontSize:11, color:"var(--muted)", fontFamily:"var(--mono)" }}>Loading value sets…</div>
              )}
              {valueSets.map((vs, i) => {
                const roleLabel = vs.role ? vs.role.charAt(0).toUpperCase() + vs.role.slice(1) : vs.role;
                return (
                  <div key={i} className="vs-row">
                    <span className="vs-dot" style={{ background: VS_COLORS[vs.role] || "#888" }}/>
                    <span className="vs-name" title={vs.oid || vs.name}>{vs.name}</span>
                    <span className="vs-cnt">{vs.total_codes} codes</span>
                    <span className={`vs-role ${vs.role}`}>{roleLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Databricks browser modal ── */}
      {dbxBrowserOpen && (
        <div className={`dbx-browser-overlay on`} onClick={e => { if (e.target === e.currentTarget) setDbxBrowserOpen(false); }}>
          <div className="dbx-browser-modal">
            {/* Header */}
            <div className="dbx-brow-head">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l9 5v5l-9 5-9-5V7z"/><path d="M3 12l9 5 9-5"/><path d="M12 17v5"/></svg>
              <span className="dbx-brow-title">Databricks Workspace Browser</span>
              <button className="dbx-brow-close" onClick={() => setDbxBrowserOpen(false)}>✕</button>
            </div>
            {/* Breadcrumb */}
            <div className="dbx-breadcrumb">
              <span className="dbx-bc-seg" onClick={() => dbxNavTo("/")}>root</span>
              {dbxCurrentPath.replace(/^\/+/, "").split("/").filter(Boolean).map((seg, i, parts) => {
                const built = "/" + parts.slice(0, i + 1).join("/");
                return (
                  <span key={i}>
                    <span className="dbx-bc-sep">/</span>
                    {i === parts.length - 1
                      ? <span className="dbx-bc-cur">{seg}</span>
                      : <span className="dbx-bc-seg" onClick={() => dbxNavTo(built)}>{seg}</span>}
                  </span>
                );
              })}
            </div>
            {/* Toolbar */}
            <div className="dbx-brow-toolbar">
              <input className="dbx-brow-filter" placeholder="Filter files…" value={dbxFilter}
                onChange={e => setDbxFilter(e.target.value)}/>
              <button className="btn btn-s btn-sm" onClick={dbxSelectAllVisible}>Select all</button>
              <button className="btn btn-s btn-sm" onClick={dbxDeselectAll}>Clear</button>
            </div>
            {/* Body */}
            <div className="dbx-brow-body">
              {dbxBrowseLoading && (
                <div className="dbx-brow-loading">
                  <div className="dbx-spinner"/>&nbsp;Loading {dbxCurrentPath}…
                </div>
              )}
              {dbxBrowseError && (
                <div style={{ padding:"20px 18px", color:"var(--red)", fontSize:12 }}>
                  <strong>Error listing path:</strong> {dbxBrowseError}<br/>
                  <span style={{ color:"var(--muted)" }}>Check your credentials and path.</span>
                </div>
              )}
              {!dbxBrowseLoading && !dbxBrowseError && (() => {
                const filterVal = dbxFilter.toLowerCase();
                const visible = dbxEntries.filter(e => {
                  const name = e.path.split("/").pop() || "";
                  return !filterVal || name.toLowerCase().includes(filterVal);
                });
                if (!visible.length) return (
                  <div style={{ padding:"24px 18px", color:"var(--muted)", fontSize:12, textAlign:"center" }}>
                    {dbxFilter ? "No entries match your filter." : "This directory is empty."}
                  </div>
                );
                return visible.map((e, i) => {
                  const name = e.path.split("/").pop() || e.path;
                  const isDir = !!e.is_dir;
                  const isXml = !isDir && name.toLowerCase().endsWith(".xml");
                  const checked = dbxSelectedRef.current.has(e.path);
                  if (isDir) return (
                    <div key={i} className="dbx-entry" onClick={() => dbxNavTo(e.path)}>
                      <div className="dbx-entry-ico dir">
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="#0891b2"><path d="M1 4h5l2 2h7v8H1z"/></svg>
                      </div>
                      <span className="dbx-entry-name" title={e.path}>{name}</span>
                      <span className="dbx-entry-size"/>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--muted)" strokeWidth="1.5"><path d="M6 4l4 4-4 4"/></svg>
                    </div>
                  );
                  return (
                    <div key={i} className={`dbx-entry${checked?" selected":""}`}
                      style={!isXml ? { opacity:.5, cursor:"default" } : {}}
                      onClick={() => isXml && dbxToggleFile(e.path)}>
                      <div className="dbx-entry-ico file">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill={isXml?"#1a6b44":"var(--muted)"}><path d="M3 1h7l3 3v11H3V1zm7 0v3h3"/></svg>
                      </div>
                      <span className="dbx-entry-name" title={e.path}>{name}</span>
                      <span className="dbx-entry-size">{dbxFormatSize(e.file_size)}</span>
                      {isXml
                        ? <input type="checkbox" className="dbx-entry-check" checked={checked} readOnly
                            onClick={ev => { ev.stopPropagation(); dbxToggleFile(e.path); }}/>
                        : <span style={{ width:15 }}/>}
                    </div>
                  );
                });
              })()}
            </div>
            {/* Footer */}
            <div className="dbx-brow-foot">
              <span className="dbx-sel-count">
                {dbxSelCount > 0 ? <><strong>{dbxSelCount}</strong> file{dbxSelCount !== 1 ? "s" : ""} selected</> : "No files selected"}
              </span>
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn btn-s btn-sm" onClick={() => setDbxBrowserOpen(false)}>Cancel</button>
                <button className="btn btn-sm" disabled={dbxSelCount === 0 || dbxLoadSelBusy}
                  style={{ background:"#0891b2", color:"#fff", borderColor:"#0891b2", opacity: dbxSelCount===0?".5":"1" }}
                  onClick={dbxLoadSelected}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 12h12v2H2zm5-9v7l-3-3-1 1 4 4 4-4-1-1-3 3V3H7z"/></svg>
                  {dbxLoadSelBusy ? "Loading…" : "Load Selected"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Right column ── */}
      <div className="col">
        <div className="card-flush mb18">
          <div className="chead">
            <span className="ctit"><span className="ctit-dot"/>File Queue</span>
            <div style={{ display:"flex", gap:6 }}>
              <button className="btn btn-s btn-sm" disabled={samplesLoading || loading} onClick={async () => {
                setSamplesLoading(true);
                try {
                  const data = await ccdaApi.loadSamples();
                  // store pre-analyzed data in each queue item; analysis runs only on Execute Workflow
                  setFileQueue(
                    (data.results || []).map((r, i) => ({
                      name: r.name, size: r.size||null, file: null,
                      _preloaded: r,
                      _fhirBundle: (data.fhir_bundles||[])[i] || null,
                    }))
                  );
                } catch(e) { alert("Failed to load samples: " + e.message); }
                finally { setSamplesLoading(false); }
              }}>{samplesLoading ? "⏳ Loading samples…" : "Load 5 Samples"}</button>
              <button className="btn btn-s btn-sm" style={{ color:"var(--red)" }}
                onClick={() => setFileQueue([])}>Clear</button>
            </div>
          </div>
          <div className="cbody" style={{ maxHeight:320, overflowY:"auto", padding:14 }}>
            {fileQueue.length === 0 ? (
              <div className="empty" style={{ padding:30 }}>
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                  <rect x="6" y="4" width="28" height="32" rx="4" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M12 14h16M12 20h12M12 26h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <div className="empty-t" style={{ fontSize:14 }}>No files loaded</div>
                <div>Upload XML files or load samples to begin</div>
              </div>
            ) : (
              fileQueue.map((f, i) => (
                <FileItem key={i} name={f.name} size={f.size}
                  onRemove={() => setFileQueue(prev => prev.filter((_,j) => j !== i))}/>
              ))
            )}
          </div>
        </div>

        {/* Progress bar — visible while analyzing */}
        {loading && (
          <div className="card mb18">
            <div className="spin-row mb12">
              <div className="spin"/>
              <span>{progressMsg || "Processing…"}</span>
            </div>
            <div className="pbar"><div className="pf pr" style={{ width:`${progressPct}%` }}/></div>
          </div>
        )}

        {/* Analysis complete banner */}
        {analysisComplete && results?.length > 0 && !loading && (
          <div className="alert al-g mb18">
            ✓ Analysis complete — {results.length} file(s) processed successfully
          </div>
        )}

        {/* Batch summary — matches V15_29Apr exactly */}
        {analysisComplete && results?.length > 0 && !loading && (() => {
          const n = results.length;
          const avg = Math.round(results.reduce((a,r) => a+(r.scores?.overall||0),0)/n);
          const high = results.filter(r => (r.scores?.overall||0) >= 80).length;
          const issues = results.filter(r => (r.issues||[]).length > 0).length;
          const hedis = results.filter(r => (r.hedis||[]).some(h => h.numer_hit)).length;
          const pct = (v) => Math.round(v/n*100);
          return (
            <div>
              <div className="sec-lbl">Batch Summary</div>
              <div className="g2 mb12">
                <MetCard cls="t" label="Avg Quality" val={avg} sub="weighted score /100"/>
                <MetCard cls="g" label="High Quality ≥80" val={high} sub={`${pct(high)}% of files`}/>
              </div>
              <div className="g2">
                <MetCard cls="a" label="Files w/ Issues" val={issues} sub={`${pct(issues)}% flagged`}/>
                <MetCard cls="b" label="HEDIS Active" val={hedis} sub="in at least 1 numerator"/>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUALITY PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function QualityPanel({ results, openModal }) {
  const [filter, setFilter] = useState("");
  const [sortCol, setSortCol] = useState("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [expanded, setExpanded] = useState({});

  if (!results?.length) return (
    <EmptyState icon={<><circle cx="26" cy="26" r="22" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M26 14v12l8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></>}
      title="Analysis not yet run"
      sub="Load CCDA files on the Input tab, then click Execute Workflow."/>
  );

  const avg = f => Math.round(results.reduce((a,x) => a+(x.scores?.[f]||0),0)/results.length);
  const dims = [["overall","Overall"],["terminology","Terminology"],["completeness","Completeness"],["accuracy","Accuracy"],["structure","Structure"]];

  const bins = [0,0,0,0,0];
  for (const r of results) {
    const s = r.scores?.overall||0;
    const idx = s<20?0:s<40?1:s<60?2:s<80?3:4;
    bins[idx]++;
  }

  function toggleSort(col) {
    if (col === sortCol) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(col === "name"); }
  }

  const filtered = results.filter(r => !filter || r.name.toLowerCase().includes(filter.toLowerCase()));
  const sorted = [...filtered].sort((a,b) => {
    const av = sortCol === "name" ? a.name : (a.scores?.[sortCol]||0);
    const bv = sortCol === "name" ? b.name : (b.scores?.[sortCol]||0);
    const cmp = sortCol === "name" ? av.localeCompare(bv) : (av - bv);
    return sortAsc ? cmp : -cmp;
  });

  const scoreCol = s => s>=80?"var(--green)":s>=60?"var(--amber)":"var(--red)";
  const SEC_KEYS = ["allergies","medications","problems","results","procedures","encounters","vitals","social","immunize"];
  const SEC_NAMES = { allergies:"Allergies", medications:"Medications", problems:"Problems", results:"Results/Labs", procedures:"Procedures", encounters:"Encounters", vitals:"Vital Signs", social:"Social History", immunize:"Immunizations" };

  function showDetail(r) {
    const s = r.scores||{};
    const sev = s.overall>=80?{cls:"al-g",lbl:"Good quality"}:s.overall>=60?{cls:"al-w",lbl:"Needs improvement"}:{cls:"al-r",lbl:"Critical issues found"};
    const ri = r.rich_issues||[];
    const crits = ri.filter(i=>i.sev==="critical").length;
    const warns = ri.filter(i=>i.sev==="warning").length;
    const sCount = Object.values(r.secs||{}).filter(Boolean).length;
    openModal(r.name, (
      <div>
        <div className={`alert ${sev.cls}`} style={{ marginBottom:14, display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:26, fontFamily:"var(--display)", fontWeight:800, lineHeight:1 }}>{s.overall}</span>
          <div>
            <div style={{ fontWeight:700, fontSize:13 }}>{sev.lbl}</div>
            <div style={{ fontSize:11, opacity:.8 }}>{crits} critical · {warns} warnings · {ri.length} total issues · {sCount}/9 sections</div>
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:18, marginBottom:18 }}>
          <div>
            <div className="sec-lbl" style={{ marginBottom:8 }}>Score Breakdown</div>
            {[["Terminology",s.terminology],["Completeness",s.completeness],["Accuracy",s.accuracy],["Structure",s.structure]].map(([l,v])=>(
              <div key={l} style={{ marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
                  <span style={{ color:"var(--text2)" }}>{l}</span>
                  <span style={{ fontFamily:"var(--mono)", fontWeight:700, color:scoreCol(v||0) }}>{v||0}</span>
                </div>
                <div className="pbar" style={{ height:7 }}><div className="pf" style={{ width:`${v||0}%`, background:scoreCol(v||0) }}/></div>
              </div>
            ))}
            <div className="sdiv"/>
            <div className="sec-lbl" style={{ marginBottom:8 }}>Patient</div>
            {[["Name",[r.pat?.first_name,r.pat?.last_name].filter(Boolean).join(" ")||"—"],["Age",r.pat?.age!=null?r.pat.age+" years":"—"],["Gender",r.pat?.gender||"—"],["DOB",r.pat?.birth_date||"—"]].map(([l,v])=>(
              <div key={l} className="m-row"><span className="m-lbl">{l}</span><span className="m-val">{v}</span></div>
            ))}
            <div className="sdiv"/>
            <div className="sec-lbl" style={{ marginBottom:8 }}>Vocabulary Counts</div>
            {Object.entries(r.codes||{}).map(([k,v])=>(
              <div key={k} className="m-row"><span className="m-lbl">{k.toUpperCase()}</span><span className="m-val">{v} code{v!==1?"s":""}</span></div>
            ))}
          </div>
          <div>
            <div className="sec-lbl" style={{ marginBottom:8 }}>Section Checklist ({sCount}/9)</div>
            {SEC_KEYS.map(k => {
              const v = r.secs?.[k];
              return (
                <div key={k} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0", borderBottom:"1px solid var(--border)", fontSize:12 }}>
                  <span style={{ width:16, height:16, borderRadius:"50%", display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, flexShrink:0, background:v?"var(--greenbg)":"var(--redbg)", border:`1px solid ${v?"var(--greenbrd)":"var(--redbrd)"}`, color:v?"var(--green)":"var(--red)" }}>{v?"✓":"✕"}</span>
                  <span style={{ flex:1, color:"var(--text2)" }}>{SEC_NAMES[k]}</span>
                  <span className={`badge ${v?"bh":"bl"}`}>{v?"Present":"Missing"}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="sdiv"/>
        <div className="sec-lbl" style={{ marginBottom:8 }}>
          Issues — click any row to see the affected codes and data
          <span style={{ fontWeight:400, textTransform:"none", letterSpacing:0, fontSize:10, color:"var(--muted)", marginLeft:8 }}>({ri.length} total)</span>
        </div>
        {ri.length ? ri.map((iss,j) => <IssueCard key={j} issue={iss}/>) : (
          <div style={{ fontSize:12, color:"var(--green)", padding:"8px 12px", background:"var(--greenbg)", border:"1px solid var(--greenbrd)", borderRadius:6 }}>
            ✓ No issues — all checks passed.
          </div>
        )}
      </div>
    ));
  }

  const CHART_DEFAULTS = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} } };

  return (
    <div>
      {/* gauge grid */}
      <div className="gauge-grid">
        {dims.map(([f,l]) => (
          <div key={f} className="gauge-card">
            <Gauge score={avg(f)} size={80}/>
            <div className="gauge-lbl">{l}</div>
            <div className="gauge-sub">{avg(f)}%</div>
          </div>
        ))}
      </div>

      {/* distribution + radar */}
      <div className="row mb18">
        <div className="col" style={{ maxWidth:320 }}>
          <div className="card">
            <div className="ctit mb12"><span className="ctit-dot"/>Score Distribution</div>
            <div style={{ height:180 }}>
              <Bar data={{
                labels:["0–20","20–40","40–60","60–80","80–100"],
                datasets:[{ data:bins, backgroundColor:["#d63b10","#c86010","#b0880a","#1a6b44","#1a5fa8"], borderRadius:5, borderSkipped:false }]
              }} options={{ ...CHART_DEFAULTS, scales:{ x:{grid:{display:false}}, y:{grid:{color:"#f0ebe4"},ticks:{stepSize:1,precision:0}} } }}/>
            </div>
          </div>
        </div>
        <div className="col-2">
          <div className="card">
            <div className="ctit mb12"><span className="ctit-dot blue"/>Dimension Averages</div>
            <div style={{ height:180 }}>
              <Radar data={{
                labels:["Terminology","Completeness","Accuracy","Structure"],
                datasets:[{ data:[avg("terminology"),avg("completeness"),avg("accuracy"),avg("structure")],
                  backgroundColor:"rgba(214,59,16,.08)", borderColor:"#d63b10",
                  pointBackgroundColor:"#d63b10", pointRadius:4, borderWidth:2 }]
              }} options={{ ...CHART_DEFAULTS, plugins:{legend:{display:false}}, scales:{ r:{min:0,max:100,ticks:{stepSize:25,backdropColor:"transparent"}} } }}/>
            </div>
          </div>
        </div>
      </div>

      {/* per-file table */}
      <div className="card-flush">
        <div className="chead">
          <span className="ctit"><span className="ctit-dot green"/>Per-File Quality Scores</span>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <input className="ifield" style={{ width:180, margin:0 }} placeholder="Filter…"
              value={filter} onChange={e => setFilter(e.target.value)}/>
            <button className="btn btn-s btn-sm" onClick={() => {
              const rows = [["File","Overall","Terminology","Completeness","Accuracy","Structure","Issues"]];
              for (const r of results) rows.push([r.name,r.scores?.overall,r.scores?.terminology,r.scores?.completeness,r.scores?.accuracy,r.scores?.structure,(r.issues||[]).length]);
              const csv = rows.map(r => r.join(",")).join("\n");
              const a = document.createElement("a"); a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
              a.download = "ccda_scores.csv"; a.click();
            }}>Export CSV</button>
          </div>
        </div>
        <div style={{ overflowX:"auto", overflowY:"auto", maxHeight:420 }}>
          <table className="tbl">
            <thead style={{ position:"sticky", top:0, zIndex:2, background:"var(--white)" }}>
              <tr>
                {[["name","File"],["overall","Overall"],["terminology","Terminology"],["completeness","Completeness"],["accuracy","Accuracy"],["structure","Structure"]].map(([k,l]) => (
                  <th key={k} onClick={() => toggleSort(k)}>{l}{sortCol===k?(sortAsc?" ↑":" ↓"):""}</th>
                ))}
                <th>Sections</th><th>Issues</th><th style={{ width:70 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const open = expanded[i];
                const ri = r.rich_issues || [];
                const crits = ri.filter(x => x.sev === "critical").length;
                const warns = ri.filter(x => x.sev === "warning").length;
                const infos = ri.filter(x => x.sev === "info").length;
                const stripCls = crits > 0 ? "has-crit" : "has-warn";
                return [
                  <tr key={`r${i}`} className="xr" onClick={() => setExpanded(p => ({...p, [i]: !p[i]}))}>
                    <td><span className="fn">{open?"▾":"▸"} {r.name}</span></td>
                    <td><span className={`badge ${(r.scores?.overall||0)>=80?"bh":(r.scores?.overall||0)>=60?"bm":"bl"}`}>{r.scores?.overall||0}</span></td>
                    {["terminology","completeness","accuracy","structure"].map(f => (
                      <td key={f}><ScoreBar score={r.scores?.[f]||0} cls={scoreClass(r.scores?.[f]||0)}/></td>
                    ))}
                    <td style={{ color:"var(--text2)" }}>{Object.values(r.secs||{}).filter(Boolean).length}/9</td>
                    <td>{ri.length ? <span className="badge bl">{ri.length}{crits?<span style={{fontSize:9,opacity:.7}}> ({crits}✕)</span>:null}</span> : <span className="badge bh">0</span>}</td>
                    <td style={{ textAlign:"right" }}><button className="btn btn-s btn-xs" onClick={e => { e.stopPropagation(); showDetail(r); }}>Detail →</button></td>
                  </tr>,
                  <tr key={`d${i}`} className={`dtl-row${open?" on":""}`}>
                    <td colSpan={9}>
                      <div className="dtl-cell">
                        {ri.length === 0 ? (
                          <div className="iss-none-ok">
                            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            No issues — all checks passed.
                          </div>
                        ) : (
                          <>
                            <div className={`iss-strip ${stripCls}`}>
                              {crits > 0 && <span style={{ color:"var(--red)", fontWeight:700 }}>● {crits} Critical</span>}
                              {warns > 0 && <span style={{ color:"var(--amber)", fontWeight:700 }}>▲ {warns} Warning</span>}
                              {infos > 0 && <span style={{ color:"var(--blue)", fontWeight:700 }}>○ {infos} Info</span>}
                              <span style={{ marginLeft:"auto", color:"var(--muted)", fontSize:11 }}>Click any issue to see the affected data</span>
                            </div>
                            {ri.map((iss, j) => <IssueCard key={j} issue={iss}/>)}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEDIS PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function HedisPanel({ results, valueSets, openModal }) {
  if (!results?.length) return (
    <EmptyState icon={<><rect x="4" y="4" width="44" height="44" rx="6" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M14 36l8-12 7 8 5-7 8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></>}
      title="HEDIS dashboard is empty" sub="Analyze CCDA files to populate HEDIS measure data."/>
  );

  const vsByName = Object.fromEntries((valueSets||[]).map(vs => [vs.name, vs]));

  function showHEDISDetail(mid) {
    const ref = results.flatMap(r => r.hedis||[]).find(h => h.id === mid);
    if (!ref) return;
    const files = results.filter(r => (r.hedis||[]).some(h => h.id === mid));
    const numerVS = ref.numer_vs || [];
    const denomVS = ref.denom_vs || [];
    const exclVS  = ref.exclusion_vs || [];

    const VSBlock = ({ vsNames, bg, brd, col, label }) => (
      vsNames.length ? <>
        <div className="sec-lbl" style={{ marginBottom:6 }}>{label} ({vsNames.length})</div>
        <div style={{ marginBottom:14 }}>
          {vsNames.map((vsName,i) => {
            const vs = vsByName[vsName] || {};
            const sc = vs.systems_counts || {};
            return (
              <div key={i} style={{ padding:"8px 12px", background:bg||"var(--paper)", border:`1px solid ${brd||"var(--border)"}`, borderRadius:6, marginBottom:5 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                  <span style={{ fontSize:12, fontWeight:600, color:"var(--text)" }}>{vsName}</span>
                  <span style={{ fontFamily:"var(--mono)", fontSize:10, color:"var(--muted)", marginLeft:"auto" }}>{vs.total_codes||0} codes · OID: {vs.oid||"—"}</span>
                </div>
                <div>{Object.entries(sc).map(([s,n],j) => (
                  <span key={j} style={{ fontSize:10, color:"var(--text2)", marginRight:8 }}>{s}: {n}</span>
                ))}</div>
              </div>
            );
          })}
        </div>
      </> : null
    );

    openModal(`${mid} — ${ref.name}`, (
      <div>
        <div className="alert al-i" style={{ marginBottom:14 }}>
          <div style={{ fontWeight:700, fontSize:12, marginBottom:2 }}>{ref.cat} · {ref.description||""}</div>
        </div>
        <VSBlock vsNames={numerVS} label="Numerator Value Sets" bg="var(--paper)" brd="var(--border)"/>
        <VSBlock vsNames={denomVS} label="Denominator Value Sets" bg="var(--bluebg)" brd="var(--bluebrd)" col="var(--blue)"/>
        <VSBlock vsNames={exclVS} label="Exclusion Value Sets" bg="var(--redbg)" brd="var(--redbrd)" col="var(--red)"/>
        <div className="sdiv"/>
        <div className="sec-lbl" style={{ marginBottom:6 }}>CCDAs with Evidence — matched codes shown ({files.length})</div>
        {files.length === 0 && <div style={{ color:"var(--muted)", fontSize:12 }}>No files matched this measure.</div>}
        {files.map((r,i) => {
          const h = (r.hedis||[]).find(x => x.id === mid);
          const status = h?.numer_hit ? "bh" : h?.exclusion_hit ? "bl" : "bm";
          const label  = h?.numer_hit ? "Numerator" : h?.exclusion_hit ? "Excluded" : "Denom only";
          const nChips = (h?.numer_matched||[]).slice(0,8);
          const dChips = (h?.denom_matched||[]).filter(c => c.code !== "(population)").slice(0,8);
          const hasChips = nChips.length > 0 || dChips.length > 0;
          return (
            <div key={i} style={{ padding:"10px 12px", background:"var(--paper)", borderRadius:6, marginBottom:6, border:"1px solid var(--border)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:hasChips?"7px":0 }}>
                <span style={{ fontSize:12, fontWeight:600, color:"var(--blue)", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.name}</span>
                <span className={`badge ${status}`}>{label}</span>
              </div>
              {nChips.length > 0 && (
                <>
                  <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--green)", marginBottom:3 }}>Numerator codes matched</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:2, marginBottom: dChips.length ? 6 : 0 }}>
                    {nChips.map((c,j) => (
                      <span key={j} style={{ fontFamily:"var(--mono)", fontSize:10, background:"var(--greenbg)", color:"var(--green)", border:"1px solid var(--greenbrd)", padding:"1px 6px", borderRadius:3, margin:1 }}>
                        {c.sys_label}:{c.code}{c.disp ? " · "+c.disp : ""}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {dChips.length > 0 && (
                <>
                  <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--blue)", marginBottom:3 }}>Denominator codes matched</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:2 }}>
                    {dChips.map((c,j) => (
                      <span key={j} style={{ fontFamily:"var(--mono)", fontSize:10, background:"var(--bluebg)", color:"var(--blue)", border:"1px solid var(--bluebrd)", padding:"1px 6px", borderRadius:3, margin:1 }}>
                        {c.sys_label}:{c.code}{c.disp ? " · "+c.disp : ""}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    ));
  }

  function showFileHEDIS(name) {
    const r = results.find(x => x.name === name);
    if (!r) return;
    openModal(`HEDIS Evidence — ${name}`, (
      <div>
        {(r.hedis||[]).length === 0 && <div style={{ color:"var(--muted)" }}>No HEDIS evidence found in this file.</div>}
        {(r.hedis||[]).map((h,i) => {
          const nChips = (h.numer_matched||[]);
          const dChips = (h.denom_matched||[]).filter(c => c.code !== "(population)");
          return (
            <div key={i} style={{ border:"1px solid var(--border)", borderRadius:8, overflow:"hidden", marginBottom:10 }}>
              <div style={{ padding:"10px 14px", background:h.numer_hit?"var(--greenbg)":h.exclusion_hit?"var(--redbg)":"var(--amberbg)", display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontFamily:"var(--display)", fontSize:13, fontWeight:700, color:"var(--text)" }}>{h.id}</span>
                <span style={{ fontSize:11, color:"var(--text2)", flex:1 }}>{h.name}</span>
                <span className={`badge ${h.numer_hit?"bh":h.exclusion_hit?"bl":"bm"}`}>{h.numer_hit?"Numerator":h.exclusion_hit?"Excluded":"Denom only"}</span>
              </div>
              {(nChips.length||dChips.length) ? (
                <div style={{ padding:"10px 14px", background:"var(--white)" }}>
                  {nChips.length > 0 && <>
                    <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--green)", marginBottom:4 }}>Numerator codes matched</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:2, marginBottom:6 }}>
                      {nChips.map((c,j) => (
                        <span key={j} style={{ fontFamily:"var(--mono)", fontSize:10, background:"var(--greenbg)", color:"var(--green)", border:"1px solid var(--greenbrd)", padding:"1px 6px", borderRadius:3 }}>
                          {c.sys_label}:{c.code}{c.disp?" · "+c.disp:""}
                        </span>
                      ))}
                    </div>
                  </>}
                  {dChips.length > 0 && <>
                    <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--blue)", marginBottom:4 }}>Denominator codes matched</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:2 }}>
                      {dChips.map((c,j) => (
                        <span key={j} style={{ fontFamily:"var(--mono)", fontSize:10, background:"var(--bluebg)", color:"var(--blue)", border:"1px solid var(--bluebrd)", padding:"1px 6px", borderRadius:3 }}>
                          {c.sys_label}:{c.code}{c.disp?" · "+c.disp:""}
                        </span>
                      ))}
                    </div>
                  </>}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    ));
  }

  async function exportHedisSummary() {
    const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const col = i => "ABCDEFGHIJ"[i];

    // ── build summary rows (per measure) ─────────────────────
    const allH = results.flatMap(r => r.hedis||[]);
    const mids = [...new Set(allH.map(h=>h.id))];
    const summaryRows = mids.map(id => {
      const hits = allH.filter(h => h.id === id);
      return {
        id,
        name: hits[0]?.name || id,
        dFiles: results.filter(r => (r.hedis||[]).some(h => h.id === id && h.denom_hit)).length,
        nFiles: results.filter(r => (r.hedis||[]).some(h => h.id === id && h.numer_hit)).length,
      };
    }).filter(s => s.dFiles > 0 || s.nFiles > 0);

    // ── build detail rows (per file × measure) ────────────────
    const detailRows = [];
    for (const r of results) {
      for (const h of (r.hedis||[])) {
        const dCount = (h.denom_matched||[]).filter(c => c.code !== "(population)").length;
        const nCount = (h.numer_matched||[]).length;
        if (dCount > 0 || nCount > 0)
          detailRows.push({ file: r.name, measure: h.id, dCount, nCount });
      }
    }

    // ── cell helpers ──────────────────────────────────────────
    const strCell = (ref, val, s) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${esc(val)}</t></is></c>`;
    const numCell = (ref, val, s) => `<c r="${ref}" s="${s}"><v>${val}</v></c>`;

    function buildSheet(sections) {
      // sections = [{ header, cols, rows }]
      const sheetRows = [], merges = [];
      let rn = 1;
      const maxCols = Math.max(...sections.map(s => s.cols.length));

      for (const { header, cols, rows } of sections) {
        // green header merged across cols
        let cells = strCell(`A${rn}`, header, 1);
        for (let i = 1; i < cols.length; i++) cells += strCell(`${col(i)}${rn}`, "", 1);
        sheetRows.push(`<row r="${rn}">${cells}</row>`);
        merges.push(`<mergeCell ref="A${rn}:${col(cols.length-1)}${rn}"/>`);
        rn++;
        // bold col headers
        sheetRows.push(`<row r="${rn}">${cols.map((c,i)=>strCell(`${col(i)}${rn}`,c,2)).join("")}</row>`);
        rn++;
        // data rows
        for (const vals of rows) {
          sheetRows.push(`<row r="${rn}">${vals.map((v,i)=>typeof v==="number"?numCell(`${col(i)}${rn}`,v,3):strCell(`${col(i)}${rn}`,v,3)).join("")}</row>`);
          rn++;
        }
        sheetRows.push(`<row r="${rn++}"/>`);
      }

      const mc = merges.length ? `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>` : "";
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="44" customWidth="1"/>
    <col min="2" max="2" width="32" customWidth="1"/>
    <col min="3" max="3" width="28" customWidth="1"/>
    <col min="4" max="4" width="28" customWidth="1"/>
  </cols>
  <sheetData>${sheetRows.join("")}</sheetData>${mc}
</worksheet>`;
    }

    const sheet1 = buildSheet([{
      header: "Summary at Measure Level",
      cols: ["Measure", "Files with Denominator Codes", "Files with Numerator Codes"],
      rows: summaryRows.map(s => [s.id + " — " + s.name, s.dFiles, s.nFiles]),
    }]);

    const sheet2 = buildSheet([{
      header: "Details at File and Measure Level",
      cols: ["File", "Measure", "Count of Unique Denominator Codes", "Count of Unique Numerator Codes"],
      rows: detailRows.map(d => [d.file, d.measure, d.dCount, d.nCount]),
    }]);

    const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF70AD47"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
  </cellXfs>
</styleSheet>`;

    const xml = {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary by Measure" sheetId="1" r:id="rId1"/><sheet name="Details by File" sheetId="2" r:id="rId2"/></sheets></workbook>`,
      "xl/styles.xml": STYLES,
      "xl/worksheets/sheet1.xml": sheet1,
      "xl/worksheets/sheet2.xml": sheet2,
    };

    const zip = new JSZip();
    for (const [path, content] of Object.entries(xml)) zip.file(path, content);
    const blob = await zip.generateAsync({ type:"blob", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hedis_summary.xlsx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const allHedis = results.flatMap(r => r.hedis||[]);
  const measureIds = [...new Set(allHedis.map(h=>h.id))];
  const totalVS = Object.keys(vsByName).length;
  const totalCodes = Object.values(vsByName).reduce((a, vs) => a + (vs.total_codes||0), 0);
  const stats = measureIds.map(id => {
    const hits = allHedis.filter(h => h.id === id);
    const numerVS = hits[0]?.numer_vs || [];
    const numerCodeCt = numerVS.reduce((a, vsName) => {
      const vs = vsByName[vsName];
      return a + (vs ? vs.total_codes||0 : 0);
    }, 0);
    return {
      id, name: hits[0]?.name||id, cat: hits[0]?.cat||"",
      dHits: hits.filter(h=>h.denom_hit).length,
      nHits: hits.filter(h=>h.numer_hit).length,
      exclHits: hits.filter(h=>h.exclusion_hit).length,
      numerCodeCt,
      total: results.length,
    };
  }).filter(s => s.dHits > 0 || s.nHits > 0);

  const COPTS = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{position:"top"} }, scales:{ x:{grid:{display:false}} } };

  return (
    <div>
      {/* export button */}
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:14 }}>
        <button className="btn btn-s" onClick={exportHedisSummary}>↓ Export XLSX</button>
      </div>
      {/* summary metrics — matches original h-metrics layout */}
      <div className="g4 mb18">
        <MetCard cls="t" label="With HEDIS Evidence" val={results.filter(r=>(r.hedis||[]).length>0).length} sub={`${Math.round(results.filter(r=>(r.hedis||[]).length>0).length/results.length*100)}% of all CCDAs`}/>
        <MetCard cls="g" label="Numerator Contributors" val={results.filter(r=>(r.hedis||[]).some(h=>h.numer_hit)).length} sub={`${Math.round(results.filter(r=>(r.hedis||[]).some(h=>h.numer_hit)).length/results.length*100)}% in ≥1 numerator`}/>
        <MetCard cls="b" label="Measures Covered" val={stats.filter(s=>s.nHits>0).length} sub={`of 10 measures`}/>
        <div className="met a">
          <div className="met-lbl">Value Set Source</div>
          <div className="met-val" style={{ fontSize:14 }}>NCQA 2024</div>
          <div className="met-sub" style={{ fontFamily:"var(--mono)", fontSize:10 }}>{totalVS} VS · {totalCodes} codes</div>
        </div>
      </div>

      {/* charts */}
      {stats.length > 0 && (
        <div className="g2 mb18">
          <div className="card">
            <div className="ctit mb12"><span className="ctit-dot"/>Numerator vs Denominator</div>
            <div style={{ display:"flex", gap:14, flexWrap:"wrap", fontSize:11, color:"var(--text2)", marginBottom:10 }}>
              <span style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ width:12, height:12, borderRadius:2, background:"#1a6b44", display:"inline-block" }}/> Numerator</span>
              <span style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ width:12, height:12, borderRadius:2, background:"rgba(140,86,0,.35)", display:"inline-block" }}/> Denom only</span>
            </div>
            <div style={{ height:220 }}>
              <Bar data={{
                labels: stats.map(s=>s.id),
                datasets: [
                  { label:"Numerator", data:stats.map(s=>s.nHits), backgroundColor:"#1a6b44", borderRadius:4, borderSkipped:false },
                  { label:"Denom only", data:stats.map(s=>Math.max(0,s.dHits-s.nHits)), backgroundColor:"rgba(140,86,0,.35)", borderRadius:4, borderSkipped:false },
                ]
              }} options={{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{grid:{display:false},ticks:{color:"#9a9088",font:{size:9}}}, y:{grid:{color:"#f0ebe4"},ticks:{color:"#9a9088",font:{size:9},stepSize:1,precision:0}} } }}/>
            </div>
          </div>
          <div className="card">
            <div className="ctit mb12"><span className="ctit-dot blue"/>Files per Measure (Numerator)</div>
            <div style={{ height:220 }}>
              <Bar data={{
                labels: stats.map(s=>s.id),
                datasets:[{ data:stats.map(s=>s.nHits), backgroundColor:"#1a5fa8", borderRadius:4 }]
              }} options={{ responsive:true, maintainAspectRatio:false, indexAxis:"y", plugins:{legend:{display:false}}, scales:{ x:{grid:{color:"#f0ebe4"},ticks:{color:"#9a9088",font:{size:9},stepSize:1,precision:0}}, y:{grid:{display:false},ticks:{color:"#5a5248",font:{size:9}}} } }}/>
            </div>
          </div>
        </div>
      )}

      {/* measure cards */}
      <div className="sec-lbl">HEDIS Measure Impact — Click any card for file detail</div>
      <div className="g3 mb18">
        {stats.map((s,i) => {
          const pct = s.dHits > 0 ? Math.round(s.nHits/s.dHits*100) : 0;
          const cls = pct >= 70 ? "hit" : pct > 0 ? "partial" : "gap";
          return (
            <div key={i} className={`hcard ${cls}`} style={{ cursor:"pointer" }} onClick={() => showHEDISDetail(s.id)}>
              {s.cat && <span className="hcat">{s.cat}</span>}
              <div className="hcard-id">{s.id}</div>
              <div className="hcard-name">{s.name}</div>
              <div className="hcard-stat">
                <div><div className="hcard-num">{s.nHits}</div><div className="hcard-lbl">Numerator</div></div>
                <div style={{ textAlign:"right" }}>
                  <div className="hcard-num" style={{ fontSize:16 }}>{s.dHits}</div>
                  <div className="hcard-lbl">Denominator</div>
                  {s.exclHits > 0 && <div style={{ fontSize:9, color:"var(--red)", marginTop:2 }}>{s.exclHits} excluded</div>}
                </div>
              </div>
              <div className="hcard-bar"><div className="hcard-fill" style={{ width:`${pct}%` }}/></div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span className="hcard-pct">{pct}% gap closure</span>
                <span style={{ fontSize:9, color:"var(--muted)" }}>{s.numerCodeCt} VS codes · click →</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* evidence per file — fli pattern matching original */}
      <div className="card">
        <div className="ctit mb12"><span className="ctit-dot green"/>CCDAs with HEDIS Evidence</div>
        <div>
          {results.filter(r=>(r.hedis||[]).length>0).map((r,i) => (
            <div key={i} className="fli" style={{ cursor:"pointer" }} onClick={() => showFileHEDIS(r.name)}>
              <div className="fli-ico" style={{ background:"var(--greenbg)" }}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="#1a6b44"><path d="M1 6l3 3 7-7"/></svg>
              </div>
              <span className="fli-name" style={{ fontFamily:"var(--font)" }}>{r.name}</span>
              <span style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
                {(r.hedis||[]).map((h,j) => (
                  <span key={j} className={`tag ${h.numer_hit?"tg":h.exclusion_hit?"tr":"ta"}`}
                    title={h.numer_hit?"Numerator":h.exclusion_hit?"Excluded":"Denom only"}>
                    {h.id}
                  </span>
                ))}
              </span>
            </div>
          ))}
          {!results.some(r=>(r.hedis||[]).length>0) && (
            <div style={{ color:"var(--muted)", fontSize:12, padding:12 }}>No HEDIS evidence found in batch.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOINC PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function LoincPanel({ results, openModal }) {
  if (!results?.length) return (
    <EmptyState icon={<><circle cx="26" cy="26" r="20" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M26 16v10l6 6M16 26h20M26 16v20" stroke="currentColor" strokeWidth="1.2" opacity=".6"/></>}
      title="No LOINC data yet" sub="Analyze CCDA files to see LOINC code coverage and lab result mapping."/>
  );

  const [loincFilter, setLoincFilter] = useState("");
  const _lf = loincFilter.trim().toLowerCase();

  const withR = results.filter(r => r.loinc?.has_results).length;
  const noRes = results.filter(r => r.loinc?.has_loinc_no_results).length;
  const noL   = results.filter(r => !(r.loinc?.count||0)).length;

  const freq = {};
  for (const r of results) for (const c of (r.loinc?.codes||[])) freq[c] = (freq[c]||0)+1;
  const topLoinc = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,10);

  function exportLoincCsv() {
    const header = ["File Name", "LOINC Code", "Lab Result Value", "With Lab Results", "Without Lab Results"];
    const rows = [header];
    for (const r of results) {
      const codes = r.loinc?.codes || [];
      if (!codes.length) continue;
      const cr = r.loinc?.code_results || {};
      for (const code of codes) {
        const vals = cr[code];
        const hasVal = vals && vals.length > 0;
        const valStr = hasVal ? vals.map(v => v.value + (v.unit ? " " + v.unit : "")).join("; ") : "No Value";
        rows.push([r.name, code, valStr, hasVal ? "Yes" : "No", hasVal ? "No" : "Yes"]);
      }
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "loinc_analysis.csv";
    a.click();
  }

  async function exportLoincSummary() {
    const pct = (n, d) => d ? (n / d * 100).toFixed(1) + "%" : "0%";
    const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

    // ── compute data ─────────────────────────────────────────
    let batchTotal = 0, batchWith = 0;
    const fileData = [];
    for (const r of results) {
      const total = r.loinc?.count || 0;
      const cr    = r.loinc?.code_results || {};
      const withV = (r.loinc?.codes || []).filter(c => cr[c]?.length > 0).length;
      batchTotal += total;
      batchWith  += withV;
      fileData.push([r.name, total, pct(total - withV, total), pct(withV, total)]);
    }
    const batchWithout = batchTotal - batchWith;

    // ── cell / row helpers ────────────────────────────────────
    // Style indices (styles.xml): 1=green header, 2=bold+border, 3=normal+border
    const strCell = (ref, val, s) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${esc(val)}</t></is></c>`;
    const numCell = (ref, val, s) => `<c r="${ref}" s="${s}"><v>${val}</v></c>`;
    const col     = i => "ABCDEFGHIJ"[i];

    const sheetRows = [], merges = [];
    let rn = 1;

    const addHeaderRow = (title, nCols) => {
      let cells = strCell(`A${rn}`, title, 1);
      for (let i = 1; i < nCols; i++) cells += strCell(`${col(i)}${rn}`, "", 1);
      sheetRows.push(`<row r="${rn}">${cells}</row>`);
      merges.push(`<mergeCell ref="A${rn}:${col(nCols-1)}${rn}"/>`);
      rn++;
    };
    const addColRow = labels => {
      sheetRows.push(`<row r="${rn}">${labels.map((l,i) => strCell(`${col(i)}${rn}`, l, 2)).join("")}</row>`);
      rn++;
    };
    const addDataRow = vals => {
      sheetRows.push(`<row r="${rn}">${vals.map((v,i) => typeof v === "number"
        ? numCell(`${col(i)}${rn}`, v, 3)
        : strCell(`${col(i)}${rn}`, v, 3)).join("")}</row>`);
      rn++;
    };
    const addBlank = () => { sheetRows.push(`<row r="${rn++}"/>`); };

    // Section 1 — Batch (3 cols)
    addHeaderRow("LOINC Summary by Batch", 3);
    addColRow(["Total LOINC Codes", "% Without Lab Result", "% With Lab Result"]);
    addDataRow([batchTotal, pct(batchWithout, batchTotal), pct(batchWith, batchTotal)]);
    addBlank();

    // Section 2 — By File (4 cols)
    addHeaderRow("LOINC Summary by File", 4);
    addColRow(["File", "Total LOINC Codes", "% Without Lab Result", "% With Lab Result"]);
    for (const [name, total, pctWout, pctWit] of fileData) addDataRow([name, total, pctWout, pctWit]);

    // ── XLSX XML ──────────────────────────────────────────────
    const mergeCellsXml = merges.length ? `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>` : "";
    const xml = {
      "[Content_Types].xml":
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
      "_rels/.rels":
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      "xl/_rels/workbook.xml.rels":
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
      "xl/workbook.xml":
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="LOINC Summary" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
      "xl/styles.xml":
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF70AD47"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color auto="1"/></left>
      <right style="thin"><color auto="1"/></right>
      <top style="thin"><color auto="1"/></top>
      <bottom style="thin"><color auto="1"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
  </cellXfs>
</styleSheet>`,
      "xl/worksheets/sheet1.xml":
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="42" customWidth="1"/>
    <col min="2" max="2" width="20" customWidth="1"/>
    <col min="3" max="3" width="24" customWidth="1"/>
    <col min="4" max="4" width="24" customWidth="1"/>
  </cols>
  <sheetData>${sheetRows.join("")}</sheetData>
  ${mergeCellsXml}
</worksheet>`,
    };

    // ── pack ZIP ──────────────────────────────────────────────
    const zip = new JSZip();
    for (const [path, content] of Object.entries(xml)) zip.file(path, content);
    const blob = await zip.generateAsync({ type:"blob", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "loinc_summary.xlsx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const showDetail = (r, filter) => {
    const cr  = r.loinc?.code_results    || {};
    const cdm = r.loinc?.code_display_map || {};
    const filteredCodes = (r.loinc?.codes || []).filter(c => {
      const hasVal = cr[c] && cr[c].length > 0;
      if (filter === "with")    return hasVal;
      if (filter === "without") return !hasVal;
      return true;
    });
    openModal(`LOINC — ${r.name}`, (
      <div>
        <div className="m-row"><span className="m-lbl">Unique LOINC codes</span><span className="m-val">{r.loinc?.count||0}</span></div>
        <div className="m-row"><span className="m-lbl">Lab result values</span><span>{r.loinc?.has_results ? <span className="badge bh">Present</span> : <span className="badge bl">Absent</span>}</span></div>
        <div className="sdiv"/>
        <div className="sec-lbl">LOINC Codes &amp; Result Values</div>
        {filteredCodes.length
          ? filteredCodes.map((c, i) => {
              const vals = cr[c];
              const displayName = cdm[c] || LOINC_NAMES[c] || "—";
              const resultCell = vals && vals.length > 0
                ? vals.map((v, vi) => (
                    <span key={vi} className="badge bh" style={{ marginLeft: 4 }}>{v.value}{v.unit ? " " + v.unit : ""}</span>
                  ))
                : <span className="badge bl">No value</span>;
              return (
                <div key={i} className="m-row">
                  <span className="badge btg">{c}</span>
                  <span className="m-val" style={{ flex:1, margin:"0 10px" }}>{displayName}</span>
                  <span style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:3 }}>{resultCell}</span>
                </div>
              );
            })
          : <div style={{ color:"var(--muted)" }}>None</div>}
      </div>
    ));
  };

  return (
    <div>
      <div className="g3 mb18">
        <MetCard cls="g sm" label="LOINC + Results" val={withR} sub={`${Math.round(withR/results.length*100)}% with values`}/>
        <MetCard cls="a sm" label="LOINC, No Values" val={noRes} sub={`${Math.round(noRes/results.length*100)}% codes only`}/>
        <MetCard cls="b sm" label="No LOINC At All" val={noL} sub={`${Math.round(noL/results.length*100)}% missing`}/>
      </div>

      <div className="g2 mb18">
        <div className="card">
          <div className="ctit mb12"><span className="ctit-dot"/>LOINC Coverage Breakdown</div>
          <div style={{ height:200 }}>
            <Doughnut data={{
              labels:[`LOINC+Results (${withR})`,`LOINC only (${noRes})`,`No LOINC (${noL})`],
              datasets:[{ data:[withR,noRes,noL], backgroundColor:["#1a6b44","#8c5600","#d63b10"], borderWidth:0 }]
            }} options={{ responsive:true, maintainAspectRatio:false, cutout:"62%", plugins:{legend:{position:"bottom", labels:{font:{size:10}}}} }}/>
          </div>
        </div>
        <div className="card">
          <div className="ctit mb12"><span className="ctit-dot blue"/>Top LOINC Codes by Frequency</div>
          <div style={{ height:200 }}>
            <Bar data={{
              labels: topLoinc.map(([c]) => LOINC_NAMES[c]||c),
              datasets:[{ data:topLoinc.map(([,n])=>n), backgroundColor:"rgba(26,95,168,.7)", borderRadius:3 }]
            }} options={{ responsive:true, maintainAspectRatio:false, indexAxis:"y", plugins:{legend:{display:false}}, scales:{ x:{ grid:{color:"#f0ebe4"}, ticks:{color:"#9a9088",font:{size:9},stepSize:1,precision:0} }, y:{ grid:{display:false}, ticks:{color:"#5a5248",font:{size:9}} } } }}/>
          </div>
        </div>
      </div>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <div style={{ position:"relative" }}>
          <svg style={{ position:"absolute", left:8, top:"50%", transform:"translateY(-50%)", pointerEvents:"none", color:"var(--text2)" }}
            width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5L14 14"/>
          </svg>
          <input className="ifield" value={loincFilter} onChange={e=>setLoincFilter(e.target.value)}
            placeholder="Filter by file name…"
            style={{ paddingLeft:28, width:220, margin:0, fontSize:12 }}/>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button className="btn btn-s" onClick={exportLoincSummary}
            style={{ display:"flex", alignItems:"center", gap:6, fontSize:12 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2h9l3 3v9H2V2zm9 0v3h3M5 9h6M8 6v6"/>
            </svg>
            LOINC_Summary
          </button>
          <button className="btn btn-s" onClick={exportLoincCsv}
            style={{ display:"flex", alignItems:"center", gap:6, fontSize:12 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2h9l3 3v9H2V2zm9 0v3h3M5 9h6M8 6v6"/>
            </svg>
            LOINC_Details
          </button>
        </div>
      </div>

      <div className="g2">
        <div className="card-flush">
          <div className="chead">
            <span className="ctit"><span className="ctit-dot green"/>With Lab Results</span>
            <span className="badge bh">{withR} files</span>
          </div>
          <div className="cbody" style={{ maxHeight:340, overflowY:"auto" }}>
            {results.filter(r=>r.loinc?.has_results && (!_lf || r.name.toLowerCase().includes(_lf))).map((r,i) => (
              <div key={i} className="lb has" onClick={()=>showDetail(r,"with")} style={{ cursor:"pointer" }}>
                <div className="lb-ico">✓</div>
                <span className="lb-name">{r.name}</span>
                <span className="lb-cnt">{r.loinc?.count||0} codes</span>
              </div>
            ))}
            {!results.filter(r=>r.loinc?.has_results && (!_lf || r.name.toLowerCase().includes(_lf))).length && <div style={{ color:"var(--muted)", padding:"12px", fontSize:12 }}>{_lf ? "No matches" : "None"}</div>}
          </div>
        </div>
        <div className="card-flush">
          <div className="chead">
            <span className="ctit"><span className="ctit-dot amber"/>LOINC, No Result Values</span>
            <span className="badge bm">{noRes} files</span>
          </div>
          <div className="cbody" style={{ maxHeight:340, overflowY:"auto" }}>
            {results.filter(r=>r.loinc?.has_loinc_no_results && (!_lf || r.name.toLowerCase().includes(_lf))).map((r,i) => (
              <div key={i} className="lb nores" onClick={()=>showDetail(r,"without")} style={{ cursor:"pointer" }}>
                <div className="lb-ico">!</div>
                <span className="lb-name">{r.name}</span>
                <span className="lb-cnt">{r.loinc?.count||0} codes</span>
              </div>
            ))}
            {!results.filter(r=>r.loinc?.has_loinc_no_results && (!_lf || r.name.toLowerCase().includes(_lf))).length && <div style={{ color:"var(--muted)", padding:"12px", fontSize:12 }}>{_lf ? "No matches" : "None"}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// NARRATIVE PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function highlightNarr(text) {
  const s = (text||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return s
    .replace(/\b(\d+\.?\d*\s*(mg\/dL|mmol\/L|g\/dL|mEq\/L|%|IU\/L|ng\/mL|mmHg|bpm|kg\/m2))\b/gi, '<mark class="narr-highlight">$1</mark>')
    .replace(/\b(HbA1c|A1C|LDL|HDL|eGFR|BMI|TSH|PSA|INR|CBC|BMP|CMP)\b/gi, '<mark class="narr-highlight">$1</mark>');
}

function NarrativePanel({ results, openModal }) {
  const [narrFile, setNarrFile] = useState(0);
  const [narrSec, setNarrSec] = useState(null);
  const [tab, setTab] = useState("raw");
  const [gapVerifications, setGapVerifications] = useState({});  // key: `${narrFile}:${sectionKey}`
  const [verifyingKey, setVerifyingKey] = useState(null);

  // Global stats — computed from ALL results, never change when clicking a file
  const hasNarr     = (results||[]).filter(x=>(x.narrative?.total_words||0)>0).length;
  const totalSecs   = (results||[]).reduce((a,x)=>a+(x.narrative?.total_sections||0),0);
  const totalWords  = (results||[]).reduce((a,x)=>a+(x.narrative?.total_words||0),0);
  const narrOnly    = (results||[]).reduce((a,x)=>a+(x.narrative?.narrative_only_findings||0),0);
  const allTokCount = (results||[]).reduce((a,x)=>a+(x.narrative?.all_tokens?.length||0),0);

  // Per-file / per-section data
  const r = results?.[narrFile];
  const narr = r?.narrative || {};
  const sections = narr.sections || {};
  const secKeys = Object.keys(sections);
  const activeSec = narrSec ?? (secKeys[0]||null);
  const secData = activeSec ? (sections[activeSec]||{}) : {};

  const FINDING_ICONS = { neg:"✗", lab:"⊕", med:"℞", social:"♦", proc:"⚕", clinical:"·" };
  const TOKEN_CLS = { lab:"tk-lab", med:"tk-med", cond:"tk-cond", neg:"tk-neg", proc:"tk-val", social:"tk-val" };
  const TOKEN_LBL = { lab:"Lab / Value", med:"Medication", cond:"Condition", neg:"Negation", proc:"Procedure", social:"Social" };

  if (!results?.length) return (
    <EmptyState title="No narrative data yet"
      sub="Load and analyze CCDA files to extract free-text provider notes."/>
  );

  async function verifyGaps(sectionKey, gaps, sectionLabel) {
    const key = `${narrFile}:${sectionKey}`;
    setVerifyingKey(key);
    try {
      const coded_display = r?.narrative?.coded_display || [];
      const resp = await fetch("http://localhost:8100/api/ccda/narrative/verify-gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gaps, coded_display, section_label: sectionLabel }),
      });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.detail || resp.statusText); }
      const data = await resp.json();
      setGapVerifications(prev => ({ ...prev, [key]: data.verified }));
    } catch(e) {
      alert("Verification failed: " + e.message);
    } finally {
      setVerifyingKey(null);
    }
  }

  function showNarrGapsModal(r2) {
    const secs = r2.narrative?.sections || {};
    const hasGaps = Object.values(secs).some(s => (s.gaps||[]).length > 0);
    openModal(`Struct. Gaps — ${r2.name}`, hasGaps
      ? (
        <div>
          {Object.entries(secs).map(([k, s]) => {
            const gaps = s.gaps || [];
            if (!gaps.length) return null;
            return (
              <div key={k} className="narr-gap-card has-gap mb12">
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                  <span className="narr-sec-chip">{s.lbl || k}</span>
                  <span className="narr-only-badge">⚠ {gaps.length} narrative-only</span>
                </div>
                <div style={{ fontSize:11, color:"var(--muted)", marginBottom:10 }}>
                  These findings appear in the narrative but have <strong>no matching coded entry</strong> in the structured data:
                </div>
                {gaps.map((g, gi) => (
                  <div key={gi} className={`narr-finding ${g.cls||"f-note"}`} style={{ marginBottom:6 }}>
                    <div className="narr-finding-text">
                      <div className="narr-finding-type">{g.type_label||g.type}</div>
                      {g.text}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )
      : (
        <div className="iss-none-ok" style={{ marginBottom:0 }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="var(--green)" style={{ marginRight:6 }}><path d="M2 8l4 4 8-8"/></svg>
          No structural gaps detected — narrative mentions align with coded entries.
        </div>
      )
    );
  }

  function TabBtn({ id, label }) {
    return (
      <button onClick={() => setTab(id)} style={{
        flex:1, padding:"9px 8px", fontSize:11, fontWeight:700, cursor:"pointer",
        border:"none",
        color: tab===id ? "#7c3cb8" : "var(--muted)",
        borderLeft: id!=="raw" ? "1px solid var(--border)" : "none",
        fontFamily:"var(--font)",
        background: tab===id ? "var(--white)" : "transparent",
        transition:".15s",
      }}>{label}</button>
    );
  }

  return (
    <div>
      {/* Global stats bar — never changes on file click */}
      <div className="g5 mb18">
        <div className="narr-summary-stat"><div className="narr-summary-val">{hasNarr}</div><div className="narr-summary-lbl">Files w/ Narrative</div></div>
        <div className="narr-summary-stat"><div className="narr-summary-val">{totalSecs}</div><div className="narr-summary-lbl">Narrative Sections</div></div>
        <div className="narr-summary-stat"><div className="narr-summary-val">{totalWords.toLocaleString()}</div><div className="narr-summary-lbl">Total Words</div></div>
        <div className="narr-summary-stat"><div className="narr-summary-val" style={{color:"var(--red)"}}>{narrOnly}</div><div className="narr-summary-lbl">Struct. Gaps Found</div></div>
        <div className="narr-summary-stat"><div className="narr-summary-val" style={{color:"var(--green)"}}>{allTokCount}</div><div className="narr-summary-lbl">Clinical Tokens</div></div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"220px 1fr", gap:16, alignItems:"start" }}>
        {/* Left: file + section picker */}
        <div>
          <div className="card-flush mb12">
            <div className="chead"><span className="ctit"><span className="ctit-dot" style={{ background:C.purple }}/>Files</span></div>
            <div style={{ padding:8, maxHeight:230, overflowY:"auto" }}>
              {results.map((r2,i) => {
                const wds = r2.narrative?.total_words||0;
                return (
                  <div key={i} className={`narr-file-btn${narrFile===i?" on":""}`}
                    onClick={() => { setNarrFile(i); setNarrSec(null); }}>
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="currentColor" style={{ flexShrink:0, opacity:.6 }}><path d="M2 1h7l3 3v9H2V1zm6 0v3h3"/></svg>
                    <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontSize:11 }}>{r2.name.replace(/\.xml$/i,"")}</span>
                    <span className="narr-sec-badge">{wds > 0 ? wds+"w" : "—"}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card-flush">
            <div className="chead"><span className="ctit"><span className="ctit-dot blue"/>Sections</span></div>
            <div style={{ padding:8, maxHeight:260, overflowY:"auto" }}>
              {secKeys.length === 0 && <div style={{ fontSize:11, color:"var(--muted)", padding:8 }}>No narrative text found in this file.</div>}
              {secKeys.map((k,i) => (
                <div key={i} className={`narr-sec-btn${activeSec===k?" on":""}`} onClick={() => setNarrSec(k)}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ flexShrink:0, opacity:.5 }}><rect width="10" height="10" rx="2"/></svg>
                  <span style={{ flex:1, fontSize:11 }}>{sections[k]?.lbl || k}</span>
                  <span className="narr-sec-badge">{sections[k]?.words||0}w</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: tabs + viewer */}
        <div>
          <div style={{ display:"flex", gap:0, border:"1px solid var(--border)", borderRadius:8, overflow:"hidden", marginBottom:14, background:"var(--paper)" }}>
            <TabBtn id="raw"     label="Raw Text"/>
            <TabBtn id="extract" label="Extracted Findings"/>
            <TabBtn id="gaps"    label="Struct. Gaps"/>
            <TabBtn id="xfile"   label="Cross-File"/>
          </div>

          <div className="narr-viewer">
            <div className="narr-viewer-hdr">
              <span className="ctit" style={{ fontSize:12 }}>
                <span className="ctit-dot" style={{ background: tab==="xfile" ? C.blue : C.purple }}/>
                {tab==="raw"?"Narrative Block — Raw Text":tab==="extract"?"Extracted Clinical Findings":tab==="gaps"?"Narrative → Structured Gaps":"Cross-File Narrative Summary"}
              </span>
              {tab==="raw" && activeSec && secData.raw_text && (
                <button className="btn btn-s btn-xs"
                  onClick={() => navigator.clipboard?.writeText(secData.raw_text||"")}>Copy</button>
              )}
              {tab==="xfile" && (
                <button className="btn btn-s btn-xs" onClick={() => {
                  const rows = [["File","Words","Sections","Struct Gaps","Total Tokens","Top Lab Tokens","Top Condition Tokens"]];
                  for (const res2 of results) {
                    const n2 = res2.narrative||{};
                    const tg = Object.values(n2.sections||{}).reduce((a,s)=>a+(s.gaps||[]).length,0);
                    const labs = (n2.all_tokens||[]).filter(t=>t.type==="lab").map(t=>t.val).slice(0,5).join(";");
                    const conds = (n2.all_tokens||[]).filter(t=>t.type==="cond").map(t=>t.val).slice(0,5).join(";");
                    rows.push([res2.name, n2.total_words||0, n2.total_sections||0, tg, (n2.all_tokens||[]).length, labs, conds]);
                  }
                  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
                  const a = document.createElement("a");
                  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
                  a.download = "narrative_crossfile.csv";
                  a.click();
                }}>Export CSV</button>
              )}
            </div>
            <div className="narr-viewer-body">
              {tab==="raw" && (
                activeSec && secData.raw_text
                  ? <div>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14, flexWrap:"wrap" }}>
                        <span className="narr-sec-chip">{secData.lbl || activeSec}</span>
                        <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"var(--mono)" }}>
                          {secData.words} words · {(secData.findings||[]).length} findings · {(secData.tokens||[]).length} tokens
                        </span>
                      </div>
                      <div className="narr-text-block" dangerouslySetInnerHTML={{ __html: highlightNarr(secData.raw_text) }}/>
                    </div>
                  : <div className="empty" style={{ padding:30 }}><div className="empty-s">Select a file and section to view narrative text.</div></div>
              )}
              {tab==="extract" && (
                activeSec
                  ? (secData.findings||[]).length > 0
                    ? (secData.findings||[]).map((f,i) => (
                        <div key={i} className={`narr-finding ${f.cls||"f-note"}`}>
                          <div className="narr-finding-ico">{FINDING_ICONS[f.type]||"·"}</div>
                          <div className="narr-finding-text">
                            <div className="narr-finding-type">{f.type_label||f.type}</div>
                            {f.text}
                          </div>
                        </div>
                      ))
                    : <div className="empty" style={{ padding:30 }}><div className="empty-s">No structured findings extracted from this section's narrative.</div></div>
                  : <div className="empty" style={{ padding:30 }}><div className="empty-s">Select a file and section.</div></div>
              )}
              {tab==="gaps" && (
                r?.narrative
                  ? (() => {
                      const secs = r.narrative.sections || {};
                      const hasGaps = Object.values(secs).some(s=>(s.gaps||[]).length>0);
                      if (!hasGaps) return (
                        <div className="iss-none-ok">
                          <svg width="15" height="15" viewBox="0 0 16 16" fill="var(--green)" style={{ marginRight:6 }}><path d="M2 8l4 4 8-8"/></svg>
                          No structural gaps detected — narrative mentions align with coded entries.
                        </div>
                      );
                      return (
                        <div>
                          {Object.entries(secs).map(([k,s]) => {
                            const gaps = s.gaps||[];
                            if (!gaps.length) return (
                              <div key={k} className="narr-gap-card no-gap">
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <span className="narr-sec-chip">{s.lbl||k}</span>
                                  <span style={{ fontSize:11, color:"var(--green)", fontWeight:600 }}>✓ No gaps</span>
                                </div>
                              </div>
                            );
                            {
                              const vkey = `${narrFile}:${k}`;
                              const verified = gapVerifications[vkey];
                              const isVerifying = verifyingKey === vkey;
                              const VERDICT_STYLE = {
                                genuine_gap:   { bg:"#fde8e8", color:"#b91c1c", label:"Genuine Gap" },
                                false_positive:{ bg:"#dcfce7", color:"#15803d", label:"False Positive" },
                                noise:         { bg:"#f3f4f6", color:"#6b7280", label:"Noise" },
                              };
                              return (
                                <div key={k} className="narr-gap-card has-gap">
                                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, flexWrap:"wrap" }}>
                                    <span className="narr-sec-chip">{s.lbl||k}</span>
                                    <span className="narr-only-badge">⚠ {gaps.length} narrative-only</span>
                                    {verified && (
                                      <>
                                        <span style={{ fontSize:10, color:"#15803d", fontWeight:700 }}>
                                          ✓ {verified.filter(v=>v.verdict==="genuine_gap").length} genuine
                                        </span>
                                        <span style={{ fontSize:10, color:"#6b7280" }}>
                                          · {verified.filter(v=>v.verdict==="false_positive").length} false positive
                                          · {verified.filter(v=>v.verdict==="noise").length} noise
                                        </span>
                                      </>
                                    )}
                                    <button className="btn btn-s btn-xs" style={{ marginLeft:"auto" }}
                                      disabled={isVerifying}
                                      onClick={() => verifyGaps(k, gaps, s.lbl||k)}>
                                      {isVerifying ? "Verifying…" : verified ? "Re-verify" : "✦ Verify with AI"}
                                    </button>
                                  </div>
                                  <div style={{ fontSize:11, color:"var(--muted)", marginBottom:10 }}>
                                    These findings appear in the narrative but have <strong>no matching coded entry</strong> in the structured data:
                                  </div>
                                  {(verified || gaps).map((g, gi) => {
                                    const vs = verified ? VERDICT_STYLE[g.verdict] || VERDICT_STYLE.genuine_gap : null;
                                    return (
                                      <div key={gi} className={`narr-finding ${g.cls||"f-note"}`} style={{ marginBottom:6, opacity: vs?.label==="Noise" ? 0.5 : 1 }}>
                                        <div className="narr-finding-text">
                                          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                                            <span className="narr-finding-type">{g.type_label||g.type}</span>
                                            {vs && (
                                              <span style={{ fontSize:9, fontWeight:700, padding:"1px 6px", borderRadius:3, background:vs.bg, color:vs.color }}>
                                                {vs.label}
                                              </span>
                                            )}
                                          </div>
                                          {g.text}
                                          {vs && g.reason && (
                                            <div style={{ fontSize:10, color:"var(--muted)", marginTop:3, fontStyle:"italic" }}>{g.reason}</div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            }
                          })}
                        </div>
                      );
                    })()
                  : <div className="empty" style={{ padding:30 }}><div className="empty-s">Select a file to see gap analysis.</div></div>
              )}
              {tab==="xfile" && (
                <table className="tbl" style={{ fontSize:11 }}>
                  <thead><tr>
                    <th>File</th><th>Words</th><th>Sections</th><th>Struct. Gaps</th><th>Tokens</th><th>Top Entities</th>
                  </tr></thead>
                  <tbody>
                    {results.map((r2,i) => {
                      const n = r2.narrative||{};
                      const totalGaps = Object.values(n.sections||{}).reduce((a,s)=>a+(s.gaps||[]).length,0);
                      const topToks = (n.all_tokens||[]).filter(t=>t.type==="lab"||t.type==="cond").slice(0,4);
                      return (
                        <tr key={i} className="xr">
                          <td><span className="fn">{r2.name}</span></td>
                          <td style={{ fontFamily:"var(--mono)" }}>{(n.total_words||0).toLocaleString()}</td>
                          <td style={{ fontFamily:"var(--mono)" }}>{n.total_sections||0}</td>
                          <td>{totalGaps>0?<span className="badge bl" style={{ cursor:"pointer" }} onClick={()=>showNarrGapsModal(r2)}>{totalGaps} gaps</span>:<span className="badge bh">Clean</span>}</td>
                          <td style={{ fontFamily:"var(--mono)" }}>{(n.all_tokens||[]).length}</td>
                          <td style={{ maxWidth:260 }}>
                            {topToks.length > 0
                              ? <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                                  {topToks.map((t,ti) => (
                                    <span key={ti} className={`narr-token ${t.type==="lab"?"tk-lab":"tk-cond"}`}>{t.val}</span>
                                  ))}
                                </div>
                              : <span style={{ color:"var(--muted)", fontSize:11 }}>—</span>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FHIR PANEL
// ═══════════════════════════════════════════════════════════════════════════════
const _FHIR_TYPES = [
  { t:"all",                lbl:"All Resources",      col:"#0d7a5c" },
  { t:"Patient",            lbl:"Patient",             col:"var(--blue)" },
  { t:"Condition",          lbl:"Conditions",          col:"var(--red)" },
  { t:"MedicationRequest",        lbl:"Med Requests",    col:"var(--amber)" },
  { t:"MedicationAdministration", lbl:"Med Admins",      col:"#d97706" },
  { t:"AllergyIntolerance", lbl:"Allergies",           col:"#7c3cb8" },
  { t:"Observation",        lbl:"Observations",        col:"#0d7a5c" },
  { t:"Encounter",          lbl:"Encounters",          col:"var(--green)" },
  { t:"Procedure",          lbl:"Procedures",          col:"var(--blue)" },
  { t:"Immunization",       lbl:"Immunizations",       col:"var(--amber)" },
  { t:"Practitioner",       lbl:"Practitioners",       col:"#1a6fa8" },
  { t:"Organization",       lbl:"Organizations",       col:"#2e7d32" },
  { t:"PractitionerRole",   lbl:"Practitioner Roles",  col:"#6a1550" },
];

function fhirResLabel(r) {
  switch (r.resourceType) {
    case "Patient":           return ([...(r.name?.[0]?.given||[])].join(" ") + " " + (r.name?.[0]?.family||"")).trim() || "(no name)";
    case "Condition":         return r.code?.text || r.code?.coding?.[0]?.display || "Condition";
    case "MedicationRequest":        return r.medicationCodeableConcept?.text || r.medicationCodeableConcept?.coding?.[0]?.display || "Medication";
    case "MedicationAdministration": return r.medicationCodeableConcept?.text || r.medicationCodeableConcept?.coding?.[0]?.display || "Med Admin";
    case "AllergyIntolerance":return r.code?.text || r.code?.coding?.[0]?.display || "Allergy";
    case "Observation":       return r.code?.text || r.code?.coding?.[0]?.display || "Observation";
    case "Encounter":         return r.type?.[0]?.text || r.period?.start || "Encounter";
    case "Procedure":         return r.code?.text || r.code?.coding?.[0]?.display || "Procedure";
    case "Immunization":      return r.vaccineCode?.text || r.vaccineCode?.coding?.[0]?.display || "Immunization";
    case "Practitioner":      return ([...(r.name?.[0]?.given||[])].join(" ") + " " + (r.name?.[0]?.family||"")).trim() || r.identifier?.[0]?.value || "Practitioner";
    case "Organization":      return r.name || r.identifier?.[0]?.value || "Organization";
    case "PractitionerRole":  return r.code?.[0]?.coding?.[0]?.display || r.practitioner?.reference || "PractitionerRole";
    default:                  return r.resourceType;
  }
}

function highlightJSON(obj) {
  const raw = JSON.stringify(obj, null, 2);
  const s = raw.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return s.replace(/("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
    if (/^"/.test(m)) return /:$/.test(m) ? `<span class="fjk">${m}</span>` : `<span class="fjstr">${m}</span>`;
    if (/true|false/.test(m)) return `<span class="fjbool">${m}</span>`;
    if (/null/.test(m)) return `<span class="fjnull">${m}</span>`;
    return `<span class="fjnum">${m}</span>`;
  });
}

function FhirPanel({ fhirBundles }) {
  const [fhirFile, setFhirFile] = useState(0);
  const [fhirType, setFhirType] = useState("all");
  const [fhirRes, setFhirRes] = useState(null);
  const [zipping, setZipping] = useState(false);

  // derive these before early return so useEffect can run unconditionally
  const bundle = fhirBundles?.[fhirFile];
  const entries = bundle?.entry || [];
  const counts = bundle?._counts || {};
  const filteredRes = fhirType === "all" ? entries : entries.filter(e=>e.resource?.resourceType===fhirType);
  const totals = (fhirBundles||[]).reduce((acc,b) => acc + (b._counts?.total||0), 0);
  const sumBy = t => (fhirBundles||[]).reduce((a,b) => a + (b._counts?.[t]||0), 0);

  // auto-select first resource whenever bundle or filter changes — must be before early return
  useEffect(() => {
    setFhirRes(filteredRes.length > 0 ? 0 : null);
  }, [fhirFile, fhirType, fhirBundles]);

  if (!fhirBundles?.length) return (
    <EmptyState icon={<><rect x="8" y="4" width="36" height="44" rx="4" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M16 16h20M16 22h20M16 28h14M16 34h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></>}
      title="No FHIR data yet"
      sub='Load CCDA files via Data Ingestion and click Execute Workflow — FHIR R4 bundles will be built automatically.'/>
  );

  function _fhirClean(b) { const o = {...b}; delete o._counts; delete o._source_file; return o; }
  function _fhirUUID() { return crypto.randomUUID(); }

  function downloadBundle(b, fname) {
    const blob = new Blob([JSON.stringify(b, null, 2)], { type:"application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = fname || "fhir-bundle.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function fhirExportSelected() {
    if (!bundle) return;
    const out = _fhirClean(bundle);
    if (fhirType !== "all") out.entry = bundle.entry.filter(e => e.resource?.resourceType === fhirType);
    const fname = (bundle._source_file || "bundle").replace(/\.xml$/i, "") + "-fhir.json";
    downloadBundle(out, fname);
  }

  function fhirExportMega() {
    const allEntries = fhirBundles.flatMap(b => b.entry || []);
    downloadBundle({
      resourceType:"Bundle", id:_fhirUUID(), type:"collection",
      timestamp: new Date().toISOString(),
      meta:{ tag:[{ system:"http://example.org/ccda-ai", code:"ccda-batch", display:"CCDA Batch Conversion" }] },
      entry: allEntries
    }, "ccda-all-fhir-bundle.json");
  }

  async function fhirExportZip() {
    setZipping(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder("fhir-bundles");
      let n = 0;
      for (const b of fhirBundles) {
        const name = (b._source_file || "bundle").replace(/\.xml$/i, "");
        folder.file(name + "-fhir.json", JSON.stringify(_fhirClean(b), null, 2));
        n++;
      }
      zip.file("mega-bundle-all-files.json", JSON.stringify({
        resourceType:"Bundle", id:_fhirUUID(), type:"collection",
        timestamp: new Date().toISOString(),
        entry: fhirBundles.flatMap(b => b.entry || [])
      }, null, 2));
      zip.file("manifest.json", JSON.stringify({
        generated: new Date().toISOString(), files: n,
        totalResources: fhirBundles.reduce((a,b) => a+(b._counts?.total||0), 0),
        bundles: fhirBundles.map(b => ({ file: b._source_file, ...(b._counts||{}) }))
      }, null, 2));
      const blob = await zip.generateAsync({ type:"blob", compression:"DEFLATE", compressionOptions:{ level:6 } });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "ccda-fhir-export.zip"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch(e) { alert("ZIP error: " + e.message); } finally { setZipping(false); }
  }

  return (
    <div>
      {/* summary metrics — matches V15_29Apr.html fhir-metrics layout */}
      <div className="g5 mb18">
        <div className="met" style={{ borderLeft:"3px solid #0d7a5c" }}>
          <div className="met-lbl">Total Resources</div>
          <div className="met-val" style={{ color:"#0d7a5c" }}>{totals}</div>
          <div className="met-sub">{fhirBundles.length} bundle{fhirBundles.length!==1?"s":""}</div>
        </div>
        <MetCard cls="b" label="Conditions" val={sumBy("Condition")} sub="problems"/>
        <MetCard cls="a" label="Medications" val={sumBy("MedicationRequest")} sub="Rx orders"/>
        <MetCard cls="p" label="Allergies" val={sumBy("AllergyIntolerance")} sub="intolerances"/>
        <MetCard cls="g" label="Observations" val={sumBy("Observation")} sub="labs + vitals"/>
      </div>

      {/* export bar */}
      <div className="fhir-export-bar mb18">
        <span style={{ fontSize:11, fontWeight:700, color:"var(--text2)" }}>Export:</span>
        <button className="btn-fhir" onClick={fhirExportSelected}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2h7l3 3v9H3V2zm7 0v3h3"/></svg>
          Selected Bundle (JSON)
        </button>
        <button className="btn-fhir" onClick={fhirExportMega}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 5v6l7 4 7-4V5L8 1zm0 2.4L13 6 8 8.6 3 6 8 3.4zM2 7.9l5 2.8v5.1L2 13V7.9zm12 0V13l-5 2.8v-5.1l5-2.8z"/></svg>
          All Files · Mega Bundle
        </button>
        <button className="btn-fhir" onClick={fhirExportZip} disabled={zipping}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12v12H2V2zm4 5H4l4 3 4-3h-2V2H6v5z"/></svg>
          {zipping ? "Building ZIP…" : "All Files · ZIP"}
        </button>
        <span style={{ marginLeft:"auto", fontSize:10, color:"var(--muted)", fontFamily:"var(--mono)" }}>FHIR R4 · US Core profiles</span>
      </div>

      {/* 3-column browser */}
      <div style={{ display:"grid", gridTemplateColumns:"248px 1fr", gap:16, alignItems:"start" }}>
        <div>
          <div className="card-flush mb12">
            <div className="chead"><span className="ctit"><span className="ctit-dot" style={{ background:"#0d7a5c" }}/>Files</span></div>
            <div style={{ padding:8, maxHeight:220, overflowY:"auto" }}>
              {fhirBundles.map((b,i) => (
                <div key={i} className={`fhir-file-btn${fhirFile===i?" on":""}`}
                  onClick={() => { setFhirFile(i); setFhirType("all"); setFhirRes(null); }}>
                  <span style={{ width:7, height:7, borderRadius:"50%", background:"#0d7a5c", flexShrink:0, display:"inline-block" }}/>
                  <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontSize:11 }}>{b._source_file||`Bundle ${i+1}`}</span>
                  <span className="fhir-cnt">{b._counts?.total||0}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card-flush">
            <div className="chead"><span className="ctit"><span className="ctit-dot blue"/>Resource Types</span></div>
            <div style={{ padding:8 }}>
              {_FHIR_TYPES.map(({t, lbl, col}) => {
                const cnt = t === "all" ? (counts.total||entries.length) : (counts[t]||0);
                return (
                  <div key={t} className={`fhir-type-btn${fhirType===t?" on":""}`} onClick={() => { setFhirType(t); setFhirRes(null); }}>
                    <span style={{ width:7, height:7, borderRadius:"50%", background:col, flexShrink:0, display:"inline-block" }}/>
                    {lbl}
                    <span className="fhir-cnt">{cnt}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <div className="card-flush mb12" style={{ maxHeight:220, overflowY:"auto" }}>
            <div className="chead" style={{ position:"sticky", top:0, background:"var(--white)", zIndex:1 }}>
              <span className="ctit"><span className="ctit-dot green"/>Resources</span>
              <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"var(--mono)" }}>{filteredRes.length} resources</span>
            </div>
            {filteredRes.map((e,i) => {
              const res = e.resource||{};
              return (
                <div key={i} className={`fhir-res-row${fhirRes===i?" on":""}`} onClick={() => setFhirRes(fhirRes===i?null:i)}>
                  <span className={`fhir-rt rt-${res.resourceType}`}>{res.resourceType}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {fhirResLabel(res)}
                    </div>
                    <div className="fhir-res-id">{res.id||"—"}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="card-flush">
            <div className="chead">
              <span className="ctit"><span className="ctit-dot" style={{ background:"#0d7a5c" }}/>JSON Preview</span>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                {fhirRes !== null && filteredRes[fhirRes] && (
                  <span style={{ fontSize:10, fontFamily:"var(--mono)", color:"var(--muted)" }}>
                    {filteredRes[fhirRes]?.resource?.resourceType} · {(filteredRes[fhirRes]?.resource?.id||"").slice(0,8)}…
                  </span>
                )}
                {fhirRes !== null && filteredRes[fhirRes] && (
                  <button className="btn btn-s btn-xs" onClick={() => {
                    navigator.clipboard?.writeText(JSON.stringify(filteredRes[fhirRes]?.resource, null, 2));
                  }}>Copy</button>
                )}
              </div>
            </div>
            <div style={{ padding:0 }}>
              {fhirRes !== null && filteredRes[fhirRes]
                ? <pre className="fhir-json-view" dangerouslySetInnerHTML={{ __html: highlightJSON(filteredRes[fhirRes]?.resource||{}) }}/>
                : <pre className="fhir-json-view"><span style={{ color:"#555" }}>Select a file and resource to preview its FHIR JSON…</span></pre>
              }
            </div>
          </div>
        </div>
      </div>

      {/* summary table */}
      <div className="card-flush" style={{ marginTop:16 }}>
        <div className="chead"><span className="ctit"><span className="ctit-dot amber"/>Conversion Summary — All Files</span></div>
        <div style={{ overflowX:"auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>File</th><th>Patient</th><th>Conditions</th><th>Medications</th><th>Med Admins</th>
                <th>Allergies</th><th>Observations</th><th>Encounters</th>
                <th>Procedures</th><th>Immunizations</th><th>Total</th><th></th>
              </tr>
            </thead>
            <tbody>
              {fhirBundles.map((b,i) => {
                const c = b._counts||{};
                const fname = b._source_file||`bundle-${i+1}`;
                return (
                  <tr key={i}>
                    <td>
                      <span className="fn" style={{ cursor:"pointer" }}
                        onClick={() => { setFhirFile(i); setFhirType("all"); setFhirRes(null); }}>
                        {fname}
                      </span>
                    </td>
                    <td style={{ fontFamily:"var(--mono)", fontSize:11 }}>{c.Patient||0}</td>
                    <td style={{ fontFamily:"var(--mono)", fontSize:11 }}>{c.Condition||0}</td>
                    <td style={{ fontFamily:"var(--mono)", fontSize:11 }}>{c.MedicationRequest||0}</td>
                    <td style={{ fontFamily:"var(--mono)", fontSize:11 }}>{c.MedicationAdministration||0}</td>
                    <td style={{ fontFamily:"var(--mono)", fontSize:11 }}>{c.AllergyIntolerance||0}</td>
                    <td style={{ fontFamily:"var(--mono)", fontSize:11 }}>{c.Observation||0}</td>
                    <td style={{ fontFamily:"var(--mono)", fontSize:11 }}>{c.Encounter||0}</td>
                    <td style={{ fontFamily:"var(--mono)", fontSize:11 }}>{c.Procedure||0}</td>
                    <td style={{ fontFamily:"var(--mono)", fontSize:11 }}>{c.Immunization||0}</td>
                    <td><span className="badge bh">{c.total||0}</span></td>
                    <td>
                      <button className="btn btn-s btn-xs"
                        onClick={() => downloadBundle(b, `${fname.replace(/\.xml$/i,"")}-fhir.json`)}>
                        ↓ JSON
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function _sqlHighlight(s) {
  const kws = /\b(CREATE|TABLE|DATABASE|IF|NOT|EXISTS|INSERT|INTO|VALUES|USE|GO|SELECT|FROM|WHERE|INT|FLOAT|NVARCHAR|DATETIME2|IDENTITY|PRIMARY|KEY|DEFAULT|GETDATE|NULL)\b/g;
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(kws,'<span class="sql-schema-kw">$1</span>')
    .replace(/N'([^']*)'/g,'<span class="sql-schema-str">N\'$1\'</span>')
    .replace(/\b(\d+)\b/g,'<span class="sql-schema-type">$1</span>');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SQL PANEL
// ═══════════════════════════════════════════════════════════════════════════════
const SQL_TABLES = [
  { name:'fhir_bundles',             fhir:'Bundle',              cols:'bundle_id, source_file, resource_count, loaded_at',                                                    rtype:null },
  { name:'fhir_patients',            fhir:'Patient',             cols:'bundle_id, source_file, patient_id, active, mrn, mrn_system, family_name, given_name, prefix, suffix, gender, birth_date, deceased, address_line, city, state, postal_code, country, phone, email, marital_status, race_code, race_display, ethnicity_code, ethnicity_display, language_code, language_preferred', rtype:'Patient' },
  { name:'fhir_conditions',          fhir:'Condition',           cols:'bundle_id, source_file, condition_id, clinical_status, verification_status, category, severity_code, severity_display, code, code_system, display, body_site_code, body_site_display, patient_ref, onset_date, abatement_date, recorded_date, recorder_display, note', rtype:'Condition' },
  { name:'fhir_medication_requests',       fhir:'MedicationRequest',       cols:'bundle_id, source_file, medication_id, status, intent, medication_code, code_system, display, patient_ref, authored_on, validity_period_start, validity_period_end, route_code, route_display, dose_value, dose_unit, rate_value, rate_unit, refills, reason_code, reason_system, reason_display, requester_display, requester_npi, note', rtype:'MedicationRequest' },
  { name:'fhir_medication_administrations', fhir:'MedicationAdministration', cols:'bundle_id, source_file, administration_id, status, status_reason_code, status_reason_display, medication_code, code_system, display, patient_ref, effective_date, effective_start, effective_end, route_code, route_display, site_code, site_display, dose_value, dose_unit, rate_value, rate_unit, performer_display, performer_npi, reason_code, reason_system, reason_display, note', rtype:'MedicationAdministration' },
  { name:'fhir_allergy_intolerances',fhir:'AllergyIntolerance',  cols:'bundle_id, source_file, allergy_id, patient_ref, code, code_system, display, criticality, clinical_status', rtype:'AllergyIntolerance' },
  { name:'fhir_observations',        fhir:'Observation',         cols:'bundle_id, source_file, observation_id, status, category, category_display, code, code_system, display, patient_ref, effective_date, effective_start, effective_end, value_quantity, value_unit, value_code, value_code_display, value_string, value_range_low, value_range_high, interpretation_code, interpretation_display, ref_range_low, ref_range_high, ref_range_text, body_site_code, body_site_display, method_code, method_display, performer_display, performer_npi, note', rtype:'Observation' },
  { name:'fhir_encounters',          fhir:'Encounter',           cols:'bundle_id, source_file, encounter_id, status, class_code, class_display, type_code, type_system, type_display, priority_code, priority_display, patient_ref, period_start, period_end, reason_code, reason_system, reason_display, diagnosis_code, diagnosis_system, diagnosis_display, participant_display, participant_npi, location_display', rtype:'Encounter' },
  { name:'fhir_procedures',          fhir:'Procedure',           cols:'bundle_id, source_file, procedure_id, status, code, code_system, display, patient_ref, performed_date, performed_start, performed_end, body_site_code, body_site_display, method_code, method_display, performer_display, performer_npi, reason_code, reason_system, reason_display, outcome_code, outcome_display, note', rtype:'Procedure' },
  { name:'fhir_immunizations',       fhir:'Immunization',        cols:'bundle_id, source_file, immunization_id, status, status_reason_code, status_reason_display, vaccine_code, code_system, display, lot_number, manufacturer, route_code, route_display, site_code, site_display, dose_value, dose_unit, patient_ref, occurrence_date, primary_source, performer_display, performer_npi', rtype:'Immunization' },
  { name:'fhir_diagnostic_reports',  fhir:'DiagnosticReport',    cols:'bundle_id, source_file, report_id, identifier, identifier_system, status, category_code, category_display, code, code_system, display, patient_ref, effective_date, effective_start, effective_end, issued, encounter_ref, performer_display, performer_npi, result_count, conclusion, conclusion_code, conclusion_display', rtype:'DiagnosticReport' },
  { name:'fhir_practitioners',       fhir:'Practitioner',        cols:'bundle_id, source_file, practitioner_id, active, npi, identifier_system, family_name, given_name, prefix, suffix, phone, fax, email, address_line, city, state, postal_code, country, qual_code, qual_system, qual_display', rtype:'Practitioner' },
  { name:'fhir_organizations',       fhir:'Organization',        cols:'bundle_id, source_file, organization_id, active, npi, identifier_system, org_identifier, name, org_type, phone, fax, email, address_line, city, state, postal_code, country', rtype:'Organization' },
  { name:'fhir_practitioner_roles',  fhir:'PractitionerRole',    cols:'bundle_id, source_file, role_id, active, practitioner_ref, organization_ref, role_code, role_display, role_system, specialty_code, specialty_display, period_start, period_end', rtype:'PractitionerRole' },
];

function _sqlRowCounts(fhirBundles) {
  const counts = {};
  SQL_TABLES.forEach(t => { counts[t.name] = 0; });
  for (const b of (fhirBundles||[])) {
    counts['fhir_bundles'] += 1;
    for (const { resource:r } of (b.entry||[])) {
      const tbl = SQL_TABLES.find(t => t.rtype === r.resourceType);
      if (tbl) counts[tbl.name] += 1;
    }
  }
  return counts;
}

const BRIDGE_URL = "http://localhost:3001";

function SqlPanel({ fhirBundles, openModal }) {
  const [sqlMode, setSqlMode] = useState("script");
  const [ddl, setDdl] = useState("");
  // Bridge state
  const [bridgeSrv, setBridgeSrv] = useState("localhost");
  const [bridgePort, setBridgePort] = useState("1433");
  const [bridgeDb, setBridgeDb] = useState("FHIR_CCDA");
  const [bridgeAuth, setBridgeAuth] = useState("sql");
  const [bridgeUser, setBridgeUser] = useState("");
  const [bridgePass, setBridgePass] = useState("");
  const [connStatus, setConnStatus] = useState(null); // {cls, msg}
  const [tablesReady, setTablesReady] = useState(false);
  const [loadSub, setLoadSub] = useState("Connect and create tables first");
  const [loadProgress, setLoadProgress] = useState({ visible:false, pct:0, msg:"", fillBg:"var(--green)" });
  const [bridgeLog, setBridgeLog] = useState([]);

  useEffect(() => {
    ccdaApi.getDdl().then(d => { setDdl(d.ddl||""); }).catch(()=>{});
  }, []);

  function blogAdd(msg, cls="log-info") {
    setBridgeLog(prev => [...prev, { msg:`${new Date().toLocaleTimeString()}  ${msg}`, cls }]);
  }

  function downloadBridge() {
    const code = `// ================================================================
// CCDA·AI SQL Server Bridge  v1.0
// Listens on http://localhost:3001
// Receives FHIR bundles from the browser and inserts into SQL Server
//
// Setup:
//   npm install express cors mssql
//   node bridge.js
// ================================================================
'use strict';
const express = require('express');
const cors    = require('cors');
const sql     = require('mssql');

const app  = express();
const PORT = 3001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));

let pool = null;

app.get('/health', (_req, res) => res.json({ status: 'ok', version: '1.0' }));

app.post('/connect', async (req, res) => {
  try {
    const { server, database, user, password, port, windowsAuth } = req.body;
    const cfg = { server, database, port: parseInt(port) || 1433, options: { encrypt: false, trustServerCertificate: true } };
    if (windowsAuth) { cfg.options.trustedConnection = true; } else { cfg.user = user; cfg.password = password; }
    if (pool) { try { await pool.close(); } catch(_){} }
    pool = await sql.connect(cfg);
    res.json({ success: true, message: \`Connected to \${database} on \${server}\` });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/create-tables', async (req, res) => {
  if (!pool) return res.status(400).json({ error: 'Not connected' });
  try {
    const stmts = req.body.ddl.split(/\\bGO\\b/i).map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of stmts) { await pool.request().query(stmt); }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/insert', async (req, res) => {
  if (!pool) return res.status(400).json({ error: 'Not connected' });
  const { table, rows } = req.body;
  if (!rows || !rows.length) return res.json({ success: true, inserted: 0 });
  let inserted = 0; const errors = [];
  try {
    for (const row of rows) {
      try {
        const cols = Object.keys(row);
        const params = cols.map((c, i) => \`@p\${i}\`).join(', ');
        const req2 = pool.request();
        cols.forEach((c, i) => req2.input(\`p\${i}\`, row[c] !== undefined ? row[c] : null));
        await req2.query(\`INSERT INTO \${table} (\${cols.join(', ')}) VALUES (\${params})\`);
        inserted++;
      } catch (rowErr) { errors.push({ error: rowErr.message }); }
    }
    res.json({ success: true, inserted, errors });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/truncate', async (req, res) => {
  if (!pool) return res.status(400).json({ error: 'Not connected' });
  const tables = req.body.tables || [];
  try {
    for (const t of tables) { await pool.request().query(\`TRUNCATE TABLE \${t}\`); }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.listen(PORT, () => { console.log(\`\\n✓ CCDA·AI SQL Server Bridge running on http://localhost:\${PORT}\\n\`); });
`;
    const blob = new Blob([code], { type:"text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "bridge.js"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function testConnection() {
    setConnStatus({ cls:"info", msg:"⟳ Connecting to bridge…" });
    try {
      try { await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(3000) }); }
      catch(_) {
        setConnStatus({ cls:"err", msg:"✗ Bridge not running — download bridge.js, install dependencies (npm install express cors mssql) and start it with: node bridge.js" });
        return;
      }
      const resp = await fetch(`${BRIDGE_URL}/connect`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ server:bridgeSrv, database:bridgeDb, port:bridgePort, windowsAuth:bridgeAuth==="windows", user:bridgeUser, password:bridgePass })
      });
      const data = await resp.json();
      if (data.success) {
        setConnStatus({ cls:"ok", msg:`✓ ${data.message}` });
      } else {
        setConnStatus({ cls:"err", msg:`✗ ${data.error}` });
      }
    } catch(e) { setConnStatus({ cls:"err", msg:`✗ ${e.message}` }); }
  }

  async function createBridgeTables() {
    setConnStatus({ cls:"info", msg:"⟳ Creating tables…" });
    try {
      const resp = await fetch(`${BRIDGE_URL}/create-tables`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ ddl })
      });
      const data = await resp.json();
      if (data.success) {
        setTablesReady(true);
        setConnStatus({ cls:"ok", msg:"✓ All 9 FHIR tables created (IF NOT EXISTS — safe to re-run)" });
        setLoadSub("Ready to load FHIR data");
      } else {
        setConnStatus({ cls:"err", msg:`✗ ${data.error}` });
      }
    } catch(e) { setConnStatus({ cls:"err", msg:`✗ ${e.message}` }); }
  }

  async function loadData(selectedOnly=false) {
    setBridgeLog([]);
    setLoadProgress({ visible:true, pct:0, msg:"Loading…", fillBg:"var(--green)" });
    blogAdd("Starting FHIR → SQL Server load…");
    const bundles = fhirBundles||[];
    const allFiles = selectedOnly ? bundles.slice(0,1) : bundles;
    let filesDone=0, totalInserted=0, totalErrors=0;
    for (const b of allFiles) {
      const name = b._source_file||"bundle";
      blogAdd(`Processing: ${name}`);
      const rows = {};
      SQL_TABLES.forEach(t => { rows[t.name]=[]; });
      const bid = b.id||"unknown";
      const src = b._source_file||"unknown";
      rows.fhir_bundles.push({ bundle_id:bid, source_file:src, resource_count:b._counts?.total||(b.entry||[]).length });
      for (const { resource:r } of (b.entry||[])) {
        switch(r.resourceType) {
          case "Patient": { const n=r.name?.[0]||{}, deceased=r.deceasedDateTime||(r.deceasedBoolean===true?'true':r.deceasedBoolean===false?'false':null); rows.fhir_patients.push({ bundle_id:bid, source_file:src, patient_id:r.id, active:r.active?1:0, mrn:r._mrn||null, mrn_system:r._mrn_system||null, family_name:n.family||null, given_name:(n.given||[]).join(" ")||null, prefix:(n.prefix||[])[0]||null, suffix:(n.suffix||[])[0]||null, gender:r.gender||null, birth_date:r.birthDate||null, deceased:deceased||null, address_line:r._address_line||null, city:r._city||null, state:r._state||null, postal_code:r._postal_code||null, country:r._country||null, phone:r._phone||null, email:r._email||null, marital_status:r.maritalStatus?.text||null, race_code:r._race_code||null, race_display:r._race_display||null, ethnicity_code:r._ethnicity_code||null, ethnicity_display:r._ethnicity_display||null, language_code:r._lang_code||null, language_preferred:r._lang_preferred??null }); break; }
          case "Condition": { const sev=r.severity||{}, sc=sev.coding?.[0]||{}, bs=(r.bodySite?.[0]?.coding||[{}])[0], cat=(r.category?.[0]?.coding||[{}])[0], note0=(r.note||[{}])[0]; rows.fhir_conditions.push({ bundle_id:bid, source_file:src, condition_id:r.id, clinical_status:r.clinicalStatus?.coding?.[0]?.code||null, verification_status:r.verificationStatus?.coding?.[0]?.code||null, category:cat.code||null, severity_code:sc.code||null, severity_display:sev.text||sc.display||null, code:r.code?.coding?.[0]?.code||null, code_system:r.code?.coding?.[0]?.system||null, display:r.code?.text||r.code?.coding?.[0]?.display||null, body_site_code:bs.code||null, body_site_display:bs.display||null, patient_ref:r.subject?.reference?.replace("Patient/","")||null, onset_date:r.onsetDateTime||null, abatement_date:r.abatementDateTime||null, recorded_date:r.recordedDate||null, recorder_display:r.recorder?.display||null, note:note0.text||null }); break; }
          case "MedicationRequest": { const mc=r.medicationCodeableConcept||{}, mcc=mc.coding?.[0]||{}, di0=r.dosageInstruction?.[0]||{}, dar0=di0.doseAndRate?.[0]||{}, dq=dar0.doseQuantity||{}, rq=dar0.rateQuantity||{}, route=di0.route||{}, rtc=route.coding?.[0]||{}, req=r.requester||{}, rc0=r.reasonCode?.[0]||{}, rcc=rc0.coding?.[0]||{}, dr=r.dispenseRequest||{}, vp=dr.validityPeriod||{}, note0=r.note?.[0]||{}; rows.fhir_medication_requests.push({ bundle_id:bid, source_file:src, medication_id:r.id, status:r.status||null, intent:r.intent||null, medication_code:mcc.code||null, code_system:mcc.system||null, display:mc.text||mcc.display||null, patient_ref:r.subject?.reference?.replace("Patient/","")||null, authored_on:r.authoredOn||null, validity_period_start:vp.start||null, validity_period_end:vp.end||null, route_code:rtc.code||null, route_display:route.text||rtc.display||null, dose_value:dq.value||null, dose_unit:dq.unit||null, rate_value:rq.value||null, rate_unit:rq.unit||null, refills:dr.numberOfRepeatsAllowed??null, reason_code:rcc.code||null, reason_system:rcc.system||null, reason_display:rc0.text||rcc.display||null, requester_display:req.display||null, requester_npi:req._npi||null, note:note0.text||null }); break; }
          case "MedicationAdministration": { const mc=r.medicationCodeableConcept||{}, mcc=mc.coding?.[0]||{}, ep=r.effectivePeriod||{}, perf0=(r.performer||[{}])[0], act=perf0.actor||{}, rc0=r.reasonCode?.[0]||{}, rcc=rc0.coding?.[0]||{}, sr0=(r.statusReason||[{}])[0], src2=sr0.coding?.[0]||{}, dosage=r.dosage||{}, dq=dosage.dose||{}, rq=dosage.rateQuantity||{}, route=dosage.route||{}, rtc=route.coding?.[0]||{}, site=dosage.site||{}, stc=site.coding?.[0]||{}, note0=r.note?.[0]||{}; rows.fhir_medication_administrations.push({ bundle_id:bid, source_file:src, administration_id:r.id, status:r.status||null, status_reason_code:src2.code||null, status_reason_display:sr0.text||src2.display||null, medication_code:mcc.code||null, code_system:mcc.system||null, display:mc.text||mcc.display||null, patient_ref:r.subject?.reference?.replace("Patient/","")||null, effective_date:r.effectiveDateTime||null, effective_start:ep.start||null, effective_end:ep.end||null, route_code:rtc.code||null, route_display:route.text||rtc.display||null, site_code:stc.code||null, site_display:site.text||stc.display||null, dose_value:dq.value||null, dose_unit:dq.unit||null, rate_value:rq.value||null, rate_unit:rq.unit||null, performer_display:act.display||null, performer_npi:act._npi||null, reason_code:rcc.code||null, reason_system:rcc.system||null, reason_display:rc0.text||rcc.display||null, note:note0.text||null }); break; }
          case "AllergyIntolerance": rows.fhir_allergy_intolerances.push({ bundle_id:bid, source_file:src, allergy_id:r.id, patient_ref:r.patient?.reference?.replace("Patient/","")||null, code:r.code?.coding?.[0]?.code||null, code_system:r.code?.coding?.[0]?.system||null, display:r.code?.text||r.code?.coding?.[0]?.display||null, allergy_type:r.type||null, criticality:r.criticality||null, clinical_status:r.clinicalStatus?.coding?.[0]?.code||null }); break;
          case "Observation": { const c0=r.code?.coding?.[0]||{}, cat0=r.category?.[0]||{}, catc=cat0.coding?.[0]||{}, vq=r.valueQuantity||{}, vr=r.valueRange||{}, vcc=r.valueCodeableConcept||{}, vccc=vcc.coding?.[0]||{}, interp0=r.interpretation?.[0]||{}, interpC=interp0.coding?.[0]||{}, rr0=r.referenceRange?.[0]||{}, rrL=rr0.low||{}, rrH=rr0.high||{}, bs=r.bodySite||{}, bsc=bs.coding?.[0]||{}, meth=r.method||{}, methC=meth.coding?.[0]||{}, perf0=r.performer?.[0]||{}, ep=r.effectivePeriod||{}, note0=r.note?.[0]||{}; rows.fhir_observations.push({ bundle_id:bid, source_file:src, observation_id:r.id, status:r.status||null, category:catc.code||null, category_display:cat0.text||catc.display||null, code:c0.code||null, code_system:c0.system||null, display:r.code?.text||c0.display||null, patient_ref:r.subject?.reference?.replace("Patient/","")||null, effective_date:r.effectiveDateTime||null, effective_start:ep.start||null, effective_end:ep.end||null, value_quantity:vq.value||null, value_unit:vq.unit||null, value_code:vccc.code||null, value_code_display:vcc.text||vccc.display||null, value_string:r.valueString||null, value_range_low:(vr.low||{}).value||null, value_range_high:(vr.high||{}).value||null, interpretation_code:interpC.code||null, interpretation_display:interp0.text||interpC.display||null, ref_range_low:rrL.value||null, ref_range_high:rrH.value||null, ref_range_text:rr0.text||null, body_site_code:bsc.code||null, body_site_display:bs.text||bsc.display||null, method_code:methC.code||null, method_display:meth.text||methC.display||null, performer_display:perf0.display||null, performer_npi:perf0._npi||null, note:note0.text||null }); break; }
          case "Encounter": { const cls=r.class||{}, t0=r.type?.[0]||{}, tc=t0.coding?.[0]||{}, pri=r.priority||{}, pc=pri.coding?.[0]||{}, d0=r.diagnosis?.[0]||{}, rc0=r.reasonCode?.[0]||{}, rcc=rc0.coding?.[0]||{}, p0=r.participant?.[0]||{}, l0=r.location?.[0]||{}; rows.fhir_encounters.push({ bundle_id:bid, source_file:src, encounter_id:r.id, status:r.status||null, class_code:cls.code||null, class_display:cls.display||null, type_code:tc.code||null, type_system:tc.system||null, type_display:t0.text||tc.display||null, priority_code:pc.code||null, priority_display:pri.text||pc.display||null, patient_ref:r.subject?.reference?.replace("Patient/","")||null, period_start:r.period?.start||null, period_end:r.period?.end||null, reason_code:rcc.code||null, reason_system:rcc.system||null, reason_display:rc0.text||rcc.display||null, diagnosis_code:d0._code||null, diagnosis_system:d0._system||null, diagnosis_display:d0.condition?.display||null, participant_display:p0.individual?.display||null, participant_npi:p0._npi||null, location_display:l0.location?.display||null }); break; }
          case "Procedure": { const c0=r.code?.coding?.[0]||{}, pp=r.performedPeriod||{}, p0=r.performer?.[0]||{}, act=p0.actor||{}, rc0=r.reasonCode?.[0]||{}, rcc=rc0.coding?.[0]||{}, oc=r.outcome||{}, occ=oc.coding?.[0]||{}, bs0=r.bodySite?.[0]||{}, bsc=bs0.coding?.[0]||{}, meth=r.method||{}, methC=meth.coding?.[0]||{}, note0=r.note?.[0]||{}; rows.fhir_procedures.push({ bundle_id:bid, source_file:src, procedure_id:r.id, status:r.status||null, code:c0.code||null, code_system:c0.system||null, display:r.code?.text||c0.display||null, patient_ref:r.subject?.reference?.replace("Patient/","")||null, performed_date:r.performedDateTime||null, performed_start:pp.start||null, performed_end:pp.end||null, body_site_code:bsc.code||null, body_site_display:bs0.text||bsc.display||null, method_code:methC.code||null, method_display:meth.text||methC.display||null, performer_display:act.display||null, performer_npi:act._npi||null, reason_code:rcc.code||null, reason_system:rcc.system||null, reason_display:rc0.text||rcc.display||null, outcome_code:occ.code||null, outcome_display:oc.text||occ.display||null, note:note0.text||null }); break; }
          case "Immunization": { const vc=r.vaccineCode||{}, vcc=vc.coding?.[0]||{}, sr=r.statusReason||{}, src2=sr.coding?.[0]||{}, rt=r.route||{}, rtc=rt.coding?.[0]||{}, st=r.site||{}, stc=st.coding?.[0]||{}, dq=r.doseQuantity||{}, mfr=r.manufacturer||{}, p0=r.performer?.[0]||{}; rows.fhir_immunizations.push({ bundle_id:bid, source_file:src, immunization_id:r.id, status:r.status||null, status_reason_code:src2.code||null, status_reason_display:sr.text||src2.display||null, vaccine_code:vcc.code||null, code_system:vcc.system||null, display:vc.text||vcc.display||null, lot_number:r.lotNumber||null, manufacturer:mfr.display||null, route_code:rtc.code||null, route_display:rt.text||rtc.display||null, site_code:stc.code||null, site_display:st.text||stc.display||null, dose_value:dq.value||null, dose_unit:dq.unit||null, patient_ref:r.patient?.reference?.replace("Patient/","")||null, occurrence_date:r.occurrenceDateTime||null, primary_source:r.primarySource?1:0, performer_display:(p0.actor||{}).display||null, performer_npi:p0._npi||null }); break; }
          case "Practitioner": { const n=r.name?.[0]||{}, id0=r.identifier?.[0]||{}, tel=r.telecom||[], a=r.address?.[0]||{}, q=(r.qualification?.[0]?.code?.coding||[{}])[0]; rows.fhir_practitioners.push({ bundle_id:bid, source_file:src, practitioner_id:r.id, active:r.active?1:0, npi:(id0.system?.includes('us-npi')?id0.value:null)||null, identifier_system:id0.system||null, family_name:n.family||null, given_name:(n.given||[]).join(" ")||null, prefix:(n.prefix||[]).join(" ")||null, suffix:(n.suffix||[]).join(" ")||null, phone:tel.find(t=>t.system==='phone')?.value||null, fax:tel.find(t=>t.system==='fax')?.value||null, email:tel.find(t=>t.system==='email')?.value||null, address_line:(a.line||[])[0]||null, city:a.city||null, state:a.state||null, postal_code:a.postalCode||null, country:a.country||null, qual_code:q.code||null, qual_system:q.system||null, qual_display:q.display||null }); break; }
          case "Organization": { const id0=r.identifier?.[0]||{}, tel=r.telecom||[], a=r.address?.[0]||{}, t0=(r.type?.[0]?.coding||[{}])[0]; rows.fhir_organizations.push({ bundle_id:bid, source_file:src, organization_id:r.id, active:r.active?1:0, npi:(id0.system?.includes('us-npi')?id0.value:null)||null, identifier_system:id0.system||null, org_identifier:id0.value||null, name:r.name||null, org_type:t0.display||t0.code||null, phone:tel.find(t=>t.system==='phone')?.value||null, fax:tel.find(t=>t.system==='fax')?.value||null, email:tel.find(t=>t.system==='email')?.value||null, address_line:(a.line||[])[0]||null, city:a.city||null, state:a.state||null, postal_code:a.postalCode||null, country:a.country||null }); break; }
          case "PractitionerRole": { const rc=(r.code?.[0]?.coding||[{}])[0], sc=(r.specialty?.[0]?.coding||[{}])[0], p=r.period||{}; rows.fhir_practitioner_roles.push({ bundle_id:bid, source_file:src, role_id:r.id, active:r.active?1:0, practitioner_ref:r.practitioner?.reference?.replace("Practitioner/","")||null, organization_ref:r.organization?.reference?.replace("Organization/","")||null, role_code:rc.code||null, role_display:rc.display||null, role_system:rc.system||null, specialty_code:sc.code||null, specialty_display:sc.display||null, period_start:p.start||null, period_end:p.end||null }); break; }
        }
      }
      const tables = Object.entries(rows).filter(([,arr])=>arr.length>0);
      let tDone=0;
      for (const [tbl, arr] of tables) {
        try {
          const resp = await fetch(`${BRIDGE_URL}/insert`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({table:tbl,rows:arr}) });
          const data = await resp.json();
          if (data.success) {
            totalInserted += data.inserted;
            if (data.errors?.length) { totalErrors += data.errors.length; blogAdd(`  ⚠ ${tbl}: ${data.inserted} inserted, ${data.errors.length} errors`, "log-warn"); }
            else blogAdd(`  ✓ ${tbl}: ${data.inserted} row${data.inserted!==1?"s":""} inserted`, "log-ok");
          } else { blogAdd(`  ✗ ${tbl}: ${data.error}`, "log-err"); totalErrors++; }
        } catch(e) { blogAdd(`  ✗ ${tbl}: ${e.message}`, "log-err"); totalErrors++; }
        tDone++;
        const pct = Math.round(((filesDone + tDone/tables.length) / allFiles.length) * 100);
        setLoadProgress(p => ({ ...p, pct, msg:`Loading ${name}…` }));
      }
      filesDone++;
      setLoadProgress(p => ({ ...p, pct: Math.round(filesDone/allFiles.length*100), msg:`Loaded ${name}` }));
    }
    if (totalErrors===0) {
      blogAdd(`✓ Done — ${totalInserted} rows loaded across all tables`, "log-ok");
      setLoadProgress(p => ({ ...p, pct:100, msg:"Complete", fillBg:"var(--green)" }));
    } else {
      blogAdd(`Finished with ${totalErrors} error(s). ${totalInserted} rows loaded successfully.`, "log-warn");
      setLoadProgress(p => ({ ...p, pct:100, msg:"Complete", fillBg:"var(--amber)" }));
    }
  }

  async function truncateAll() {
    if (!confirm("This will DELETE ALL rows from all 12 FHIR tables. Continue?")) return;
    try {
      const resp = await fetch(`${BRIDGE_URL}/truncate`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({tables:SQL_TABLES.map(t=>t.name)}) });
      const data = await resp.json();
      setBridgeLog(prev => [...prev, { msg:data.success?"✓ All FHIR tables truncated":"✗ "+data.error, cls:data.success?"log-ok":"log-err" }]);
    } catch(e) { alert("Truncate failed: "+e.message); }
  }

  function _buildInserts() {
    const esc = v => {
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number") return isNaN(v) ? "NULL" : v;
      return `N'${String(v).replace(/'/g, "''")}'`;
    };
    // Aggregate all rows per table across all bundles (matches V15 _sqlAllRows)
    const merged = {
      fhir_bundles:[], fhir_patients:[], fhir_conditions:[], fhir_medication_requests:[], fhir_medication_administrations:[],
      fhir_allergy_intolerances:[], fhir_observations:[], fhir_encounters:[],
      fhir_procedures:[], fhir_immunizations:[], fhir_diagnostic_reports:[],
      fhir_practitioners:[], fhir_organizations:[], fhir_practitioner_roles:[],
    };
    for (const b of (fhirBundles||[])) {
      const bid = b.id || "unknown";
      const src = b._source_file || "unknown";
      const counts = b._counts || {};
      merged.fhir_bundles.push({ bundle_id:bid, source_file:src, resource_count:counts.total||(b.entry||[]).length });
      for (const { resource:r } of (b.entry||[])) {
        switch (r.resourceType) {
          case "Patient": { const n=r.name?.[0]||{}, deceased=r.deceasedDateTime||(r.deceasedBoolean===true?'true':r.deceasedBoolean===false?'false':null); merged.fhir_patients.push({ bundle_id:bid, source_file:src, patient_id:r.id, active:r.active?1:0, mrn:r._mrn||null, mrn_system:r._mrn_system||null, family_name:n.family||null, given_name:(n.given||[]).join(" ")||null, prefix:(n.prefix||[])[0]||null, suffix:(n.suffix||[])[0]||null, gender:r.gender||null, birth_date:r.birthDate||null, deceased:deceased||null, address_line:r._address_line||null, city:r._city||null, state:r._state||null, postal_code:r._postal_code||null, country:r._country||null, phone:r._phone||null, email:r._email||null, marital_status:r.maritalStatus?.text||null, race_code:r._race_code||null, race_display:r._race_display||null, ethnicity_code:r._ethnicity_code||null, ethnicity_display:r._ethnicity_display||null, language_code:r._lang_code||null, language_preferred:r._lang_preferred??null }); break; }
          case "Condition": { const sev=r.severity||{}, sc=sev.coding?.[0]||{}, bs=(r.bodySite?.[0]?.coding||[{}])[0], cat=(r.category?.[0]?.coding||[{}])[0], note0=(r.note||[{}])[0]; merged.fhir_conditions.push({ bundle_id:bid, source_file:src, condition_id:r.id, clinical_status:r.clinicalStatus?.coding?.[0]?.code||null, verification_status:r.verificationStatus?.coding?.[0]?.code||null, category:cat.code||null, severity_code:sc.code||null, severity_display:sev.text||sc.display||null, code:r.code?.coding?.[0]?.code||null, code_system:r.code?.coding?.[0]?.system||null, display:r.code?.text||r.code?.coding?.[0]?.display||null, body_site_code:bs.code||null, body_site_display:bs.display||null, patient_ref:r.subject?.reference?.replace("Patient/","")||null, onset_date:r.onsetDateTime||null, abatement_date:r.abatementDateTime||null, recorded_date:r.recordedDate||null, recorder_display:r.recorder?.display||null, note:note0.text||null }); break; }
          case "MedicationRequest": { const mc=r.medicationCodeableConcept||{}, mcc=mc.coding?.[0]||{}, di0=r.dosageInstruction?.[0]||{}, dar0=di0.doseAndRate?.[0]||{}, dq=dar0.doseQuantity||{}, rq=dar0.rateQuantity||{}, route=di0.route||{}, rtc=route.coding?.[0]||{}, req=r.requester||{}, rc0=r.reasonCode?.[0]||{}, rcc=rc0.coding?.[0]||{}, dr=r.dispenseRequest||{}, vp=dr.validityPeriod||{}, note0=r.note?.[0]||{}; merged.fhir_medication_requests.push({ bundle_id:bid, source_file:src, medication_id:r.id, status:r.status||null, intent:r.intent||null, medication_code:mcc.code||null, code_system:mcc.system||null, display:mc.text||mcc.display||null, patient_ref:r.subject?.reference?.replace("Patient/","")||null, authored_on:r.authoredOn||null, validity_period_start:vp.start||null, validity_period_end:vp.end||null, route_code:rtc.code||null, route_display:route.text||rtc.display||null, dose_value:dq.value||null, dose_unit:dq.unit||null, rate_value:rq.value||null, rate_unit:rq.unit||null, refills:dr.numberOfRepeatsAllowed??null, reason_code:rcc.code||null, reason_system:rcc.system||null, reason_display:rc0.text||rcc.display||null, requester_display:req.display||null, requester_npi:req._npi||null, note:note0.text||null }); break; }
          case "MedicationAdministration": { const mc=r.medicationCodeableConcept||{}, mcc=mc.coding?.[0]||{}, ep=r.effectivePeriod||{}, perf0=(r.performer||[{}])[0], act=perf0.actor||{}, rc0=r.reasonCode?.[0]||{}, rcc=rc0.coding?.[0]||{}, sr0=(r.statusReason||[{}])[0], src2=sr0.coding?.[0]||{}, dosage=r.dosage||{}, dq=dosage.dose||{}, rq=dosage.rateQuantity||{}, route=dosage.route||{}, rtc=route.coding?.[0]||{}, site=dosage.site||{}, stc=site.coding?.[0]||{}, note0=r.note?.[0]||{}; merged.fhir_medication_administrations.push({ bundle_id:bid, source_file:src, administration_id:r.id, status:r.status||null, status_reason_code:src2.code||null, status_reason_display:sr0.text||src2.display||null, medication_code:mcc.code||null, code_system:mcc.system||null, display:mc.text||mcc.display||null, patient_ref:r.subject?.reference?.replace("Patient/","")||null, effective_date:r.effectiveDateTime||null, effective_start:ep.start||null, effective_end:ep.end||null, route_code:rtc.code||null, route_display:route.text||rtc.display||null, site_code:stc.code||null, site_display:site.text||stc.display||null, dose_value:dq.value||null, dose_unit:dq.unit||null, rate_value:rq.value||null, rate_unit:rq.unit||null, performer_display:act.display||null, performer_npi:act._npi||null, reason_code:rcc.code||null, reason_system:rcc.system||null, reason_display:rc0.text||rcc.display||null, note:note0.text||null }); break; }
          case "AllergyIntolerance":
            merged.fhir_allergy_intolerances.push({ bundle_id:bid, source_file:src, allergy_id:r.id, patient_ref:r.patient?.reference?.replace("Patient/","")||null, code:r.code?.coding?.[0]?.code||null, code_system:r.code?.coding?.[0]?.system||null, display:r.code?.text||r.code?.coding?.[0]?.display||null, allergy_type:r.type||null, criticality:r.criticality||null, clinical_status:r.clinicalStatus?.coding?.[0]?.code||null }); break;
          case "Observation": { const c0=r.code?.coding?.[0]||{}, cat0=r.category?.[0]||{}, catc=cat0.coding?.[0]||{}, vq=r.valueQuantity||{}, vr=r.valueRange||{}, vcc=r.valueCodeableConcept||{}, vccc=vcc.coding?.[0]||{}, interp0=r.interpretation?.[0]||{}, interpC=interp0.coding?.[0]||{}, rr0=r.referenceRange?.[0]||{}, rrL=rr0.low||{}, rrH=rr0.high||{}, bs=r.bodySite||{}, bsc=bs.coding?.[0]||{}, meth=r.method||{}, methC=meth.coding?.[0]||{}, perf0=r.performer?.[0]||{}, ep=r.effectivePeriod||{}, note0=r.note?.[0]||{}; merged.fhir_observations.push({ bundle_id:bid, source_file:src, observation_id:r.id, status:r.status||null, category:catc.code||null, category_display:cat0.text||catc.display||null, code:c0.code||null, code_system:c0.system||null, display:r.code?.text||c0.display||null, patient_ref:r.subject?.reference?.replace("Patient/","")||null, effective_date:r.effectiveDateTime||null, effective_start:ep.start||null, effective_end:ep.end||null, value_quantity:vq.value||null, value_unit:vq.unit||null, value_code:vccc.code||null, value_code_display:vcc.text||vccc.display||null, value_string:r.valueString||null, value_range_low:(vr.low||{}).value||null, value_range_high:(vr.high||{}).value||null, interpretation_code:interpC.code||null, interpretation_display:interp0.text||interpC.display||null, ref_range_low:rrL.value||null, ref_range_high:rrH.value||null, ref_range_text:rr0.text||null, body_site_code:bsc.code||null, body_site_display:bs.text||bsc.display||null, method_code:methC.code||null, method_display:meth.text||methC.display||null, performer_display:perf0.display||null, performer_npi:perf0._npi||null, note:note0.text||null }); break; }
          case "Encounter": { const cls=r.class||{}, t0=r.type?.[0]||{}, tc=t0.coding?.[0]||{}, pri=r.priority||{}, pc=pri.coding?.[0]||{}, d0=r.diagnosis?.[0]||{}, rc0=r.reasonCode?.[0]||{}, rcc=rc0.coding?.[0]||{}, p0=r.participant?.[0]||{}, l0=r.location?.[0]||{}; merged.fhir_encounters.push({ bundle_id:bid, source_file:src, encounter_id:r.id, status:r.status||null, class_code:cls.code||null, class_display:cls.display||null, type_code:tc.code||null, type_system:tc.system||null, type_display:t0.text||tc.display||null, priority_code:pc.code||null, priority_display:pri.text||pc.display||null, patient_ref:r.subject?.reference?.replace("Patient/","")||null, period_start:r.period?.start||null, period_end:r.period?.end||null, reason_code:rcc.code||null, reason_system:rcc.system||null, reason_display:rc0.text||rcc.display||null, diagnosis_code:d0._code||null, diagnosis_system:d0._system||null, diagnosis_display:d0.condition?.display||null, participant_display:p0.individual?.display||null, participant_npi:p0._npi||null, location_display:l0.location?.display||null }); break; }
          case "Procedure": { const c0=r.code?.coding?.[0]||{}, pp=r.performedPeriod||{}, p0=r.performer?.[0]||{}, act=p0.actor||{}, rc0=r.reasonCode?.[0]||{}, rcc=rc0.coding?.[0]||{}, oc=r.outcome||{}, occ=oc.coding?.[0]||{}, bs0=r.bodySite?.[0]||{}, bsc=bs0.coding?.[0]||{}, meth=r.method||{}, methC=meth.coding?.[0]||{}, note0=r.note?.[0]||{}; merged.fhir_procedures.push({ bundle_id:bid, source_file:src, procedure_id:r.id, status:r.status||null, code:c0.code||null, code_system:c0.system||null, display:r.code?.text||c0.display||null, patient_ref:r.subject?.reference?.replace("Patient/","")||null, performed_date:r.performedDateTime||null, performed_start:pp.start||null, performed_end:pp.end||null, body_site_code:bsc.code||null, body_site_display:bs0.text||bsc.display||null, method_code:methC.code||null, method_display:meth.text||methC.display||null, performer_display:act.display||null, performer_npi:act._npi||null, reason_code:rcc.code||null, reason_system:rcc.system||null, reason_display:rc0.text||rcc.display||null, outcome_code:occ.code||null, outcome_display:oc.text||occ.display||null, note:note0.text||null }); break; }
          case "Immunization": { const vc=r.vaccineCode||{}, vcc=vc.coding?.[0]||{}, sr=r.statusReason||{}, src2=sr.coding?.[0]||{}, rt=r.route||{}, rtc=rt.coding?.[0]||{}, st=r.site||{}, stc=st.coding?.[0]||{}, dq=r.doseQuantity||{}, mfr=r.manufacturer||{}, p0=r.performer?.[0]||{}; merged.fhir_immunizations.push({ bundle_id:bid, source_file:src, immunization_id:r.id, status:r.status||null, status_reason_code:src2.code||null, status_reason_display:sr.text||src2.display||null, vaccine_code:vcc.code||null, code_system:vcc.system||null, display:vc.text||vcc.display||null, lot_number:r.lotNumber||null, manufacturer:mfr.display||null, route_code:rtc.code||null, route_display:rt.text||rtc.display||null, site_code:stc.code||null, site_display:st.text||stc.display||null, dose_value:dq.value||null, dose_unit:dq.unit||null, patient_ref:r.patient?.reference?.replace("Patient/","")||null, occurrence_date:r.occurrenceDateTime||null, primary_source:r.primarySource?1:0, performer_display:(p0.actor||{}).display||null, performer_npi:p0._npi||null }); break; }
          case "Practitioner": { const n=r.name?.[0]||{}, id0=r.identifier?.[0]||{}, tel=r.telecom||[], a=r.address?.[0]||{}, q=(r.qualification?.[0]?.code?.coding||[{}])[0]; merged.fhir_practitioners.push({ bundle_id:bid, source_file:src, practitioner_id:r.id, active:r.active?1:0, npi:(id0.system?.includes('us-npi')?id0.value:null)||null, identifier_system:id0.system||null, family_name:n.family||null, given_name:(n.given||[]).join(" ")||null, prefix:(n.prefix||[]).join(" ")||null, suffix:(n.suffix||[]).join(" ")||null, phone:tel.find(t=>t.system==='phone')?.value||null, fax:tel.find(t=>t.system==='fax')?.value||null, email:tel.find(t=>t.system==='email')?.value||null, address_line:(a.line||[])[0]||null, city:a.city||null, state:a.state||null, postal_code:a.postalCode||null, country:a.country||null, qual_code:q.code||null, qual_system:q.system||null, qual_display:q.display||null }); break; }
          case "Organization": { const id0=r.identifier?.[0]||{}, tel=r.telecom||[], a=r.address?.[0]||{}, t0=(r.type?.[0]?.coding||[{}])[0]; merged.fhir_organizations.push({ bundle_id:bid, source_file:src, organization_id:r.id, active:r.active?1:0, npi:(id0.system?.includes('us-npi')?id0.value:null)||null, identifier_system:id0.system||null, org_identifier:id0.value||null, name:r.name||null, org_type:t0.display||t0.code||null, phone:tel.find(t=>t.system==='phone')?.value||null, fax:tel.find(t=>t.system==='fax')?.value||null, email:tel.find(t=>t.system==='email')?.value||null, address_line:(a.line||[])[0]||null, city:a.city||null, state:a.state||null, postal_code:a.postalCode||null, country:a.country||null }); break; }
          case "PractitionerRole": { const rc=(r.code?.[0]?.coding||[{}])[0], sc=(r.specialty?.[0]?.coding||[{}])[0], p=r.period||{}; merged.fhir_practitioner_roles.push({ bundle_id:bid, source_file:src, role_id:r.id, active:r.active?1:0, practitioner_ref:r.practitioner?.reference?.replace("Practitioner/","")||null, organization_ref:r.organization?.reference?.replace("Organization/","")||null, role_code:rc.code||null, role_display:rc.display||null, role_system:rc.system||null, specialty_code:sc.code||null, specialty_display:sc.display||null, period_start:p.start||null, period_end:p.end||null }); break; }
          case "DiagnosticReport": { const cat0=r.category?.[0]||{}, catc=cat0.coding?.[0]||{}, c0=r.code?.coding?.[0]||{}, ep=r.effectivePeriod||{}, p0=r.performer?.[0]||{}, cc0=r.conclusionCode?.[0]||{}, ccc=cc0.coding?.[0]||{}; merged.fhir_diagnostic_reports.push({ bundle_id:bid, source_file:src, report_id:r.id, identifier:r._identifier||null, identifier_system:r._identifier_system||null, status:r.status||null, category_code:catc.code||null, category_display:cat0.text||catc.display||null, code:c0.code||null, code_system:c0.system||null, display:r.code?.text||c0.display||null, patient_ref:r.subject?.reference?.replace("Patient/","")||null, effective_date:r.effectiveDateTime||null, effective_start:ep.start||null, effective_end:ep.end||null, issued:r.issued||null, encounter_ref:r.encounter?.reference?.replace("Encounter/","")||null, performer_display:p0.display||null, performer_npi:r._performer_npi||null, result_count:r._result_count??null, conclusion:r.conclusion||null, conclusion_code:r._conclusion_code||null, conclusion_display:r._conclusion_display||null }); break; }
        }
      }
    }
    // Output table-grouped INSERTs (matches V15 sqlInserts)
    let sql = "";
    for (const [tbl, rows] of Object.entries(merged)) {
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      sql += `\n-- ${tbl} (${rows.length} row${rows.length!==1?"s":""})\n`;
      for (const row of rows) {
        sql += `INSERT INTO ${tbl} (${cols.join(", ")}) VALUES (${cols.map(c=>esc(row[c])).join(", ")});\n`;
      }
    }
    return sql;
  }

  function downloadDdl() {
    const today = new Date().toISOString().slice(0,10);
    const inserts = _buildInserts();
    const script = (ddl||"") + "\n-- ============================================================\n-- DATA (INSERT statements)\n-- ============================================================\n" + inserts;
    const blob = new Blob([script], { type:"text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `fhir_load_${today}.sql`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function previewInserts() {
    const sql = _buildInserts();
    const preview = (sql||"-- No FHIR data loaded").slice(0, 4000);
    if (openModal) openModal("INSERT Statement Preview", (
      <div>
        <div style={{ fontSize:11, color:"var(--muted)", marginBottom:8 }}>Showing first 4,000 characters — download the full script for all rows.</div>
        <pre style={{ background:"#1a1510", borderRadius:8, padding:14, fontFamily:"var(--mono)", fontSize:10, lineHeight:1.6, color:"#c8b89a", maxHeight:480, overflow:"auto" }}
          dangerouslySetInnerHTML={{ __html: _sqlHighlight(preview) + "…" }}/>
      </div>
    ));
  }

  const hasData = fhirBundles?.length > 0;
  const totalRes = (fhirBundles||[]).reduce((a,b)=>a+(b._counts?.total||0),0);
  const rowCounts = _sqlRowCounts(fhirBundles);

  return (
    <div>
      {/* FHIR data ready */}
      {hasData && (
        <div className="sql-step" style={{ marginBottom:14 }}>
          <div className="sql-step-hdr" style={{ marginBottom:8 }}>
            <div className="sql-step-num done">✓</div>
            <div><div className="sql-step-title">FHIR Data Ready</div>
            <div className="sql-step-sub">Source: FHIR Conversion · reading from S.fhirBundles</div></div>
          </div>
          <div className="sql-summary-chips">
            <span className="sql-chip has">{fhirBundles.length} FHIR Bundle{fhirBundles.length!==1?"s":""}</span>
            <span className="sql-chip has">{totalRes} Total Resources</span>
            {fhirBundles.map((b,i) => (
              <span key={i} className="sql-chip">{(b._source_file||`Bundle ${i+1}`).replace(/\.xml$/i,'')} · {b._counts?.total||0} res</span>
            ))}
          </div>
        </div>
      )}
      {!hasData && (
        <EmptyState title="No FHIR data to load"
          sub="Complete the FHIR Conversion step first — run analysis on CCDA files, then return here."/>
      )}

      {hasData && (
        <>
          {/* mode tabs */}
          <div className="sql-mode-tabs">
            <button className={`sql-mode-tab${sqlMode==="script"?" on":""}`} onClick={() => setSqlMode("script")}>
              📄 SQL Script — download &amp; run in SSMS
            </button>
            <button className={`sql-mode-tab${sqlMode==="bridge"?" on":""}`} onClick={() => setSqlMode("bridge")}>
              ⚡ Live Bridge — stream directly to SQL Server
            </button>
          </div>

          {sqlMode === "script" && (
            <div>
              {/* step 1: schema */}
              <div className="sql-step">
                <div className="sql-step-hdr">
                  <div className="sql-step-num active">1</div>
                  <div><div className="sql-step-title">Database Schema</div>
                  <div className="sql-step-sub">10 normalised tables — one per FHIR resource type</div></div>
                </div>
                <div style={{ overflowX:"auto" }}>
                  <table className="sql-tbl-preview">
                    <thead><tr><th>Table</th><th>FHIR Resource</th><th>Key Columns</th><th>Rows (est.)</th></tr></thead>
                    <tbody>
                      {SQL_TABLES.map((t,i) => {
                        const cnt = rowCounts[t.name] || 0;
                        const keyCols = t.cols.split(',').slice(0,4).map(c=>c.trim()).join(', ') + '…';
                        return (
                          <tr key={i}>
                            <td style={{ fontFamily:"var(--mono)", fontSize:10, fontWeight:600, color:"var(--blue)" }}>{t.name}</td>
                            <td><span style={{ fontSize:10, background:"rgba(13,122,92,.1)", color:"#0d7a5c", padding:"1px 6px", borderRadius:3, fontWeight:700 }}>{t.fhir}</span></td>
                            <td style={{ color:"var(--muted)", fontSize:10 }}>{keyCols}</td>
                            <td><span className={`badge ${cnt>0?"bh":"bna"}`}>{cnt}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {ddl && <div className="sql-schema-code" dangerouslySetInnerHTML={{ __html: _sqlHighlight(ddl.split('\n').slice(0,40).join('\n')) + '\n<span style="color:#555">…</span>' }}/>}
              </div>
              {/* step 2: download */}
              <div className="sql-step">
                <div className="sql-step-hdr">
                  <div className="sql-step-num active">2</div>
                  <div><div className="sql-step-title">Generate &amp; Download SQL Script</div>
                  <div className="sql-step-sub">Includes CREATE TABLE (IF NOT EXISTS) + all INSERT statements</div></div>
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <button className="btn-sql" onClick={downloadDdl} disabled={!ddl}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1v10M4 7l4 4 4-4M2 14h12"/></svg>
                    Download .sql Script
                  </button>
                  <button className="btn-sql btn-sql-dk" onClick={previewInserts} disabled={!(fhirBundles?.length)}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4h12M2 8h8M2 12h10"/></svg>
                    Preview INSERT Statements
                  </button>
                </div>
              </div>
              {/* step 3: run in SSMS */}
              <div className="sql-step">
                <div className="sql-step-hdr">
                  <div className="sql-step-num" style={{ background:"var(--muted)" }}>3</div>
                  <div><div className="sql-step-title">Run in SQL Server Management Studio (SSMS)</div>
                  <div className="sql-step-sub">Or any SQL Server client — sqlcmd, Azure Data Studio, DBeaver</div></div>
                </div>
                <div className="sql-bridge-box">
                  <div className="sql-bridge-step">
                    <div className="sql-bridge-num">1</div>
                    <div>Open <strong>SSMS</strong> and connect to your local SQL Server instance</div>
                  </div>
                  <div className="sql-bridge-step">
                    <div className="sql-bridge-num">2</div>
                    <div>Open the downloaded <code className="sql-bridge-cmd">.sql</code> file via <em>File → Open → File</em></div>
                  </div>
                  <div className="sql-bridge-step">
                    <div className="sql-bridge-num">3</div>
                    <div>Select your target database from the dropdown, then press <strong>F5</strong> or click <em>Execute</em></div>
                  </div>
                  <div className="sql-bridge-step">
                    <div className="sql-bridge-num">4</div>
                    <div>All tables are created with <code className="sql-bridge-cmd">IF NOT EXISTS</code> — safe to re-run. New rows are appended, not duplicated.</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {sqlMode === "bridge" && (
            <div>
              {/* Step 1: Download & start bridge */}
              <div className="sql-step">
                <div className="sql-step-hdr">
                  <div className="sql-step-num active">1</div>
                  <div><div className="sql-step-title">Download &amp; start the local bridge</div>
                  <div className="sql-step-sub">A tiny Node.js server that receives FHIR data from this page and writes it to SQL Server</div></div>
                </div>
                <div className="sql-bridge-box">
                  <div className="sql-bridge-step">
                    <div className="sql-bridge-num">a</div>
                    <div>Download the bridge script:<br/>
                      <button className="btn-sql btn-sql-dk" style={{ marginTop:6 }} onClick={downloadBridge}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1v10M4 7l4 4 4-4M2 14h12"/></svg>
                        Download bridge.js
                      </button>
                    </div>
                  </div>
                  <div className="sql-bridge-step">
                    <div className="sql-bridge-num">b</div>
                    <div>Install dependencies (once):<br/>
                      <code className="sql-bridge-cmd">npm install express cors mssql</code>
                    </div>
                  </div>
                  <div className="sql-bridge-step">
                    <div className="sql-bridge-num">c</div>
                    <div>Start the bridge:<br/>
                      <code className="sql-bridge-cmd">node bridge.js</code><br/>
                      <span style={{ fontSize:11, color:"var(--muted)" }}>Runs on http://localhost:3001 — keep this terminal open</span>
                    </div>
                  </div>
                </div>
              </div>
              {/* Step 2: Connection config */}
              <div className="sql-step">
                <div className="sql-step-hdr">
                  <div className="sql-step-num active">2</div>
                  <div><div className="sql-step-title">SQL Server Connection</div>
                  <div className="sql-step-sub">Credentials are sent only to your local bridge — never to any external server</div></div>
                </div>
                <div className="sql-conn-grid" style={{ marginBottom:10 }}>
                  <div className="sql-field"><label>Server</label><input value={bridgeSrv} onChange={e=>setBridgeSrv(e.target.value)} placeholder="localhost or .\SQLEXPRESS"/></div>
                  <div className="sql-field"><label>Port</label><input value={bridgePort} onChange={e=>setBridgePort(e.target.value)} placeholder="1433"/></div>
                  <div className="sql-field"><label>Database</label><input value={bridgeDb} onChange={e=>setBridgeDb(e.target.value)} placeholder="Database name"/></div>
                  <div className="sql-field">
                    <label>Authentication</label>
                    <select value={bridgeAuth} onChange={e=>setBridgeAuth(e.target.value)}>
                      <option value="sql">SQL Server Authentication</option>
                      <option value="windows">Windows Authentication</option>
                    </select>
                  </div>
                  {bridgeAuth !== "windows" && <>
                    <div className="sql-field"><label>Username</label><input value={bridgeUser} onChange={e=>setBridgeUser(e.target.value)} placeholder="sa"/></div>
                    <div className="sql-field"><label>Password</label><input type="password" value={bridgePass} onChange={e=>setBridgePass(e.target.value)} placeholder="••••••••"/></div>
                  </>}
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <button className="btn-sql" onClick={testConnection}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2a5 5 0 110 10A5 5 0 018 3zm-1 4v4h2V7H7zm0-3v2h2V4H7z"/></svg>
                    Test Connection
                  </button>
                  <button className="btn-sql btn-sql-green" onClick={createBridgeTables} disabled={!connStatus || connStatus.cls !== "ok"}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2v12M2 8h12"/></svg>
                    Create Tables
                  </button>
                </div>
                {connStatus && <div className={`sql-status ${connStatus.cls}`}>{connStatus.msg}</div>}
              </div>
              {/* Step 3: Load data */}
              <div className="sql-step">
                <div className="sql-step-hdr">
                  <div className="sql-step-num" style={{ background: tablesReady ? "var(--blue)" : "var(--muted)" }}>3</div>
                  <div><div className="sql-step-title">Load FHIR Data into SQL Server</div>
                  <div className="sql-step-sub">{loadSub}</div></div>
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
                  <button className="btn-sql btn-sql-green" onClick={() => loadData(false)} disabled={!tablesReady}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1v10M4 7l4 4 4-4"/><path d="M2 13h12v2H2z"/></svg>
                    Load All FHIR Data
                  </button>
                  <button className="btn-sql btn-sql-amber" onClick={() => loadData(true)} disabled={!tablesReady}>
                    Load Selected File Only
                  </button>
                  <button className="btn-sql btn-sql-red" onClick={truncateAll} disabled={!tablesReady} style={{ marginLeft:"auto" }}>
                    Truncate All Tables
                  </button>
                </div>
                {loadProgress.visible && (
                  <div className="sql-progress-wrap">
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"var(--muted)", marginBottom:4 }}>
                      <span>{loadProgress.msg}</span>
                      <span>{loadProgress.pct}%</span>
                    </div>
                    <div className="sql-progress-bar">
                      <div className="sql-progress-fill" style={{ width:`${loadProgress.pct}%`, background:loadProgress.fillBg }}/>
                    </div>
                  </div>
                )}
                {bridgeLog.length > 0 && (
                  <div className="sql-log">
                    {bridgeLog.map((l,i) => <div key={i} className={l.cls}>{l.msg}</div>)}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── LoginScreen ───────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("demo@ccda.ai");
  const [password, setPassword] = useState("demo");
  const [showPwd, setShowPwd] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    onLogin();
  }

  return (
    <div className="ccda-login-wrap">
      {/* ── Left marketing panel ── */}
      <div className="ccda-login-left">
        <div className="ccda-login-logo">
          <svg width="48" height="34" viewBox="0 0 52 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="EXL">
            <rect width="52" height="36" rx="4" fill="#F05921"/>
            <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
              fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="17" fill="white" letterSpacing="1">
              EXL
            </text>
          </svg>
          <div className="ccda-login-brand-wrap">
            <div className="ccda-login-brand">CCDA Analyzer</div>
            <div className="ccda-login-platform">Clinical Intelligence Platform</div>
          </div>
        </div>

        <div className="ccda-login-hero">
          <div className="ccda-login-eyebrow">Clinical Intelligence</div>
          <div className="ccda-login-headline">Unlock insights<br/>from<br/>clinical data.</div>
          <div className="ccda-login-desc">
            Parse, analyze, and visualize C-CDA documents<br/>with AI-assisted gap detection and FHIR export.
          </div>
          <div className="ccda-login-bullets">
            <div className="ccda-login-bullet">
              <span className="ccda-login-bullet-dot"/>
              <span><strong>C-CDA parsing</strong> — structured extraction across all clinical sections</span>
            </div>
            <div className="ccda-login-bullet">
              <span className="ccda-login-bullet-dot"/>
              <span><strong>Gap analysis</strong> — narrative vs. coded data discrepancy detection</span>
            </div>
            <div className="ccda-login-bullet">
              <span className="ccda-login-bullet-dot"/>
              <span><strong>FHIR export</strong> — push to Databricks or SQL with one click</span>
            </div>
          </div>
        </div>

        <div className="ccda-login-footer">
          © 2025 CCDA Analyzer · v15.0 · HIPAA compliant
        </div>
      </div>

      {/* ── Right login form ── */}
      <div className="ccda-login-right">
        <div className="ccda-login-form-wrap">
          <div className="ccda-login-title">Welcome back</div>
          <div className="ccda-login-subtitle">Sign in to your clinical workspace</div>

          <form onSubmit={handleSubmit}>
            <div className="ccda-login-field">
              <label className="ccda-login-label">Email Address</label>
              <div className="ccda-login-input-wrap">
                <input className="ccda-login-input" type="email" value={email}
                  onChange={e => setEmail(e.target.value)} placeholder="you@organization.com"/>
              </div>
            </div>

            <div className="ccda-login-field">
              <label className="ccda-login-label">Password</label>
              <div className="ccda-login-input-wrap">
                <input className="ccda-login-input" type={showPwd ? "text" : "password"}
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••••" style={{ paddingRight:42 }}/>
                <button type="button" className="ccda-login-eye" onClick={() => setShowPwd(v => !v)}>
                  {showPwd
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>

            <div className="ccda-login-row">
              <span/>
              <a href="#" className="ccda-login-forgot" onClick={e => e.preventDefault()}>Forgot password?</a>
            </div>

            <button type="submit" className="ccda-login-btn">
              Sign in
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
          </form>

          <div className="ccda-login-divider">or continue with</div>

          <button className="ccda-login-sso" onClick={handleSubmit}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            Single Sign-On (SSO)
          </button>

          <div className="ccda-login-legal">
            Protected by enterprise-grade encryption<br/>
            <a href="#">Privacy Policy</a> · <a href="#">Terms of Service</a> · <a href="#">HIPAA Notice</a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function CCDAAnalyzer() {
  const [authed, setAuthed] = useState(false);
  const [panel, setPanel] = useState("input");
  const [fileQueue, setFileQueue] = useState([]);
  const [results, setResults] = useState(null);
  const [fhirBundles, setFhirBundles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [valueSets, setValueSets] = useState([]);
  const [modal, setModal] = useState({ open:false, title:"", content:null });

  const openModal = useCallback((title, content) => setModal({ open:true, title, content }), []);
  const closeModal = useCallback(() => setModal(m => ({ ...m, open:false })), []);

  useEffect(() => {
    ccdaApi.getValueSets().then(d => setValueSets(d.value_sets||[])).catch(()=>{});
  }, []);

  const meta = NAV_META[panel] || NAV_META.input;
  const analyzed = results?.length || 0;

  // called when samples are loaded (pre-analyzed) or after runAnalysis
  function handleResults(data, opts) {
    if (data.results) setResults(data.results);
    if (data.fhir_bundles) setFhirBundles(data.fhir_bundles);
    if (!opts?.noNav && data.results?.length) setPanel("quality");
  }

  async function runAnalysis() {
    const fileObjs = fileQueue.filter(f => f.file instanceof File).map(f => f.file);
    const preloaded = fileQueue.filter(f => f._preloaded);

    // preloaded samples — animate per-file progress then apply cached results
    if (fileObjs.length === 0 && preloaded.length > 0) {
      setLoading(true); setAnalysisComplete(false); setProgressPct(0);
      for (let i = 0; i < preloaded.length; i++) {
        setProgressMsg(`Analyzing ${i+1}/${preloaded.length}: ${preloaded[i].name}…`);
        setProgressPct(Math.round((i / preloaded.length) * 100));
        await new Promise(r => setTimeout(r, 250));
      }
      setProgressPct(100);
      await new Promise(r => setTimeout(r, 200));
      setResults(preloaded.map(f => f._preloaded));
      setFhirBundles(preloaded.map(f => f._fhirBundle).filter(Boolean));
      setLoading(false); setProgressMsg(""); setAnalysisComplete(true);
      return;
    }
    if (!fileObjs.length) { alert("No files to analyze. Upload XML files or load samples."); return; }

    // real files — analyze one at a time for per-file progress
    setLoading(true); setAnalysisComplete(false); setProgressPct(0);
    const allResults = [], allBundles = [];
    try {
      for (let i = 0; i < fileObjs.length; i++) {
        const f = fileObjs[i];
        setProgressMsg(`Analyzing ${i+1}/${fileObjs.length}: ${f.name}…`);
        setProgressPct(Math.round((i / fileObjs.length) * 100));
        const [anaData, fhirData] = await Promise.all([
          ccdaApi.analyze([f]),
          ccdaApi.convertFhir([f]),
        ]);
        allResults.push(...(anaData.results||[]));
        allBundles.push(...(fhirData.bundles||[]));
      }
      setProgressPct(100);
      await new Promise(r => setTimeout(r, 200));
      setResults(allResults);
      setFhirBundles(allBundles);
      setAnalysisComplete(true);
    } catch(e) {
      alert("Analysis failed: " + e.message);
    } finally {
      setLoading(false); setProgressMsg("");
    }
  }

  function navTo(p) {
    setPanel(p);
  }

  const hasFhir = fhirBundles.length > 0;

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;

  return (
    <div className="ccda-page">
      {/* ── Sidebar ── */}
      <aside className="sb">
        <div className="sb-logo">
          <div className="sb-logo-mark">
            <svg width="38" height="26" viewBox="0 0 52 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="EXL">
              <rect width="52" height="36" rx="4" fill="#F05921"/>
              <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
                fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="17" fill="white" letterSpacing="1">
                EXL
              </text>
            </svg>
            <span className="sb-brand">CCDA<span style={{ color:"var(--red)" }}>·</span>AI</span>
          </div>
          <div className="sb-tagline">Clinical Intelligence</div>
        </div>

        <nav className="sb-nav">
          <div className="sb-section">Workflow</div>
          <div className={`sb-item${panel==="input"?" on":""}`} style={(panel==="fhir"||panel==="sql")?{borderLeftColor:"rgba(214,59,16,.35)"}:{}} onClick={() => navTo("input")}>
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v2H2zm0 4h8v2H2zm0 4h6v2H2z"/></svg>
            Data Ingestion
            <span className="sb-badge">{fileQueue.length||"0"}</span>
          </div>
          <div className={`sb-subitem${panel==="fhir"?" on":""}`} onClick={() => navTo("fhir")}>
            <svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="1" width="10" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            FHIR Conversion
            <span className="sb-badge">{hasFhir ? fhirBundles.length : "—"}</span>
          </div>
          <div className={`sb-subitem${panel==="sql"?" on":""}`} onClick={() => navTo("sql")}>
            <svg viewBox="0 0 16 16" fill="currentColor"><ellipse cx="8" cy="4" rx="6" ry="2.5" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M2 4v4c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V4" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M2 8v4c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V8" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg>
            SQL Server Loader
            <span className="sb-badge">{hasFhir ? fhirBundles.length : "—"}</span>
          </div>
          <div className={`sb-item${panel==="quality"?" on":""}`} onClick={() => navTo("quality")}>
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.8 4.1L14 6l-3 2.9.7 4.1L8 11l-3.7 2 .7-4.1L2 6l4.2-.9z"/></svg>
            CCDA Quality Analysis
            <span className="sb-badge">{analyzed||"—"}</span>
          </div>
          <div className="sb-divider"/>
          <div className="sb-section">Dashboards</div>
          <div className={`sb-item${panel==="hedis"?" on":""}`} onClick={() => navTo("hedis")}>
            <svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="9" width="3" height="6"/><rect x="6" y="5" width="3" height="10"/><rect x="11" y="1" width="3" height="14"/></svg>
            HEDIS Dashboard
            <span className="sb-badge">{analyzed ? (results||[]).filter(r=>(r.hedis||[]).some(h=>h.numer_hit)).length : "—"}</span>
          </div>
          <div className={`sb-item${panel==="loinc"?" on":""}`} onClick={() => navTo("loinc")}>
            <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M5.5 8h5M8 5.5v5" stroke="currentColor" strokeWidth="1.5"/></svg>
            LOINC Analysis
            <span className="sb-badge">{analyzed ? (results||[]).filter(r=>(r.loinc?.count||0)>0).length : "—"}</span>
          </div>
          <div className={`sb-item${panel==="narrative"?" on":""}`} onClick={() => navTo("narrative")}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M2 3h12v1.5H2zm0 3.5h12v1.5H2zm0 3.5h7v1.5H2zm0 3.5h5v1.5H2z"/>
              <circle cx="12.5" cy="11.5" r="2.5"/><path d="M14.5 13.5l1.2 1.2" strokeLinecap="round"/>
            </svg>
            Narrative Intel
            <span className="sb-badge">{analyzed ? (results||[]).filter(r=>(r.narrative?.total_words||0)>0).length : "—"}</span>
          </div>
        </nav>

        <div className="sb-bottom">
          <div className="sb-stat">Files Loaded <span>{fileQueue.length}</span></div>
          <div className="sb-stat">Analyzed <span>{analyzed}</span></div>
          <div className="sb-version">EXL · CCDA·AI Platform · 2025</div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="main">
        {/* topbar */}
        <div className="topbar">
          <div>
            <div className="tb-title">{meta.title}</div>
            <div className="tb-sub">{meta.sub}</div>
          </div>
          <div className="tb-right">
            <div className="tb-pill">
              <span className="tb-dot"/>
              {loading ? "Processing…" : "Ready"} · <strong>{fileQueue.length}</strong> files
            </div>
            <button className="btn btn-p" onClick={runAnalysis} disabled={loading || fileQueue.length === 0}>
              {loading ? (
                <><span className="spin" style={{ borderTopColor:"#fff" }}/>Analyzing…</>
              ) : (
                <><svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2l10 6-10 6V2z"/></svg>Execute Workflow</>
              )}
            </button>
          </div>
        </div>

        {/* content panels */}
        <div className="content">
          <ErrorBoundary>
          <div className={`panel${panel==="input"?" on":""}`}>
            <InputPanel
              fileQueue={fileQueue} setFileQueue={setFileQueue}
              onRun={handleResults} navTo={navTo}
              loading={loading} progressMsg={progressMsg} progressPct={progressPct}
              analysisComplete={analysisComplete}
              results={results} valueSets={valueSets}/>
          </div>
          <div className={`panel${panel==="quality"?" on":""}`}>
            <QualityPanel results={results} openModal={openModal}/>
          </div>
          <div className={`panel${panel==="hedis"?" on":""}`}>
            <HedisPanel results={results} valueSets={valueSets} openModal={openModal}/>
          </div>
          <div className={`panel${panel==="loinc"?" on":""}`}>
            <LoincPanel results={results} openModal={openModal}/>
          </div>
          <div className={`panel${panel==="narrative"?" on":""}`}>
            <NarrativePanel results={results} openModal={openModal}/>
          </div>
          <div className={`panel${panel==="fhir"?" on":""}`}>
            <FhirPanel fhirBundles={fhirBundles}/>
          </div>
          <div className={`panel${panel==="sql"?" on":""}`}>
            <SqlPanel fhirBundles={fhirBundles} openModal={openModal}/>
          </div>
          </ErrorBoundary>
        </div>
      </div>

      <Modal open={modal.open} title={modal.title} onClose={closeModal}>
        {modal.content}
      </Modal>
    </div>
  );
}
