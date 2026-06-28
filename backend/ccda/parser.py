from lxml import etree
from datetime import datetime
from .constants import OID, CS

NS = {"h": "urn:hl7-org:v3"}
_NSMAP = "urn:hl7-org:v3"


def parse_xml(xml_bytes: bytes):
    try:
        root = etree.fromstring(xml_bytes)
        return root, None
    except etree.XMLSyntaxError as e:
        return None, str(e)


def _ns(tag: str) -> str:
    return f"{{{_NSMAP}}}{tag}"


def _xpath(el, path: str):
    try:
        # Support both namespaced and non-namespaced documents
        res = el.xpath(path, namespaces={"h": _NSMAP})
        if not res:
            # try without namespace prefix
            plain = path.replace("h:", "")
            res = el.xpath(plain)
        return res
    except Exception:
        return []


def _q1(el, path: str):
    r = _xpath(el, path)
    return r[0] if r else None


def find_section(root, oids: list):
    """Find a CCDA section by any of the given templateId root OIDs."""
    for oid in oids:
        hits = _xpath(root, f"//h:templateId[@root='{oid}']")
        if not hits:
            hits = _xpath(root, f"//templateId[@root='{oid}']")
        for tid in hits:
            sec = tid.getparent()
            if sec is not None and etree.QName(sec.tag).localname == "section":
                return sec
    return None


def sec_codes(sec) -> list[dict]:
    """Extract all coded elements from a section."""
    if sec is None:
        return []
    codes = []
    for el in sec.iter():
        code = el.get("code")
        sys_ = el.get("codeSystem")
        if code and sys_:
            codes.append({
                "code": code,
                "sys": sys_,
                "disp": el.get("displayName", ""),
            })
    return codes


def all_codes(root) -> list[dict]:
    """Extract all coded elements from entire document."""
    codes = []
    for el in root.iter():
        code = el.get("code")
        sys_ = el.get("codeSystem")
        if code and sys_:
            codes.append({
                "code": code,
                "sys": sys_,
                "disp": el.get("displayName", ""),
            })
    return codes


def _q1_fallback(root, ns_path: str, plain_tag: str):
    res = _xpath(root, ns_path)
    if res:
        return res[0]
    for el in root.iter():
        if etree.QName(el.tag).localname == plain_tag:
            return el
    return None


def pat_info(root) -> dict:
    bd_el    = _q1_fallback(root, "//h:birthTime",                 "birthTime")
    gc_el    = _q1_fallback(root, "//h:administrativeGenderCode",  "administrativeGenderCode")
    given_el = _q1_fallback(root, "//h:given",                     "given")
    family_el= _q1_fallback(root, "//h:family",                    "family")
    addr_el  = _q1_fallback(root, "//h:addr",                      "addr")

    bv = bd_el.get("value") if bd_el is not None else None
    age = None
    if bv and len(bv) >= 8:
        try:
            y, m, d = int(bv[:4]), int(bv[4:6]), int(bv[6:8])
            age = int((datetime.now() - datetime(y, m, d)).days / 365.25)
        except Exception:
            pass

    return {
        "gender": gc_el.get("code") if gc_el is not None else None,
        "birth_date": bv,
        "age": age,
        "first_name": (given_el.text or "").strip() if given_el is not None else None,
        "last_name": (family_el.text or "").strip() if family_el is not None else None,
        "has_addr": addr_el is not None,
    }


def get_attr(el, attr: str, default=None):
    if el is None:
        return default
    return el.get(attr, default)


def get_text(el, default="") -> str:
    if el is None:
        return default
    return (el.text or "").strip()


def child_text(parent, local_tag: str, default="") -> str:
    if parent is None:
        return default
    for child in parent:
        if etree.QName(child.tag).localname == local_tag:
            return (child.text or "").strip()
    return default


def find_child(parent, local_tag: str):
    if parent is None:
        return None
    for child in parent:
        if etree.QName(child.tag).localname == local_tag:
            return child
    return None


def find_all(parent, local_tag: str):
    if parent is None:
        return []
    return [c for c in parent.iter() if etree.QName(c.tag).localname == local_tag]


def get_narrative_text(sec) -> str:
    """Extract human-readable text from a CCDA section's <text> element."""
    if sec is None:
        return ""
    text_el = None
    for child in sec:
        if etree.QName(child.tag).localname == "text":
            text_el = child
            break
    if text_el is None:
        return ""

    # Collect table rows if present
    rows = []
    trs = [c for c in text_el.iter() if etree.QName(c.tag).localname == "tr"]
    if trs:
        for tr in trs:
            cells = []
            for td in tr.iter():
                if etree.QName(td.tag).localname in ("td", "th"):
                    t = (td.text_content() if hasattr(td, "text_content") else "".join(td.itertext())).strip()
                    if t:
                        cells.append(t)
            if cells:
                rows.append("  |  ".join(cells))
        return "\n".join(rows)

    raw = "".join(text_el.itertext()).strip()
    return " ".join(raw.split())


def count_open_close_tags(xml_str: str):
    import re
    opens = len(re.findall(r"<[^/!?][^>]*>", xml_str))
    closes = len(re.findall(r"</[^>]+>", xml_str))
    return opens, closes
