"""Builds the cell-level datasets of the Aachen heat transition pipeline from public sources.

Run from the repository root:

    python3 -m venv .venv && .venv/bin/pip install pyshp pyproj
    .venv/bin/python prep/heat-transition/prepare.py

Raw downloads are cached in prep/heat-transition/raw/ (not committed). Outputs go to
pipelines/heat-transition/data/. The unit of analysis is the Zensus 2022 100 m grid cell,
named like the NRW heat demand model's Raster_ID (e.g. 100mN30733E40528).

Sources:
- NRW Raumwärmebedarfsmodell (LANUK, KWP package for Aachen 05334002), licence DL-DE Zero 2.0
- Zensus 2022, buildings with living space by heating energy carrier, 100 m grid, dl-de/by-2-0
- Stadt Aachen, kommunaler Wärmeplan, WFS layer app:kwp_baubloecke_join
"""

import csv
import io
import json
import math
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

import shapefile
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "prep" / "heat-transition" / "raw"
OUT = ROOT / "pipelines" / "heat-transition" / "data"

NRW_URL = "https://www.opengeodata.nrw.de/produkte/umwelt_klima/energie/kwp/KWP-NRW_05334002_Aachen_EPSG25832_Shape.zip"
ZENSUS_URL = "https://www.destatis.de/static/DE/zensus/gitterdaten/Gebaeude_mit_Wohnraum_nach_Energietraeger_der_Heizung.zip"
ZENSUS_MEMBER = "Zensus2022_Gebaeude_nach_Energietraeger_der_Heizung_100m-Gitter.csv"
HEAT_PLAN_URL = (
    "https://wms.aachen.de/geofachdaten/services/kwp_wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
    "&TYPENAMES=app:kwp_baubloecke_join&OUTPUTFORMAT=application/geo%2Bjson"
)

RENOVATION_SCENARIOS = ["moderat", "erhoeht", "hoch"]
PROJECTION_YEARS = [2025, 2030, 2035, 2040, 2045]
HEAT_PLAN_YEARS = [2022, 2030, 2035, 2040, 2045]
NOT_PLANNED = 2100

# Zensus energy carrier columns grouped into the model's technologies.
TECHS = {
    "gas": ["Gas"],
    "oil": ["Heizoel"],
    "hp": ["Solar_Geothermie_Waermepumpen"],
    "dh": ["Fernwaerme"],
    "biomass": ["Holz_Holzpellets", "Biomasse_Biogas"],
    "electric": ["Strom"],
    "other": ["Kohle", "kein_Energietraeger"],
}


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    nrw_dir = unpack(download(NRW_URL, "nrw_aachen.zip"), RAW / "nrw")
    buildings = read_buildings(nrw_dir)
    census = read_census(download(ZENSUS_URL, "zensus_energietraeger.zip"), {b["cell"] for b in buildings})
    cells = sorted(census.keys() & {b["cell"] for b in buildings if b["residential"]})
    report(f"{len(cells)} cells have both census counts and heated residential buildings")
    in_cells = [b for b in buildings if b["cell"] in census]

    write_heating_stock(cells, census)
    for scenario in RENOVATION_SCENARIOS:
        write_heat_demand(cells, in_cells, read_projections(nrw_dir, scenario), scenario)
    write_street_length(cells, buildings, read_heat_lines(nrw_dir))
    write_heat_pump_spf(cells, in_cells)
    blocks = read_heat_plan(download(HEAT_PLAN_URL, "kwp_baubloecke.geojson"))
    write_heat_plan(cells, in_cells, blocks)


