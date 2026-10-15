const $ = (id) => document.getElementById(id);
const audio = new Audio();
audio.preload = "metadata";
const el = (t, c, x) => {
  const e = document.createElement(t);
  if (c) e.className = c;
  if (x != null) e.textContent = x;
  return e;
};
const XI =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>',
  PAUSE =
    '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
const SPK = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9z"/>',
  VON =
    SPK +
    '<path d="M15 8.5a5 5 0 010 7M17.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  VOFF =
    SPK +
    '<path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const isAudio = (f) =>
  (f.type || "").startsWith("audio/") ||
  /\.(mp3|wav|flac|m4a|aac|ogg|opus|aiff?)$/i.test(f.name);
const fmt = (s) =>
  isFinite(s)
    ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0")
    : "0:00";
const mb = (b) =>
  b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : (b / 1e6).toFixed(1) + " MB";
const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
let db,
  tracks = [],
  folders = [],
  view = "all",
  cur = null,
  url = null,
  sel = new Set(),
  last = -1,
  tt;

function toast(m) {
  const t = $("toast");
  t.textContent = m;
  t.classList.add("on");
  clearTimeout(tt);
  tt = setTimeout(() => t.classList.remove("on"), 2200);
}
const done = (t) =>
  new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = t.onabort = () => rej(t.error);
  });
const put = (s, v, k) => {
  const t = db.transaction(s, "readwrite");
  t.objectStore(s).put(v, k);
  return done(t);
};
const all = (s) =>
  new Promise((r) => {
    const q = db.transaction(s).objectStore(s).getAll();
    q.onsuccess = () => r(q.result);
    q.onerror = () => r([]);
  });
