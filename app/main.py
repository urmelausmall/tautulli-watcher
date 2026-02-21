import os
from typing import Optional

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from datetime import datetime

from . import tautulli_client

app = FastAPI(title="Tautulli Sharing Watcher")

# Static & Templates
# Wir laufen mit WORKDIR /app, also existiert /app/app/static usw.
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

DEFAULT_IP_LIMIT = int(os.getenv("DEFAULT_IP_LIMIT", "50"))


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """
    Startseite mit der Web-UI.
    """
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "app_name": "Tautulli Sharing Watcher",
        },
    )


# === API Endpoints ===

@app.get("/api/users")
async def api_users():
    """
    Liste aller Tautulli-User.
    """
    try:
        users = tautulli_client.get_users()
    except Exception as e:
        # Klarere Fehlermeldung, die im Frontend angezeigt werden kann
        raise HTTPException(status_code=500, detail=f"Tautulli get_users fehlgeschlagen: {e}")

    mapped = [
        {
            "user_id": u.get("user_id"),
            "username": u.get("username"),
            "friendly_name": u.get("friendly_name") or u.get("username"),
            "email": u.get("email"),
            "is_active": u.get("is_active"),
            "is_admin": u.get("is_admin"),
        }
        for u in users
    ]
    return {"users": mapped}


@app.get("/api/users/{user_id}/ips")
async def api_user_ips(user_id: int, limit: Optional[int] = None):
    """
    IP-Liste für einen User inkl. GeoIP-Infos.
    """
    if limit is None:
        limit = DEFAULT_IP_LIMIT

    try:
        raw_ips = tautulli_client.get_user_ips(user_id=user_id, length=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tautulli get_user_ips fehlgeschlagen: {e}")

    entries = []
    for row in raw_ips:
        ip = row.get("ip_address")
        geo = tautulli_client.geoip_lookup(ip) if ip else {}

        # rohe Timestamps holen (für Sortierung im Frontend)
        def safe_int(v):
            try:
                return int(v)
            except Exception:
                return None

        first_raw = safe_int(row.get("first_seen"))
        last_raw = safe_int(row.get("last_seen"))
        played_raw = safe_int(row.get("last_played"))

        entries.append(
            {
                "ip_address": ip,
                # hübsch formatierte Zeiten
                "first_seen": fmt_ts(first_raw),
                "last_seen": fmt_ts(last_raw),
                "last_played": fmt_ts(played_raw),
                # rohe Timestamps für Sortierung
                "first_seen_ts": first_raw,
                "last_seen_ts": last_raw,
                "last_played_ts": played_raw,
                # Standortinfos
                "country": geo.get("country"),
                "country_code": geo.get("country_code"),
                "region": geo.get("region"),
                "city": geo.get("city"),
                "latitude": geo.get("latitude"),
                "longitude": geo.get("longitude"),
                "timezone": geo.get("timezone"),
                "is_home": geo.get("country") == "HOME",
                "isp": geo.get("isp"),  # <- neu wieder drin
            }
        )
    return {"ips": entries}

def fmt_ts(value):
    """
    Wandelt Unix-Timestamps (Sekunden) in 'YYYY-MM-DD HH:MM:SS' um.
    Wenn es keine Zahl ist, wird der Originalwert zurückgegeben.
    """
    if not value:
        return None
    try:
        ts = int(value)
        return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return str(value)