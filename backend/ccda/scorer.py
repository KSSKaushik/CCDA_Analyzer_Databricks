import re
from datetime import datetime, timedelta
from .constants import OID, CS
from .parser import find_section, sec_codes, pat_info, all_codes, count_open_close_tags


def _mk_iss(sev, dim, title, detail, remediation, impact, evidence=None):
    return {
        "sev": sev, "dim": dim, "title": title,
        "detail": detail, "remediation": remediation,
        "impact": impact, "evidence": evidence,
    }


def score_term(root, codes: list) -> dict:
    s = 0
    issues = []
    loinc  = [c for c in codes if c["sys"] == CS["LOINC"]]
    snomed = [c for c in codes if c["sys"] == CS["SNOMED"]]
    rxnorm = [c for c in codes if c["sys"] == CS["RXNORM"]]
    icd10  = [c for c in codes if c["sys"] == CS["ICD10"]]
    cpt    = [c for c in codes if c["sys"] == CS["CPT"]]

    vocab_rows = [
        {"cells": ["LOINC",     f"{len(loinc)} codes" if loinc else "0 — MISSING",  "Required for labs/vitals" if loinc else "Labs/vitals have no LOINC codes"], "st": "ok" if loinc else "bad"},
        {"cells": ["SNOMED CT", f"{len(snomed)} codes" if snomed else "0 — MISSING", "Required for problems/findings" if snomed else "Problems use no SNOMED CT"], "st": "ok" if snomed else "bad"},
        {"cells": ["RxNorm",    f"{len(rxnorm)} codes" if rxnorm else "0 — MISSING", "Required for medications" if rxnorm else "Medications have no RxNorm codes"], "st": "ok" if rxnorm else "bad"},
        {"cells": ["ICD-10-CM", f"{len(icd10)} codes" if icd10 else "0",             "Present" if icd10 else "Not found (OK if SNOMED used)"], "st": "ok" if icd10 else "warn"},
        {"cells": ["CPT",       f"{len(cpt)} codes" if cpt else "0",                 "Procedure codes present" if cpt else "No CPT (optional)"], "st": "ok"},
    ]
    vocab_ev = {"type": "table", "cols": ["Vocabulary","Count","Status"], "rows": vocab_rows}

    if loinc:  s += 20
    else:
        issues.append(_mk_iss("critical","terminology","No LOINC codes present",
            "Zero LOINC-coded elements found. Lab results, vital signs, and clinical observations must be coded with LOINC per C-CDA 2.1.",
            "Map all lab orders, results, and vital sign observations to LOINC codes.",
            "HbA1c, LDL, BMI HEDIS numerators cannot be evaluated.", vocab_ev))

    if snomed: s += 20
    else:
        issues.append(_mk_iss("critical","terminology","No SNOMED CT codes present",
            "Zero SNOMED CT entries found. Problems, diagnoses, and clinical findings must use SNOMED CT.",
            "Recode problem list entries to SNOMED CT.",
            "Diabetes, hypertension HEDIS denominators cannot be computed.", vocab_ev))

    if rxnorm: s += 20
    else:
        issues.append(_mk_iss("critical","terminology","No RxNorm codes present",
            "Medication entries lack RxNorm codes. Active medications cannot be identified.",
            "Add RxNorm CUI to every <substanceAdministration>.",
            "Medication reconciliation HEDIS (MRP) cannot be evaluated.", vocab_ev))

    if icd10 or snomed: s += 15
    else:
        issues.append(_mk_iss("warning","terminology","No ICD-10 or SNOMED diagnosis codes",
            "Neither ICD-10-CM nor SNOMED CT codes are present.",
            "Add ICD-10-CM codes to encounter diagnoses and SNOMED CT codes to the problem list.",
            "Chronic condition HEDIS measures (CBP, CDC) will return false negatives.", vocab_ev))

    null_codes = [c for c in codes if not c["code"] or c["code"] in ("UNK","OTH","NA","NASK")]
    if null_codes:
        s += 5
        null_rows = [{"cells": [c["code"] or "(empty)", c["sys"] or "—", c["disp"] or "(no display)", "Null / unknown value"], "st": "bad"} for c in null_codes[:20]]
        issues.append(_mk_iss("warning","terminology",f"{len(null_codes)} code(s) with null or unknown values",
            f"{len(null_codes)} coded element(s) use nullFlavor or have empty/unknown code values.",
            "Replace null-flavored codes with specific, valid vocabulary codes.",
            "Null codes are excluded from all quality computations.",
            {"type": "table", "cols": ["Code","System (OID)","Display Name","Issue"], "rows": null_rows}))
    else:
        s += 15

    no_disp = [c for c in codes if c["code"] and c["sys"] and not c["disp"]]
    if len(no_disp) >= 3:
        s += 3
        disp_rows = [{"cells": [c["code"], c["sys"], "(no displayName)", "displayName missing"], "st": "warn"} for c in no_disp[:20]]
        issues.append(_mk_iss("info","terminology",f"{len(no_disp)} codes missing displayName",
            f"{len(no_disp)} <code> elements have code+codeSystem but no displayName attribute.",
            "Add displayName to all <code> elements using the preferred term from the originating vocabulary.",
            "Affects rendering in EHR viewers. Makes audit and review harder.",
            {"type": "table", "cols": ["Code","System (OID)","displayName","Issue"], "rows": disp_rows}))
    else:
        s += 10

    return {
        "score": min(100, s), "issues": issues,
        "detail": {"loinc": len(loinc), "snomed": len(snomed), "rxnorm": len(rxnorm), "icd10": len(icd10)},
    }


