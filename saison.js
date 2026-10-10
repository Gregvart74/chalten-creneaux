// Saison tab: long-range tendency at Chaltén.
// - Monthly anomalies from ECMWF SEAS5 (51 members, issued on the 5th) vs the model's own hindcast climatology
// - Share of members more anticyclonic than normal, from the members' daily pressure
// - Next 6 weeks from ECMWF EC46 (weekly anomalies)
// - A small anomaly map of southern South America, in the spirit of the Copernicus C3S charts
// - Climatology of good days per month from our own archive (data/meteo-histo.json)
// Loaded on demand by index.html: mount(el, ctx).

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_C = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];
const API = "https://seasonal-api.open-meteo.com/v1/seasonal";
const PT = {lat: -49.27, lon: -73.04};
const MAP = {W: -85, E: -55, S: -60, N: -40, step: 5};
const sg = (v, d = 0) => v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);

// Reading of a pressure anomaly (hPa) and of the share of members above normal
// The share of members is the better signal when we have it; the mean anomaly alone otherwise (current month, weeks)
function regime(dp, share) {
  if (dp == null) return {t: "–", c: ""};
  const hi = share != null ? share >= 0.6 : dp >= 1.5, lo = share != null ? share <= 0.4 : dp <= -1.5;
  if (hi) return {t: "Plus anticyclonique que la normale", c: "go"};
  if (lo) return {t: "Plus perturbé que la normale", c: "no"};
  return {t: "Proche de la normale", c: "fg"};
}
// Diverging colour for pressure anomalies: blue (low) → white → red (high), like the C3S maps
function anomColor(v) {
  const t = Math.max(-1, Math.min(1, v / 6));
  const a = t < 0 ? [59, 91, 165] : [196, 69, 44], w = [246, 244, 240], k = Math.abs(t);
  return w.map((x, j) => Math.round(x + (a[j] - x) * k));
}