def read_buildings(nrw_dir: Path) -> list[dict]:
    """Heated buildings of the base heat demand model, with their cell and centroid."""
    reader = shapefile.Reader(str(nrw_dir / "WBM-NRW_05334002_Aachen"), encoding="utf-8", encodingErrors="replace")
    fields = [f[0] for f in reader.fields[1:]]
    buildings = []
    for shape_record in reader.iterShapeRecords():
        record = dict(zip(fields, shape_record.record))
        if record["beheizt"] != 1:
            continue
        x0, y0, x1, y1 = shape_record.shape.bbox
        buildings.append({
            "id": record["Fest_ID"],
            "cell": record["Raster_ID"],
            "residential": record["WG_NWG"] == "WG",
            "demand_kwh": record["RW_WW"],
            "spf_air": record["JAZ_Luft"],
            "heat_line": record["WLD_ID"],
            "x": (x0 + x1) / 2,
            "y": (y0 + y1) / 2,
        })
    report(f"{len(buildings)} heated buildings in the NRW model")
    return buildings


def read_census(zip_path: Path, wanted_cells: set[str]) -> dict[str, dict[str, int]]:
    """Census rows of the given cells. "–" means exactly zero or perturbed to zero by the
    Cell-Key method, so it reads as 0."""
    rows = {}
    with zipfile.ZipFile(zip_path) as archive:
        member = next(n for n in archive.namelist() if n.endswith(ZENSUS_MEMBER))
        with archive.open(member) as raw:
            reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8"), delimiter=";")
            for row in reader:
                cell = compact_cell_id(row["GITTER_ID_100m"])
                if cell in wanted_cells:
                    rows[cell] = {k: parse_count(v) for k, v in row.items() if k not in ("GITTER_ID_100m", "x_mp_100m", "y_mp_100m")}
    return rows


def write_heating_stock(cells: list[str], census: dict) -> None:
    """Buildings per cell and technology as published. Category counts and the cell total are
    perturbed independently, so their sums differ slightly; the model uses the categories."""
    rows = [(cell, tech, sum(census[cell][c] for c in group)) for cell in cells for tech, group in TECHS.items()]
    published_total = sum(census[cell]["Insgesamt_Energietraeger"] for cell in cells)
    report(f"heating stock: {sum(r[2] for r in rows)} buildings by category, {published_total} by published cell totals")
    write_csv("heating_stock_2022.csv", ["cell", "tech", "buildings"], rows)


def read_projections(nrw_dir: Path, scenario: str) -> dict[int, dict[int, float]]:
    """Demand per building (kWh/year) for each projection year of one renovation scenario."""
    reader = shapefile.Reader(str(nrw_dir / f"WBM-NRW-{scenario}_05334002_Aachen"), encoding="utf-8", encodingErrors="replace")
    fields = [f[0] for f in reader.fields[1:]]
    columns = {year: f"RW_WW_{scenario[0]}_{year % 100}" for year in PROJECTION_YEARS}
    projections = {}
    for record in reader.iterRecords():
        row = dict(zip(fields, record))
        projections[row["Fest_ID"]] = {year: row[column] for year, column in columns.items()}
    return projections


def write_heat_demand(cells: list[str], buildings: list[dict], projections: dict, scenario: str) -> None:
    """Space heating and hot water demand of all heated buildings per cell (MWh/year):
    today's model value for 2022, then the scenario's projections."""
    demand = defaultdict(float)
    missing = 0
    for b in buildings:
        demand[(b["cell"], 2022)] += b["demand_kwh"] / 1000
        projected = projections.get(b["id"])
        if projected is None:
            missing += 1
            projected = {year: b["demand_kwh"] for year in PROJECTION_YEARS}
        for year in PROJECTION_YEARS:
            demand[(b["cell"], year)] += projected[year] / 1000
    years = [2022, *PROJECTION_YEARS]
    rows = [(cell, year, round(demand[(cell, year)], 3)) for cell in cells for year in years]
    report(f"heat demand ({scenario}): {sum(demand[(c, 2022)] for c in cells) / 1000:.0f} GWh in 2022, "
           f"{sum(demand[(c, 2045)] for c in cells) / 1000:.0f} GWh in 2045; {missing} buildings without projection")
    write_csv(f"heat_demand_{scenario}.csv", ["cell", "year", "demand"], rows)


