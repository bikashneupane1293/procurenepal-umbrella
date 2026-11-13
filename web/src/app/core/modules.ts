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

/** an item drawn by the ERP engine page (/m/<id>) from the definition the API sends */
const erp = (id: string, label: string, about: string, links: string[] = []): MenuItem => ({ id, label, route: '/m/' + id, status: 'built', about, links });

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
      { id: 'bolpatra.references', label: 'External References (PPMO / NRB)', route: '/references', status: 'built' },
      erp('bolpatra.litigation', 'Litigation History', 'Pending and resolved court / arbitration cases, per company — part of the bidder profile.'),
      erp('bolpatra.bidder-profile', 'Bidder Profile', 'One place for a company\'s whole qualification picture — staff, equipment, financials and litigation.', ['hr.employees', 'fleet.vehicles', 'bank.assets', 'bolpatra.litigation']),
    ],
  },
  {
    key: 'procurement', label: 'Procurement & Inventory', icon: '📦',
    items: [
      erp('proc.requisition', 'Items Requisition Management', 'Site staff request materials; approvals by store / project manager.', ['project.material-plan', 'proc.rfq', 'proc.site-warehouse']),
      erp('proc.rfq', 'Request for Quotation (RFQ)', 'Create RFQs from approved requisitions and send RFQ emails to vendors.', ['proc.requisition', 'proc.vendors', 'proc.quotations']),
      erp('proc.quotations', 'Quotation Collection', 'Record multiple quotations from vendors against an RFQ.', ['proc.rfq', 'proc.compare']),
      erp('proc.compare', 'Quotation Comparison and Award', 'Side-by-side comparison, award to the chosen vendor.', ['proc.quotations', 'proc.po']),
      erp('proc.po', 'Purchase Order Management', 'Purchase orders from an awarded RFQ or direct.', ['proc.compare', 'proc.proforma', 'proc.grn', 'bank.finance']),
      erp('proc.proforma', 'Pro Forma Invoice and Purchase Bank', 'Pro forma invoices and bank payments / LC for purchases.', ['proc.po', 'bank.lc', 'bank.banks']),
      erp('proc.grn', 'Goods Receipt Note (GRN)', 'Receive goods against a PO into a site warehouse.', ['proc.po', 'proc.site-warehouse']),
      erp('proc.transfer', 'Stock Transfer between Sites', 'Move stock between site warehouses.', ['proc.site-warehouse', 'project.site-warehouse']),
      erp('proc.dispatch', 'Stock Dispatch', 'Dispatch stock to customers or project sites.', ['proc.site-warehouse', 'fleet.trips']),
      erp('proc.return', 'Stock Return Management', 'Returns from sites and to vendors.', ['proc.grn', 'proc.site-warehouse']),
      erp('proc.warehouse-setup', 'Warehouse Setup — Category, Brand, Product', 'Item master: categories, brands, products, units.', ['proc.requisition', 'project.boq']),
      erp('proc.vendors', 'Vendor Management', 'Vendor register with PAN/VAT, contacts and ratings.', ['proc.rfq', 'proc.po']),
      erp('proc.number-series', 'Number Series Setup', 'Automatic numbering for requisitions, RFQ, PO, GRN, transfers.', []),
      erp('proc.site-warehouse', 'Site Warehouse Management', 'Stock per site warehouse — the same warehouses used by Project Management.', ['project.site-warehouse', 'proc.grn', 'proc.transfer']),
    ],
  },
  {
    key: 'fleet', label: 'Vehicle & Fleet', icon: '🚚',
    items: [
      erp('fleet.vehicles', 'Vehicle Information Setup', 'Vehicles and equipment with registration, capacity and documents.', ['fleet.tax', 'bank.assets']),
      erp('fleet.maintenance', 'Maintenance and Servicing', 'Service schedules, repairs and parts used.', ['fleet.vehicles', 'proc.site-warehouse']),
      erp('fleet.tax', 'Vehicle Tax and Insurance', 'Tax, insurance and blue-book renewals with expiry alerts.', ['fleet.vehicles']),
      erp('fleet.movement', 'Vehicle Movement and Fleet', 'Where each vehicle is and which project uses it.', ['project.info', 'fleet.trips']),
      erp('fleet.logs', 'Daily Vehicle Work Log', 'Daily hours / km, fuel and operator.', ['fleet.earnings', 'project.progress']),
      erp('fleet.trips', 'Vehicle Trip Management', 'Trips for material delivery and dispatch.', ['proc.dispatch', 'fleet.logs']),
      erp('fleet.earnings', 'Vehicle-wise Earning and Expense', 'Income and cost per vehicle.', ['fleet.logs', 'bank.finance']),
      erp('fleet.allowance', 'Allowance Setup and Management', 'Driver / operator allowances.', ['hr.payroll']),
    ],
  },
  {
    key: 'hr', label: 'HR and Operations', icon: '👥',
    items: [
      erp('hr.employees', 'Employee User Setup', 'Employee records; an employee can be given a login in User Setup.', ['companies.users', 'hr.payroll', 'bolpatra.tenders']),
      erp('hr.payroll', 'Payroll Setup', 'Salary structure, SSF contributions and bank payments.', ['hr.employees', 'fleet.allowance', 'bank.banks']),
    ],
  },
  {
    key: 'project', label: 'Project Management', icon: '🏗️',
    items: [
      { id: 'project.info', label: 'Project Information', route: '/projects', status: 'built', about: 'Projects created from won tenders, with contract data.', links: ['bolpatra.bid-info', 'bolpatra.tenders', 'bolpatra.certificates', 'bank.guarantee'] },
      { id: 'project.boq', label: 'BOQ Management — Excel Upload', route: '/boq', status: 'built', about: 'Upload the BOQ from Excel; quantities, rates and progress.', links: ['project.info', 'project.material-plan', 'project.norms'] },
      erp('project.documents', 'Document Management', 'Contract, drawings, approvals and correspondence per project — with an expiry alert list.', ['project.info']),
      erp('project.milestones', 'Goal and Milestone Management', 'Milestones with target dates and payment links.', ['project.schedule', 'project.progress']),
      erp('project.schedule', 'Work Schedule and Project Period', 'Work programme, extensions of time.', ['project.milestones', 'project.scurve']),
      erp('project.material-plan', 'Raw Material Allocation Planning', 'Materials needed from BOQ × norms, sent as requisitions.', ['project.boq', 'project.norms', 'proc.requisition']),
      erp('project.scurve', 'Variance Chart / S-Curve', 'Planned vs actual progress and cost.', ['project.schedule', 'project.progress']),
      erp('project.progress', 'Progress Report Management', 'Daily / monthly progress; becomes the experience certificate quantities at completion.', ['project.boq', 'bolpatra.certificates']),
      erp('project.daily-report', 'Daily Site Reporting', 'Daily site diary — weather, manpower, equipment, issues and material use.', ['project.info', 'project.progress']),
      erp('project.reporting', 'Overall Project Reporting', 'Portfolio dashboard across projects.', ['project.progress', 'bank.finance']),
      erp('project.petty', 'Petty Contractor Management', 'Petty contractors, work orders and bills.', ['project.boq', 'bank.finance']),
      erp('project.petty-inventory', 'Petty Contractor Inventory', 'Materials issued to petty contractors.', ['project.petty', 'proc.site-warehouse']),
      erp('project.site-warehouse', 'Site Warehouse Management', 'Integrated with Procurement — the same site warehouses and stock.', ['proc.site-warehouse']),
      erp('project.norms', 'Norms Ratio Management', 'Material and labour norms per BOQ item (DoR / DUDBC norms).', ['project.boq', 'project.material-plan']),
    ],
  },
  {
    key: 'bank', label: 'Bank System', icon: '🏦',
    items: [
      { id: 'bank.banks', label: 'Bank Management', route: '/banks', status: 'built', about: 'Banks, accounts and guarantee limits per company.', links: ['bank.guarantee', 'bank.loans'] },
      { id: 'bank.guarantee', label: 'Bank Guarantee Management', route: '/bank-guarantees', status: 'built', about: 'Bid, performance and advance guarantees with expiry alerts.', links: ['bolpatra.bid-info', 'bolpatra.tenders', 'project.info', 'bank.banks'] },
      erp('bank.loans', 'Loan Management and Amortization', 'Loans with amortization schedules.', ['bank.banks', 'bank.finance']),
      erp('bank.lc', 'LC Management — at Sight, Discounted, Usance', 'Letters of credit for imports.', ['proc.proforma', 'bank.banks']),
      erp('bank.finance', 'Finance Dashboard', 'Cash, guarantees, loans and payables at a glance.', ['bank.banks', 'bank.loans', 'proc.po']),
      erp('bank.bank-loan', 'Bank and Loan Management', 'Facility limits and utilisation per bank.', ['bank.banks', 'bank.loans']),
      erp('bank.csv', 'CSV Export', 'Export any finance list to CSV / Excel.', []),
      erp('bank.assets', 'Fixed Assets — Land, Building, Land & Building', 'Fixed asset register (used for net worth / financial capability).', ['fleet.vehicles', 'bolpatra.qualification']),
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
