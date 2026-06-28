import re
from lxml import etree
from .constants import OID
from .parser import find_section, get_narrative_text

NARR_SECTIONS = [
    {"k": "allergies",   "oids": OID["ALLERGIES"],   "lbl": "Allergies",      "cls": "f-alert"},
    {"k": "medications", "oids": OID["MEDICATIONS"],  "lbl": "Medications",    "cls": "f-note"},
    {"k": "problems",    "oids": OID["PROBLEMS"],     "lbl": "Problem List",   "cls": "f-clinical"},
    {"k": "results",     "oids": OID["RESULTS"],      "lbl": "Results",        "cls": "f-lab"},
    {"k": "procedures",  "oids": OID["PROCEDURES"],   "lbl": "Procedures",     "cls": "f-clinical"},
    {"k": "encounters",  "oids": OID["ENCOUNTERS"],   "lbl": "Encounters",     "cls": "f-clinical"},
    {"k": "vitals",      "oids": OID["VITALS"],       "lbl": "Vital Signs",    "cls": "f-lab"},
    {"k": "social",      "oids": OID["SOCIAL"],       "lbl": "Social History", "cls": "f-social"},
    {"k": "immunize",    "oids": OID["IMMUNIZE"],     "lbl": "Immunizations",  "cls": "f-note"},
]

NARR_PATTERNS = {
    "medications": [
        re.compile(r"\b(\d+)\s*(mg|mcg|mEq|units?|IU)\b", re.IGNORECASE),
        re.compile(r"\b(daily|BID|TID|QID|q\d+h|once daily|twice daily|PRN|as needed)\b", re.IGNORECASE),
        re.compile(r"\b([A-Z][a-z]{3,}(?:in|ol|ide|ate|mab|ine|pam|lol|statin|pril|sartan|mycin|cycline|cillin|azole|vir))\b"),
    ],
    "lab_values": [
        re.compile(r"\b(\d+\.?\d*)\s*(mg/dL|mmol/L|g/dL|mEq/L|%|IU/L|U/L|ng/mL|pg/mL|mmHg|bpm|kg/m2|mL/min)\b", re.IGNORECASE),
        re.compile(r"\b(HbA1c|A1C|eGFR|LDL|HDL|BUN|TSH|PSA|INR|PT|PTT|CBC|BMP|CMP|HGB|WBC|PLT)\b", re.IGNORECASE),
    ],
    "conditions": [
        re.compile(r"\b(diabetes|hypertension|obesity|hyperlipidemia|COPD|asthma|depression|anxiety|cancer|carcinoma|pneumonia|infection|sepsis|failure|disease|disorder|syndrome|insufficiency)\b", re.IGNORECASE),
        re.compile(r"\b(chronic|acute|bilateral|unilateral|severe|moderate|mild|stable|unstable|controlled|uncontrolled)\b", re.IGNORECASE),
    ],
    "negations": [
        re.compile(r"\b(no|not|denies|denied|without|negative for|rules? out|ruled out|absent|absence of|never)\b\s+(\w+(?:\s+\w+){0,3})", re.IGNORECASE),
    ],
    "procedures": [
        re.compile(r"\b(colonoscopy|mammograph\w*|biopsy|CT|MRI|X-ray|ultrasound|EKG|ECG|echocardiogram|stress test|spirometry|endoscopy|surgery|resection|excision)\b", re.IGNORECASE),
    ],
    "social": [
        re.compile(r"\b(smok\w*|tobacco|cigarette|alcohol|drink\w*|drug|cocaine|heroin|marijuana|cannabis|exercise|physical activity|diet|nutrition|homeless|unemployed|married|single|widowed)\w*", re.IGNORECASE),
    ],
}


def tokenise_narrative(text: str) -> list[dict]:
    tokens = []
    seen = set()

    def add(match_str: str, token_type: str):
        val = (match_str or "").strip()
        if not val or len(val) < 2:
            return
        key = f"{token_type}::{val.lower()}"
        if key in seen:
            return
        seen.add(key)
        tokens.append({"val": val, "type": token_type})

    for pat in NARR_PATTERNS["lab_values"]:
        for m in pat.finditer(text):
            add(m.group(0), "lab")
    for pat in NARR_PATTERNS["medications"]:
        for m in pat.finditer(text):
            add(m.group(0), "med")
    for pat in NARR_PATTERNS["conditions"]:
        for m in pat.finditer(text):
            add(m.group(0), "cond")
    for pat in NARR_PATTERNS["negations"]:
        for m in pat.finditer(text):
            add(m.group(0), "neg")
    for pat in NARR_PATTERNS["procedures"]:
        for m in pat.finditer(text):
            add(m.group(0), "proc")
    for pat in NARR_PATTERNS["social"]:
        for m in pat.finditer(text):
            add(m.group(0), "social")

    return tokens