def score_comp(root) -> dict:
    s = 0
    issues = []
    secs = {}
    checks = [
        {"k": "allergies",   "oids": OID["ALLERGIES"],   "pts": 10, "lbl": "Allergies & Intolerances",
         "fix": "Add Allergies section (templateId 2.16.840.1.113883.10.20.22.2.6.1) with RxNorm/SNOMED coded allergens."},
        {"k": "medications", "oids": OID["MEDICATIONS"],  "pts": 10, "lbl": "Medications",
         "fix": "Add Medications section (templateId 2.16.840.1.113883.10.20.22.2.1.1) with RxNorm-coded entries."},
        {"k": "problems",    "oids": OID["PROBLEMS"],     "pts": 10, "lbl": "Problem List",
         "fix": "Add Problem List section (templateId 2.16.840.1.113883.10.20.22.2.5.1) with SNOMED CT / ICD-10 coded conditions."},
        {"k": "results",     "oids": OID["RESULTS"],      "pts": 10, "lbl": "Results / Lab Data",
         "fix": "Add Results section (templateId 2.16.840.1.113883.10.20.22.2.3.1) with LOINC-coded observations."},
        {"k": "procedures",  "oids": OID["PROCEDURES"],   "pts": 8,  "lbl": "Procedures",
         "fix": "Add Procedures section (templateId 2.16.840.1.113883.10.20.22.2.7.1) with CPT or SNOMED coded procedures."},
        {"k": "encounters",  "oids": OID["ENCOUNTERS"],   "pts": 10, "lbl": "Encounters",
         "fix": "Add Encounters section (templateId 2.16.840.1.113883.10.20.22.2.22.1) with dated visit entries."},
        {"k": "vitals",      "oids": OID["VITALS"],       "pts": 8,  "lbl": "Vital Signs",
         "fix": "Add Vital Signs section (templateId 2.16.840.1.113883.10.20.22.2.4.1) with LOINC-coded observations."},
        {"k": "social",      "oids": OID["SOCIAL"],       "pts": 6,  "lbl": "Social History",
         "fix": "Add Social History section (templateId 2.16.840.1.113883.10.20.22.2.17) with SNOMED-coded tobacco/alcohol use."},
        {"k": "immunize",    "oids": OID["IMMUNIZE"],     "pts": 4,  "lbl": "Immunizations",
         "fix": "Add Immunizations section (templateId 2.16.840.1.113883.10.20.22.2.2.1) with CVX-coded vaccine administrations."},
    ]

    sec_ev_rows = []
    for c in checks:
        sec = find_section(root, c["oids"])
        secs[c["k"]] = sec is not None
        if sec is not None:
            s += c["pts"]
            sec_ev_rows.append({"cells": [c["lbl"], "Present", f"+{c['pts']} pts", ""], "st": "ok"})
        else:
            sec_ev_rows.append({"cells": [c["lbl"], "MISSING", "0 pts", c["fix"]], "st": "bad"})

    missing = [c for c in checks if not secs[c["k"]]]
    if missing:
        issues.append(_mk_iss("warning","completeness",f"{len(missing)} required section(s) missing",
            f"{len(missing)} of the 9 required C-CDA sections are absent: {', '.join(c['lbl'] for c in missing)}.",
            "Add each missing section with the correct C-CDA 2.1 templateId and coded entries.",
            "Missing sections prevent evaluation of multiple HEDIS measures.",
            {"type": "table", "cols": ["Section","Status","Score Impact","Remediation Note"], "rows": sec_ev_rows}))

    p = pat_info(root)
    demo_items = [
        {"k": "Given (first) name",       "v": p["first_name"] or "MISSING", "st": "ok" if p["first_name"] else "bad"},
        {"k": "Family (last) name",        "v": p["last_name"] or "MISSING",  "st": "ok" if p["last_name"] else "bad"},
        {"k": "Administrative gender",     "v": p["gender"] or "MISSING",     "st": "ok" if p["gender"] else "bad"},
        {"k": "Birth date (birthTime)",    "v": p["birth_date"] or "MISSING",  "st": "ok" if p["birth_date"] else "bad"},
        {"k": "Patient address (addr)",    "v": "Present" if p["has_addr"] else "MISSING", "st": "ok" if p["has_addr"] else "bad"},
    ]
    demo_ok = sum(1 for d in demo_items if d["st"] == "ok")
    demo_bad = [d for d in demo_items if d["st"] == "bad"]
    if demo_ok >= 4:
        s += 12
    elif demo_ok >= 2:
        s += 5
        issues.append(_mk_iss("warning","completeness",f"Incomplete demographics — {demo_ok}/5 fields present",
            f"Missing: {', '.join(d['k'] for d in demo_bad)}.",
            "Populate all required fields inside <recordTarget>/<patientRole>/<patient>.",
            "Incomplete demographics risk patient misidentification.",
            {"type": "kv", "items": demo_items}))
    else:
        issues.append(_mk_iss("critical","completeness",f"Patient demographics severely incomplete — {demo_ok}/5 fields",
            f"Only {demo_ok} of 5 required demographic fields are present.",
            "Add given name, family name, administrativeGenderCode, birthTime, and addr.",
            "Without adequate demographics this document cannot be used for attribution or quality reporting.",
            {"type": "kv", "items": demo_items}))

    enc_sec = find_section(root, OID["ENCOUNTERS"])
    if enc_sec is not None and sec_codes(enc_sec):
        s += 4
    else:
        issues.append(_mk_iss("info","completeness","Diagnoses may not be linked to encounters",
            "The Encounters section is absent or entries lack coded diagnoses.",
            "For each encounter entry add <entryRelationship typeCode='RSON'> with the primary ICD-10 or SNOMED diagnosis.",
            "Without linkage, episode-of-care quality measures cannot determine which diagnoses were active at which visit.",
            None))

    return {"score": min(100, s), "issues": issues, "secs": secs}


