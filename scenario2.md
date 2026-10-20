# Handover: LLM-driven formal modelling demo (Aachen)

Oct 19, 2026 · @Paul

## Purpose and how to use this handover

The user wants demo use cases for **LLM-driven formal modelling grounded in existing research**: an LLM reads primary documents and literature, maps them onto an established model structure, writes verifiable simulation code, and produces scenario comparisons where every number traces to a source or an explicit assumption. The user is based in Aachen, Germany, so local policy questions are preferred.

The conversation explored two tracks: a housing market model (DiPasquale–Wheaton) and a heat transition model. The heat transition model is the current focus, and the user was last working on expressing its nodes as typed objects with schemas, implementations and configurations.

Conventions that held throughout:

- Trustworthiness matters more than sophistication. Prefer small, fully verifiable models over frontier models that cannot be checked end to end.
- Every parameter is either sourced (with page/passage) or flagged as an assumption. Contested policy questions are modelled as competing parameter assumptions, never as a verdict.
- Results are scenario comparisons and ranges, not point forecasts.
- Figures below come from web searches in the original chat (October 2026). Most were read from search snippets only; verify against the primary documents before using them in a model (see Sources).

## Current status at a glance

The heat transition model (layers 1–3) is the chosen demo. Its dataflow graph is designed, and the core of a typed Python framework is written; node implementations, the YAML model spec and a demo run are not.

| Item                                           | Status                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Housing model (DiPasquale–Wheaton, quota case) | Designed conceptually, no code. Parked as secondary track                                    |
| Trust approach (verification and validation)   | Agreed, see section 4                                                                        |
| Heat transition: 5 layers, evidence map        | Done; scope for demo = layers 1–3                                                            |
| Dataflow graph (D1–D4, N1–N5, V)               | Designed; one correction pending in the diagram (N2 inside yearly loop)                      |
| Model type per node                            | Done, see section 6                                                                          |
| Typed node framework                           | `framework.py` written (appendix), untested; `nodes.py`, `model.yaml`, `demo.py` not started |

Work stopped right after `framework.py` was created, when the user asked for this handover.

## Track 1: Housing market (parked)

The DiPasquale–Wheaton four-quadrant model (1992) fits Aachen's social housing debate well, but annual city data gives too few points to validate it, so it was parked in favour of the heat transition.

**Model.** Four linked relations, iterated yearly: rent from households vs. stock; price = rent / cap rate; construction responds to price minus replacement cost, with a lag; stock = (1 − δ) × stock + lagged construction.

**Data mapping for Aachen.**

| Variable                                | Source                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| Housing stock, completions, demolitions | Zensus 2022 baseline; IT.NRW Bautätigkeitsstatistik                            |
| Population, households, students        | Stadt Aachen Statistik, IT.NRW, RWTH Zahlenspiegel                             |
| Rents                                   | Official Mietspiegel, Wohnungsmarktbericht, RWI-GEO-RED                        |
| Prices, cap rates                       | Gutachterausschuss Grundstücksmarktbericht (Liegenschaftszinssätze = cap rate) |
| Replacement cost                        | Destatis Baupreisindex, Bodenrichtwerte (BORIS.NRW)                            |
| Interest rates                          | Bundesbank MFI statistics                                                      |
| Elasticities                            | Not locally observable: borrow from literature, flag as assumption             |

**Policy case: expiring social housing vs. the quota.** Per the 2026 Wohnungsmarktbericht (presented September 2026), more than 1,000 flats left social housing restrictions within one year, against 318 newly approved subsidised units. The city's Quotenbeschluss requires subsidised units in new planning areas (40% since a 2019 decision); critics since 2016 argue it suppresses construction. Proposed two-segment extension:

```latex
S^{free}_{t+1} = (1-\delta) S^{free}_t + (1-q) C_t + E_t \\
S^{soc}_{t+1} = (1-\delta) S^{soc}_t + q C_t + F_t - E_t \\
P^{eff} = (1-q) P^{market} + q P^{social}
```

E = expiring units, F = separately funded units, q = quota. Key insights: expiry moves units between segments without changing total supply; a higher q raises the subsidised share per project but lowers developer returns and may reduce C. Which effect wins depends on the construction elasticity, which is what the two sides implicitly disagree about.

Other scenarios: the federal "Bauturbo" (shorter construction lag), RWTH enrolment shocks in either direction (RWTH saw slight declines in winter 2024/25), and the dropped municipal housing company as a counterfactual. Benchmark: the city's Quaestio Wohnungsbedarfsprognose (to 2039).

