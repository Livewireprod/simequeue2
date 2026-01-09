import React, { useEffect, useMemo, useState } from "react";
import tailwindConfig from "../tailwind.config";

export default function App() {
  const API_BASE = ""; // "" if same-origin or Vite proxy; otherwise "http://<HOST-IP>:9979"

  const [route, setRoute] = useState(() =>
    window.location.pathname.startsWith("/view") ? "view" : "admin"
  );

  
  const [queue, setQueue] = useState([]);
  const [slots, setSlots] = useState([]);
  const [taken, setTaken] = useState(new Set());
  const [settings, setSettings] = useState({});

  
  const [status, setStatus] = useState({ type: "idle", msg: "" });
  const [name, setName] = useState("");
  const [mode, setMode] = useState("auto"); 
  const [manualTime, setManualTime] = useState("");

  // View settings 
  const defaultView = {
    viewAlign: "center", 
    viewJustify: "center", 
    viewSize: "6xl", 
    viewSpacing: "4", 
    viewShowCount: 3,
    viewNamePx: 72, 
    viewFontFamily: "System", 
    viewFontColor: "#ffffff", 
    viewBgImageUrl: "", 
    viewBgOverlay: 0.35, 
  };

  const [viewDraftOpen, setViewDraftOpen] = useState(false);
  const [viewDraft, setViewDraft] = useState(defaultView);

  function getNowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

  function goto(next) {
    setRoute(next);
    const path = next === "view" ? "/view" : "/";
    window.history.pushState({}, "", path);
  }

  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname.startsWith("/view") ? "view" : "admin");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function toast(type, msg) {
    setStatus({ type, msg });
  }

  async function readJSON(path) {
    const res = await fetch(`${API_BASE}${path}`);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Non-JSON response from ${path}: ${text.slice(0, 120)}`);
    }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  async function sendJSON(path, method, bodyObj) {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Non-JSON response from ${path}: ${text.slice(0, 120)}`);
    }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  function mergeViewDraftFromSettings(s) {
    const next = { ...defaultView };
    for (const k of Object.keys(next)) {
      if (s && s[k] !== undefined) next[k] = s[k];
    }
    setViewDraft(next);
  }

  async function refreshAll(silent = false) {
    if (!silent) toast("loading", "Refreshing…");
    try {
      const [q, s, set] = await Promise.all([
        readJSON("/api/queue"),
        readJSON("/api/slots").catch(() => ({ slots: [], taken: [] })),
        readJSON("/api/settings").catch(() => ({ settings: {} })),
      ]);

      setQueue(q.queue || []);
      setSlots(s.slots || []);
      setTaken(new Set(s.taken || []));

      const serverSettings = set.settings || {};
      setSettings(serverSettings);
      mergeViewDraftFromSettings(serverSettings);

      if (!manualTime && (s.slots || []).length) {
        const firstFree = (s.slots || []).find((t) => !(s.taken || []).includes(t));
        if (firstFree) setManualTime(firstFree);
      }

      if (!silent) toast("success", "Up to date");
    } catch (e) {
      if (!silent) toast("error", e.message);
    }
  }

  useEffect(() => {
    refreshAll(route === "view");
  }, [route]);

  useEffect(() => {
    if (route !== "view") return;
    const t = setInterval(() => refreshAll(true), 2000);
    return () => clearInterval(t);
  }, [route]);

  const canSubmit = useMemo(() => {
    if (!name.trim()) return false;
    if (mode === "manual") return Boolean(manualTime);
    return true;
  }, [name, mode, manualTime]);

  async function addPerson(e) {
    e.preventDefault();
    if (!canSubmit) return;

    toast("loading", "Adding…");
    try {
      const payload =
        mode === "manual"
          ? { name: name.trim(), mode: "manual", time: manualTime }
          : { name: name.trim(), mode: "auto", nowMinutes: getNowMinutes() };

      const resp = await sendJSON("/api/queue", "POST", payload);
      setQueue(resp.queue || []);
      setName("");
      toast("success", "Added");
      await refreshAll(true);
    } catch (e2) {
      toast("error", e2.message);
    }
  }

  async function deletePerson(id) {
    toast("loading", "Deleting…");
    try {
      const res = await fetch(`${API_BASE}/api/queue/${encodeURIComponent(id)}`, { method: "DELETE" });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setQueue(data.queue || []);
      toast("success", "Deleted");
      await refreshAll(true);
    } catch (e) {
      toast("error", e.message);
    }
  }

  async function saveViewSettings() {
    toast("loading", "Saving view…");
    try {
      const payload = {
        viewAlign: viewDraft.viewAlign,
        viewJustify: viewDraft.viewJustify,
        viewSize: viewDraft.viewSize,
        viewSpacing: viewDraft.viewSpacing,
        viewShowCount: Number(viewDraft.viewShowCount || 3),
        viewNamePx: Number(viewDraft.viewNamePx || 72),


        viewFontFamily: viewDraft.viewFontFamily,
        viewFontColor: viewDraft.viewFontColor,
        viewBgImageUrl: viewDraft.viewBgImageUrl,
        viewBgOverlay: Number(viewDraft.viewBgOverlay ?? 0.35),
      };

      const resp = await sendJSON("/api/settings", "PUT", payload);
      setSettings(resp.settings || {});
      mergeViewDraftFromSettings(resp.settings || {});
      toast("success", "View saved");
    } catch (e) {
      toast("error", e.message);
    }
  }

  // Load Google Fonts when selected (keeps it simple)
  useEffect(() => {
    const fam = (settings?.viewFontFamily || defaultView.viewFontFamily).toLowerCase();
    const links = [];

    function addFont(href) {
      const el = document.createElement("link");
      el.rel = "stylesheet";
      el.href = href;
      document.head.appendChild(el);
      links.push(el);
    }

    if (fam === "poppins") {
      addFont("https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap");
    } else if (fam === "inter") {
      addFont("https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap");
    }

    return () => {
      for (const el of links) document.head.removeChild(el);
    };
  }, [settings?.viewFontFamily]);

  const viewStyle = useMemo(() => {
    const s = { ...defaultView, ...(settings || {}) };
    const alignMap = { start: "items-start", center: "items-center", end: "items-end" };
    const justifyMap = { start: "justify-start", center: "justify-center", end: "justify-end" };

    const fontFamily =
      s.viewFontFamily === "Poppins"
        ? "Poppins, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
        : s.viewFontFamily === "Inter"
        ? "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
        : "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";

    return {
      align: alignMap[s.viewAlign] || "items-center",
      justify: justifyMap[s.viewJustify] || "justify-center",
      size: `text-${s.viewSize}`,
      spacing: `space-y-${s.viewSpacing}`,
      showCount: Number(s.viewShowCount || 3),
      fontFamily,
      fontColor: s.viewFontColor || "#ffffff",
      bgImageUrl: s.viewBgImageUrl || "",
      overlay: Math.max(0, Math.min(0.85, Number(s.viewBgOverlay ?? 0.35))),
    };
  }, [settings]);

  const statusPill = (() => {
    const base = "text-xs px-2 py-1 rounded-full border";
    if (status.type === "loading") return <span className={`${base} border-slate-200 bg-slate-50 text-slate-700`}>{status.msg}</span>;
    if (status.type === "success") return <span className={`${base} border-emerald-200 bg-emerald-50 text-emerald-700`}>{status.msg}</span>;
    if (status.type === "error") return <span className={`${base} border-rose-200 bg-rose-50 text-rose-700`}>{status.msg}</span>;
    return <span className={`${base} border-slate-200 bg-white text-slate-500`}>Idle</span>;
  })();

  async function uploadBackground(file) {
    toast("loading", "Uploading…");
    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(`${API_BASE}/api/upload/background`, {
        method: "POST",
        body: fd,
      });

      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`);

      const url = data.url;
      setViewDraft((p) => ({ ...p, viewBgImageUrl: url }));
      await sendJSON("/api/settings", "PUT", { viewBgImageUrl: url });
      await refreshAll(true);

      toast("success", "Uploaded");
    } catch (e) {
      toast("error", e.message);
    }
  }

  
  // VIEW SCREEN
 
  if (route === "view") {
    const top = queue.slice(0, viewStyle.showCount);
    const restCount = Math.max(0, queue.length - top.length);

    return (
      <div
        className="min-h-screen w-full"
        style={{
          color: viewStyle.fontColor,
          fontFamily: viewStyle.fontFamily,
          backgroundColor: "blue-400", 
          backgroundImage: viewStyle.bgImageUrl ? `url(${viewStyle.bgImageUrl})` : "none",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: `rgba(0,0,0,${viewStyle.overlay})`,
          }}
        />

        <div className="relative">
        

          <div className={`min-h-screen w-full flex ${viewStyle.align} ${viewStyle.justify} px-10`}>
            <div className="w-full max-w-5xl">
              <div className="mb-8 flex items-end justify-between">
              </div>
              {queue.length === 0 ? (
                <div className="p-10">
                  <div className="text-2xl font-semibold">No bookings yet</div>
                  <div className="mt-2 text-base opacity-70">Add names from the admin screen.</div>
                </div>
              ) : (
                <div className={`flex flex-col ${viewStyle.spacing}`}>
                  {top.map((q, idx) => (
                   
                      <div className="flex items-baseline justify-between gap-6">
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-4">
                            <div className="text-sm font-medium opacity-70">#{idx + 1}</div>
                             <div
                                 className="font-semibold tracking-tight truncate"
                                  style={{ fontSize: settings.viewNamePx || 72 }}> {q.name}
                           </div>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm uppercase tracking-widest opacity-60">Time</div>
                          <div className="text-3xl font-semibold tracking-tight">
                            {q.slot?.time || "--:--"}
                          </div>
                        </div>
                      </div>
                    
                  ))}

                  {restCount > 0 && (
                    <div className="mt-2 text-base opacity-70">+ {restCount} more waiting</div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="absolute bottom-4 right-4 flex items-center gap-2">
          </div>
        </div>
      </div>
    );
  }

  // -------------------------
  // ADMIN SCREEN
  // -------------------------
  return (
    <div className="min-h-screen bg-blue-400 text-slate-900">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Queue Admin</h1>
          </div>
          <div className="flex items-center gap-2">
            {statusPill}
            <button
              onClick={() => refreshAll(false)}
              className="inline-flex items-center border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 active:bg-slate-100"
            >
              Refresh
            </button>
            <button
              onClick={() => goto("view")}
              className="inline-flex items-center bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 active:bg-slate-950"
            >
              Open view
            </button>
          </div>
        </div>

        {/* Add */}
        <div className="mt-6  border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Add to queue</h2>
            <button
              onClick={() => setViewDraftOpen((v) => !v)}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              {viewDraftOpen ? "Hide view settings" : "View settings"}
            </button>
          </div>

          <form onSubmit={addPerson} className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600">Full name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">Slot</label>
                <div className="mt-1 flex  border border-slate-200 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setMode("auto")}
                    className={`flex-1  px-2 py-1.5 text-xs font-medium ${
                      mode === "auto" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("manual")}
                    className={`flex-1  px-2 py-1.5 text-xs font-medium ${
                      mode === "manual" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    Choose
                  </button>
                </div>
              </div>
            </div>

            {mode === "manual" && (
              <div>
                <label className="block text-xs font-medium text-slate-600">Pick a time</label>
                <select
                  value={manualTime}
                  onChange={(e) => setManualTime(e.target.value)}
                  className="mt-1 w-full  border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                >
                  {slots.length === 0 ? (
                    <option value="">No slots available</option>
                  ) : (
                    slots.map((t) => (
                      <option key={t} value={t} disabled={taken.has(t)}>
                        {t} {taken.has(t) ? "— taken" : ""}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}

            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={!canSubmit}
                className={`inline-flex items-center px-4 py-2 text-sm font-medium ${
                  canSubmit
                    ? "bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950"
                    : "bg-slate-200 text-slate-500 cursor-not-allowed"
                }`}
              >
                Add
              </button>
            </div>
          </form>

          {/* View settings panel */}
          {viewDraftOpen && (
            <div className="mt-4  border border-slate-200 bg-slate-50 p-3 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Select
                  label="Font"
                  value={viewDraft.viewFontFamily}
                  onChange={(v) => setViewDraft((p) => ({ ...p, viewFontFamily: v }))}
                  options={[
                    { value: "System", label: "System" },
                    { value: "Poppins", label: "Poppins" },
                    { value: "Inter", label: "Inter" },
                  ]}
                />

                <div>
                  <label className="block text-xs font-medium text-slate-600">Font colour</label>
                  <input
                    type="text"
                    value={viewDraft.viewFontColor}
                    onChange={(e) => setViewDraft((p) => ({ ...p, viewFontColor: e.target.value }))}
                    placeholder="#ffffff"
                    className="mt-1 w-full border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="color"
                      value={isHex(viewDraft.viewFontColor) ? viewDraft.viewFontColor : "#ffffff"}
                      onChange={(e) => setViewDraft((p) => ({ ...p, viewFontColor: e.target.value }))}
                      className="h-8 w-10 border border-slate-200 bg-white"
                    />
                    <div className="text-xs text-slate-500">Use hex (e.g. #ffffff)</div>
                  </div>
                </div>

                <div>
  <label className="block text-xs font-medium text-slate-600">Name size (px)</label>
  <input
    type="number"
    min={24}
    max={200}
    value={viewDraft.viewNamePx}
    onChange={(e) =>
      setViewDraft((p) => ({ ...p, viewNamePx: e.target.value }))
    }
    className="mt-1 w-full border border-slate-200 bg-white px-3 py-2 text-sm"
  />
</div>


                <Select
                  label="Position"
                  value={`${viewDraft.viewAlign}:${viewDraft.viewJustify}`}
                  onChange={(v) => {
                    const [a, j] = v.split(":");
                    setViewDraft((p) => ({ ...p, viewAlign: a, viewJustify: j }));
                  }}
                  options={[
                    { value: "start:start", label: "Top left" },
                    { value: "start:center", label: "Top center" },
                    { value: "center:center", label: "Center" },
                    { value: "end:center", label: "Bottom center" },
                    { value: "end:end", label: "Bottom right" },
                  ]}
                />

                <Select
                  label="Spacing"
                  value={String(viewDraft.viewSpacing)}
                  onChange={(v) => setViewDraft((p) => ({ ...p, viewSpacing: v }))}
                  options={[
                    { value: "2", label: "Tight" },
                    { value: "3", label: "Normal" },
                    { value: "4", label: "Relaxed" },
                    { value: "6", label: "Wide" },
                  ]}
                />

                <div>
                  <label className="block text-xs font-medium text-slate-600">Show count</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={viewDraft.viewShowCount}
                    onChange={(e) => setViewDraft((p) => ({ ...p, viewShowCount: e.target.value }))}
                    className="mt-1 w-full  border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                  />
                </div>
              </div>

              {/* Background image upload */}
              <div className=" border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Background image</div>
                  </div>
                  {viewDraft.viewBgImageUrl ? (
                    <button
                      onClick={async () => {
                        setViewDraft((p) => ({ ...p, viewBgImageUrl: "" }));
                        await sendJSON("/api/settings", "PUT", { viewBgImageUrl: "" });
                        await refreshAll(true);
                        toast("success", "Background cleared");
                      }}
                      className=" border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
                      type="button"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadBackground(file);
                      e.target.value = ""; // allow re-upload same file
                    }}
                    className="block w-full text-sm text-slate-600 file:mr-3 file:border file:border-slate-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-50"
                  />
                </div>

                {viewDraft.viewBgImageUrl ? (
                  <div className="mt-3 text-xs text-slate-500">
                    Current: <span className="font-mono">{viewDraft.viewBgImageUrl}</span>
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-slate-500">No image set (falls back to dark).</div>
                )}

                <div className="mt-3">
                  <label className="block text-xs font-medium text-slate-600">Overlay (readability)</label>
                  <input
                    type="range"
                    min={0}
                    max={0.8}
                    step={0.05}
                    value={viewDraft.viewBgOverlay}
                    onChange={(e) => setViewDraft((p) => ({ ...p, viewBgOverlay: Number(e.target.value) }))}
                    className="mt-2 w-full"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-600">
                  Saved view settings apply to <span className="font-mono">/view</span>.
                </div>
                <button
                  onClick={saveViewSettings}
                  className="inline-flex items-center  border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 active:bg-slate-100"
                  type="button"
                >
                  Save view
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Queue list */}
        <div className="mt-6  border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold">Queue</h2>
            <div className="text-xs text-slate-500">{queue.length} total</div>
          </div>

          {queue.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-600">No one in the queue.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {queue.map((q, idx) => (
                <li key={q.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-500">#{idx + 1}</span>
                      <span className="truncate text-sm font-medium">{q.name}</span>
                      {q.slot?.time && (
                        <span className="inline-flex items-center  border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                          {q.slot.time}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {q.createdAt ? new Date(q.createdAt).toLocaleString() : ""}
                    </div>
                  </div>

                  <button
                    onClick={() => deletePerson(q.id)}
                    className="shrink-0  border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                    type="button"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 text-xs text-slate-500">
          Open the viewing screen at <span className="font-mono">/view</span>.
        </div>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full  border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function isHex(v) {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim());
}
