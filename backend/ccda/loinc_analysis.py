from lxml import etree
from .constants import CS, OID
from .parser import find_section


def analyze_loinc(root, codes: list[dict]) -> dict:
    loinc_raw = [c for c in codes if c["sys"] == CS["LOINC"]]

    # Build display name map from raw code elements (code → displayName)
    code_display_map = {}
    for c in loinc_raw:
        if c.get("disp") and c["disp"].strip():
            code_display_map[c["code"]] = c["disp"].strip()

    loinc_codes = list(dict.fromkeys(c["code"] for c in loinc_raw))

    res_sec = find_section(root, OID["RESULTS"])
    vitals_sec = find_section(root, OID["VITALS"])

    # Check for any value elements with a value attribute in either section
    has_lab_vals = False
    for sec in [res_sec, vitals_sec]:
        if sec is not None:
            for el in sec.iter():
                if callable(el.tag):
                    continue
                if etree.QName(el.tag).localname == "value" and el.get("value"):
                    has_lab_vals = True
                    break
        if has_lab_vals:
            break

    # Extract per-code result values from both Results and Vitals sections
    code_results = {}
    for sec in [res_sec, vitals_sec]:
        if sec is None:
            continue
        for obs in sec.iter():
            if callable(obs.tag):
                continue
            if etree.QName(obs.tag).localname != "observation":
                continue
            # Find LOINC code element within this observation
            code_el = None
            for child in obs.iter():
                if callable(child.tag):
                    continue
                if (etree.QName(child.tag).localname == "code"
                        and child.get("codeSystem") == CS["LOINC"]
                        and child.get("code")):
                    code_el = child
                    break
            if code_el is None:
                continue
            code = code_el.get("code")
            disp = code_el.get("displayName", "")
            if disp and code not in code_display_map:
                code_display_map[code] = disp
            # Find the first value element with a value attribute
            for child in obs.iter():
                if callable(child.tag):
                    continue
                if etree.QName(child.tag).localname == "value" and child.get("value"):
                    code_results.setdefault(code, []).append({
                        "value": child.get("value"),
                        "unit": child.get("unit", ""),
                    })
                    break

    # Per-code check: any LOINC code missing a result value?
    has_loinc_no_results = len(loinc_codes) > 0 and any(
        not code_results.get(c) for c in loinc_codes
    )

    return {
        "codes": loinc_codes,
        "count": len(loinc_codes),
        "has_results": has_lab_vals,
        "has_loinc_no_results": has_loinc_no_results,
        "code_results": code_results,
        "code_display_map": code_display_map,
    }
