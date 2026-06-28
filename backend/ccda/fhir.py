import uuid
from datetime import datetime
from lxml import etree
from .constants import OID, OID2SYS
from .parser import find_section, find_all, find_child, get_attr, get_text, child_text, pat_info


def _uuid() -> str:
    return str(uuid.uuid4())


def _clean(obj):
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_clean(v) for v in obj]
    return obj


def _fhir_date(s: str | None) -> str | None:
    if not s or len(s) < 8:
        return None
    y, mo, d = s[:4], s[4:6], s[6:8]
    if len(s) >= 14:
        return f"{y}-{mo}-{d}T{s[8:10]}:{s[10:12]}:{s[12:14]}"
    return f"{y}-{mo}-{d}"


def _oid2sys(oid: str) -> str:
    return OID2SYS.get(oid, f"urn:oid:{oid}")


def _fcc(code: str, oid: str, disp: str) -> dict:
    return {
        "coding": [{"system": _oid2sys(oid), "code": code or "", "display": disp or ""}],
        "text": disp or code or "",
    }


def _get_el_attr(el, attr: str, default=None):
    if el is None:
        return default
    return el.get(attr, default)


_NULL_EXT = {"NI", "NA", "UNK", "NASK", "ASKU", "TRC", "MSK", "OTH", "NINF", "PINF"}

_NPI_OID = "2.16.840.1.113883.4.6"


def _pick_id(parent_el):
    """Return (id_value, root_oid) for the best <id> on parent_el.
    Prefers NPI OID; falls back to first id with an extension, then root."""
    ids = [c for c in parent_el if _local(c) == "id" and not c.get("nullFlavor")]
    if not ids:
        return None, None
    npi_el = next((c for c in ids if c.get("root") == _NPI_OID), None)
    if npi_el is not None:
        ext = (npi_el.get("extension") or "").strip()
        if ext and ext.upper() not in _NULL_EXT:
            return ext, _NPI_OID
        return None, _NPI_OID
    ext_el = next((c for c in ids if c.get("extension")), None)
    if ext_el is not None:
        return ext_el.get("extension"), ext_el.get("root")
    first = ids[0]
    return first.get("root"), first.get("root")


def _local(el) -> str:
    if el is None:
        return ""
    tag = el.tag
    if callable(tag):   # comment / processing-instruction nodes have a callable tag
        return ""
    return etree.QName(tag).localname


def _find_by_local(parent, *local_tags):
    if parent is None:
        return None
    for el in parent.iter():
        if _local(el) in local_tags:
            return el
    return None


def _find_all_by_local(parent, local_tag: str):
    if parent is None:
        return []
    return [el for el in parent.iter() if _local(el) == local_tag]


def _text(el) -> str:
    if el is None:
        return ""
    return (el.text or "").strip()


def fhir_patient(root) -> dict:
    _GENDER_MAP  = {"M": "male", "F": "female", "male": "male", "female": "female", "UN": "unknown", "UNK": "unknown"}
    _NAME_USE    = {"L": "official", "OR": "official", "P": "nickname", "A": "anonymous", "TEMP": "temp"}
    _ADDR_USE    = {"H": "home", "HP": "home", "WP": "work", "TMP": "temp", "OLD": "old"}
    _TC_USE      = {"H": "home", "HP": "home", "WP": "work", "MC": "mobile", "PG": "pager"}

    pat_id   = _uuid()
    pat_role = _find_by_local(root, "patientRole")
    pat_el   = _find_by_local(pat_role, "patient") if pat_role is not None else None

    # ── identifier / MRN ────────────────────────────────────────────────────
    identifiers = []
    mrn = mrn_system = None
    if pat_role is not None:
        for child in pat_role:
            if _local(child) == "id" and not child.get("nullFlavor"):
                r_val = child.get("root", "")
                e_val = child.get("extension", "")
                val   = e_val or r_val
                if val:
                    sys = f"urn:oid:{r_val}" if r_val else None
                    identifiers.append({"use": "usual", "system": sys, "value": val})
                    if mrn is None:
                        mrn, mrn_system = val, sys

    # ── name ────────────────────────────────────────────────────────────────
    family_name = given_name = prefix = suffix = None
    all_given   = []
    name_use    = "official"
    if pat_el is not None:
        name_el = _find_by_local(pat_el, "name")
        if name_el is not None:
            name_use  = _NAME_USE.get(name_el.get("use", ""), "official")
            all_given = [(c.text or "").strip() for c in name_el if _local(c) == "given" and (c.text or "").strip()]
            given_name = " ".join(all_given) or None
            fam_el      = next((c for c in name_el if _local(c) == "family"), None)
            family_name = (fam_el.text or "").strip() or None if fam_el is not None else None
            pre_el      = next((c for c in name_el if _local(c) == "prefix"), None)
            prefix      = (pre_el.text or "").strip() or None if pre_el is not None else None
            suf_el      = next((c for c in name_el if _local(c) == "suffix"), None)
            suffix      = (suf_el.text or "").strip() or None if suf_el is not None else None

    # ── gender / birthDate ──────────────────────────────────────────────────
    gc_el      = _find_by_local(pat_el, "administrativeGenderCode") if pat_el is not None else None
    gender     = _GENDER_MAP.get(_get_el_attr(gc_el, "code", ""), "unknown")
    bv_el      = _find_by_local(pat_el, "birthTime") if pat_el is not None else None
    birth_date = _fhir_date(_get_el_attr(bv_el, "value")) if bv_el is not None else None

    # ── deceased ─────────────────────────────────────────────────────────────
    deceased_bool = deceased_date = None
    if pat_el is not None:
        dec_time = _find_by_local(pat_el, "deceasedTime")
        dec_ind  = _find_by_local(pat_el, "deceasedInd")
        if dec_time is not None:
            deceased_date = _fhir_date(_get_el_attr(dec_time, "value"))
        elif dec_ind is not None:
            v = (_get_el_attr(dec_ind, "value") or "").lower()
            if v in ("true", "1"):
                deceased_bool = True
            elif v in ("false", "0"):
                deceased_bool = False

    # ── maritalStatus ────────────────────────────────────────────────────────
    marital_status = None
    if pat_el is not None:
        mar_el = _find_by_local(pat_el, "maritalStatusCode")
        if mar_el is not None:
            mc = (mar_el.get("code") or "").strip()
            if mc and mc.upper() not in _NULL_EXT:
                marital_status = mar_el.get("displayName") or mc

    # ── race / ethnicity (US Core) ───────────────────────────────────────────
    race_code = race_display = ethnicity_code = ethnicity_display = None
    if pat_el is not None:
        race_el = _find_by_local(pat_el, "raceCode")
        if race_el is not None:
            rc = (race_el.get("code") or "").strip()
            if rc and rc.upper() not in _NULL_EXT:
                race_code    = rc
                race_display = race_el.get("displayName")
        eth_el = _find_by_local(pat_el, "ethnicGroupCode")
        if eth_el is not None:
            ec = (eth_el.get("code") or "").strip()
            if ec and ec.upper() not in _NULL_EXT:
                ethnicity_code    = ec
                ethnicity_display = eth_el.get("displayName")

    # ── languageCommunication ────────────────────────────────────────────────
    lang_code = lang_preferred = None
    if pat_el is not None:
        lc_el = _find_by_local(pat_el, "languageCommunication")
        if lc_el is not None:
            lcode_el = _find_by_local(lc_el, "languageCode")
            if lcode_el is not None:
                lang_code = lcode_el.get("code")
            pref_el = _find_by_local(lc_el, "preferenceInd")
            if pref_el is not None:
                lang_preferred = (_get_el_attr(pref_el, "value") or "").lower() == "true"

    # ── address ──────────────────────────────────────────────────────────────
    addr_list = []
    address_line = city = state = postal_code = country = None
    if pat_role is not None:
        addr_el = next((c for c in pat_role if _local(c) == "addr" and not c.get("nullFlavor")), None)
        if addr_el is not None:
            addr_use   = _ADDR_USE.get(addr_el.get("use", ""), "home")
            street_el  = _find_by_local(addr_el, "streetAddressLine")
            city_el    = _find_by_local(addr_el, "city")
            state_el   = _find_by_local(addr_el, "state")
            postal_el  = _find_by_local(addr_el, "postalCode")
            country_el = _find_by_local(addr_el, "country")
            address_line = (street_el.text  or "").strip() or None if street_el  is not None else None
            city         = (city_el.text    or "").strip() or None if city_el    is not None else None
            state        = (state_el.text   or "").strip() or None if state_el   is not None else None
            postal_code  = (postal_el.text  or "").strip() or None if postal_el  is not None else None
            country      = (country_el.text or "").strip() or "US" if country_el is not None else "US"
            entry = {"use": addr_use}
            if address_line:
                entry["line"] = [address_line]
            if city:        entry["city"]       = city
            if state:       entry["state"]      = state
            if postal_code: entry["postalCode"] = postal_code
            if country:     entry["country"]    = country
            if entry.get("line") or entry.get("city"):
                addr_list.append(entry)

    # ── telecom ──────────────────────────────────────────────────────────────
    phone = email = None
    telecoms = []
    if pat_role is not None:
        for tc in [c for c in pat_role if _local(c) == "telecom" and not c.get("nullFlavor")]:
            val = (tc.get("value") or "").strip()
            use = tc.get("use", "")
            if val.startswith("tel:"):
                number = val[4:].strip()
                tc_use = _TC_USE.get(use, "home")
                telecoms.append({"system": "phone", "value": number, "use": tc_use})
                if phone is None:
                    phone = number
            elif val.startswith("mailto:"):
                em = val[7:].strip()
                telecoms.append({"system": "email", "value": em})
                if email is None:
                    email = em
            elif val.startswith("fax:"):
                telecoms.append({"system": "fax", "value": val[4:].strip()})

    return {
        "resourceType": "Patient",
        "id": pat_id,
        "active": True,
        "identifier": identifiers,
        "name": [{
            "use":    name_use,
            "family": family_name or "",
            "given":  all_given,
            "prefix": [prefix] if prefix else [],
            "suffix": [suffix] if suffix else [],
        }],
        "gender":           gender,
        "birthDate":        birth_date,
        "deceasedBoolean":  deceased_bool,
        "deceasedDateTime": deceased_date,
        "maritalStatus":    {"text": marital_status} if marital_status else None,
        "address":          addr_list,
        "telecom":          telecoms if telecoms else None,
        "communication":    [{"language": {"coding": [{"code": lang_code}]}, "preferred": lang_preferred}] if lang_code else None,
        # private fields for SQL extraction (not standard FHIR paths)
        "_mrn":              mrn,
        "_mrn_system":       mrn_system,
        "_address_line":     address_line,
        "_city":             city,
        "_state":            state,
        "_postal_code":      postal_code,
        "_country":          country,
        "_phone":            phone,
        "_email":            email,
        "_race_code":        race_code,
        "_race_display":     race_display,
        "_ethnicity_code":   ethnicity_code,
        "_ethnicity_display": ethnicity_display,
        "_lang_code":        lang_code,
        "_lang_preferred":   1 if lang_preferred else (0 if lang_preferred is False else None),
    }


