// Historique tab: past days scored with the app's verdict rules, the 7 days before each one,
// ground reports (data/historique.json), and past situations that resemble the next forecast window.
// Loaded on demand by index.html: mount(el, ctx) where ctx gives thresholds and the current forecast.

const JOURS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
const MOIS = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];
const LBL = ["Bon", "Limite", "Non"], CLS = ["go", "warn", "no"];
const TYPE = {
  sommet: {ico: "▲", txt: "Sommet", cls: "go"},
  mitige: {ico: "◐", txt: "Mitigé", cls: "warn"},
  retraite: {ico: "✕", txt: "Retraite", cls: "no"},
  tempete: {ico: "✕", txt: "Tempête", cls: "no"},
  conditions: {ico: "●", txt: "Conditions", cls: "info"},
};
const TZ = "America/Argentina/Rio_Gallegos";
const H_VARS = "wind_speed_700hPa,precipitation,cloud_cover_mid,temperature_2m,dew_point_2m,pressure_msl,freezing_level_height";
const H_MODELS = {g: "gfs_seamless", e: "ecmwf_ifs025"};

const addDays = (k, n) => { const d = new Date(k + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtDay = k => { const d = new Date(k + "T12:00:00Z"); return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const r0 = v => v == null ? "–" : Math.round(v);

// Same daily summary as scripts/build_history.py, from hourly arrays (time[], get(var) → array)
function summarize(time, get, withSnow) {
  const byDay = {};
  time.forEach((t, i) => (byDay[t.slice(0, 10)] = byDay[t.slice(0, 10)] || []).push(i));
  const out = {};
  for (const k in byDay) {
    const idx = byDay[k], w = get("wind_speed_700hPa"), pr = get("precipitation"), cm = get("cloud_cover_mid"),
      t2 = get("temperature_2m"), td = get("dew_point_2m"), pm = get("pressure_msl"), iz = get("freezing_level_height");
    const day = idx.filter(i => { const h = +time[i].slice(11, 13); return h >= 4 && h <= 20 && w[i] != null; });
    if (!day.length) continue;
    const s = {
      w: Math.round(Math.max(...day.map(i => w[i]))),
      pr: Math.round(day.reduce((a, i) => a + (pr[i] || 0), 0) * 10) / 10,
      cm: Math.round(day.reduce((a, i) => a + (cm[i] || 0), 0) / day.length),
      sat: day.filter(i => { const h = +time[i].slice(11, 13); return h >= 8 && h <= 18 && t2[i] != null && td[i] != null && t2[i] - td[i] < 2; }).length,
      pm: Math.round(day.reduce((a, i) => a + (pm[i] || 0), 0) / day.length),
    };
    if (withSnow) {
      s.sn = Math.round(idx.reduce((a, i) => a + (iz[i] != null && iz[i] < 3000 ? (pr[i] || 0) : 0), 0) * 10) / 10;
      const z = idx.map(i => iz[i]).filter(v => v != null); s.iz = z.length ? Math.round(Math.max(...z)) : null;
    }
    out[k] = s;
  }
  return out;
}

export async function mount(el, ctx) {
  el.innerHTML = `<p class="h-load">Chargement de l'historique…</p>`;
  const [met, ev] = await Promise.all([fetch("data/meteo-histo.json").then(r => r.json()), fetch("data/historique.json").then(r => r.json())]);
  const days = met.days;

  // Fill the gap between the archive build and today (the archive is rebuilt by hand from time to time)
  const today = new Date(new Date().toLocaleString("en-US", {timeZone: TZ})).toISOString().slice(0, 10);
  const from = addDays(met.built, -1), to = addDays(today, -1);
  if (from <= to) {
    try {
      const u = `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${met.lat}&longitude=${met.lon}&hourly=${H_VARS}&models=${Object.values(H_MODELS).join(",")}&start_date=${from}&end_date=${to}&timezone=${encodeURIComponent(TZ)}`;
      const h = (await (await fetch(u)).json()).hourly;
      for (const m in H_MODELS) {
        const s = summarize(h.time, v => h[`${v}_${H_MODELS[m]}`] || h.time.map(() => null), m === "g");
        for (const k in s) (days[k] = days[k] || {})[m] = s[k];
      }
    } catch (e) { /* offline: the archive alone is fine */ }
  }
  // Upcoming days from the forecast already loaded by the app
  const fc = ctx.forecast();
  if (fc) {
    for (const [m, key] of [["g", "gfs"], ["e", "ecmwf"]]) {
      const s = summarize(fc.time, v => fc.m[key][v] || fc.time.map(() => null), m === "g");
      for (const k in s) if (k >= today) (days[k] = days[k] || {})[m] = Object.assign({}, s[k], {fc: 1});
    }
  }

  const events = ev.events.slice().sort((a, b) => a.date.localeCompare(b.date));
  const evByDay = {}; events.forEach(e => (evByDay[e.date] = evByDay[e.date] || []).push(e));

  // ---------- verdict with the app's current rules ----------
  function verdict(k) {
    const d = days[k]; if (!d) return null;
    const th = ctx.th();
    const one = s => Math.max(s.w <= th.ok ? 0 : s.w <= th.max ? 1 : 2, s.pr >= 1 ? 2 : s.pr >= 0.2 ? 1 : 0, s.cm >= 80 ? 1 : 0);
    const vs = [d.g, d.e].filter(Boolean).map(one);
    return vs.length ? {v: Math.max(...vs), gfsOnly: !d.e} : null;
  }

  // ---------- the 7 days before ----------
  function before(k) {
    const prev = [-7, -6, -5, -4, -3, -2, -1].map(n => ({k: addDays(k, n), d: (days[addDays(k, n)] || {}).g}));
    const ok = prev.filter(p => p.d);
    if (ok.length < 4) return null;
    const last3 = prev.slice(4).filter(p => p.d);
    const sum = (a, f) => a.reduce((s, p) => s + (f(p.d) || 0), 0);
    let dry = 0; for (let n = 1; n <= 14; n++) { const d = (days[addDays(k, -n)] || {}).g; if (!d || d.pr >= 0.5) break; dry++; }
    const f = {
      snow7: sum(ok, d => d.sn), snow3: sum(last3, d => d.sn),
      wind3: Math.max(0, ...last3.map(p => p.d.w)), iz3: Math.max(0, ...last3.map(p => p.d.iz || 0)), dry,
    };
    const read = [];
    if (f.snow3 >= 15) read.push({c: "warn", t: `Neige fraîche juste avant (${r0(f.snow3)} cm sur 3 jours) : faces chargées, givre et neige dans les fissures probables.`});
    else if (f.snow7 >= 25) read.push({c: "warn", t: `Gros apport de neige dans la semaine (${r0(f.snow7)} cm) : voies encore enneigées par endroits.`});
    if (f.snow7 >= 10 && f.iz3 >= 2800) read.push({c: "warn", t: `Redoux ensuite (0 °C jusqu'à ${r0(f.iz3)} m) : purges, chutes de glace et neige qui se transforme.`});
    if (f.wind3 >= 80) read.push({c: "warn", t: `Gros vent juste avant (${r0(f.wind3)} km/h) : neige soufflée, plaques, givre arraché par endroits.`});
    if (f.dry >= 5) read.push({c: "go", t: `${f.dry} jours sans précipitation avant : voies probablement sèches.`});
    if (!read.length) read.push({c: "", t: "Rien de marquant dans les jours d'avant."});
    return {prev, f, read};
  }

  // ---------- similar past situations ----------
  const vec = f => [f.snow7 / 30, f.snow3 / 20, f.wind3 / 100, f.iz3 / 3000, Math.min(f.dry, 10) / 10];
  function analogs(k, n = 3) {
    const b = before(k); if (!b) return [];
    const x = vec(b.f), out = [];
    for (const e of events) {
      if (e.date >= addDays(k, -1)) continue;
      const be = before(e.date); if (!be) continue;
      const y = vec(be.f); out.push({e, dist: Math.hypot(...x.map((v, i) => v - y[i]))});
    }
    return out.sort((a, b) => a.dist - b.dist).slice(0, n);
  }

  // ---------- UI ----------
  const seasons = []; // July → June
  const first = Object.keys(days).sort()[0];
  for (let y = +first.slice(0, 4) - (+first.slice(5, 7) < 7 ? 1 : 0); `${y}-07-01` <= addDays(today, 10); y++) seasons.unshift(y);
  // Climbing season = July → June. From July to October the current one is still empty: show the previous summer.
  const curSeason = +today.slice(0, 4) - (today.slice(5, 7) < "07" ? 1 : 0);
  let season = today.slice(5, 7) >= "07" && today.slice(5, 7) < "11" && seasons.includes(curSeason - 1) ? curSeason - 1 : curSeason;
  let sel = (events.length && events[events.length - 1].date) || addDays(today, -1);
  const upcoming = Object.keys(days).filter(k => k >= today && days[k].g && days[k].g.fc && (verdict(k) || {}).v === 0).sort()[0];

  el.innerHTML = `
    <section class="panel">
      <div class="h-head"><h2>Historique des créneaux</h2>
        <select id="h-season" aria-label="Saison">${seasons.map(y => `<option value="${y}">${y}–${String(y + 1).slice(2)}</option>`).join("")}</select></div>
      <div class="h-cal" id="h-cal"></div>
      <p class="h-legend"><i class="sw go"></i>Bon <i class="sw warn"></i>Limite <i class="sw no"></i>Non (règles actuelles de l'app) · <b>▲</b> sommet <b>◐</b> mitigé <b>✕</b> retraite/tempête · cadre = prévision</p>
    </section>
    <section class="panel" id="h-up"></section>
    <section class="panel" id="h-day"></section>
    <p class="h-note">Météo : archives de prévisions Open-Meteo (GFS depuis 2022, ECMWF depuis février 2024 ; neige estimée d'après les précipitations quand le 0 °C est sous 3000 m). Comptes rendus : ${events.length} ajoutés à la main (récits, presse, posts @patagoniavertical), mis à jour le ${ev.updated}.</p>`;
  const $ = id => el.querySelector("#" + id);
  $("h-season").value = season;
  $("h-season").onchange = e => { season = +e.target.value; drawCal(); };

  function drawCal() {
    const cal = $("h-cal"); let html = "";
    for (let mi = 0; mi < 12; mi++) {
      const y = season + (mi >= 6 ? 1 : 0), m = (mi + 6) % 12, n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      html += `<div class="h-row"><span class="h-m">${MOIS[m]}</span>`;
      for (let d = 1; d <= 31; d++) {
        if (d > n) { html += `<span class="h-c empty"></span>`; continue; }
        const k = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, v = verdict(k), es = evByDay[k];
        const cls = v ? CLS[v.v] : "none", fcCls = days[k] && days[k].g && days[k].g.fc ? " fc" : "", s = k === sel ? " sel" : "";
        const mark = es ? (TYPE[es[0].type] || TYPE.conditions).ico : "";
        html += `<button class="h-c ${cls}${fcCls}${s}" data-k="${k}" title="${fmtDay(k)}${v ? " · " + LBL[v.v] : ""}${es ? " · " + es.map(e => e.peak).join(", ") : ""}">${mark}</button>`;
      }
      html += `</div>`;
    }
    cal.innerHTML = html;
    cal.querySelectorAll("button[data-k]").forEach(b => b.onclick = () => { sel = b.dataset.k; drawCal(); drawDay(); $("h-day").scrollIntoView({behavior: "smooth", block: "start"}); });
  }

  function beforeTable(b) {
    const row = (lbl, f, unit) => `<tr><th>${lbl}</th>${b.prev.map(p => `<td>${p.d ? f(p.d) : "–"}</td>`).join("")}</tr>`;
    return `<table class="h-before"><thead><tr><th></th>${b.prev.map((p, i) => `<th title="${fmtDay(p.k)}">J−${7 - i}</th>`).join("")}</tr></thead><tbody>
      ${row("Neige (cm)", d => r0(d.sn))}${row("Vent 3000 m", d => r0(d.w))}${row("Iso 0° (m)", d => d.iz ? (d.iz / 1000).toFixed(1) + "k" : "–")}${row("Pluie (mm)", d => r0(d.pr))}</tbody></table>
      ${b.read.map(x => `<p class="h-read ${x.c}">${x.t}</p>`).join("")}`;
  }
  const evHtml = e => { const t = TYPE[e.type] || TYPE.conditions;
    return `<li><span class="h-ev ${t.cls}">${t.ico} ${t.txt}</span> <b>${e.peak}</b>${e.route ? ", " + e.route : ""}. ${e.note} <a href="${e.url}" target="_blank" rel="noopener">${e.source} ↗</a>${e.precision === "infere" ? " <i>(date déduite)</i>" : ""}</li>`; };

  function drawDay() {
    const k = sel, d = days[k] || {}, v = verdict(k), b = before(k), es = evByDay[k] || [];
    const line = (lbl, s) => s ? `<span>${lbl} : vent ${s.w} km/h · pluie ${s.pr} mm · nuages moy. ${s.cm} % · ${s.pm} hPa${s.sat ? ` · <span class="hum">humide ${s.sat} h</span>` : ""}</span>` : "";
    $("h-day").innerHTML = `
      <div class="h-head"><h2 class="h-title">${fmtDay(k)}</h2>${v ? `<span class="h-badge ${CLS[v.v]}">${d.g && d.g.fc ? "Prévu" : "Verdict"} : ${LBL[v.v]}${v.gfsOnly ? " (GFS seul)" : ""}</span>` : ""}</div>
      <p class="h-metrics">${line("ECMWF", d.e)}${d.e && d.g ? "<br>" : ""}${line("GFS", d.g)}</p>
      <h3>Les 7 jours d'avant</h3>${b ? beforeTable(b) : "<p class='h-read'>Pas assez de données.</p>"}
      <h3>Ce qui s'est passé</h3>${es.length ? `<ul class="h-evs">${es.map(evHtml).join("")}</ul>` : `<p class="h-read">Aucun compte rendu enregistré ce jour-là.</p>`}`;
  }

  function drawUp() {
    if (!upcoming) { $("h-up").innerHTML = `<h2>Prochain créneau</h2><p class="h-read">Aucun jour « Bon » dans les 10 jours de prévision.</p>`; return; }
    const b = before(upcoming), an = analogs(upcoming);
    $("h-up").innerHTML = `<div class="h-head"><h2>Prochain créneau : ${fmtDay(upcoming)}</h2><button class="h-go" data-k="${upcoming}">Détail</button></div>
      ${b ? b.read.map(x => `<p class="h-read ${x.c}">${x.t}</p>`).join("") : ""}
      <h3>Situations passées les plus proches (jours d'avant comparables)</h3>
      <div class="h-an">${an.map(a => { const t = TYPE[a.e.type] || TYPE.conditions;
        return `<button class="h-an-c" data-k="${a.e.date}"><span class="h-an-d">${fmtDay(a.e.date)}</span><span class="h-ev ${t.cls}">${t.ico} ${t.txt}</span><span>${a.e.peak}</span></button>`; }).join("")}</div>
      <p class="h-small">Comparaison sur la neige des 7 et 3 derniers jours, le vent et le 0 °C des 3 derniers jours, et le nombre de jours secs. Indicatif tant que l'historique est court (${events.length} comptes rendus).</p>`;
    $("h-up").querySelectorAll("button[data-k]").forEach(x => x.onclick = () => { sel = x.dataset.k; season = +sel.slice(0, 4) - (+sel.slice(5, 7) < 7 ? 1 : 0); $("h-season").value = season; drawCal(); drawDay(); $("h-day").scrollIntoView({behavior: "smooth", block: "start"}); });
  }

  drawCal(); drawUp(); drawDay();
  return {refresh() { drawCal(); drawUp(); drawDay(); }};
}
