import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer

YEARS = [2022, 2030, 2035, 2040, 2045]
NOT_PLANNED = 2100

blocks = heat_plan_blocks.fillna({c: 0 for c in heat_plan_blocks.columns if c.startswith(("q_fw_", "q_nw_"))})
first_year = pd.Series(NOT_PLANNED, index=blocks.index)
for year in reversed(YEARS):
    # District heating (Fernwärme) plus local heating (Nahwärme), GWh/year.
    network = blocks.get(f"q_fw_{year % 100}", 0) + blocks.get(f"q_nw_{year % 100}", 0)
    first_year[network > 0] = year

# Blocks are matched in EPSG:25832, like the buildings.
to_utm = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
outlines = shapely.transform(
    [shapely.geometry.shape(g) for g in blocks["geometry"]],
    lambda xy: np.column_stack(to_utm.transform(xy[:, 0], xy[:, 1])),
)
points = shapely.points([location["coordinates"] for location in buildings["location"]])
# Some outlines are invalid polygons, which "within" rejects; "intersects" counts ring crossings instead.
point, block = shapely.STRtree(outlines).query(points, predicate="intersects")
first_block = pd.Series(block).groupby(point).min()

found = pd.DataFrame(
    {"block": blocks["id"].to_numpy()[first_block], "first_network_year": first_year.to_numpy()[first_block]},
    index=first_block.index,
)
building_blocks = buildings[["id", "cell"]].join(found).assign(location=buildings["location"])
