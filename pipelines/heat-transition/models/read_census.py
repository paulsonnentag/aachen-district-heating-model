import csv
import io
import zipfile

import pandas as pd

MEMBER = "Gebaeude_mit_Wohnraum_nach_Energietraeger_der_Heizung/Zensus2022_Gebaeude_nach_Energietraeger_der_Heizung_100m-Gitter.csv"
NOT_COUNTS = ("GITTER_ID_100m", "x_mp_100m", "y_mp_100m")


def compact_cell_id(inspire_id):
    """CRS3035RES100mN3073300E4052800 -> 100mN30733E40528, the NRW model's Raster_ID."""
    north = inspire_id[inspire_id.index("mN") + 2 : inspire_id.rindex("E")]
    east = inspire_id[inspire_id.rindex("E") + 1 :]
    return f"100mN{int(north) // 100}E{int(east) // 100}"


def count(value):
    """"–" is exactly zero or perturbed to zero by the Cell-Key method."""
    value = value.strip()
    return 0 if value in ("–", "-") else int(value)


wanted = set(buildings["cell"])
rows = []
with zipfile.ZipFile(census_heating_grid) as archive, archive.open(MEMBER) as raw:
    for row in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8"), delimiter=";"):
        cell = compact_cell_id(row["GITTER_ID_100m"])
        if cell in wanted:
            rows.append({"cell": cell, **{k: count(v) for k, v in row.items() if k not in NOT_COUNTS}})

census_cells = pd.DataFrame(rows)