def extract_findings(text: str, section_cls: str = "f-clinical") -> list[dict]:
    findings = []
    if not text:
        return findings
    lines = re.split(r"\n|(?<=\.)\s+(?=[A-Z])", text)
    lines = [l.strip() for l in lines if len(l.strip()) > 6]
    for line in lines:
        lower = line.lower()
        if re.search(r"\b(no |not |denies |denied |without |negative for |absent)\b", line, re.IGNORECASE):
            findings.append({"type": "neg", "type_label": "Negated Finding", "cls": "f-note", "text": line})
            continue
        if (re.search(r"\d+\.?\d*\s*(mg/dL|mmol|%|mmHg|bpm|kg/m2|mEq|g/dL|IU|ng|pg)", line, re.IGNORECASE) or
                re.search(r"\b(HbA1c|A1C|LDL|HDL|eGFR|BMI|BP|CBC|TSH)\b", line, re.IGNORECASE)):
            findings.append({"type": "lab", "type_label": "Lab / Vital Value", "cls": "f-lab", "text": line})
            continue
        if (re.search(r"\b\d+\s*(mg|mcg|mEq|IU|units?)\b", line, re.IGNORECASE) or
                re.search(r"\b(daily|BID|TID|QID|PRN|q\d+h|as needed)\b", line, re.IGNORECASE)):
            findings.append({"type": "med", "type_label": "Medication / Dosage", "cls": "f-note", "text": line})
            continue
        if re.search(r"\b(smok\w*|tobacco|alcohol|drug|exercise|diet|homeless|employ\w*|married|social)\w*", line, re.IGNORECASE):
            findings.append({"type": "social", "type_label": "Social Factor", "cls": "f-social", "text": line})
            continue
        if re.search(r"\b(colonoscopy|mammograph\w*|biopsy|CT scan|MRI|X-ray|ultrasound|EKG|ECG|endoscopy|surgery|exam)\b", line, re.IGNORECASE):
            findings.append({"type": "proc", "type_label": "Procedure / Test", "cls": "f-clinical", "text": line})
            continue
        if len(lower) > 15:
            findings.append({"type": "clinical", "type_label": "Clinical Statement", "cls": section_cls, "text": line})
    return findings


def _build_coded_display(root, codes: list[dict]) -> tuple[list[str], list[str]]:
    """Build coded display name list and code value list for gap matching."""
    coded_display = [c.get("disp", "").lower() for c in codes if c.get("disp")]

    # Include displayName from <code> elements that have no codeSystem attribute
    # (e.g. medication entries like <code displayName="metoprolol tartrate Oral Tablet 25 mg">)
    for el in root.iter():
        if el.get("code") and el.get("displayName") and not el.get("codeSystem"):
            dn = el.get("displayName", "").lower().strip()
            if len(dn) > 3 and dn not in coded_display:
                coded_display.append(dn)

    # Collect text from narrative elements referenced via <reference value="#ID"/>
    # Handles cases where structured entry displayName differs from the human-readable label
    referenced_ids = set()
    for el in root.iter():
        if callable(el.tag):
            continue
        if etree.QName(el.tag).localname == "reference" and el.get("value"):
            ref_val = el.get("value").lstrip("#")
            if ref_val:
                referenced_ids.add(ref_val)
    for el in root.iter():
        el_id = el.get("ID")
        if el_id and el_id in referenced_ids:
            txt = "".join(el.itertext()).lower().strip()
            if len(txt) > 3 and txt not in coded_display:
                coded_display.append(txt)

    # Also index raw code values (CPT "99215", LOINC "4548-4", CVX "03", etc.)
    coded_values = [c.get("code", "").lower() for c in codes if c.get("code")]

    return coded_display, coded_values


def _is_gap(finding: dict, coded_display: list[str], coded_values: list[str]) -> bool:
    """Return True if this finding has no matching coded entry."""
    if finding["type"] == "neg":
        return False
    fl = finding["text"].lower()
    if any(dn and len(dn) > 3 and dn in fl for dn in coded_display):
        return False
    # Word-boundary match against raw code values (short codes like CVX "03" are valid)
    for cv in coded_values:
        if not cv:
            continue
        try:
            if re.search(r"(?<![\w\-])" + re.escape(cv) + r"(?![\w\-])", fl):
                return False
        except re.error:
            if cv in fl:
                return False
    return True


def analyze_narrative(root, codes: list[dict]) -> dict:
    sections = {}
    total_words = 0
    total_sections = 0
    narrative_only_findings = 0
    all_tokens = []

    coded_display, coded_values = _build_coded_display(root, codes)

    for sd in NARR_SECTIONS:
        sec = find_section(root, sd["oids"])
        if sec is None:
            continue
        raw_text = get_narrative_text(sec)
        if not raw_text:
            continue
        words = len([w for w in raw_text.split() if w])
        if words < 2:
            continue
        total_sections += 1
        total_words += words
        findings = extract_findings(raw_text, sd["cls"])
        tokens = tokenise_narrative(raw_text)
        all_tokens.extend(tokens)

        gaps = [f for f in findings if _is_gap(f, coded_display, coded_values)]
        narrative_only_findings += len(gaps)

        sections[sd["k"]] = {
            "lbl": sd["lbl"],
            "cls": sd["cls"],
            "raw_text": raw_text,
            "words": words,
            "findings": findings,
            "tokens": tokens,
            "gaps": gaps,
        }

    return {
        "sections": sections,
        "total_words": total_words,
        "total_sections": total_sections,
        "narrative_only_findings": narrative_only_findings,
        "all_tokens": all_tokens,
        "coded_display": coded_display,
    }
