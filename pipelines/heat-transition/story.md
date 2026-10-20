# Aachen's district heating target is out of reach on current policy

Germany has committed by law to net greenhouse gas neutrality by 2045 (<model-source ref="ksg">Klimaschutzgesetz</model-source>), and that includes the gas and oil burned to heat buildings. Every city above 100,000 residents had to adopt a heat plan by mid-2026 (<model-source ref="wpg">Wärmeplanungsgesetz</model-source>), and <model-source ref="aachen_heat_plan">Aachen's</model-source> relies heavily on district heating.

Heat networks get cheaper the more neighbours connect, because the pipe in a street costs the same either way. But owners only switch when their old boiler fails, and anyone who replaces before the network arrives is gone for twenty years.

**Key findings**

- **Even the best scenario misses the plan by <model-value dataset="dh_target_gap" year="2045" scenario="geg-2024-rule" format="pp">15.3 pp</model-value>.** District heating ends between <model-value dataset="dh_heat_share" year="2045" scenario="network-delay" format="percent">20.7%</model-value> and <model-value dataset="dh_heat_share" year="2045" scenario="geg-2024-rule" format="percent">25.9%</model-value> of residential heat in 2045. The heat plan expects <model-value dataset="heat_plan_network_share" year="2045" format="percent">41.2%</model-value>.
- **Two thirds of the city never gets a network.** The plan reaches <model-value dataset="dh_available" year="2045" format="percent">34.2%</model-value> of inhabited cells. Everywhere else, rules and prices only decide between gas and heat pumps.
- **A gas boiler ban helps heat pumps, not networks.** Keeping the 65% rule cuts gas to <model-value dataset="heat_share" tech="gas" year="2045" scenario="geg-2024-rule" format="percent">14.8%</model-value> of heat, but adds only <model-value dataset="dh_heat_share" year="2045" scenario="geg-2024-rule" minus="baseline" format="pp">+3.1 pp</model-value> to district heating.
- **Late networks lose customers for good.** Five years of delay still costs <model-value dataset="dh_heat_share" year="2045" scenario="network-delay" minus="baseline" format="pp">−2.1 pp</model-value> in 2045.
- **Renovation works against networks.** Less heat per metre of street raises network cost and leaves district heating <model-value dataset="dh_heat_share" year="2045" scenario="renovation-high" minus="baseline" format="pp">−1.5 pp</model-value> lower.

<model-figure dataset="dh_target_gap">Gap between the heat plan's district heating share and the model's, per year. It widens throughout the period.</model-figure>

Every number on this page is computed by the model when the page loads. Click one to see where it comes from. The sections below test the plan's assumptions one at a time.

## The question

Aachen's heat plan expects district and local heating to supply <model-value dataset="heat_plan_network_share" year="2045" format="percent">41.2%</model-value> of the city's heat by 2045, up from <model-value dataset="heat_plan_network_share" year="2022" format="percent">14.2%</model-value> in 2022. The plan decides where pipes go. It cannot decide what owners install when their boiler fails.

This model follows the <model-value dataset="heating_stock_2022" format="int">40,024</model-value> residential buildings in Aachen's inhabited 100 m census cells from 2022 to 2045. Each year some heating systems wear out. Their owners choose a replacement by comparing costs, and district heating is only on the menu once the plan has reached their cell.

## Where the city starts

In 2022, gas heats <model-value dataset="heat_share" tech="gas" year="2022" format="percent">82.0%</model-value> of residential heat demand and oil <model-value dataset="heat_share" tech="oil" year="2022" format="percent">7.8%</model-value>. District heating supplies <model-value dataset="dh_heat_share" year="2022" format="percent">7.4%</model-value>, concentrated in a few parts of the city. Heating carriers come from the <model-source ref="zensus2022_energy">Zensus 2022</model-source>, heat demand from the <model-source ref="nrw_kwp">NRW heat demand model</model-source>.

<model-figure dataset="heating_stock_2022" tech="dh" view="map">Buildings heated by district heating in each 100 m cell, Zensus 2022.</model-figure>

That starting share is about half of the heat plan's own 2022 figure. The two numbers measure different things: the census records each building's main heating carrier, while the heat plan counts district and local heating supply per block. So part of the difference is definitional. Either way, the model starts <model-value dataset="dh_target_gap" year="2022" format="pp">6.8 pp</model-value> behind the plan's path.

