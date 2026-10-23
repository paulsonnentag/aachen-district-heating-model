import type { Sketch, SketchDataset } from './types';

/** Plan A as first proposed: data marked by what exists for Aachen, no node implemented. */
export const stockTurnoverSketch: Sketch = {
  datasets: {
    heating_stock_2022: input(['cell', 'tech'], 'buildings', 'sourced'),
    heat_demand: input(['cell'], 'MWh/year', 'sourced'),
    street_length: input(['cell'], 'm'),
    initial_age_share: input(['tech', 'age'], 'dmnl'),
    bucket_mid_age: input(['age'], 'year', 'assumption'),
    weibull_scale: input(['tech'], 'year', 'assumption'),
    weibull_shape: input(['tech'], 'dmnl', 'assumption'),
    fuel_price: input(['year', 'tech'], 'EUR/MWh', 'assumption'),
    efficiency: input(['tech'], 'dmnl', 'assumption'),
    dh_expansion_year: input(['cell'], 'year', 'sourced'),
    pipe_cost: input([], 'EUR/m', 'assumption'),
    beta_cost: input([], 'MWh/EUR', 'assumption'),
    asc: input(['tech'], 'dmnl', 'assumption'),
    ban_start_year: input([], 'year', 'sourced'),
    dh_target: input([], 'dmnl', 'sourced'),
    heat_density: computed(['cell'], 'MWh/(m*year)'),
    replacement_hazard: computed(['tech', 'age'], '1/year'),
    energy_cost: computed(['year', 'tech'], 'EUR/MWh'),
    heating_stock: computed(['cell', 'tech', 'age', 'year'], 'buildings'),
    installs: computed(['cell', 'tech', 'year'], 'buildings'),
    conn_rate: computed(['cell', 'year'], 'dmnl'),
    dh_share_city: computed(['year'], 'dmnl'),
    dh_target_gap: computed(['year'], 'dmnl'),
  },
  nodes: {
    heat_density: {
      label: 'Linear heat density',
      inputs: { heat_demand: 'heat_demand', street_length: 'street_length' },
      outputs: { heat_density: 'heat_density' },
    },
    replacement_hazard: {
      label: 'Weibull replacement hazard',
      inputs: { scale: 'weibull_scale', shape: 'weibull_shape', mid_age: 'bucket_mid_age' },
      outputs: { hazard: 'replacement_hazard' },
    },
    energy_cost: {
      label: 'Energy cost per MWh',
      inputs: { fuel_price: 'fuel_price', efficiency: 'efficiency' },
      outputs: { energy_cost: 'energy_cost' },
    },
    heat_turnover: {
      label: 'Stock turnover and choice',
      inputs: {
        initial_stock: 'heating_stock_2022',
        initial_age_share: 'initial_age_share',
        hazard: 'replacement_hazard',
        heat_density: 'heat_density',
        energy_cost: 'energy_cost',
        expansion_year: 'dh_expansion_year',
        pipe_cost: 'pipe_cost',
        beta_cost: 'beta_cost',
        asc: 'asc',
        ban_start_year: 'ban_start_year',
      },
      outputs: { systems: 'heating_stock', installs: 'installs', conn_rate: 'conn_rate', dh_share_city: 'dh_share_city' },
    },
    target_check: {
      label: 'District heating target check',
      inputs: { dh_share: 'dh_share_city', target: 'dh_target' },
      outputs: { target_gap: 'dh_target_gap' },
    },
  },
  tasks: {
    density: { instructions: 'Implement linear heat density: heat demand divided by street length per cell.', nodes: ['heat_density'] },
    hazard: {
      instructions: 'Implement a Weibull hazard per technology and age bucket, in log form for numerical stability.',
      nodes: ['replacement_hazard'],
    },
    cost: { instructions: 'Implement energy cost per MWh of heat as fuel price over efficiency.', nodes: ['energy_cost'] },
    turnover: {
      instructions:
        'Write the yearly stock-flow model in XMILE: age the stock, replace by hazard, allocate installs by logit over the allowed options, take network cost from last year’s connection rate.',
      nodes: ['heat_turnover'],
    },
    target: { instructions: 'Compare the city-wide district heating share with the heat plan target.', nodes: ['target_check'] },
    ages: {
      instructions: 'Find installation ages of heating systems. The census has none; try chimney sweep statistics.',
      datasets: ['initial_age_share'],
    },
    streets: { instructions: 'Get street length per cell from OSM or the NRW cadastre.', datasets: ['street_length'] },
    beta: {
      instructions: 'Replace the placeholder cost sensitivity with an estimate from Michelsen & Madlener (2012).',
      datasets: ['beta_cost'],
    },
    verify: {
      instructions: 'Verify the 14% → 40% target and the July 2026 GEG date against primary sources.',
      datasets: ['dh_target', 'ban_start_year'],
    },
    fixedPoint: {
      instructions: 'Try solving network cost and choice to a fixed point within each year instead of using last year’s connection rate.',
      nodes: ['heat_turnover'],
    },
  },
};