def score_acc(root, xml_str: str, codes: list) -> dict:
    s = 100
    issues = []
    now = datetime.now()

    # 1. Future dates
    future_rows = []
    for el in root.iter():
        if callable(el.tag):
            continue
        v = el.get("value")
        if not v or not re.match(r"^\d{8}", v):
            continue
        try:
            y, m, d = int(v[:4]), int(v[4:6]), int(v[6:8])
            dt = datetime(y, m, d)
            if dt > now + timedelta(days=30):
                tag = el.tag.split("}")[-1] if "}" in el.tag else el.tag
                parent_tag = el.getparent().tag.split("}")[-1] if el.getparent() is not None else ""
                future_rows.append({"cells": [f"{y}-{m:02d}-{d:02d}", tag, parent_tag, "Future date"], "st": "bad"})
        except Exception:
            pass
    if future_rows:
        s -= min(20, len(future_rows) * 4)
        issues.append(_mk_iss("warning","accuracy",f"{len(future_rows)} future date(s) detected",
            f"{len(future_rows)} date value(s) are more than 30 days in the future.",
            "Review each future-dated element. Correct data entry errors.",
            "Future-dated diagnoses may be excluded by quality measure logic.",
            {"type": "table", "cols": ["Date Value","XML Element","Parent Element","Issue"], "rows": future_rows[:15]}))

    # 2. Missing units on numeric observations
    no_unit_rows = []
    for el in root.iter():
        if callable(el.tag):
            continue
        if el.tag.split("}")[-1] == "value" and el.get("value"):
            v = el.get("value")
            if re.match(r"^\d+\.?\d*$", v) and not el.get("unit"):
                parent = el.getparent()
                code_el = None
                if parent is not None:
                    for anc in list(parent.iter()):
                        if anc.get("code") and anc.get("codeSystem"):
                            code_el = anc
                            break
                code = code_el.get("code", "—") if code_el is not None else "—"
                disp = code_el.get("displayName", "—") if code_el is not None else "—"
                no_unit_rows.append({"cells": [code, disp, v, "(no unit)", "unit attribute missing"], "st": "bad"})
    if no_unit_rows:
        s -= min(20, len(no_unit_rows) * 2)
        issues.append(_mk_iss("warning","accuracy",f"{len(no_unit_rows)} numeric observation(s) missing units",
            f"{len(no_unit_rows)} <value> elements contain numeric data with no unit attribute.",
            "Add unit attribute to every <value xsi:type='PQ'> using UCUM units.",
            "Lab result comparison for HEDIS thresholds is impossible without units.",
            {"type": "table", "cols": ["Code","Display Name","Value","Unit","Issue"], "rows": no_unit_rows[:20]}))

    # 3. Allergy-medication contradiction
    # Exclude administrative/status LOINC codes that appear in every section as metadata
    # and are not clinical substance codes (e.g. 33999-4 = "Status" observation)
    _ADMIN_CODES = {
        "33999-4",  # Status (LOINC) — sub-observation used in allergies, meds, problems, social hx
        "11450-4",  # Problem list
        "10160-0",  # History of medication use
        "48765-2",  # Allergies and adverse reactions
        "55109-3",  # Procedures
        "46240-8",  # Encounters
        "30954-2",  # Results
        "8716-3",   # Vital signs
    }
    from .parser import find_section
    aller_codes = {c["code"]: c["disp"] for c in sec_codes(find_section(root, OID["ALLERGIES"])) if c["code"] and c["code"] not in _ADMIN_CODES}
    med_codes   = {c["code"]: c["disp"] for c in sec_codes(find_section(root, OID["MEDICATIONS"])) if c["code"] and c["code"] not in _ADMIN_CODES}
    contra_rows = []
    for code, disp in aller_codes.items():
        if code in med_codes:
            contra_rows.append({"cells": [code, disp or "(no display)", "Both Allergy & Medication list", "Patient safety risk"], "st": "bad"})
    if contra_rows:
        s -= 25
        issues.append(_mk_iss("critical","accuracy",f"Allergy–medication contradiction ({len(contra_rows)} conflict(s))",
            f"{len(contra_rows)} code(s) appear in both Allergies and Medications sections.",
            "Cross-reference allergy and medication lists. Resolve each conflict.",
            "Patient safety risk — possible prescribing error.",
            {"type": "table", "cols": ["Code","Display Name","Conflict Location","Clinical Impact"], "rows": contra_rows}))

    # 4. Age plausibility
    from .parser import pat_info
    p = pat_info(root)
    if p["age"] is not None and (p["age"] < 0 or p["age"] > 130):
        s -= 15
        issues.append(_mk_iss("critical","accuracy",f"Implausible patient age — {p['age']} years",
            f"Calculated age {p['age']} years is outside the plausible range (0–130).",
            "Verify the patient birth date in the source system.",
            "Incorrect age prevents accurate HEDIS age-band stratification.",
            {"type": "kv", "items": [
                {"k": "Calculated age", "v": f"{p['age']} years", "st": "bad"},
                {"k": "Birth date (birthTime)", "v": p["birth_date"] or "not found", "st": "warn" if p["birth_date"] else "bad"},
                {"k": "Expected range", "v": "0 – 130 years", "st": "ok"},
            ]}))

    # 5. Duplicate problem codes
    pr_codes = sec_codes(find_section(root, OID["PROBLEMS"]))
    seen = {}
    dup_rows = []
    for c in pr_codes:
        if not c["code"]:
            continue
        if c["code"] in seen:
            seen[c["code"]] += 1
            dup_rows.append({"cells": [c["code"], c["disp"] or "—", c["sys"], f"Appears {seen[c['code']]} times"], "st": "warn"})
        else:
            seen[c["code"]] = 1
    if dup_rows:
        s -= 10
        issues.append(_mk_iss("info","accuracy",f"{len(dup_rows)} duplicate problem code(s)",
            "The following code(s) appear more than once in the Problem List section.",
            "Deduplicate the problem list in the source EHR.",
            "Duplicate problems may cause over-counting in diagnosis-based measure denominators.",
            {"type": "table", "cols": ["Code","Display Name","Code System","Issue"], "rows": dup_rows[:20]}))

    return {"score": max(0, s), "issues": issues}