def read_heat_lines(nrw_dir: Path) -> dict[int, float]:
    """Street segment length (m) by heat line id."""
    reader = shapefile.Reader(str(nrw_dir / "WBM-NRW-Waermelinien_05334002_Aachen"), encoding="utf-8", encodingErrors="replace")
    fields = [f[0] for f in reader.fields[1:]]
    return {row["WLD_ID"]: row["Strassenla"] for row in (dict(zip(fields, r)) for r in reader.iterRecords())}


def write_street_length(cells: list[str], buildings: list[dict], lengths: dict[int, float]) -> None:
    """Street length per cell: each heat line's length is split among cells by the demand of
    the buildings it serves, so a street shared by two cells counts once overall."""
    by_line = defaultdict(lambda: defaultdict(float))
    for b in buildings:
        if b["heat_line"] in lengths and b["demand_kwh"] > 0:
            by_line[b["heat_line"]][b["cell"]] += b["demand_kwh"]
    length = defaultdict(float)
    for line, demand_by_cell in by_line.items():
        total = sum(demand_by_cell.values())
        for cell, demand in demand_by_cell.items():
            length[cell] += lengths[line] * demand / total
    zero = [c for c in cells if length[c] <= 0]
    report(f"street length: {sum(length[c] for c in cells) / 1000:.0f} km over the cells; {len(zero)} cells without a heat line")
    write_csv("street_length.csv", ["cell", "length"], [(c, round(max(length[c], 1.0), 2)) for c in cells])


def write_heat_pump_spf(cells: list[str], buildings: list[dict]) -> None:
    """Demand-weighted mean seasonal performance factor of an air-source heat pump in the
    cell's residential buildings, as estimated per building by the NRW model."""
    weighted = defaultdict(float)
    weights = defaultdict(float)
    for b in buildings:
        if b["residential"] and b["spf_air"] and b["demand_kwh"] > 0:
            weighted[b["cell"]] += b["spf_air"] * b["demand_kwh"]
            weights[b["cell"]] += b["demand_kwh"]
    rows = [(c, round(weighted[c] / weights[c], 4)) for c in cells if weights[c] > 0]
    if len(rows) != len(cells):
        sys.exit("Some cells have no residential building with a heat pump estimate")
    write_csv("heat_pump_spf.csv", ["cell", "spf"], rows)


def read_heat_plan(path: Path) -> list[dict]:
    """Building blocks of the adopted heat plan with the first year their target scenario
    supplies district or local heating, in EPSG:25832."""
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
    blocks = []
    for feature in json.loads(path.read_text())["features"]:
        props = feature["properties"]
        first = next((year for year in HEAT_PLAN_YEARS if network_heat(props, year) > 0), NOT_PLANNED)
        polygons = [
            [[to_utm.transform(x, y) for x, y in ring] for ring in polygon]
            for polygon in multipolygon(feature["geometry"])
        ]
        blocks.append({"first_year": first, "polygons": polygons, "bbox": bbox_of(polygons), "props": props})
    return blocks


def write_heat_plan(cells: list[str], buildings: list[dict], blocks: list[dict]) -> None:
    """Year from which district heating is available per cell (the first heat plan year by which
    blocks holding at least half the cell's demand are supplied by a heat network), and the
    plan's city-wide network heat share per year as a benchmark."""
    index = BlockIndex(blocks)
    demand_by_year = defaultdict(lambda: defaultdict(float))
    unmatched = 0
    for b in buildings:
        block = index.find(b["x"], b["y"])
        if block is None:
            unmatched += 1
            continue
        demand_by_year[b["cell"]][block["first_year"]] += b["demand_kwh"]
    rows = [(c, availability_year(demand_by_year[c])) for c in cells]
    counts = defaultdict(int)
    for _, year in rows:
        counts[year] += 1
    report(f"heat plan: {unmatched} buildings outside any block; cells by first network year {dict(sorted(counts.items()))}")
    write_csv("dh_expansion_year.csv", ["cell", "year"], rows)

    shares = []
    for year in HEAT_PLAN_YEARS:
        network = sum(network_heat(b["props"], year) for b in blocks)
        total = sum(sum(v or 0 for k, v in b["props"].items() if k.startswith("q_") and k.endswith(f"_{year % 100}")) for b in blocks)
        shares.append((year, round(network / total, 5)))
    report(f"heat plan network heat share: {shares}")
    write_csv("heat_plan_network_share.csv", ["year", "share"], shares)


