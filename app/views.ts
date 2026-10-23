import type { Component } from 'solid-js';
import { PythonView } from './python/PythonView';
import { StockFlowView, type ModelViewProps } from './stockflow/StockFlowView';

/** Views that show the inside of a node, keyed by the node's semantics. */
export const modelViews: Record<string, Component<ModelViewProps>> = {
  xmile: StockFlowView,
  python: PythonView,
};