def score_str(root, xml_str: str) -> dict:
    s = 100
    issues = []

    # Root element check
    from lxml import etree
    root_tag = etree.QName(root.tag).localname if root is not None else "unknown"
    if root_tag != "ClinicalDocument":
        s -= 30
        issues.append(_mk_iss("critical","structure","Root element is not <ClinicalDocument>",
            f"Root element is <{root_tag}> but must be <ClinicalDocument> in the HL7 v3 namespace.",
            "Ensure document root is <ClinicalDocument xmlns='urn:hl7-org:v3'>.",
            "Systems validating against the CDA schema will reject this document.",
            {"type": "kv", "items": [
                {"k": "Found root element", "v": f"<{root_tag}>", "st": "bad"},
                {"k": "Required root element", "v": "<ClinicalDocument>", "st": "ok"},
                {"k": "Required namespace", "v": "urn:hl7-org:v3", "st": "ok"},
            ]}))

    # Mandatory header elements
    mandatory = ["realmCode","typeId","id","code","title","effectiveTime","recordTarget","author","custodian","component"]
    missing_els = []
    present_els = []
    for el_name in mandatory:
        found = False
        for el in root.iter():
            if callable(el.tag):
                continue
            if etree.QName(el.tag).localname == el_name:
                found = True
                break
        if found:
            present_els.append(el_name)
        else:
            missing_els.append(el_name)
    if missing_els:
        s -= len(missing_els) * 2
        hdr_rows = (
            [{"cells": [f"<{e}>", "Present", "✓"], "st": "ok"} for e in present_els] +
            [{"cells": [f"<{e}>", "MISSING", "Required by CDA R2"], "st": "bad"} for e in missing_els]
        )
        issues.append(_mk_iss("warning","structure",f"{len(missing_els)} mandatory CDA header element(s) missing",
            f"Required CDA R2 header elements absent: {', '.join('<'+e+'>' for e in missing_els)}.",
            "Add each missing element to the document header. Reference the C-CDA 2.1 implementation guide.",
            "Missing header elements cause validation failures in receiving systems.",
            {"type": "table", "cols": ["Element","Status","Note"], "rows": hdr_rows}))

    # Empty entries
    empty_entries = [el for el in root.iter() if not callable(el.tag) and etree.QName(el.tag).localname == "entry" and len(el) == 0]
    if empty_entries:
        s -= min(12, len(empty_entries) * 3)
        empty_rows = [{"cells": [f"entry #{i+1}", etree.QName(e.getparent().tag).localname if e.getparent() is not None else "—", "No child elements", "Empty"], "st": "bad"} for i, e in enumerate(empty_entries[:10])]
        issues.append(_mk_iss("warning","structure",f"{len(empty_entries)} empty <entry> element(s)",
            f"{len(empty_entries)} <entry> elements contain no child elements.",
            "Remove empty <entry> elements or populate them with the appropriate clinical statement.",
            "Empty entries confuse receiving parsers.",
            {"type": "table", "cols": ["Entry","Parent Section","Children","Issue"], "rows": empty_rows}))

    # Sections without templateId
    all_sections = [el for el in root.iter() if not callable(el.tag) and etree.QName(el.tag).localname == "section"]
    no_tid_secs = [sec for sec in all_sections if not any(not callable(c.tag) and etree.QName(c.tag).localname == "templateId" for c in sec)]
    if no_tid_secs:
        s -= min(8, len(no_tid_secs) * 2)
        tid_rows = []
        for i, sec in enumerate(no_tid_secs[:10]):
            code_el = next((c for c in sec.iter() if c.get("code")), None)
            code = code_el.get("code", "—") if code_el is not None else "—"
            disp = code_el.get("displayName", "—") if code_el is not None else "—"
            tid_rows.append({"cells": [f"section #{i+1}", code, disp, "No templateId"], "st": "warn"})
        issues.append(_mk_iss("info","structure",f"{len(no_tid_secs)} section(s) without templateId",
            f"{len(no_tid_secs)} <section> element(s) are missing <templateId> declarations.",
            "Add the appropriate C-CDA 2.1 templateId to each section.",
            "Without templateIds, quality measure extraction engines that use template-based section discovery will miss these sections.",
            {"type": "table", "cols": ["Section","Code","Display Name","Issue"], "rows": tid_rows}))

    # Tag balance
    opens, closes = count_open_close_tags(xml_str)
    diff = abs(opens - closes)
    if diff > 2:
        s -= 12
        issues.append(_mk_iss("warning","structure","Possible malformed or unclosed XML tags",
            f"Tag balance check: {opens} opening tags vs {closes} closing tags (difference: {diff}).",
            "Run through an XML validator. Find and close all unclosed tags.",
            "Malformed XML may be silently truncated by lenient parsers or rejected entirely by strict ones.",
            {"type": "kv", "items": [
                {"k": "Opening tags found", "v": opens, "st": "ok"},
                {"k": "Closing tags found", "v": closes, "st": "bad" if diff > 2 else "ok"},
                {"k": "Difference (expected ≤2)", "v": diff, "st": "bad" if diff > 2 else "ok"},
            ]}))

    return {"score": max(0, min(100, s)), "issues": issues}


