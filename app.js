/* TL-SAR static workbench. Reads existing files; never writes to the literature data. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const icons = {
    book: '<path d="M12 7c-3-2-6-2-9-1v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1V7Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="m12 3 8 4v6c0 4-4 7-8 9-4-2-8-5-8-9V7l8-4Z"/><path d="m8 12 3 3 5-6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    check: '<path d="m5 12 4 4L19 6"/>'
  };
  const icon = name => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || icons.book) + '</svg>';
  document.querySelectorAll("[data-icon]").forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  function text(value) {
    if (Array.isArray(value)) return value.map(text).filter(Boolean).join("; ");
    if (value && typeof value === "object") return text(value.name || value.display_name || value.title || "");
    return value == null ? "" : String(value).trim();
  }
  function list(value) {
    return (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);
  }
  function safeUrl(value) {
    const raw = text(value);
    if (!/^https?:\/\//i.test(raw)) return "";
    try {
      const url = new URL(raw);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }
  function doiUrl(value) {
    const raw = text(value);
    return safeUrl(raw) || (/^10\.\d{4,9}\/\S+$/i.test(raw) ? safeUrl("https://doi.org/" + raw) : "");
  }
  function verified(status) {
    // Partial checks and preprints never count as completed verification.
    if (/待|未|部分|预印本|pending|unverified|partial|preprint/i.test(status)) return false;
    return /已核验|已验证|核验完成|核验通过|已核对|^(verified|reviewed)$/i.test(status);
  }
  function normalize(raw, index) {
    const p = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const lang = text(p.language).toLowerCase();
    const language = /^(zh|zho|chi|cn)(-|_|$)|^中文$|^chinese$/.test(lang) ? "zh" : /^(en|eng)(-|_|$)|^英文$|^english$/.test(lang) ? "en" : "other";
    const status = text(p.verified_status) || "待核验";
    const year = /^\d{4}$/.test(text(p.year)) ? Number(p.year) : null;
    return {
      index, title: text(p.title) || "未命名论文", authors: text(p.authors) || "作者信息待补充",
      year, venue: text(p.venue) || "来源待补充", language,
      abstract: text(p.abstract), abstractSource: text(p.abstract_source),
      method: text(p.method), novelty: text(p.novelty), keywords: list(p.keywords),
      category: text(p.relevance_category || p.category) || "研究文献",
      relevance: text(p.relevance_reason), source: text(p.source) || "来源待补充",
      status, state: verified(status) ? "verified" : "pending",
      doi: text(p.doi), url: safeUrl(p.url) || doiUrl(p.doi),
      firstSeen: text(p.first_seen), lastSeen: text(p.last_seen),
      metadataSources: (Array.isArray(p.metadata_sources) ? p.metadata_sources : p.metadata_sources ? [p.metadata_sources] : []).map(item => ({
        name: text(item?.name || item?.label || item?.source) || "元数据来源",
        url: safeUrl(typeof item === "string" ? item : item?.url)
      })).filter(item => item.url),
      searchText: [p.title, p.authors, p.year, p.venue, p.abstract, p.abstract_source, p.keywords, p.method, p.novelty, p.doi, p.matched_queries, p.source, p.verified_status, p.relevance_category, p.relevance_reason].map(text).join(" ").toLowerCase()
    };
  }
  let papers = [], runs = [], filtered = [], hasData = false, runError = "", limit = 12;
  let state = "all", language = "all", spotlightPaper = null;
  const languageLabel = value => value === "zh" ? "中文" : value === "en" ? "EN" : "语言待补充";
  function dateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "日期待补充";
    return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }
  function renderStats(updatedAt) {
    $("totalCount").textContent = $("navCount").textContent = $("libraryCount").textContent = papers.length;
    const zh = papers.filter(p => p.language === "zh").length;
    const en = papers.filter(p => p.language === "en").length;
    $("zhCount").textContent = zh;
    $("enCount").textContent = en;
    const unknown = papers.length - zh - en;
    $("languageNote").textContent = unknown ? "其他或语言待补充 " + unknown + " 篇" : "按文献语言字段统计";
    const pending = papers.filter(p => p.state === "pending").length;
    $("pendingCount").textContent = $("pendingBadge").textContent = pending;
    const years = [...new Set(papers.map(p => p.year).filter(Boolean))].sort((a, b) => b - a);
    $("yearRange").textContent = years.length ? years.length === 1 ? String(years[0]) : years.at(-1) + " — " + years[0] : "待补充";
    const selectedYear = $("yearFilter").value;
    $("yearFilter").innerHTML = '<option value="all">全部年份</option>' + years.map(y => '<option value="' + y + '">' + y + " 年</option>").join("") + (papers.some(p => !p.year) ? '<option value="unknown">年份待补充</option>' : "");
    $("yearFilter").value = [...$("yearFilter").options].some(o => o.value === selectedYear) ? selectedYear : "all";
    const dates = runs.map(r => text(r.completed_at || r.run_date)).filter(Boolean).sort();
    $("lastUpdated").textContent = dateTime(updatedAt || dates.at(-1));
    const sources = new Map();
    papers.forEach(p => sources.set(p.source, (sources.get(p.source) || 0) + 1));
    $("sourceList").innerHTML = [...sources].sort((a, b) => b[1] - a[1]).map(([name, count]) => '<div class="source-item"><span>' + escapeHtml(name) + "</span><span>" + count + " 篇</span></div>").join("") || '<p class="muted">暂无来源记录。</p>';
    spotlightPaper = papers.find(p => p.method || p.novelty) || null;
    $("spotlight").hidden = !spotlightPaper;
    if (spotlightPaper) $("spotlightTitle").textContent = spotlightPaper.title;
  }
  function renderPapers() {
    const keyword = $("searchInput").value.trim().toLowerCase();
    const year = $("yearFilter").value;
    filtered = papers.filter(p => (state === "all" || p.state === state) && (language === "all" || p.language === language) && (year === "all" || (year === "unknown" ? !p.year : p.year === Number(year))) && (!keyword || p.searchText.includes(keyword)));
    const sort = $("sortSelect").value;
    if (sort !== "original") filtered.sort((a, b) => {
      if (!a.year || !b.year) return (a.year ? -1 : b.year ? 1 : a.index - b.index);
      return (sort === "latest" ? b.year - a.year : a.year - b.year) || a.index - b.index;
    });
    $("status").textContent = "共收录 " + papers.length + " 篇 · 找到 " + filtered.length + " 篇 · 已展示 " + Math.min(limit, filtered.length) + " 篇";
    $("clearSearch").hidden = !$("searchInput").value;
    $("emptyState").hidden = filtered.length > 0;
    $("exportButton").disabled = filtered.length === 0;
    $("loadMoreWrap").hidden = filtered.length <= limit;
    $("loadMore").innerHTML = '继续浏览 <span>已展示 ' + Math.min(limit, filtered.length) + " / " + filtered.length + "</span>";
    $("paperList").innerHTML = filtered.slice(0, limit).map(p => {
      const ai = /GPT|AI|人工智能/i.test(p.abstractSource);
      return '<article class="paper-card"><div class="card-top"><span class="paper-category ' + (p.state === "pending" ? "candidate" : "") + '">' + escapeHtml(p.category) + '</span><span class="paper-year">' + (p.year || "年份待补充") + ' <i>·</i> ' + languageLabel(p.language) + '</span></div><h3><button data-paper="' + p.index + '">' + escapeHtml(p.title) + '</button></h3><p class="authors" title="' + escapeHtml(p.authors) + '">' + escapeHtml(p.authors) + '</p><div class="journal">' + icon("book") + '<span title="' + escapeHtml(p.venue) + '">' + escapeHtml(p.venue) + '</span></div><p class="paper-summary">' + (ai ? '<span class="summary-label">AI 整理 · 非原文</span>' : "") + escapeHtml(p.abstract || "暂无摘要，点击查看题录与原始来源。") + '</p><div class="card-footer"><span class="' + (p.state === "verified" ? "verified" : "candidate-label") + '">' + icon(p.state === "verified" ? "check" : "clock") + (p.state === "verified" ? "已核验" : "核验待完成") + '</span><button data-paper="' + p.index + '">查看' + (p.method || p.novelty ? "笔记" : "题录") + icon("arrow") + "</button></div></article>";
    }).join("");
  }
  function renderRuns() {
    $("runCount").textContent = runs.length + " 条记录";
    const hint = runError ? '<p class="notice">' + escapeHtml(runError) + "</p>" : "";
    $("runList").innerHTML = hint + runs.slice().reverse().map(r => {
      const status = text(r.status);
      const title = status === "success" ? "文献入库完成" : status === "partial" ? "部分来源检索完成" : /fail|error/.test(status) ? "检索未完成" : "文献更新记录";
      const errors = Array.isArray(r.errors) ? r.errors : [];
      const count = key => Number.isFinite(Number(r[key])) && r[key] != null ? Number(r[key]) : "—";
      return '<article><span class="timeline-dot ' + (/fail|error/.test(status) ? "failed" : "") + '"></span><div class="run-heading"><strong>' + title + "</strong><time>" + escapeHtml(dateTime(r.completed_at || r.run_date)) + '</time></div><p>' + escapeHtml(text(r.note) || text(r.source) || "本轮检索结果已记录。") + '</p><div class="run-meta">候选 ' + count("candidate_count") + " 条 · 新增 " + count("new_count") + " 篇 · 重复 " + count("duplicate_count") + " 条 · 总库 " + count("total_count") + " 篇</div>" + (errors.length ? "<details><summary>查看来源异常（" + errors.length + "）</summary>" + errors.map(e => '<p class="run-error">' + escapeHtml(typeof e === "object" ? JSON.stringify(e) : text(e)) + "</p>").join("") + "</details>" : "") + "</article>";
    }).join("") + (!runs.length && !runError ? '<p class="muted">暂无运行日志，论文数据仍可正常浏览。</p>' : "");
  }
  function openPaper(p) {
    if (!p) return;
    const detail = (n, title, value) => '<div class="note-section"><span>' + n + "</span><div><h3>" + title + "</h3><p>" + escapeHtml(value || "待补充") + "</p></div></div>";
    const ai = /GPT|AI|人工智能/i.test(p.abstractSource);
    $("paperDetail").innerHTML = '<span class="paper-category">' + escapeHtml(p.category) + '</span><h2 id="paperTitle">' + escapeHtml(p.title) + '</h2><p class="modal-authors">' + escapeHtml(p.authors) + '</p><div class="modal-journal">' + icon("book") + "<strong>" + escapeHtml(p.venue) + '</strong></div><dl class="metadata"><div><dt>发表年份</dt><dd>' + (p.year || "待补充") + "</dd></div><div><dt>文献语言</dt><dd>" + languageLabel(p.language) + "</dd></div><div><dt>首次入库</dt><dd>" + escapeHtml(p.firstSeen || "待补充") + "</dd></div><div><dt>最近发现</dt><dd>" + escapeHtml(p.lastSeen || "待补充") + "</dd></div></dl>" + detail("01", ai ? "内容概述（AI 整理，非原文）" : "摘要", p.abstract || "暂无摘要") + detail("02", "研究方法", p.method) + detail("03", "主要贡献", p.novelty) + (p.relevance ? detail("04", "与 TL-SAR 的相关性", p.relevance) : "") + (p.keywords.length ? '<div class="detail-keywords">' + p.keywords.map(k => "<span>" + escapeHtml(k) + "</span>").join("") + "</div>" : "") + '<div class="verification-note">' + icon("shield") + "<div><strong>核验状态与来源</strong><p>" + escapeHtml(p.status) + "</p><p>数据来源：" + escapeHtml(p.source) + "</p>" + (p.abstractSource ? "<p>摘要来源：" + escapeHtml(p.abstractSource) + "</p>" : "") + (p.doi ? "<p>DOI：" + escapeHtml(p.doi) + "</p>" : "") + (p.metadataSources.length ? '<ul class="metadata-links">' + p.metadataSources.map(s => '<li><a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(s.name) + " ↗</a></li>").join("") + "</ul>" : "") + "</div></div>";
    $("paperSource").hidden = !p.url;
    $("missingLink").hidden = !!p.url;
    if (p.url) $("paperSource").href = p.url;
    else $("paperSource").removeAttribute("href");
    $("paperDialog").showModal();
  }
  const views = {
    papers: ["文献追踪", "文献有据，<em>研究有序。</em>", "围绕 TL-SAR，持续积累空间自回归与迁移学习领域的研究文献。"],
    runs: ["更新记录", "每一次更新，<em>都有迹可循。</em>", "保存实际检索结果与入库进度，让文献的积累有迹可循。"],
    sources: ["来源说明", "可信的来源，<em>是研究的起点。</em>", "保留题录来源、摘要来源与核验说明，保持学术可追溯。"]
  };
  function navigate(focus = false) {
    const view = Object.hasOwn(views, location.hash.slice(1)) ? location.hash.slice(1) : "papers";
    for (const id of Object.keys(views)) $(id + "View").hidden = id !== view;
    document.querySelectorAll("[data-view]").forEach(el => {
      const active = el.dataset.view === view;
      el.classList.toggle("active", active);
      if (active) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
    $("breadcrumbCurrent").textContent = views[view][0];
    $("pageHeading").innerHTML = views[view][1];
    $("pageIntro").textContent = views[view][2];
    closeMenu();
    if (focus) { $("main").focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }
  }
  function closeMenu() {
    $("sidebar").classList.remove("opened");
    $("sidebar").inert = matchMedia("(max-width: 620px)").matches;
    $("menuBackdrop").hidden = true;
    $("menuToggle").setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }
  function resetFilters() {
    state = language = "all";
    $("searchInput").value = "";
    $("yearFilter").value = "all";
    $("sortSelect").value = "original";
    document.querySelectorAll("[data-state], [data-language]").forEach(el => {
      const active = (el.dataset.state || el.dataset.language) === "all";
      el.classList.toggle("chosen", active);
      el.setAttribute("aria-pressed", String(active));
    });
    limit = 12; renderPapers();
  }
  async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }
  async function loadPapers() {
    $("refreshButton").disabled = true;
    $("refreshButton").lastElementChild.textContent = "读取中…";
    $("loadError").hidden = true;
    const results = await Promise.allSettled([fetchJson("./data/papers.json"), fetchJson("./data/runs.json")]);
    try {
      if (results[0].status !== "fulfilled") throw results[0].reason;
      const data = results[0].value;
      const records = Array.isArray(data) ? data : data?.papers;
      if (!Array.isArray(records)) throw new Error("papers 必须是数组");
      papers = records.map(normalize);
      hasData = true;
      const log = results[1].status === "fulfilled" ? results[1].value : null;
      const entries = Array.isArray(log) ? log : log?.runs;
      runs = Array.isArray(entries) ? entries.filter(r => r && typeof r === "object" && !Array.isArray(r)) : [];
      runError = !Array.isArray(entries) ? "运行日志暂不可用，文献浏览不受影响。" : "";
      limit = 12;
      renderStats(Array.isArray(data) ? "" : text(data.updated_at));
      renderPapers();
      renderRuns();
      $("dataState").textContent = "文献库已连接";
      $("dataDot").classList.add("live");
    } catch {
      $("loadError").hidden = false;
      $("loadError").textContent = "论文数据暂时无法加载，请稍后点击“刷新文献库”重试。" + (hasData ? "当前仍显示上次成功读取的文献。" : "请确认 data/papers.json 已正确发布。");
      $("dataState").textContent = hasData ? "刷新失败 · 保留上次结果" : "文献库暂未连接";
      $("dataDot").classList.remove("live");
      if (!hasData) {
        $("status").textContent = "论文数据暂时无法加载。";
        $("runList").textContent = "文献库连接后将展示更新记录。";
      }
    } finally {
      $("refreshButton").disabled = false;
      $("refreshButton").lastElementChild.textContent = "刷新文献库";
    }
  }
  document.querySelectorAll("[data-state], [data-language]").forEach(el => el.addEventListener("click", () => {
    const key = el.hasAttribute("data-state") ? "state" : "language";
    if (key === "state") state = el.dataset.state; else language = el.dataset.language;
    document.querySelectorAll("[data-" + key + "]").forEach(button => {
      const active = button === el; button.classList.toggle("chosen", active); button.setAttribute("aria-pressed", String(active));
    });
    limit = 12; if (hasData) renderPapers();
  }));
  $("searchInput").addEventListener("input", () => { limit = 12; if (hasData) renderPapers(); });
  ["yearFilter", "sortSelect"].forEach(id => $(id).addEventListener("change", () => { limit = 12; if (hasData) renderPapers(); }));
  $("clearSearch").addEventListener("click", () => { $("searchInput").value = ""; limit = 12; renderPapers(); $("searchInput").focus(); });
  $("resetFilters").addEventListener("click", resetFilters);
  $("loadMore").addEventListener("click", () => {
    const firstNew = limit;
    limit += 12; renderPapers();
    $("paperList").children[firstNew]?.querySelector("button")?.focus({ preventScroll: true });
  });
  $("paperList").addEventListener("click", event => {
    const button = event.target.closest("[data-paper]");
    if (button) openPaper(papers[Number(button.dataset.paper)]);
  });
  $("spotlightTitle").addEventListener("click", () => openPaper(spotlightPaper));
  $("spotlightOpen").addEventListener("click", () => openPaper(spotlightPaper));
  ["closeDialog", "backToLibrary"].forEach(id => $(id).addEventListener("click", () => $("paperDialog").close()));
  $("paperDialog").addEventListener("click", event => {
    if (event.target !== $("paperDialog")) return;
    const rect = $("paperDialog").getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $("paperDialog").close();
  });
  $("paperDialog").addEventListener("close", () => { document.body.style.overflow = ""; });
  $("paperDialog").addEventListener("toggle", event => {
    if (event.newState === "open") document.body.style.overflow = "hidden";
  });
  $("refreshButton").addEventListener("click", loadPapers);
  $("exportButton").addEventListener("click", () => {
    // Newlines inside metadata cannot inject additional RIS fields.
    const line = value => text(value).replace(/[\r\n]+/g, " ");
    const ris = filtered.map(p => [
      "TY  - " + (/arxiv|预印本|preprint/i.test(p.venue + " " + p.source + " " + p.status) ? "UNPB" : /conference|proceedings|会议/i.test(p.venue) ? "CONF" : "JOUR"), "TI  - " + line(p.title),
      ...p.authors.split(/;|；/).map(a => "AU  - " + line(a)),
      ...(p.year ? ["PY  - " + p.year] : []), "JO  - " + line(p.venue),
      ...(p.doi ? ["DO  - " + line(p.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""))] : []),
      ...(p.url ? ["UR  - " + p.url] : []),
      ...(p.abstract ? [( /GPT|AI|人工智能/i.test(p.abstractSource) ? "N1  - AI整理（非原文）: " : "AB  - ") + line(p.abstract)] : []),
      ...p.keywords.map(k => "KW  - " + line(k)), "N1  - 核验状态: " + line(p.status),
      "ER  - "
    ].join("\r\n")).join("\r\n\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + ris], { type: "application/x-research-info-systems;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "TL-SAR-文献库.ris";
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("menuToggle").addEventListener("click", () => {
    if ($("sidebar").classList.contains("opened")) { closeMenu(); return; }
    $("sidebar").inert = false;
    $("sidebar").classList.add("opened"); $("menuBackdrop").hidden = false;
    $("menuToggle").setAttribute("aria-expanded", "true"); document.body.style.overflow = "hidden";
    $("sidebar").querySelector("a").focus();
  });
  $("menuBackdrop").addEventListener("click", () => { closeMenu(); $("menuToggle").focus(); });
  document.addEventListener("keydown", event => {
    if (!$("sidebar").classList.contains("opened")) return;
    if (event.key === "Escape") { closeMenu(); $("menuToggle").focus(); }
    if (event.key === "Tab") {
      const links = [...$("sidebar").querySelectorAll("a")];
      if (event.shiftKey && document.activeElement === links[0]) { event.preventDefault(); links.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === links.at(-1)) { event.preventDefault(); links[0].focus(); }
    }
  });
  matchMedia("(min-width: 621px)").addEventListener("change", event => { if (event.matches) closeMenu(); });
  document.querySelectorAll("[data-view]").forEach(el => el.addEventListener("click", () => closeMenu()));
  window.addEventListener("hashchange", () => navigate(true));
  navigate();
  loadPapers();
})();
