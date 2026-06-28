OID = {
    "PROBLEMS":    ["2.16.840.1.113883.10.20.22.2.5.1", "2.16.840.1.113883.10.20.22.2.5"],
    "MEDICATIONS": ["2.16.840.1.113883.10.20.22.2.1.1", "2.16.840.1.113883.10.20.22.2.1"],
    "MEDADMIN":    ["2.16.840.1.113883.10.20.22.2.38"],
    "ALLERGIES":   ["2.16.840.1.113883.10.20.22.2.6.1", "2.16.840.1.113883.10.20.22.2.6"],
    "RESULTS":     ["2.16.840.1.113883.10.20.22.2.3.1", "2.16.840.1.113883.10.20.22.2.3"],
    "PROCEDURES":  ["2.16.840.1.113883.10.20.22.2.7.1", "2.16.840.1.113883.10.20.22.2.7"],
    "ENCOUNTERS":  ["2.16.840.1.113883.10.20.22.2.22.1", "2.16.840.1.113883.10.20.22.2.22"],
    "VITALS":      ["2.16.840.1.113883.10.20.22.2.4.1", "2.16.840.1.113883.10.20.22.2.4"],
    "SOCIAL":      ["2.16.840.1.113883.10.20.22.2.17"],
    "IMMUNIZE":    ["2.16.840.1.113883.10.20.22.2.2.1", "2.16.840.1.113883.10.20.22.2.2"],
}

CS = {
    "SNOMED": "2.16.840.1.113883.6.96",
    "LOINC":  "2.16.840.1.113883.6.1",
    "RXNORM": "2.16.840.1.113883.6.88",
    "ICD10":  "2.16.840.1.113883.6.90",
    "ICD9":   "2.16.840.1.113883.6.103",
    "CPT":    "2.16.840.1.113883.6.12",
    "HCPCS":  "2.16.840.1.113883.6.285",
    "CVX":    "2.16.840.1.113883.12.292",
}

OID2SYS = {
    "2.16.840.1.113883.6.96":  "http://snomed.info/sct",
    "2.16.840.1.113883.6.1":   "http://loinc.org",
    "2.16.840.1.113883.6.88":  "http://www.nlm.nih.gov/research/umls/rxnorm",
    "2.16.840.1.113883.6.90":  "http://hl7.org/fhir/sid/icd-10-cm",
    "2.16.840.1.113883.6.103": "http://hl7.org/fhir/sid/icd-9-cm",
    "2.16.840.1.113883.6.12":  "http://www.ama-assn.org/go/cpt",
    "2.16.840.1.113883.12.292":"http://hl7.org/fhir/sid/cvx",
}

LOINC_NAMES = {
    "4548-4":"HbA1c","39156-5":"BMI","8480-6":"Systolic BP","8462-4":"Diastolic BP",
    "2089-1":"LDL-C","1920-8":"AST","1742-6":"ALT","33914-3":"eGFR","2951-2":"Sodium",
    "2823-3":"Potassium","2160-0":"Creatinine","718-7":"Hemoglobin","24606-6":"Mammography",
    "2335-8":"FOBT","77353-1":"FIT-DNA","55284-4":"BP Panel","44249-1":"PHQ-9",
    "44250-9":"PHQ-2","57905-2":"Colonoscopy report","14956-5":"Microalbumin",
}

