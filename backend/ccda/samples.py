"""
Synthetic CCDA generator — Python port of V15_29Apr.html makeCCDA() JS function.
5 sample patients: Jane Smith (diabetes), Robert Johnson (preventive),
Maria Garcia (incomplete), David Chen (comprehensive), Susan Williams (breast screening).
"""

from .constants import CS

_LOINC = CS["LOINC"]


def make_ccda(id_, fn, ln, g, dob,
              probs=None, meds=None, allergies=None,
              results=None, encs=None, vitals=None, social=None, procs=None):
    probs     = probs     or []
    meds      = meds      or []
    allergies = allergies or []
    results   = results   or []
    encs      = encs      or []
    vitals    = vitals    or []
    social    = social    or []
    procs     = procs     or []

    def sec(tid, code, disp, body, narrative_text=None):
        if not body:
            return ""
        narr = (narrative_text or disp).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return (
            f'<component><section>'
            f'<templateId root="{tid}"/>'
            f'<code code="{code}" codeSystem="{_LOINC}" displayName="{disp}"/>'
            f'<title>{disp}</title><text>{narr}</text>'
            f'{body}'
            f'</section></component>'
        )

    pE = "".join(
        f'<entry><observation classCode="OBS" moodCode="EVN">'
        f'<templateId root="2.16.840.1.113883.10.20.22.4.4"/>'
        f'<code code="{p["c"]}" codeSystem="{p["cs"]}" displayName="{p["d"]}"/>'
        f'<effectiveTime><low value="20230101"/></effectiveTime>'
        f'</observation></entry>'
        for p in probs
    )
    mE = "".join(
        f'<entry><substanceAdministration classCode="SBADM" moodCode="EVN">'
        f'<templateId root="2.16.840.1.113883.10.20.22.4.16"/>'
        f'<consumable><manufacturedProduct><manufacturedMaterial>'
        f'<code code="{m["c"]}" codeSystem="{m["cs"]}" displayName="{m["d"]}"/>'
        f'</manufacturedMaterial></manufacturedProduct></consumable>'
        f'</substanceAdministration></entry>'
        for m in meds
    )
    aE = "".join(
        f'<entry><act classCode="ACT" moodCode="EVN">'
        f'<templateId root="2.16.840.1.113883.10.20.22.4.30"/>'
        f'<entryRelationship><observation><participant><participantRole><playingEntity>'
        f'<code code="{a["c"]}" codeSystem="{a["cs"]}" displayName="{a["d"]}"/>'
        f'</playingEntity></participantRole></participant></observation></entryRelationship>'
        f'</act></entry>'
        for a in allergies
    )
    _ENC_OID = "2.16.840.1.113883.19.6"
    enc_ref_xml = (
        f'<entryRelationship typeCode="COMP"><encounter classCode="ENC" moodCode="EVN">'
        f'<id root="{_ENC_OID}" extension="0"/>'
        f'</encounter></entryRelationship>'
    ) if encs else ""
    rE = "".join(
        f'<entry><organizer classCode="BATTERY" moodCode="EVN">'
        f'<templateId root="2.16.840.1.113883.10.20.22.4.1"/>'
        f'<code code="{r["l"]}" codeSystem="{_LOINC}" displayName="{r["d"]}"/>'
        f'<statusCode code="completed"/>'
        f'<effectiveTime value="{encs[0]["dt"] if encs else "20240401"}"/>'
        f'{enc_ref_xml}'
        f'<component><observation classCode="OBS" moodCode="EVN">'
        f'<templateId root="2.16.840.1.113883.10.20.22.4.2"/>'
        f'<code code="{r["l"]}" codeSystem="{_LOINC}" displayName="{r["d"]}"/>'
        f'<value xsi:type="PQ" value="{r["v"]}" unit="{r["u"]}"/>'
        f'</observation></component></organizer></entry>'
        for r in results
    )
    vE = "".join(
        f'<entry><organizer classCode="CLUSTER" moodCode="EVN">'
        f'<templateId root="2.16.840.1.113883.10.20.22.4.26"/>'
        f'<code code="{v["l"]}" codeSystem="{_LOINC}" displayName="{v["d"]}"/>'
        f'<statusCode code="completed"/>'
        f'<component><observation classCode="OBS" moodCode="EVN">'
        f'<value xsi:type="PQ" value="{v["v"]}" unit="{v["u"]}"/>'
        f'</observation></component></organizer></entry>'
        for v in vitals
    )
    eE = "".join(
        f'<entry><encounter classCode="ENC" moodCode="EVN">'
        f'<templateId root="2.16.840.1.113883.10.20.22.4.49"/>'
        f'<id root="{_ENC_OID}" extension="{i}"/>'
        f'<effectiveTime value="{e["dt"]}"/>'
        f'<entryRelationship typeCode="RSON"><observation>'
        f'<code code="{e["ic"]}" codeSystem="{CS["ICD10"]}" displayName="{e["d"]}"/>'
        f'</observation></entryRelationship></encounter></entry>'
        for i, e in enumerate(encs)
    )
    sE = "".join(
        f'<entry><observation classCode="OBS" moodCode="EVN">'
        f'<templateId root="2.16.840.1.113883.10.20.22.4.38"/>'
        f'<code code="229819007" codeSystem="{CS["SNOMED"]}" displayName="Tobacco use"/>'
        f'<value code="{s["c"]}" codeSystem="{s["cs"]}" displayName="{s["d"]}"/>'
        f'</observation></entry>'
        for s in social
    )
    prE = "".join(
        f'<entry><procedure classCode="PROC" moodCode="EVN">'
        f'<templateId root="2.16.840.1.113883.10.20.22.4.14"/>'
        f'<code code="{p["c"]}" codeSystem="{p["cs"]}" displayName="{p["d"]}"/>'
        f'<statusCode code="completed"/><effectiveTime value="20240101"/>'
        f'</procedure></entry>'
        for p in procs
    )

    prob_narr = (
        "Active problems as of visit:\n" +
        "\n".join(f"- {p['d']}" for p in probs) +
        f"\nPatient reports conditions are {'moderately' if len(probs) > 2 else 'well'} controlled on current regimen. No new diagnoses this visit."
    ) if probs else "No active problems documented."

    med_narr = (
        "Current medications reviewed with patient:\n" +
        "\n".join(f"- {m['d']}" for m in meds) +
        "\nMedication adherence reported as good. No new allergic reactions noted. Refills provided as appropriate."
    ) if meds else "No active medications on file."

    aller_narr = (
        "Known allergies:\n" +
        "\n".join(f"- {a['d']}: patient reports reaction history" for a in allergies) +
        "\nNo new allergies reported at this visit."
    ) if allergies else "No known drug allergies (NKDA)."

    res_narr = (
        "Laboratory and diagnostic results reviewed:\n" +
        "\n".join(f"- {r['d']}: {r['v']} {r['u']}" for r in results) +
        "\nResults discussed with patient. Follow-up ordered as clinically indicated."
    ) if results else "No results available for this encounter."

    vital_narr = (
        "Vital signs recorded this visit:\n" +
        "\n".join(f"- {v['d']}: {v['v']} {v['u']}" for v in vitals) +
        "\nPatient appears in no acute distress. Weight and height recorded; BMI calculated."
    ) if vitals else "Vital signs not documented."

    social_narr = (
        "Social history review:\n" +
        "\n".join(f"- {s['d']}" for s in social) +
        "\nPatient denies illicit drug use. Alcohol use: social, occasional. Exercise: moderate physical activity 2-3 times/week. Diet: low sodium diet reported. Employment: currently employed full-time. Marital status: married."
    ) if social else "Social history not documented."

    probs_sec = sec("2.16.840.1.113883.10.20.22.2.5.1", "11450-4", "Problem List",   pE, prob_narr)
    meds_sec  = sec("2.16.840.1.113883.10.20.22.2.1.1", "10160-0", "Medications",    mE, med_narr)
    all_sec   = sec("2.16.840.1.113883.10.20.22.2.6.1", "48765-2", "Allergies",      aE, aller_narr)
    res_sec   = sec("2.16.840.1.113883.10.20.22.2.3.1", "30954-2", "Results",        rE, res_narr)
    vit_sec   = sec("2.16.840.1.113883.10.20.22.2.4.1", "8716-3",  "Vital Signs",    vE, vital_narr)
    enc_sec   = sec("2.16.840.1.113883.10.20.22.2.22.1","46240-8", "Encounters",     eE)
    soc_sec   = sec("2.16.840.1.113883.10.20.22.2.17",  "29762-2", "Social History", sE, social_narr)
    proc_sec  = sec("2.16.840.1.113883.10.20.22.2.7.1", "47519-4", "Procedures",     prE) if prE else ""

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <realmCode code="US"/>
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.1"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.2"/>
  <id root="2.16.840.1.113883.19.5" extension="{id_}"/>
  <code code="34133-9" codeSystem="{_LOINC}" displayName="Summarization of Episode Note"/>
  <title>Continuity of Care Document</title>
  <effectiveTime value="20240401120000"/>
  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>
  <languageCode code="en-US"/>
  <recordTarget><patientRole>
    <id root="2.16.840.1.113883.19" extension="{id_}"/>
    <addr use="HP"><streetAddressLine>123 Main St</streetAddressLine><city>Springfield</city><state>IL</state><postalCode>62701</postalCode></addr>
    <patient>
      <name><given>{fn}</given><family>{ln}</family></name>
      <administrativeGenderCode code="{g}"/>
      <birthTime value="{dob}"/>
    </patient>
  </patientRole></recordTarget>
  <author><time value="20240401"/><assignedAuthor><id root="2.16.840.1.113883.4.6" extension="NPI-12345"/>
    <assignedPerson><name><given>Treating</given><family>Provider</family></name></assignedPerson>
  </assignedAuthor></author>
  <custodian><assignedCustodian><representedCustodianOrganization>
    <id root="2.16.840.1.113883.19.5"/><name>Sample Health System</name>
  </representedCustodianOrganization></assignedCustodian></custodian>
  <component><structuredBody>
    {probs_sec}
    {meds_sec}
    {all_sec}
    {res_sec}
    {vit_sec}
    {enc_sec}
    {soc_sec}
    {proc_sec}
  </structuredBody></component>
