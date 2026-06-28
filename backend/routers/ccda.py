import io
import json
import os
import re
import zipfile
import httpx
from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import StreamingResponse

from ccda.scorer import analyze_file
from ccda.fhir import build_fhir_bundle
from ccda.sql_loader import create_tables, load_bundle, truncate_all, get_table_counts, get_ddl
from ccda.constants import SQL_TABLES, HEDIS_VS_STATIC, LOINC_NAMES
from ccda.samples import SAMPLE_PATIENTS, make_ccda
from database import get_connection

router = APIRouter(prefix="/api/ccda", tags=["ccda"])


@router.post("/analyze")
async def analyze_ccda(files: list[UploadFile] = File(...)):
    results = []
    for f in files:
        name = f.filename or "unknown.xml"
        try:
            content = await f.read()
            result = analyze_file(name, content)
            result.pop("xml", None)
        except Exception as exc:
            result = {"name": name, "error": str(exc), "scores": {}, "issues": []}
        results.append(result)
    return {"results": results, "count": len(results)}


@router.post("/fhir/convert")
async def convert_to_fhir(files: list[UploadFile] = File(...)):
    bundles = []
    for f in files:
        name = f.filename or "unknown.xml"
        try:
            content = await f.read()
            bundle = build_fhir_bundle(name, content)
            if bundle:
                meta = bundle.pop("_meta", {})
                bundle["_counts"] = meta.get("counts", {})
                bundle["_source_file"] = meta.get("sourceFile", "")
                bundles.append(bundle)
        except Exception as exc:
            bundles.append({"_source_file": name, "_error": str(exc), "entry": [], "_counts": {}})
    return {"bundles": bundles, "count": len(bundles)}


@router.post("/fhir/export-zip")
async def export_fhir_zip(files: list[UploadFile] = File(...)):
    buf = io.BytesIO()
    manifest = {"generated": "", "files": [], "total_resources": 0, "bundles": []}
    from datetime import datetime
    manifest["generated"] = datetime.utcnow().isoformat() + "Z"

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            content = await f.read()
            bundle = build_fhir_bundle(f.filename or "unknown.xml", content)
            if not bundle:
                continue
            meta = bundle.pop("_meta", {})
            counts = meta.get("counts", {})
            fname = (f.filename or "unknown").replace(".xml", "") + "_fhir.json"
            zf.writestr(fname, json.dumps(bundle, indent=2, default=str))
            manifest["files"].append(fname)
            manifest["total_resources"] += counts.get("total", 0)
            manifest["bundles"].append({"file": f.filename, **counts})

        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=ccda-fhir-export.zip"},
    )


@router.get("/sql/ddl")
async def get_sql_ddl():
    return {"ddl": get_ddl(), "tables": SQL_TABLES}


@router.post("/sql/create-tables")
async def sql_create_tables():
    try:
        conn = get_connection()
        result = create_tables(conn)
        conn.close()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sql/load")
async def sql_load_bundles(files: list[UploadFile] = File(...)):
    try:
        conn = get_connection()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB connection failed: {e}")

    total_inserted = 0
    errors = []
    for f in files:
        content = await f.read()
        bundle = build_fhir_bundle(f.filename or "unknown.xml", content)
        if not bundle:
            errors.append(f"{f.filename}: FHIR conversion failed")
            continue
        # Restore _meta for loader
        meta_counts = bundle.pop("_counts", {})
        meta_source = bundle.pop("_source_file", f.filename or "unknown")
        bundle["_meta"] = {"sourceFile": meta_source, "counts": meta_counts}
        res = load_bundle(conn, bundle)
        if res["success"]:
            total_inserted += res["rows_inserted"]
        else:
            errors.append(f"{f.filename}: {res.get('message', 'unknown error')}")

    conn.close()
    return {
        "success": len(errors) == 0,
        "total_rows_inserted": total_inserted,
        "files_processed": len(files),
        "errors": errors,
    }


@router.get("/sql/status")
async def sql_status():
    try:
        conn = get_connection()
        counts = get_table_counts(conn)
        conn.close()
        return {"connected": True, "table_counts": counts, "tables": SQL_TABLES}
    except Exception as e:
        return {"connected": False, "error": str(e), "table_counts": {}, "tables": SQL_TABLES}