Networks can only grow where the plan builds them. <model-value dataset="dh_available" year="2022" format="percent">16.9%</model-value> of cells have a network in 2022, and by 2045 the plan reaches <model-value dataset="dh_available" year="2045" format="percent">34.2%</model-value>. In the other two thirds of the cells, district heating is never an option.

## Boilers set the pace

Owners only make a choice when their system fails. With ages taken from the national <model-source ref="schornsteinfeger_2025">chimney sweep survey</model-source>, <model-value dataset="replacements" year="2025" format="int">2,502</model-value> systems are replaced in 2025, out of <model-value dataset="heating_stock_2022" format="int">40,024</model-value>. The rest of the stock is locked in until it wears out, so even a sudden shift in what people buy takes two decades to show up in the stock.

<model-figure dataset="replacements">Heating systems replaced per year, by the technology being replaced. Gas dominates because gas dominates the stock.</model-figure>

The age structure is the weakest input of this step. The census has no installation years, and the survey is national:

<model-assumptions dataset="replacements"></model-assumptions>

## What owners choose

Owners compare the annual cost per MWh of heat: fuel or electricity, the CO₂ price, the mandatory biogenic share for new gas and oil boilers, and annualised installation cost. Averaged over cells, a heat pump costs <model-value dataset="heating_cost" tech="hp" year="2030" format="int">122</model-value> EUR/MWh in 2030, a gas boiler <model-value dataset="heating_cost" tech="gas" year="2030" format="int">165</model-value> and district heating <model-value dataset="heating_cost" tech="dh" year="2030" format="int">229</model-value>.

District heating is expensive on average because pipes cost the same per metre everywhere, but the heat sold per metre of street varies a lot. Only dense cells spread the network cost thinly enough to compete.

<model-figure dataset="dh_network_cost" year="2030" view="map">District heating network cost per MWh in 2030. Dense blocks in the centre are cheap; low-density cells at the edge would never pay off.</model-figure>

So heat pumps win most replacements. In 2030 the model installs <model-value dataset="installs" tech="hp" year="2030" format="int">1,139</model-value> heat pumps, <model-value dataset="installs" tech="gas" year="2030" format="int">511</model-value> gas boilers and <model-value dataset="installs" tech="dh" year="2030" format="int">254</model-value> district heating connections.

<model-figure dataset="installs">New heating systems installed per year, by technology.</model-figure>

The choice itself happens inside the <model-link node="heat_turnover" open>heating stock turnover model</model-link>, where you can step through the stocks year by year.

## Does the baseline reach the target?

The plan assumes networks fill up as they are built:

<model-claim dataset="dh_target_gap" year="2045" below="0" expect="fails">
On current rules and prices, district heating reaches the plan's share by 2045.
</model-claim>

It reaches <model-value dataset="dh_heat_share" year="2045" format="percent">22.8%</model-value>. Heat pumps become the largest technology at <model-value dataset="heat_share" tech="hp" year="2045" format="percent">37.9%</model-value>, and gas still supplies <model-value dataset="heat_share" tech="gas" year="2045" format="percent">28.0%</model-value>.

<model-figure dataset="heat_share">Share of residential heat demand by technology. District heating grows steadily but slowly.</model-figure>

## Can policy close the gap?

Each scenario changes one input. Figures show the scenario as solid lines and the baseline dashed.

### Ban new gas and oil boilers

The <model-source ref="gmodg_portal">Gebäudemodernisierungsgesetz</model-source> dropped the 2024 rule that new heating systems run on 65% renewable energy, replacing it with a rising biogenic share for gas and oil (<model-source ref="geg_43">§ 43 GEG</model-source>). This scenario keeps the old rule, which in Aachen would have applied from mid-2026, and treats it as a ban on new gas and oil boilers.

<model-claim dataset="dh_target_gap" year="2045" scenario="geg-2024-rule" below="0" expect="fails">
Banning new gas and oil boilers from mid-2026 closes the gap to the plan.
</model-claim>

The ban does work on gas. Gas installs drop to <model-value dataset="installs" tech="gas" year="2027" scenario="geg-2024-rule" format="int">0</model-value> from 2027:

<model-claim dataset="heat_share" tech="gas" year="2045" scenario="geg-2024-rule" below="0.2">
With the ban, gas falls below a fifth of residential heat by 2045.
</model-claim>