# NCQA HEDIS 2024 static value sets
HEDIS_VS_STATIC = {
    "Mammography": {
        "oid": "2.16.840.1.113883.3.464.1003.108.12.1018", "measure": "BCS", "role": "numerator",
        "codes": {
            "CPT": ["77065","77066","77067"],
            "HCPCS": ["G0202","G0204","G0206"],
            "LOINC": ["24606-6","26349-8","26350-6","42415-0","69259-9","36319-2","36625-1","36626-9","38090-7","39152-4"],
            "SNOMED": ["24623002","71651007","241055006","241615005","439324009"],
        }
    },
    "Bilateral Mastectomy": {
        "oid": "2.16.840.1.113883.3.464.1003.198.12.1068", "measure": "BCS", "role": "exclusion",
        "codes": {"CPT": ["19180","19200","19220","19240"], "ICD10": ["Z85.3"], "SNOMED": ["52314009","428529004","726636007"]}
    },
    "Unilateral Mastectomy": {
        "oid": "2.16.840.1.113883.3.464.1003.198.12.1076", "measure": "BCS", "role": "exclusion",
        "codes": {"CPT": ["19180","19182","19200","19220","19240"], "ICD10": ["Z85.3","Z85.41","Z85.43"], "SNOMED": ["172043006","428571003","429400009"]}
    },
    "Absence of Left Breast":  {"oid": "2.16.840.1.113883.3.464.1003.198.12.1404", "measure": "BCS", "role": "exclusion", "codes": {"SNOMED": ["428529004"], "ICD10": ["Z85.41"]}},
    "Absence of Right Breast": {"oid": "2.16.840.1.113883.3.464.1003.198.12.1405", "measure": "BCS", "role": "exclusion", "codes": {"SNOMED": ["429400009"], "ICD10": ["Z85.43"]}},

    "Colonoscopy": {
        "oid": "2.16.840.1.113883.3.464.1003.108.12.1020", "measure": "COL", "role": "numerator",
        "codes": {
            "CPT": ["44388","44389","44391","44392","44394","44401","44402","44403","44404","44405",
                    "44406","44407","44408","44500","45355","45378","45379","45380","45381","45382",
                    "45383","45384","45385","45386","45387","45388","45389","45390","45391","45392","45393","45398"],
            "SNOMED": ["44441009","73761001","174158000","310634005"],
        }
    },
    "CT Colonography": {"oid": "2.16.840.1.113883.3.464.1003.108.12.1038", "measure": "COL", "role": "numerator", "codes": {"CPT": ["74263"], "LOINC": ["79101-2"]}},
    "Fecal Occult Blood Test (FOBT)": {
        "oid": "2.16.840.1.113883.3.464.1003.198.12.1011", "measure": "COL", "role": "numerator",
        "codes": {"CPT": ["82270","82274"],
                  "LOINC": ["2335-8","10334-2","12503-9","12504-7","14563-1","14564-9","14565-7",
                            "27396-1","27401-9","27925-7","27926-5","56490-6","56491-4","57905-2","58453-2","80372-6"]}
    },
    "FIT DNA": {"oid": "2.16.840.1.113883.3.464.1003.108.12.1039", "measure": "COL", "role": "numerator", "codes": {"CPT": ["81528"], "LOINC": ["77353-1","77354-9"]}},
    "Flexible Sigmoidoscopy": {
        "oid": "2.16.840.1.113883.3.464.1003.198.12.1010", "measure": "COL", "role": "numerator",
        "codes": {"CPT": ["45330","45331","45332","45333","45334","45335","45337","45338","45339",
                          "45340","45341","45342","45345","45346","45347","45349","45350"],
                  "SNOMED": ["396226005","425634007"]}
    },
    "Colorectal Cancer": {
        "oid": "2.16.840.1.113883.3.464.1003.108.12.1001", "measure": "COL", "role": "exclusion",
        "codes": {"ICD10": ["C18.0","C18.1","C18.2","C18.3","C18.4","C18.5","C18.6","C18.7","C18.8","C18.9",
                            "C19","C20","C21.0","C21.1","C21.2","C21.8"],
                  "SNOMED": ["363406005","363414004","109838007","363413005"]}
    },
    "Total Colectomy": {
        "oid": "2.16.840.1.113883.3.464.1003.198.12.1019", "measure": "COL", "role": "exclusion",
        "codes": {"CPT": ["44150","44151","44155","44156","44157","44158","44210","44211","44212"],
                  "SNOMED": ["26390003","43075005"]}
    },

    "Essential Hypertension": {
        "oid": "2.16.840.1.113883.3.464.1003.104.12.1011", "measure": "CBP", "role": "denominator",
        "codes": {"ICD10": ["I10","I11.0","I11.9","I12.0","I12.9","I13.0","I13.10","I13.11","I13.2"],
                  "SNOMED": ["38341003","59621000","73410007","57684003","1201005","86041002","78975002","132721000119104"]}
    },
    "Blood Pressure Readings": {
        "oid": "2.16.840.1.113883.3.464.1003.104.12.1012", "measure": "CBP", "role": "numerator",
        "codes": {"LOINC": ["55284-4","8480-6","8462-4","8459-0","3363-0","8453-3","8454-1"]}
    },

    "Diabetes": {
        "oid": "2.16.840.1.113883.3.464.1003.103.12.1001", "measure": "CDC", "role": "denominator",
        "codes": {
            "ICD10": ["E08","E08.0","E08.01","E08.10","E08.11","E08.21","E08.22","E08.29","E08.311","E08.319",
                      "E08.36","E08.40","E08.41","E08.42","E08.43","E08.44","E08.49","E08.51","E08.52","E08.59",
                      "E08.65","E08.69","E08.8","E08.9",
                      "E09","E09.0","E09.01","E09.10","E09.11","E09.21","E09.22","E09.9",
                      "E10","E10.10","E10.11","E10.21","E10.22","E10.29","E10.311","E10.319","E10.36",
                      "E10.40","E10.41","E10.42","E10.43","E10.44","E10.49","E10.51","E10.52","E10.59",
                      "E10.65","E10.69","E10.8","E10.9",
                      "E11","E11.0","E11.01","E11.10","E11.11","E11.21","E11.22","E11.29","E11.311","E11.319",
                      "E11.36","E11.40","E11.41","E11.42","E11.43","E11.44","E11.49","E11.51","E11.52","E11.59",
                      "E11.65","E11.69","E11.8","E11.9",
                      "E13","E13.0","E13.01","E13.10","E13.11","E13.9"],
            "SNOMED": ["44054006","73211009","46635009","8801005","237599002","190368000","199230006","609567009"],
        }
    },
    "HbA1c Tests": {"oid": "2.16.840.1.113883.3.464.1003.198.12.1013", "measure": "CDC-HBA", "role": "numerator", "codes": {"LOINC": ["4548-4","4549-2","17856-6","59261-8","62388-4","71875-9","83036-8"]}},
    "LDL-C Tests":  {"oid": "2.16.840.1.113883.3.464.1003.198.12.1014", "measure": "CDC-LDL", "role": "numerator", "codes": {"LOINC": ["2089-1","13457-7","18262-6","22748-8","39469-2","49132-4","55440-2"]}},
    "Retinal or Dilated Eye Exam": {
        "oid": "2.16.840.1.113883.3.526.3.1315", "measure": "CDC-EYE", "role": "numerator",
        "codes": {"CPT": ["92002","92004","92012","92014","92134","92228","92229","92230","92235","92240","92242","92250","92260"],
                  "HCPCS": ["S0620","S0621"], "LOINC": ["57030-8","32451-7"],
                  "SNOMED": ["36228007","252779009","410455008","314971001","274795007","308110009"]}
    },
    "Urine Protein Tests": {
        "oid": "2.16.840.1.113883.3.464.1003.109.12.1024", "measure": "CDC-NEP", "role": "numerator",
        "codes": {"CPT": ["81000","81001","81002","81003","81005","82042","82043","82044","84156"],
                  "LOINC": ["1754-1","13705-9","14956-5","14957-3","30000-4","32294-1","40486-3","40487-1",
                            "43605-5","53121-0","57369-1","63474-1","2887-8","21059-1","26801-1"]}
    },
    "ACE/ARB Medications": {
        "oid": "2.16.840.1.113883.3.526.3.1139", "measure": "CDC-NEP", "role": "numerator",
        "codes": {"RXNORM": ["18867","1998","3827","35296","38454","41493","54552","73494","83515","83818",
                             "214354","214349","29046","321064","349201","352274"]}
    },

    "BMI": {
        "oid": "2.16.840.1.113883.3.464.1003.121.12.1006", "measure": "ABA", "role": "numerator",
        "codes": {"LOINC": ["39156-5","59574-4"], "CPT": ["99421","99422","99423","3008F"],
                  "SNOMED": ["60621009","446543001","162763007"]}
    },
    "Follow-Up for BMI": {
        "oid": "2.16.840.1.113883.3.464.1003.121.12.1007", "measure": "ABA", "role": "numerator",
        "codes": {"CPT": ["97802","97803","97804","G0270","G0271","G0447","G0473"], "SNOMED": ["182922004","386291006"]}
    },

    "Depression Screening": {
        "oid": "2.16.840.1.113883.3.464.1003.105.12.1007", "measure": "DSF", "role": "numerator",
        "codes": {"LOINC": ["44249-1","44250-9","54635-8","73831-0","89209-1","55757-9","89204-2"],
                  "CPT": ["96127","G0444","G0510"]}
    },
    "Depression Diagnosis": {
        "oid": "2.16.840.1.113883.3.464.1003.105.12.1061", "measure": "DSF", "role": "denominator",
        "codes": {"ICD10": ["F01.51","F32.0","F32.1","F32.2","F32.3","F32.4","F32.5","F32.89","F32.9",
                            "F33.0","F33.1","F33.2","F33.3","F33.40","F33.41","F33.42","F33.8","F33.9"],
                  "SNOMED": ["35489007","191616007","191617003","36923009","73867007","320751009"]}
    },

    "Medication Reconciliation": {
        "oid": "2.16.840.1.113883.3.464.1003.101.12.1047", "measure": "MRP", "role": "numerator",
        "codes": {"LOINC": ["18776-5","56445-0","60591-5"], "CPT": ["1111F"], "SNOMED": ["430193006","432102000"]}
    },
    "Inpatient Stay": {
        "oid": "2.16.840.1.113883.3.464.1003.101.12.1055", "measure": "MRP", "role": "denominator",
        "codes": {"SNOMED": ["182992009","405614004"]}
    },
}

