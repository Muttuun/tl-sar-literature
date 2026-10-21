
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUTPUT_FILE = DATA_DIR / "incoming_papers.json"

SEARCH_TERMS = [
    "spatial autoregressive model",
    "spatial autoregressive",
    "spatial lag model",
    "spatial econometric model",
    "spatial econometrics transfer learning",
    "transfer learning spatial data",
    "transfer learning spatial regression",
    "spatial regression",
    "spatial machine learning",
    "spatial panel data model",
]

TODAY = date.today()

try:
    START_DATE = date(
        TODAY.year - 5, TODAY.month, TODAY.day
    )
except ValueError:
    START_DATE = date(TODAY.year - 5, TODAY.month, 28)


def get_abstract(inverted_index):
    """将 OpenAlex 的倒排索引还原成摘要文本。"""
    if not inverted_index:
        return ""

    positions = [
        pos
        for values in inverted_index.values()
        for pos in values
    ]

    if not positions:
        return ""

    words = [""] * (max(positions) + 1)

    for word, indexes in inverted_index.items():
        for index in indexes:
            words[index] = word

    return " ".join(word for word in words if word)


def normalize_title(title):
    """用于没有 DOI 时的辅助去重。"""
    return re.sub(
        r"[^a-z0-9]+", "",
        (title or "").lower()
    )


def fetch_works(term):
    """从 OpenAlex 检索单个关键词对应的论文。"""
    filters = (
        f"from_publication_date:{START_DATE},"
        f"to_publication_date:{TODAY},"
        "type:article"
    )

    params = {
        "search": term,
        "filter": filters,
        "per-page": 50,
        "sort": "relevance_score:desc",
    }

    url = (
        "https://api.openalex.org/works?"
        + urllib.parse.urlencode(params)
    )

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent":
                "TLSARLiteratureWorkbench/1.0"
        },
    )

    with urllib.request.urlopen(
        request, timeout=30
    ) as response:
        result = json.loads(
            response.read().decode("utf-8")
        )

    return result.get("results", [])


def convert_work(work, term):
    """提取论文元数据并统一字段。"""
    title = work.get("title") or ""

    if not title:
        return None

    authors = []
    for authorship in work.get("authorships", []):
        author = authorship.get("author") or {}
        name = author.get("display_name")
        if name:
            authors.append(name)

    primary = work.get("primary_location") or {}
    source = primary.get("source") or {}

    doi = work.get("doi") or ""
    landing_url = primary.get("landing_page_url") or ""

    keywords = [
        item.get("keyword")
        for item in work.get("keywords", [])
        if item.get("keyword")
    ]

    topics = [
        item.get("display_name")
        for item in work.get("topics", [])
        if item.get("display_name")
    ]

    return {
        "title": title,
        "authors": authors,
        "year": work.get("publication_year"),
        "venue": source.get("display_name") or "",
        "doi": doi,
        "url": doi or landing_url or work.get("id", ""),
        "language": work.get("language") or "",
        "abstract": get_abstract(
            work.get("abstract_inverted_index")
        ),
        "keywords": list(dict.fromkeys(
            keywords + topics
        )),
        "method": "",
        "novelty": "",
        "matched_queries": [term],
        "source": "OpenAlex",
        "first_seen": TODAY.isoformat(),
        "last_seen": TODAY.isoformat(),
        "verified_status": "待核验",
    }


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    papers_by_key = {}
    errors = []

    for term in SEARCH_TERMS:
        try:
            works = fetch_works(term)
            print(
                f"关键词：{term}，"
                f"返回 {len(works)} 条记录"
            )

            for work in works:
                paper = convert_work(work, term)

                if not paper:
                    continue

                doi_key = paper["doi"].lower().strip()

                if doi_key:
                    key = doi_key
                else:
                    key = (
                        normalize_title(paper["title"])
                        + "_"
                        + str(paper["year"])
                    )

                if key in papers_by_key:
                    existing = papers_by_key[key]

                    existing["matched_queries"] = list(
                        dict.fromkeys(
                            existing["matched_queries"]
                            + paper["matched_queries"]
                        )
                    )

                    if (
                        not existing["abstract"]
                        and paper["abstract"]
                    ):
                        existing["abstract"] = paper["abstract"]

                    continue

                papers_by_key[key] = paper

            time.sleep(0.3)

        except Exception as exc:
            errors.append({
                "query": term,
                "error": str(exc),
            })
            print(f"检索失败：{term}，原因：{exc}")

    papers = list(papers_by_key.values())

    papers.sort(
        key=lambda p: (
            len(p["matched_queries"]),
            p["year"] or 0,
        ),
        reverse=True,
    )

    papers = papers[:50]

    if not papers:
        raise RuntimeError(
            "没有成功获取论文数据；"
            "为避免误覆盖，不生成空结果文件。"
        )

    output = {
        "generated_at": datetime.now(
            timezone.utc
        ).isoformat(timespec="seconds"),
        "window_start": START_DATE.isoformat(),
        "window_end": TODAY.isoformat(),
        "candidate_count": len(papers),
        "errors": errors,
        "papers": papers,
    }

    OUTPUT_FILE.write_text(
        json.dumps(
            output,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"候选论文数量：{len(papers)}")
    print(f"结果文件：{OUTPUT_FILE}")


if __name__ == "__main__":
    main()