/** The toy draft: three cells, every missing input filled with a placeholder flagged as an assumption. */
export const toySketch: Sketch = withPlaceholders(stockTurnoverSketch);

/** The toy pipeline after the five implementation drafts were merged. */
export const toyImplemented: Sketch = implement(
  toySketch,
  { heat_density: 'equation', replacement_hazard: 'equation', energy_cost: 'equation', heat_turnover: 'xmile', target_check: 'equation' },
  ['density', 'hazard', 'cost', 'turnover', 'target'],
);

export const diffusionSketch: Sketch = {
  datasets: {
    dh_connections_aachen: input(['year'], 'connections'),
    building_count: input([], 'buildings', 'sourced'),
    hp_sales_de: input(['year'], 'units', 'sourced'),
    dh_target: input([], 'dmnl', 'sourced'),
    bass_params: computed(['param'], 'dmnl'),
    dh_share_projection: computed(['year'], 'dmnl'),
    dh_target_gap: computed(['year'], 'dmnl'),
  },
  nodes: {
    bass_fit: {
      label: 'Bass diffusion fit',
      inputs: { adoption: 'dh_connections_aachen', market: 'building_count', analogue: 'hp_sales_de' },
      outputs: { params: 'bass_params' },
    },
    projection: { label: 'Projection to 2045', inputs: { params: 'bass_params' }, outputs: { share: 'dh_share_projection' } },
    target_check: {
      label: 'District heating target check',
      inputs: { share: 'dh_share_projection', target: 'dh_target' },
      outputs: { gap: 'dh_target_gap' },
    },
  },
  tasks: {
    connections: {
      instructions: 'Ask the utility (STAWAG) for district heating connections per year since 2000.',
      datasets: ['dh_connections_aachen'],
    },
    fit: {
      instructions: 'Fit the Bass parameters p and q; use national heat pump sales as an analogue for imitation.',
      nodes: ['bass_fit'],
    },
    project: { instructions: 'Project the connection share to 2045 and compare it with the target.', nodes: ['projection', 'target_check'] },
  },
};

export const agentBasedSketch: Sketch = {
  datasets: {
    buildings: input(['building'], 'buildings', 'sourced'),
    owner_type: input(['building'], 'category'),
    household_income: input(['building'], 'EUR/year'),
    tenure_share: input(['cell'], 'dmnl', 'sourced'),
    renovation_rates: input(['owner_type'], '1/year', 'assumption'),
    heating_stock_2022: input(['cell', 'tech'], 'buildings', 'sourced'),
    energy_prices: input(['year', 'tech'], 'EUR/MWh', 'assumption'),
    dh_target: input([], 'dmnl', 'sourced'),
    owner_decisions: computed(['building', 'year'], 'category'),
    heating_stock: computed(['building', 'year'], 'category'),
    dh_share_city: computed(['year'], 'dmnl'),
    dh_target_gap: computed(['year'], 'dmnl'),
  },
  nodes: {
    owners: {
      label: 'Owner agents',
      inputs: {
        buildings: 'buildings',
        owner_type: 'owner_type',
        income: 'household_income',
        tenure: 'tenure_share',
        renovation: 'renovation_rates',
        prices: 'energy_prices',
        stock: 'heating_stock_2022',
      },
      outputs: { decisions: 'owner_decisions' },
    },
    stock: {
      label: 'Building stock update',
      inputs: { decisions: 'owner_decisions' },
      outputs: { stock: 'heating_stock', share: 'dh_share_city' },
    },
    target_check: {
      label: 'District heating target check',
      inputs: { share: 'dh_share_city', target: 'dh_target' },
      outputs: { gap: 'dh_target_gap' },
    },
  },
  tasks: {
    owners: {
      instructions: 'Find owner types per building: owner-occupier, small landlord or housing company.',
      datasets: ['owner_type'],
    },
    income: { instructions: 'Find household income per building, or a defensible proxy.', datasets: ['household_income'] },
    renovation: { instructions: 'Calibrate renovation decisions per owner type against Invert/EE-Lab.', datasets: ['renovation_rates'] },
    agents: { instructions: 'Implement owner agents with renovation and heating decisions.', nodes: ['owners'] },
    update: { instructions: 'Implement the stock update from the agents’ decisions.', nodes: ['stock'] },
    validate: { instructions: 'Find an observed series to validate agent behaviour against.', nodes: ['owners'] },
  },
};

