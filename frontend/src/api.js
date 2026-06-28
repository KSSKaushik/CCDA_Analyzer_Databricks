const BASE = "";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  if (res.status === 204) return null;
  return res.json();
}

async function requestRaw(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res;
}

function buildFormData(files) {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  return fd;
}

export const ccdaApi = {
  analyze:       (files) => request("/api/ccda/analyze",           { method: "POST", body: buildFormData(files) }),
  convertFhir:   (files) => request("/api/ccda/fhir/convert",      { method: "POST", body: buildFormData(files) }),
  exportZip:     (files) => requestRaw("/api/ccda/fhir/export-zip",{ method: "POST", body: buildFormData(files) }),
  getDdl:        ()      => request("/api/ccda/sql/ddl"),
  createTables:  ()      => request("/api/ccda/sql/create-tables", { method: "POST" }),
  loadBundles:   (files) => request("/api/ccda/sql/load",          { method: "POST", body: buildFormData(files) }),
  sqlStatus:     ()      => request("/api/ccda/sql/status"),
  truncateAll:   ()      => request("/api/ccda/sql/truncate",      { method: "POST" }),
  getValueSets:  ()      => request("/api/ccda/meta/value-sets"),
  getLoincNames: ()      => request("/api/ccda/meta/loinc-names"),
  loadSamples:   ()      => request("/api/ccda/samples"),
};