@router.post("/sql/truncate")
async def sql_truncate():
    try:
        conn = get_connection()
        result = truncate_all(conn)
        conn.close()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/meta/value-sets")
async def get_value_sets():
    vs_list = []
    for name, vs in HEDIS_VS_STATIC.items():
        codes_map = vs.get("codes", {})
        total_codes = sum(len(c) for c in codes_map.values())
        vs_list.append({
            "name": name,
            "oid": vs.get("oid"),
            "measure": vs.get("measure"),
            "role": vs.get("role"),
            "total_codes": total_codes,
            "systems": list(codes_map.keys()),
            "systems_counts": {sys: len(codes) for sys, codes in codes_map.items()},
        })
    return {"value_sets": vs_list, "count": len(vs_list)}


@router.get("/meta/loinc-names")
async def get_loinc_names():
    return {"loinc_names": LOINC_NAMES}


@router.post("/narrative/verify-gaps")
async def verify_narrative_gaps(payload: dict):
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not set in backend .env")

    gaps          = payload.get("gaps", [])
    coded_display = payload.get("coded_display", [])
    section_label = payload.get("section_label", "")

    if not gaps:
        return {"verified": []}

    coded_list = "\n".join(f"- {d}" for d in coded_display[:80]) or "(none available)"
    gaps_list  = "\n".join(
        f'{i+1}. [{g.get("type_label", g.get("type","?"))}] {g.get("text","")}'
        for i, g in enumerate(gaps)
    )

    prompt = f"""You are a clinical informatics expert reviewing CCDA document quality.

The CCDA section "{section_label}" contains these STRUCTURED coded entries (display names):
{coded_list}

The following findings were extracted from the NARRATIVE (free text) of that same section and flagged as potential gaps — not matched against the structured data above:

{gaps_list}

For each numbered finding, classify it as exactly one of:
- "genuine_gap"   — clinical information truly absent from the structured coded data
- "false_positive" — information IS captured in structured data under a different label, abbreviation, or terminology
- "noise"         — not a clinical finding (date, table header, formatting artifact, column label)

Return ONLY a valid JSON array, no markdown, no preamble:
[{{"index": 1, "verdict": "genuine_gap", "reason": "max 8 words"}}, ...]"""

    try:
        async with httpx.AsyncClient(timeout=40) as client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": "meta-llama/llama-3.3-70b-instruct",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                },
            )
        if not resp.is_success:
            raise HTTPException(status_code=502, detail=f"OpenRouter {resp.status_code}: {resp.text}")
        content = resp.json()["choices"][0]["message"]["content"].strip()
        # Strip markdown code fences
        if content.startswith("```"):
            content = "\n".join(content.split("\n")[1:])
        if content.endswith("```"):
            content = content.rsplit("```", 1)[0]
        content = content.strip()
        # Extract JSON array even if model adds surrounding prose
        m = re.search(r"\[.*\]", content, re.DOTALL)
        if m:
            content = m.group(0)
        verdicts = json.loads(content)
        verdict_map = {v["index"]: v for v in verdicts}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM verification failed: {e}")

    verified = []
    for i, g in enumerate(gaps):
        v = verdict_map.get(i + 1, {})
        verified.append({**g, "verdict": v.get("verdict", "genuine_gap"), "reason": v.get("reason", "")})

    return {"verified": verified}


@router.get("/samples")
async def get_samples():
    results = []
    fhir_bundles = []
    for s in SAMPLE_PATIENTS:
        xml_str = make_ccda(**s["params"])
        xml_bytes = xml_str.encode("utf-8")
        result = analyze_file(s["name"], xml_bytes)
        result.pop("xml", None)
        results.append(result)
        bundle = build_fhir_bundle(s["name"], xml_bytes)
        if bundle:
            meta = bundle.pop("_meta", {})
            bundle["_counts"] = meta.get("counts", {})
            bundle["_source_file"] = meta.get("sourceFile", s["name"])
            fhir_bundles.append(bundle)
    return {"results": results, "fhir_bundles": fhir_bundles, "count": len(results)}
