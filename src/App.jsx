import React, { useEffect, useMemo, useRef, useState } from "react";

export default function App() {
  const API_BASE = ""; 

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
    viewSafeBottomPx: 240,
    viewShowAvailable: true,
    viewFontFamily: "DM Sans",
    viewFontColor: "#ffffff",
    viewBgImageUrl: "",
  };

  const [viewDraftOpen, setViewDraftOpen] = useState(false);
  const [viewDraft, setViewDraft] = useState(defaultView);

  // OSC UI state (admin controls)
  const [oscDraft, setOscDraft] = useState({
    host: "",
    port: 8000,
  });
  const [oscBlackout, setOscBlackout] = useState(false);
  const [oscBrightness, setOscBrightness] = useState(80);
  const lastBrightnessSentRef = useRef(null);

  function getNowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function toMinutes(hhmm) {
    const [h, m] = String(hhmm || "").split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }

  function goto(next) {
    setRoute(next);
    const path = next === "view" ? "/view" : "/";
    window.history.pushState({}, "", path);
  }

  useEffect(() => {
    const onPop = () =>
      setRoute(window.location.pathname.startsWith("/view") ? "view" : "admin");
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

  async function sendOsc(address, args = []) {
    return sendJSON("/api/osc/send", "POST", { address, args });
  }

  function mergeViewDraftFromSettings(s) {
    const next = { ...defaultView };
    for (const k of Object.keys(next)) {
      if (s && s[k] !== undefined) next[k] = s[k];
    }
    setViewDraft(next);
  }

  function mergeOscDraftFromSettings(s) {
    setOscDraft({
      host: (s?.oscHost ?? "").toString(),
      port: Number(s?.oscPort ?? 8000),
    });
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
      mergeOscDraftFromSettings(serverSettings);

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
      const res = await fetch(`${API_BASE}/api/queue/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
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
        viewSafeBottomPx: Number(viewDraft.viewSafeBottomPx || 0),
        viewShowAvailable: Boolean(viewDraft.viewShowAvailable),
        viewFontFamily: viewDraft.viewFontFamily,
        viewFontColor: viewDraft.viewFontColor,
        viewBgImageUrl: viewDraft.viewBgImageUrl,
      };

      const resp = await sendJSON("/api/settings", "PUT", payload);
      setSettings(resp.settings || {});
      mergeViewDraftFromSettings(resp.settings || {});
      toast("success", "View saved");
    } catch (e) {
      toast("error", e.message);
    }
  }

  async function saveOscSettings() {
    toast("loading", "Saving OSC…");
    try {
      const payload = {
        oscHost: (oscDraft.host || "").trim(),
        oscPort: Number(oscDraft.port || 8000),
      };
      const resp = await sendJSON("/api/settings", "PUT", payload);
      setSettings(resp.settings || {});
      mergeOscDraftFromSettings(resp.settings || {});
      toast("success", "OSC saved");
    } catch (e) {
      toast("error", e.message);
    }
  }

  function oscConfigured() {
    const host = (settings?.oscHost || oscDraft.host || "").trim();
    const port = Number(settings?.oscPort || oscDraft.port || 0);
    return Boolean(host) && Number.isFinite(port) && port > 0;
  }

  async function oscPreset(n) {
    if (!oscConfigured()) return toast("error", "Set OSC target first");
    try {
      await sendOsc("/preset", [Number(n)]);
      toast("success", `Preset ${n}`);
    } catch {
      toast("error", "OSC send failed");
    }
  }

  async function oscSetBlackout(next) {
    if (!oscConfigured()) return toast("error", "Set OSC target first");
    try {
      await sendOsc("/blackout", [next ? 1 : 0]);
      setOscBlackout(next);
      toast("success", next ? "Blackout ON" : "Blackout OFF");
    } catch {
      toast("error", "OSC send failed");
    }
  }

  async function oscSendBrightness(value) {
    if (!oscConfigured()) return toast("error", "Set OSC target first");
    const v = Math.max(0, Math.min(100, Number(value)));
    try {
      await sendOsc("/brightness", [v]);
      lastBrightnessSentRef.current = v;
      toast("success", `Brightness ${v}`);
    } catch {
      toast("error", "OSC send failed");
    }
  }

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

  // Load Google Fonts (simple)
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

    if (fam === "dm sans") {
      addFont("https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap");
    } else if (fam === "poppins") {
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
      s.viewFontFamily === "DM Sans"
        ? "\"DM Sans\", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
        : s.viewFontFamily === "Poppins"
        ? "Poppins, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
        : s.viewFontFamily === "Inter"
        ? "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
        : "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";

    const spacingRemMap = {
      0: 0,
      1: 0.25,
      2: 0.5,
      3: 0.75,
      4: 1,
      5: 1.25,
      6: 1.5,
      8: 2,
      10: 2.5,
      12: 3,
      16: 4,
    };
    const spacingKey = Number(s.viewSpacing);
    const spacingRem = Number.isFinite(spacingKey)
      ? spacingRemMap[spacingKey] ?? spacingRemMap[4]
      : spacingRemMap[4];

    return {
      align: alignMap[s.viewAlign] || "items-center",
      justify: justifyMap[s.viewJustify] || "justify-center",
      size: `text-${s.viewSize}`,
      spacingRem,
      showCount: Number(s.viewShowCount || 3),
      namePx: Number(s.viewNamePx || 72),
      safeBottomPx: Math.max(0, Number(s.viewSafeBottomPx || 0)),
      showAvailable: s.viewShowAvailable !== false,
      fontFamily,
      fontColor: s.viewFontColor || "#ffffff",
      bgImageUrl: s.viewBgImageUrl || "",
    };
  }, [settings]);

  const statusPill = (() => {
    const base = "text-xs px-2 py-1  border";
    if (status.type === "loading")
      return (
        <span className={`${base} border-slate-200 bg-slate-50 text-slate-700`}>
          {status.msg}
        </span>
      );
    if (status.type === "success")
      return (
        <span className={`${base} border-emerald-200 bg-emerald-50 text-emerald-700`}>
          {status.msg}
        </span>
      );
    if (status.type === "error")
      return (
        <span className={`${base} border-rose-200 bg-rose-50 text-rose-700`}>
          {status.msg}
        </span>
      );
    return <span className={`${base} border-slate-200 bg-white text-slate-500`}>Idle</span>;
  })();

  // VIEW SCREEN
  if (route === "view") {
    const nowMinutes = getNowMinutes();
    const nextUpIndex = queue.findIndex((q) => {
      const mins = Number.isFinite(q.slotMinutes) ? q.slotMinutes : null;
      return mins === null || mins >= nowMinutes;
    });
    const nextUp = nextUpIndex >= 0 ? queue[nextUpIndex] : null;
    const remainingQueue =
      nextUpIndex >= 0
        ? [...queue.slice(0, nextUpIndex), ...queue.slice(nextUpIndex + 1)]
        : queue;
    const availableTimes = slots.filter((t) => {
      if (taken.has(t)) return false;
      const mins = toMinutes(t);
      return mins !== null && mins >= nowMinutes;
    });
    const futureBooked = remainingQueue.filter((q) => {
      if (!Number.isFinite(q.slotMinutes)) return true;
      return q.slotMinutes >= nowMinutes;
    });
    const bookedByTime = new Map();
    for (const q of futureBooked) {
      const t = q.slot?.time;
      if (!t) continue;
      if (!bookedByTime.has(t)) bookedByTime.set(t, []);
      bookedByTime.get(t).push(q);
    }

    const allRows = [];
    for (const t of slots) {
      const mins = toMinutes(t);
      if (mins === null || mins < nowMinutes) continue;
      const bookedAtTime = bookedByTime.get(t) || [];
      if (bookedAtTime.length) {
        for (const q of bookedAtTime) {
          allRows.push({
            id: q.id,
            name: q.name,
            time: q.slot?.time || "--:--",
            available: false,
          });
        }
      } else if (viewStyle.showAvailable && availableTimes.includes(t)) {
        allRows.push({
          id: `available-${t}`,
          name: "Available",
          time: t,
          available: true,
        });
      }
    }
    const tableRows = allRows.slice(0, viewStyle.showCount);
    const restCount = Math.max(0, allRows.length - tableRows.length);
    const hasRows = Boolean(nextUp) || tableRows.length > 0;

    return (
      <div
        className="min-h-screen w-full relative overflow-hidden"
        style={{
          color: viewStyle.fontColor,
          fontFamily: viewStyle.fontFamily,
          backgroundImage: viewStyle.bgImageUrl ? `url(${viewStyle.bgImageUrl})` : "none",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundColor: "#000000",
        }}
      >

        <div className="relative">
          <div
            className={`w-full flex ${viewStyle.align} ${viewStyle.justify} px-10 overflow-hidden`}
            style={{ height: `calc(100vh - ${viewStyle.safeBottomPx}px)` }}
          >
            <div className="w-full max-w-5xl">
              {!hasRows ? (
                <div className="p-10">
                  <div className="text-2xl font-semibold">No bookings yet</div>
                </div>
              ) : (
                <div>
                  {nextUp && (
                    <div className="mb-8 border-b border-white/20 pb-6">
                      <div
                        className="text-xs uppercase tracking-widest opacity-60"
                        style={{ fontSize: viewStyle.namePx * 0.25 }}
                      >
                        Next up
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6">
                        <div
                          className="font-semibold tracking-tight truncate"
                          style={{ fontSize: viewStyle.namePx }}
                        >
                          {nextUp.name}
                        </div>
                        <div
                          className={`font-semibold tracking-tight ${viewStyle.size} text-right`}
                          style={{ fontSize: viewStyle.namePx * 0.9 }}
                        >
                          {nextUp.slot?.time || "--:--"}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6">
                    <div
                      className="text-xs uppercase tracking-widest opacity-60"
                      style={{ fontSize: viewStyle.namePx * 0.25 }}
                    >
                      Name
                    </div>
                    <div
                      className="text-xs uppercase tracking-widest opacity-60 text-right"
                      style={{ fontSize: viewStyle.namePx * 0.25 }}
                    >
                      Time
                    </div>
                  </div>

                  <div className="mt-2 flex flex-col" style={{ gap: `${viewStyle.spacingRem}rem` }}>
                    {tableRows.map((row) => (
                      <div
                        key={row.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6"
                      >
                        <div
                          className={`font-semibold tracking-tight truncate${
                            row.available ? " opacity-70" : ""
                          }`}
                          style={{ fontSize: viewStyle.namePx }}
                        >
                          {row.name}
                        </div>
                        <div
                          className={`font-semibold tracking-tight ${viewStyle.size} text-right${
                            row.available ? " opacity-70" : ""
                          }`}
                          style={{ fontSize: viewStyle.namePx * 0.9 }}
                        >
                          {row.time}
                        </div>
                      </div>
                    ))}
                  </div>

                  {restCount > 0 && (
                    <div className="mt-2 text-base opacity-70">+ {restCount} more waiting</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ADMIN SCREEN
  return (
    <div className="min-h-screen bg-blue-400 text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Queue Admin</h1>
          </div>

          <div className="flex items-center gap-2">
            {statusPill}

            <button
              onClick={() => refreshAll(false)}
              className="inline-flex items-center border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
              type="button"
            >
              Refresh
            </button>

            <button
              onClick={() => goto("view")}
              className="inline-flex items-center  bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              type="button"
            >
              Open view
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Left column: Queue + Add */}
          <div className="space-y-4">
            <div className=" border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Add to queue</h2>
                <button
                  onClick={() => setViewDraftOpen((v) => !v)}
                  className="text-sm font-medium text-slate-600 hover:text-slate-900"
                  type="button"
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
                      className="mt-1 w-full  border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600">Slot</label>
                    <div className="mt-1 flex  border border-slate-200 bg-white p-1">
                      <button
                        type="button"
                        onClick={() => setMode("auto")}
                        className={`flex-1  px-2 py-1.5 text-xs font-medium ${
                          mode === "auto"
                            ? "bg-slate-900 text-white"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        Next
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode("manual")}
                        className={`flex-1  px-2 py-1.5 text-xs font-medium ${
                          mode === "manual"
                            ? "bg-slate-900 text-white"
                            : "text-slate-700 hover:bg-slate-50"
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

              {viewDraftOpen && (
                <div className="mt-4 space-y-3  border border-slate-200 bg-slate-50 p-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Select
                      label="Font"
                      value={viewDraft.viewFontFamily}
                      onChange={(v) => setViewDraft((p) => ({ ...p, viewFontFamily: v }))}
                      options={[
                        { value: "System", label: "System" },
                        { value: "DM Sans", label: "DM Sans" },
                        { value: "Poppins", label: "Poppins" },
                        { value: "Inter", label: "Inter" },
                      ]}
                    />

                    <div>
                      <label className="block text-xs font-medium text-slate-600">Font colour</label>
                      <input
                        type="text"
                        value={viewDraft.viewFontColor}
                        onChange={(e) =>
                          setViewDraft((p) => ({ ...p, viewFontColor: e.target.value }))
                        }
                        placeholder="#ffffff"
                        className="mt-1 w-full  border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="color"
                          value={isHex(viewDraft.viewFontColor) ? viewDraft.viewFontColor : "#ffffff"}
                          onChange={(e) =>
                            setViewDraft((p) => ({ ...p, viewFontColor: e.target.value }))
                          }
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
                        className="mt-1 w-full  border border-slate-200 bg-white px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Bottom safe area (px)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={800}
                        value={viewDraft.viewSafeBottomPx}
                        onChange={(e) =>
                          setViewDraft((p) => ({ ...p, viewSafeBottomPx: e.target.value }))
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
                        { value: "1", label: "X-tight" },
                        { value: "2", label: "Tight" },
                        { value: "3", label: "Compact" },
                        { value: "4", label: "Normal" },
                        { value: "6", label: "Relaxed" },
                        { value: "8", label: "Wide" },
                        { value: "10", label: "X-wide" },
                      ]}
                    />

                    <div>
                      <label className="block text-xs font-medium text-slate-600">Show count</label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={viewDraft.viewShowCount}
                        onChange={(e) =>
                          setViewDraft((p) => ({ ...p, viewShowCount: e.target.value }))
                        }
                        className="mt-1 w-full border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Show available slots
                      </label>
                      <select
                        value={viewDraft.viewShowAvailable ? "yes" : "no"}
                        onChange={(e) =>
                          setViewDraft((p) => ({ ...p, viewShowAvailable: e.target.value === "yes" }))
                        }
                        className="mt-1 w-full border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                  </div>

                  <div className=" border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">Background image</div>
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
                          e.target.value = "";
                        }}
                        className="block w-full text-sm text-slate-600 file:mr-3  file:border file:border-slate-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-50"
                      />
                    </div>

                    {viewDraft.viewBgImageUrl ? (
                      <div className="mt-3 text-xs text-slate-500">
                        Current: <span className="font-mono">{viewDraft.viewBgImageUrl}</span>
                      </div>
                    ) : (
                      <div className="mt-3 text-xs text-slate-500">No image set (falls back to black).</div>
                    )}

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

            <div className=" border border-slate-200 bg-white shadow-sm">
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
          </div>

          {/* Right column: OSC controls */}
          <div className="space-y-4">
            <div className=" border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">OSC Control</h2>
                  <div className="mt-1 text-xs text-slate-500">
                    Target:{" "}
                    <span className="font-mono">
                      {(settings?.oscHost || oscDraft.host || "—") +
                        ":" +
                        (settings?.oscPort || oscDraft.port || "—")}
                    </span>
                  </div>
                </div>

                <button
                  onClick={saveOscSettings}
                  className="inline-flex items-center  border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
                  type="button"
                >
                  Save
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600">Target IP</label>
                  <input
                    value={oscDraft.host}
                    onChange={(e) => setOscDraft((p) => ({ ...p, host: e.target.value }))}
                    placeholder="e.g. 10.0.30.146"
                    className="mt-1 w-full  border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600">Port</label>
                  <input
                    type="number"
                    value={oscDraft.port}
                    onChange={(e) => setOscDraft((p) => ({ ...p, port: e.target.value }))}
                    className="mt-1 w-full  border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="mt-4  border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-700">Presets</div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      onClick={() => oscPreset(n)}
                      className=" bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                      type="button"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-700">Brightness</div>
                  <div className="text-xs text-slate-500">
                    {oscBrightness}
                    {lastBrightnessSentRef.current !== null
                      ? ` (sent ${lastBrightnessSentRef.current})`
                      : ""}
                  </div>
                </div>

                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={oscBrightness}
                  onChange={(e) => setOscBrightness(Number(e.target.value))}
                  onMouseUp={() => oscSendBrightness(oscBrightness)}
                  onTouchEnd={() => oscSendBrightness(oscBrightness)}
                  className="mt-3 w-full"
                />

                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    onClick={() => oscSendBrightness(oscBrightness)}
                    className=" border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
                    type="button"
                  >
                    Send
                  </button>
                </div>
              </div>

              <div className="mt-3 border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-slate-700">Blackout</div>
                  </div>

                  <button
                    onClick={() => oscSetBlackout(!oscBlackout)}
                    className={`inline-flex items-center  px-3 py-2 text-sm font-semibold ${
                      oscBlackout
                        ? "bg-rose-600 text-white hover:bg-rose-500"
                        : "bg-slate-900 text-white hover:bg-slate-800"
                    }`}
                    type="button"
                  >
                    {oscBlackout ? "ON" : "OFF"}
                  </button>
                </div>
              </div>

              {!oscConfigured() && (
                <div className="mt-3 text-xs text-rose-700">
                  Set the OSC target IP + port and click <span className="font-semibold">Save</span>.
                </div>
              )}
            </div>
          </div>
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