export const housingSketch: Sketch = {
  datasets: {
    households_path: input(['year'], 'households', 'assumption'),
    zensus_stock_free_2022: input([], 'dwellings'),
    zensus_stock_social_2022: input([], 'dwellings'),
    mietspiegel_rent_2022: input([], 'EUR/(m2*year)'),
    cap_rate: input([], '1/year'),
    replacement_cost: input([], 'EUR/m2'),
    construction_elasticity: input([], 'dmnl', 'assumption'),
    quota: input([], 'dmnl', 'sourced'),
    expiring_units_path: input(['year'], 'dwellings/year', 'sourced'),
    funded_units_path: input(['year'], 'dwellings/year', 'sourced'),
    quaestio_dwelling_need: input(['year'], 'dwellings'),
    stock_free: computed(['year'], 'dwellings'),
    stock_social: computed(['year'], 'dwellings'),
    total_stock: computed(['year'], 'dwellings'),
    market_rent: computed(['year'], 'EUR/(m2*year)'),
    starts: computed(['year'], 'dwellings/year'),
    housing_gap: computed(['year'], 'dwellings'),
  },
  nodes: {
    housing_market: {
      label: 'Housing market, two segments',
      inputs: {
        households: 'households_path',
        stock_free: 'zensus_stock_free_2022',
        stock_social: 'zensus_stock_social_2022',
        rent: 'mietspiegel_rent_2022',
        cap_rate: 'cap_rate',
        replacement_cost: 'replacement_cost',
        elasticity: 'construction_elasticity',
        quota: 'quota',
        expiring: 'expiring_units_path',
        funded: 'funded_units_path',
      },
      outputs: {
        stock_free: 'stock_free',
        stock_social: 'stock_social',
        total_stock: 'total_stock',
        market_rent: 'market_rent',
        starts: 'starts',
      },
    },
    quaestio_benchmark: {
      label: 'Quaestio benchmark',
      inputs: { need: 'quaestio_dwelling_need', stock: 'total_stock' },
      outputs: { gap: 'housing_gap' },
    },
  },
  tasks: {
    model: {
      instructions: 'Write the two-segment DiPasquale–Wheaton model as a yearly stock-flow model.',
      nodes: ['housing_market'],
    },
    benchmark: { instructions: 'Compare the total stock with the Quaestio dwelling need.', nodes: ['quaestio_benchmark'] },
    stock: {
      instructions: 'Take the free and social stock from Zensus 2022 and the city’s count of rent-restricted dwellings.',
      datasets: ['zensus_stock_free_2022', 'zensus_stock_social_2022'],
    },
    prices: {
      instructions: 'Read the rent and the cap rate from the Mietspiegel and the Gutachterausschuss.',
      datasets: ['mietspiegel_rent_2022', 'cap_rate', 'replacement_cost'],
    },
    quaestio: { instructions: 'Extract the Quaestio forecast values.', datasets: ['quaestio_dwelling_need'] },
  },
};

function input(dims: string[], unit: string, data?: SketchDataset['data']): SketchDataset {
  return data ? { dims, unit, data } : { dims, unit };
}

function computed(dims: string[], unit: string): SketchDataset {
  return { dims, unit };
}

function withPlaceholders(sketch: Sketch): Sketch {
  const produced = new Set(Object.values(sketch.nodes).flatMap((node) => Object.values(node.outputs)));
  const datasets = Object.fromEntries(
    Object.entries(sketch.datasets).map(([name, dataset]) => [
      name,
      produced.has(name) ? dataset : { ...dataset, data: dataset.data ?? ('assumption' as const) },
    ]),
  );
  return { ...sketch, datasets };
}

/** Gives nodes their semantics and removes the tasks that did it. */
function implement(sketch: Sketch, semantics: Record<string, string>, doneTasks: string[]): Sketch {
  const nodes = Object.fromEntries(
    Object.entries(sketch.nodes).map(([id, node]) => [id, semantics[id] ? { ...node, semantics: semantics[id] } : node]),
  );
  const tasks = Object.fromEntries(Object.entries(sketch.tasks).filter(([id]) => !doneTasks.includes(id)));
  return { ...sketch, nodes, tasks };
}
