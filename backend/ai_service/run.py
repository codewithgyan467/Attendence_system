import os
import uvicorn

if __name__ == "__main__":
    host = os.environ.get("AI_SERVICE_HOST", "127.0.0.1")
    port = int(os.environ.get("AI_SERVICE_PORT", "8000"))
    uvicorn.run("app.main:app", host=host, port=port, reload=False)
