
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path


# 项目目录与数据文件
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

INCOMING_FILE = DATA_DIR / "incoming_papers.json"
PAPERS_FILE = DATA_DIR / "papers.json"
RUNS_FILE = DATA_DIR / "runs.json"

BEIJING_TZ = timezone(timedelta(hours=8))


def now_text():
    """返回北京时间。"""
    return datetime.now(BEIJING_TZ).isoformat(
        timespec="seconds"
    )


def read_json(path, default):
    """读取 JSON 文件；文件不存在时返回默认值。"""
    if not path.exists():
        return default

    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path, data):
    """先写临时文件，再替换目标文件，降低写入中断风险。"""
    temp_path = path.with_suffix(path.suffix + ".tmp")

    with temp_path.open("w", encoding="utf-8") as file:
        json.dump(
            data,
            file,
            ensure_ascii=False,
            indent=2,
        )
        file.write("\n")

    temp_path.replace(path)


def normalize_doi(doi):
    """统一 DOI 格式，便于去重。"""
    doi = (doi or "").strip().lower()

    doi = re.sub(
        r"^https?://(dx\.)?doi\.org/",
        "",
        doi,
    )

    return doi.rstrip("/")


def normalize_title(title):
    """标准化标题，作为没有 DOI 时的辅助去重依据。"""
    return re.sub(
        r"[\W_]+",
        "",
        (title or "").lower(),
        flags=re.UNICODE,
    )


def paper_key(paper):
    """优先用 DOI 去重；没有 DOI 时使用标题和年份。"""
    doi = normalize_doi(paper.get("doi"))

    if doi:
        return "doi:" + doi

    title = normalize_title(paper.get("title"))
    year = paper.get("year")

    if not title:
        raise ValueError("发现缺少标题的论文记录")

    return f"title:{title}|year:{year or ''}"


def is_test_record(paper):
    """排除最初用于测试网页的演示论文。"""
    title = str(paper.get("title") or "")

    return title.startswith("【测试数据】")


def merge_paper(existing, incoming, today):
    """合并重复论文：补充空字段，不覆盖已有有效信息。"""
    existing["last_seen"] = today

    for field in (
        "abstract",
        "venue",
        "doi",
        "url",
        "language",
        "authors",
        "keywords",
        "method",
        "novelty",
        "verified_status",
    ):
        old_value = existing.get(field)
        new_value = incoming.get(field)

        if (
            old_value in (None, "", [])
            and new_value not in (None, "", [])
        ):
            existing[field] = new_value

    old_queries = existing.get("matched_queries", [])
    new_queries = incoming.get("matched_queries", [])

    if not isinstance(old_queries, list):
        old_queries = []

    if not isinstance(new_queries, list):
        new_queries = []

    existing["matched_queries"] = list(
        dict.fromkeys(old_queries + new_queries)
    )


def main():
    if not INCOMING_FILE.exists():
        raise FileNotFoundError(
            "没有找到 data/incoming_papers.json。"
            "请先成功运行 search_papers.py。"
        )

    incoming_data = read_json(INCOMING_FILE, {})
    incoming = incoming_data.get("papers", [])

    if not isinstance(incoming, list) or not incoming:
        raise ValueError(
            "本次检索结果为空或格式错误，"
            "为保护历史数据，本次不更新总库。"
        )

    # 先完整读取和校验数据，再修改目标文件。
    for paper in incoming:
        if not isinstance(paper, dict):
            raise ValueError("检索结果中存在非对象记录")

        if not paper.get("title"):
            raise ValueError("检索结果中存在缺少标题的记录")

    existing_data = read_json(
        PAPERS_FILE,
        {"papers": []},
    )

    runs_data = read_json(
        RUNS_FILE,
        {"runs": []},
    )

    existing_papers = existing_data.get("papers", [])
    runs = runs_data.get("runs", [])

    if not isinstance(existing_papers, list):
        raise ValueError("papers.json 格式错误")

    if not isinstance(runs, list):
        raise ValueError("runs.json 格式错误")

    today = datetime.now(BEIJING_TZ).date().isoformat()

    # 排除网页初始化时的测试论文。
    existing_papers = [
        paper
        for paper in existing_papers
        if not is_test_record(paper)
    ]

    paper_map = {}

    for paper in existing_papers:
        key = paper_key(paper)

        if key in paper_map:
            # 清理总库中已有的重复记录。
            merge_paper(paper_map[key], paper, today)
        else:
            paper_map[key] = paper

    candidate_count = len(incoming)
    new_count = 0
    duplicate_count = 0

    for paper in incoming:
        key = paper_key(paper)

        if key in paper_map:
            merge_paper(
                paper_map[key],
                paper,
                today,
            )
            duplicate_count += 1
        else:
            new_paper = dict(paper)
            new_paper["first_seen"] = (
                new_paper.get("first_seen") or today
            )
            new_paper["last_seen"] = today

            paper_map[key] = new_paper
            new_count += 1

    all_papers = list(paper_map.values())

    all_papers.sort(
        key=lambda paper: (
            paper.get("year") or 0,
            paper.get("title") or "",
        ),
        reverse=True,
    )

    errors = incoming_data.get("errors", [])

    run_record = {
        "run_date": today,
        "completed_at": now_text(),
        "candidate_count": candidate_count,
        "new_count": new_count,
        "duplicate_count": duplicate_count,
        "total_count": len(all_papers),
        "error_count": len(errors),
        "status": "partial" if errors else "success",
        "errors": errors,
    }

    # 保留现有数据格式。
    papers_output = dict(existing_data)
    papers_output["papers"] = all_papers
    papers_output["updated_at"] = now_text()

    runs.append(run_record)

    runs_output = dict(runs_data)
    runs_output["runs"] = runs

    # 先写入总库，再更新运行日志。
    write_json(PAPERS_FILE, papers_output)
    write_json(RUNS_FILE, runs_output)

    # 合并成功后清除临时结果，避免把同一批候选结果
    # 长期留在仓库中；正式总库仍保留全部历史论文。
    INCOMING_FILE.unlink(missing_ok=True)

    print("论文总库更新成功")
    print(f"本次候选论文：{candidate_count}")
    print(f"新增论文：{new_count}")
    print(f"重复论文：{duplicate_count}")
    print(f"总库论文数：{len(all_papers)}")
    print(f"本次运行状态：{run_record['status']}")


if __name__ == "__main__":
    main()