def fhir_conditions(root, pat_id: str) -> list[dict]:
    _CLINICAL_STATUS = {
        "completed": "resolved", "active": "active",
        "aborted": "inactive",  "cancelled": "inactive",
        # SNOMED problem-status codes from entryRelationship[REFR]
        "55561003": "active", "73425007": "inactive",
        "413322009": "resolved", "723506003": "resolved",
    }

    sec = find_section(root, OID["PROBLEMS"])
    if sec is None:
        return []
    results = []
    for entry in _find_all_by_local(sec, "entry"):
        obs = _find_by_local(entry, "observation")
        if obs is None:
            continue

        # --- diagnosis code: value > translation > code (direct children only to avoid picking nested obs) ---
        code_el = next((c for c in obs if _local(c) == "value" and c.get("code") and c.get("codeSystem")), None)
        if code_el is None:
            val_el = next((c for c in obs if _local(c) == "value"), None)
            if val_el is not None:
                code_el = next((c for c in val_el
                                if _local(c) == "translation" and c.get("code") and c.get("codeSystem")), None)
        if code_el is None:
            code_el = next((c for c in obs if _local(c) == "code" and c.get("code") and c.get("codeSystem")), None)
        if code_el is None:
            continue
        code = code_el.get("code", "")
        oid  = code_el.get("codeSystem", "")
        disp = code_el.get("displayName", "")
        if not code:
            continue

        # --- effectiveTime ---
        eff_el  = _find_by_local(obs, "effectiveTime")
        low_el  = _find_by_local(eff_el, "low")  if eff_el is not None else None
        high_el = _find_by_local(eff_el, "high") if eff_el is not None else None

        # --- clinical status: statusCode first, then override from REFR entryRelationship ---
        sc_el = next((c for c in obs if _local(c) == "statusCode"), None)
        clinical_status = _CLINICAL_STATUS.get(_get_el_attr(sc_el, "code", ""), "active")
        for er in [c for c in obs if _local(c) == "entryRelationship" and c.get("typeCode") == "REFR"]:
            er_obs = _find_by_local(er, "observation")
            if er_obs is None:
                continue
            er_val = next((c for c in er_obs if _local(c) == "value" and c.get("code")), None)
            if er_val is not None:
                mapped = _CLINICAL_STATUS.get(er_val.get("code", ""))
                if mapped:
                    clinical_status = mapped
                    break

        # --- severity from entryRelationship[SUBJ] where code/@code == "SEV" ---
        severity = None
        for er in [c for c in obs if _local(c) == "entryRelationship" and c.get("typeCode") == "SUBJ"]:
            er_obs = _find_by_local(er, "observation")
            if er_obs is None:
                continue
            sev_code_el = next((c for c in er_obs if _local(c) == "code" and c.get("code") == "SEV"), None)
            if sev_code_el is None:
                continue
            sev_val = next((c for c in er_obs if _local(c) == "value" and c.get("code")), None)
            if sev_val is not None:
                sv = sev_val.get("code", "")
                sd = sev_val.get("displayName") or sv
                severity = {"coding": [{"system": _oid2sys(sev_val.get("codeSystem", "")),
                                        "code": sv, "display": sd}], "text": sd}
                break

        # --- bodySite from targetSiteCode ---
        bsc = next((c for c in obs if _local(c) == "targetSiteCode" and c.get("code")), None)
        body_site = None
        if bsc is not None:
            bs_c = bsc.get("code", "")
            bs_d = bsc.get("displayName") or bs_c
            body_site = [{"coding": [{"system": _oid2sys(bsc.get("codeSystem", "")),
                                      "code": bs_c, "display": bs_d}]}]

        # --- author → recordedDate + recorder ---
        author_el = (next((c for c in obs   if _local(c) == "author"), None) or
                     next((c for c in entry if _local(c) == "author"), None))
        recorded_date    = None
        recorder_display = None
        if author_el is not None:
            t_el = _find_by_local(author_el, "time")
            recorded_date = _fhir_date(_get_el_attr(t_el, "value")) if t_el is not None else None
            aa = _find_by_local(author_el, "assignedAuthor")
            if aa is not None:
                person  = _find_by_local(aa, "assignedPerson")
                name_el = _find_by_local(person, "name") if person is not None else None
                if name_el is not None:
                    family = _text(_find_by_local(name_el, "family"))
                    given  = _text(_find_by_local(name_el, "given"))
                    recorder_display = " ".join(p for p in [given, family] if p) or None

        # --- note from text element ---
        text_el = next((c for c in obs if _local(c) == "text"), None)
        note = [{"text": text_el.text.strip()}] if (text_el is not None and
                                                     text_el.text and
                                                     text_el.text.strip()) else None

        results.append({
            "resourceType": "Condition",
            "id": _uuid(),
            "meta": {"profile": ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition"]},
            "clinicalStatus":     {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                                               "code": clinical_status}]},
            "verificationStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                                               "code": "confirmed"}]},
            "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-category",
                                      "code": "problem-list-item", "display": "Problem List Item"}]}],
            "severity": severity,
            "code": _fcc(code, oid, disp),
            "bodySite": body_site,
            "subject": {"reference": f"Patient/{pat_id}"},
            "onsetDateTime":    _fhir_date(_get_el_attr(low_el,  "value")),
            "abatementDateTime": _fhir_date(_get_el_attr(high_el, "value")),
            "recordedDate": recorded_date,
            "recorder": {"display": recorder_display} if recorder_display else None,
            "note": note,
        })
    return results


def fhir_medications(root, pat_id: str) -> list[dict]:
    sec = find_section(root, OID["MEDICATIONS"])
    if sec is None:
        return []
    results = []
    _STATUS_MAP = {"active": "active", "completed": "completed", "aborted": "cancelled",
                   "suspended": "on-hold", "cancelled": "cancelled"}
    for entry in _find_all_by_local(sec, "entry"):
        sa = _find_by_local(entry, "substanceAdministration")
        if sa is None:
            continue

        mat = _find_by_local(sa, "manufacturedMaterial")
        code_el = _find_by_local(mat, "code") if mat is not None else None
        if code_el is None:
            continue
        code = code_el.get("code", "")
        oid  = code_el.get("codeSystem", "")
        disp = code_el.get("displayName", "")
        if not code:
            continue

        # status
        sc_el = _find_by_local(sa, "statusCode")
        status = _STATUS_MAP.get(_get_el_attr(sc_el, "code", ""), "unknown")

        # effectiveTime — skip PIVL/EIVL (frequency); capture IVL low/high or single value
        authored_on = period_start = period_end = None
        for eff_el in [c for c in sa if _local(c) == "effectiveTime"]:
            xsi_t = eff_el.get("{http://www.w3.org/2001/XMLSchema-instance}type", "")
            if "PIVL" in xsi_t or "EIVL" in xsi_t:
                continue
            val = eff_el.get("value")
            if val:
                authored_on = authored_on or _fhir_date(val)
                continue
            low_el  = _find_by_local(eff_el, "low")
            high_el = _find_by_local(eff_el, "high")
            if low_el is not None:
                period_start = _fhir_date(_get_el_attr(low_el, "value"))
                authored_on  = authored_on or period_start
            if high_el is not None:
                period_end = _fhir_date(_get_el_attr(high_el, "value"))

        # routeCode → CodeableConcept
        route_el   = _find_by_local(sa, "routeCode")
        route_code = route_display = None
        if route_el is not None:
            rc = (route_el.get("code") or "").strip()
            if rc and rc.upper() not in _NULL_EXT and rc not in {"-1", "-2"}:
                route_code    = rc
                route_display = route_el.get("displayName") or None

        # doseQuantity
        dose_el    = _find_by_local(sa, "doseQuantity")
        dose_value = dose_unit = None
        if dose_el is not None:
            try:
                dose_value = float(dose_el.get("value"))
            except (TypeError, ValueError):
                pass
            dose_unit = dose_el.get("unit") or None

        # rateQuantity
        rate_el    = _find_by_local(sa, "rateQuantity")
        rate_value = rate_unit = None
        if rate_el is not None:
            try:
                rate_value = float(rate_el.get("value"))
            except (TypeError, ValueError):
                pass
            rate_unit = rate_el.get("unit") or None

        # repeatNumber → numberOfRepeatsAllowed
        rn_el  = _find_by_local(sa, "repeatNumber")
        refills = None
        if rn_el is not None:
            try:
                refills = int(rn_el.get("value"))
            except (TypeError, ValueError):
                pass

        # requester: author or performer → assignedAuthor / assignedEntity
        requester_display = requester_npi = None
        for tag in ("author", "performer"):
            author_el = _find_by_local(sa, tag)
            if author_el is None:
                continue
            assigned = _find_by_local(author_el, "assignedAuthor") or _find_by_local(author_el, "assignedEntity")
            if assigned is None:
                continue
            npi_val, _ = _pick_id(assigned)
            requester_npi = npi_val
            person = _find_by_local(assigned, "assignedPerson")
            name_el = _find_by_local(person, "name") if person is not None else None
            if name_el is not None:
                given = " ".join((g.text or "").strip() for g in name_el if _local(g) == "given").strip()
                fam_el = next((c for c in name_el if _local(c) == "family"), None)
                family = (fam_el.text or "").strip() if fam_el is not None else ""
                requester_display = f"{given} {family}".strip() or None
            break

        # reasonCode: entryRelationship[@typeCode=RSON]
        reason_code = reason_system = reason_display = None
        for er in [c for c in sa if _local(c) == "entryRelationship"]:
            if er.get("typeCode") != "RSON":
                continue
            obs = _find_by_local(er, "observation") or _find_by_local(er, "act")
            val_el = _find_by_local(obs, "value") if obs is not None else None
            if val_el is not None:
                reason_code    = val_el.get("code")
                reason_system  = val_el.get("codeSystem")
                reason_display = val_el.get("displayName")
            break

        # note from text element
        text_el = _find_by_local(sa, "text")
        note = (text_el.text or "").strip() if text_el is not None and text_el.text else None

        # dosageInstruction
        di = {}
        if route_code:
            di["route"] = {"coding": [{"code": route_code, "display": route_display}]}
        dar = {}
        if dose_value is not None:
            dar["doseQuantity"] = {"value": dose_value, "unit": dose_unit or "", "system": "http://unitsofmeasure.org"}
        if rate_value is not None:
            dar["rateQuantity"] = {"value": rate_value, "unit": rate_unit or ""}
        if dar:
            di["doseAndRate"] = [dar]
        dose_instr = [di] if di else None

        # dispenseRequest
        dispense_req = None
        if period_start or period_end or refills is not None:
            dispense_req = {}
            if period_start or period_end:
                dispense_req["validityPeriod"] = {"start": period_start, "end": period_end}
            if refills is not None:
                dispense_req["numberOfRepeatsAllowed"] = refills

        requester_obj = None
        if requester_display or requester_npi:
            requester_obj = {"display": requester_display}
            if requester_npi:
                requester_obj["_npi"] = requester_npi

        results.append({
            "resourceType": "MedicationRequest",
            "id": _uuid(),
            "status": status,
            "intent": "order",
            "medicationCodeableConcept": _fcc(code, oid, disp),
            "subject": {"reference": f"Patient/{pat_id}"},
            "authoredOn": authored_on,
            "requester": requester_obj,
            "dosageInstruction": dose_instr,
            "reasonCode": [{"coding": [{"code": reason_code, "system": reason_system, "display": reason_display}]}] if reason_code else None,
            "dispenseRequest": dispense_req,
            "note": [{"text": note}] if note else None,
        })
    return results


