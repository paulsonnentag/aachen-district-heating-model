"""Cell-level inputs of the Aachen heat transition model, built from the raw public downloads.

Each step below is a node of the pipeline: it gets one keyword argument per input and returns a
dict with one entry per output. Raw downloads arrive as file paths and tables as dicts of columns.
The read_* steps decode the downloads into tables without changing their content; the later steps
join them and sum them per Zensus 2022 100 m grid cell, named like the NRW heat demand model's
Raster_ID (e.g. 100mN30733E40528), and return one row per cell: its coordinates, then the value.
Shapefiles are streamed straight out of the zip and only the columns used here are decoded.
"""

import csv
import io
import json
import struct
import zipfile
from collections import defaultdict

from pyproj import Transformer

RENOVATION_PATHWAYS = {"moderat": "m", "erhoeht": "e", "hoch": "h"}
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
CENSUS_MEMBER = "Zensus2022_Gebaeude_nach_Energietraeger_der_Heizung_100m-Gitter.csv"
BUILDINGS = "WBM-NRW_05334002_Aachen"
HEAT_LINES = "WBM-NRW-Waermelinien_05334002_Aachen"


def read_buildings(nrw: str) -> dict:
    """Heated buildings of the base heat demand model, with their cell and the centre of their footprint."""
    columns = ["Fest_ID", "Raster_ID", "WG_NWG", "RW_WW", "JAZ_Luft", "WLD_ID", "beheizt"]
    buildings = []
    with zipfile.ZipFile(nrw) as archive, open_member(archive, f"{BUILDINGS}.dbf") as dbf, open_member(archive, f"{BUILDINGS}.shp") as shp:
        for record, (x0, y0, x1, y1) in zip(dbf_records(dbf, columns), shape_bboxes(shp)):
            if record["beheizt"] != 1:
                continue
            buildings.append({
                "id": record["Fest_ID"],
                "cell": record["Raster_ID"],
                "residential": record["WG_NWG"] == "WG",
                "demand_kwh": record["RW_WW"],
                "spf_air": record["JAZ_Luft"],
                "heat_line": record["WLD_ID"],
                "location": {"type": "Point", "coordinates": [(x0 + x1) / 2, (y0 + y1) / 2]},
            })
    print(f"{len(buildings)} heated buildings in the NRW model")
    return {"buildings": table_of(buildings)}


def read_projections(nrw: str, buildings: dict) -> dict:
    """Projected demand (kWh/year) of each heated building, one column per renovation pathway and year."""
    heated = set(buildings["id"])
    projected = {}
    with zipfile.ZipFile(nrw) as archive:
        for pathway, letter in RENOVATION_PATHWAYS.items():
            columns = {year: f"RW_WW_{letter}_{year % 100}" for year in PROJECTION_YEARS}
            with open_member(archive, f"WBM-NRW-{pathway}_05334002_Aachen.dbf") as dbf:
                for record in dbf_records(dbf, ["Fest_ID", *columns.values()]):
                    if record["Fest_ID"] not in heated:
                        continue
                    row = projected.setdefault(record["Fest_ID"], {"id": record["Fest_ID"]})
                    for year, column in columns.items():
                        row[f"{pathway}_{year}"] = record[column]
    print(f"projections for {len(projected)} of {len(heated)} heated buildings")
    return {"building_projections": table_of(list(projected.values()))}


def read_heat_lines(nrw: str) -> dict:
    """The model's heat lines: street segments with heat demand, with their length and course."""
    with zipfile.ZipFile(nrw) as archive, open_member(archive, f"{HEAT_LINES}.dbf") as dbf, open_member(archive, f"{HEAT_LINES}.shp") as shp:
        lines = [
            {"id": record["WLD_ID"], "street_length": record["Strassenla"], "course": course}
            for record, course in zip(dbf_records(dbf, ["WLD_ID", "Strassenla"]), shape_lines(shp))
        ]
    print(f"{len(lines)} heat lines")
    return {"heat_lines": table_of(lines)}


