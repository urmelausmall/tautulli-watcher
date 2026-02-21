const usersListEl = document.getElementById("usersList");
const detailsContentEl = document.getElementById("detailsContent");
const detailsTitleEl = document.getElementById("detailsTitle");
const userSearchEl = document.getElementById("userSearch");
const limitInputEl = document.getElementById("limitInput");
const reloadBtn = document.getElementById("reloadBtn");
const colorToggleBtn = document.getElementById("colorToggleBtn");
const viewToggleBtn = document.getElementById("viewToggleBtn");

let allUsers = [];
let activeUserId = null;

// Farben standardmäßig AN
let colorMode = true;
// Tabellenansicht standardmäßig aktiv
let mapMode = false;

// Für die Karte
let currentIpsForMap = [];
let currentUserForMap = null;
let leafletMap = null;
let markerLayer = null;

// Tooltip für IP-Details
let ipTooltip = null;

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json"
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function loadUsers() {
  usersListEl.innerHTML = "<p>Loading Nutzer...</p>";
  try {
    const data = await fetchJSON("/api/users");
    allUsers = data.users || [];
    renderUsersList();
  } catch (err) {
    console.error(err);
    usersListEl.innerHTML = `<p class="error">Fehler beim Laden der Nutzer: ${err.message}</p>`;
  }
}

function renderUsersList() {
  const filter = userSearchEl.value.trim().toLowerCase();

  const filtered = allUsers.filter(u => {
    const name = (u.friendly_name || "").toLowerCase();
    const username = (u.username || "").toLowerCase();
    return !filter || name.includes(filter) || username.includes(filter);
  });

  if (!filtered.length) {
    usersListEl.innerHTML = "<p>Keine Nutzer gefunden.</p>";
    return;
  }

  usersListEl.innerHTML = "";
  filtered.forEach(u => {
    const div = document.createElement("div");
    div.className = "user-item" + (u.user_id === activeUserId ? " active" : "");
    div.dataset.userId = u.user_id;

    const name = u.friendly_name || u.username || `User ${u.user_id}`;
    const metaParts = [];
    if (u.username && u.username !== name) metaParts.push(u.username);
    if (u.email) metaParts.push(u.email);
    if (u.is_admin) metaParts.push("Admin");
    if (u.is_active === 0) metaParts.push("inaktiv");

    div.innerHTML = `
      <div class="user-name">${name}</div>
      <div class="user-meta">${metaParts.join(" · ")}</div>
    `;

    div.addEventListener("click", () => {
      activeUserId = u.user_id;
      renderUsersList();
      loadUserIPs(u);
    });

    usersListEl.appendChild(div);
  });
}

async function loadUserIPs(user) {
  detailsContentEl.innerHTML = "<p>IP-Daten werden geladen...</p>";
  detailsTitleEl.textContent = `Details – ${user.friendly_name || user.username || "User " + user.user_id}`;

  let limit = parseInt(limitInputEl.value, 10);
  if (isNaN(limit) || limit <= 0) {
    limit = 50;
    limitInputEl.value = String(limit);
  }

  try {
    const data = await fetchJSON(`/api/users/${user.user_id}/ips?limit=${encodeURIComponent(limit)}`);
    renderUserIPs(user, data.ips || []);
  } catch (err) {
    console.error(err);
    detailsContentEl.innerHTML = `<p class="error">Fehler beim Laden der IP-Daten: ${err.message}</p>`;
  }
}

function buildLocationString(entry) {
  if (entry.country === "HOME" || entry.is_home) {
    return "HOME";
  }
  const locParts = [];
  if (entry.city) locParts.push(entry.city);
  if (entry.region) locParts.push(entry.region);
  if (entry.country) locParts.push(entry.country);
  return locParts.length ? locParts.join(", ") : "–";
}