def fhir_allergies(root, pat_id: str) -> list[dict]:
    sec = find_section(root, OID["ALLERGIES"])
    if sec is None:
        return []
    results = []
    crit_map = {"255604002": "low", "6736007": "moderate", "24484000": "high", "442452003": "unable-to-assess"}
    for entry in _find_all_by_local(sec, "entry"):
        act = _find_by_local(entry, "act")
        if act is None:
            continue
        pe = _find_by_local(act, "playingEntity")
        code_el = _find_by_local(pe, "code") if pe is not None else None
        if code_el is None:
            continue
        code = code_el.get("code", "")
        oid = code_el.get("codeSystem", "")
        disp = code_el.get("displayName", "")
        if not code:
            continue
        sev_el = _find_by_local(act, "value")
        crit = crit_map.get(_get_el_attr(sev_el, "code", ""), "unable-to-assess")
        results.append({
            "resourceType": "AllergyIntolerance",
            "id": _uuid(),
            "meta": {"profile": ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance"]},
            "clinicalStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", "code": "active"}]},
            "verificationStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", "code": "confirmed"}]},
            "type": "allergy",
            "criticality": crit,
            "code": _fcc(code, oid, disp),
            "patient": {"reference": f"Patient/{pat_id}"},
        })
    return results


def fhir_observations(root, pat_id: str) -> list[dict]:
    out = []
    _STATUS_MAP = {
        "completed": "final", "active": "preliminary", "aborted": "cancelled",
        "cancelled": "cancelled", "suspended": "amended", "new": "registered",
    }
    _NPI_OID = "2.16.840.1.113883.4.6"
    _CODED_TYPES = {"CD", "CE", "CV", "CO", "CS"}

    def _extract_obs(sec, category_code: str, category_disp: str, profile: str):
        if sec is None:
            return
        for obs in [el for el in sec.iter() if _local(el) == "observation"]:
            # code — direct child only to avoid picking up nested codes
            code_el = None
            for child in obs:
                if _local(child) == "code" and child.get("code") and child.get("codeSystem"):
                    code_el = child
                    break
            if code_el is None:
                continue
            code = code_el.get("code", "")
            oid  = code_el.get("codeSystem", "")
            disp = code_el.get("displayName", "")
            if not code:
                continue

            # status — direct child
            sc_el = next((c for c in obs if _local(c) == "statusCode"), None)
            status = _STATUS_MAP.get(_get_el_attr(sc_el, "code", "completed"), "final")

            # effectiveTime — direct child
            eff_el = next((c for c in obs if _local(c) == "effectiveTime"), None)
            eff_date = eff_start = eff_end = None
            if eff_el is not None:
                val = eff_el.get("value")
                if val:
                    eff_date = _fhir_date(val)
                else:
                    low_el  = _find_by_local(eff_el, "low")
                    high_el = _find_by_local(eff_el, "high")
                    if low_el is not None:
                        eff_start = _fhir_date(_get_el_attr(low_el, "value"))
                        eff_date  = eff_start
                    if high_el is not None:
                        eff_end = _fhir_date(_get_el_attr(high_el, "value"))

            # value — direct child only (avoid picking up referenceRange/value)
            val_el = next((c for c in obs if _local(c) == "value"), None)
            value_quantity = value_unit = None
            value_code = value_code_display = None
            value_string = None
            value_range_low = value_range_high = None

            if val_el is not None:
                xsi_t = val_el.get("{http://www.w3.org/2001/XMLSchema-instance}type", "")
                v = val_el.get("value")
                u = val_el.get("unit")

                if "IVL_PQ" in xsi_t:
                    low_v  = _find_by_local(val_el, "low")
                    high_v = _find_by_local(val_el, "high")
                    try:
                        value_range_low  = float(low_v.get("value"))  if low_v  is not None else None
                    except (TypeError, ValueError):
                        pass
                    try:
                        value_range_high = float(high_v.get("value")) if high_v is not None else None
                    except (TypeError, ValueError):
                        pass
                elif "PQ" in xsi_t:
                    if v:
                        try:
                            value_quantity = float(v)
                            value_unit = u or None
                        except (ValueError, TypeError):
                            value_string = v
                elif xsi_t in _CODED_TYPES:
                    vc = val_el.get("code")
                    if vc and vc.upper() not in _NULL_EXT:
                        value_code = vc
                        value_code_display = val_el.get("displayName")
                    else:
                        value_string = val_el.get("displayName")
                elif xsi_t in ("ST", "ED"):
                    value_string = (val_el.text or "").strip() or v
                else:
                    # no xsi:type — try numeric, then coded, then text
                    if v:
                        try:
                            value_quantity = float(v)
                            value_unit = u or None
                        except (ValueError, TypeError):
                            vc = val_el.get("code")
                            if vc and vc.upper() not in _NULL_EXT:
                                value_code = vc
                                value_code_display = val_el.get("displayName")
                            else:
                                value_string = val_el.get("displayName") or v
                    elif val_el.get("code"):
                        vc = val_el.get("code")
                        if vc.upper() not in _NULL_EXT:
                            value_code = vc
                            value_code_display = val_el.get("displayName")
                    elif val_el.text and val_el.text.strip():
                        value_string = val_el.text.strip()

            # interpretationCode — direct child (H/L/N/A etc.)
            interp_el = next((c for c in obs if _local(c) == "interpretationCode"), None)
            interp_code = interp_display = None
            if interp_el is not None:
                ic = (interp_el.get("code") or "").strip()
                if ic and ic.upper() not in _NULL_EXT:
                    interp_code    = ic
                    interp_display = interp_el.get("displayName")

            # referenceRange → observationRange → value (IVL_PQ low/high) or text
            ref_low = ref_high = None
            ref_text = None
            rr_el = next((c for c in obs if _local(c) == "referenceRange"), None)
            if rr_el is not None:
                obs_range = _find_by_local(rr_el, "observationRange")
                if obs_range is not None:
                    rv = next((c for c in obs_range if _local(c) == "value"), None)
                    if rv is not None:
                        rrl = _find_by_local(rv, "low")
                        rrh = _find_by_local(rv, "high")
                        try:
                            ref_low  = float(rrl.get("value")) if rrl is not None else None
                        except (TypeError, ValueError):
                            pass
                        try:
                            ref_high = float(rrh.get("value")) if rrh is not None else None
                        except (TypeError, ValueError):
                            pass
                    txt_el = _find_by_local(obs_range, "text")
                    if txt_el is not None and txt_el.text:
                        ref_text = txt_el.text.strip() or None

            # targetSiteCode → bodySite
            site_el = next((c for c in obs if _local(c) == "targetSiteCode"), None)
            body_site_code = body_site_display = None
            if site_el is not None:
                bsc = (site_el.get("code") or "").strip()
                if bsc and bsc.upper() not in _NULL_EXT:
                    body_site_code    = bsc
                    body_site_display = site_el.get("displayName")

            # methodCode
            meth_el = next((c for c in obs if _local(c) == "methodCode"), None)
            method_code = method_display = None
            if meth_el is not None:
                mc = (meth_el.get("code") or "").strip()
                if mc and mc.upper() not in _NULL_EXT:
                    method_code    = mc
                    method_display = meth_el.get("displayName")

            # performer/author → performer display + NPI
            performer_display = performer_npi = None
            for tag in ("author", "performer"):
                p_el = next((c for c in obs if _local(c) == tag), None)
                if p_el is None:
                    continue
                assigned = _find_by_local(p_el, "assignedAuthor") or _find_by_local(p_el, "assignedEntity")
                if assigned is None:
                    continue
                for id_el in [c for c in assigned if _local(c) == "id" and not c.get("nullFlavor")]:
                    if id_el.get("root") == _NPI_OID:
                        ext = (id_el.get("extension") or "").strip()
                        if ext and ext.upper() not in _NULL_EXT:
                            performer_npi = ext
                        break
                person  = _find_by_local(assigned, "assignedPerson")
                name_el = _find_by_local(person, "name") if person is not None else None
                if name_el is not None:
                    given  = " ".join((g.text or "").strip() for g in name_el if _local(g) == "given").strip()
                    fam_el = next((c for c in name_el if _local(c) == "family"), None)
                    family = (fam_el.text or "").strip() if fam_el is not None else ""
                    performer_display = f"{given} {family}".strip() or None
                break

            # note from text element
            text_el = next((c for c in obs if _local(c) == "text"), None)
            note = (text_el.text or "").strip() if text_el is not None and text_el.text else None

            # ── build FHIR resource ───────────────────────────────────────────
            o = {
                "resourceType": "Observation",
                "id": _uuid(),
                "status": status,
                "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                          "code": category_code, "display": category_disp}]}],
                "code": _fcc(code, oid, disp),
                "subject": {"reference": f"Patient/{pat_id}"},
                "effectiveDateTime": eff_date,
            }
            if eff_start or eff_end:
                o["effectivePeriod"] = {"start": eff_start, "end": eff_end}
            if value_quantity is not None:
                o["valueQuantity"] = {"value": value_quantity, "unit": value_unit or "",
                                      "system": "http://unitsofmeasure.org", "code": value_unit or ""}
            if value_range_low is not None or value_range_high is not None:
                o["valueRange"] = {
                    "low":  {"value": value_range_low}  if value_range_low  is not None else None,
                    "high": {"value": value_range_high} if value_range_high is not None else None,
                }
            if value_code:
                o["valueCodeableConcept"] = {"coding": [{"code": value_code, "display": value_code_display or ""}],
                                              "text": value_code_display or value_code}
            if value_string:
                o["valueString"] = value_string
            if interp_code:
                o["interpretation"] = [{"coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                    "code": interp_code, "display": interp_display or "",
                }]}]
            if ref_low is not None or ref_high is not None or ref_text:
                rr = {}
                if ref_low  is not None:
                    rr["low"]  = {"value": ref_low,  "system": "http://unitsofmeasure.org"}
                if ref_high is not None:
                    rr["high"] = {"value": ref_high, "system": "http://unitsofmeasure.org"}
                if ref_text:
                    rr["text"] = ref_text
                o["referenceRange"] = [rr]
            if body_site_code:
                o["bodySite"] = {"coding": [{"code": body_site_code, "display": body_site_display or ""}]}
            if method_code:
                o["method"] = {"coding": [{"code": method_code, "display": method_display or ""}]}
            if performer_display or performer_npi:
                perf = {"display": performer_display}
                if performer_npi:
                    perf["_npi"] = performer_npi
                o["performer"] = [perf]
            if note:
                o["note"] = [{"text": note}]

            out.append(o)

    _extract_obs(find_section(root, OID["RESULTS"]), "laboratory", "Laboratory",
                 "http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation-lab")
    _extract_obs(find_section(root, OID["VITALS"]), "vital-signs", "Vital Signs",
                 "http://hl7.org/fhir/us/core/StructureDefinition/us-core-vitalsigns")
    return out