**State of the art.** DiPasquale–Wheaton is a classic textbook framework, not the research frontier. The frontier: quantitative spatial models (Ahlfeldt, Redding, Sturm and Wolf 2015, using Berlin), heterogeneous-agent macro models (Kaplan, Mitman and Violante 2020), agent-based models (Bank of England, Baptista et al. 2016), micro supply elasticities (Saiz 2010; Baum-Snow and Han), and quasi-experimental policy evaluation. Evidence on inclusionary zoning (the closest analogue to the quota) is mixed: a 2025 US nationwide study found no average effect on permits or rents and +2.1% home prices. Agreed framing: "established structure, calibrated with modern empirical evidence".

## Trust approach: verification and validation

Trust is split in two: **verification** (does the code implement the intended model?) and **validation** (does the model say anything true about Aachen?). References: Sargent on simulation V\&V; Sterman and Barlas on system dynamics model testing.

**Verification (automate all of it):**

1. Spec before code: a model document with every equation, variable, unit, and each parameter's source or an "assumption" flag. The user reviews the spec; the code only implements it. Any constant not in the spec is a red flag.
2. Analytical check: derive the steady state independently (by hand or SymPy) and confirm the simulation converges to it.
3. Invariants via property-based testing (`hypothesis`): conservation of stock, no negative stocks, zero construction means decay at exactly the depreciation rate.
4. Degenerate cases: e.g. quota 0 collapses the two-segment model to one segment.
5. Units enforced in code (e.g. `pint` or explicit unit tags) so mismatches crash.
6. Mutation testing: deliberately break the code and confirm tests fail.
7. Independent second implementation from the same spec; compare outputs.
8. Do not rely on the LLM reviewing its own code.
9. Provenance: store page and passage for every sourced number; spot-check that the passage exists.

**Validation:**

1. Reproduce known qualitative results from the literature before using local data.
2. Backtest: calibrate on an early period, predict a later one.
3. Benchmark against official forecasts (Quaestio for housing; the heat plan for heat).
4. Sensitivity analysis on every assumption; if a conclusion flips within the plausible range, report the threshold, not one answer.
5. Write expected results down before running scenarios.
6. Expert review (RWTH, RWI Essen).

Realistic claim: trustworthy for directions, magnitudes, timing and which assumptions drive results; not for point forecasts.

## Track 2: Heat transition (current focus)

The heat transition was chosen because Aachen has an adopted municipal heat plan (council committee recommended adoption July 2025) and the 2022 census provides 100 m grid data on heating type, energy source and rents. Evidence is strongest for the upstream layers and thins out downstream; the demo scope is layers 1–3.

Policy context to verify: one secondary source states the plan raises the district heating share from about 14% to 40%, and that the GEG 65% renewable rule therefore applies to existing buildings in Aachen from 1 July 2026. The city also runs "AI-X Heat" with RWTH's chair for building and indoor climate technology (EBC) and regio iT to continuously update the plan (planned to September 2026).

| Layer                    | Question                               | Published models                                                                                                         | Solid evidence                                                           | Partial                                                                                         | Gap (not public)                 |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------- |
| 1 Heat demand            | How much heat does each building need? | IWU/TABULA typology; TEASER (RWTH EBC, Remmen et al. 2018, MIT licence)                                                  | NRW Raumwärmebedarfsmodell v4, building-level, on OpenGeodata.NRW        | Validated against consumption in Krefeld (conservative), not Aachen                             | Metered consumption              |
| 2 Network suitability    | Where do heat networks pay off?        | Heat density economics, Persson & Werner (2011); Hotmaps; Pan-European Thermal Atlas; DHNx/oemof                         | NRW heat study (12,038 heat-density clusters); heat plan expansion areas | Cost curves are not Aachen-specific                                                             | Local network costs              |
| 3 Replacement and choice | Which systems do owners install, when? | Vintage/stock-turnover; discrete choice (Michelsen & Madlener 2012); Bass diffusion; agent-based Invert/EE-Lab (TU Wien) | 2022 heating mix per cell; GEG rule                                      | 2011 census mix (check resolution); 2012 choice study; boiler lifetimes; energy price scenarios | Heating system installation ages |
| 4 Grid impact            | Can the power grid carry heat pumps?   | PyPSA, oemof, urbs; when2heat profiles (Ruhnau et al. 2019); pandapower                                                  | Load profiles, method                                                    |                                                                                                 | Low-voltage grid topology        |
| 5 Who pays               | Landlords vs. tenants, rent effects    | Landlord–tenant dilemma literature                                                                                       | Rents per census cell                                                    | Tenure at cell level; cost pass-through rules                                                   |                                  |