function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("slib", 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      ["meta", "folders"].forEach((n) => {
        if (!d.objectStoreNames.contains(n))
          d.createObjectStore(n, { keyPath: "id" });
      });
      if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function ensureFolder(name) {
  let f = folders.find((x) => x.name === name);
  if (!f) {
    f = { id: uid(), name, images: [], cover: 0, created: Date.now() };
    await put("folders", f);
    folders.push(f);
  }
  return f;
}
async function load() {
  try {
    db = await open();
    folders = await all("folders");
    tracks = await all("meta");
    for (const f of folders)
      if (f.image && !f.images) {
        f.images = [f.image];
        f.cover = 0;
        delete f.image;
        await put("folders", f);
      }
    for (const t of tracks)
      if (t.folder === undefined) {
        t.folder =
          t.project && t.project !== "Unsorted"
            ? (await ensureFolder(t.project)).id
            : null;
        await put("meta", t);
      }
  } catch (e) {
    $("usage").textContent =
      "Storage unavailable here; files will not persist.";
  }
  folders.sort((a, b) => a.created - b.created);
  tracks.sort((a, b) => a.added - b.added);
  render();
  usage();
}
async function usage() {
  try {
    const e = await navigator.storage.estimate();
    $("usage").textContent =
      tracks.length +
      " tracks, " +
      mb(tracks.reduce((s, t) => s + t.size, 0)) +
      " stored locally. Browser quota: " +
      mb(e.quota);
    if (navigator.storage.persist) navigator.storage.persist();
  } catch (e) {}
}
const fold = () => folders.find((f) => f.id === view);
const coverOf = (f) => (f.images && f.images[f.cover || 0]) || null;
const shown = () =>
  tracks.filter(
    (t) =>
      view === "all" ||
      (view === "none" ? t.folder === null : t.folder === view),
  );

async function add(items, target) {
  if (!db) {
    toast("Browser storage is not available here");
    return;
  }
  let n = 0;
  const ok = items.filter((i) => isAudio(i.file));
  for (const { file, dir } of ok) {
    const folder = dir ? (await ensureFolder(dir)).id : target;
    const m = {
      id: uid(),
      name: file.name.replace(/\.[^.]+$/, ""),
      folder,
      size: file.size,
      added: Date.now(),
    };
    try {
      const t = db.transaction(["meta", "blobs"], "readwrite");
      t.objectStore("meta").put(m);
      t.objectStore("blobs").put(file, m.id);
      await done(t);
      tracks.push(m);
      n++;
      render();
    } catch (e) {
      toast("Could not store " + file.name + " (disk quota may be full)");
      break;
    }
  }
  const sk = items.length - ok.length;
  if (n)
    toast(
      "Added " +
        n +
        " file" +
        (n > 1 ? "s" : "") +
        (sk ? ", " + sk + " skipped (not audio)" : ""),
    );
  else if (sk) toast(sk + " file(s) skipped: only audio files are supported");
  usage();
}
async function walk(en, dir, out) {
  if (en.isFile) {
    const f = await new Promise((r) => en.file(r, () => r(null)));
    if (f) out.push({ file: f, dir });
  } else if (en.isDirectory) {
    const rd = en.createReader();
    for (;;) {
      const es = await new Promise((r) => rd.readEntries(r, () => r([])));
      if (!es.length) break;
      for (const e of es) await walk(e, dir, out);
    }
  }
}
async function remove(ids) {
  const rows = ids
    .map((id) => $("list").querySelector('[data-id="' + id + '"]'))
    .filter(Boolean);
  rows.forEach((r, i) => setTimeout(() => r.classList.add("rm"), i * 80));
  await new Promise((r) =>
    setTimeout(r, (rows.length ? (rows.length - 1) * 80 : 0) + 800),
  );
  const t = db.transaction(["meta", "blobs"], "readwrite");
  ids.forEach((id) => {
    t.objectStore("meta").delete(id);
    t.objectStore("blobs").delete(id);
  });
  try {
    await done(t);
  } catch (e) {
    toast("Could not remove files");
    render();
    return;
  }
  tracks = tracks.filter((x) => !ids.includes(x.id));
  ids.forEach((id) => sel.delete(id));
  if (ids.includes(cur)) {
    audio.pause();
    audio.removeAttribute("src");
    setCur(null);
  }
  render();
  usage();
  toast("Removed " + ids.length + " file" + (ids.length > 1 ? "s" : ""));
}
async function move(ids, target) {
  for (const id of ids) {
    const t = tracks.find((x) => x.id === id);
    if (t) {
      t.folder = target;
      await put("meta", t);
    }
  }
  sel.clear();
  render();
  toast("Moved " + ids.length + " file" + (ids.length > 1 ? "s" : ""));
}
async function newFolder() {
  const f = {
    id: uid(),
    name: "New Folder",
    images: [],
    cover: 0,
    created: Date.now(),
  };
  await put("folders", f);
  folders.push(f);
  view = f.id;
  sel.clear();
  render();
  const i = document.querySelector(".fname");
  if (i) {
    i.focus();
    i.select();
  }
}
async function delFolder(id) {
  for (const t of tracks)
    if (t.folder === id) {
      t.folder = null;
      await put("meta", t);
    }
  const tx = db.transaction("folders", "readwrite");
  tx.objectStore("folders").delete(id);
  await done(tx);
  folders = folders.filter((f) => f.id !== id);
  if (view === id) view = "all";
  render();
  toast("Folder deleted, files moved to Unsorted");
}
function shrink(file) {
  return new Promise((res) => {
    const u = URL.createObjectURL(file),
      i = new Image();
    i.onload = () => {
      const s = Math.min(1, 480 / Math.max(i.width, i.height)),
        c = document.createElement("canvas");
      c.width = i.width * s;
      c.height = i.height * s;
      c.getContext("2d").drawImage(i, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      res(c.toDataURL("image/jpeg", 0.85));
    };
    i.onerror = () => res(null);
    i.src = u;
  });
}

async function dropOn(e, target) {
  e.preventDefault();
  e.stopPropagation();
  console.log("dropOn fired", e.dataTransfer?.types);
  console.log("Database ready:", !!db);
  const dt = e.dataTransfer;
  if (dt.types.includes("text/x-tracks")) {
    move(JSON.parse(dt.getData("text/x-tracks")), target);
    return;
  }
  const ents = [...(dt.items || [])].map(
      (i) => i.webkitGetAsEntry && i.webkitGetAsEntry(),
    ),
    out = [];
  if (ents.some(Boolean)) {
    for (const en of ents)
      if (en) await walk(en, en.isDirectory ? en.name : null, out);
  } else [...dt.files].forEach((f) => out.push({ file: f, dir: null }));
  add(out, target);
}
function render() {
  const side = $("side");
  side.textContent = "";
  [
    { id: "all", name: "All Files" },
    { id: "none", name: "Unsorted" },
    ...folders,
  ].forEach((f) => {
    const real = f.created !== undefined,
      d = el("div", "fi" + (f.id === view ? " on" : ""));
    d.tabIndex = 0;
    const img = real ? coverOf(f) : null;
    const th = el(
      "div",
      "th",
      real && !img ? f.name.slice(0, 1).toUpperCase() : "",
    );
    if (img) th.style.backgroundImage = "url(" + img + ")";
    if (real) d.appendChild(th);
    const c = tracks.filter(
      (t) =>
        f.id === "all" ||
        (f.id === "none" ? t.folder === null : t.folder === f.id),
    ).length;
    d.append(el("span", "nm", f.name), el("span", "mut", c));
    if (real) {
      const x = el("button", "fx");
      x.innerHTML = XI;
      x.title = "Delete folder";
      x.setAttribute("aria-label", "Delete folder " + f.name);
      x.onclick = (e) => {
        e.stopPropagation();
        delFolder(f.id);
      };
      d.appendChild(x);
    }
    const go = () => {
      view = f.id;
      sel.clear();
      render();
    };
    d.onclick = go;
    d.onkeydown = (e) => {
      if (e.target === d && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        go();
      }
    };
    if (f.id === view) d.setAttribute("aria-current", "true");
    if (f.id !== "all") {
      d.ondragover = (e) => {
        e.preventDefault();
        d.classList.add("dov");
      };
      d.ondragover = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        d.classList.add("dov");
      };
      d.ondragleave = () => d.classList.remove("dov");
      d.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        d.classList.remove("dov");
        dropOn(e, f.id === "none" ? null : f.id);
      };
    }
    side.appendChild(d);
  });
  const h = $("head");
  h.textContent = "";
  const f = fold();
  if (f) {
    const w = el("div", "hd"),
      imgs = f.images || [],
      ci = Math.min(f.cover || 0, Math.max(imgs.length - 1, 0)),
      wrap = el("div", "coverwrap"),
      cv = el(
        "button",
        "cover" + (imgs.length ? " has" : ""),
        imgs.length ? "" : "Add image",
      );
    if (imgs.length) cv.style.backgroundImage = "url(" + imgs[ci] + ")";
    cv.type = "button";
    cv.title =
      imgs.length > 1 ? "Click for the next image" : "Click to add an image";
    cv.setAttribute(
      "aria-label",
      imgs.length > 1
        ? "Show next image of " + f.name
        : "Add image for " + f.name,
    );
    cv.onclick = () => (imgs.length > 1 ? cycle(f) : $("fimg").click());
    wrap.appendChild(cv);
    if (imgs.length) {
      const a = el("button", "cbadge cadd", "+");
      a.type = "button";
      a.title = "Add more images";
      a.setAttribute("aria-label", "Add more images to " + f.name);
      a.onclick = () => $("fimg").click();
      const r = el("button", "cbadge crm");
      r.type = "button";
      r.innerHTML = XI;
      r.title = "Remove this image";
      r.setAttribute("aria-label", "Remove this image from " + f.name);
      r.onclick = () => removeImage(f, ci);
      wrap.append(a, r);
      if (imgs.length > 1)
        wrap.appendChild(el("span", "ccount", ci + 1 + " / " + imgs.length));
    }
    const i = el("input", "fname");
    i.value = f.name;
    i.maxLength = 60;
    i.setAttribute("aria-label", "Folder name");
    i.onkeydown = (e) => {
      if (e.key === "Enter") i.blur();
      if (e.key === "Escape") {
        i.value = f.name;
        i.blur();
      }
    };
    i.onchange = async () => {
      f.name = i.value.trim() || "Untitled";
      await put("folders", f);
      render();
    };
    w.append(wrap, i);
    h.appendChild(w);
  } else
    h.appendChild(el("h2", null, view === "all" ? "All Files" : "Unsorted"));
  const l = $("list");
  l.textContent = "";
  const list = shown();
  list.forEach((t, idx) => {
    const r = el(
      "div",
      "row" + (t.id === cur ? " cur" : "") + (sel.has(t.id) ? " sel" : ""),
    );
    r.dataset.id = t.id;
    r.draggable = true;
    r.tabIndex = 0;
    r.setAttribute("role", "group");
    r.setAttribute("aria-label", t.name);
    r.onkeydown = (e) => {
      if (e.target !== r) return;
      if (e.key === "Enter") play(t.id);
      if (e.key === " ") {
        e.preventDefault();
        toggle(t.id, idx, false);
      }
    };
    const cb = el("span", "cb");
    cb.tabIndex = 0;
    cb.setAttribute("role", "checkbox");
    cb.setAttribute("aria-checked", String(sel.has(t.id)));
    cb.setAttribute("aria-label", "Select " + t.name);
    cb.onkeydown = (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        toggle(t.id, idx, e.shiftKey);
      }
    };
    cb.onclick = (e) => {
      e.stopPropagation();
      toggle(t.id, idx, e.shiftKey);
    };
    const x = el("button", "x");
    x.innerHTML = XI;
    x.title = "Remove";
    x.setAttribute("aria-label", "Remove " + t.name);
    x.onclick = (e) => {
      e.stopPropagation();
      remove([t.id]);
    };
    r.append(
      cb,
      el("span", "n", t.name),
      el("span", "mut", mb(t.size)),

      x,
    );
    r.onclick = (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) toggle(t.id, idx, e.shiftKey);
      else play(t.id);
    };
    r.ondragstart = (e) => {
      e.dataTransfer.setData(
        "text/x-tracks",
        JSON.stringify(sel.has(t.id) ? [...sel] : [t.id]),
      );
      e.dataTransfer.effectAllowed = "move";
    };
    l.appendChild(r);
  });
  if (!list.length) l.appendChild(el("div", "mut", "Nothing here"));
  renderSel();
}
function toggle(id, idx, shift) {
  const list = shown();
  if (shift && last >= 0) {
    const [a, b] = [Math.min(last, idx), Math.max(last, idx)];
    for (let i = a; i <= b; i++) sel.add(list[i].id);
  } else {
    sel.has(id) ? sel.delete(id) : sel.add(id);
    last = idx;
  }
  render();
}
function renderSel() {
  $("selbar").hidden = !sel.size;
  if (!sel.size) return;
  $("selc").textContent = sel.size + " selected";
  const m = $("moveTo");
  m.textContent = "";
  m.appendChild(new Option("Move to...", ""));
  m.appendChild(new Option("Unsorted", "none"));
  folders.forEach((f) => m.appendChild(new Option(f.name, f.id)));
}
$("moveTo").onchange = (e) => {
  const v = e.target.value;
  if (v) move([...sel], v === "none" ? null : v);
};
$("selAll").onclick = () => {
  shown().forEach((t) => sel.add(t.id));
  render();
};
$("clr").onclick = () => {
  sel.clear();
  render();
};
$("rmSel").onclick = () => remove([...sel]);
$("newF").onclick = newFolder;
$("drop").onclick = () => $("fi").click();
$("fi").onchange = (e) => {
  add(
    [...e.target.files].map((file) => ({ file, dir: null })),
    fold() ? view : null,
  );
  e.target.value = "";
};
$("fimg").onchange = async (e) => {
  const f = fold(),
    files = [...e.target.files];
  e.target.value = "";
  if (!f || !files.length) return;
  f.images = f.images || [];
  let n = 0;
  for (const file of files) {
    const d = await shrink(file);
    if (d) {
      f.images.push(d);
      n++;
    }
  }
  if (n) {
    f.cover = f.images.length - n;
    await put("folders", f);
    render();
  } else toast("Those files could not be read as images");
};
async function cycle(f) {
  f.cover = ((f.cover || 0) + 1) % f.images.length;
  await put("folders", f);
  render();
}
async function removeImage(f, i) {
  f.images.splice(i, 1);
  f.cover = Math.min(i, Math.max(f.images.length - 1, 0));
  await put("folders", f);
  render();
}
const dz = $("drop");

