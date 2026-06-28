from datetime import date
from lxml import etree
from .constants import HEDIS_MEASURES, HEDIS_VS_STATIC, SYS_TO_OID, CS


def _all_codes_for_vs(vs_name: str) -> list[dict]:
    vs = HEDIS_VS_STATIC.get(vs_name)
    if not vs:
        return []
    out = []
    for sys_label, codes in vs.get("codes", {}).items():
        sys_oid = SYS_TO_OID.get(sys_label, sys_label)
        for code in codes:
            out.append({"code": code, "sys": sys_oid, "sys_label": sys_label})
    return out


def code_set_matches(vs_name: str, doc_codes: list[dict]) -> dict:
    vs_codes = _all_codes_for_vs(vs_name)
    if not vs_codes:
        return {"hit": False, "matched": []}
    matched = []
    doc_index = {(c["code"], c["sys"]): c.get("disp", "") for c in doc_codes}
    for vc in vs_codes:
        key = (vc["code"], vc["sys"])
        if key in doc_index:
            matched.append({"code": vc["code"], "sys_label": vc["sys_label"], "disp": doc_index[key]})
    return {"hit": len(matched) > 0, "matched": matched}


def _get_patient_demographics(root):
    """Return (gender_code, birth_date) from CCDA recordTarget. Either may be None."""
    gender = None
    birth_date = None
    for el in root.iter():
        if callable(el.tag):
            continue
        local = etree.QName(el.tag).localname
        if local == "administrativeGenderCode" and gender is None:
            gender = (el.get("code") or "").upper()
        elif local == "birthTime" and birth_date is None:
            val = el.get("value") or ""
            if len(val) >= 8:
                try:
                    birth_date = date(int(val[:4]), int(val[4:6]), int(val[6:8]))
                except Exception:
                    pass
        if gender is not None and birth_date is not None:
            break
    return gender, birth_date


def _age(birth_date: date) -> int:
    today = date.today()
    return today.year - birth_date.year - (
        (today.month, today.day) < (birth_date.month, birth_date.day)
    )


def _check_denom(root, codes: list[dict], measure: dict) -> bool:
    logic = measure.get("denom_logic", {})
    denom_vs = measure.get("denom_vs", [])

    # Step 1: Always enforce age/gender constraints when present (applies to ALL measures)
    if "gender" in logic or "age_min" in logic or "age_max" in logic:
        gender, birth_date = _get_patient_demographics(root)
        req_gender = logic.get("gender", "").upper()
        if req_gender:
            if not gender or gender != req_gender:
                return False
        if birth_date:
            age = _age(birth_date)
            if "age_min" in logic and age < logic["age_min"]:
                return False
            if "age_max" in logic and age > logic["age_max"]:
                return False
        elif req_gender and not gender:
            return False  # required gender but can't parse — exclude conservatively

    # Step 2: Enforce clinical code requirement when denom_vs is specified
    if denom_vs:
        return any(code_set_matches(vs, codes)["hit"] for vs in denom_vs)

    # Step 3: No code requirement — passed demographic check (or no constraints) → include
    return True


def _check_denom_evidence(root, codes: list[dict], measure: dict) -> dict:
    logic = measure.get("denom_logic", {})
    denom_vs = measure.get("denom_vs", [])

    # Code-based (MRP, CBP, CDC-*) — show matched codes
    if denom_vs:
        matched = []
        for vs_name in denom_vs:
            r = code_set_matches(vs_name, codes)
            if r["hit"]:
                matched.extend([{**c, "vs_name": vs_name} for c in r["matched"]])
        return {"hit": len(matched) > 0, "matched": matched}

    # Demographic / population-based (BCS, COL, ABA, DSF) — show criteria + actual patient age
    gender, birth_date = _get_patient_demographics(root)
    parts = []
    req_gender = logic.get("gender", "").upper()
    if req_gender:
        parts.append({"F": "Female", "M": "Male"}.get(req_gender, req_gender))
    if "age_min" in logic and "age_max" in logic:
        age_str = f"age {logic['age_min']}–{logic['age_max']}"
        if birth_date:
            age_str += f" (pt: {_age(birth_date)})"
        parts.append(age_str)
    elif "age_min" in logic:
        age_str = f"age ≥{logic['age_min']}"
        if birth_date:
            age_str += f" (pt: {_age(birth_date)})"
        parts.append(age_str)
    if not parts:
        parts.append("All eligible adults")
    return {"hit": True, "matched": [{"code": "demographics", "sys_label": "Criteria", "disp": ", ".join(parts)}]}


def _check_numer(codes: list[dict], measure: dict) -> dict:
    matched = []
    for vs_name in measure.get("numer_vs", []):
        r = code_set_matches(vs_name, codes)
        if r["hit"]:
            matched.extend([{**c, "vs_name": vs_name} for c in r["matched"]])
    return {"hit": len(matched) > 0, "matched": matched}


def _check_exclusion(codes: list[dict], measure: dict) -> bool:
    for vs_name in measure.get("exclusion_vs", []):
        if code_set_matches(vs_name, codes)["hit"]:
            return True
    return False


def analyze_hedis(root, codes: list[dict]) -> list[dict]:
    results = []
    for m in HEDIS_MEASURES:
        denom_hit = _check_denom(root, codes, m)
        exclusion_hit = _check_exclusion(codes, m)
        if denom_hit and not exclusion_hit:
            numer_result = _check_numer(codes, m)
            numer_hit = numer_result["hit"]
            numer_matched = numer_result["matched"]
        else:
            numer_hit = False
            numer_matched = []
        denom_ev = _check_denom_evidence(root, codes, m)

        if denom_hit or numer_hit:
            results.append({
                "id": m["id"],
                "name": m["name"],
                "cat": m["cat"],
                "description": m.get("description", ""),
                "denom_hit": denom_hit,
                "numer_hit": numer_hit,
                "exclusion_hit": exclusion_hit,
                "numer_matched": numer_matched,
                "denom_matched": denom_ev["matched"],
                "numer_vs": m.get("numer_vs", []),
                "denom_vs": m.get("denom_vs", []),
                "exclusion_vs": m.get("exclusion_vs", []),
            })
    return results
