import requests
from bs4 import BeautifulSoup
import argparse
import html
import re
import json
import subprocess
import tempfile
import os
import time
import sys
import math
from urllib.parse import urlparse
import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor

# Ensure UTF-8 output
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Default Settings
DEFAULT_BASE_URL = ""
DEFAULT_TOURNAMENT_PREFIX = ""
# These will be set based on user-provided Tabbycat tournament URL.

def clean_html(text):
    if not text:
        return ""
    if isinstance(text, float) and math.isnan(text):
        return ""
    cleaned = html.unescape(str(text))
    cleaned = re.sub(r'<[^>]+>', '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned

def parse_int(value):
    value = clean_html(value)
    if not value:
        return None
    match = re.search(r'-?\d+', value)
    return int(match.group(0)) if match else None

def parse_decimal(value):
    value = clean_html(value)
    if not value:
        return None
    match = re.search(r'-?\d+(?:\.\d+)?', value)
    return match.group(0) if match else None

def parse_percent_label(value):
    return parse_decimal(value)

def parse_round_name(value):
    value = clean_html(value)
    match = re.search(r'(\d+)', value)
    if match:
        return int(match.group(1)), f"Round {match.group(1)}"
    return None, value

def parse_team_round_result(value):
    value = clean_html(value)
    if not value:
        return None, None, ""
    score_match = re.search(r'\(([-+]?\d+(?:\.\d+)?)\)', value)
    rank_match = re.search(r'(\d+)', value)
    return (
        int(rank_match.group(1)) if rank_match else None,
        score_match.group(1) if score_match else None,
        value,
    )

def split_speakers(value):
    value = clean_html(value)
    if not value:
        return []
    return [clean_html(part) for part in value.split(",") if clean_html(part)]

def adjudicator_names(value):
    value = clean_html(value)
    if not value:
        return []
    value = re.sub(r'[ⒸⓉ]', '', value)
    return [clean_html(part) for part in value.split(",") if clean_html(part)]

def extract_js_object(text, start_offset):
    brace_count = 0
    in_string = False
    string_char = None
    escaped = False
    for i in range(start_offset, len(text)):
        char = text[i]
        if escaped:
            escaped = False
            continue
        if char == '\\':
            escaped = True
            continue
        if in_string:
            if char == string_char:
                in_string = False
            continue
        if char in ('"', "'", "`"):
            in_string = True
            string_char = char
            continue
        if char == '{':
            brace_count += 1
        elif char == '}':
            brace_count -= 1
            if brace_count == 0:
                return text[start_offset:i+1]
    return None

def parse_vue_data(html_content):
    start_idx = html_content.find('window.vueData =')
    if start_idx == -1:
        return None
    brace_idx = html_content.find('{', start_idx)
    if brace_idx == -1:
        return None
    obj_str = extract_js_object(html_content, brace_idx)
    if not obj_str:
        return None
    
    js_code = f"console.log(JSON.stringify({obj_str}));"
    with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(js_code)
        temp_path = f.name
    
    try:
        res = subprocess.run(['node', temp_path], capture_output=True, text=True, encoding='utf-8', check=True)
        return json.loads(res.stdout)
    except Exception as e:
        print(f"Error parsing Javascript object with Node: {e}")
        return None
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

def get_page(url):
    print(f"Fetching: {url}")
    try:
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        time.sleep(0.2) # Polite delay
        return r.text
    except Exception as e:
        print(f"Failed to fetch {url}: {e}")
        return None

def scrape_team_tab(base_url, prefix):
    print("\n--- Scraping Team Tab ---")
    url = f"{base_url}{prefix}/tab/team/"
    html = get_page(url)
    if not html:
        return []
    
    data = parse_vue_data(html)
    if not data or "tablesData" not in data or len(data["tablesData"]) == 0:
        print("Could not find team tablesData")
        return []
    
    table = data["tablesData"][0]
    headers = [h.get("title", h.get("key")) for h in table["head"]]
    print("Found headers:", headers)
    
    rows_data = []
    for row in table["data"]:
        rank = row[0].get("text", "")
        team_cell = row[1]
        team_name = team_cell.get("text", "")
        
        speakers = ""
        if "popover" in team_cell and "content" in team_cell["popover"]:
            content = team_cell["popover"]["content"]
            if len(content) > 0:
                speakers = content[0].get("text", "")
        
        category = row[2].get("text", "")
        
        # Round columns - Tabbycat typically lists rounds sequentially starting from cell index 3
        # Let's count how many round columns are present
        # In general, fields between 'category' (index 2) and 'Pts' (index -5) are rounds
        # Let's find index of 'Pts' or map it dynamically based on table headers
        pts_idx = -1
        for idx, h in enumerate(table["head"]):
            if h.get("key") == "Pts":
                pts_idx = idx
                break
        
        r_cols = {}
        if pts_idx != -1:
            for r_idx in range(3, pts_idx):
                r_name = table["head"][r_idx].get("title", f"Round {r_idx-2}")
                cell_val = row[r_idx]
                r_cols[r_name] = clean_html(cell_val.get("text", "")) + f" ({cell_val.get('subtext', '')})" if cell_val.get('subtext') else cell_val.get("text", "")
        
        pts = row[pts_idx].get("text", "") if pts_idx != -1 else ""
        spk = clean_html(row[pts_idx+1].get("text", "")) if pts_idx != -1 and pts_idx+1 < len(row) else ""
        firsts = row[pts_idx+2].get("text", "") if pts_idx != -1 and pts_idx+2 < len(row) else ""
        seconds = row[pts_idx+3].get("text", "") if pts_idx != -1 and pts_idx+3 < len(row) else ""
        ds = row[pts_idx+4].get("text", "") if pts_idx != -1 and pts_idx+4 < len(row) else ""
        
        row_dict = {
            "Rank": rank,
            "Team Name": team_name,
            "Speakers": speakers,
            "Category": category
        }
        row_dict.update(r_cols)
        row_dict.update({
            "Points": pts,
            "Speaker Score": spk,
            "1sts": firsts,
            "2nds": seconds,
            "Draw Strength": ds
        })
        rows_data.append(row_dict)
    
    return rows_data

def scrape_speaker_tab(base_url, prefix):
    print("\n--- Scraping Speaker Tab ---")
    url = f"{base_url}{prefix}/tab/speaker/"
    html = get_page(url)
    if not html:
        return []
    
    data = parse_vue_data(html)
    if not data or "tablesData" not in data or len(data["tablesData"]) == 0:
        print("Could not find speaker tablesData")
        return []
    
    table = data["tablesData"][0]
    
    # Identify indices
    total_idx = -1
    for idx, h in enumerate(table["head"]):
        if h.get("key") == "Total":
            total_idx = idx
            break
            
    rows_data = []
    for row in table["data"]:
        rank = row[0].get("text", "")
        speaker_name = row[1].get("text", "")
        category = row[2].get("text", "")
        team_name = row[3].get("text", "")
        
        r_cols = {}
        if total_idx != -1:
            for r_idx in range(4, total_idx):
                r_name = table["head"][r_idx].get("title", f"Round {r_idx-3}")
                r_cols[r_name] = row[r_idx].get("text", "")
        
        total = row[total_idx].get("text", "") if total_idx != -1 else ""
        avg = clean_html(row[total_idx+1].get("text", "")) if total_idx != -1 and total_idx+1 < len(row) else ""
        stdev = clean_html(row[total_idx+2].get("text", "")) if total_idx != -1 and total_idx+2 < len(row) else ""
        num_debates = row[total_idx+3].get("text", "") if total_idx != -1 and total_idx+3 < len(row) else ""
        
        row_dict = {
            "Rank": rank,
            "Speaker Name": speaker_name,
            "Category": category,
            "Team": team_name
        }
        row_dict.update(r_cols)
        row_dict.update({
            "Total Score": total,
            "Average": avg,
            "Std Dev": stdev,
            "Number of Debates": num_debates
        })
        rows_data.append(row_dict)
        
    return rows_data

def scrape_breaks(base_url, prefix):
    print("\n--- Scraping Breaks ---")
    breaks = {}
    
    # 1. Open Teams Break
    url_open = f"{base_url}{prefix}/break/teams/open/"
    html_open = get_page(url_open)
    if html_open:
        data_open = parse_vue_data(html_open)
        if data_open and "tablesData" in data_open and len(data_open["tablesData"]) > 0:
            t = data_open["tablesData"][0]
            rows = []
            for r in t["data"]:
                speakers = ""
                if len(r) > 2 and "popover" in r[2] and "content" in r[2]["popover"]:
                    speakers = r[2]["popover"]["content"][0].get("text", "")
                rows.append({
                    "Rank": r[0].get("text", "") if len(r) > 0 else "",
                    "Break Position": r[1].get("text", "") if len(r) > 1 else "",
                    "Team Name": r[2].get("text", "") if len(r) > 2 else "",
                    "Speakers": speakers,
                    "Points": r[3].get("text", "") if len(r) > 3 else "",
                    "Speaker Score": clean_html(r[4].get("text", "")) if len(r) > 4 else "",
                    "1sts": r[5].get("text", "") if len(r) > 5 else "",
                    "2nds": r[6].get("text", "") if len(r) > 6 else "",
                    "Draw Strength": r[7].get("text", "") if len(r) > 7 else ""
                })
            breaks["Open Teams Break"] = rows
            
    # 2. Novice Teams Break
    url_nov = f"{base_url}{prefix}/break/teams/novice/"
    html_nov = get_page(url_nov)
    if html_nov:
        data_nov = parse_vue_data(html_nov)
        if data_nov and "tablesData" in data_nov and len(data_nov["tablesData"]) > 0:
            t = data_nov["tablesData"][0]
            rows = []
            for r in t["data"]:
                speakers = ""
                if len(r) > 2 and "popover" in r[2] and "content" in r[2]["popover"]:
                    speakers = r[2]["popover"]["content"][0].get("text", "")
                rows.append({
                    "Rank": r[0].get("text", "") if len(r) > 0 else "",
                    "Break Position": r[1].get("text", "") if len(r) > 1 else "",
                    "Team Name": r[2].get("text", "") if len(r) > 2 else "",
                    "Speakers": speakers,
                    "Points": r[3].get("text", "") if len(r) > 3 else "",
                    "Speaker Score": clean_html(r[4].get("text", "")) if len(r) > 4 else "",
                    "1sts": r[5].get("text", "") if len(r) > 5 else "",
                    "2nds": r[6].get("text", "") if len(r) > 6 else "",
                    "Draw Strength": r[7].get("text", "") if len(r) > 7 else ""
                })
            breaks["Novice Teams Break"] = rows

    # 3. Adjudicators Break
    url_adj = f"{base_url}{prefix}/break/adjudicators/"
    html_adj = get_page(url_adj)
    if html_adj:
        data_adj = parse_vue_data(html_adj)
        if data_adj and "tablesData" in data_adj and len(data_adj["tablesData"]) > 0:
            t = data_adj["tablesData"][0]
            rows = []
            for r in t["data"]:
                rows.append({
                    "Adjudicator Name": clean_html(r[0].get("text", "")) if len(r) > 0 else "",
                    "Institution": r[1].get("text", "") if len(r) > 1 else "",
                    "Adj Core": "Yes" if len(r) > 2 and (r[2].get("sort", 0) == 1 or r[2].get("text")) else "No",
                    "Independent": "Yes" if len(r) > 3 and (r[3].get("sort", 0) == 1 or r[3].get("text")) else "No"
                })
            breaks["Adjudicators Break"] = rows

    return breaks

def scrape_motions(base_url, prefix):
    print("\n--- Scraping Motions Statistics ---")
    url = f"{base_url}{prefix}/motions/statistics/"
    html = get_page(url)
    if not html:
        return []
    
    soup = BeautifulSoup(html, "html.parser")
    motions_data = []
    
    list_items = soup.find_all(class_="list-group-item")
    current_round = None
    
    for item in list_items:
        classes = item.get("class", [])
        text = item.get_text()
        is_round_header = "disabled" in classes and ("Round" in text or "Quarter" in text or "Semi" in text or "Final" in text)
        if is_round_header:
            badge = item.find(class_="badge")
            if badge:
                current_round = badge.get_text(strip=True)
            else:
                current_round = text.strip()
            continue
        
        h4 = item.find("h4")
        if h4 and current_round:
            motion_text = clean_html(h4.get_text())
            
            info_slide = ""
            info_link = item.find("span", data_target=True)
            if info_link:
                modal_id = info_link["data-target"].replace("#", "")
                modal = soup.find("div", id=modal_id)
                if modal:
                    modal_body = modal.find(class_="modal-body")
                    if modal_body:
                        info_slide = clean_html(modal_body.get_text())
            
            gov_per = ""
            opp_per = ""
            open_per = ""
            clos_per = ""
            og_per = ""
            oo_per = ""
            cg_per = ""
            co_per = ""
            
            gov_bar = item.find(class_="progress-bar-gov")
            if gov_bar: gov_per = clean_html(gov_bar.get_text())
            opp_bar = item.find(class_="progress-bar-opp")
            if opp_bar: opp_per = clean_html(opp_bar.get_text())
            
            opening_bar = item.find(class_="progress-bar-opening")
            if opening_bar: open_per = clean_html(opening_bar.get_text())
            closing_bar = item.find(class_="progress-bar-closing")
            if closing_bar: clos_per = clean_html(closing_bar.get_text())
            
            og_bar = item.find(class_="progress-bar-og")
            if og_bar: og_per = clean_html(og_bar.get_text())
            oo_bar = item.find(class_="progress-bar-oo")
            if oo_bar: oo_per = clean_html(oo_bar.get_text())
            cg_bar = item.find(class_="progress-bar-cg")
            if cg_bar: cg_per = clean_html(cg_bar.get_text())
            co_bar = item.find(class_="progress-bar-co")
            if co_bar: co_per = clean_html(co_bar.get_text())
            
            motions_data.append({
                "Round": current_round,
                "Motion": motion_text,
                "Info Slide": info_slide,
                "Gov Avg Points": gov_per,
                "Opp Avg Points": opp_per,
                "Opening Avg Points": open_per,
                "Closing Avg Points": clos_per,
                "OG Avg Points": og_per,
                "OO Avg Points": oo_per,
                "CG Avg Points": cg_per,
                "CO Avg Points": co_per
            })
            
    return motions_data

def scrape_ballots_for_rounds(base_url, prefix, rounds):
    print("\n--- Scraping Round Results & Ballots ---")
    ballot_rows = []
    
    for round_num in rounds:
        url = f"{base_url}{prefix}/results/round/{round_num}/"
        html = get_page(url)
        if not html:
            continue
        
        data = parse_vue_data(html)
        if not data or "tablesData" not in data or len(data["tablesData"]) == 0:
            print(f"Could not parse results table for Round {round_num}")
            continue
        
        table = data["tablesData"][0]
        debates_to_scrape = {}
        
        for row in table["data"]:
            if len(row) < 5:
                continue
            team_cell = row[0]
            team_name = team_cell.get("text", "")
            result = row[1].get("text", "")
            side = row[2].get("text", "")
            
            ballot_cell = row[3]
            ballot_link = ballot_cell.get("link", "")
            
            adj_cell = row[4]
            adjudicators_text = clean_html(adj_cell.get("text", ""))
            
            if ballot_link:
                full_ballot_url = f"{base_url}{ballot_link}"
                if full_ballot_url not in debates_to_scrape:
                    debates_to_scrape[full_ballot_url] = {
                        "round": f"Round {round_num}",
                        "adjudicators": adjudicators_text
                    }
        
        print(f"Found {len(debates_to_scrape)} debates in Round {round_num}")
        
        for ballot_url, debate_meta in debates_to_scrape.items():
            ballot_html = get_page(ballot_url)
            if not ballot_html:
                continue
            
            soup = BeautifulSoup(ballot_html, "html.parser")
            
            room_name = ""
            small_tag = soup.find("small", class_="text-muted")
            if small_tag:
                room_name = clean_html(small_tag.get_text())
            
            motion = ""
            motion_card = soup.find(class_="card")
            if motion_card:
                card_title = motion_card.find(class_="card-title")
                if card_title and "Motion" in card_title.get_text():
                    motion = clean_html(motion_card.get_text().replace("Motion", ""))
            
            list_groups = soup.find_all("div", class_="list-group")
            for lg in list_groups:
                items = lg.find_all("li")
                if not items:
                    continue
                
                total_item = None
                for item in items:
                    if "Total for" in item.get_text():
                        total_item = item
                        break
                
                if not total_item:
                    continue
                
                total_text = clean_html(total_item.get_text())
                match = re.search(r'Total for\s+(.*?)\s+\((.*?)\)', total_text)
                team_name = ""
                side_name = ""
                if match:
                    team_name = match.group(1).strip()
                    side_name = match.group(2).strip()
                else:
                    team_name = total_text
                
                badge = total_item.find(class_="badge")
                team_total_score = badge.get_text(strip=True) if badge else ""
                
                for item in items:
                    if item == total_item:
                        continue
                    
                    role_tag = item.find("strong")
                    role = role_tag.get_text(strip=True) if role_tag else ""
                    
                    score_badge = item.find(class_="badge")
                    score = score_badge.get_text(strip=True) if score_badge else ""
                    
                    spk_text = clean_html(item.get_text())
                    if role:
                        spk_text = spk_text.replace(role, "", 1)
                    if score:
                        spk_text = spk_text.replace(score, "", 1)
                    speaker_name = spk_text.strip()
                    
                    ballot_rows.append({
                        "Round": debate_meta["round"],
                        "Room": room_name,
                        "Motion": motion,
                        "Side/Position": side_name,
                        "Team Name": team_name,
                        "Role": role,
                        "Speaker Name": speaker_name,
                        "Speaker Score": score,
                        "Team Total Score": team_total_score,
                        "Adjudicators": debate_meta["adjudicators"]
                    })
                    
    return ballot_rows

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS tournaments (
    id SERIAL PRIMARY KEY,
    source_url TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL,
    name TEXT,
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rounds (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    round_number INTEGER,
    name TEXT NOT NULL,
    UNIQUE (tournament_id, name)
);

CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT,
    UNIQUE (tournament_id, name)
);

CREATE TABLE IF NOT EXISTS speakers (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT,
    UNIQUE (tournament_id, name)
);

CREATE TABLE IF NOT EXISTS team_speakers (
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    speaker_id INTEGER NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
    speaker_order INTEGER,
    PRIMARY KEY (team_id, speaker_id)
);

CREATE TABLE IF NOT EXISTS team_tab_results (
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    rank_text TEXT,
    points NUMERIC(6,2),
    speaker_score NUMERIC(8,2),
    firsts INTEGER,
    seconds INTEGER,
    draw_strength NUMERIC(8,2),
    PRIMARY KEY (tournament_id, team_id)
);

CREATE TABLE IF NOT EXISTS team_round_results (
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    position_rank INTEGER,
    team_score NUMERIC(8,2),
    result_text TEXT,
    PRIMARY KEY (team_id, round_id)
);

CREATE TABLE IF NOT EXISTS speaker_tab_results (
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    speaker_id INTEGER NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
    team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    rank_text TEXT,
    total_score NUMERIC(8,2),
    average_score NUMERIC(6,2),
    score_stdev NUMERIC(6,2),
    debates_count INTEGER,
    PRIMARY KEY (tournament_id, speaker_id)
);

CREATE TABLE IF NOT EXISTS speaker_round_scores (
    speaker_id INTEGER NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
    team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    speaker_score NUMERIC(6,2),
    PRIMARY KEY (speaker_id, round_id)
);

CREATE TABLE IF NOT EXISTS motions (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    round_id INTEGER REFERENCES rounds(id) ON DELETE SET NULL,
    motion_text TEXT NOT NULL,
    info_slide TEXT,
    gov_avg_points NUMERIC(6,2),
    opp_avg_points NUMERIC(6,2),
    opening_avg_points NUMERIC(6,2),
    closing_avg_points NUMERIC(6,2),
    og_avg_points NUMERIC(6,2),
    oo_avg_points NUMERIC(6,2),
    cg_avg_points NUMERIC(6,2),
    co_avg_points NUMERIC(6,2),
    UNIQUE (tournament_id, motion_text)
);

CREATE TABLE IF NOT EXISTS debates (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    motion_id INTEGER REFERENCES motions(id) ON DELETE SET NULL,
    room TEXT NOT NULL,
    adjudicators_text TEXT,
    UNIQUE (tournament_id, round_id, room)
);

CREATE TABLE IF NOT EXISTS debate_teams (
    id SERIAL PRIMARY KEY,
    debate_id INTEGER NOT NULL REFERENCES debates(id) ON DELETE CASCADE,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    side_position TEXT NOT NULL,
    team_total_score NUMERIC(8,2),
    UNIQUE (debate_id, team_id, side_position)
);

CREATE TABLE IF NOT EXISTS speech_scores (
    id SERIAL PRIMARY KEY,
    debate_team_id INTEGER NOT NULL REFERENCES debate_teams(id) ON DELETE CASCADE,
    speaker_id INTEGER NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    speaker_score NUMERIC(6,2),
    UNIQUE (debate_team_id, speaker_id, role)
);

CREATE TABLE IF NOT EXISTS adjudicators (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    institution TEXT,
    is_adj_core BOOLEAN,
    is_independent BOOLEAN,
    UNIQUE (tournament_id, name)
);

CREATE TABLE IF NOT EXISTS debate_adjudicators (
    debate_id INTEGER NOT NULL REFERENCES debates(id) ON DELETE CASCADE,
    adjudicator_id INTEGER NOT NULL REFERENCES adjudicators(id) ON DELETE CASCADE,
    PRIMARY KEY (debate_id, adjudicator_id)
);

CREATE TABLE IF NOT EXISTS team_breaks (
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    break_category TEXT NOT NULL,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    rank INTEGER,
    break_position TEXT,
    points NUMERIC(6,2),
    speaker_score NUMERIC(8,2),
    firsts INTEGER,
    seconds INTEGER,
    draw_strength NUMERIC(8,2),
    PRIMARY KEY (tournament_id, break_category, team_id)
);

CREATE INDEX IF NOT EXISTS idx_rounds_tournament ON rounds(tournament_id);
CREATE INDEX IF NOT EXISTS idx_teams_tournament ON teams(tournament_id);
CREATE INDEX IF NOT EXISTS idx_speakers_tournament ON speakers(tournament_id);
CREATE INDEX IF NOT EXISTS idx_debates_round ON debates(round_id);
CREATE INDEX IF NOT EXISTS idx_speech_scores_speaker ON speech_scores(speaker_id);
"""

def default_connection_params(database="debate_analytics"):
    return {
        "host": os.getenv("PGHOST", "127.0.0.1"),
        "port": int(os.getenv("PGPORT", "5432")),
        "user": os.getenv("PGUSER", "postgres"),
        "password": os.getenv("PGPASSWORD", "SD2628"),
        "dbname": database,
    }

def database_exists(params, database_name):
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', database_name):
        raise ValueError("Database name must contain only letters, numbers, and underscores, and cannot start with a number.")
    admin_params = dict(params)
    admin_params["dbname"] = os.getenv("PGMAINTENANCE_DB", "postgres")
    conn = psycopg2.connect(**admin_params)
    try:
        conn.set_session(autocommit=True)
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (database_name,))
            exists = cur.fetchone() is not None
            if not exists:
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))
    finally:
        conn.close()
    return True

def connect_database(database_url=None, database_name="debate_analytics"):
    if database_url:
        return psycopg2.connect(database_url)
    params = default_connection_params(database_name)
    database_exists(params, database_name)
    return psycopg2.connect(**params)

def execute_schema(conn):
    with conn.cursor() as cur:
        cur.execute(SCHEMA_SQL)
    conn.commit()

def fetch_id(cur):
    row = cur.fetchone()
    return row["id"] if isinstance(row, dict) else row[0]

def upsert_tournament(cur, source_url, slug, name=None):
    cur.execute(
        """
        INSERT INTO tournaments (source_url, slug, name, scraped_at)
        VALUES (%s, %s, %s, now())
        ON CONFLICT (source_url)
        DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, scraped_at = now()
        RETURNING id
        """,
        (source_url, slug, name or slug.strip("/") or source_url),
    )
    return fetch_id(cur)

def upsert_round(cur, tournament_id, round_label):
    round_number, round_name = parse_round_name(round_label)
    cur.execute(
        """
        INSERT INTO rounds (tournament_id, round_number, name)
        VALUES (%s, %s, %s)
        ON CONFLICT (tournament_id, name)
        DO UPDATE SET round_number = EXCLUDED.round_number
        RETURNING id
        """,
        (tournament_id, round_number, round_name),
    )
    return fetch_id(cur)

def upsert_team(cur, tournament_id, name, category=None):
    name = clean_html(name)
    if not name:
        return None
    category = clean_html(category) or None
    cur.execute(
        """
        INSERT INTO teams (tournament_id, name, category)
        VALUES (%s, %s, %s)
        ON CONFLICT (tournament_id, name)
        DO UPDATE SET category = COALESCE(EXCLUDED.category, teams.category)
        RETURNING id
        """,
        (tournament_id, name, category),
    )
    return fetch_id(cur)

def upsert_speaker(cur, tournament_id, name, category=None):
    name = clean_html(name)
    if not name:
        return None
    category = clean_html(category) or None
    cur.execute(
        """
        INSERT INTO speakers (tournament_id, name, category)
        VALUES (%s, %s, %s)
        ON CONFLICT (tournament_id, name)
        DO UPDATE SET category = COALESCE(EXCLUDED.category, speakers.category)
        RETURNING id
        """,
        (tournament_id, name, category),
    )
    return fetch_id(cur)

def link_team_speakers(cur, team_id, speaker_ids):
    for idx, speaker_id in enumerate(speaker_ids, start=1):
        cur.execute(
            """
            INSERT INTO team_speakers (team_id, speaker_id, speaker_order)
            VALUES (%s, %s, %s)
            ON CONFLICT (team_id, speaker_id)
            DO UPDATE SET speaker_order = EXCLUDED.speaker_order
            """,
            (team_id, speaker_id, idx),
        )

def upsert_motion(cur, tournament_id, row):
    round_id = upsert_round(cur, tournament_id, row.get("Round"))
    cur.execute(
        """
        INSERT INTO motions (
            tournament_id, round_id, motion_text, info_slide,
            gov_avg_points, opp_avg_points, opening_avg_points, closing_avg_points,
            og_avg_points, oo_avg_points, cg_avg_points, co_avg_points
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (tournament_id, motion_text)
        DO UPDATE SET
            round_id = EXCLUDED.round_id,
            info_slide = EXCLUDED.info_slide,
            gov_avg_points = EXCLUDED.gov_avg_points,
            opp_avg_points = EXCLUDED.opp_avg_points,
            opening_avg_points = EXCLUDED.opening_avg_points,
            closing_avg_points = EXCLUDED.closing_avg_points,
            og_avg_points = EXCLUDED.og_avg_points,
            oo_avg_points = EXCLUDED.oo_avg_points,
            cg_avg_points = EXCLUDED.cg_avg_points,
            co_avg_points = EXCLUDED.co_avg_points
        RETURNING id
        """,
        (
            tournament_id,
            round_id,
            clean_html(row.get("Motion")),
            clean_html(row.get("Info Slide")) or None,
            parse_percent_label(row.get("Gov Avg Points")),
            parse_percent_label(row.get("Opp Avg Points")),
            parse_percent_label(row.get("Opening Avg Points")),
            parse_percent_label(row.get("Closing Avg Points")),
            parse_percent_label(row.get("OG Avg Points")),
            parse_percent_label(row.get("OO Avg Points")),
            parse_percent_label(row.get("CG Avg Points")),
            parse_percent_label(row.get("CO Avg Points")),
        ),
    )
    return fetch_id(cur)

def motion_id_for_text(cur, tournament_id, round_id, motion_text):
    motion_text = clean_html(motion_text)
    if not motion_text:
        return None
    cur.execute(
        """
        INSERT INTO motions (tournament_id, round_id, motion_text)
        VALUES (%s, %s, %s)
        ON CONFLICT (tournament_id, motion_text)
        DO UPDATE SET round_id = COALESCE(motions.round_id, EXCLUDED.round_id)
        RETURNING id
        """,
        (tournament_id, round_id, motion_text),
    )
    return fetch_id(cur)

def upsert_adjudicator(cur, tournament_id, name, institution=None, is_adj_core=None, is_independent=None):
    name = clean_html(name)
    if not name:
        return None
    cur.execute(
        """
        INSERT INTO adjudicators (tournament_id, name, institution, is_adj_core, is_independent)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (tournament_id, name)
        DO UPDATE SET
            institution = COALESCE(EXCLUDED.institution, adjudicators.institution),
            is_adj_core = COALESCE(EXCLUDED.is_adj_core, adjudicators.is_adj_core),
            is_independent = COALESCE(EXCLUDED.is_independent, adjudicators.is_independent)
        RETURNING id
        """,
        (tournament_id, name, clean_html(institution) or None, is_adj_core, is_independent),
    )
    return fetch_id(cur)

def persist_scraped_data(conn, source_url, prefix, team_data, speaker_data, motions_data, breaks, ballot_data):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        tournament_id = upsert_tournament(cur, source_url, prefix)

        for row in team_data:
            team_id = upsert_team(cur, tournament_id, row.get("Team Name"), row.get("Category"))
            if not team_id:
                continue
            speaker_ids = [
                upsert_speaker(cur, tournament_id, speaker_name)
                for speaker_name in split_speakers(row.get("Speakers"))
            ]
            link_team_speakers(cur, team_id, [sid for sid in speaker_ids if sid])
            cur.execute(
                """
                INSERT INTO team_tab_results (
                    tournament_id, team_id, rank_text, points, speaker_score,
                    firsts, seconds, draw_strength
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (tournament_id, team_id)
                DO UPDATE SET
                    rank_text = EXCLUDED.rank_text,
                    points = EXCLUDED.points,
                    speaker_score = EXCLUDED.speaker_score,
                    firsts = EXCLUDED.firsts,
                    seconds = EXCLUDED.seconds,
                    draw_strength = EXCLUDED.draw_strength
                """,
                (
                    tournament_id,
                    team_id,
                    clean_html(row.get("Rank")),
                    parse_decimal(row.get("Points")),
                    parse_decimal(row.get("Speaker Score")),
                    parse_int(row.get("1sts")),
                    parse_int(row.get("2nds")),
                    parse_decimal(row.get("Draw Strength")),
                ),
            )
            for key, value in row.items():
                if re.fullmatch(r'R\d+', str(key)):
                    round_id = upsert_round(cur, tournament_id, key.replace("R", "Round "))
                    position_rank, team_score, result_text = parse_team_round_result(value)
                    cur.execute(
                        """
                        INSERT INTO team_round_results (team_id, round_id, position_rank, team_score, result_text)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (team_id, round_id)
                        DO UPDATE SET
                            position_rank = EXCLUDED.position_rank,
                            team_score = EXCLUDED.team_score,
                            result_text = EXCLUDED.result_text
                        """,
                        (team_id, round_id, position_rank, team_score, result_text or None),
                    )

        for row in speaker_data:
            speaker_id = upsert_speaker(cur, tournament_id, row.get("Speaker Name"), row.get("Category"))
            team_id = upsert_team(cur, tournament_id, row.get("Team"))
            if not speaker_id:
                continue
            if team_id:
                link_team_speakers(cur, team_id, [speaker_id])
            cur.execute(
                """
                INSERT INTO speaker_tab_results (
                    tournament_id, speaker_id, team_id, rank_text, total_score,
                    average_score, score_stdev, debates_count
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (tournament_id, speaker_id)
                DO UPDATE SET
                    team_id = EXCLUDED.team_id,
                    rank_text = EXCLUDED.rank_text,
                    total_score = EXCLUDED.total_score,
                    average_score = EXCLUDED.average_score,
                    score_stdev = EXCLUDED.score_stdev,
                    debates_count = EXCLUDED.debates_count
                """,
                (
                    tournament_id,
                    speaker_id,
                    team_id,
                    clean_html(row.get("Rank")),
                    parse_decimal(row.get("Total Score")),
                    parse_decimal(row.get("Average")),
                    parse_decimal(row.get("Std Dev")),
                    parse_int(row.get("Number of Debates")),
                ),
            )
            for key, value in row.items():
                if re.fullmatch(r'R\d+', str(key)):
                    round_id = upsert_round(cur, tournament_id, key.replace("R", "Round "))
                    cur.execute(
                        """
                        INSERT INTO speaker_round_scores (speaker_id, team_id, round_id, speaker_score)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (speaker_id, round_id)
                        DO UPDATE SET team_id = EXCLUDED.team_id, speaker_score = EXCLUDED.speaker_score
                        """,
                        (speaker_id, team_id, round_id, parse_decimal(value)),
                    )

        for row in motions_data:
            if clean_html(row.get("Motion")):
                upsert_motion(cur, tournament_id, row)

        for break_key, break_rows in breaks.items():
            break_category = break_key.replace(" Teams Break", "").replace(" Break", "").lower()
            if break_key == "Adjudicators Break":
                for row in break_rows:
                    upsert_adjudicator(
                        cur,
                        tournament_id,
                        row.get("Adjudicator Name"),
                        row.get("Institution"),
                        clean_html(row.get("Adj Core")).lower() == "yes",
                        clean_html(row.get("Independent")).lower() == "yes",
                    )
                continue
            for row in break_rows:
                team_id = upsert_team(cur, tournament_id, row.get("Team Name"))
                if not team_id:
                    continue
                cur.execute(
                    """
                    INSERT INTO team_breaks (
                        tournament_id, break_category, team_id, rank, break_position,
                        points, speaker_score, firsts, seconds, draw_strength
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (tournament_id, break_category, team_id)
                    DO UPDATE SET
                        rank = EXCLUDED.rank,
                        break_position = EXCLUDED.break_position,
                        points = EXCLUDED.points,
                        speaker_score = EXCLUDED.speaker_score,
                        firsts = EXCLUDED.firsts,
                        seconds = EXCLUDED.seconds,
                        draw_strength = EXCLUDED.draw_strength
                    """,
                    (
                        tournament_id,
                        break_category,
                        team_id,
                        parse_int(row.get("Rank")),
                        clean_html(row.get("Break Position")),
                        parse_decimal(row.get("Points")),
                        parse_decimal(row.get("Speaker Score")),
                        parse_int(row.get("1sts")),
                        parse_int(row.get("2nds")),
                        parse_decimal(row.get("Draw Strength")),
                    ),
                )

        for row in ballot_data:
            round_id = upsert_round(cur, tournament_id, row.get("Round"))
            motion_id = motion_id_for_text(cur, tournament_id, round_id, row.get("Motion"))
            cur.execute(
                """
                INSERT INTO debates (tournament_id, round_id, motion_id, room, adjudicators_text)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (tournament_id, round_id, room)
                DO UPDATE SET motion_id = EXCLUDED.motion_id, adjudicators_text = EXCLUDED.adjudicators_text
                RETURNING id
                """,
                (
                    tournament_id,
                    round_id,
                    motion_id,
                    clean_html(row.get("Room")) or "Unknown room",
                    clean_html(row.get("Adjudicators")) or None,
                ),
            )
            debate_id = fetch_id(cur)
            for adj_name in adjudicator_names(row.get("Adjudicators")):
                adj_id = upsert_adjudicator(cur, tournament_id, adj_name)
                cur.execute(
                    """
                    INSERT INTO debate_adjudicators (debate_id, adjudicator_id)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (debate_id, adj_id),
                )

            team_id = upsert_team(cur, tournament_id, row.get("Team Name"))
            speaker_id = upsert_speaker(cur, tournament_id, row.get("Speaker Name"))
            if not team_id or not speaker_id:
                continue
            link_team_speakers(cur, team_id, [speaker_id])
            cur.execute(
                """
                INSERT INTO debate_teams (debate_id, team_id, side_position, team_total_score)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (debate_id, team_id, side_position)
                DO UPDATE SET team_total_score = EXCLUDED.team_total_score
                RETURNING id
                """,
                (
                    debate_id,
                    team_id,
                    clean_html(row.get("Side/Position")) or "Unknown",
                    parse_decimal(row.get("Team Total Score")),
                ),
            )
            debate_team_id = fetch_id(cur)
            cur.execute(
                """
                INSERT INTO speech_scores (debate_team_id, speaker_id, role, speaker_score)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (debate_team_id, speaker_id, role)
                DO UPDATE SET speaker_score = EXCLUDED.speaker_score
                """,
                (
                    debate_team_id,
                    speaker_id,
                    clean_html(row.get("Role")) or "Unknown",
                    parse_decimal(row.get("Speaker Score")),
                ),
            )

    conn.commit()

def print_import_summary(conn):
    tables = [
        "tournaments", "rounds", "teams", "speakers", "motions", "debates",
        "debate_teams", "speech_scores", "adjudicators", "team_breaks"
    ]
    with conn.cursor() as cur:
        print("\n--- Database Summary ---")
        for table in tables:
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            print(f"{table}: {cur.fetchone()[0]}")

def main():
    start_time = time.time()

    parser = argparse.ArgumentParser(
        description="Scrape a Tabbycat tournament and write normalized BP debate data to PostgreSQL."
    )
    parser.add_argument("url", nargs="?", help="Tabbycat tournament URL, e.g. https://tab.example.com/wds2026/")
    parser.add_argument(
        "--database",
        default=os.getenv("PGDATABASE", "debate_analytics"),
        help="PostgreSQL database name to create/use when DATABASE_URL is not set.",
    )
    parser.add_argument(
        "--database-url",
        default=os.getenv("DATABASE_URL"),
        help="Full PostgreSQL connection URL. Overrides PGHOST/PGPORT/PGUSER/PGPASSWORD/--database.",
    )
    args = parser.parse_args()

    custom_url = args.url or input("Enter Tabbycat tournament URL: ").strip()
    if not custom_url:
        print("No URL provided. Exiting.")
        sys.exit(1)
    print(f"Scraping tournament URL: {custom_url}")
    parsed_url = urlparse(custom_url)
    base_url = f"{parsed_url.scheme}://{parsed_url.netloc}"
    prefix = parsed_url.path.rstrip('/')
    
    print(f"Base URL: {base_url}")
    print(f"Tournament Prefix: {prefix}")
    
    # Discover rounds dynamically from home page
    home_url = f"{base_url}{prefix}/"
    home_html = get_page(home_url)
    
    rounds = []
    if home_html:
        # Match rounds inside href="/prefix/results/round/X/"
        matches = re.findall(rf'{prefix}/results/round/(\d+)/', home_html)
        if matches:
            rounds = sorted(list(set(int(m) for m in matches)))
            print(f"Discovered rounds dynamically: {rounds}")
    
    if not rounds:
        # Fallback
        rounds = list(range(1, 11))
        print(f"Could not discover rounds dynamically. Falling back to default list: {rounds}")

    team_data = scrape_team_tab(base_url, prefix)
    speaker_data = scrape_speaker_tab(base_url, prefix)
    motions_data = scrape_motions(base_url, prefix)
    breaks = scrape_breaks(base_url, prefix)
    ballot_data = scrape_ballots_for_rounds(base_url, prefix, rounds)

    database_label = "DATABASE_URL" if args.database_url else args.database
    print(f"\n--- Writing to PostgreSQL database: {database_label} ---")
    with connect_database(args.database_url, args.database) as conn:
        execute_schema(conn)
        persist_scraped_data(
            conn,
            custom_url.rstrip("/") + "/",
            prefix,
            team_data,
            speaker_data,
            motions_data,
            breaks,
            ballot_data,
        )
        print_import_summary(conn)

    print("\nSuccessfully gathered all data and stored it in PostgreSQL.")
    print(f"Total time elapsed: {time.time() - start_time:.2f} seconds")

if __name__ == "__main__":
    main()
