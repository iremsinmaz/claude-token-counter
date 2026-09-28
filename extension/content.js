// Claude Token Sayacı — claude.ai sohbetindeki tahmini token sayısını gösterir.
// Sayılar tahminidir: sistem promptu ve bazı gizli içerikler görünmez,
// Claude'un tokenizer'ı da açık değil.

(() => {
  "use strict";

  const REFRESH_DEBOUNCE_MS = 1500;

  // --- Token tahmini -------------------------------------------------------
  // ASCII metin için ~4 karakter/token; Türkçe karakterler (ş, ğ, ı, ...) ve
  // diğer ASCII dışı karakterler genelde daha fazla token'a bölünür.
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
    if (!orgs.length) throw new Error("org yok");
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

  // Aynı veriyi her DOM değişikliğinde yeniden istememek için kısa süreli önbellek.
  function cached(ttlMs, load) {
    let value = null;
    let at = 0;
    return async () => {
      if (Date.now() - at < ttlMs) return value;
      try {
        value = await load();
      } catch (e) {
        console.debug("[Claude Token Sayacı]", e);
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

  // Hesap düzeyindeki özellik bayrakları (web araması, memory, ...).
  const accountSettings = cached(5 * 60 * 1000, async () => {
    const account = await getJson("/api/account");
    return account.settings || null;
  });

  // Sunucunun bildirdiği kullanım limitleri — tahmin değil, claude.ai'nin kendi değeri.
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
    // Eski biçim: { five_hour: { utilization, resets_at }, seven_day: {...} }
    return {
      session: u.five_hour ? limit(u.five_hour.utilization, u.five_hour.resets_at) : null,
      weekly: u.seven_day ? limit(u.seven_day.utilization, u.seven_day.resets_at) : null,
    };
  });

  // Dallanmış sohbetlerde yalnızca şu an görünen dalı al.
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
    // Görseller/PDF'ler: içerik görünmez, kaba sabit tahmin.
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
        // Her Claude yanıtı, önceki tüm sohbeti girdi olarak tekrar işler.
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

  // --- Yedek: sayfadaki metin ---------------------------------------------
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

  // --- Rozet ---------------------------------------------------------------
  const fmt = (n) =>
    n == null ? "—" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);

  function badge() {
    let el = document.getElementById("cts-badge");
    if (el) return el;
    el = document.createElement("div");
    el.id = "cts-badge";
    el.title = "Ayrıntılar için tıkla";
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

  // Sistem promptunun taban değeri: scripts/taban-hesapla.mjs, promptu
  // reference/bolumler.json'a göre gruplara ayırıp her grubu count_tokens ile bir
  // kez sayar; sonuç baseline.js içinde sabit durur. Burada yalnızca açık olan
  // özelliklerin grupları toplanır.
  function baselineFor(model, settings) {
    const b = globalThis.CTS_BASELINE;
    const models = (b && b.models) || {};
    const ids = Object.keys(models);
    // Model bilinmiyorsa (sayfa metni yedeği) ve tek taban varsa onu kullan.
    const id = model ? (models[model] ? model : null) : ids.length === 1 ? ids[0] : null;
    if (!id) return null;

    const base = { model: id, countedAt: b.countedAt, tokens: 0, unknown: 0, connectors: 0, groups: [] };
    for (const g of Object.values(models[id].groups)) {
      if (g.tur === "baglayici") {
        base.connectors += g.tokens;
        continue;
      }
      // Bayrak ayarlarda yoksa açık kabul edilir: taban üst sınır olarak kalır.
      const state = !g.bayrak
        ? "her-zaman"
        : settings[g.bayrak] === true
          ? "acik"
          : settings[g.bayrak] === false
            ? "kapali"
            : "bilinmiyor";
      if (state !== "kapali") base.tokens += g.tokens;
      if (state === "bilinmiyor") base.unknown++;
      base.groups.push({ etiket: g.etiket, tokens: g.tokens, state });
    }
    return base;
  }

  const pct = (l) => (l ? `%${Math.round(l.percent)}` : "—");

  function resetText(l, withDay) {
    if (!l || !l.resetsAt) return "";
    const opts = withDay
      ? { weekday: "short", hour: "2-digit", minute: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" };
    return l.resetsAt.toLocaleString("tr-TR", opts);
  }

  function render(s, settings, limits) {
    const el = badge();
    el.replaceChildren();
    const main = document.createElement("div");
    main.className = "cts-main";
    main.textContent = s ? `Sohbet: ~${fmt(s.context)} token` : "Token sayacı: sohbet yok";
    el.appendChild(main);

    // Sunucunun bildirdiği limitler sohbetten bağımsız; sohbet yokken de gösterilir.
    if (limits) {
      el.append(row("Oturum limiti", pct(limits.session)), row("Haftalık limit", pct(limits.weekly)));
    }
    if (!s) return;

    // Taban tahmin mesaj sayısına eklenmez; ayrı satırda durur.
    const effective = { ...(settings || {}), ...s.settings };
    const base = baselineFor(s.model, effective);
    el.appendChild(
      row("Taban tahmin", base ? `${fmt(base.tokens)} token${base.unknown ? " (üst sınır)" : ""}` : "yok")
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

    heading("Sohbet (yaklaşık)");
    d.append(
      row("Sen", fmt(s.user)),
      row("Claude", fmt(s.claude)),
      row("Ekler", fmt(s.attachments)),
      row("Yanıt sayısı", String(s.turns)),
      row("Toplam işlenen", fmt(s.processed))
    );
    note(
      s.source === "api"
        ? "Karakter sayısından tahmin. Thinking tokenları claude.ai tarafından gösterilmez, dahil değil."
        : "Sayfa metninden tahmin. Ekler sayılmadı."
    );

    if (limits) {
      heading("Kullanım limitleri (claude.ai'nin kendi değeri)");
      d.append(
        row("Oturum sıfırlanması", resetText(limits.session, false) || "—"),
        row("Haftalık sıfırlanma", resetText(limits.weekly, true) || "—")
      );
    }

    heading("Taban tahmin (sistem promptu)");
    if (base) {
      const mark = { "her-zaman": "•", acik: "✓", kapali: "–", bilinmiyor: "?" };
      for (const g of base.groups) {
        d.appendChild(row(`${mark[g.state]} ${g.etiket}`, g.state === "kapali" ? "kapalı" : fmt(g.tokens)));
      }
      if (base.connectors) d.appendChild(row("Bağlayıcılar (bağlıysa)", `+${fmt(base.connectors)}`));
      note(
        `${base.model} referans promptu, count_tokens ile ${base.countedAt} tarihinde sayıldı. ` +
          "Özellik eşlemesi ve claude.ai'nin birebir bu promptu kullanması varsayımdır." +
          (base.unknown ? " '?' olanların açık/kapalı durumu okunamadı, açık sayıldı." : "")
      );
    } else {
      note(`${s.model || "Bu model"} için referans prompt yok.`);
    }
    el.appendChild(d);
  }

  // --- Güncelleme döngüsü --------------------------------------------------
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
        console.debug("[Claude Token Sayacı] API okunamadı, sayfa metni kullanılıyor:", e);
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

  // Yanıt akışı bitince (DOM değişiklikleri durulunca) ve sohbet değişince yenile.
  new MutationObserver((mutations) => {
    if (mutations.every((m) => badge().contains(m.target))) return;
    schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  refresh();
})();
