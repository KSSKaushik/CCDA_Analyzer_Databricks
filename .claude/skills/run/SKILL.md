---
description: Launch the standalone CCDA Analyzer app — FastAPI backend on port 8100 and Vite frontend on port 5174 (or next free port).
---

# Run CCDA Analyzer

Launches both services for the standalone CCDA Analyzer app located at
`E:\POC\GitHub Repo\CCDA Analyzer_15June2026`.

## Environment facts (verified 2026-06-15)

| Item | Value |
|---|---|
| Python with uvicorn | `C:\Users\karti\AppData\Local\Python\bin\python3.11.exe` |
| npm | `C:\Program Files\nodejs\npm.cmd` |
| Backend port | 8100 |
| Frontend port | 5174 (Vite auto-increments if taken) |
| App root | `E:\POC\GitHub Repo\CCDA Analyzer_15June2026` |

> **Why python3.11?** The system default `python` resolves to 3.14, which
> does not have uvicorn installed. Always use the full path above.

## Step 1 — Check what is already running

```powershell
netstat -ano | findstr ":8100 " | findstr LISTENING
netstat -ano | findstr ":5174 " | findstr LISTENING
```

- If port 8100 is already listening → backend is up, skip step 2.
- If port 5174 (or 5175/5176) is already listening → frontend is up, skip step 3.

## Step 2 — Start the backend

Open a **persistent** PowerShell window (the `-NoExit` flag is required; without
it the process dies when the tool call ends):

```powershell
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", `
  "cd 'E:\POC\GitHub Repo\CCDA Analyzer_15June2026\backend'; " + `
  "C:\Users\karti\AppData\Local\Python\bin\python3.11.exe -m uvicorn main:app --reload --port 8100"
```

Wait ~5 seconds, then smoke-test:

```powershell
Invoke-RestMethod http://localhost:8100/health
```

Expected: `{ status = ok; service = ccda-analyzer-api }`

If the request fails, check for missing packages:

```powershell
C:\Users\karti\AppData\Local\Python\bin\python3.11.exe -m pip install -r `
  "E:\POC\GitHub Repo\CCDA Analyzer_15June2026\backend\requirements.txt"
```

Then retry launching the backend.

## Step 3 — Start the frontend

```powershell
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", `
  "cd 'E:\POC\GitHub Repo\CCDA Analyzer_15June2026\frontend'; " + `
  "& 'C:\Program Files\nodejs\npm.cmd' run dev"
```

Wait ~8 seconds, then confirm Vite is listening:

```powershell
netstat -ano | findstr ":517" | findstr LISTENING
```

Vite prints the actual port in its window (5174 if free, else 5175/5176/…).

### First time only — install node_modules

If `frontend\node_modules` does not exist, run this before starting Vite:

```powershell
& "C:\Program Files\nodejs\npm.cmd" install --prefix "E:\POC\GitHub Repo\CCDA Analyzer_15June2026\frontend"
```

## Step 4 — Report to the user

Tell the user:
- Backend URL: `http://localhost:8100`
- Frontend URL: `http://localhost:5174` (or the port Vite chose)
- API docs: `http://localhost:8100/docs`

## Troubleshooting

| Symptom | Fix |
|---|---|
| `uvicorn: command not found` or `No module named uvicorn` | Use full python3.11 path; run `pip install` from requirements.txt |
| Port 8100 already in use | `netstat -ano \| findstr :8100` → `Stop-Process -Id <PID> -Force` |
| `vite: command not found` | Run `npm install` in the frontend directory first |
| Frontend can't reach backend (CORS / network error) | Confirm backend health endpoint responds; CORS is set to `*` so any origin is allowed |
| SQL Server connection errors on startup | Copy `.env.example` to `.env` and fill in DB credentials; app works without DB for analyze/FHIR endpoints |