window.addEventListener("dragover", (e) => {
  e.preventDefault();
  dz.classList.add("over");
});

window.addEventListener("drop", async (e) => {
  e.preventDefault();
  dz.classList.remove("over");

  // Don't process a folder drop twice.
  if (e.target.closest?.(".fi")) return;

  const files = Array.from(e.dataTransfer?.files || []);

  console.log(
    "Dropped files:",
    files.map((f) => f.name),
  );

  if (!files.length) {
    console.warn("The browser supplied no files.");
    return;
  }

  if (!db) {
    toast("Library storage is not ready. Reload the page.");
    console.error("IndexedDB is not initialized.");
    return;
  }

  await add(
    files.map((file) => ({ file, dir: null })),
    fold() ? view : null,
  );
});

function setCur(id) {
  cur = id;
  document.body.classList.toggle("playing", !!id);
  if (!id) $("title").textContent = "";
}
async function play(id) {
  const t = tracks.find((x) => x.id === id);
  if (!t) return;
  const blob = await new Promise((r) => {
    const q = db.transaction("blobs").objectStore("blobs").get(id);
    q.onsuccess = () => r(q.result);
    q.onerror = () => r(null);
  });
  if (!blob) return;
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(blob);
  audio.src = url;
  setCur(id);
  $("title").textContent = t.name;
  audio.play();
  render();
}
function step(d) {
  const l = shown();
  if (!l.length) return;
  const i = l.findIndex((t) => t.id === cur);
  play(l[(i + d + l.length) % l.length].id);
}
audio.ontimeupdate = () => {
  $("seek").value = audio.duration
    ? (audio.currentTime / audio.duration) * 1000
    : 0;
  $("cur").textContent = fmt(audio.currentTime);
  $("dur").textContent = fmt(audio.duration);
};
audio.onended = () => step(1);
audio.onerror = () => {
  if (cur)
    toast(
      "This file could not be played. Your browser may not support its format.",
    );
};
audio.onplay = () => {
  $("play").innerHTML = PAUSE;
  $("play").setAttribute("aria-label", "Pause");
};
audio.onpause = () => {
  $("play").innerHTML = PLAY;
  $("play").setAttribute("aria-label", "Play");
};
$("play").innerHTML = PLAY;
$("play").onclick = () => (audio.paused ? audio.play() : audio.pause());
$("prev").onclick = () => step(-1);
$("next").onclick = () => step(1);
$("seek").oninput = (e) => {
  if (audio.duration)
    audio.currentTime = (e.target.value / 1000) * audio.duration;
};
audio.volume = 0.5;
if (audio.volume !== 0.5) document.body.classList.add("novol");
audio.volume = 1;
const vi = () => {
  const m = audio.muted || audio.volume === 0;
  $("mute").innerHTML = m ? VOFF : VON;
  $("mute").setAttribute("aria-label", m ? "Unmute" : "Mute");
};
$("vol").oninput = (e) => {
  audio.volume = +e.target.value;
  audio.muted = false;
  vi();
};
$("mute").onclick = () => {
  audio.muted = !audio.muted;
  vi();
};
vi();
$("yr").textContent = new Date().getFullYear();
const L = (t, b) =>
  "<h2>" + t + '</h2><p class="mut">Last updated: October 14, 2026</p>' + b;