def fhir_encounters(root, pat_id: str) -> list[dict]:
    _STATUS_MAP  = {"completed": "finished", "active": "in-progress", "aborted": "cancelled", "cancelled": "cancelled"}
    _NPI_OID     = "2.16.840.1.113883.4.6"
    _ACTCODE_OID = "2.16.840.1.113883.5.4"   # HL7 ActCode — code IS the FHIR class
    _CPT_OID     = "2.16.840.1.113883.6.12"
    _FHIR_CLASSES = {"AMB", "EMER", "IMP", "HH", "VR", "OBSENC", "SS", "PRENC", "ACUTE", "NONAC", "FLD"}
    _CLASS_DISPLAY = {
        "AMB":    "ambulatory",          "EMER":   "emergency",
        "IMP":    "inpatient encounter", "HH":     "home health",
        "VR":     "virtual",             "OBSENC": "observation encounter",
        "SS":     "short stay",          "PRENC":  "pre-admission",
        "ACUTE":  "inpatient acute",     "NONAC":  "inpatient non-acute",
    }

    sec = find_section(root, OID["ENCOUNTERS"])
    if sec is None:
        return []
    results = []
    for entry in _find_all_by_local(sec, "entry"):
        enc = _find_by_local(entry, "encounter")
        if enc is None:
            continue

        # --- CCDA id (used to resolve encounter references from DiagnosticReport) ---
        enc_id_el = next((c for c in enc if _local(c) == "id" and not c.get("nullFlavor")), None)
        ccda_enc_id = None
        if enc_id_el is not None:
            id_root = enc_id_el.get("root", "")
            id_ext  = (enc_id_el.get("extension") or "").strip()
            ccda_enc_id = f"{id_root}|{id_ext}" if id_ext else (id_root or None)

        # --- effectiveTime ---
        eff_el = _find_by_local(enc, "effectiveTime")
        start = _get_el_attr(eff_el, "value") if eff_el is not None else None
        if not start and eff_el is not None:
            low_el = _find_by_local(eff_el, "low")
            start = _get_el_attr(low_el, "value")
        end_el = _find_by_local(eff_el, "high") if eff_el is not None else None
        end = _get_el_attr(end_el, "value")

        # --- status from statusCode ---
        sc_el = next((c for c in enc if _local(c) == "statusCode"), None)
        status = _STATUS_MAP.get(_get_el_attr(sc_el, "code", "completed"), "finished")

        # --- class + type: direct child code element only ---
        # If codeSystem is HL7 ActCode OID, the code IS the FHIR class (not type).
        # For CPT codes, infer class from known ranges and use as encounter type.
        type_code_el = next(
            (c for c in enc if _local(c) == "code" and c.get("code") and c.get("codeSystem")), None
        )
        type_field        = None
        enc_class_code    = "AMB"
        enc_class_display = "ambulatory"

        if type_code_el is not None:
            tc    = type_code_el.get("code", "")
            toid  = type_code_el.get("codeSystem", "")
            tdisp = type_code_el.get("displayName", "")

            if toid == _ACTCODE_OID and tc.upper() in _FHIR_CLASSES:
                # This code IS the encounter class — consume it, don't repeat as type
                enc_class_code    = tc.upper()
                enc_class_display = tdisp or _CLASS_DISPLAY.get(enc_class_code, enc_class_code)
            else:
                # Use as encounter type
                if tc:
                    type_field = [_fcc(tc, toid, tdisp)]
                # Infer class from CPT ranges
                if toid == _CPT_OID:
                    try:
                        cpt_num = int(tc)
                        if 99281 <= cpt_num <= 99285:
                            enc_class_code, enc_class_display = "EMER", "emergency"
                        elif (99221 <= cpt_num <= 99239) or (99251 <= cpt_num <= 99263):
                            enc_class_code, enc_class_display = "IMP", "inpatient encounter"
                        # 99201-99215, 99241-99245 → AMB (already default)
                    except (ValueError, TypeError):
                        pass

        # --- priority from priorityCode ---
        pri_el = next((c for c in enc if _local(c) == "priorityCode" and c.get("code")), None)
        priority = None
        if pri_el is not None:
            pc = pri_el.get("code", "")
            pdisp = pri_el.get("displayName", "") or pc
            if pc:
                priority = {"coding": [{"system": _oid2sys(pri_el.get("codeSystem", "")),
                                        "code": pc, "display": pdisp}], "text": pdisp}

        # --- participant: performer/assignedEntity ---
        participants = []
        for perf in [c for c in enc if _local(c) == "performer"]:
            ae = _find_by_local(perf, "assignedEntity")
            if ae is None:
                continue
            person = _find_by_local(ae, "assignedPerson") or _find_by_local(ae, "person")
            name_el = _find_by_local(person, "name") if person is not None else None
            family = (_text(_find_by_local(name_el, "family")) if name_el is not None else None)
            given  = (_text(_find_by_local(name_el, "given"))  if name_el is not None else None)
            disp   = " ".join(p for p in [given, family] if p) or None
            npi_id = next((c for c in ae if _local(c) == "id"
                           and c.get("root") == _NPI_OID
                           and not c.get("nullFlavor")), None)
            npi_val = (npi_id.get("extension") or "") if npi_id is not None else None
            participants.append({
                "type": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                                      "code": "PART", "display": "Participant"}]}],
                "individual": {"display": disp},
                "_npi": npi_val or None,
            })

        # --- location: participant[@typeCode=LOC] > participantRole > playingEntity > name ---
        location_name = None
        for part in [c for c in enc if _local(c) == "participant"]:
            if part.get("typeCode") != "LOC":
                continue
            role_el = _find_by_local(part, "participantRole")
            if role_el is None:
                continue
            pe = _find_by_local(role_el, "playingEntity")
            if pe is not None:
                nm = _find_by_local(pe, "name")
                location_name = (_text(nm) or None) if nm is not None else None
            if location_name:
                break

        # --- diagnosis from entryRelationship[@typeCode=RSON] > observation > value ---
        diags = []
        for er in [c for c in enc if _local(c) == "entryRelationship"]:
            if er.get("typeCode") != "RSON":
                continue
            obs_el = _find_by_local(er, "observation")
            if obs_el is None:
                continue
            # prefer value element (actual diagnosis code), fall back to code element
            val_el = next((c for c in obs_el if _local(c) == "value" and c.get("code")), None)
            code_el = val_el or next((c for c in obs_el if _local(c) == "code" and c.get("code")), None)
            if code_el is not None:
                dcode = code_el.get("code", "")
                doid  = code_el.get("codeSystem", "")
                ddisp = code_el.get("displayName") or dcode
                diags.append({
                    "condition": {"display": ddisp},
                    "_code":   dcode,
                    "_system": _oid2sys(doid),
                    "use": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/diagnosis-role",
                                        "code": "AD", "display": "Admission diagnosis"}]},
                    "rank": len(diags) + 1,
                })

        # --- reasonCode from entryRelationship[@typeCode=SUBJ or MFST] ---
        reason_codes = []
        for er in [c for c in enc if _local(c) == "entryRelationship"]:
            if er.get("typeCode") not in ("SUBJ", "MFST"):
                continue
            act = _find_by_local(er, "act") or _find_by_local(er, "observation")
            if act is not None:
                rc_el = next((c for c in act if _local(c) == "code" and c.get("code")), None)
                if rc_el is not None:
                    rc = rc_el.get("code", "")
                    rd = rc_el.get("displayName") or rc
                    reason_codes.append(_fcc(rc, rc_el.get("codeSystem", ""), rd))

        results.append({
            "resourceType": "Encounter",
            "id": _uuid(),
            "meta": {"profile": ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter"]},
            "status": status,
            "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": enc_class_code, "display": enc_class_display},
            "type": type_field,
            "priority": priority,
            "subject": {"reference": f"Patient/{pat_id}"},
            "participant": participants if participants else None,
            "period": {"start": _fhir_date(start), "end": _fhir_date(end)},
            "reasonCode": reason_codes if reason_codes else None,
            "diagnosis": diags if diags else None,
            "location": [{"location": {"display": location_name}}] if location_name else None,
            "_ccda_id": ccda_enc_id,
        })
    return results


