// Claude Token Counter — shows the estimated token count of the open claude.ai conversation.
// The numbers are estimates: the system prompt and some hidden content are not
// visible, and Claude's tokenizer is not public.

(() => {
  "use strict";

  const REFRESH_DEBOUNCE_MS = 1500;

  // --- Token estimate ------------------------------------------------------
  // ~4 characters per token for ASCII text; non-ASCII characters (accented
  // letters, other scripts) are usually split into more tokens.
  function estimateTokens(text) {
    if (!text) return 0;
    let ascii = 0;
    let other = 0;
    for (const ch of text) {
      if (ch.charCodeAt(0) < 128) ascii++;
      else other++;
    }
    return Math.ceil(ascii / 4 + other * 0.6);
  }

  // --- claude.ai API -------------------------------------------------------
  let orgId = null;

  function conversationId() {
    const m = location.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }

  async function getOrgId() {
    if (orgId) return orgId;
    const cookie = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
    if (cookie) return (orgId = decodeURIComponent(cookie[1]));
    const res = await fetch("/api/organizations", { credentials: "include" });
    if (!res.ok) throw new Error("org " + res.status);
    const orgs = await res.json();
    if (!orgs.length) throw new Error("no org");
    return (orgId = orgs[0].uuid);
  }

  async function fetchConversation(convId) {
    const org = await getOrgId();
    const url =
      `/api/organizations/${org}/chat_conversations/${convId}` +
      `?tree=True&rendering_mode=messages&render_all_tools=true`;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("conv " + res.status);
    return res.json();
  }

  // Short-lived cache so the same data isn't re-requested on every DOM change.
  function cached(ttlMs, load) {
    let value = null;
    let at = 0;
    return async () => {
      if (Date.now() - at < ttlMs) return value;
      try {
        value = await load();
      } catch (e) {
        console.debug("[Claude Token Counter]", e);
        value = null;
      }
      at = Date.now();
      return value;
    };
  }

  async function getJson(path) {
    const res = await fetch(path, { credentials: "include" });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  }

  // Account-level feature flags (web search, memory, ...).
  const accountSettings = cached(5 * 60 * 1000, async () => {
    const account = await getJson("/api/account");
    return account.settings || null;
  });

  // Usage limits reported by the server — not an estimate, claude.ai's own value.
  const usage = cached(30 * 1000, async () => {
    const u = await getJson(`/api/organizations/${await getOrgId()}/usage`);
    const limit = (percent, resetsAt) =>
      percent == null ? null : { percent, resetsAt: resetsAt ? new Date(resetsAt) : null };
    if (Array.isArray(u.limits) && u.limits.length) {
      const find = (kind) => u.limits.find((l) => l.kind === kind);
      const s = find("session");
      const w = find("weekly_all");
      return {
        session: s ? limit(s.percent, s.resets_at) : null,
        weekly: w ? limit(w.percent, w.resets_at) : null,
      };
    }
    // Older format: { five_hour: { utilization, resets_at }, seven_day: {...} }
    return {
      session: u.five_hour ? limit(u.five_hour.utilization, u.five_hour.resets_at) : null,
      weekly: u.seven_day ? limit(u.seven_day.utilization, u.seven_day.resets_at) : null,
    };
  });

  // In branched conversations, take only the currently visible branch.
  function activeBranch(conv) {
    const msgs = conv.chat_messages || [];
    const byId = new Map(msgs.map((m) => [m.uuid, m]));
    let leaf = byId.get(conv.current_leaf_message_uuid);
    if (!leaf) return msgs;
    const chain = [];
    while (leaf) {
      chain.push(leaf);
      leaf = byId.get(leaf.parent_message_uuid);
    }
    return chain.reverse();
  }

  function contentText(block) {
    if (!block) return "";
    if (typeof block === "string") return block;
    if (Array.isArray(block)) return block.map(contentText).join("\n");
    switch (block.type) {
      case "text":
        return block.text || "";
      case "thinking":
        return block.thinking || "";
      case "tool_use":
        return JSON.stringify(block.input || {});
      case "tool_result":
        return contentText(block.content);
      default:
        return block.text || "";
    }
  }

  function messageTokens(msg) {
    const text =
      Array.isArray(msg.content) && msg.content.length
        ? contentText(msg.content)
        : msg.text || "";
    let attachments = 0;
    for (const a of msg.attachments || []) {
      attachments += estimateTokens(a.extracted_content || "");
    }
    // Images/PDFs: content isn't visible, so use a rough fixed estimate.
    attachments += (msg.files || msg.files_v2 || []).length * 1500;
    return { text: estimateTokens(text), attachments };
  }

  function statsFromConversation(conv) {
    const s = { user: 0, claude: 0, attachments: 0, processed: 0, turns: 0 };
    let context = 0;
    for (const msg of activeBranch(conv)) {
      const t = messageTokens(msg);
      context += t.text + t.attachments;
      s.attachments += t.attachments;
      if (msg.sender === "human") {
        s.user += t.text;
      } else {
        s.claude += t.text;
        // Each Claude reply re-processes the whole conversation so far as input.
        s.processed += context;
        s.turns++;
      }
    }
    s.context = context;
    s.model = conv.model || null;
    s.settings = conv.settings || {};
    s.source = "api";
    return s;
  }

  // --- Fallback: page text -------------------------------------------------
  function statsFromDom() {
    const user = [...document.querySelectorAll('[data-testid="user-message"]')];
    const claude = [...document.querySelectorAll(".font-claude-response")];
    const s = { user: 0, claude: 0, attachments: 0, processed: 0, turns: claude.length };
    if (user.length || claude.length) {
      user.forEach((el) => (s.user += estimateTokens(el.innerText)));
      claude.forEach((el) => (s.claude += estimateTokens(el.innerText)));
    } else {
      const main = document.querySelector("main");
      s.claude = main ? estimateTokens(main.innerText) : 0;
    }
    s.context = s.user + s.claude;
    s.processed = null;
    s.model = null;
    s.settings = {};
    s.source = "dom";
    return s;
  }

  // --- Badge ---------------------------------------------------------------
  const fmt = (n) =>
    n == null ? "—" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);

  function badge() {
    let el = document.getElementById("cts-badge");
    if (el) return el;
    el = document.createElement("div");
    el.id = "cts-badge";
    el.title = "Click for details";
    el.addEventListener("click", () => el.classList.toggle("cts-open"));
    document.body.appendChild(el);
    return el;
  }

  function row(label, value) {
    const r = document.createElement("div");
    r.className = "cts-row";
    const a = document.createElement("span");
    a.textContent = label;
    const b = document.createElement("span");
    b.textContent = value;
    r.append(a, b);
    return r;
  }

  // System prompt baseline: scripts/count-baseline.mjs splits the prompt into
  // groups per reference/sections.json and counts each group once with
  // count_tokens; the result sits fixed in baseline.js. Here only the groups of
  // enabled features are summed.
  function baselineFor(model, settings) {
    const b = globalThis.CTS_BASELINE;
    const models = (b && b.models) || {};
    const ids = Object.keys(models);
    // If the model is unknown (page-text fallback) and there is one baseline, use it.
    const id = model ? (models[model] ? model : null) : ids.length === 1 ? ids[0] : null;
    if (!id) return null;

    const base = { model: id, countedAt: b.countedAt, tokens: 0, unknown: 0, connectors: 0, groups: [] };
    for (const g of Object.values(models[id].groups)) {
      if (g.kind === "connector") {
        base.connectors += g.tokens;
        continue;
      }
      // A flag missing from settings counts as on, so the baseline stays an upper bound.
      const state = !g.flag
        ? "always"
        : settings[g.flag] === true
          ? "on"
          : settings[g.flag] === false
            ? "off"
            : "unknown";
      if (state !== "off") base.tokens += g.tokens;
      if (state === "unknown") base.unknown++;
      base.groups.push({ label: g.label, tokens: g.tokens, state });
    }
    return base;
  }

  const pct = (l) => (l ? `${Math.round(l.percent)}%` : "—");

  function resetText(l, withDay) {
    if (!l || !l.resetsAt) return "";
    const opts = withDay
      ? { weekday: "short", hour: "2-digit", minute: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" };
    return l.resetsAt.toLocaleString(undefined, opts);
  }

  function render(s, settings, limits) {
    const el = badge();
    el.replaceChildren();
    const main = document.createElement("div");
    main.className = "cts-main";
    main.textContent = s ? `Chat: ~${fmt(s.context)} tokens` : "Token counter: no chat";
    el.appendChild(main);

    // Server-reported limits don't depend on the chat; shown even with no chat open.
    if (limits) {
      el.append(row("Session limit", pct(limits.session)), row("Weekly limit", pct(limits.weekly)));
    }
    if (!s) return;

    // The baseline is not added to the chat count; it stays on its own line.
    const effective = { ...(settings || {}), ...s.settings };
    const base = baselineFor(s.model, effective);
    el.appendChild(
      row("Baseline estimate", base ? `${fmt(base.tokens)} tokens${base.unknown ? " (upper bound)" : ""}` : "none")
    );

    const d = document.createElement("div");
    d.className = "cts-details";
    const heading = (text) => {
      const h = document.createElement("div");
      h.className = "cts-heading";
      h.textContent = text;
      d.appendChild(h);
    };
    const note = (text) => {
      const n = document.createElement("div");
      n.className = "cts-note";
      n.textContent = text;
      d.appendChild(n);
    };

    heading("Chat (approximate)");
    d.append(
      row("You", fmt(s.user)),
      row("Claude", fmt(s.claude)),
      row("Attachments", fmt(s.attachments)),
      row("Replies", String(s.turns)),
      row("Total processed", fmt(s.processed))
    );
    note(
      s.source === "api"
        ? "Estimated from character count. claude.ai doesn't expose thinking tokens, so they aren't included."
        : "Estimated from page text. Attachments not counted."
    );

    if (limits) {
      heading("Usage limits (claude.ai's own value)");
      d.append(
        row("Session resets", resetText(limits.session, false) || "—"),
        row("Weekly resets", resetText(limits.weekly, true) || "—")
      );
    }

    heading("Baseline estimate (system prompt)");
    if (base) {
      const mark = { always: "•", on: "✓", off: "–", unknown: "?" };
      for (const g of base.groups) {
        d.appendChild(row(`${mark[g.state]} ${g.label}`, g.state === "off" ? "off" : fmt(g.tokens)));
      }
      if (base.connectors) d.appendChild(row("Connectors (if connected)", `+${fmt(base.connectors)}`));
      note(
        `${base.model} reference prompt, counted with count_tokens on ${base.countedAt}. ` +
          "The feature mapping, and claude.ai using exactly this prompt, are assumptions." +
          (base.unknown ? " Items marked '?' couldn't be read as on/off and were counted as on." : "")
      );
    } else {
      note(`No reference prompt for ${s.model || "this model"}.`);
    }
    el.appendChild(d);
  }

  // --- Refresh loop --------------------------------------------------------
  let timer = null;
  let running = false;

  async function refresh() {
    if (running) return schedule();
    running = true;
    try {
      const id = conversationId();
      const [settings, limits] = await Promise.all([accountSettings(), usage()]);
      if (!id) return render(null, settings, limits);
      let s;
      try {
        s = statsFromConversation(await fetchConversation(id));
      } catch (e) {
        console.debug("[Claude Token Counter] Couldn't read the API, using page text:", e);
        s = statsFromDom();
      }
      render(s, settings, limits);
    } finally {
      running = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
  }

  // Refresh once the reply stream finishes (DOM changes settle) and when the chat changes.
  new MutationObserver((mutations) => {
    if (mutations.every((m) => badge().contains(m.target))) return;
    schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  refresh();
})();