SYS_TO_OID = {
    "CPT":    CS["CPT"],
    "LOINC":  CS["LOINC"],
    "SNOMED": CS["SNOMED"],
    "ICD10":  CS["ICD10"],
    "RXNORM": CS["RXNORM"],
    "HCPCS":  CS["HCPCS"],
}

HEDIS_MEASURES = [
    {"id": "BCS",     "name": "Breast Cancer Screening",              "cat": "Preventive",
     "description": "Women 52–74 who had a mammogram in the measurement year or year prior.",
     "denom_logic": {"gender": "F", "age_min": 52, "age_max": 74},
     "numer_vs": ["Mammography"],
     "exclusion_vs": ["Bilateral Mastectomy","Unilateral Mastectomy","Absence of Left Breast","Absence of Right Breast"]},
    {"id": "COL",     "name": "Colorectal Cancer Screening",          "cat": "Preventive",
     "description": "Adults 46–75 with appropriate colorectal cancer screening.",
     "denom_logic": {"any_adult": True, "age_min": 46, "age_max": 75},
     "numer_vs": ["Colonoscopy","CT Colonography","Fecal Occult Blood Test (FOBT)","FIT DNA","Flexible Sigmoidoscopy"],
     "exclusion_vs": ["Colorectal Cancer","Total Colectomy"]},
    {"id": "CBP",     "name": "Controlling High Blood Pressure",      "cat": "Chronic",
     "description": "Members 18–85 with hypertension whose blood pressure was adequately controlled.",
     "denom_logic": {"age_min": 18, "age_max": 85},
     "denom_vs": ["Essential Hypertension"],
     "numer_vs": ["Blood Pressure Readings"]},
    {"id": "CDC-HBA", "name": "Diabetes: HbA1c Testing",              "cat": "Diabetes",
     "description": "Members 18–75 with diabetes who had an HbA1c test.",
     "denom_logic": {"age_min": 18, "age_max": 75},
     "denom_vs": ["Diabetes"],
     "numer_vs": ["HbA1c Tests"]},
    {"id": "CDC-LDL", "name": "Diabetes: LDL-C Control",              "cat": "Diabetes",
     "description": "Members 18–75 with diabetes who had an LDL-C test.",
     "denom_logic": {"age_min": 18, "age_max": 75},
     "denom_vs": ["Diabetes"],
     "numer_vs": ["LDL-C Tests"]},
    {"id": "CDC-EYE", "name": "Diabetes: Eye Exam",                   "cat": "Diabetes",
     "description": "Members 18–75 with diabetes who had a retinal or dilated eye exam.",
     "denom_logic": {"age_min": 18, "age_max": 75},
     "denom_vs": ["Diabetes"],
     "numer_vs": ["Retinal or Dilated Eye Exam"]},
    {"id": "CDC-NEP", "name": "Diabetes: Nephropathy",                "cat": "Diabetes",
     "description": "Members 18–75 with diabetes with nephropathy screening or evidence of nephropathy.",
     "denom_logic": {"age_min": 18, "age_max": 75},
     "denom_vs": ["Diabetes"],
     "numer_vs": ["Urine Protein Tests","ACE/ARB Medications"]},
    {"id": "ABA",     "name": "Adult BMI Assessment",                 "cat": "Preventive",
     "description": "Members 18–74 who had a BMI documented during the measurement year.",
     "denom_logic": {"any_adult": True, "age_min": 18, "age_max": 74},
     "numer_vs": ["BMI","Follow-Up for BMI"]},
    {"id": "DSF",     "name": "Depression Screening and Follow-Up",   "cat": "Behavioral",
     "description": "Members 12+ screened for depression using a standardized tool.",
     "denom_logic": {"any_adult": True, "age_min": 12},
     "numer_vs": ["Depression Screening"]},
    {"id": "MRP",     "name": "Medication Reconciliation Post-Discharge", "cat": "Transitions",
     "description": "Members discharged from inpatient with medication reconciliation within 30 days.",
     "denom_logic": {"any_adult": True},
     "denom_vs": ["Inpatient Stay"],
     "numer_vs": ["Medication Reconciliation"]},
]