def _build_proc_resource(proc, pat_id: str, fallback_date: str | None = None) -> dict | None:
    """Build a FHIR Procedure dict from any <procedure classCode='PROC'> element.
    Used by both the Procedures section and Results section organizer components.
    fallback_date: FHIR-formatted date used when the procedure has no own effectiveTime
                   (typically the encounter date or document date).
    """
    _STATUS_MAP = {
        "completed": "completed", "active": "in-progress", "aborted": "stopped",
        "cancelled": "not-done", "suspended": "on-hold", "new": "preparation",
    }
    _NPI_OID = "2.16.840.1.113883.4.6"

    # code — direct child only
    code_el = next((c for c in proc if _local(c) == "code" and c.get("code") and c.get("codeSystem")), None)
    if code_el is None:
        return None
    code = code_el.get("code", "")
    oid  = code_el.get("codeSystem", "")
    disp = code_el.get("displayName", "")
    if not code:
        return None

    # status
    sc_el  = next((c for c in proc if _local(c) == "statusCode"), None)
    status = _STATUS_MAP.get(_get_el_attr(sc_el, "code", ""), "unknown")

    # effectiveTime → performedDateTime or performedPeriod
    # Falls back to fallback_date (encounter/document date) when the procedure
    # has no own effectiveTime or its dates are all null-flavored.
    eff_el  = next((c for c in proc if _local(c) == "effectiveTime"), None)
    perf_dt = perf_start = perf_end = None
    if eff_el is not None:
        val = eff_el.get("value")
        if val:
            perf_dt = _fhir_date(val)
        else:
            low_el  = _find_by_local(eff_el, "low")
            high_el = _find_by_local(eff_el, "high")
            if low_el is not None:
                perf_start = _fhir_date(_get_el_attr(low_el,  "value"))
                perf_dt    = perf_start
            if high_el is not None:
                perf_end   = _fhir_date(_get_el_attr(high_el, "value"))
    if perf_dt is None and fallback_date:
        perf_dt = fallback_date

    # targetSiteCode → bodySite
    site_el = next((c for c in proc if _local(c) == "targetSiteCode"), None)
    body_site_code = body_site_display = None
    if site_el is not None:
        bsc = (site_el.get("code") or "").strip()
        if bsc and bsc.upper() not in _NULL_EXT:
            body_site_code    = bsc
            body_site_display = site_el.get("displayName")

    # methodCode → method
    meth_el = next((c for c in proc if _local(c) == "methodCode"), None)
    method_code = method_display = None
    if meth_el is not None:
        mc = (meth_el.get("code") or "").strip()
        if mc and mc.upper() not in _NULL_EXT:
            method_code    = mc
            method_display = meth_el.get("displayName")

    # performer/assignedEntity → performer display + NPI
    performer_display = performer_npi = None
    for perf_el in [c for c in proc if _local(c) == "performer"]:
        ae = _find_by_local(perf_el, "assignedEntity")
        if ae is None:
            continue
        for id_el in [c for c in ae if _local(c) == "id" and not c.get("nullFlavor")]:
            if id_el.get("root") == _NPI_OID:
                ext = (id_el.get("extension") or "").strip()
                if ext and ext.upper() not in _NULL_EXT:
                    performer_npi = ext
                break
        person  = _find_by_local(ae, "assignedPerson")
        name_el = _find_by_local(person, "name") if person is not None else None
        if name_el is not None:
            given  = " ".join((g.text or "").strip() for g in name_el if _local(g) == "given").strip()
            fam_el = next((c for c in name_el if _local(c) == "family"), None)
            family = (fam_el.text or "").strip() if fam_el is not None else ""
            performer_display = f"{given} {family}".strip() or None
        break

    # entryRelationship[@typeCode=RSON] → reasonCode
    reason_code = reason_system = reason_display = None
    for er in [c for c in proc if _local(c) == "entryRelationship"]:
        if er.get("typeCode") != "RSON":
            continue
        obs = _find_by_local(er, "observation") or _find_by_local(er, "act")
        val_el = _find_by_local(obs, "value") if obs is not None else None
        if val_el is None and obs is not None:
            val_el = next((c for c in obs if _local(c) == "code"), None)
        if val_el is not None:
            rc = (val_el.get("code") or "").strip()
            if rc and rc.upper() not in _NULL_EXT:
                reason_code    = rc
                reason_system  = val_el.get("codeSystem")
                reason_display = val_el.get("displayName")
        break

    # entryRelationship[@typeCode=COMP] → outcome
    outcome_code = outcome_display = None
    for er in [c for c in proc if _local(c) == "entryRelationship"]:
        if er.get("typeCode") != "COMP":
            continue
        obs = _find_by_local(er, "observation")
        val_el = _find_by_local(obs, "value") if obs is not None else None
        if val_el is not None:
            oc = (val_el.get("code") or "").strip()
            if oc and oc.upper() not in _NULL_EXT:
                outcome_code    = oc
                outcome_display = val_el.get("displayName")
        break

    # note from text element
    text_el = next((c for c in proc if _local(c) == "text"), None)
    note = (text_el.text or "").strip() if text_el is not None and text_el.text else None

    performer_obj = None
    if performer_display or performer_npi:
        actor = {"display": performer_display}
        if performer_npi:
            actor["_npi"] = performer_npi
        performer_obj = [{"actor": actor}]

    perf_period = {"start": perf_start, "end": perf_end} if (perf_start or perf_end) else None

    return {
        "resourceType": "Procedure",
        "id": _uuid(),
        "status": status,
        "code": _fcc(code, oid, disp),
        "subject": {"reference": f"Patient/{pat_id}"},
        "performedDateTime": perf_dt,
        "performedPeriod": perf_period,
        "performer": performer_obj,
        "reasonCode": [{"coding": [{"code": reason_code, "system": reason_system, "display": reason_display}]}] if reason_code else None,
        "outcome": {"coding": [{"code": outcome_code, "display": outcome_display}]} if outcome_code else None,
        "bodySite": [{"coding": [{"code": body_site_code, "display": body_site_display or ""}]}] if body_site_code else None,
        "method": {"coding": [{"code": method_code, "display": method_display or ""}]} if method_code else None,
        "note": [{"text": note}] if note else None,
    }


def fhir_procedures(root, pat_id: str, encounters: list | None = None) -> list[dict]:
    results = []

    # Build fallback date: first encounter date → document effectiveTime
    # Used when a procedure has no own effectiveTime element.
    _fallback_date: str | None = None
    if encounters:
        first_enc_start = ((encounters[0].get("period") or {}).get("start") or "")
        if first_enc_start:
            _fallback_date = first_enc_start
    if _fallback_date is None:
        doc_eff = next((c for c in root if _local(c) == "effectiveTime"), None)
        if doc_eff is not None:
            _fallback_date = _fhir_date(doc_eff.get("value") or
                                        _get_el_attr(_find_by_local(doc_eff, "low"), "value"))

    # 1. Procedures section — standard location
    sec = find_section(root, OID["PROCEDURES"])
    if sec is not None:
        for entry in _find_all_by_local(sec, "entry"):
            proc = _find_by_local(entry, "procedure")
            if proc is None:
                continue
            r = _build_proc_resource(proc, pat_id, fallback_date=_fallback_date)
            if r:
                results.append(r)

    # 2. Results section organizer components — some vendors place <procedure> elements
    #    directly inside <organizer><component> instead of <observation> (e.g. urinalysis panels)
    res_sec = find_section(root, OID["RESULTS"])
    if res_sec is not None:
        for entry in _find_all_by_local(res_sec, "entry"):
            org = _find_by_local(entry, "organizer")
            if org is None:
                continue
            # Organizer date takes priority over document fallback for its own components
            org_eff = next((c for c in org if _local(c) == "effectiveTime"), None)
            org_date = None
            if org_eff is not None:
                org_date = _fhir_date(org_eff.get("value") or
                                      _get_el_attr(_find_by_local(org_eff, "low"), "value"))
            for comp in [c for c in org if _local(c) == "component"]:
                proc = _find_by_local(comp, "procedure")
                if proc is None:
                    continue
                r = _build_proc_resource(proc, pat_id, fallback_date=org_date or _fallback_date)
                if r:
                    results.append(r)

    return results