def read_census(census: str, buildings: dict) -> dict:
    """Census counts by heating energy carrier for the cells that hold heated buildings of the NRW
    model. "–" means exactly zero or perturbed to zero by the Cell-Key method, so it reads as 0."""
    wanted = set(buildings["cell"])
    rows = []
    with zipfile.ZipFile(census) as archive:
        member = next(n for n in archive.namelist() if n.endswith(CENSUS_MEMBER))
        with archive.open(member) as raw:
            for row in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8"), delimiter=";"):
                cell = compact_cell_id(row["GITTER_ID_100m"])
                if cell in wanted:
                    counts = {k: parse_count(v) for k, v in row.items() if k not in ("GITTER_ID_100m", "x_mp_100m", "y_mp_100m")}
                    rows.append({"cell": cell, **counts})
    print(f"{len(rows)} of {len(wanted)} cells with heated buildings have census counts")
    return {"census_cells": table_of(rows)}


def read_heat_plan(heat_plan: str) -> dict:
    """Building blocks of the adopted heat plan, with every published property and the block outline."""
    with open(heat_plan, encoding="utf-8") as f:
        features = json.load(f)["features"]
    blocks = [{"id": feature.get("id"), **feature["properties"], "geometry": feature["geometry"]} for feature in features]
    print(f"{len(blocks)} heat plan blocks")
    return {"heat_plan_blocks": table_of(blocks)}


def select_cells(census_cells: dict, buildings: dict) -> dict:
    """The model's cells: those with census counts and at least one heated residential building."""
    heated = defaultdict(int)
    residential = defaultdict(int)
    for b in rows_of(buildings):
        heated[b["cell"]] += 1
        if b["residential"]:
            residential[b["cell"]] += 1
    cells = sorted(set(census_cells["cell"]) & residential.keys())
    print(f"{len(cells)} cells have both census counts and heated residential buildings")
    return {"cells": table_of([{"cell": c, "heated_buildings": heated[c], "residential_buildings": residential[c]} for c in cells])}


def heating_stock(census_cells: dict, cells: dict) -> dict:
    """Buildings per cell and technology as published. Category counts and the cell total are
    perturbed independently, so their sums differ slightly; the model uses the categories."""
    census = {row["cell"]: row for row in rows_of(census_cells)}
    rows = [(cell, tech, sum(census[cell][c] for c in group)) for cell in cells["cell"] for tech, group in TECHS.items()]
    published_total = sum(census[cell]["Insgesamt_Energietraeger"] for cell in cells["cell"])
    print(f"heating stock: {sum(r[2] for r in rows)} buildings by category, {published_total} by published cell totals")
    return {"heating_stock": rows}


def heat_demand(buildings: dict, building_projections: dict, cells: dict) -> dict:
    """Space heating and hot water demand of all heated buildings per cell (MWh/year) for each
    renovation pathway: today's model value for 2022, then the pathway's projections."""
    wanted = set(cells["cell"])
    in_cells = [b for b in rows_of(buildings) if b["cell"] in wanted]
    projections = {row["id"]: row for row in rows_of(building_projections)}
    years = [2022, *PROJECTION_YEARS]
    rows = []
    for pathway in RENOVATION_PATHWAYS:
        demand = defaultdict(float)
        missing = 0
        for b in in_cells:
            demand[(b["cell"], 2022)] += b["demand_kwh"] / 1000
            row = projections.get(b["id"])
            projected = [row[f"{pathway}_{year}"] for year in PROJECTION_YEARS] if row else [None]
            if None in projected:
                missing += 1
                projected = [b["demand_kwh"]] * len(PROJECTION_YEARS)
            for year, value in zip(PROJECTION_YEARS, projected):
                demand[(b["cell"], year)] += value / 1000
        print(f"heat demand ({pathway}): {sum(demand[(c, 2022)] for c in wanted) / 1000:.0f} GWh in 2022, "
              f"{sum(demand[(c, 2045)] for c in wanted) / 1000:.0f} GWh in 2045; {missing} buildings without projection")
        rows += [(cell, pathway, year, round(demand[(cell, year)], 3)) for cell in cells["cell"] for year in years]
    return {"heat_demand": rows}