SQL_TABLES = [
    {"name": "fhir_bundles",             "fhir": "Bundle",             "cols": "bundle_id, source_file, resource_count, loaded_at"},
    {"name": "fhir_patients",            "fhir": "Patient",            "cols": "bundle_id, source_file, patient_id, active, mrn, mrn_system, family_name, given_name, prefix, suffix, gender, birth_date, deceased, address_line, city, state, postal_code, country, phone, email, marital_status, race_code, race_display, ethnicity_code, ethnicity_display, language_code, language_preferred"},
    {"name": "fhir_conditions",          "fhir": "Condition",          "cols": "bundle_id, source_file, condition_id, clinical_status, verification_status, category, severity_code, severity_display, code, code_system, display, body_site_code, body_site_display, patient_ref, onset_date, abatement_date, recorded_date, recorder_display, note"},
    {"name": "fhir_medication_requests",       "fhir": "MedicationRequest",       "cols": "bundle_id, source_file, medication_id, status, intent, medication_code, code_system, display, patient_ref, authored_on, validity_period_start, validity_period_end, route_code, route_display, dose_value, dose_unit, rate_value, rate_unit, refills, reason_code, reason_system, reason_display, requester_display, requester_npi, note"},
    {"name": "fhir_medication_administrations", "fhir": "MedicationAdministration", "cols": "bundle_id, source_file, administration_id, status, status_reason_code, status_reason_display, medication_code, code_system, display, patient_ref, effective_date, effective_start, effective_end, route_code, route_display, site_code, site_display, dose_value, dose_unit, rate_value, rate_unit, performer_display, performer_npi, reason_code, reason_system, reason_display, note"},
    {"name": "fhir_allergy_intolerances","fhir": "AllergyIntolerance", "cols": "bundle_id, source_file, allergy_id, patient_ref, code, code_system, display, criticality, clinical_status"},
    {"name": "fhir_observations",        "fhir": "Observation",        "cols": "bundle_id, source_file, observation_id, status, category, category_display, code, code_system, display, patient_ref, effective_date, effective_start, effective_end, value_quantity, value_unit, value_code, value_code_display, value_string, value_range_low, value_range_high, interpretation_code, interpretation_display, ref_range_low, ref_range_high, ref_range_text, body_site_code, body_site_display, method_code, method_display, performer_display, performer_npi, note"},
    {"name": "fhir_encounters",          "fhir": "Encounter",          "cols": "bundle_id, source_file, encounter_id, status, class_code, class_display, type_code, type_system, type_display, priority_code, priority_display, patient_ref, period_start, period_end, reason_code, reason_system, reason_display, diagnosis_code, diagnosis_system, diagnosis_display, participant_display, participant_npi, location_display"},
    {"name": "fhir_procedures",          "fhir": "Procedure",          "cols": "bundle_id, source_file, procedure_id, status, code, code_system, display, patient_ref, performed_date, performed_start, performed_end, body_site_code, body_site_display, method_code, method_display, performer_display, performer_npi, reason_code, reason_system, reason_display, outcome_code, outcome_display, note"},
    {"name": "fhir_immunizations",       "fhir": "Immunization",       "cols": "bundle_id, source_file, immunization_id, status, status_reason_code, status_reason_display, vaccine_code, code_system, display, lot_number, manufacturer, route_code, route_display, site_code, site_display, dose_value, dose_unit, patient_ref, occurrence_date, primary_source, performer_display, performer_npi"},
    {"name": "fhir_diagnostic_reports",  "fhir": "DiagnosticReport",   "cols": "bundle_id, source_file, report_id, identifier, identifier_system, status, category_code, category_display, code, code_system, display, patient_ref, effective_date, effective_start, effective_end, issued, encounter_ref, performer_display, performer_npi, result_count, conclusion, conclusion_code, conclusion_display"},
    {"name": "fhir_practitioners",       "fhir": "Practitioner",       "cols": "bundle_id, source_file, practitioner_id, active, npi, identifier_system, family_name, given_name, prefix, suffix, phone, fax, email, address_line, city, state, postal_code, country, qual_code, qual_system, qual_display"},
    {"name": "fhir_organizations",       "fhir": "Organization",       "cols": "bundle_id, source_file, organization_id, active, npi, identifier_system, org_identifier, name, org_type, phone, fax, email, address_line, city, state, postal_code, country"},
    {"name": "fhir_practitioner_roles",  "fhir": "PractitionerRole",   "cols": "bundle_id, source_file, role_id, active, practitioner_ref, organization_ref, role_code, role_display, role_system, specialty_code, specialty_display, period_start, period_end"},
]