def fhir_immunizations(root, pat_id: str) -> list[dict]:
    _NPI_OID = "2.16.840.1.113883.4.6"

    sec = find_section(root, OID["IMMUNIZE"])
    if sec is None:
        return []
    results = []
    for entry in _find_all_by_local(sec, "entry"):
        sa = _find_by_local(entry, "substanceAdministration")
        if sa is None:
            continue

        # --- vaccine code from consumable/manufacturedProduct/manufacturedMaterial/code ---
        consumable = _find_by_local(sa, "consumable")
        mp  = _find_by_local(consumable, "manufacturedProduct") if consumable is not None else None
        mat = _find_by_local(mp, "manufacturedMaterial")       if mp is not None else None
        code_el = _find_by_local(mat, "code") if mat is not None else None
        if code_el is None:
            continue
        code = code_el.get("code", "")
        oid  = code_el.get("codeSystem", "")
        disp = code_el.get("displayName", "")
        if not code:
            continue

        # --- lot number ---
        lot_el = _find_by_local(mat, "lotNumberText") if mat is not None else None
        lot_number = (_text(lot_el) or None) if lot_el is not None else None

        # --- manufacturer name ---
        mfr_org  = _find_by_local(mp, "manufacturerOrganization") if mp is not None else None
        mfr_name_el = _find_by_local(mfr_org, "name") if mfr_org is not None else None
        manufacturer = (_text(mfr_name_el) or None) if mfr_name_el is not None else None

        # --- status ---
        sc_el = next((c for c in sa if _local(c) == "statusCode"), None)
        sc    = _get_el_attr(sc_el, "code", "")
        status = "completed" if sc == "completed" else "not-done"
        primary_source = (sc == "completed")

        # --- statusReason from entryRelationship[@typeCode=RSON] when not-done ---
        status_reason = None
        if status == "not-done":
            for er in [c for c in sa if _local(c) == "entryRelationship" and c.get("typeCode") == "RSON"]:
                er_obs = _find_by_local(er, "observation")
                if er_obs is None:
                    continue
                sr_val = next((c for c in er_obs if _local(c) == "value" and c.get("code")), None)
                if sr_val is not None:
                    sr_c = sr_val.get("code", "")
                    sr_d = sr_val.get("displayName") or sr_c
                    status_reason = {"coding": [{"system": _oid2sys(sr_val.get("codeSystem", "")),
                                                 "code": sr_c, "display": sr_d}], "text": sr_d}
                    break

        # --- effectiveTime ---
        eff_el  = _find_by_local(sa, "effectiveTime")
        eff_val = _get_el_attr(eff_el, "value") if eff_el is not None else None

        # --- route from routeCode ---
        route_el = next((c for c in sa if _local(c) == "routeCode" and c.get("code")), None)
        route = None
        if route_el is not None:
            rc = route_el.get("code", "")
            rd = route_el.get("displayName") or rc
            route = {"coding": [{"system": _oid2sys(route_el.get("codeSystem", "")),
                                 "code": rc, "display": rd}], "text": rd}

        # --- body site from approachSiteCode ---
        site_el = next((c for c in sa if _local(c) == "approachSiteCode" and c.get("code")), None)
        site = None
        if site_el is not None:
            sc2 = site_el.get("code", "")
            sd  = site_el.get("displayName") or sc2
            site = {"coding": [{"system": _oid2sys(site_el.get("codeSystem", "")),
                                "code": sc2, "display": sd}], "text": sd}

        # --- doseQuantity ---
        dose_el = next((c for c in sa if _local(c) == "doseQuantity"), None)
        dose_quantity = None
        if dose_el is not None:
            dv = dose_el.get("value")
            du = dose_el.get("unit")
            if dv:
                try:
                    dose_quantity = {"value": float(dv), "unit": du or "",
                                     "system": "http://unitsofmeasure.org", "code": du or ""}
                except (ValueError, TypeError):
                    pass

        # --- performer from performer/assignedEntity ---
        performers = []
        for perf in [c for c in sa if _local(c) == "performer"]:
            ae = _find_by_local(perf, "assignedEntity")
            if ae is None:
                continue
            person  = _find_by_local(ae, "assignedPerson") or _find_by_local(ae, "person")
            name_el = _find_by_local(person, "name") if person is not None else None
            family  = _text(_find_by_local(name_el, "family")) if name_el is not None else None
            given   = _text(_find_by_local(name_el, "given"))  if name_el is not None else None
            p_disp  = " ".join(p for p in [given, family] if p) or None
            npi_id  = next((c for c in ae if _local(c) == "id"
                            and c.get("root") == _NPI_OID
                            and not c.get("nullFlavor")), None)
            npi_ext = (npi_id.get("extension") or "") if npi_id is not None else None
            performers.append({
                "function": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v2-0443",
                                         "code": "AP", "display": "Administering Provider"}]},
                "actor": {"display": p_disp},
                "_npi": npi_ext or None,
            })

        results.append({
            "resourceType": "Immunization",
            "id": _uuid(),
            "status": status,
            "statusReason": status_reason,
            "vaccineCode": _fcc(code, oid, disp),
            "patient": {"reference": f"Patient/{pat_id}"},
            "occurrenceDateTime": _fhir_date(eff_val) or "unknown",
            "primarySource": primary_source,
            "manufacturer": {"display": manufacturer} if manufacturer else None,
            "lotNumber": lot_number,
            "site": site,
            "route": route,
            "doseQuantity": dose_quantity,
            "performer": performers if performers else None,
        })
    return results


