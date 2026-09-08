import React from 'react';
import {createRoot} from 'react-dom/client';
import '/Users/jacksonsweet/Projects/OPS/ops-design-system/project/colors_and_type.css';
import '../../../../src/styles/globals.css';
import {FinancialPolicyPanel} from '../../../../src/components/agent/financial-policy-panel';
createRoot(document.getElementById('root')!).render(<main className="p-3"><FinancialPolicyPanel sourceId="40000000-0000-4000-8000-000000000001"/></main>);