export async function mount(el, ctx) {
  el.innerHTML = `<p class="h-load">Chargement des prévisions saisonnières…</p>`;
  const cache = ctx.store.get("saison2"); // v2: ensemble mean over 51 members
  let D = cache && Date.now() - cache.fetched < 12 * 3600e3 ? cache.data : null;
  if (!D) {
    try {
      const pts = []; for (let la = MAP.N; la >= MAP.S; la -= MAP.step) for (let lo = MAP.W; lo <= MAP.E; lo += MAP.step) pts.push([la, lo]);
      const [mon, wk, day, map] = await Promise.all([
        fetch(`${API}?latitude=${PT.lat}&longitude=${PT.lon}&models=ecmwf_seas5&monthly=pressure_msl_anomaly,wind_speed_10m_anomaly,precipitation_anomaly,temperature_2m_anomaly`).then(r => r.json()),
        fetch(`${API}?latitude=${PT.lat}&longitude=${PT.lon}&models=ecmwf_ec46&weekly=pressure_msl_anomaly,wind_speed_10m_anomaly,precipitation_anomaly`).then(r => r.json()),
        fetch(`${API}?latitude=${PT.lat}&longitude=${PT.lon}&models=ecmwf_seas5&daily=pressure_msl_mean&forecast_days=183`).then(r => r.json()),
        fetch(`${API}?latitude=${pts.map(p => p[0]).join(",")}&longitude=${pts.map(p => p[1]).join(",")}&models=ecmwf_seas5&monthly=pressure_msl_anomaly`).then(r => r.json()),
      ]);
      // monthly mean of each member's daily pressure, for full months only
      // the un-suffixed series is the control run; with members 01–50 it makes the 51-member ensemble
      const t = day.daily.time, members = ["pressure_msl_mean", ...Object.keys(day.daily).filter(k => k.includes("member"))], byMonth = {};
      t.forEach((d, i) => (byMonth[d.slice(0, 7)] = byMonth[d.slice(0, 7)] || []).push(i));
      const memMean = {};
      for (const m in byMonth) {
        const idx = byMonth[m], n = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
        if (idx.length < n) continue; // partial month (current one)
        const mem = members.map(k => idx.reduce((a, i) => a + day.daily[k][i], 0) / idx.length);
        memMean[m] = {ens: mem.reduce((a, v) => a + v, 0) / mem.length, mem};
      }
      D = {issued: mon.monthly.time[0], mon: mon.monthly, wk: wk.weekly, memMean, pts, map: map.map(p => p.monthly.pressure_msl_anomaly)};
      ctx.store.set("saison2", {data: D, fetched: Date.now()});
    } catch (e) {
      el.innerHTML = `<p class="err">Prévisions saisonnières indisponibles (réseau).</p>`; return;
    }
  }

  // ---------- climatology of good days per month (our archive, current thresholds) ----------
  let clim = null;
  try {
    const h = await (await fetch("data/meteo-histo.json")).json(), th = ctx.th(), per = {};
    const one = s => Math.max(s.w <= th.ok ? 0 : s.w <= th.max ? 1 : 2, s.pr >= 1 ? 2 : s.pr >= 0.2 ? 1 : 0, s.cm >= 80 ? 1 : 0);
    for (const k in h.days) {
      const d = h.days[k], vs = [d.g, d.e].filter(Boolean).map(one); if (!vs.length) continue;
      const m = +k.slice(5, 7) - 1, y = k.slice(0, 4), p = (per[m] = per[m] || {n: 0, good: 0, years: {}});
      p.n++; if (Math.max(...vs) === 0) p.good++;
      const py = (p.years[y] = p.years[y] || {n: 0, good: 0}); py.n++; if (Math.max(...vs) === 0) py.good++;
    }
    clim = per;
  } catch (e) { /* archive unavailable */ }

  // ---------- render ----------
  const months = D.mon.time.map((t, i) => {
    const k = t.slice(0, 7), mm = D.memMean[k], dp = D.mon.pressure_msl_anomaly[i];
    // the model's normal for that month = ensemble mean − anomaly; share of members above it
    const share = mm ? mm.mem.filter(v => v > mm.ens - dp).length / mm.mem.length : null;
    return {k, m: +t.slice(5, 7) - 1, y: +t.slice(0, 4), dp, share, dw: D.mon.wind_speed_10m_anomaly[i], dpr: D.mon.precipitation_anomaly[i], dt: D.mon.temperature_2m_anomaly[i]};
  });
  const pct = c => c && c.n ? Math.round(100 * c.good / c.n) : null;
  const issued = new Date(D.issued + "T12:00:00Z");
  el.innerHTML = `
    <section class="panel">
      <h2>Tendance des prochains mois au Fitz Roy</h2>
      <p class="s-intro">Prévision saisonnière ECMWF (SEAS5, 51 scénarios, émise début ${MOIS[issued.getUTCMonth()]} ${issued.getUTCFullYear()}), comparée à sa propre normale sur 20 à 30 ans. Elle dit si un mois s'annonce plutôt anticyclonique ou perturbé, pas quel jour il fera beau.</p>
      <div class="s-months">${months.map(m => { const r = regime(m.dp, m.share), c = clim && clim[m.m];
        return `<div class="s-m ${r.c}"><b>${MOIS[m.m]} ${m.y}</b><span class="s-reg">${r.t}</span>
          <small>Pression ${sg(m.dp, 1)} hPa${m.share != null ? ` · ${Math.round(100 * m.share)} % des scénarios au-dessus de la normale` : " · mois en cours"}</small>
          <small>Vent ${m.dw == null ? "–" : (m.dw < -0.5 ? "plus faible" : m.dw > 0.5 ? "plus fort" : "normal")} (${sg(m.dw, 1)} km/h) · ${m.dpr == null ? "" : m.dpr < 0 ? "plus sec" : "plus humide"}</small>
          ${c ? `<small>Repère : ${pct(c)} % de jours « Bon » en ${MOIS_C[m.m]} (2022–2026)</small>` : ""}</div>`; }).join("")}</div>
    </section>
    <section class="panel">
      <h2>Carte de l'écart de pression</h2>
      <div class="syn">
        <div><canvas id="s-map" width="560" height="420" role="img" aria-label="Écart de pression prévu par rapport à la normale, sud de l'Amérique du Sud"></canvas>
          <div class="syn-ctl"><select id="s-mon" aria-label="Mois">${months.map((m, i) => `<option value="${i}">${MOIS[m.m]} ${m.y}</option>`).join("")}</select></div></div>
        <div><div class="s-scale"></div><div class="s-scale-l"><span>−6 hPa</span><span>normale</span><span>+6 hPa</span></div>
          <p>Rouge : pression plus haute que d'habitude (anticyclones, flux d'ouest affaibli : favorable aux créneaux). Bleu : plus basse (dépressions plus actives). Le point marque Chaltén. C'est la même logique que les cartes Copernicus, avec un seul modèle (ECMWF) au lieu de plusieurs.</p>
          <p><a href="https://climate.copernicus.eu/charts/packages/c3s_seasonal/" target="_blank" rel="noopener">Cartes multi-modèles Copernicus C3S ↗</a></p></div>
      </div>
    </section>
    <section class="panel">
      <h2>Les 6 prochaines semaines</h2>
      <p class="s-intro">Prévision mensuelle ECMWF (EC46, mise à jour chaque jour), plus fiable que le saisonnier sur cet horizon.</p>
      <div class="s-weeks">${D.wk.time.map((t, i) => [t, i]).filter(([t]) => new Date(t + "T12:00:00Z") > Date.now() - 4 * 864e5).slice(0, 6).map(([t, i]) => { const dp = D.wk.pressure_msl_anomaly[i], r = regime(dp, null), d = new Date(t + "T12:00:00Z");
        return `<div class="s-w ${r.c}"><b>sem. du ${d.getUTCDate()} ${MOIS_C[d.getUTCMonth()]}</b><span>${sg(dp, 1)} hPa</span><small>vent ${sg(D.wk.wind_speed_10m_anomaly[i], 1)} km/h</small></div>`; }).join("")}</div>
    </section>
    ${clim ? `<section class="panel">
      <h2>Climatologie des créneaux</h2>
      <p class="s-intro">Part des jours « Bon » par mois depuis 2022, avec les règles actuelles de l'app (archives de prévisions). Les barres fines donnent chaque année.</p>
      <div class="s-clim">${[6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5].map(m => { const c = clim[m], p = pct(c) ?? 0;
        const ys = c ? Object.entries(c.years).filter(([, v]) => v.n >= 20).map(([y, v]) => `<i title="${y} : ${Math.round(100 * v.good / v.n)} %" style="height:${Math.round(100 * v.good / v.n) * 1.6}px"></i>`).join("") : "";
        return `<div class="s-c"><span class="s-v">${c ? p + " %" : "–"}</span><div class="s-bar"><b style="height:${p * 1.6}px"></b>${ys}</div><span class="s-l">${MOIS_C[m]}</span></div>`; }).join("")}</div>
    </section>` : ""}
    <p class="h-note">Prévisions saisonnières : ECMWF SEAS5 et EC46 via Open-Meteo (écarts calculés par rapport aux rejeux du modèle). La fiabilité de ces tendances est modeste aux latitudes de la Patagonie : à lire comme un signal de fond, pas comme une garantie.</p>`;

  // ---------- anomaly map ----------
  const lats = [], lons = []; for (let la = MAP.N; la >= MAP.S; la -= MAP.step) lats.push(la); for (let lo = MAP.W; lo <= MAP.E; lo += MAP.step) lons.push(lo);
  function drawMap(mi) {
    const cv = el.querySelector("#s-map"), c2 = cv.getContext("2d"), k = Math.cos(50 * Math.PI / 180);
    const spanX = (MAP.E - MAP.W) * k, spanY = MAP.N - MAP.S, w = Math.round(Math.min(560, cv.parentElement.clientWidth) * (devicePixelRatio > 1 ? 2 : 1)), h = Math.round(w * spanY / spanX);
    if (cv.width !== w) { cv.width = w; cv.height = h; }
    const F = lats.map((_, r) => lons.map((_, c) => (D.map[r * lons.length + c] || [])[mi] ?? null)), R = lats.length - 1, C = lons.length - 1;
    const at = (lat, lon) => { const fr = (MAP.N - lat) / MAP.step, fc = (lon - MAP.W) / MAP.step, r0 = Math.min(R - 1, Math.floor(fr)), c0 = Math.min(C - 1, Math.floor(fc)), tr = fr - r0, tc = fc - c0;
      const a = F[r0][c0], b = F[r0][c0 + 1], cc = F[r0 + 1][c0], d = F[r0 + 1][c0 + 1]; if ([a, b, cc, d].some(v => v == null)) return null;
      return a * (1 - tr) * (1 - tc) + b * (1 - tr) * tc + cc * tr * (1 - tc) + d * tr * tc; };
    const img = c2.createImageData(w, h), st = 2;
    for (let y = 0; y < h; y += st) for (let x = 0; x < w; x += st) {
      const v = at(MAP.N - y / h * spanY, MAP.W + x / w * spanX / k), rgb = v == null ? [128, 128, 128] : anomColor(v);
      for (let dy = 0; dy < st && y + dy < h; dy++) for (let dx = 0; dx < st && x + dx < w; dx++) { const o = ((y + dy) * w + x + dx) * 4; img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255; }
    }
    c2.putImageData(img, 0, 0);
    const px = lon => (lon - MAP.W) * k / spanX * w, py = lat => (MAP.N - lat) / spanY * h, u = w / 560;
    c2.lineWidth = 1.3 * u; c2.strokeStyle = "rgba(20,28,35,.85)";
    ctx.coast.forEach(r => { c2.beginPath(); for (let j = 0; j < r.length; j += 2) { const X = px(r[j]), Y = py(r[j + 1]); j ? c2.lineTo(X, Y) : c2.moveTo(X, Y); } c2.stroke(); });
    c2.font = `500 ${11 * u}px "IBM Plex Mono",monospace`; c2.textAlign = "center"; c2.fillStyle = "rgba(20,28,35,.8)";
    lats.forEach((la, r) => lons.forEach((lo, cI) => { const v = F[r][cI]; if (v != null && r % 1 === 0 && cI % 2 === 0) c2.fillText(sg(v, 0), px(lo), py(la) + 4 * u); }));
    c2.beginPath(); c2.arc(px(PT.lon), py(PT.lat), 5 * u, 0, 7); c2.fillStyle = "#fff"; c2.fill(); c2.lineWidth = 2.5 * u; c2.strokeStyle = "#111"; c2.stroke();
  }
  const sel = el.querySelector("#s-mon"), first = months.findIndex(m => m.share != null);
  sel.value = Math.max(0, first); sel.onchange = e => drawMap(+e.target.value);
  drawMap(+sel.value);
  return {refresh() { drawMap(+sel.value); }};
}