def fhir_practitioners_orgs_roles(root) -> tuple[list, list, list]:
    practitioners = []
    organizations = []
    practitioner_roles = []
    seen_pracs: dict[str, str] = {}
    seen_orgs: dict[str, str] = {}

    # ── helpers ──────────────────────────────────────────────────────────────
    # _pick_id is defined at module level and used here via closure

    def _id_system(root_oid):
        if root_oid == _NPI_OID:
            return "http://hl7.org/fhir/sid/us-npi"
        return f"urn:oid:{root_oid}" if root_oid else "urn:unknown"

    def _telecom_list(parent_el):
        result = []
        for t in [c for c in parent_el if _local(c) == "telecom"]:
            val = (t.get("value") or "").strip()
            if not val:
                continue
            val_lower = val.lower()
            if val_lower.startswith("tel:"):
                result.append({"system": "phone", "value": val[4:].strip(), "use": "work"})
            elif val_lower.startswith("fax:"):
                result.append({"system": "fax",   "value": val[4:].strip(), "use": "work"})
            elif val_lower.startswith("mailto:"):
                result.append({"system": "email",  "value": val[7:].strip(), "use": "work"})
            elif "@" in val:
                result.append({"system": "email",  "value": val,             "use": "work"})
            else:
                result.append({"system": "phone",  "value": val,             "use": "work"})
        return result or None

    def _address_list(parent_el):
        result = []
        for addr_el in [c for c in parent_el if _local(c) == "addr"]:
            entry: dict = {"use": "work"}
            street = _text(_find_by_local(addr_el, "streetAddressLine"))
            city   = _text(_find_by_local(addr_el, "city"))
            state  = _text(_find_by_local(addr_el, "state"))
            postal = _text(_find_by_local(addr_el, "postalCode"))
            country = _text(_find_by_local(addr_el, "country"))
            if street:  entry["line"]       = [street]
            if city:    entry["city"]        = city
            if state:   entry["state"]       = state
            if postal:  entry["postalCode"]  = postal
            if country: entry["country"]     = country
            if len(entry) > 1:
                result.append(entry)
        return result or None

    def _code_concept(el):
        """Return a CodeableConcept dict from a CCDA code element, or None."""
        if el is None or not el.get("code"):
            return None
        return {"coding": [{"system": _id_system(el.get("codeSystem", "")),
                             "code": el.get("code"),
                             "display": el.get("displayName") or el.get("code")}],
                "text": el.get("displayName") or el.get("code")}

    def _period_from_time(time_el):
        if time_el is None:
            return None, None
        low_el  = _find_by_local(time_el, "low")
        high_el = _find_by_local(time_el, "high")
        start = _fhir_date(_get_el_attr(low_el, "value")  or _get_el_attr(time_el, "value"))
        end   = _fhir_date(_get_el_attr(high_el, "value"))
        return start, end

    # ── Organization ──────────────────────────────────────────────────────────

    def get_or_create_org(org_el):
        name_el  = _find_by_local(org_el, "name")
        org_name = _text(name_el) or ""
        id_val, id_root = _pick_id(org_el)
        id_val  = id_val  or ""
        id_root = id_root or ""
        key = f"{org_name}|{id_val}"
        if not org_name and not id_val:
            return None
        if key not in seen_orgs:
            oid = _uuid()
            seen_orgs[key] = oid
            system = _id_system(id_root)
            # type: not typically coded in CCDA — leave as provider default
            org_type_el = next((c for c in org_el
                                if _local(c) == "standardIndustryClassCode" and c.get("code")), None)
            org_type = _code_concept(org_type_el)
            organizations.append({
                "resourceType": "Organization",
                "id": oid,
                "meta": {"profile": ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-organization"]},
                "active": True,
                "identifier": [{"system": system, "value": id_val}] if id_val else None,
                "name": org_name or None,
                "type": [org_type] if org_type else None,
                "telecom": _telecom_list(org_el),
                "address": _address_list(org_el),
            })
        return seen_orgs[key]

    # ── Practitioner ──────────────────────────────────────────────────────────

    def get_or_create_prac(entity_el):
        person_el = _find_by_local(entity_el, "assignedPerson") or _find_by_local(entity_el, "person")
        if person_el is None:
            return None
        name_el = _find_by_local(person_el, "name")
        if name_el is None:
            return None
        family = _text(_find_by_local(name_el, "family"))
        given  = _text(_find_by_local(name_el, "given"))
        if not family and not given:
            return None
        npi, npi_root = _pick_id(entity_el)
        key = f"{family}|{given}|{npi or ''}"
        if key not in seen_pracs:
            pid = _uuid()
            seen_pracs[key] = pid
            name_entry: dict = {"use": "official", "family": family}
            if given:
                name_entry["given"] = [_text(g) for g in _find_all_by_local(name_el, "given") if _text(g)]
                if not name_entry["given"]:
                    name_entry["given"] = [given]
            prefix_parts = [_text(p) for p in _find_all_by_local(name_el, "prefix") if _text(p)]
            suffix_parts = [_text(s) for s in _find_all_by_local(name_el, "suffix") if _text(s)]
            if prefix_parts: name_entry["prefix"] = prefix_parts
            if suffix_parts: name_entry["suffix"] = suffix_parts
            # qualification: code on the assignedAuthor/assignedEntity itself
            code_el = next((c for c in entity_el if _local(c) == "code" and c.get("code")), None)
            qualification = None
            if code_el is not None:
                qual_concept = _code_concept(code_el)
                if qual_concept:
                    qualification = [{"code": qual_concept}]
            practitioners.append({
                "resourceType": "Practitioner",
                "id": pid,
                "meta": {"profile": ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner"]},
                "active": True,
                "identifier": [{"system": _id_system(npi_root), "value": npi}] if npi else None,
                "name": [name_entry],
                "telecom": _telecom_list(entity_el),
                "address": _address_list(entity_el),
                "qualification": qualification,
            })
        return seen_pracs[key]

    # ── PractitionerRole ─────────────────────────────────────────────────────

    def add_role(prac_id, org_id, role_concept, specialty_concept=None,
                 period_start=None, period_end=None):
        if prac_id is None:
            return
        role: dict = {
            "resourceType": "PractitionerRole",
            "id": _uuid(),
            "active": True,
            "practitioner": {"reference": f"Practitioner/{prac_id}"},
            "organization": {"reference": f"Organization/{org_id}"} if org_id else None,
            "code": [role_concept] if role_concept else None,
            "specialty": [specialty_concept] if specialty_concept else None,
        }
        if period_start or period_end:
            role["period"] = {}
            if period_start: role["period"]["start"] = period_start
            if period_end:   role["period"]["end"]   = period_end
        practitioner_roles.append(role)

    # ── default role concepts ─────────────────────────────────────────────────

    def _snomed_concept(code, display):
        return {"coding": [{"system": "http://snomed.info/sct", "code": code, "display": display}],
                "text": display}

    ROLE_AUTHOR    = _snomed_concept("159012006", "Author")
    ROLE_LEGAL_AUTH = _snomed_concept("425941003", "Legal Authenticator")

    # ── first pass: capture custodian org (used as fallback for roles) ───────
    custodian_org_id = None
    for child in root:
        if _local(child) == "custodian":
            ac     = _find_by_local(child, "assignedCustodian")
            org_el = _find_by_local(ac, "representedCustodianOrganization") if ac is not None else None
            if org_el is not None:
                custodian_org_id = get_or_create_org(org_el)
            break

    # ── second pass: traverse CCDA header ────────────────────────────────────
    for child in root:
        tag = _local(child)

        if tag == "author":
            aa = _find_by_local(child, "assignedAuthor")
            if aa is None:
                continue
            prac_id = get_or_create_prac(aa)
            org_el  = _find_by_local(aa, "representedOrganization")
            org_id  = get_or_create_org(org_el) if org_el is not None else custodian_org_id
            # period from author/time
            time_el = _find_by_local(child, "time")
            p_start, p_end = _period_from_time(time_el)
            add_role(prac_id, org_id, ROLE_AUTHOR, period_start=p_start, period_end=p_end)

        elif tag == "custodian":
            pass  # already processed in first pass

        elif tag == "legalAuthenticator":
            ae     = _find_by_local(child, "assignedEntity")
            if ae is None:
                continue
            prac_id = get_or_create_prac(ae)
            org_el  = _find_by_local(ae, "representedOrganization")
            org_id  = get_or_create_org(org_el) if org_el is not None else custodian_org_id
            time_el = _find_by_local(child, "time")
            p_start, p_end = _period_from_time(time_el)
            add_role(prac_id, org_id, ROLE_LEGAL_AUTH, period_start=p_start, period_end=p_end)

        elif tag == "documentationOf":
            for se in _find_all_by_local(child, "serviceEvent"):
                for perf in _find_all_by_local(se, "performer"):
                    ae = _find_by_local(perf, "assignedEntity")
                    if ae is None:
                        continue
                    prac_id = get_or_create_prac(ae)
                    org_el  = _find_by_local(ae, "representedOrganization")
                    org_id  = get_or_create_org(org_el) if org_el is not None else custodian_org_id
                    # role from functionCode on performer
                    fc_el = next((c for c in perf if _local(c) == "functionCode" and c.get("code")), None)
                    if fc_el is not None:
                        role_concept = _code_concept(fc_el)
                    else:
                        role_concept = _snomed_concept("420158005", "Performer")
                    # specialty from code on assignedEntity
                    spec_el = next((c for c in ae if _local(c) == "code" and c.get("code")), None)
                    specialty = _code_concept(spec_el)
                    # period from time on performer
                    time_el = _find_by_local(perf, "time")
                    p_start, p_end = _period_from_time(time_el)
                    add_role(prac_id, org_id, role_concept, specialty, p_start, p_end)

    return practitioners, organizations, practitioner_roles


def fhir_medication_administrations(root, pat_id: str) -> list[dict]:
    """substanceAdministration[@moodCode='EVN'] → MedicationAdministration (actual events).

    Sources checked in order:
      1. Medications Administered section (OID MEDADMIN) — all entries
      2. General Medications section (OID MEDICATIONS) — only moodCode=EVN entries
    Deduplication by lxml element identity prevents double-counting shared entries.
    """
    _STATUS_MAP = {
        "completed":  "completed",
        "active":     "in-progress",
        "aborted":    "stopped",
        "cancelled":  "not-done",
        "suspended":  "on-hold",
        "new":        "in-progress",
    }

    results = []
    seen_el_ids: set[int] = set()

    sections: list[tuple] = []
    admin_sec = find_section(root, OID["MEDADMIN"])
    if admin_sec is not None:
        sections.append((admin_sec, False))   # False = accept all moodCodes

    med_sec = find_section(root, OID["MEDICATIONS"])
    if med_sec is not None:
        sections.append((med_sec, True))      # True = EVN only

    for sec, evn_only in sections:
        for entry in _find_all_by_local(sec, "entry"):
            sa = _find_by_local(entry, "substanceAdministration")
            if sa is None:
                continue
            if evn_only and sa.get("moodCode", "") != "EVN":
                continue
            el_id = id(sa)
            if el_id in seen_el_ids:
                continue
            seen_el_ids.add(el_id)

            # medication code
            mat     = _find_by_local(sa, "manufacturedMaterial")
            code_el = _find_by_local(mat, "code") if mat is not None else None
            if code_el is None:
                continue
            code = code_el.get("code", "")
            oid  = code_el.get("codeSystem", "")
            disp = code_el.get("displayName", "")
            if not code:
                continue

            # status
            sc_el  = _find_by_local(sa, "statusCode")
            status = _STATUS_MAP.get(_get_el_attr(sc_el, "code", ""), "unknown")

            # statusReason — present when negationInd="true" with a RSON relationship
            status_reason_code = status_reason_display = None
            if sa.get("negationInd", "").lower() == "true":
                for er in [c for c in sa if _local(c) == "entryRelationship"]:
                    if er.get("typeCode") != "RSON":
                        continue
                    obs = _find_by_local(er, "observation") or _find_by_local(er, "act")
                    v   = _find_by_local(obs, "value") if obs is not None else None
                    c2  = _find_by_local(obs, "code")  if obs is not None else None
                    src = v if v is not None else c2
                    if src is not None:
                        status_reason_code    = src.get("code")
                        status_reason_display = src.get("displayName")
                    break

            # effectiveDateTime / effectivePeriod
            effective_dt = effective_start = effective_end = None
            for eff_el in [c for c in sa if _local(c) == "effectiveTime"]:
                xsi_t = eff_el.get("{http://www.w3.org/2001/XMLSchema-instance}type", "")
                if "PIVL" in xsi_t or "EIVL" in xsi_t:
                    continue
                val = eff_el.get("value")
                if val:
                    effective_dt = effective_dt or _fhir_date(val)
                    continue
                low_el  = _find_by_local(eff_el, "low")
                high_el = _find_by_local(eff_el, "high")
                if low_el is not None:
                    effective_start = _fhir_date(_get_el_attr(low_el, "value"))
                    effective_dt    = effective_dt or effective_start
                if high_el is not None:
                    effective_end = _fhir_date(_get_el_attr(high_el, "value"))

            # routeCode → dosage.route
            route_el    = _find_by_local(sa, "routeCode")
            route_code  = route_display = None
            if route_el is not None:
                rc = (route_el.get("code") or "").strip()
                if rc and rc.upper() not in _NULL_EXT and rc not in {"-1", "-2"}:
                    route_code    = rc
                    route_display = route_el.get("displayName") or None

            # approachSiteCode → dosage.site
            site_el    = _find_by_local(sa, "approachSiteCode")
            site_code  = site_display = None
            if site_el is not None:
                sc_code = (site_el.get("code") or "").strip()
                if sc_code and sc_code.upper() not in _NULL_EXT:
                    site_code    = sc_code
                    site_display = site_el.get("displayName") or None

            # doseQuantity → dosage.dose
            dose_el    = _find_by_local(sa, "doseQuantity")
            dose_value = dose_unit = None
            if dose_el is not None:
                try:
                    dose_value = float(dose_el.get("value"))
                except (TypeError, ValueError):
                    pass
                dose_unit = dose_el.get("unit") or None

            # rateQuantity → dosage.rateQuantity
            rate_el    = _find_by_local(sa, "rateQuantity")
            rate_value = rate_unit = None
            if rate_el is not None:
                try:
                    rate_value = float(rate_el.get("value"))
                except (TypeError, ValueError):
                    pass
                rate_unit = rate_el.get("unit") or None

            # performer: assignedEntity (nurse/provider who administered)
            performer_display = performer_npi = None
            for tag in ("performer", "author"):
                ae_parent = _find_by_local(sa, tag)
                if ae_parent is None:
                    continue
                assigned = _find_by_local(ae_parent, "assignedEntity") or _find_by_local(ae_parent, "assignedAuthor")
                if assigned is None:
                    continue
                npi_val, _ = _pick_id(assigned)
                performer_npi = npi_val
                person  = _find_by_local(assigned, "assignedPerson")
                name_el = _find_by_local(person, "name") if person is not None else None
                if name_el is not None:
                    given  = " ".join((g.text or "").strip() for g in name_el if _local(g) == "given").strip()
                    fam_el = next((c for c in name_el if _local(c) == "family"), None)
                    family = (fam_el.text or "").strip() if fam_el is not None else ""
                    performer_display = f"{given} {family}".strip() or None
                break

            # reasonCode: entryRelationship[@typeCode=RSON]
            reason_code = reason_system = reason_display = None
            for er in [c for c in sa if _local(c) == "entryRelationship"]:
                if er.get("typeCode") != "RSON":
                    continue
                obs    = _find_by_local(er, "observation") or _find_by_local(er, "act")
                val_el = _find_by_local(obs, "value") if obs is not None else None
                cd_el  = _find_by_local(obs, "code")  if obs is not None else None
                src    = val_el if val_el is not None else cd_el
                if src is not None:
                    reason_code    = src.get("code")
                    reason_system  = src.get("codeSystem")
                    reason_display = src.get("displayName")
                break

            # note from text element
            text_el = _find_by_local(sa, "text")
            note = (text_el.text or "").strip() if text_el is not None and text_el.text else None

            # dosage object
            dosage: dict = {}
            if route_code:
                dosage["route"] = {"coding": [{"code": route_code, "display": route_display}]}
            if site_code:
                dosage["site"] = {"coding": [{"code": site_code, "display": site_display}]}
            if dose_value is not None:
                dosage["dose"] = {"value": dose_value, "unit": dose_unit or "", "system": "http://unitsofmeasure.org"}
            if rate_value is not None:
                dosage["rateQuantity"] = {"value": rate_value, "unit": rate_unit or ""}

            performer_obj = None
            if performer_display or performer_npi:
                actor = {"display": performer_display}
                if performer_npi:
                    actor["_npi"] = performer_npi
                performer_obj = [{"actor": actor}]

            results.append({
                "resourceType": "MedicationAdministration",
                "id":           _uuid(),
                "status":       status,
                "statusReason": [{"coding": [{"code": status_reason_code, "display": status_reason_display}]}] if status_reason_code else None,
                "medicationCodeableConcept": _fcc(code, oid, disp),
                "subject":         {"reference": f"Patient/{pat_id}"},
                "effectiveDateTime": effective_dt,
                "effectivePeriod":   {"start": effective_start, "end": effective_end} if (effective_start or effective_end) else None,
                "performer":   performer_obj,
                "reasonCode":  [{"coding": [{"code": reason_code, "system": reason_system, "display": reason_display}]}] if reason_code else None,
                "dosage":      dosage if dosage else None,
                "note":        [{"text": note}] if note else None,
            })

    return results


def fhir_diagnostic_reports(root, pat_id: str, encounters=None) -> list[dict]:
    """CCDA Results section organizer elements → FHIR R4 DiagnosticReport resources.

    Each <organizer> (battery/panel) in the Results section maps to one DiagnosticReport.
    Individual <observation> children are already extracted as Observation resources.
    encounters: already-extracted FHIR Encounter dicts — used to resolve encounter references by date.
    """
    _STATUS_MAP = {
        "completed":  "final",
        "active":     "preliminary",
        "aborted":    "cancelled",
        "cancelled":  "cancelled",
        "new":        "registered",
        "held":       "registered",
        "nullified":  "entered-in-error",
        "suspended":  "amended",
    }
    _NPI_OID = "2.16.840.1.113883.4.6"

    # document effectiveTime → issued instant
    doc_time_el = next((c for c in root if _local(c) == "effectiveTime"), None)
    issued = _fhir_date(_get_el_attr(doc_time_el, "value")) if doc_time_el is not None else None

    # CCDA encounter id → FHIR Encounter UUID (for explicit entryRelationship matching only)
    _enc_id_map: dict[str, str] = {}
    for enc in (encounters or []):
        ccda_id = enc.get("_ccda_id")
        if ccda_id and enc.get("id"):
            _enc_id_map[ccda_id] = enc["id"]

    sec = find_section(root, OID["RESULTS"])
    if sec is None:
        return []

    results = []
    for entry in _find_all_by_local(sec, "entry"):
        org = _find_by_local(entry, "organizer")
        if org is None:
            continue

        # panel code — required
        code_el = next((c for c in org if _local(c) == "code" and c.get("code") and c.get("codeSystem")), None)
        if code_el is None:
            continue
        panel_code = code_el.get("code", "")
        panel_oid  = code_el.get("codeSystem", "")
        panel_disp = code_el.get("displayName", "")
        if not panel_code:
            continue

        # identifier
        identifier = identifier_system = None
        id_el = next((c for c in org if _local(c) == "id" and not c.get("nullFlavor")), None)
        if id_el is not None:
            ext     = (id_el.get("extension") or "").strip()
            id_root = id_el.get("root", "")
            if ext and ext.upper() not in _NULL_EXT:
                identifier = ext
            elif id_root:
                identifier = id_root
            identifier_system = f"urn:oid:{id_root}" if id_root else None

        # status
        sc_el  = next((c for c in org if _local(c) == "statusCode"), None)
        status = _STATUS_MAP.get(_get_el_attr(sc_el, "code", "completed"), "final")

        # effectiveTime
        eff_el = next((c for c in org if _local(c) == "effectiveTime"), None)
        eff_date = eff_start = eff_end = None
        if eff_el is not None:
            val = eff_el.get("value")
            if val:
                eff_date = _fhir_date(val)
            else:
                low_el  = _find_by_local(eff_el, "low")
                high_el = _find_by_local(eff_el, "high")
                if low_el is not None:
                    eff_start = _fhir_date(_get_el_attr(low_el, "value"))
                    eff_date  = eff_start
                if high_el is not None:
                    eff_end = _fhir_date(_get_el_attr(high_el, "value"))

        # performer: prefer author/assignedAuthor, fall back to performer/assignedEntity
        performer_display = performer_npi = None
        auth_el = next((c for c in org if _local(c) == "author"), None)
        if auth_el is not None:
            aa = _find_by_local(auth_el, "assignedAuthor")
            if aa is not None:
                npi_id = next((c for c in aa if _local(c) == "id"
                               and c.get("root") == _NPI_OID
                               and not c.get("nullFlavor")), None)
                if npi_id is not None:
                    ext = (npi_id.get("extension") or "").strip()
                    if ext and ext.upper() not in _NULL_EXT:
                        performer_npi = ext
                person  = _find_by_local(aa, "assignedPerson")
                name_el = _find_by_local(person, "name") if person is not None else None
                if name_el is not None:
                    given  = " ".join((g.text or "").strip() for g in name_el if _local(g) == "given").strip()
                    fam_el = next((c for c in name_el if _local(c) == "family"), None)
                    family = (fam_el.text or "").strip() if fam_el is not None else ""
                    performer_display = f"{given} {family}".strip() or None

        if performer_display is None:
            for perf_el in [c for c in org if _local(c) == "performer"]:
                ae = _find_by_local(perf_el, "assignedEntity")
                if ae is None:
                    continue
                npi_id = next((c for c in ae if _local(c) == "id"
                               and c.get("root") == _NPI_OID
                               and not c.get("nullFlavor")), None)
                if npi_id is not None:
                    ext = (npi_id.get("extension") or "").strip()
                    if ext and ext.upper() not in _NULL_EXT:
                        performer_npi = ext
                person  = _find_by_local(ae, "assignedPerson")
                name_el = _find_by_local(person, "name") if person is not None else None
                if name_el is not None:
                    given  = " ".join((g.text or "").strip() for g in name_el if _local(g) == "given").strip()
                    fam_el = next((c for c in name_el if _local(c) == "family"), None)
                    family = (fam_el.text or "").strip() if fam_el is not None else ""
                    performer_display = f"{given} {family}".strip() or None
                break

        # encounter: only from explicit entryRelationship/encounter with a matching CCDA id
        enc_ref = None
        for er in [c for c in org if _local(c) == "entryRelationship"]:
            inner_enc = _find_by_local(er, "encounter")
            if inner_enc is None:
                continue
            id_el = next((c for c in inner_enc if _local(c) == "id" and not c.get("nullFlavor")), None)
            if id_el is not None:
                id_root = id_el.get("root", "")
                id_ext  = (id_el.get("extension") or "").strip()
                ccda_id = f"{id_root}|{id_ext}" if id_ext else (id_root or None)
                if ccda_id:
                    matched = _enc_id_map.get(ccda_id)
                    if matched:
                        enc_ref = f"Encounter/{matched}"
            break

        # result_count: total observation elements inside this organizer
        result_count = sum(1 for c in org.iter() if _local(c) == "observation")

        # conclusion from text element on the organizer
        text_el = next((c for c in org if _local(c) == "text"), None)
        conclusion = (text_el.text or "").strip() if text_el is not None and text_el.text else None

        # conclusionCode from interpretationCode on organizer
        conclusion_code = conclusion_display = None
        interp_el = next((c for c in org if _local(c) == "interpretationCode" and c.get("code")), None)
        if interp_el is not None:
            cc = (interp_el.get("code") or "").strip()
            if cc and cc.upper() not in _NULL_EXT:
                conclusion_code    = cc
                conclusion_display = interp_el.get("displayName") or cc

        results.append({
            "resourceType": "DiagnosticReport",
            "id": _uuid(),
            "meta": {"profile": ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-diagnosticreport-lab"]},
            "status": status,
            "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v2-0074",
                                       "code": "LAB", "display": "Laboratory"}],
                          "text": "Laboratory"}],
            "code": _fcc(panel_code, panel_oid, panel_disp),
            "subject": {"reference": f"Patient/{pat_id}"},
            "encounter": {"reference": enc_ref} if enc_ref else None,
            "effectiveDateTime": eff_date,
            "effectivePeriod": {"start": eff_start, "end": eff_end} if (eff_start or eff_end) else None,
            "issued": issued,
            "performer": [{"display": performer_display}] if performer_display else None,
            "conclusion": conclusion or None,
            "conclusionCode": [_fcc(conclusion_code,
                                    interp_el.get("codeSystem", "") if interp_el else "",
                                    conclusion_display)] if conclusion_code else None,
            # private fields consumed by rows_from_bundle and CCDAAnalyzer.jsx
            "_identifier":         identifier,
            "_identifier_system":  identifier_system,
            "_performer_npi":      performer_npi,
            "_result_count":       result_count,
            "_conclusion_code":    conclusion_code,
            "_conclusion_display": conclusion_display,
        })
    return results


