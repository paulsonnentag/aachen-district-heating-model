import zipfile

import pandas as pd
import shapefile

PATHWAYS = {"moderat": "m", "erhoeht": "e", "hoch": "h"}
YEARS = [2025, 2030, 2035, 2040, 2045]

projected = {}
with zipfile.ZipFile(nrw_heat_demand_model) as archive:
    for pathway, letter in PATHWAYS.items():
        fields = [f"RW_WW_{letter}_{year % 100}" for year in YEARS]
        reader = shapefile.Reader(dbf=archive.open(f"WBM-NRW-{pathway}_05334002_Aachen.dbf"))
        for record in reader.iterRecords(fields=["Fest_ID", *fields]):
            projected[record["Fest_ID"], pathway] = [record[f] for f in fields]

# A building without a complete projection in a pathway keeps its 2022 demand throughout it.
rows = []
for building in buildings.itertuples():
    row = {"id": building.id, "cell": building.cell}
    for pathway in PATHWAYS:
        values = projected.get((building.id, pathway))
        if values is None or None in values:
            values = [building.demand_kwh] * len(YEARS)
        row[f"{pathway}_2022"] = building.demand_kwh
        row.update({f"{pathway}_{year}": value for year, value in zip(YEARS, values)})
    rows.append(row)

building_projections = pd.DataFrame(rows)
