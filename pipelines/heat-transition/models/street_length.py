# Each heat line's length is split among cells by the demand of the buildings it serves,
# so a street shared by two cells counts once overall.
lengths = heat_lines.set_index("id")["street_length"]
served = buildings[buildings["heat_line"].isin(lengths.index) & (buildings["demand_kwh"] > 0)]
demand = served.groupby(["heat_line", "cell"], sort=False)["demand_kwh"].sum()
line_demand = demand.groupby(level="heat_line").transform("sum")
line_length = lengths.reindex(demand.index.get_level_values("heat_line")).to_numpy()
by_cell = (line_length * demand / line_demand).groupby(level="cell").sum()

street_length = by_cell.reindex(cells["cell"], fill_value=0.0).clip(lower=1.0).round(2)
