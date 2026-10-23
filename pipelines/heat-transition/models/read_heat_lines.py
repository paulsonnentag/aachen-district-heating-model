import zipfile

import pandas as pd
import shapefile

LAYER = "WBM-NRW-Waermelinien_05334002_Aachen"


def course(shape):
    """The line as GeoJSON, to the decimetre."""
    if not shape.points:
        return None
    line = shape.__geo_interface__
    point = lambda p: [round(p[0], 1), round(p[1], 1)]
    if line["type"] == "LineString":
        return {"type": "LineString", "coordinates": [point(p) for p in line["coordinates"]]}
    return {"type": "MultiLineString", "coordinates": [[point(p) for p in part] for part in line["coordinates"]]}


with zipfile.ZipFile(nrw_heat_demand_model) as archive:
    reader = shapefile.Reader(shp=archive.open(f"{LAYER}.shp"), dbf=archive.open(f"{LAYER}.dbf"))
    heat_lines = pd.DataFrame(
        {"id": line.record["WLD_ID"], "street_length": line.record["Strassenla"], "course": course(line.shape)}
        for line in reader.iterShapeRecords(fields=["WLD_ID", "Strassenla"])
    )