const OP = "<p><strong>Dev:</strong> sage2sick@gmail.com</p>";
const PAGES = {
  privacy: [
    "Privacy Policy",
    L(
      "Privacy Policy",
      OP +
        `<h3>Summary</h3><p>This app has no accounts, no server of its own and no tracking. The operator does not collect, receive or sell your personal data.</p>
<h3>What is stored on your device</h3><p>Audio files you add, folder names and folder images are saved in your browser's IndexedDB, on your device only. The app never uploads them. You can remove files and folders inside the app, or clear this site's data in your browser settings.</p>
<h3>Other storage</h3><p>One small setting remembers that you dismissed the notice at the top of the page. See the <a href="#/cookies">Cookie Policy</a>.</p>
<h3>What the app does not use</h3><p>No analytics, advertising, social media plugins, third party scripts, fonts or embeds. The app makes no network requests after it loads.</p>
<h3>Hosting</h3><p>The page is delivered by a hosting provider, which may process technical data such as your IP address and browser details in its own logs. The operator does not control or receive that data. See the hosting provider's privacy policy.</p>
<h3>Your rights</h3><p>Because the operator holds no personal data about you, there is usually nothing to access or erase on our side. Where data protection law such as the GDPR applies, you may have rights of access, rectification, erasure, restriction, portability and objection, and the right to complain to your data protection authority (in Croatia, AZOP).</p>
<h3>Changes</h3><p>Updates will be posted on this page with a new date.</p>`,
    ),
  ],
  terms: [
    "Terms of Service",
    L(
      "Terms of Service and Conditions",
      OP +
        `<h3>Acceptance</h3><p>By using this app you agree to these terms. If you do not agree, please do not use it.</p>
<h3>The service</h3><p>The app is a music library and player that runs in your browser. Your files stay on your device. The app does not upload, host or share them.</p>
<h3>Your files</h3><p>You are responsible for the files you add and must have the right to use them. Do not use the app to store or play material that you are not allowed to have.</p>
<h3>Data loss</h3><p>Browser storage can be cleared by you, your browser or your device, for example when disk space is low. Keep backups of your originals. The operator cannot recover files for you.</p>
<h3>Fees</h3><p>The app is free. There are no hidden fees, subscriptions or in-app purchases.</p>
<h3>Changes and availability</h3><p>The app is provided as is and may change, be interrupted or be withdrawn at any time.</p>
<h3>Warranty and liability</h3><p>To the extent permitted by law, the operator gives no warranty and is not liable for loss of data or other indirect loss arising from use of the app. Nothing in these terms limits liability that cannot be limited by law or affects your mandatory consumer rights.</p>
<h3>Intellectual property</h3><p>The app's code and design belong to the operator. Your files remain yours.</p>
<h3>Governing law</h3><p>These terms are governed by the laws of Croatia , without affecting mandatory consumer protections in your country of residence.</p>
<h3>Contact</h3><p>sage2sick@gmail.com</p>`,
    ),
  ],
  cookies: [
    "Cookie Policy",
    L(
      "Cookie Policy",
      OP +
        `<h3>Cookies</h3><p>This site sets no cookies.</p>
<h3>Browser storage we use</h3><ul><li><strong>IndexedDB "slib":</strong> holds the audio files, folder names and folder images you add. It stays on your device and is needed for the app to work.</li><li><strong>localStorage "slib-notice":</strong> remembers that you dismissed the notice at the top of the page.</li></ul>
<h3>Consent</h3><p>Both items are needed to provide the function you asked for and are not used for tracking or advertising, so they are generally treated as exempt from consent under EU rules. That is why the notice has no accept or reject choice: there is nothing optional to switch off.</p>
<h3>Third parties</h3><p>No third party cookies, trackers or embeds are used.</p>
<h3>Managing storage</h3><p>Delete files and folders inside the app, or clear this site's data in your browser settings. Clearing it removes your whole library.</p>`,
    ),
  ],
};
const NF =
  '<h2>404: Page not found</h2><p>The page you are looking for does not exist or has moved.</p><p><a href="#/">Back to the library</a></p>';