The gaps share one cause: the data sits with the local utility and grid operator, or (for heating ages) with chimney sweep records, which municipalities can use for heat planning.

## Dataflow graph specification

The model is a **recursive-dynamic, spatially disaggregated stock-flow model**: a heating stock (N5) whose outflow comes from a vintage model (N3), whose inflow is allocated by a discrete choice model (N4), coupled to a techno-economic cost model (N2) through a reinforcing feedback. Owners are myopic (decide on current-year costs). Architecture matches established building stock models such as Invert/EE-Lab.

**Nodes** (this version includes all corrections agreed in the chat):

| Node                   | Model type                 | Inputs                                                                           | Computation                                                                | Outputs                                                                     | Runs   |
| ---------------------- | -------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------ |
| D1 Zensus 2022 grid    | Register data              |                                                                                  |                                                                            | building_mix, heating_mix_2022, conn_rate_2022, rents                       | once   |
| D2 NRW heat model      | Model output used as data  |                                                                                  |                                                                            | heat_demand_bldg                                                            | once   |
| D3 Heat plan 2025      | Exogenous policy           |                                                                                  |                                                                            | expansion_areas (per year), dh_target                                       | once   |
| D4 Assumptions         | Exogenous parameters       |                                                                                  |                                                                            | energy_prices (path), lifetimes / age distribution, choice_params, geg_rule | once   |
| D5 Street length (new) | OSM or NRW cadastral       |                                                                                  |                                                                            | street_length per cell                                                      | once   |
| N1 Heat demand         | Spatial aggregation (GIS)  | heat_demand_bldg, building_mix, street_length                                    | Sum buildings to 100 m cells; linear heat density = demand / street length | heat_demand, heat_density                                                   | once   |
| N2 Network economics   | Techno-economic cost model | heat_density, heat_demand, expansion_areas_t, energy_prices_t, conn_rate (lag 1) | Annualised pipe cost / (conn_rate × demand) + supply cost                  | dh_cost, dh_available                                                       | yearly |
| N3 Replacement         | Vintage / survival model   | stock (lag 1), lifetimes                                                         | Stock by age × failure probability(age)                                    | replacements                                                                | yearly |
| N4 Choice              | Multinomial logit          | replacements, dh_cost, dh_available, energy_prices_t, choice_params, geg_rule    | Shares over allowed options; rules filter the choice set, not costs        | installs                                                                    | yearly |
| N5 Stock update        | Stock-and-flow aging chain | stock (lag 1), replacements, installs                                            | stock − replaced, age +1, add installs at age 0                            | stock (by cell × tech × age), conn_rate                                     | yearly |
| V Validation           | Statistical comparison     | final stock, dh_target, heating_mix_2022                                         | Compare final share with target; backtest 2011→2022                        | report                                                                      | end    |

**Order within year t:** N2 → N3 → N4 → N5. Lagged edges (N5.stock → N3, N5.stock → N5, N5.conn_rate → N2) take initial values from D1 in the first year. With the lag, the graph is acyclic within each year. This replaced an earlier idea of iterating N2 and N4 to a fixed point within a year; that remains an option if the one-year reaction delay matters.

**Feedback loops:**

- Stock loop (stock → replacements → installs → stock): pure accounting; tested by conservation.
- Economic loop (conn_rate → dh_cost → choice → conn_rate): reinforcing, because pipe costs are fixed. Can produce tipping-point and path-dependent behaviour: identical areas can diverge depending on early uptake. This is the mechanism behind network-delay lock-in.
- Missing balancing loops (future extensions): installer capacity, network build rate, falling heat demand from renovation (N1 is static, so network economics are slightly overstated over time).

**Design notes:** all non-sourced parameters live in D4, so sensitivity analysis means varying D4 only. N3 should use an aging chain (stock tracked by age cohort) rather than a first-order 1/lifetime outflow, so replacement waves appear; this needs an initial age distribution (currently an assumption). The 65% rule is simplified to excluding gas boilers from the choice set; in reality hybrids or biomethane can comply.

The chat also drew this as an interactive diagram; the table above is the authoritative version and includes fixes the diagram lacked (N2 in the yearly loop, conn_rate_2022 initial wire, D5 street length).

