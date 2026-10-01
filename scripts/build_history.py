"""Construit data/meteo-histo.json : un résumé météo par jour au Fitz Roy depuis 2022,
à partir des archives de prévisions Open-Meteo (historical-forecast-api).

Agrégats alignés sur le verdict de l'app (heures 4h–20h) :
  w   vent max 700 hPa (km/h)        pr  précipitation (mm)
  cm  nuages moyens moyens (%)       sat heures T–Td < 2° entre 8h et 18h
  pm  pression moyenne (hPa)
Sur la journée entière (GFS seul, ECMWF ne les archive pas) :
  sn  neige au niveau des voies (cm, estimée : précipitation des heures où l'iso 0° est sous 3000 m, 1 mm ≈ 1 cm ;
      la variable « snowfall » manque dans l'archive de fin 2022 à fin 2024)
  iz  isotherme 0° max (m)
ECMWF n'est archivé qu'à partir de 2024 : avant, seules les valeurs GFS existent.

Usage : python3 scripts/build_history.py   (relancer de temps en temps ; l'app complète les derniers jours en direct)
"""
import json, urllib.request, datetime as dt, os

LAT, LON = -49.2714, -73.0431
START = dt.date(2022, 1, 1)
MODELS = {"g": "gfs_seamless", "e": "ecmwf_ifs025"}
VARS = "wind_speed_700hPa,precipitation,cloud_cover_mid,temperature_2m,dew_point_2m,pressure_msl,freezing_level_height"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "meteo-histo.json")

def fetch(a, b):
    u = (f"https://historical-forecast-api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}"
         f"&hourly={VARS}&models={','.join(MODELS.values())}&start_date={a}&end_date={b}"
         "&timezone=America%2FArgentina%2FRio_Gallegos")
    return json.load(urllib.request.urlopen(u, timeout=120))["hourly"]

def day_summary(h, idx, m):
    g = lambda v, i: h.get(f"{v}_{MODELS[m]}", [None] * len(h["time"]))[i]
    day = [i for i in idx if 4 <= int(h["time"][i][11:13]) <= 20 and g("wind_speed_700hPa", i) is not None]
    if not day:
        return None
    r = lambda x, n=0: round(x, n) if n else round(x)
    s = dict(
        w=r(max(g("wind_speed_700hPa", i) for i in day)),
        pr=r(sum(g("precipitation", i) or 0 for i in day), 1),
        cm=r(sum(g("cloud_cover_mid", i) or 0 for i in day) / len(day)),
        sat=sum(1 for i in day if 8 <= int(h["time"][i][11:13]) <= 18 and g("temperature_2m", i) is not None
                and g("dew_point_2m", i) is not None and g("temperature_2m", i) - g("dew_point_2m", i) < 2),
        pm=r(sum(g("pressure_msl", i) or 0 for i in day) / len(day)),
    )
    if m == "g":
        iz = [g("freezing_level_height", i) for i in idx if g("freezing_level_height", i) is not None]
        s["sn"] = r(sum(g("precipitation", i) or 0 for i in idx
                        if g("freezing_level_height", i) is not None and g("freezing_level_height", i) < 3000), 1)
        s["iz"] = r(max(iz)) if iz else None
    return s

days = {}
end = dt.date.today() - dt.timedelta(days=1)
a = START
while a <= end:
    b = min(end, (a.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1))  # month chunks
    h = fetch(a, b)
    byday = {}
    for i, t in enumerate(h["time"]):
        byday.setdefault(t[:10], []).append(i)
    for d, idx in byday.items():
        rec = {m: day_summary(h, idx, m) for m in MODELS}
        days[d] = {m: v for m, v in rec.items() if v}
    print(a, "→", b, len(byday), "jours")
    a = b + dt.timedelta(days=1)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump({"built": dt.date.today().isoformat(), "lat": LAT, "lon": LON, "days": days}, open(OUT, "w"), separators=(",", ":"))
print("écrit", OUT, len(days), "jours")