<model-figure dataset="installs" scenario="geg-2024-rule">New installations with the 65% rule. The replacements that would have been gas boilers go mostly to heat pumps.</model-figure>

But district heating gains only <model-value dataset="dh_heat_share" year="2045" scenario="geg-2024-rule" minus="baseline" format="pp">+3.1 pp</model-value>. Most owners whose boiler fails live in cells without a network, so they switch to heat pumps instead.

### Make gas expensive

This scenario raises gas to 150 EUR/MWh and the CO₂ price to 300 EUR/t by 2045. Prices up to 2026 follow the <model-source ref="behg">BEHG</model-source>; beyond that the EU ETS2 price is open.

<model-claim dataset="dh_target_gap" year="2045" scenario="high-prices" below="0" expect="fails">
Expensive gas alone pushes district heating to the plan's target, without a ban.
</model-claim>

A gas boiler costs <model-value dataset="heating_cost" tech="gas" year="2030" scenario="high-prices" format="int">198</model-value> EUR/MWh in 2030 instead of <model-value dataset="heating_cost" tech="gas" year="2030" format="int">165</model-value>. Gas falls to <model-value dataset="heat_share" tech="gas" year="2045" scenario="high-prices" format="percent">20.5%</model-value> by 2045, but district heating reaches only <model-value dataset="dh_heat_share" year="2045" scenario="high-prices" format="percent">24.4%</model-value>.

<model-figure dataset="heat_share" scenario="high-prices">Heat shares with high gas and CO₂ prices.</model-figure>

### Build the networks late

Every planned area connects five years after the plan's date.

<model-claim dataset="dh_heat_share" year="2045" scenario="network-delay" above="baseline" expect="fails">
A five-year delay is caught up once the networks arrive.
</model-claim>

By 2035 district heating reaches <model-value dataset="dh_heat_share" year="2035" scenario="network-delay" format="percent">14.2%</model-value> instead of <model-value dataset="dh_heat_share" year="2035" format="percent">16.1%</model-value>. In 2030, owners in the waiting areas install <model-value dataset="installs" tech="gas" year="2030" scenario="network-delay" minus="baseline" format="int">+26</model-value> more gas boilers and <model-value dataset="installs" tech="hp" year="2030" scenario="network-delay" minus="baseline" format="int">+58</model-value> more heat pumps than in the baseline.

<model-figure dataset="dh_heat_share" scenario="network-delay">District heating share with a five-year delay. The delay is never caught up.</model-figure>

This is lock-in. The owners who replaced while waiting will not replace again for twenty years or more, so the delay still costs <model-value dataset="dh_heat_share" year="2045" scenario="network-delay" minus="baseline" format="pp">−2.1 pp</model-value> in 2045, long after the networks arrive.

### Renovate faster

<model-claim dataset="dh_heat_share" year="2045" scenario="renovation-high" above="baseline" expect="fails">
Faster renovation helps district heating reach the target.
</model-claim>

Renovation lowers heat demand, but the network costs the same per metre. Less heat per metre of street means a higher cost per MWh: on average <model-value dataset="dh_network_cost" year="2045" scenario="renovation-high" format="int">258</model-value> EUR/MWh in 2045 instead of <model-value dataset="dh_network_cost" year="2045" format="int">231</model-value>. District heating ends <model-value dataset="dh_heat_share" year="2045" scenario="renovation-high" minus="baseline" format="pp">−1.5 pp</model-value> below the baseline.

<model-figure dataset="dh_network_cost" scenario="renovation-high">Average network cost per MWh with fast renovation.</model-figure>

## What this model cannot tell you

These are scenario comparisons, not forecasts. The 2045 share depends on inputs that are assumptions rather than measurements, above all the choice parameters, the uniform pipe cost and the ages of systems other than gas and oil boilers. The choice parameters currently let heat pumps win most replacements from 2022 on, more than national sales suggest, so treat the heat pump share as an upper bound until they are calibrated. Click an input to inspect it:

<model-assumptions dataset="dh_heat_share"></model-assumptions>

The model also leaves out things that would matter for a decision: whether the power grid can carry the extra heat pumps, how many installers are available, who pays (landlords or tenants), and network operators connecting customers more actively than myopic owners would choose on cost alone.