## Questions the model can and cannot answer

The model answers "when, where and under which conditions" questions about the heating mix, as scenario comparisons. Recommended lead demo: the network delay / lock-in question.

| Question                                                                 | What to change               | What to read                              |
| ------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------- |
| Does Aachen reach its district heating target by 2045 on current trends? | Nothing (baseline)           | V: final share vs. target                 |
| How many systems need replacing per year, and where?                     | Nothing                      | N3: replacements by year and cell         |
| What connection rate does each expansion area need to pay off?           | Sweep conn_rate per area     | N2: cost per MWh vs. connection rate      |
| How much does the 65% rule change the 2030 mix?                          | Toggle geg_rule              | N5: mix with vs. without                  |
| What does a 5-year network delay cost (lock-in)?                         | Shift expansion timing in D3 | N4/N5: systems installed in waiting areas |
| How sensitive is the outcome to gas and CO₂ prices?                      | Vary energy_prices           | N4 shares, V final share                  |
| What if connection were mandatory in expansion areas?                    | Override conn_rate           | N2 cost, V final share                    |
| Which assumption drives results most?                                    | Vary each D4 output          | Ranking of effects on V                   |

By-product worth showing: a map of cells where district heating and heat pumps are close in cost, where policy and advice matter most.

**Cannot answer (yet):** replacement timing is only as good as the assumed age distribution (census lacks installation years); grid capacity (layer 4) and cost burden on tenants (layer 5) are out of scope; no point forecasts.

## Typed node framework

The user asked for nodes as types with a schema, an implementation and a configuration. The design uses three schemas, plus interfaces with swappable implementations. Stack: Python, `xarray` (named dimensions), `pydantic` v2 (config validation), `pyyaml`.