def build_fhir_bundle(name: str, xml_bytes: bytes) -> dict | None:
    from .parser import parse_xml
    root, err = parse_xml(xml_bytes)
    if root is None or err:
        return None

    patient = fhir_patient(root)
    pat_id = patient["id"]
    conditions          = fhir_conditions(root, pat_id)
    medications         = fhir_medications(root, pat_id)
    med_admins          = fhir_medication_administrations(root, pat_id)
    allergies           = fhir_allergies(root, pat_id)
    observations        = fhir_observations(root, pat_id)
    encounters          = fhir_encounters(root, pat_id)
    procedures          = fhir_procedures(root, pat_id, encounters)
    immunizations       = fhir_immunizations(root, pat_id)
    diagnostic_reports  = fhir_diagnostic_reports(root, pat_id, encounters)
    practitioners, organizations, practitioner_roles = fhir_practitioners_orgs_roles(root)

    all_resources = [_clean(r) for r in [
        patient,
        *conditions, *medications, *med_admins, *allergies, *observations,
        *encounters, *procedures, *immunizations, *diagnostic_reports,
        *practitioners, *organizations, *practitioner_roles,
    ]]

    counts = {
        "Patient": 1,
        "Condition": len(conditions),
        "MedicationRequest": len(medications),
        "MedicationAdministration": len(med_admins),
        "AllergyIntolerance": len(allergies),
        "Observation": len(observations),
        "Encounter": len(encounters),
        "Procedure": len(procedures),
        "Immunization": len(immunizations),
        "DiagnosticReport": len(diagnostic_reports),
        "Practitioner": len(practitioners),
        "Organization": len(organizations),
        "PractitionerRole": len(practitioner_roles),
        "total": len(all_resources),
    }

    return {
        "resourceType": "Bundle",
        "id": _uuid(),
        "meta": {
            "lastUpdated": datetime.utcnow().isoformat() + "Z",
            "tag": [{"system": "http://example.org/ccda-ai", "code": "ccda-converted", "display": "Converted from CCDA"}],
        },
        "type": "collection",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "entry": [{"fullUrl": f"urn:uuid:{r['id']}", "resource": r} for r in all_resources],
        "_meta": {"sourceFile": name, "counts": counts},
    }
