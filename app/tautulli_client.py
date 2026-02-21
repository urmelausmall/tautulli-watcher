import os
import httpx
from functools import lru_cache


TAUTULLI_URL = os.getenv("TAUTULLI_URL", "").rstrip("/")
TAUTULLI_API_KEY = os.getenv("TAUTULLI_API_KEY", "")
TAUTULLI_VERIFY_SSL = os.getenv("TAUTULLI_VERIFY_SSL", "true").lower() == "true"

# Home-IP-Ranges: einfache Prefix-Matches, z.B.
# "192.168.178.*" oder mehrere: "192.168.178.*,10.0.0.,172.16."
HOME_IP_RANGES = os.getenv("HOME_IP_RANGES", "192.168.178.*")
HOME_PREFIXES = [p.strip().rstrip("*") for p in HOME_IP_RANGES.split(",") if p.strip()]

ISP_LOOKUP_ENABLED = os.getenv("ISP_LOOKUP_ENABLED", "false").lower() == "true"

if not TAUTULLI_URL or not TAUTULLI_API_KEY:
    print("[WARN] TAUTULLI_URL oder TAUTULLI_API_KEY nicht gesetzt. Die API-Aufrufe werden fehlschlagen.")

# einfacher HTTP-Client
client = httpx.Client(timeout=10.0, verify=TAUTULLI_VERIFY_SSL)

def is_home_ip(ip: str) -> bool:
    if not ip:
        return False
    return any(ip.startswith(prefix) for prefix in HOME_PREFIXES)

def _tautulli_api(cmd: str, **params):
    """
    Interner Helper für Tautulli-API-Calls.
    Erwartet Tautulli v2 API-Format:
    {
      "response": {
        "result": "success" | "error",
        "message": "...",
        "data": ...
      }
    }
    """
    if not TAUTULLI_URL or not TAUTULLI_API_KEY:
        raise RuntimeError("TAUTULLI_URL / TAUTULLI_API_KEY nicht konfiguriert")

    query = {
        "apikey": TAUTULLI_API_KEY,
        "cmd": cmd,
    }
    query.update(params)

    url = f"{TAUTULLI_URL}/api/v2"
    r = client.get(url, params=query)
    r.raise_for_status()
    data = r.json()

    # Korrekt: erst "response" herausziehen, DORT sitzt "result"
    response = data.get("response", {})
    result = response.get("result")

    if result != "success":
        # etwas lesbarer loggen
        msg = response.get("message") or "Unknown error"
        raise RuntimeError(f"Tautulli API error for cmd={cmd}: {msg} ({response})")

    return response
    

def get_users():
    """
    Liefert Liste aller Nutzer aus Tautulli.
    """
    resp = _tautulli_api("get_users")
    return resp.get("data", [])


def get_user_ips(user_id: int, length: int = 50):
    """
    Liefert IP-Übersicht für einen User.

    Tautulli antwortet bei get_user_ips mit einem "Table"-Format:
    response.data = {
        "draw": 1,
        "recordsTotal": ...,
        "recordsFiltered": ...,
        "data": [ {...}, {...} ]
    }
    """
    resp = _tautulli_api(
        "get_user_ips",
        user_id=user_id,
        length=length,
        order_column="last_seen",
        order_dir="desc",
    )

    outer = resp.get("data", [])

    if isinstance(outer, dict):
        return outer.get("data", [])
    if isinstance(outer, list):
        return outer
    return []


@lru_cache(maxsize=1024)
def geoip_lookup(ip_address: str):
    """
    GeoIP-Lookup über Tautulli – aber:
    - Für "HOME"-IPs (per HOME_IP_RANGES) wird NICHT nachgeschaut,
      sondern direkt ein pseudo-Geo-Objekt zurückgegeben.
    - Optionaler ISP-Lookup über ip-api.com, wenn Tautulli keinen ISP liefert
      und ISP_LOOKUP_ENABLED=true gesetzt ist.
    """
    if not ip_address:
        return {}

    # Lokale / Home IP -> nicht auflösen
    if is_home_ip(ip_address):
        return {
            "country": "HOME",
            "country_code": "HOME",
            "city": "Home",
            "region": "",
            "latitude": None,
            "longitude": None,
            "timezone": None,
            "isp": None,
        }

    try:
        resp = _tautulli_api("get_geoip_lookup", ip_address=ip_address)
        data = resp.get("data", {}) or {}
    except Exception as e:
        print(f"[WARN] GeoIP-Lookup für {ip_address} fehlgeschlagen: {e}")
        return {}

    # Optionaler externer ISP-Lookup (kann IPs nach draußen senden!)
    if ISP_LOOKUP_ENABLED and not data.get("isp"):
        try:
            r2 = client.get(
                f"http://ip-api.com/json/{ip_address}?fields=status,isp,message",
                timeout=3.0,
            )
            r2.raise_for_status()
            j2 = r2.json()
            if j2.get("status") == "success":
                data["isp"] = j2.get("isp")
        except Exception as e:
            print(f"[WARN] ISP-Lookup über ip-api.com für {ip_address} fehlgeschlagen: {e}")

    return data