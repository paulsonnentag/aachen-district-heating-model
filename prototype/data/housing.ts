import { housingSketch } from './sketches';
import type { Experiment } from './types';

export const housing: Experiment = {
  id: 'housing',
  title: 'Aachen housing market',
  question: 'Does the 40% social housing quota slow down construction?',
  summary:
    'Two-segment DiPasquale–Wheaton model of free and social housing. Parked: almost every input is still a placeholder, and annual city data is too sparse to validate it.',
  status: 'parked',
  pipeline: 'housing',
  updated: 'Fri 9 Oct',
  tasks: [
    {
      instructions: 'Take the free and social stock from Zensus 2022 and the city’s count of rent-restricted dwellings.',
      datasets: ['zensus_stock_free_2022', 'zensus_stock_social_2022'],
    },
    { instructions: 'Read the 2019 quota decision in full; only the snippet was read.', datasets: ['quota'] },
    { instructions: 'Extract the Quaestio forecast values.', datasets: ['quaestio_dwelling_need'] },
    {
      instructions: 'Find a range for the construction elasticity in Saiz (2010) and Baum-Snow & Han.',
      datasets: ['construction_elasticity'],
    },
    {
      instructions: 'Find a validation series: annual city data has too few points for a four-quadrant model.',
      nodes: ['housing_market'],
    },
  ],
  chat: [
    {
      id: 'h1',
      author: 'paul',
      time: 'Thu 8 Oct, 15:02',
      blocks: [
        {
          kind: 'text',
          text: '> In one year, more than 1,000 flats in Aachen dropped out of social housing, while only 318 new ones were approved. Developers blame the city’s 40% quota: it makes projects unprofitable, so less gets built.\n\nSaw this in the paper. The city says the quota protects affordable housing, the developers say it backfires. I’d like to understand which side the evidence supports.',
        },
      ],
    },
    {
      id: 'h2',
      author: 'agent',
      time: 'Thu 8 Oct, 15:10',
      blocks: [
        {
          kind: 'tools',
          calls: [
            'Read Aachen Wohnungsmarktbericht 2026 (summary)',
            'Searched Ratsinfo Aachen for “Quotenbeschluss”',
            'Read the 2019 quota decision, snippet only',
            'Found the Quaestio Wohnungsbedarfsprognose (not read yet)',
            'Searched OpenAlex for “inclusionary zoning effects”',
          ],
        },
        {
          kind: 'text',
          text: 'The article’s numbers come from the city’s Wohnungsmarktbericht 2026: more than 1,000 flats left social housing restrictions within one year, against 318 newly approved subsidised units. The quota is a 2019 council decision: new planning areas must include 40% subsidised units. Both sides can be right at once, so this is a question for a model rather than for the numbers alone.',
        },
        {
          kind: 'sources',
          id: 'housing-sources',
          title: 'Sources',
          sources: [
            {
              title: 'Aachen Wohnungsmarktbericht 2026 (summary)',
              publisher: 'aachen50plus.de',
              url: 'https://aachen50plus.de/aachen-wohnungsmarktbericht/',
              verification: 'primaryRead',
            },
            {
              title: 'Ratsinfo Aachen: quota decision 2019',
              publisher: 'Stadt Aachen',
              url: 'https://ratsinfo.aachen.de/bi/wicket/resource/org.apache.wicket.Application/doc321668.pdf',
              verification: 'snippetOnly',
            },
            {
              title: 'Ratsinfo Aachen: Quaestio Wohnungsbedarfsprognose',
              publisher: 'Stadt Aachen',
              url: 'https://ratsinfo.aachen.de/bi/wicket/resource/org.apache.wicket.Application/doc537773.pdf',
              verification: 'unverified',
            },
          ],
        },
        {
          kind: 'plan',
          id: 'housing-plan-a',
          title: 'Plan A: Two-segment DiPasquale–Wheaton',
          recommended: true,
          outcome: 'chosen',
          idea: 'The classic four-quadrant model (rent, price, construction, stock), split into a free and a social segment. Expiring units move from social to free; the quota sends a share of new construction to the social segment.',
          data: [
            { label: 'Expiring and new subsidised units (Wohnungsmarktbericht)', status: 'found' },
            { label: 'Quota (2019 decision)', status: 'partial' },
            { label: 'Stock by segment (Zensus, city)', status: 'missing' },
            { label: 'Rents, cap rates, construction cost', status: 'missing' },
            { label: 'Construction elasticity', status: 'missing' },
          ],
          answers: ['Does the quota reduce total construction?', 'How fast does the social segment shrink?'],
          limits: ['Where in the city', 'Point forecasts'],
          sketch: housingSketch,
          draft: 'housing-draft',
        },
        {
          kind: 'plan',
          id: 'housing-plan-b',
          title: 'Plan B: Quantitative spatial model',
          outcome: 'not-pursued',
          reason: 'Needs commuting flows and land prices at a resolution Aachen doesn’t publish.',
          idea: 'A spatial equilibrium model in the style of Ahlfeldt, Redding, Sturm and Wolf (2015): households choose where to live and work, rents clear every block.',
          data: [
            { label: 'Commuting flows by block', status: 'missing' },
            { label: 'Land prices (BORIS.NRW)', status: 'partial' },
          ],
          answers: ['Where the quota changes rents'],
          limits: ['Data for Aachen', 'Verifiability'],
        },
        {
          kind: 'plan',
          id: 'housing-plan-c',
          title: 'Plan C: Agent-based housing market',
          outcome: 'not-pursued',
          reason: 'Household-level data is missing, so most behaviour would be invented.',
          idea: 'Households and developers as agents, as in the Bank of England’s housing model (Baptista et al. 2016).',
          data: [{ label: 'Household incomes and moves', status: 'missing' }],
          answers: ['Distributional effects'],
          limits: ['Data for Aachen', 'Verifiability'],
        },
      ],
    },
    {
      id: 'h3',
      author: 'paul',
      time: 'Thu 8 Oct, 15:31',
      blocks: [
        {
          kind: 'text',
          text: 'Go with the first. The disagreement is really about how strongly construction reacts, right?',
        },
      ],
    },
    {
      id: 'h4',
      author: 'agent',
      time: 'Fri 9 Oct, 10:12',
      blocks: [
        {
          kind: 'tools',
          calls: ['Created draft “Two-segment DiPasquale–Wheaton”', 'Wrote models/housing-market.xmile', 'Ran the baseline and 3 scenarios'],
        },
        {
          kind: 'text',
          text: 'Yes. Expiry only moves flats between the segments; it doesn’t change total supply. The quota raises the subsidised share per project but lowers developer prices, so whether total construction falls depends on the construction elasticity. I made that elasticity an explicit, contested assumption and gave each side a scenario.',
        },
        {
          kind: 'draft',
          id: 'housing-draft',
          title: 'Two-segment DiPasquale–Wheaton',
          state: 'merged',
          live: true,
          changes: [
            { op: 'add', text: 'Node housing_market: xmile, models/housing-market.xmile' },
            { op: 'add', text: 'Node quaestio_benchmark: equation' },
            { op: 'add', text: '17 datasets, 16 of them flagged as assumptions' },
            { op: 'add', text: 'Scenarios “No quota”, “Critics’ view: construction reacts strongly” and “Bauturbo”' },
            { op: 'add', text: '5 tasks' },
          ],
        },
        {
          kind: 'run',
          id: 'housing-run',
          title: 'Run: baseline and 3 scenarios',
          checks: [
            { label: 'With a quota of 0 the two segments behave like one', holds: true },
            { label: 'Expiry moves flats between segments without changing the total', holds: true },
          ],
          warnings: ['Annual city data has too few points to validate the model.'],
          live: '<model-claim dataset="stock_free" year="2035" scenario="no-quota" above="baseline">Without the quota, the free segment grows larger.</model-claim>',
        },
        {
          kind: 'text',
          text: 'I’d park it here: almost every input is still a placeholder. The open tasks say what it would take to make it say something about Aachen.',
        },
      ],
    },
  ],
};
