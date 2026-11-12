// ProcureNepal ERP menu — modules (sidebar groups) and their items.
// Module keys must match api/src/access/module-registry.ts. © Cuidado Technology Pvt. Ltd.

export interface MenuItem {
  id: string;
  label: string;
  /** route of a working screen; planned items open /soon/<id> */
  route?: string;
  status: 'built' | 'planned';
  /** what this item does (shown on the "coming soon" page) */
  about?: string;
  /** other items whose data it shares automatically */
  links?: string[];
}
export interface MenuModule {
  key: string;
  label: string;
  icon: string;
  core?: boolean;
  /** overview page of the module, if any */
  route?: string;
  items: MenuItem[];
}

const soon = (id: string, label: string, about: string, links: string[] = []): MenuItem => ({ id, label, status: 'planned', about, links });

export const MENU: MenuModule[] = [
  {
    key: 'companies', label: 'Companies', icon: '🏢', core: true,
    items: [
      { id: 'companies.list', label: 'List Companies', route: '/companies', status: 'built' },
      { id: 'companies.users', label: 'User Setup System', route: '/users', status: 'built' },
    ],
  },
  {
    key: 'bolpatra', label: 'Bolpatra eGP System', icon: '📋', route: '/bolpatra',
    items: [
      { id: 'bolpatra.bid-info', label: 'Bid Information Management', route: '/bids', status: 'built', links: ['bolpatra.tenders', 'bank.guarantee', 'project.info'] },
      { id: 'bolpatra.certificates', label: 'Certificates', route: '/certificates', status: 'built' },
      { id: 'bolpatra.tenders', label: 'Tenders', route: '/tenders', status: 'built' },
      { id: 'bolpatra.qualification', label: 'Qualification', route: '/qualification', status: 'built' },
      { id: 'bolpatra.reports', label: 'Reports', route: '/reports', status: 'built', links: ['bolpatra.tenders', 'bolpatra.qualification', 'bolpatra.bid-info'] },
    ],
  },
  {
    key: 'procurement', label: 'Procurement & Inventory', icon: '📦',
    items: [
      soon('proc.requisition', 'Items Requisition Management', 'Site staff request materials; approvals by store / project manager.', ['project.material-plan', 'proc.rfq', 'proc.site-warehouse']),
      soon('proc.rfq', 'Request for Quotation (RFQ)', 'Create RFQs from approved requisitions and send RFQ emails to vendors.', ['proc.requisition', 'proc.vendors', 'proc.quotations']),
      soon('proc.quotations', 'Quotation Collection', 'Record multiple quotations from vendors against an RFQ.', ['proc.rfq', 'proc.compare']),
      soon('proc.compare', 'Quotation Comparison and Award', 'Side-by-side comparison, award to the chosen vendor.', ['proc.quotations', 'proc.po']),
      soon('proc.po', 'Purchase Order Management', 'Purchase orders from an awarded RFQ or direct.', ['proc.compare', 'proc.proforma', 'proc.grn', 'bank.finance']),
      soon('proc.proforma', 'Pro Forma Invoice and Purchase Bank', 'Pro forma invoices and bank payments / LC for purchases.', ['proc.po', 'bank.lc', 'bank.banks']),
      soon('proc.grn', 'Goods Receipt Note (GRN)', 'Receive goods against a PO into a site warehouse.', ['proc.po', 'proc.site-warehouse']),
      soon('proc.transfer', 'Stock Transfer between Sites', 'Move stock between site warehouses.', ['proc.site-warehouse', 'project.site-warehouse']),
      soon('proc.dispatch', 'Stock Dispatch', 'Dispatch stock to customers or project sites.', ['proc.site-warehouse', 'fleet.trips']),
      soon('proc.return', 'Stock Return Management', 'Returns from sites and to vendors.', ['proc.grn', 'proc.site-warehouse']),
      soon('proc.warehouse-setup', 'Warehouse Setup — Category, Brand, Product', 'Item master: categories, brands, products, units.', ['proc.requisition', 'project.boq']),
      soon('proc.vendors', 'Vendor Management', 'Vendor register with PAN/VAT, contacts and ratings.', ['proc.rfq', 'proc.po']),
      soon('proc.number-series', 'Number Series Setup', 'Automatic numbering for requisitions, RFQ, PO, GRN, transfers.', []),
      soon('proc.site-warehouse', 'Site Warehouse Management', 'Stock per site warehouse — the same warehouses used by Project Management.', ['project.site-warehouse', 'proc.grn', 'proc.transfer']),
    ],
  },
  {
    key: 'fleet', label: 'Vehicle & Fleet', icon: '🚚',
    items: [
      soon('fleet.vehicles', 'Vehicle Information Setup', 'Vehicles and equipment with registration, capacity and documents.', ['fleet.tax', 'bank.assets']),
      soon('fleet.maintenance', 'Maintenance and Servicing', 'Service schedules, repairs and parts used.', ['fleet.vehicles', 'proc.site-warehouse']),
      soon('fleet.tax', 'Vehicle Tax and Insurance', 'Tax, insurance and blue-book renewals with expiry alerts.', ['fleet.vehicles']),
      soon('fleet.movement', 'Vehicle Movement and Fleet', 'Where each vehicle is and which project uses it.', ['project.info', 'fleet.trips']),
      soon('fleet.logs', 'Daily Vehicle Work Log', 'Daily hours / km, fuel and operator.', ['fleet.earnings', 'project.progress']),
      soon('fleet.trips', 'Vehicle Trip Management', 'Trips for material delivery and dispatch.', ['proc.dispatch', 'fleet.logs']),
      soon('fleet.earnings', 'Vehicle-wise Earning and Expense', 'Income and cost per vehicle.', ['fleet.logs', 'bank.finance']),
      soon('fleet.allowance', 'Allowance Setup and Management', 'Driver / operator allowances.', ['hr.payroll']),
    ],
  },
  {
    key: 'hr', label: 'HR and Operations', icon: '👥',
    items: [
      soon('hr.employees', 'Employee User Setup', 'Employee records; an employee can be given a login in User Setup.', ['companies.users', 'hr.payroll', 'bolpatra.tenders']),
      soon('hr.payroll', 'Payroll Setup', 'Salary structure, SSF contributions and bank payments.', ['hr.employees', 'fleet.allowance', 'bank.banks']),
    ],
  },
  {
    key: 'project', label: 'Project Management', icon: '🏗️',
    items: [
      { id: 'project.info', label: 'Project Information', route: '/projects', status: 'built', about: 'Projects created from won tenders, with contract data.', links: ['bolpatra.bid-info', 'bolpatra.tenders', 'bolpatra.certificates', 'bank.guarantee'] },
      { id: 'project.boq', label: 'BOQ Management — Excel Upload', route: '/boq', status: 'built', about: 'Upload the BOQ from Excel; quantities, rates and progress.', links: ['project.info', 'project.material-plan', 'project.norms'] },
      soon('project.documents', 'Document Management', 'Contract, drawings, approvals and correspondence per project.', ['project.info']),
      soon('project.milestones', 'Goal and Milestone Management', 'Milestones with target dates and payment links.', ['project.schedule', 'project.progress']),
      soon('project.schedule', 'Work Schedule and Project Period', 'Work programme, extensions of time.', ['project.milestones', 'project.scurve']),
      soon('project.material-plan', 'Raw Material Allocation Planning', 'Materials needed from BOQ × norms, sent as requisitions.', ['project.boq', 'project.norms', 'proc.requisition']),
      soon('project.scurve', 'Variance Chart / S-Curve', 'Planned vs actual progress and cost.', ['project.schedule', 'project.progress']),
      soon('project.progress', 'Progress Report Management', 'Daily / monthly progress; becomes the experience certificate quantities at completion.', ['project.boq', 'bolpatra.certificates']),
      soon('project.reporting', 'Overall Project Reporting', 'Portfolio dashboard across projects.', ['project.progress', 'bank.finance']),
      soon('project.petty', 'Petty Contractor Management', 'Petty contractors, work orders and bills.', ['project.boq', 'bank.finance']),
      soon('project.petty-inventory', 'Petty Contractor Inventory', 'Materials issued to petty contractors.', ['project.petty', 'proc.site-warehouse']),
      soon('project.site-warehouse', 'Site Warehouse Management', 'Integrated with Procurement — the same site warehouses and stock.', ['proc.site-warehouse']),
      soon('project.norms', 'Norms Ratio Management', 'Material and labour norms per BOQ item (DoR / DUDBC norms).', ['project.boq', 'project.material-plan']),
    ],
  },
  {
    key: 'bank', label: 'Bank System', icon: '🏦',
    items: [
      { id: 'bank.banks', label: 'Bank Management', route: '/banks', status: 'built', about: 'Banks, accounts and guarantee limits per company.', links: ['bank.guarantee', 'bank.loans'] },
      { id: 'bank.guarantee', label: 'Bank Guarantee Management', route: '/bank-guarantees', status: 'built', about: 'Bid, performance and advance guarantees with expiry alerts.', links: ['bolpatra.bid-info', 'bolpatra.tenders', 'project.info', 'bank.banks'] },
      soon('bank.loans', 'Loan Management and Amortization', 'Loans with amortization schedules.', ['bank.banks', 'bank.finance']),
      soon('bank.lc', 'LC Management — at Sight, Discounted, Usance', 'Letters of credit for imports.', ['proc.proforma', 'bank.banks']),
      soon('bank.finance', 'Finance Dashboard', 'Cash, guarantees, loans and payables at a glance.', ['bank.banks', 'bank.loans', 'proc.po']),
      soon('bank.bank-loan', 'Bank and Loan Management', 'Facility limits and utilisation per bank.', ['bank.banks', 'bank.loans']),
      soon('bank.csv', 'CSV Export', 'Export any finance list to CSV / Excel.', []),
      soon('bank.assets', 'Fixed Assets — Land, Building, Land & Building', 'Fixed asset register (used for net worth / financial capability).', ['fleet.vehicles', 'bolpatra.qualification']),
    ],
  },
];

export const ALL_ITEMS: MenuItem[] = MENU.flatMap((m) => m.items);
export const itemById = (id: string) => ALL_ITEMS.find((i) => i.id === id);
export const moduleOfItem = (id: string) => MENU.find((m) => m.items.some((i) => i.id === id));
/** route → module key (for the route guard) */
export const moduleOfRoute = (route: string): string | null => {
  for (const m of MENU) {
    if (m.route && route.startsWith(m.route)) return m.key;
    for (const i of m.items) if (i.route && (route === i.route || route.startsWith(i.route + '/'))) return m.key;
  }
  return null;
};
