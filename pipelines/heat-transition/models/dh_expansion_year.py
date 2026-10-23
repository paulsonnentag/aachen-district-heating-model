YEARS = [2022, 2030, 2035, 2040, 2045]
NOT_PLANNED = 2100

# The first heat plan year by which blocks holding at least half the cell's demand are supplied.
year = buildings["id"].map(building_blocks.set_index("id")["first_network_year"])
supplied = buildings.assign(year=year)[buildings["cell"].isin(cells["cell"]) & year.notna()]
demand = (
    supplied.astype({"year": int})
    .pivot_table(index="cell", columns="year", values="demand_kwh", aggfunc="sum")
    .reindex(index=cells["cell"], columns=[*YEARS, NOT_PLANNED])
    .fillna(0.0)
)
covered = demand.cumsum(axis=1)
total = covered[NOT_PLANNED]
reached = covered.ge(total / 2, axis=0) & (total > 0).to_numpy()[:, None]

dh_expansion_year = reached.idxmax(axis=1).where(reached.any(axis=1), NOT_PLANNED)