function renderUserIPs(user, ips) {
  if (!ips.length) {
    detailsContentEl.innerHTML = "<p>Keine IP-Einträge für diesen Nutzer gefunden.</p>";
    return;
  }

  // Chronologische Sortierung nach last_seen_ts (neueste zuerst)
  ips = ips.slice().sort((a, b) => {
    const at = a.last_seen_ts ?? 0;
    const bt = b.last_seen_ts ?? 0;
    return bt - at;
  });

  // externe IPs (ohne HOME)
  const externalIps = ips.filter(
    e => !e.is_home && e.country !== "HOME" && e.ip_address
  );

  const distinctExternalIps = new Set(
    externalIps.map(e => e.ip_address)
  );

  const totalExternal = externalIps.length;               // Anzahl Einträge
  const uniqueExternal = distinctExternalIps.size;        // Anzahl unterschiedlicher IPs

  const baseName = user.friendly_name || user.username || ("User " + user.user_id);
  detailsTitleEl.textContent =
    `Details – ${baseName} (${uniqueExternal} unterschiedliche externe IPs, ${totalExternal} Einträge)`;

  currentIpsForMap = ips;
  currentUserForMap = user;

  const colored = colorMode;

  // Check, ob wir irgendwo einen ISP haben
  const hasIsp = ips.some(e => e.isp && String(e.isp).trim() !== "");

  const rows = ips.map(entry => {
    const locationStr = buildLocationString(entry);
    const ip = entry.ip_address || "–";
    const isp = entry.isp || "";

    // Attribute für Tooltip
    const attrs = [
      `data-ip="${escapeAttr(ip)}"`,
      `data-location="${escapeAttr(locationStr)}"`,
      `data-country="${escapeAttr(entry.country || "")}"`,
      `data-city="${escapeAttr(entry.city || "")}"`,
      `data-region="${escapeAttr(entry.region || "")}"`,
      `data-timezone="${escapeAttr(entry.timezone || "")}"`,
      `data-isp="${escapeAttr(isp || "")}"`
    ].join(" ");

    let ipCellContent = ip;
    let locationCellContent = locationStr;
    let ispCellContent = isp ? escapeHtml(isp) : "–";

    if (colored && ip !== "–") {
      const ipColor = colorForKey(`ip:${ip}`);
      ipCellContent = `<span class="ip-pill ip-cell" ${attrs} style="background:${ipColor};">${escapeHtml(ip)}</span>`;
    } else {
      ipCellContent = `<span class="ip-pill ip-cell" ${attrs}>${escapeHtml(ip)}</span>`;
    }

    if (colored && locationStr !== "–") {
      const locColor = colorForKey(`loc:${locationStr}`);
      locationCellContent = `<span class="location-pill" style="background:${locColor};">${escapeHtml(locationStr)}</span>`;
    } else {
      locationCellContent = `<span class="location-pill">${escapeHtml(locationStr)}</span>`;
    }

    if (hasIsp) {
      if (colored && isp) {
        const ispColor = colorForKey(`isp:${isp}`);
        ispCellContent = `<span class="isp-pill" style="background:${ispColor};">${escapeHtml(isp)}</span>`;
      } else {
        ispCellContent = `<span class="isp-pill">${escapeHtml(isp || "–")}</span>`;
      }
    }

    const cols = [];
    cols.push(`<td>${locationCellContent}</td>`);
    cols.push(`<td>${ipCellContent}</td>`);
    if (hasIsp) {
      cols.push(`<td>${ispCellContent}</td>`);
    }
    cols.push(`<td>${escapeHtml(entry.first_seen || "–")}</td>`);
    cols.push(`<td>${escapeHtml(entry.last_seen || "–")}</td>`);

    return `<tr>${cols.join("")}</tr>`;
  }).join("");

  // Table-Header dynamisch bauen
  let header = `
    <tr>
      <th>Standort</th>
      <th>IP</th>`;
  if (ips.some(e => e.isp && String(e.isp).trim() !== "")) {
    header += `<th>ISP</th>`;
  }
  header += `
      <th>First seen</th>
      <th>Last seen</th>
    </tr>`;

  // Vor dem Neuaufbau des Details-HTML: vorhandene Leaflet-Map sauber wegräumen,
  // sonst hängt sie an einem alten #map-Element.
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
    markerLayer = null;
  }
  detailsContentEl.innerHTML = `
    <div class="view-wrapper">
      <div id="tableWrapper" style="${mapMode ? 'display:none;' : 'display:block;'}">
        <table class="details-table">
          <thead>
            ${header}
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      <div id="mapWrapper" class="${mapMode ? 'active' : ''}">
        <div id="map"></div>
      </div>
    </div>
  `;

  // IP-Tooltip-Events binden
  attachIpTooltipEvents();

  // Karte ggf. rendern
  if (mapMode) {
    renderMap();
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function colorForKey(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  const h = Math.abs(hash) % 360;
  const s = 55;
  const l = 32;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// --- MAP-LOGIK ---

function buildLocationAggregates(ips) {
  const bucket = new Map();

  ips.forEach(entry => {
    if (entry.is_home || entry.country === "HOME") return;
    if (entry.latitude == null || entry.longitude == null) return;

    const lat = parseFloat(entry.latitude);
    const lon = parseFloat(entry.longitude);
    if (!isFinite(lat) || !isFinite(lon)) return;

    const key = `${lat},${lon}`;
    const label = buildLocationString(entry);

    const existing = bucket.get(key) || { lat, lon, label, count: 0 };
    existing.count += 1;
    bucket.set(key, existing);
  });

  return Array.from(bucket.values());
}

function renderMap() {
  const mapWrapper = document.getElementById("mapWrapper");
  const mapDiv = document.getElementById("map");
  if (!mapWrapper || !mapDiv) return;

  // Leaflet nicht geladen?
  if (typeof L === "undefined") {
    console.warn("Leaflet (L) ist nicht definiert. Karte nicht verfügbar.");
    mapDiv.innerHTML = "<p style='padding:8px;'>Leaflet JS nicht geladen – Karte ist nicht verfügbar.</p>";
    return;
  }

  const locs = buildLocationAggregates(currentIpsForMap);

  if (!leafletMap) {
    leafletMap = L.map("map").setView([20, 0], 2);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(leafletMap);
  }

  if (markerLayer) {
    markerLayer.remove();
  }
  markerLayer = L.layerGroup().addTo(leafletMap);

  if (!locs.length) {
    leafletMap.setView([20, 0], 2);
    leafletMap.invalidateSize();
    return;
  }

  const bounds = [];

  locs.forEach(loc => {
    const radius = 5 + Math.min(loc.count, 20);
    const marker = L.circleMarker([loc.lat, loc.lon], {
      radius,
      stroke: false,
      fillOpacity: 0.8
    }).addTo(markerLayer);

    marker.bindPopup(`${loc.label} (${loc.count})`);
    bounds.push([loc.lat, loc.lon]);
  });

  const boundsObj = L.latLngBounds(bounds);
  leafletMap.fitBounds(boundsObj.pad(0.3));
  leafletMap.invalidateSize();
}

// --- IP-TOOLTIP ---

function ensureIpTooltip() {
  if (ipTooltip) return ipTooltip;
  ipTooltip = document.createElement("div");
  ipTooltip.style.position = "fixed";
  ipTooltip.style.zIndex = "9999";
  ipTooltip.style.background = "#05070f";
  ipTooltip.style.color = "#f5f7ff";
  ipTooltip.style.border = "1px solid #2a3242";
  ipTooltip.style.borderRadius = "10px";
  ipTooltip.style.padding = "6px 8px";
  ipTooltip.style.fontSize = "0.78rem";
  ipTooltip.style.boxShadow = "0 10px 24px rgba(0,0,0,0.6)";
  ipTooltip.style.pointerEvents = "none";
  ipTooltip.style.display = "none";
  document.body.appendChild(ipTooltip);
  return ipTooltip;
}

function showIpTooltip(target, evt) {
  const el = ensureIpTooltip();
  const ip = target.getAttribute("data-ip") || "";
  const loc = target.getAttribute("data-location") || "";
  const country = target.getAttribute("data-country") || "";
  const city = target.getAttribute("data-city") || "";
  const region = target.getAttribute("data-region") || "";
  const tz = target.getAttribute("data-timezone") || "";
  const isp = target.getAttribute("data-isp") || "";

  const locationLine = [city, region, country].filter(Boolean).join(", ");

  el.innerHTML = `
    <div><strong>${escapeHtml(ip)}</strong></div>
    <div>${escapeHtml(loc)}</div>
    ${locationLine ? `<div>${escapeHtml(locationLine)}</div>` : ""}
    ${isp ? `<div>ISP: ${escapeHtml(isp)}</div>` : ""}
    ${tz ? `<div>Timezone: ${escapeHtml(tz)}</div>` : ""}
  `;

  const x = evt.clientX + 12;
  const y = evt.clientY + 12;
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.style.display = "block";
}

function hideIpTooltip() {
  if (!ipTooltip) return;
  ipTooltip.style.display = "none";
}

function attachIpTooltipEvents() {
  const ipCells = detailsContentEl.querySelectorAll(".ip-cell");
  ipCells.forEach(cell => {
    cell.addEventListener("mouseenter", evt => showIpTooltip(cell, evt));
    cell.addEventListener("mousemove", evt => showIpTooltip(cell, evt));
    cell.addEventListener("mouseleave", hideIpTooltip);
  });
}

// --- Events ---

userSearchEl.addEventListener("input", () => {
  renderUsersList();
});

reloadBtn.addEventListener("click", () => {
  const selectedUser = allUsers.find(u => u.user_id === activeUserId);
  if (selectedUser) {
    loadUserIPs(selectedUser);
  }
});

colorToggleBtn.addEventListener("click", () => {
  colorMode = !colorMode;
  colorToggleBtn.textContent = colorMode ? "Farben aus" : "Farben an";

  const selectedUser = allUsers.find(u => u.user_id === activeUserId);
  if (selectedUser) {
    loadUserIPs(selectedUser);
  }
});

viewToggleBtn.addEventListener("click", () => {
  mapMode = !mapMode;
  viewToggleBtn.textContent = mapMode ? "Tabelle" : "Karte";

  const selectedUser = allUsers.find(u => u.user_id === activeUserId);
  if (selectedUser) {
    loadUserIPs(selectedUser);
  }
});

// Init
colorToggleBtn.textContent = colorMode ? "Farben aus" : "Farben an";
viewToggleBtn.textContent = mapMode ? "Tabelle" : "Karte";

loadUsers();