def availability_year(demand_by_year: dict[int, float]) -> int:
    total = sum(demand_by_year.values())
    covered = 0.0
    for year in [*HEAT_PLAN_YEARS, NOT_PLANNED]:
        covered += demand_by_year.get(year, 0.0)
        if total > 0 and covered >= total / 2:
            return year
    return NOT_PLANNED


def network_heat(props: dict, year: int) -> float:
    """District heating (Fernwärme) plus local heating (Nahwärme) supplied in a block (GWh/year)."""
    suffix = year % 100
    return (props.get(f"q_fw_{suffix}") or 0) + (props.get(f"q_nw_{suffix}") or 0)


class BlockIndex:
    """Point-in-polygon lookup over the heat plan blocks, bucketed on a 250 m grid."""

    SIZE = 250.0

    def __init__(self, blocks: list[dict]):
        self.buckets = defaultdict(list)
        for block in blocks:
            x0, y0, x1, y1 = block["bbox"]
            for i in range(int(x0 // self.SIZE), int(x1 // self.SIZE) + 1):
                for j in range(int(y0 // self.SIZE), int(y1 // self.SIZE) + 1):
                    self.buckets[(i, j)].append(block)

    def find(self, x: float, y: float) -> dict | None:
        for block in self.buckets.get((int(x // self.SIZE), int(y // self.SIZE)), []):
            x0, y0, x1, y1 = block["bbox"]
            if x0 <= x <= x1 and y0 <= y <= y1 and any(inside_polygon(x, y, p) for p in block["polygons"]):
                return block
        return None


def inside_polygon(x: float, y: float, rings: list[list[tuple[float, float]]]) -> bool:
    """Even-odd rule over the outer ring and its holes."""
    inside = False
    for ring in rings:
        for (xa, ya), (xb, yb) in zip(ring, ring[1:] + ring[:1]):
            if (ya > y) != (yb > y) and x < xa + (y - ya) * (xb - xa) / (yb - ya):
                inside = not inside
    return inside


def multipolygon(geometry: dict) -> list:
    return geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]


def bbox_of(polygons: list) -> tuple[float, float, float, float]:
    points = [p for polygon in polygons for ring in polygon for p in ring]
    return (min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points))


def compact_cell_id(inspire_id: str) -> str:
    """CRS3035RES100mN3073300E4052800 -> 100mN30733E40528, the NRW model's Raster_ID."""
    north = inspire_id[inspire_id.index("mN") + 2 : inspire_id.rindex("E")]
    east = inspire_id[inspire_id.rindex("E") + 1 :]
    return f"100mN{int(north) // 100}E{int(east) // 100}"


def parse_count(value: str) -> int:
    value = value.strip()
    return 0 if value in ("–", "-") else int(value)


def download(url: str, name: str) -> Path:
    path = RAW / name
    if not path.exists():
        report(f"downloading {url}")
        request = urllib.request.Request(url, headers={"User-Agent": "model-workbench prep"})
        with urllib.request.urlopen(request) as response:
            path.write_bytes(response.read())
    return path


def unpack(zip_path: Path, target: Path) -> Path:
    if not target.exists():
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(target)
    return target


def write_csv(name: str, header: list[str], rows: list[tuple]) -> None:
    with open(OUT / name, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)
    report(f"wrote {name} ({len(rows)} rows)")


def report(message: str) -> None:
    print(message, flush=True)


if __name__ == "__main__":
    main()