| Schema                 | Answers                     | Contents                                                                                                                                               |
| ---------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PortSpec`             | What flows on a wire?       | dims (e.g. cell × tech × age) + unit; checked on every call                                                                                            |
| `NodeConfig` / `Param` | What does the modeller set? | value (scalar or per category), unit, `Provenance` (source or `assumption: true`, required), plausible range for sweeps; `Rule` for dated policy rules |
| `ModelSpec`            | How is the model assembled? | node instances (type name + config), edges (src, dst, lag 0/1, initial value for lagged edges), years; loadable from YAML                              |

**Interfaces vs. implementations.** An abstract node class fixes the ports (e.g. `ReplacementModel`: stock → replacements). Concrete classes add a `Config` and `compute` (e.g. `FirstOrderReplacement` with `lifetime`; `WeibullReplacement` with `scale`, `shape`). Swapping implementation = changing `type:` in YAML; wiring and tests stay. Concrete classes self-register in `REGISTRY`.

**Checks before anything runs** (`Graph`): every node type exists; every config validates (units match, every parameter sourced or flagged); every input has exactly one source; source and destination ports match dims and unit; lagged edges have initial values; no cycle without a lag (topological sort gives execution order). At runtime, ports are checked on every call; outputs must be explicitly unit-tagged because xarray drops attrs in arithmetic.

**Planned node implementations** (not yet written; `nodes.py`):

- `LinearDensityNetworkCost` (N2): annuity factor i / (1 − (1 + i)^−n); cost = annuity × pipe_cost × street_length / (max(conn_rate, min_conn_rate) × heat_demand) + supply_cost. `min_conn_rate` avoids division by zero and represents planned initial uptake.
- `FirstOrderReplacement` and `WeibullReplacement` (N3): hazard in log form, 1 − exp(−(((a+1)/λ)^k − (a/λ)^k)), for numerical stability.
- `LogitChoice` (N4): utility = beta_cost × cost + ASC per tech; disallowed options (phase-out rules, no network) get zero weight; assert installs sum to replacements.
- `AgingChainStock` (N5): subtract replacements, shift age by one (oldest bucket accumulates), add installs at age 0; assert conservation; conn_rate = district heating share.

**Demo plan** (`demo.py`, toy data): three cells (dense centre, mixed, suburb), techs gas_boiler / heat_pump / district_heating, ages 0–39, years 2022–2045. All numeric values are placeholders flagged `assumption: true`; never attribute a placeholder to a paper. Show: assumptions report, district heating share by cell over time, swapping replacement implementations, and deliberate validation failures (wrong unit, unsourced parameter).

## Open items and next steps

Next concrete step: write `nodes.py`, `model.yaml` and `demo.py`, then test `framework.py` (it has not been run yet).

- [ ] Implement the four planned node types and a test suite (conservation, degenerate cases, unit and provenance failures, analytic checks for first-order replacement)
- [ ] Write `model.yaml` with placeholder parameters, all flagged as assumptions
- [ ] Run the toy demo; check the reinforcing loop produces plausible divergence between cells
- [ ] Verify the 14% → 40% district heating target and the 1 July 2026 GEG date against the adopted heat plan and city sources
- [ ] Add a street length data source (OSM or NRW cadastral) for linear heat density
- [ ] Find a source for heating system ages (chimney sweep data via the city, or a sourced assumption)
- [ ] Check whether the 2011 census heating types exist at a resolution compatible with the 2022 grid (enables an 11-year backtest)
- [ ] Load real data: Zensus 2022 grid, NRW Raumwärmebedarfsmodell, heat plan expansion areas
- [ ] Replace placeholders with literature values (lifetimes, Michelsen & Madlener choice parameters, Persson & Werner cost curves), each with page reference
- [ ] Optionally contact RWTH EBC / AI-X Heat as reference point or expert reviewers

Alternative demos considered, if useful later: electricity merit-order model with hourly SMARD data (strongest backtest, CC BY 4.0 data) and spatial housing with census rent grids.

## Sources

Only the Wohnungsmarktbericht summary was opened in full; the others were read from search snippets and should be checked in the original before use. Literature references (DiPasquale–Wheaton, Persson & Werner, Michelsen & Madlener, etc.) were cited from memory and need page-level verification.

Aachen policy and data:

- [Aachen Wohnungsmarktbericht 2026 summary (aachen50plus.de)](https://aachen50plus.de/aachen-wohnungsmarktbericht/) (opened): expiring vs. new social housing, Bauturbo, student dorm
- [Ratsinfo Aachen: quota decision 2019](https://ratsinfo.aachen.de/bi/wicket/resource/org.apache.wicket.Application/doc321668.pdf)
- [Ratsinfo Aachen: 2016 quota debate](https://ratsinfo.aachen.de/bi/wicket/resource/org.apache.wicket.Application/doc167577.pdf)
- [Ratsinfo Aachen: Quaestio Wohnungsbedarfsprognose](https://ratsinfo.aachen.de/bi/wicket/resource/org.apache.wicket.Application/doc537773.pdf)
- [Ratsinfo Aachen: heat plan adoption, July 2025](https://ratsinfo.aachen.de/public/wicket/resource/org.apache.wicket.Application/doc1393199.pdf)
- [Ratsinfo Aachen: AI-X Heat project](https://ratsinfo.aachen.de/public/wicket/resource/org.apache.wicket.Application/doc1372409.pdf)
- [Heat pump guide citing the 14% → 40% target and GEG date (secondary)](https://www.enter.de/blog/waermepumpe-aachen)
- [Aachener Zeitung: municipal housing company dropped](https://www.aachener-zeitung.de/lokales/region-aachen/aachen/aachen-verzichtet-auf-gruendung-einer-staedtischen-wohnungsbaugesellschaft/158156889.html)

Data sources:

- [Zensus 2022 grid data (Census Atlas)](https://zensus2022.de/EN/News/Hinweis_Zensusatlas_VOE_en.html)
- [NRW Raumwärmebedarfsmodell documentation](https://energieatlas.nrw.de/site/Media/Default/Dokumente/Kurzdokumentation_Raumwaermebedarfsmodell_WaermestudieNRW.pdf)
- [Krefeld validation of the NRW model (TU Graz conference paper)](https://www.tugraz.at/fileadmin/user_upload/tugrazExternal/f560810f-089d-42d8-ae6d-8e82a8454ca9/files/lf/Session_F1/615_LF_Schriefers.pdf)
- [NRW heat cadastre presentation (12,038 clusters)](https://dvw.de/api/assets/downloads/nordrhein-westfalen/vortragsarchiv/vermwesenakt24/241128-04_vogel_warmekataster.pdf)
- [TEASER (RWTH EBC)](https://ebc-tools.eonerc.rwth-aachen.de/en/teaser)
- [SMARD market data download](https://www.smard.de/en/downloadcenter/download-market-data)

Research:

- [Inclusionary zoning, 2025 US nationwide study (UW)](https://research.be.uw.edu/?p=29208)
- [Inclusionary zoning and housing market outcomes (Mercatus)](https://www.mercatus.org/research/journal-articles/inclusionary-zoning-and-housing-market-outcomes)