def street_length(buildings: dict, heat_lines: dict, cells: dict) -> dict:
    """Street length per cell: each heat line's length is split among cells by the demand of
    the buildings it serves, so a street shared by two cells counts once overall."""
    lengths = {line["id"]: line["street_length"] for line in rows_of(heat_lines)}
    by_line = defaultdict(lambda: defaultdict(float))
    for b in rows_of(buildings):
        if b["heat_line"] in lengths and b["demand_kwh"] > 0:
            by_line[b["heat_line"]][b["cell"]] += b["demand_kwh"]
    length = defaultdict(float)
    for line, demand_by_cell in by_line.items():
        total = sum(demand_by_cell.values())
        for cell, demand in demand_by_cell.items():
            length[cell] += lengths[line] * demand / total
    zero = [c for c in cells["cell"] if length[c] <= 0]
    print(f"street length: {sum(length[c] for c in cells['cell']) / 1000:.0f} km over the cells; {len(zero)} cells without a heat line")
    return {"street_length": [(c, round(max(length[c], 1.0), 2)) for c in cells["cell"]]}


def heat_pump_spf(buildings: dict, cells: dict) -> dict:
    """Demand-weighted mean seasonal performance factor of an air-source heat pump in the
    cell's residential buildings, as estimated per building by the NRW model."""
    weighted = defaultdict(float)
    weights = defaultdict(float)
    for b in rows_of(buildings):
        if b["residential"] and b["spf_air"] and b["demand_kwh"] > 0:
            weighted[b["cell"]] += b["spf_air"] * b["demand_kwh"]
            weights[b["cell"]] += b["demand_kwh"]
    missing = [c for c in cells["cell"] if weights[c] <= 0]
    if missing:
        raise ValueError(f"{len(missing)} cells have no residential building with a heat pump estimate")
    return {"heat_pump_spf": [(c, round(weighted[c] / weights[c], 4)) for c in cells["cell"]]}


def locate_buildings(buildings: dict, heat_plan_blocks: dict) -> dict:
    """Each heated building's heat plan block and the first plan year in which that block is
    supplied by district or local heating. Blocks are matched in EPSG:25832, like the buildings."""
    index = BlockIndex(plan_blocks(heat_plan_blocks))
    rows = []
    for b in rows_of(buildings):
        block = index.find(*b["location"]["coordinates"])
        rows.append({
            "id": b["id"],
            "cell": b["cell"],
            "block": block["id"] if block else None,
            "first_network_year": block["first_year"] if block else None,
            "location": b["location"],
        })
    print(f"heat plan: {sum(r['block'] is None for r in rows)} of {len(rows)} heated buildings outside any block")
    return {"building_blocks": table_of(rows)}


def dh_expansion_year(buildings: dict, building_blocks: dict, cells: dict) -> dict:
    """Year from which district heating is available per cell: the first heat plan year by
    which blocks holding at least half the cell's demand are supplied by a heat network."""
    wanted = set(cells["cell"])
    first_year = {row["id"]: row["first_network_year"] for row in rows_of(building_blocks)}
    demand_by_year = defaultdict(lambda: defaultdict(float))
    for b in rows_of(buildings):
        year = first_year[b["id"]]
        if b["cell"] in wanted and year is not None:
            demand_by_year[b["cell"]][year] += b["demand_kwh"]
    rows = [(c, availability_year(demand_by_year[c])) for c in cells["cell"]]
    counts = defaultdict(int)
    for _, year in rows:
        counts[year] += 1
    print(f"cells by first network year {dict(sorted(counts.items()))}")
    return {"dh_expansion_year": rows}


def heat_plan_network_share(heat_plan_blocks: dict) -> dict:
    """The plan's city-wide network heat share per year, as a benchmark for the model."""
    blocks = rows_of(heat_plan_blocks)
    rows = []
    for year in HEAT_PLAN_YEARS:
        network = sum(network_heat(b, year) for b in blocks)
        total = sum(sum(v or 0 for k, v in b.items() if k.startswith("q_") and k.endswith(f"_{year % 100}")) for b in blocks)
        rows.append((year, round(network / total, 5)))
    print(f"heat plan network heat share: {rows}")
    return {"heat_plan_network_share": rows}