def analyze_file(name: str, xml_bytes: bytes) -> dict:
    from .parser import parse_xml
    from .hedis import analyze_hedis
    from .loinc_analysis import analyze_loinc
    from .narrative import analyze_narrative

    xml_str = xml_bytes.decode("utf-8", errors="replace")
    root, err = parse_xml(xml_bytes)

    if root is None or err:
        fatal = [_mk_iss("critical","structure","Fatal XML parse error",
                          f"Could not parse: {err}", "Fix XML syntax and re-export.", "-", None)]
        return {
            "name": name, "size": len(xml_bytes), "error": err,
            "scores": {"overall": 0, "terminology": 0, "completeness": 0, "accuracy": 0, "structure": 0},
            "rich_issues": fatal, "issues": ["Fatal parse error: " + str(err)],
            "secs": {}, "hedis": [], "loinc": {}, "narrative": {}, "pat": {}, "codes": {},
        }

    codes = all_codes(root)
    t  = score_term(root, codes)
    c  = score_comp(root)
    a  = score_acc(root, xml_str, codes)
    st = score_str(root, xml_str)

    overall = round(t["score"] * 0.25 + c["score"] * 0.35 + a["score"] * 0.25 + st["score"] * 0.15)
    rich_issues = t["issues"] + c["issues"] + a["issues"] + st["issues"]

    from .parser import pat_info
    return {
        "name": name,
        "size": len(xml_bytes),
        "error": None,
        "scores": {
            "overall": overall,
            "terminology": round(t["score"]),
            "completeness": round(c["score"]),
            "accuracy": round(a["score"]),
            "structure": round(st["score"]),
        },
        "rich_issues": rich_issues,
        "issues": [i["title"] for i in rich_issues],
        "secs": c["secs"],
        "hedis": analyze_hedis(root, codes),
        "loinc": analyze_loinc(root, codes),
        "narrative": analyze_narrative(root, codes),
        "pat": pat_info(root),
        "codes": t["detail"],
    }