</ClinicalDocument>"""


SAMPLE_PATIENTS = [
    {
        "name": "jane_smith_diabetes.xml",
        "params": dict(
            id_="001", fn="Jane", ln="Smith", g="F", dob="19680315",
            probs=[
                {"c": "44054006",  "cs": CS["SNOMED"], "d": "Type 2 diabetes"},
                {"c": "38341003",  "cs": CS["SNOMED"], "d": "Hypertension"},
            ],
            meds=[
                {"c": "860975", "cs": CS["RXNORM"], "d": "Metformin 500mg"},
                {"c": "197319", "cs": CS["RXNORM"], "d": "Lisinopril 10mg"},
            ],
            allergies=[{"c": "7980", "cs": CS["RXNORM"], "d": "Penicillin"}],
            results=[
                {"l": "4548-4",  "d": "HbA1c",        "v": "7.2",  "u": "%"},
                {"l": "2089-1",  "d": "LDL-C",         "v": "98",   "u": "mg/dL"},
                {"l": "39156-5", "d": "BMI",            "v": "28.4", "u": "kg/m2"},
                {"l": "8480-6",  "d": "Systolic BP",    "v": "138",  "u": "mmHg"},
                {"l": "8462-4",  "d": "Diastolic BP",   "v": "88",   "u": "mmHg"},
                {"l": "14956-5", "d": "Microalbumin",   "v": "32",   "u": "mg/L"},
            ],
            encs=[{"dt": "20240315", "ic": "E11.9", "d": "Type 2 diabetes"}],
            vitals=[{"l": "39156-5", "d": "BMI", "v": "28.4", "u": "kg/m2"}],
            social=[{"c": "160573003", "cs": CS["SNOMED"], "d": "Never smoker"}],
        ),
    },
    {
        "name": "robert_johnson_preventive.xml",
        "params": dict(
            id_="002", fn="Robert", ln="Johnson", g="M", dob="19550822",
            probs=[
                {"c": "73211009", "cs": CS["SNOMED"], "d": "Diabetes mellitus"},
                {"c": "59621000", "cs": CS["SNOMED"], "d": "Essential hypertension"},
            ],
            meds=[
                {"c": "310798", "cs": CS["RXNORM"], "d": "Atorvastatin 40mg"},
                {"c": "41493",  "cs": CS["RXNORM"], "d": "Aspirin 81mg"},
            ],
            allergies=[{"c": "1049640", "cs": CS["RXNORM"], "d": "Sulfa drugs"}],
            results=[
                {"l": "2335-8",  "d": "FOBT",        "v": "Negative", "u": ""},
                {"l": "18262-6", "d": "LDL Direct",  "v": "112",      "u": "mg/dL"},
                {"l": "2160-0",  "d": "Creatinine",  "v": "1.1",      "u": "mg/dL"},
                {"l": "44249-1", "d": "PHQ-9",        "v": "4",        "u": "score"},
            ],
            encs=[{"dt": "20240210", "ic": "Z00.00", "d": "Preventive care"}],
            vitals=[{"l": "8480-6", "d": "Systolic BP", "v": "145", "u": "mmHg"}],
            social=[{"c": "160603005", "cs": CS["SNOMED"], "d": "Ex-smoker"}],
        ),
    },
    {
        "name": "maria_garcia_incomplete.xml",
        "params": dict(
            id_="003", fn="Maria", ln="Garcia", g="F", dob="19780601",
            probs=[{"c": "I10", "cs": CS["ICD10"], "d": "Hypertension"}],
            meds=[], allergies=[], results=[], encs=[], vitals=[], social=[],
        ),
    },
    {
        "name": "david_chen_comprehensive.xml",
        "params": dict(
            id_="004", fn="David", ln="Chen", g="M", dob="19620410",
            probs=[
                {"c": "44054006",  "cs": CS["SNOMED"], "d": "Type 2 diabetes"},
                {"c": "414545008", "cs": CS["SNOMED"], "d": "Peripheral arterial disease"},
            ],
            meds=[
                {"c": "860975", "cs": CS["RXNORM"], "d": "Metformin"},
                {"c": "197361", "cs": CS["RXNORM"], "d": "Amlodipine"},
                {"c": "310798", "cs": CS["RXNORM"], "d": "Atorvastatin"},
            ],
            allergies=[{"c": "7982", "cs": CS["RXNORM"], "d": "Codeine"}],
            results=[
                {"l": "4548-4",  "d": "HbA1c",    "v": "8.1",  "u": "%"},
                {"l": "1754-1",  "d": "Microalbumin","v":"42",  "u": "mg/L"},
                {"l": "33914-3", "d": "eGFR",      "v": "58",   "u": "mL/min/1.73m2"},
                {"l": "2089-1",  "d": "LDL",        "v": "88",   "u": "mg/dL"},
                {"l": "39156-5", "d": "BMI",         "v": "31.2", "u": "kg/m2"},
                {"l": "57030-8", "d": "Eye exam",    "v": "Normal","u": ""},
            ],
            encs=[
                {"dt": "20240320", "ic": "E11.65", "d": "T2DM w/ hyperglycemia"},
                {"dt": "20231015", "ic": "I73.9",  "d": "PVD"},
            ],
            vitals=[
                {"l": "55284-4", "d": "Blood Pressure", "v": "142", "u": "mmHg"},
                {"l": "39156-5", "d": "BMI",             "v": "31.2","u": "kg/m2"},
            ],
            social=[{"c": "160603005", "cs": CS["SNOMED"], "d": "Ex-smoker"}],
            procs=[{"c": "93922", "cs": CS["CPT"], "d": "ABI test"}],
        ),
    },
    {
        "name": "susan_williams_breast_screening.xml",
        "params": dict(
            id_="005", fn="Susan", ln="Williams", g="F", dob="19520917",
            probs=[
                {"c": "416940007", "cs": CS["SNOMED"], "d": "Breast cancer screening"},
                {"c": "38341003",  "cs": CS["SNOMED"], "d": "Hypertension"},
            ],
            meds=[{"c": "723", "cs": CS["RXNORM"], "d": "Tamoxifen 20mg"}],
            allergies=[{"c": "7980", "cs": CS["RXNORM"], "d": "Penicillin"}],
            results=[
                {"l": "24606-6", "d": "Mammography", "v": "BI-RADS 2", "u": ""},
                {"l": "44250-9", "d": "PHQ-2",        "v": "1",         "u": "score"},
                {"l": "39156-5", "d": "BMI",           "v": "27.1",     "u": "kg/m2"},
                {"l": "77353-1", "d": "FIT-DNA",       "v": "Negative", "u": ""},
            ],
            encs=[{"dt": "20240101", "ic": "Z12.31", "d": "Screening mammography"}],
            vitals=[{"l": "8480-6", "d": "Systolic BP", "v": "128", "u": "mmHg"}],
            social=[{"c": "160573003", "cs": CS["SNOMED"], "d": "Never smoker"}],
        ),
    },
]
