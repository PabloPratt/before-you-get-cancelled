// Before You Get Cancelled: scans your own X archive locally in the browser.
// Nothing is uploaded anywhere. "Mark deleted" state is kept in localStorage.

const state = {
  items: [],
  handle: "",
  profileFindings: [],
  filter: { cat: "all", kind: "all", year: "all", q: "", sort: "risk", hideDone: false, flaggedOnly: true },
  selected: new Set(),
  done: loadDone(),
  shown: 50,
};

const $ = (s) => document.querySelector(s);
const CAT_BY_ID = Object.fromEntries(RISK_CATEGORIES.map((c) => [c.id, c]));
const PII_BY_ID = Object.fromEntries(PII_CATEGORIES.map((c) => [c.id, c]));

function loadDone() {
  try { return new Set(JSON.parse(localStorage.getItem("bygc-done") || "[]")); } catch { return new Set(); }
}
function saveDone() {
  try { localStorage.setItem("bygc-done", JSON.stringify([...state.done])); } catch {}
}

// ---------- parsing ----------

function parseYTD(src) {
  const i = src.indexOf("=");
  return JSON.parse(src.slice(i + 1).trim().replace(/;$/, ""));
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parseTwitterDate(s) {
  if (!s) return null;
  // "Wed Oct 10 20:19:24 +0000 2018"
  const p = s.split(" ");
  if (p.length === 6 && p[1] in MONTHS) {
    const [h, m, sec] = p[3].split(":").map(Number);
    return new Date(Date.UTC(+p[5], MONTHS[p[1]], +p[2], h, m, sec));
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function decodeEntities(s) {
  return (s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function scanText(text, cats) {
  const hits = [];
  for (const cat of cats) {
    const matches = [];
    for (const re of cat.patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (!m[0]) { re.lastIndex++; continue; }
        matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
        if (!re.global) break;
      }
    }
    if (matches.length) hits.push({ cat: cat.id, matches });
  }
  return hits;
}

function makeItem({ id, kind, text, date, likes = 0, rts = 0, replyTo = "", geo = false }) {
  id = String(id || "").replace(/[^\w-]/g, "");
  text = decodeEntities(text);
  const risk = scanText(text, RISK_CATEGORIES);
  const pii = scanText(text, PII_CATEGORIES);
  if (geo) pii.push({ cat: "geotag", matches: [] });
  let score = 0;
  for (const h of risk) score += CAT_BY_ID[h.cat].weight * (1 + 0.25 * (Math.min(h.matches.length, 5) - 1));
  if (pii.length) score += 3 * pii.length;
  // Replies that @ someone while insulting them hit harder.
  if (replyTo && risk.some((h) => h.cat === "harassment")) score += 3;
  return { id, kind, text, date, likes, rts, replyTo, geo, risk, pii, score: Math.round(score * 10) / 10 };
}

function tweetToItem(t) {
  t = t.tweet || t;
  const text = t.full_text || t.text || "";
  let kind = "post";
  if (/^RT @/.test(text)) kind = "retweet";
  else if (t.in_reply_to_status_id_str || t.in_reply_to_screen_name) kind = "reply";
  return makeItem({
    id: t.id_str || t.id,
    kind,
    text,
    date: parseTwitterDate(t.created_at),
    likes: +t.favorite_count || 0,
    rts: +t.retweet_count || 0,
    replyTo: t.in_reply_to_screen_name || "",
    geo: !!(t.coordinates || t.geo || (t.place && t.place.full_name)),
  });
}

function likeToItem(l) {
  l = l.like || l;
  return makeItem({ id: l.tweetId, kind: "like", text: l.fullText || "", date: null });
}

async function loadArchive(file) {
  setStatus(`Reading ${file.name}…`);
  const items = [];
  let handle = "";
  let profileText = "";

  if (/\.zip$/i.test(file.name)) {
    const zip = await JSZip.loadAsync(file);
    const names = Object.keys(zip.files);
    const pick = (re) => names.filter((n) => re.test(n));
    const tweetFiles = pick(/(?:^|\/)data\/tweets?(?:-part\d+)?\.js$/i);
    const likeFiles = pick(/(?:^|\/)data\/like(?:-part\d+)?\.js$/i);
    if (!tweetFiles.length) throw new Error("Couldn't find data/tweets.js in that zip. Make sure it's the X archive you downloaded.");
    for (const n of tweetFiles) {
      setStatus(`Scanning ${n.split("/").pop()}…`);
      for (const t of parseYTD(await zip.files[n].async("string"))) items.push(tweetToItem(t));
    }
    for (const n of likeFiles) for (const l of parseYTD(await zip.files[n].async("string"))) items.push(likeToItem(l));
    const acct = pick(/(?:^|\/)data\/account\.js$/i)[0];
    if (acct) {
      try { handle = parseYTD(await zip.files[acct].async("string"))[0].account.username; } catch {}
    }
    const prof = pick(/(?:^|\/)data\/profile\.js$/i)[0];
    if (prof) {
      try {
        const d = parseYTD(await zip.files[prof].async("string"))[0].profile.description;
        profileText = [d.bio, d.location, d.website].filter(Boolean).join(" · ");
      } catch {}
    }
  } else {
    // A single tweets.js / like.js file.
    const data = parseYTD(await file.text());
    for (const x of data) items.push(x.like ? likeToItem(x) : tweetToItem(x));
  }

  state.handle = String(handle || "").replace(/[^\w]/g, "");
  state.profileFindings = profileText ? scanText(profileText, PII_CATEGORIES).map((h) => ({ ...h, text: profileText })) : [];
  state.profileText = profileText;
  setItems(items);
}

function setItems(items) {
  state.items = items;
  state.selected.clear();
  state.shown = 50;
  state.filter.cat = "all";
  state.filter.year = "all";
  $("#landing").hidden = true;
  $("#results").hidden = false;
  setStatus("");
  render();
  window.scrollTo({ top: 0 });
}

// ---------- rendering ----------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function highlight(item) {
  const ranges = [];
  for (const h of item.risk) for (const m of h.matches) ranges.push({ ...m, cls: "hl-risk", title: CAT_BY_ID[h.cat].label });
  for (const h of item.pii) for (const m of h.matches) ranges.push({ ...m, cls: "hl-pii", title: (PII_BY_ID[h.cat] || {}).label || "Personal info" });
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  let out = "";
  let pos = 0;
  for (const r of ranges) {
    if (r.start < pos) continue;
    out += escapeHtml(item.text.slice(pos, r.start));
    out += `<mark class="${r.cls}" title="${escapeHtml(r.title)}">${escapeHtml(item.text.slice(r.start, r.end))}</mark>`;
    pos = r.end;
  }
  return out + escapeHtml(item.text.slice(pos));
}

function itemUrl(item) {
  if (item.kind === "like") return `https://x.com/i/web/status/${item.id}`;
  return state.handle ? `https://x.com/${state.handle}/status/${item.id}` : `https://x.com/i/web/status/${item.id}`;
}

function isFlagged(i) {
  return i.risk.length > 0 || i.pii.length > 0;
}

function filtered() {
  const f = state.filter;
  const q = f.q.trim().toLowerCase();
  let list = state.items.filter((i) => {
    if (f.flaggedOnly && !isFlagged(i)) return false;
    if (f.hideDone && state.done.has(i.id)) return false;
    if (f.kind !== "all" && i.kind !== f.kind) return false;
    if (f.year !== "all" && (!i.date || String(i.date.getUTCFullYear()) !== f.year)) return false;
    if (f.cat === "pii" && !i.pii.length) return false;
    if (f.cat !== "all" && f.cat !== "pii" && !i.risk.some((h) => h.cat === f.cat)) return false;
    if (q && !i.text.toLowerCase().includes(q)) return false;
    return true;
  });
  const byDate = (a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0);
  if (f.sort === "risk") list.sort((a, b) => b.score - a.score || byDate(a, b));
  else if (f.sort === "newest") list.sort(byDate);
  else if (f.sort === "oldest") list.sort((a, b) => -byDate(a, b));
  else if (f.sort === "popular") list.sort((a, b) => b.likes + b.rts - (a.likes + a.rts));
  return list;
}

function accountScore() {
  const remaining = state.items.filter((i) => !state.done.has(i.id));
  const total = remaining.reduce((s, i) => s + i.score, 0);
  return Math.round(100 * (1 - Math.exp(-total / 40)));
}

function scoreLabel(s) {
  if (s < 10) return ["Squeaky clean", "ok"];
  if (s < 30) return ["Mostly safe", "ok"];
  if (s < 60) return ["Some cleanup needed", "warn"];
  if (s < 85) return ["Risky", "bad"];
  return ["Cancel-ready", "bad"];
}

function render() {
  const items = state.items;
  const flagged = items.filter(isFlagged);
  const remainingFlagged = flagged.filter((i) => !state.done.has(i.id));
  const score = accountScore();
  const [label, tone] = scoreLabel(score);

  $("#who").textContent = state.handle ? `@${state.handle}` : "Your archive";
  $("#gauge").style.setProperty("--p", score);
  $("#gauge").dataset.tone = tone;
  $("#score-num").textContent = score;
  $("#score-label").textContent = label;
  $("#stat-total").textContent = items.length.toLocaleString();
  $("#stat-flagged").textContent = flagged.length.toLocaleString();
  $("#stat-left").textContent = remainingFlagged.length.toLocaleString();
  $("#stat-pii").textContent = items.filter((i) => i.pii.length).length.toLocaleString();

  // Category bars
  const counts = RISK_CATEGORIES.map((c) => ({ c, n: items.filter((i) => i.risk.some((h) => h.cat === c.id)).length }));
  const piiCount = items.filter((i) => i.pii.length).length;
  const max = Math.max(1, piiCount, ...counts.map((x) => x.n));
  const bar = (id, label, n, hint, cls = "") => `
    <button class="cat ${state.filter.cat === id ? "active" : ""} ${n ? "" : "empty"} ${cls}" data-cat="${id}" title="${escapeHtml(hint)}">
      <span class="cat-label">${label}</span>
      <span class="cat-track"><span class="cat-fill" style="width:${(n / max) * 100}%"></span></span>
      <span class="cat-n">${n}</span>
    </button>`;
  $("#cats").innerHTML =
    bar("all", "Everything flagged", flagged.length, "Show all flagged posts", "all") +
    counts.map(({ c, n }) => bar(c.id, c.label, n, c.hint, "w" + Math.min(c.weight, 10))).join("") +
    bar("pii", "Personal info", piiCount, "Posts that reveal personal details about you", "pii");

  // Profile findings
  const pf = $("#profile-findings");
  if (state.profileFindings.length) {
    pf.hidden = false;
    pf.innerHTML = `<strong>Your bio/profile reveals:</strong> ${state.profileFindings.map((h) => escapeHtml(PII_BY_ID[h.cat].label)).join(", ")}<div class="muted">“${escapeHtml(state.profileText)}”</div>`;
  } else pf.hidden = true;

  // Year filter options
  const years = [...new Set(items.filter((i) => i.date).map((i) => i.date.getUTCFullYear()))].sort((a, b) => b - a);
  const ysel = $("#f-year");
  ysel.innerHTML = `<option value="all">All years</option>` + years.map((y) => `<option ${state.filter.year == y ? "selected" : ""}>${y}</option>`).join("");

  renderList();
}

function renderList() {
  const list = filtered();
  const shown = list.slice(0, state.shown);
  $("#count").textContent = `${list.length.toLocaleString()} ${list.length === 1 ? "post" : "posts"}`;
  $("#sel-count").textContent = state.selected.size ? `${state.selected.size} selected` : "";
  $("#list").innerHTML = shown.length
    ? shown.map(card).join("")
    : `<div class="empty-state">Nothing here. ${state.filter.flaggedOnly ? "No flagged posts match these filters." : "No posts match."}</div>`;
  $("#more").hidden = list.length <= state.shown;
  $("#more").textContent = `Show more (${(list.length - state.shown).toLocaleString()} left)`;
}

const KIND_LABEL = { post: "Post", reply: "Reply", retweet: "Repost", like: "Like" };
const ACTION_LABEL = { post: "Delete on X", reply: "Delete on X", retweet: "Undo repost on X", like: "Unlike on X" };

function card(i) {
  const done = state.done.has(i.id);
  const sev = i.score >= 10 ? "high" : i.score >= 4 ? "med" : i.score > 0 ? "low" : "none";
  const chips = [
    ...i.risk.map((h) => `<span class="chip sev-${CAT_BY_ID[h.cat].weight >= 5 ? "high" : CAT_BY_ID[h.cat].weight >= 2 ? "med" : "low"}">${CAT_BY_ID[h.cat].label}</span>`),
    ...i.pii.map((h) => `<span class="chip pii">${h.cat === "geotag" ? "Location tag" : PII_BY_ID[h.cat].label}</span>`),
  ].join("");
  const date = i.date ? i.date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  const meta = [KIND_LABEL[i.kind], i.replyTo ? `to @${escapeHtml(i.replyTo)}` : "", date, i.kind !== "like" && (i.likes || i.rts) ? `♥ ${i.likes} · ⟲ ${i.rts}` : ""].filter(Boolean).join(" · ");
  return `
  <article class="card ${done ? "done" : ""}" data-id="${i.id}">
    <label class="pick"><input type="checkbox" data-pick="${i.id}" ${state.selected.has(i.id) ? "checked" : ""} aria-label="Select post"></label>
    <div class="body">
      <div class="meta"><span class="score sev-${sev}" title="Risk points">${i.score}</span>${meta}</div>
      <p class="text">${highlight(i)}</p>
      <div class="chips">${chips}</div>
      <div class="actions">
        <a class="btn small" href="${itemUrl(i)}" target="_blank" rel="noopener" data-open="${i.id}">${ACTION_LABEL[i.kind]} ↗</a>
        <button class="btn small ghost" data-done="${i.id}">${done ? "Undo" : "Mark as removed"}</button>
      </div>
    </div>
  </article>`;
}

function setStatus(msg, isError) {
  const el = $("#status");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
}

// ---------- export ----------

function exportCsv() {
  const ids = state.selected.size ? state.selected : new Set(filtered().map((i) => i.id));
  const rows = [["id", "type", "date", "risk_points", "categories", "url", "text"]];
  for (const i of state.items) {
    if (!ids.has(i.id)) continue;
    const cats = [...i.risk.map((h) => CAT_BY_ID[h.cat].label), ...i.pii.map((h) => (h.cat === "geotag" ? "Location tag" : PII_BY_ID[h.cat].label))].join("; ");
    rows.push([i.id, i.kind, i.date ? i.date.toISOString() : "", i.score, cats, itemUrl(i), i.text]);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "before-you-get-cancelled.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- demo ----------

function loadDemo() {
  const raw = [
    ["2014-03-02", "post", "lmao that's so gay bro no homo", 3, 0],
    ["2015-07-19", "reply", "@jake_m you're such an idiot, nobody likes you", 1, 0, "jake_m"],
    ["2016-11-09", "post", "Libtards crying today, I love it. Trump 2016!!", 42, 12],
    ["2017-01-14", "post", "Calling in sick tomorrow cuz I hate my job and my boss is a f*cking clown", 8, 1],
    ["2017-04-20", "post", "happy 420 everyone, high af right now 🌿", 15, 2],
    ["2018-05-12", "post", "Text me 512-555-0142 if u want to come to the party at 1420 Oak Hollow Drive", 2, 0],
    ["2018-09-30", "post", "Just moved to East Austin, I live on the same street as the taco truck lol", 6, 0],
    ["2019-02-08", "post", "She's honestly so ugly and fat, how does she have a bf", 4, 0],
    ["2019-06-15", "post", "All women are crazy, change my mind", 31, 5],
    ["2020-03-25", "post", "covid hoax, the plandemic is fake", 9, 3],
    ["2021-10-02", "post", "Turned 21 today!! So drunk rn", 50, 1],
    ["2022-05-06", "post", "I work at the downtown Starbucks on 6th, come say hi", 12, 0],
    ["2023-08-17", "post", "Great book this week: The Overstory. Highly recommend.", 20, 2],
    ["2024-01-03", "post", "New year, new goals. Running my first half marathon in March!", 33, 1],
    ["2024-12-24", "post", "Merry Christmas from my family to yours", 40, 3],
  ];
  const items = raw.map(([d, kind, text, likes, rts, replyTo], n) =>
    makeItem({ id: "demo" + n, kind, text, date: new Date(d + "T12:00:00Z"), likes, rts, replyTo }));
  items.push(makeItem({ id: "demo-like", kind: "like", text: "kill yourself you worthless loser", date: null }));
  state.handle = "";
  state.profileText = "Austin TX · class of 2019 · venmo @demo-user";
  state.profileFindings = scanText(state.profileText, PII_CATEGORIES);
  setItems(items);
}

// ---------- events ----------

function handleFile(file) {
  if (!file) return;
  loadArchive(file).catch((e) => {
    console.error(e);
    setStatus(e.message || "Couldn't read that file.", true);
  });
}

$("#file").addEventListener("change", (e) => handleFile(e.target.files[0]));
const drop = $("#drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
$("#demo").addEventListener("click", loadDemo);
$("#restart").addEventListener("click", () => {
  state.items = [];
  $("#results").hidden = true;
  $("#landing").hidden = false;
  $("#file").value = "";
});

$("#cats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  state.filter.cat = b.dataset.cat;
  state.shown = 50;
  render();
});

const bindFilter = (sel, key, ev = "change", get = (el) => el.value) =>
  $(sel).addEventListener(ev, (e) => { state.filter[key] = get(e.target); state.shown = 50; renderList(); });
bindFilter("#f-kind", "kind");
bindFilter("#f-year", "year");
bindFilter("#f-sort", "sort");
bindFilter("#f-q", "q", "input");
bindFilter("#f-hide", "hideDone", "change", (el) => el.checked);
bindFilter("#f-flagged", "flaggedOnly", "change", (el) => el.checked);

$("#list").addEventListener("click", (e) => {
  const d = e.target.closest("[data-done]");
  if (d) {
    const id = d.dataset.done;
    state.done.has(id) ? state.done.delete(id) : state.done.add(id);
    saveDone();
    render();
  }
});
$("#list").addEventListener("change", (e) => {
  const p = e.target.closest("[data-pick]");
  if (!p) return;
  p.checked ? state.selected.add(p.dataset.pick) : state.selected.delete(p.dataset.pick);
  $("#sel-count").textContent = state.selected.size ? `${state.selected.size} selected` : "";
});
$("#select-all").addEventListener("click", () => {
  const vis = filtered().slice(0, state.shown);
  const all = vis.every((i) => state.selected.has(i.id));
  vis.forEach((i) => (all ? state.selected.delete(i.id) : state.selected.add(i.id)));
  renderList();
});
$("#mark-selected").addEventListener("click", () => {
  state.selected.forEach((id) => state.done.add(id));
  state.selected.clear();
  saveDone();
  render();
});
$("#export").addEventListener("click", exportCsv);
$("#more").addEventListener("click", () => { state.shown += 50; renderList(); });
