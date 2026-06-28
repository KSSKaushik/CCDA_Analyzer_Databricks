import os
from dotenv import load_dotenv

load_dotenv()

try:
    import databricks.sql as _dbsql
    _DATABRICKS_AVAILABLE = True
except ImportError:
    _DATABRICKS_AVAILABLE = False


def get_connection():
    if not _DATABRICKS_AVAILABLE:
        raise RuntimeError(
            "databricks-sql-connector is not installed. "
            "Run: pip install databricks-sql-connector"
        )
    return _dbsql.connect(
        server_hostname=os.environ["DATABRICKS_HOST"],
        http_path=os.environ["DATABRICKS_HTTP_PATH"],
        access_token=os.environ["DATABRICKS_TOKEN"],
        catalog=os.environ.get("DATABRICKS_CATALOG", "main"),
        schema=os.environ.get("DATABRICKS_SCHEMA", "fhir_ccda"),
    )
