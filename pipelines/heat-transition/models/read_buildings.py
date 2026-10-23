import zipfile

import pandas as pd
import shapefile

LAYER = "WBM-NRW_05334002_Aachen"
FIELDS = ["Fest_ID", "Raster_ID", "WG_NWG", "RW_WW", "JAZ_Luft", "WLD_ID", "beheizt"]

with zipfile.ZipFile(nrw_heat_demand_model) as archive:
    reader = shapefile.Reader(shp=archive.open(f"{LAYER}.shp"), dbf=archive.open(f"{LAYER}.dbf"))
    rows = []
    for building in reader.iterShapeRecords(fields=FIELDS):
        record = building.record
        if record["beheizt"] != 1:
            continue
        x0, y0, x1, y1 = building.shape.bbox
        rows.append({
            "id": record["Fest_ID"],
            "cell": record["Raster_ID"],
            "residential": record["WG_NWG"] == "WG",
            "demand_kwh": record["RW_WW"],
            "spf_air": record["JAZ_Luft"],
            "heat_line": record["WLD_ID"],
            "location": {"type": "Point", "coordinates": [(x0 + x1) / 2, (y0 + y1) / 2]},
        })

buildings = pd.DataFrame(rows)
