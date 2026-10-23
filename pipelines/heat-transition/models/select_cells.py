import pandas as pd

heated = buildings.groupby("cell").size()
residential = buildings[buildings["residential"]].groupby("cell").size()
chosen = sorted(set(census_cells["cell"]) & set(residential.index))

cells = pd.DataFrame({
    "cell": chosen,
    "heated_buildings": heated[chosen].to_numpy(),
    "residential_buildings": residential[chosen].to_numpy(),
})
