import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from routers import ccda

app = FastAPI(
    title="CCDA Analyzer API",
    description="Standalone CCDA XML → Quality Scoring, HEDIS, FHIR R4, Databricks loader",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ccda.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "ccda-analyzer-api"}


# Serve pre-built React frontend (run `npm run build` in /frontend before deploying)
_static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "dist")
if os.path.isdir(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("DATABRICKS_APP_PORT", 8100))
    uvicorn.run(app, host="0.0.0.0", port=port)
