
const statusEl = document.getElementById("status");
const searchInput = document.getElementById("searchInput");
const paperList = document.getElementById("paperList");

let papers = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function renderPapers() {
  const keyword = searchInput.value.trim().toLowerCase();

  const filtered = papers.filter(paper => {
    const text = [
      paper.title,
      paper.authors,
      paper.year,
      paper.abstract,
      paper.keywords,
      paper.method,
      paper.novelty
    ].flat().join(" ").toLowerCase();

    return text.includes(keyword);
  });

  statusEl.textContent =
    `共收录 ${papers.length} 篇论文，当前显示 ${filtered.length} 篇`;

  if (filtered.length === 0) {
    paperList.innerHTML = "<p>暂无匹配论文。</p>";
    return;
  }

  paperList.innerHTML = filtered.map(paper => {
    const title = escapeHtml(paper.title || "未命名论文");
    const authors = escapeHtml(paper.authors || "作者信息待补充");
    const year = escapeHtml(paper.year || "年份待核验");
    const venue = escapeHtml(paper.venue || "来源待核验");
    const abstract = escapeHtml(paper.abstract || "暂无摘要");
    const url = /^https?:\/\//i.test(paper.url || "")
      ? paper.url
      : "";

    return `
      <article class="paper-card">
        <h2>${title}</h2>
        <p>${authors}</p>
        <p>${year} · ${venue}</p>
        <p>${abstract}</p>
        ${url
          ? `<a href="${escapeHtml(url)}"
               target="_blank"
               rel="noopener noreferrer">查看论文原文</a>`
          : "<p>原文链接待补充</p>"}
      </article>
    `;
  }).join("");
}

searchInput.addEventListener("input", renderPapers);

async function loadPapers() {
  try {
    const response = await fetch("./data/papers.json", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("论文数据文件读取失败");
    }

    const data = await response.json();
    papers = Array.isArray(data) ? data : (data.papers || []);

    renderPapers();
  } catch (error) {
    statusEl.textContent =
      "论文数据暂时无法加载，请检查 data/papers.json。";
    paperList.textContent =
      "请确认论文数据文件已经创建，并且网页已正确发布。";
    console.error(error);
  }
}

loadPapers();