def rows_of(table: dict[str, list]) -> list[dict]:
    """A table's rows as dicts, one key per column."""
    names = list(table)
    return [dict(zip(names, values)) for values in zip(*table.values())]


def table_of(rows: list[dict]) -> dict[str, list]:
    """Rows as a table: one list per column, None where a row has no value."""
    names = list(dict.fromkeys(name for row in rows for name in row))
    return {name: [row.get(name) for row in rows] for name in names}


def plan_blocks(table: dict) -> list[dict]:
    """Heat plan blocks with their outline in EPSG:25832 and the first year a heat network supplies them."""
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
    blocks = []
    for row in rows_of(table):
        first = next((year for year in HEAT_PLAN_YEARS if network_heat(row, year) > 0), NOT_PLANNED)
        polygons = [
            [[to_utm.transform(x, y) for x, y in ring] for ring in polygon]
            for polygon in multipolygon(row["geometry"])
        ]
        blocks.append({"id": row["id"], "first_year": first, "polygons": polygons, "bbox": bbox_of(polygons)})
    return blocks


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


def open_member(archive: zipfile.ZipFile, name: str):
    member = next((n for n in archive.namelist() if n.endswith(f"/{name}") or n == name), None)
    if member is None:
        raise FileNotFoundError(f"{name} is not in the archive")
    return archive.open(member)


def dbf_records(stream, columns: list[str]):
    """Rows of a dBASE table, read sequentially, with only the named columns decoded.
    Numbers without decimals become ints, blanks become None, deleted rows are skipped."""
    header = stream.read(32)
    count, header_length, record_length = struct.unpack("<IHH", header[4:12])
    fields = {}
    offset = 1
    descriptors = stream.read(header_length - 32)
    for i in range(0, len(descriptors) - 1, 32):
        descriptor = descriptors[i : i + 32]
        if descriptor[0] == 0x0D:
            break
        name = descriptor[:11].split(b"\0")[0].decode("ascii")
        kind, length, decimals = chr(descriptor[11]), descriptor[16], descriptor[17]
        fields[name] = (offset, length, kind, decimals)
        offset += length
    missing = [c for c in columns if c not in fields]
    if missing:
        raise KeyError(f"dBASE table has no column {', '.join(missing)}")
    wanted = [(c, *fields[c]) for c in columns]
    for _ in range(count):
        record = stream.read(record_length)
        if record[:1] == b"*":
            continue
        yield {name: dbf_value(record[start : start + length], kind, decimals) for name, start, length, kind, decimals in wanted}


def dbf_value(raw: bytes, kind: str, decimals: int):
    text = raw.decode("utf-8", errors="replace").strip()
    if kind in "NF":
        if not text or text.strip("*") == "":
            return None
        return float(text) if decimals > 0 or "." in text else int(text)
    return text


def shape_bboxes(stream):
    """Bounding box of every record of a polygon shapefile, in file order."""
    stream.read(100)
    while header := stream.read(8):
        _, words = struct.unpack(">ii", header)
        content = stream.read(words * 2)
        yield struct.unpack("<4d", content[4:36])


def shape_lines(stream):
    """Every record of a polyline shapefile as a GeoJSON line, in file order, to the decimetre."""
    stream.read(100)
    while header := stream.read(8):
        _, words = struct.unpack(">ii", header)
        content = stream.read(words * 2)
        if struct.unpack("<i", content[:4])[0] == 0:
            yield None
            continue
        parts, count = struct.unpack("<2i", content[36:44])
        starts = struct.unpack(f"<{parts}i", content[44 : 44 + 4 * parts])
        xy = struct.unpack(f"<{2 * count}d", content[44 + 4 * parts : 44 + 4 * parts + 16 * count])
        points = [[round(xy[2 * i], 1), round(xy[2 * i + 1], 1)] for i in range(count)]
        lines = [points[a:b] for a, b in zip(starts, [*starts[1:], count])]
        yield {"type": "LineString", "coordinates": lines[0]} if len(lines) == 1 else {"type": "MultiLineString", "coordinates": lines}