function route(h) {
  if (typeof h !== "string") h = location.hash;
  h = h.replace(/^#\/?/, "");
  const app = $("app"),
    pg = $("page");
  if (h === "") {
    app.hidden = false;
    pg.hidden = true;
    document.title = "slib.";
    return;
  }
  const p = Object.hasOwn(PAGES, h) ? PAGES[h] : null;
  app.hidden = true;
  pg.hidden = false;
  pg.innerHTML = p ? p[1] : NF;
  document.title = (p ? p[0] : "Page not found") + " | slib.";
  window.scrollTo(0, 0);
  const t = pg.querySelector("h2");
  t.tabIndex = -1;
  t.focus();
}
window.addEventListener("hashchange", route);
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  const hr = a.getAttribute("href");
  try {
    location.hash = hr;
  } catch (x) {}
  route(hr);
});
try {
  if (!localStorage.getItem("slib-notice")) $("notice").hidden = false;
} catch (e) {
  $("notice").hidden = false;
}
$("noticeOk").onclick = () => {
  try {
    localStorage.setItem("slib-notice", "1");
  } catch (e) {}
  $("notice").hidden = true;
};
route();
load()
  .then(() => {
    console.log("Library initialized. Database ready:", !!db);
  })
  .catch((err) => {
    console.error("Library initialization failed:", err);
  });
