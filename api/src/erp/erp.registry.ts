// =====================================================================
// ProcureNepal ERP engine — entity + menu definitions (single source).
// The web app asks the API for these definitions and draws the pages from them,
// so a new register / document is added here only. © Cuidado Technology Pvt. Ltd.
// =====================================================================

export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'ref' | 'multiref' | 'bool' | 'email';
export interface FieldDef {
  k: string; label: string; type: FieldType;
  req?: boolean; options?: string[]; ref?: string; list?: boolean; def?: any; help?: string; max?: number;
  /** read-only: filled by the server */
  calc?: boolean;
}
export interface EntityDef {
  key: string; title: string; one: string;
  /** default prefix of the automatic document number (can be changed in Number Series) */
  series?: string;
  labelField?: string;
  statuses?: string[];
  fields: FieldDef[];
  lines?: { title: string; required?: boolean; cols: FieldDef[] };
  actions?: { key: string; label: string; when?: string[] }[];
  help?: string;
}
export interface TabDef { kind: 'entity' | 'report' | 'csv'; entity?: string; report?: string; title: string; params?: { k: string; label: string; ref?: string; type?: 'date'; req?: boolean }[] }
export interface MenuDef { id: string; title: string; about: string; tabs: TabDef[] }

const f = (k: string, label: string, type: FieldType = 'text', o: Partial<FieldDef> = {}): FieldDef => ({ k, label, type, ...o });
const L = { list: true };
const R = { req: true, list: true };
const notes = f('notes', 'Notes', 'textarea');
const date = f('date', 'Date', 'date', R);
const product = f('product', 'Product', 'ref', { ref: 'proc.product', req: true });
const qty = f('qty', 'Quantity', 'number', { req: true });
const rate = f('rate', 'Rate (NPR)', 'money');
const amount = f('amount', 'Amount', 'money', { calc: true });
const unit = f('unit', 'Unit', 'text', { calc: true });
const itemLines = (title: string, withRate: boolean, required = true) => ({
  title, required, cols: [product, unit, qty, ...(withRate ? [rate, amount] : []), f('remarks', 'Remarks')],
});
const POSTING = ['DRAFT', 'POSTED'];
const postHelp = 'Stock changes only when the status is POSTED.';

export const ENTITIES: EntityDef[] = [
  // ------------------------------------------------------------ Procurement & Inventory
  { key: 'proc.category', title: 'Categories', one: 'category', fields: [f('name', 'Category name', 'text', R), f('code', 'Code', 'text', L), notes] },
  { key: 'proc.brand', title: 'Brands', one: 'brand', fields: [f('name', 'Brand name', 'text', R), notes] },
  { key: 'proc.product', title: 'Products', one: 'product', fields: [
    f('name', 'Product name', 'text', R), f('code', 'Code', 'text', L), f('category', 'Category', 'ref', { ref: 'proc.category', list: true }),
    f('brand', 'Brand', 'ref', { ref: 'proc.brand', list: true }), f('unit', 'Unit', 'text', { req: true, list: true, help: 'bag, m3, kg, litre, nos …' }),
    f('reorderLevel', 'Re-order level', 'number', { help: 'Stock report warns below this quantity' }), f('lastRate', 'Usual rate (NPR)', 'money', L), notes] },
  { key: 'proc.warehouse', title: 'Warehouses', one: 'warehouse', fields: [
    f('name', 'Warehouse name', 'text', R), f('type', 'Type', 'select', { options: ['MAIN', 'SITE'], def: 'SITE', list: true }),
    f('project', 'Project (site)', 'ref', { ref: 'project', list: true }), f('location', 'Location', 'text', L), f('keeper', 'Store keeper'), notes] },
  { key: 'proc.vendor', title: 'Vendors', one: 'vendor', fields: [
    f('name', 'Vendor name', 'text', R), f('panVat', 'PAN / VAT No.', 'text', L), f('contactPerson', 'Contact person', 'text', L), f('phone', 'Phone', 'text', L),
    f('email', 'Email', 'email', L), f('address', 'Address'), f('supplies', 'Supplies (cement, steel …)', 'text', L),
    f('rating', 'Rating', 'select', { options: ['1', '2', '3', '4', '5'] }), f('bankDetails', 'Bank account details'), notes] },
  { key: 'proc.series', title: 'Number series', one: 'number series', labelField: 'prefix',
    help: 'Documents are numbered PREFIX-0001, PREFIX-0002 … Without a row here the default prefix is used.',
    fields: [f('docType', 'Document', 'select', { options: [], req: true, list: true }), f('prefix', 'Prefix', 'text', { req: true, list: true, help: 'e.g. PO-2083' }),
      f('padding', 'Digits', 'number', { def: 4, list: true }), f('nextNumber', 'Next number', 'number', { def: 1, list: true })] },
  { key: 'proc.requisition', title: 'Requisitions', one: 'requisition', series: 'REQ', labelField: 'purpose',
    statuses: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'CLOSED'],
    fields: [date, f('project', 'Project', 'ref', { ref: 'project', list: true }), f('warehouse', 'Deliver to warehouse', 'ref', { ref: 'proc.warehouse' }),
      f('requestedBy', 'Requested by', 'text', L), f('neededBy', 'Needed by', 'date', L), f('purpose', 'Purpose', 'text', L), notes],
    lines: itemLines('Items requested', false),
    actions: [{ key: 'make-rfq', label: 'Create RFQ →', when: ['APPROVED'] }] },
  { key: 'proc.rfq', title: 'RFQs', one: 'RFQ', series: 'RFQ', labelField: 'subject', statuses: ['DRAFT', 'SENT', 'CLOSED', 'AWARDED'],
    fields: [date, f('subject', 'Subject', 'text', L), f('requisition', 'Requisition', 'ref', { ref: 'proc.requisition', list: true }),
      f('project', 'Project', 'ref', { ref: 'project' }), f('vendors', 'Vendors to ask', 'multiref', { ref: 'proc.vendor', req: true, list: true }),
      f('dueDate', 'Quotations due', 'date', L), f('terms', 'Terms / delivery place', 'textarea')],
    lines: itemLines('Items', false),
    actions: [{ key: 'email-rfq', label: '✉ Email vendors', when: ['DRAFT', 'SENT'] }] },
  { key: 'proc.quotation', title: 'Quotations', one: 'quotation', series: 'QTN', labelField: 'vendorRef', statuses: ['RECEIVED', 'AWARDED', 'REJECTED'],
    fields: [f('rfq', 'RFQ', 'ref', { ref: 'proc.rfq', req: true, list: true }), f('vendor', 'Vendor', 'ref', { ref: 'proc.vendor', req: true, list: true }), date,
      f('vendorRef', "Vendor's quotation no.", 'text', L), f('validUntil', 'Valid until', 'date'), f('deliveryDays', 'Delivery (days)', 'number'),
      f('paymentTerms', 'Payment terms'), f('vatPct', 'VAT %', 'number', { def: 13, max: 100, help: 'Rates are entered excluding VAT' }), notes],
    lines: itemLines('Quoted rates', true) },
  { key: 'proc.po', title: 'Purchase orders', one: 'purchase order', series: 'PO', labelField: 'subject', statuses: ['DRAFT', 'ISSUED', 'PARTIAL', 'RECEIVED', 'CANCELLED'],
    fields: [date, f('vendor', 'Vendor', 'ref', { ref: 'proc.vendor', req: true, list: true }), f('subject', 'Subject'), f('project', 'Project', 'ref', { ref: 'project', list: true }),
      f('warehouse', 'Deliver to warehouse', 'ref', { ref: 'proc.warehouse' }), f('quotation', 'Quotation', 'ref', { ref: 'proc.quotation' }), f('rfq', 'RFQ', 'ref', { ref: 'proc.rfq' }),
      f('deliveryDate', 'Delivery date', 'date', L), f('paymentTerms', 'Payment terms'), f('vatPct', 'VAT %', 'number', { def: 13, max: 100 }), notes],
    lines: itemLines('Items ordered', true),
    actions: [{ key: 'make-grn', label: 'Receive goods (GRN) →', when: ['ISSUED', 'PARTIAL'] }, { key: 'make-proforma', label: 'Pro forma / payment →', when: ['ISSUED', 'PARTIAL', 'RECEIVED'] }] },
  { key: 'proc.proforma', title: 'Pro forma invoices and payments', one: 'pro forma invoice', series: 'PI', labelField: 'piNumber', statuses: ['PENDING', 'APPROVED', 'PAID', 'CANCELLED'],
    fields: [f('po', 'Purchase order', 'ref', { ref: 'proc.po', req: true, list: true }), f('vendor', 'Vendor', 'ref', { ref: 'proc.vendor', list: true }), date,
      f('piNumber', "Vendor's PI / invoice no.", 'text', L), f('amount', 'Amount incl. VAT (NPR)', 'money', R), f('bank', 'Paying bank', 'ref', { ref: 'bank', list: true }),
      f('paymentMode', 'Payment mode', 'select', { options: ['CASH', 'CHEQUE', 'BANK_TRANSFER', 'LC', 'TT'], list: true }), f('lc', 'Letter of credit', 'ref', { ref: 'bank.lc' }),
      f('chequeNo', 'Cheque / transfer ref.'), f('paidAmount', 'Paid amount (NPR)', 'money', L), f('paidDate', 'Paid on', 'date'), notes] },
  { key: 'proc.grn', title: 'Goods receipt notes', one: 'GRN', series: 'GRN', labelField: 'challanNo', statuses: POSTING, help: postHelp,
    fields: [date, f('po', 'Purchase order', 'ref', { ref: 'proc.po', list: true }), f('vendor', 'Vendor', 'ref', { ref: 'proc.vendor', list: true }),
      f('warehouse', 'Received in warehouse', 'ref', { ref: 'proc.warehouse', req: true, list: true }), f('challanNo', 'Challan / bill no.', 'text', L),
      f('vehicleNo', 'Vehicle no.'), f('receivedBy', 'Received by'), notes],
    lines: itemLines('Items received', true) },
  { key: 'proc.transfer', title: 'Stock transfers', one: 'stock transfer', series: 'TRF', labelField: 'reason', statuses: POSTING, help: postHelp,
    fields: [date, f('fromWarehouse', 'From warehouse', 'ref', { ref: 'proc.warehouse', req: true, list: true }), f('toWarehouse', 'To warehouse', 'ref', { ref: 'proc.warehouse', req: true, list: true }),
      f('vehicle', 'Vehicle', 'ref', { ref: 'fleet.vehicle' }), f('reason', 'Reason', 'text', L), notes],
    lines: itemLines('Items moved', false) },
  { key: 'proc.dispatch', title: 'Stock dispatches', one: 'stock dispatch', series: 'DSP', labelField: 'issuedTo', statuses: POSTING, help: postHelp,
    fields: [date, f('warehouse', 'From warehouse', 'ref', { ref: 'proc.warehouse', req: true, list: true }), f('project', 'Project', 'ref', { ref: 'project', list: true }),
      f('purpose', 'Purpose', 'select', { options: ['SITE_USE', 'CUSTOMER', 'OTHER'], def: 'SITE_USE', list: true }), f('issuedTo', 'Issued to', 'text', L),
      f('vehicle', 'Vehicle', 'ref', { ref: 'fleet.vehicle' }), notes],
    lines: itemLines('Items issued', false) },
  { key: 'proc.return', title: 'Stock returns', one: 'stock return', series: 'RTN', labelField: 'reason', statuses: POSTING, help: postHelp,
    fields: [date, f('type', 'Return type', 'select', { options: ['SITE_TO_WAREHOUSE', 'TO_VENDOR'], req: true, list: true, def: 'SITE_TO_WAREHOUSE' }),
      f('warehouse', 'Warehouse', 'ref', { ref: 'proc.warehouse', req: true, list: true }), f('vendor', 'Vendor (for returns to vendor)', 'ref', { ref: 'proc.vendor' }),
      f('project', 'Project', 'ref', { ref: 'project' }), f('reason', 'Reason', 'text', L), notes],
    lines: itemLines('Items returned', false) },

  // ------------------------------------------------------------ Vehicle & Fleet
  { key: 'fleet.vehicle', title: 'Vehicles and equipment', one: 'vehicle', statuses: ['ACTIVE', 'UNDER_REPAIR', 'IDLE', 'SOLD'], fields: [
    f('name', 'Name', 'text', { req: true, list: true, help: 'e.g. Tipper 1' }), f('regNo', 'Registration no.', 'text', R),
    f('type', 'Type', 'select', { options: ['TIPPER', 'EXCAVATOR', 'LOADER', 'ROLLER', 'GRADER', 'MIXER', 'CRANE', 'TRACTOR', 'PICKUP', 'CAR', 'MOTORCYCLE', 'OTHER'], list: true }),
    f('company', 'Owner company', 'ref', { ref: 'company' }), f('make', 'Make'), f('model', 'Model'), f('year', 'Year', 'number'), f('capacity', 'Capacity', 'text', L),
    f('ownership', 'Ownership', 'select', { options: ['OWNED', 'HIRED'], def: 'OWNED' }), f('purchaseDate', 'Purchase date', 'date'), f('purchaseCost', 'Purchase cost (NPR)', 'money'),
    f('hourlyRate', 'Earning rate per hour (NPR)', 'money', { help: 'Used by the daily work log when no earning is typed' }), f('kmRate', 'Earning rate per km (NPR)', 'money'),
    f('operator', 'Usual operator / driver', 'ref', { ref: 'hr.employee', list: true }), notes] },
  { key: 'fleet.maintenance', title: 'Maintenance and servicing', one: 'maintenance record', labelField: 'description', fields: [
    f('vehicle', 'Vehicle', 'ref', { ref: 'fleet.vehicle', req: true, list: true }), date,
    f('type', 'Type', 'select', { options: ['SERVICE', 'REPAIR', 'TYRE', 'BATTERY', 'OTHER'], list: true, def: 'SERVICE' }), f('meter', 'Meter reading (km / hours)', 'number'),
    f('description', 'Work done', 'text', L), f('workshop', 'Workshop'), f('partsCost', 'Parts cost (NPR)', 'money'), f('labourCost', 'Labour cost (NPR)', 'money'),
    f('cost', 'Total cost (NPR)', 'money', { calc: true, list: true }), f('nextDueDate', 'Next service due', 'date', L), f('nextDueMeter', 'Next service at meter', 'number'), notes] },
  { key: 'fleet.tax', title: 'Tax, insurance and renewals', one: 'renewal', labelField: 'policyNo', statuses: ['ACTIVE', 'RENEWED', 'EXPIRED'], fields: [
    f('vehicle', 'Vehicle', 'ref', { ref: 'fleet.vehicle', req: true, list: true }),
    f('kind', 'Kind', 'select', { options: ['ROAD_TAX', 'INSURANCE', 'BLUEBOOK_RENEWAL', 'ROUTE_PERMIT', 'POLLUTION_CHECK', 'OTHER'], req: true, list: true }),
    f('provider', 'Office / insurer'), f('policyNo', 'Policy / receipt no.', 'text', L), f('from', 'Valid from', 'date'), f('expiry', 'Valid until (expiry)', 'date', R),
    f('amount', 'Amount (NPR)', 'money', L), notes] },
  { key: 'fleet.movement', title: 'Vehicle movement', one: 'movement', labelField: 'location', statuses: ['ASSIGNED', 'RETURNED'], fields: [
    f('vehicle', 'Vehicle', 'ref', { ref: 'fleet.vehicle', req: true, list: true }), f('project', 'Project', 'ref', { ref: 'project', list: true }), f('location', 'Location', 'text', L),
    f('from', 'From', 'date', R), f('to', 'To', 'date', L), f('operator', 'Operator / driver', 'ref', { ref: 'hr.employee' }), f('purpose', 'Purpose'), notes] },
  { key: 'fleet.log', title: 'Daily work log', one: 'work log', labelField: 'workDone', fields: [
    date, f('vehicle', 'Vehicle', 'ref', { ref: 'fleet.vehicle', req: true, list: true }), f('project', 'Project', 'ref', { ref: 'project', list: true }),
    f('operator', 'Operator / driver', 'ref', { ref: 'hr.employee' }), f('startMeter', 'Start meter', 'number'), f('endMeter', 'End meter', 'number'),
    f('hours', 'Hours worked', 'number', L), f('km', 'Km run', 'number', { list: true, help: 'Blank = end meter − start meter' }), f('fuelLitres', 'Fuel (litres)', 'number', L),
    f('fuelCost', 'Fuel cost (NPR)', 'money'), f('workDone', 'Work done', 'text'), f('earning', 'Earning (NPR)', 'money', { list: true, help: 'Blank = hours × hourly rate + km × km rate' }), notes] },
  { key: 'fleet.trip', title: 'Trips', one: 'trip', series: 'TRP', labelField: 'material', fields: [
    date, f('vehicle', 'Vehicle', 'ref', { ref: 'fleet.vehicle', req: true, list: true }), f('driver', 'Driver', 'ref', { ref: 'hr.employee' }), f('from', 'From', 'text', L), f('to', 'To', 'text', L),
    f('km', 'Km', 'number'), f('material', 'Material carried', 'text', L), f('qty', 'Quantity', 'number'), f('unit', 'Unit'), f('project', 'Project', 'ref', { ref: 'project' }),
    f('dispatch', 'Stock dispatch', 'ref', { ref: 'proc.dispatch' }), f('income', 'Trip income (NPR)', 'money', L), f('fuelCost', 'Fuel cost (NPR)', 'money'), f('otherCost', 'Toll / other cost (NPR)', 'money'), notes] },
  { key: 'fleet.txn', title: 'Other income and expense', one: 'entry', labelField: 'head', fields: [
    date, f('vehicle', 'Vehicle', 'ref', { ref: 'fleet.vehicle', req: true, list: true }), f('kind', 'Kind', 'select', { options: ['INCOME', 'EXPENSE'], req: true, list: true }),
    f('head', 'Head (hire income, fine, parking …)', 'text', L), f('amount', 'Amount (NPR)', 'money', R), notes] },
  { key: 'fleet.allowance', title: 'Allowances', one: 'allowance', labelField: 'kind', fields: [
    date, f('employee', 'Driver / operator', 'ref', { ref: 'hr.employee', req: true, list: true }), f('vehicle', 'Vehicle', 'ref', { ref: 'fleet.vehicle', list: true }),
    f('kind', 'Kind', 'select', { options: ['DAILY', 'OVERTIME', 'NIGHT', 'TRIP', 'FOOD', 'OTHER'], req: true, list: true, def: 'DAILY' }),
    f('qty', 'Days / hours / trips', 'number', { def: 1 }), f('rate', 'Rate (NPR)', 'money'), f('amount', 'Amount (NPR)', 'money', { list: true, help: 'Blank = quantity × rate' }),
    f('paid', 'Paid (included in a paid payroll)', 'bool', L), notes] },

  // ------------------------------------------------------------ HR and Operations
  { key: 'hr.employee', title: 'Employees', one: 'employee', statuses: ['ACTIVE', 'LEFT'], help: 'To let an employee sign in, add a user with the same email in Companies → User Setup.', fields: [
    f('name', 'Full name', 'text', R), f('code', 'Employee code', 'text', L), f('company', 'Company', 'ref', { ref: 'company', list: true }), f('designation', 'Designation', 'text', L),
    f('department', 'Department'), f('type', 'Type', 'select', { options: ['PERMANENT', 'CONTRACT', 'DAILY_WAGE'], def: 'PERMANENT', list: true }), f('project', 'Project (posting)', 'ref', { ref: 'project' }),
    f('joinDate', 'Joining date', 'date'), f('phone', 'Phone', 'text', L), f('email', 'Email', 'email'), f('address', 'Address'), f('panNo', 'PAN no.'), f('ssfNo', 'SSF no.'),
    f('bankName', 'Salary bank'), f('bankAccount', 'Bank account no.'), f('basicSalary', 'Basic salary per month (NPR)', 'money', L), f('allowance', 'Fixed allowance per month (NPR)', 'money'), notes] },
  { key: 'hr.payroll', title: 'Payroll', one: 'payroll', series: 'PAY', labelField: 'month', statuses: ['DRAFT', 'APPROVED', 'PAID'],
    help: 'Click "Calculate" to fill the sheet from active employees. SSF percentages are your settings (defaults 11% employee + 20% employer of basic salary — confirm with your SSF registration). Income tax (TDS) is typed in by your accountant; it is not calculated.',
    fields: [f('month', 'Salary month (e.g. 2083-08)', 'text', R), f('company', 'Company', 'ref', { ref: 'company', list: true }), f('fromDate', 'Period from', 'date', { req: true }), f('toDate', 'Period to', 'date', { req: true }),
      f('ssfEmployeePct', 'SSF — employee %', 'number', { def: 11, max: 100 }), f('ssfEmployerPct', 'SSF — employer %', 'number', { def: 20, max: 100 }), f('payBank', 'Paid from bank', 'ref', { ref: 'bank' }), notes],
    lines: { title: 'Salary sheet', required: false, cols: [f('employee', 'Employee', 'ref', { ref: 'hr.employee', req: true }), f('days', 'Days paid', 'number', { def: 30 }),
      f('basic', 'Basic', 'money'), f('allowance', 'Allowance', 'money'), f('otherAllowance', 'Field allowances', 'money'), f('tax', 'Income tax (TDS)', 'money'), f('deduction', 'Advance / deduction', 'money'),
      f('ssfEmployee', 'SSF employee', 'money', { calc: true }), f('ssfEmployer', 'SSF employer', 'money', { calc: true }), f('net', 'Net pay', 'money', { calc: true })] },
    actions: [{ key: 'payroll-calc', label: '⟳ Calculate from employees', when: ['DRAFT'] }] },

  // ------------------------------------------------------------ Project Management
  { key: 'project.document', title: 'Documents', one: 'document', labelField: 'title', help: 'A register of documents: where the paper file is and a link to the scan (Google Drive, etc.). Files are not stored in ProcureNepal yet.', fields: [
    f('project', 'Project', 'ref', { ref: 'project', req: true, list: true }), f('title', 'Title', 'text', R),
    f('docType', 'Type', 'select', { options: ['CONTRACT', 'DRAWING', 'LETTER', 'APPROVAL', 'VARIATION_ORDER', 'BILL', 'PHOTO', 'OTHER'], list: true }), f('refNo', 'Reference no.', 'text', L),
    f('date', 'Date', 'date', L), f('party', 'From / to'), f('link', 'Link to the scan'), f('fileLocation', 'Paper file location'), f('expiry', 'Expiry (if any)', 'date'), notes] },
  { key: 'project.milestone', title: 'Milestones', one: 'milestone', labelField: 'title', statuses: ['PENDING', 'ACHIEVED', 'DELAYED'], fields: [
    f('project', 'Project', 'ref', { ref: 'project', req: true, list: true }), f('title', 'Milestone', 'text', R), f('targetDate', 'Target date', 'date', R), f('achievedDate', 'Achieved on', 'date', L),
    f('weightPct', 'Weight % of the work', 'number', { max: 100 }), f('paymentAmount', 'Payment linked (NPR)', 'money', L), notes] },
  { key: 'project.activity', title: 'Work schedule', one: 'activity', statuses: ['NOT_STARTED', 'IN_PROGRESS', 'DONE'], help: 'Weights should add up to 100 for a project; the S-curve spreads each weight evenly over its planned dates.', fields: [
    f('project', 'Project', 'ref', { ref: 'project', req: true, list: true }), f('name', 'Activity', 'text', R), f('plannedStart', 'Planned start', 'date', R), f('plannedEnd', 'Planned finish', 'date', R),
    f('weightPct', 'Weight %', 'number', { req: true, list: true, max: 100 }), f('actualStart', 'Actual start', 'date'), f('actualEnd', 'Actual finish', 'date'), f('progressPct', 'Progress %', 'number', { max: 100, list: true }), notes] },
  { key: 'project.eot', title: 'Extensions of time', one: 'extension of time', labelField: 'reason', statuses: ['APPLIED', 'APPROVED', 'REJECTED'],
    help: 'When an extension is APPROVED with a new completion date, the project\'s revised completion date is updated automatically.', fields: [
    f('project', 'Project', 'ref', { ref: 'project', req: true, list: true }), f('appliedDate', 'Applied on', 'date', R), f('daysRequested', 'Days requested', 'number', R), f('reason', 'Reason', 'text', L),
    f('approvedDays', 'Days approved', 'number', L), f('approvedDate', 'Approved on', 'date'), f('newCompletionDate', 'New completion date', 'date', L), notes] },
  { key: 'project.norm', title: 'Norms', one: 'norm', help: 'Materials needed for one unit of a work item. Type the norm from your own source (DoR / DUDBC norms book) — ProcureNepal does not supply norm values. "BOQ keyword" links the norm to BOQ lines whose description contains that text.', fields: [
    f('name', 'Work item', 'text', { req: true, list: true, help: 'e.g. PCC 1:2:4' }), f('unit', 'Per unit', 'text', { req: true, list: true, help: 'm3, m2 …' }),
    f('boqKeyword', 'BOQ keyword', 'text', { req: true, list: true, help: 'e.g. "1:2:4"' }), f('skilledLabour', 'Skilled labour (days per unit)', 'number'), f('unskilledLabour', 'Unskilled labour (days per unit)', 'number'), notes],
    lines: { title: 'Materials per unit', required: true, cols: [product, unit, f('qty', 'Quantity per unit', 'number', { req: true }), f('remarks', 'Remarks')] } },
  { key: 'project.progress', title: 'Progress reports', one: 'progress report', series: 'PRG', labelField: 'remarks', statuses: ['DRAFT', 'SUBMITTED', 'APPROVED'],
    help: 'Enter the quantity done in this period for each BOQ item. Value = quantity × BOQ rate. Only SUBMITTED and APPROVED reports count in the S-curve and summaries.', fields: [
    f('project', 'Project', 'ref', { ref: 'project', req: true, list: true }), date, f('periodFrom', 'Period from', 'date'), f('periodTo', 'Period to', 'date'), f('reportedBy', 'Reported by', 'text', L),
    f('weather', 'Weather / hindrance'), f('remarks', 'Remarks', 'textarea')],
    lines: { title: 'Work done', required: true, cols: [f('boqItem', 'BOQ item', 'ref', { ref: 'boq', req: true }), unit, f('qty', 'Quantity done', 'number', { req: true }), rate, amount, f('remarks', 'Remarks')] } },
  { key: 'project.dailyReport', title: 'Daily site reports', one: 'daily site report', series: 'DSR', labelField: 'weather',
    statuses: ['DRAFT', 'SUBMITTED'],
    help: 'One row per day per project — the signed daily site diary: weather, manpower, equipment, issues and material use.',
    fields: [
    f('project', 'Project', 'ref', { ref: 'project', req: true, list: true }), date,
    f('weather', 'Weather', 'select', { options: ['Sunny', 'Cloudy', 'Rainy'], list: true }),
    f('temperature', 'Temperature', 'select', { options: ['Low', 'Normal', 'High'] }),
    f('humidity', 'Humidity', 'select', { options: ['Low', 'Normal', 'High'] }),
    f('wind', 'Wind', 'select', { options: ['Low', 'Normal', 'High'] }),
    f('subContractor', 'Sub-contractor', 'text'),
    f('mason', 'Mason', 'number'), f('labour', 'Labour', 'number'), f('welder', 'Welder', 'number'),
    f('driver', 'Driver', 'number'), f('supervisor', 'Supervisor', 'number'),
    f('totalManpower', 'Total manpower', 'number', { calc: true, list: true, help: 'Blank = sum of the roles above' }),
    f('equipment', 'Equipment used (name — nos — hours)', 'textarea'),
    f('issues', 'Issues (issue — solved Y/N — solution)', 'textarea'),
    f('materialUsed', 'Material used today (cement bags, steel tonnes, sand / aggregate cumec …)', 'textarea'),
    f('reportedBy', 'Reported by', 'text', L)],
    lines: { title: 'Activities / parts of structure', required: false, cols: [
      f('part', 'Parts of structure', 'text', R), f('workDescription', 'Description of work', 'text', R),
      f('gridLocation', 'Grid location', 'text'), f('progressStatus', 'Progress status', 'select', { options: ['Not started', 'In progress', 'Completed', 'Delayed'] }),
      f('remarks', 'Remarks') ] } },
  { key: 'bolpatra.litigation', title: 'Litigation history', one: 'litigation case', labelField: 'caseTitle', statuses: ['ONGOING', 'RESOLVED', 'WITHDRAWN'],
    help: 'Part of the bidder profile — pending or resolved court / arbitration cases, per company.',
    fields: [
    f('company', 'Company', 'ref', { ref: 'company', req: true, list: true }), f('caseTitle', 'Case / matter', 'text', R),
    f('court', 'Court / arbitration forum', 'text', L), f('filedDate', 'Filed on', 'date', L),
    f('amountInvolved', 'Amount involved (NPR)', 'money'), f('resolvedDate', 'Resolved on', 'date'), f('outcome', 'Outcome / order'), notes] },
  { key: 'project.petty', title: 'Petty contractors', one: 'petty contractor', fields: [
    f('name', 'Name', 'text', R), f('panNo', 'PAN no.', 'text', L), f('phone', 'Phone', 'text', L), f('address', 'Address'), f('trade', 'Trade (masonry, formwork …)', 'text', L), notes] },
  { key: 'project.workorder', title: 'Work orders', one: 'work order', series: 'WO', labelField: 'scope', statuses: ['DRAFT', 'ISSUED', 'COMPLETED', 'CANCELLED'], fields: [
    f('project', 'Project', 'ref', { ref: 'project', req: true, list: true }), f('pettyContractor', 'Petty contractor', 'ref', { ref: 'project.petty', req: true, list: true }), date,
    f('scope', 'Scope of work', 'text', L), f('completionDate', 'To be completed by', 'date'), notes],
    lines: { title: 'Work items', required: true, cols: [f('description', 'Description', 'text', { req: true }), f('unit', 'Unit'), qty, rate, amount] } },
  { key: 'project.pettybill', title: 'Petty contractor bills', one: 'bill', series: 'PCB', labelField: 'billNo', statuses: ['SUBMITTED', 'APPROVED', 'PAID'],
    help: 'Retention % and TDS % are your contract / tax settings — they are not assumed.', fields: [
    f('workOrder', 'Work order', 'ref', { ref: 'project.workorder', req: true, list: true }), date, f('billNo', "Contractor's bill no.", 'text', L),
    f('retentionPct', 'Retention %', 'number', { max: 100 }), f('tdsPct', 'TDS %', 'number', { max: 100 }), f('materialRecovery', 'Material recovery (NPR)', 'money'),
    f('payable', 'Net payable (NPR)', 'money', { calc: true, list: true }), f('paidAmount', 'Paid (NPR)', 'money', L), f('paidDate', 'Paid on', 'date'), notes],
    lines: { title: 'Work billed', required: true, cols: [f('description', 'Description', 'text', { req: true }), f('unit', 'Unit'), qty, rate, amount] } },
  { key: 'project.petty-issue', title: 'Materials issued to petty contractors', one: 'material issue', series: 'PCI', labelField: 'purpose', statuses: POSTING, help: postHelp, fields: [
    date, f('project', 'Project', 'ref', { ref: 'project', req: true, list: true }), f('pettyContractor', 'Petty contractor', 'ref', { ref: 'project.petty', req: true, list: true }),
    f('warehouse', 'From warehouse', 'ref', { ref: 'proc.warehouse', req: true, list: true }), f('workOrder', 'Work order', 'ref', { ref: 'project.workorder' }), f('purpose', 'Purpose'), notes],
    lines: itemLines('Materials issued (rate = recovery rate, if charged)', true) },

  // ------------------------------------------------------------ Bank System
  { key: 'bank.loan', title: 'Loans', one: 'loan', series: 'LN', labelField: 'purpose', statuses: ['ACTIVE', 'CLOSED'],
    help: 'The amortization schedule is an estimate from principal, rate and tenure (monthly reducing balance). Your bank\'s own schedule is final. Record actual repayments in the table below.', fields: [
    f('company', 'Borrower company', 'ref', { ref: 'company', req: true, list: true }), f('bank', 'Bank', 'ref', { ref: 'bank', req: true, list: true }),
    f('loanType', 'Loan type', 'select', { options: ['TERM', 'OVERDRAFT', 'WORKING_CAPITAL', 'HIRE_PURCHASE', 'OTHER'], def: 'TERM', list: true }), f('accountNo', 'Loan account no.'),
    f('principal', 'Principal (NPR)', 'money', R), f('ratePct', 'Interest % per year', 'number', { req: true, list: true, max: 100 }), f('startDate', 'Disbursed on', 'date', R),
    f('tenureMonths', 'Tenure (months)', 'number', { req: true, list: true }), f('repayment', 'Repayment', 'select', { options: ['EMI', 'EQUAL_PRINCIPAL', 'INTEREST_ONLY'], def: 'EMI' }),
    f('purpose', 'Purpose', 'text'), f('security', 'Security / collateral'), f('vehicle', 'Financed vehicle', 'ref', { ref: 'fleet.vehicle' }),
    f('outstanding', 'Outstanding (NPR)', 'money', { calc: true, list: true }), notes],
    lines: { title: 'Repayments made', required: false, cols: [f('date', 'Date', 'date', { req: true }), f('principalPaid', 'Principal paid', 'money'), f('interestPaid', 'Interest paid', 'money'), f('remarks', 'Remarks')] } },
  { key: 'bank.lc', title: 'Letters of credit', one: 'LC', series: 'LC', labelField: 'lcNo', statuses: ['REQUESTED', 'OPENED', 'DOCUMENTS_RECEIVED', 'ACCEPTED', 'SETTLED', 'CANCELLED'], fields: [
    f('company', 'Applicant company', 'ref', { ref: 'company', req: true, list: true }), f('bank', 'Issuing bank', 'ref', { ref: 'bank', req: true, list: true }),
    f('lcType', 'LC type', 'select', { options: ['SIGHT', 'DISCOUNTED', 'USANCE'], req: true, list: true, def: 'SIGHT' }), f('lcNo', 'LC no.', 'text', L),
    f('beneficiary', 'Beneficiary (vendor)', 'ref', { ref: 'proc.vendor' }), f('po', 'Purchase order', 'ref', { ref: 'proc.po' }), f('currency', 'Currency', 'text', { def: 'NPR' }),
    f('amount', 'LC amount', 'money', R), f('marginPct', 'Margin %', 'number', { max: 100 }), f('marginAmount', 'Margin amount', 'money', { help: 'Blank = amount × margin %' }),
    f('commission', 'Commission / charges', 'money'), f('openDate', 'Opened on', 'date', { req: true }), f('expiryDate', 'Expiry date', 'date', R), f('shipmentDate', 'Shipment / acceptance date', 'date'),
    f('usanceDays', 'Usance / discount days', 'number'), f('dueDate', 'Payment due', 'date', { list: true, help: 'Blank for usance / discounted = shipment date + days' }), notes] },
  { key: 'bank.asset', title: 'Fixed assets', one: 'fixed asset', statuses: ['OWNED', 'MORTGAGED', 'SOLD'], fields: [
    f('company', 'Owner company', 'ref', { ref: 'company', req: true, list: true }), f('name', 'Asset name', 'text', R),
    f('assetType', 'Type', 'select', { options: ['LAND', 'BUILDING', 'LAND_AND_BUILDING'], req: true, list: true }), f('location', 'Location', 'text', L), f('plotNo', 'Plot (kitta) no.'),
    f('area', 'Area'), f('ownershipDocNo', 'Ownership certificate (Lalpurja) no.'), f('purchaseDate', 'Purchase date', 'date'), f('cost', 'Cost (NPR)', 'money', R),
    f('currentValue', 'Current valuation (NPR)', 'money', L), f('valuationDate', 'Valuation date', 'date'), f('mortgagedTo', 'Mortgaged to', 'ref', { ref: 'bank' }), f('loan', 'Against loan', 'ref', { ref: 'bank.loan' }), notes] },
];

ENTITIES.find((e) => e.key === 'proc.series')!.fields[0].options = ENTITIES.filter((e) => e.series).map((e) => e.key);
export const entityDef = (key: string) => ENTITIES.find((e) => e.key === key);

const E = (entity: string, title?: string): TabDef => ({ kind: 'entity', entity, title: title ?? entityDef(entity)!.title });
const P = (report: string, title: string, params: TabDef['params'] = []): TabDef => ({ kind: 'report', report, title, params });
const projectParam = [{ k: 'project', label: 'Project', ref: 'project', req: true }];
const companyParam = [{ k: 'company', label: 'Company', ref: 'company', req: true }];
const range = [{ k: 'from', label: 'From', type: 'date' as const }, { k: 'to', label: 'To', type: 'date' as const }];
const stockTabs = [E('proc.warehouse'), P('stock', 'Stock by warehouse', [{ k: 'warehouse', label: 'Warehouse', ref: 'proc.warehouse' }])];

export const MENUS: MenuDef[] = [
  { id: 'proc.requisition', title: 'Items Requisition Management', about: 'Site staff request materials; an APPROVED requisition can be turned into an RFQ.', tabs: [E('proc.requisition')] },
  { id: 'proc.rfq', title: 'Request for Quotation (RFQ)', about: 'Ask several vendors for rates. "Email vendors" opens your mail program with the vendors and the item list filled in.', tabs: [E('proc.rfq')] },
  { id: 'proc.quotations', title: 'Quotation Collection', about: 'Record each vendor\'s rates against an RFQ.', tabs: [E('proc.quotation')] },
  { id: 'proc.compare', title: 'Quotation Comparison and Award', about: 'Side-by-side rates per item; awarding creates the purchase order.', tabs: [P('compare', 'Comparison', [{ k: 'rfq', label: 'RFQ', ref: 'proc.rfq', req: true }])] },
  { id: 'proc.po', title: 'Purchase Order Management', about: 'Purchase orders from an awarded quotation or direct.', tabs: [E('proc.po')] },
  { id: 'proc.proforma', title: 'Pro Forma Invoice and Purchase Bank', about: 'Vendor invoices against purchase orders and how they were paid (bank, cheque, LC).', tabs: [E('proc.proforma'), P('payables', 'Payables by purchase order')] },
  { id: 'proc.grn', title: 'Goods Receipt Note (GRN)', about: 'Receive goods against a purchase order into a warehouse.', tabs: [E('proc.grn')] },
  { id: 'proc.transfer', title: 'Stock Transfer between Sites', about: 'Move stock between warehouses.', tabs: [E('proc.transfer')] },
  { id: 'proc.dispatch', title: 'Stock Dispatch', about: 'Issue stock to a project site or customer.', tabs: [E('proc.dispatch')] },
  { id: 'proc.return', title: 'Stock Return Management', about: 'Returns from site to warehouse and from warehouse to vendor.', tabs: [E('proc.return')] },
  { id: 'proc.warehouse-setup', title: 'Warehouse Setup — Category, Brand, Product', about: 'The item master used by every stock and purchase document.', tabs: [E('proc.product'), E('proc.category'), E('proc.brand')] },
  { id: 'proc.vendors', title: 'Vendor Management', about: 'Vendor register with PAN/VAT, contacts and ratings.', tabs: [E('proc.vendor')] },
  { id: 'proc.number-series', title: 'Number Series Setup', about: 'Automatic numbering of documents.', tabs: [E('proc.series')] },
  { id: 'proc.site-warehouse', title: 'Site Warehouse Management', about: 'Warehouses and the stock in each one.', tabs: stockTabs },
  { id: 'fleet.vehicles', title: 'Vehicle Information Setup', about: 'Vehicles and equipment.', tabs: [E('fleet.vehicle')] },
  { id: 'fleet.maintenance', title: 'Maintenance and Servicing', about: 'Services, repairs and when the next one is due.', tabs: [E('fleet.maintenance')] },
  { id: 'fleet.tax', title: 'Vehicle Tax and Insurance', about: 'Tax, insurance and blue-book renewals with expiry alerts.', tabs: [E('fleet.tax'), P('fleet-expiry', 'Expiring and due')] },
  { id: 'fleet.movement', title: 'Vehicle Movement and Fleet', about: 'Which project or place each vehicle is assigned to.', tabs: [E('fleet.movement'), P('fleet-where', 'Where is each vehicle')] },
  { id: 'fleet.logs', title: 'Daily Vehicle Work Log', about: 'Daily hours / km, fuel and operator.', tabs: [E('fleet.log')] },
  { id: 'fleet.trips', title: 'Vehicle Trip Management', about: 'Trips for material delivery and dispatch.', tabs: [E('fleet.trip')] },
  { id: 'fleet.earnings', title: 'Vehicle-wise Earning and Expense', about: 'Income and cost per vehicle from logs, trips, maintenance, renewals and allowances.', tabs: [P('fleet-earnings', 'Earning and expense', range), E('fleet.txn')] },
  { id: 'fleet.allowance', title: 'Allowance Setup and Management', about: 'Driver / operator allowances; unpaid ones are picked up by payroll.', tabs: [E('fleet.allowance')] },
  { id: 'hr.employees', title: 'Employee User Setup', about: 'Employee records with salary and bank details.', tabs: [E('hr.employee')] },
  { id: 'hr.payroll', title: 'Payroll Setup', about: 'Monthly salary sheet with SSF and bank payment list.', tabs: [E('hr.payroll')] },
  { id: 'project.documents', title: 'Document Management', about: 'Contract, drawings, approvals and correspondence per project.', tabs: [E('project.document'), P('doc-expiry', 'Expiring documents')] },
  { id: 'project.milestones', title: 'Goal and Milestone Management', about: 'Milestones with target dates and linked payments.', tabs: [E('project.milestone')] },
  { id: 'project.schedule', title: 'Work Schedule and Project Period', about: 'Work programme and extensions of time.', tabs: [E('project.activity'), E('project.eot')] },
  { id: 'project.material-plan', title: 'Raw Material Allocation Planning', about: 'Materials needed = BOQ quantity × norm; compare with what was issued and raise a requisition for the balance.', tabs: [P('material-plan', 'Material plan', projectParam)] },
  { id: 'project.scurve', title: 'Variance Chart / S-Curve', about: 'Planned progress (work schedule) against actual progress (progress reports).', tabs: [P('scurve', 'S-curve', projectParam)] },
  { id: 'project.progress', title: 'Progress Report Management', about: 'Quantities done per BOQ item; at completion they become the experience certificate.', tabs: [E('project.progress'), P('progress', 'BOQ progress summary', projectParam)] },
  { id: 'project.daily-report', title: 'Daily Site Reporting', about: 'Daily site diary — weather, manpower, equipment, issues and material use, per project, per day.', tabs: [E('project.dailyReport')] },
  { id: 'bolpatra.litigation', title: 'Litigation History', about: 'Pending and resolved court / arbitration cases, per company — part of the bidder profile.', tabs: [E('bolpatra.litigation')] },
  { id: 'bolpatra.bidder-profile', title: 'Bidder Profile', about: 'One place for a company\'s whole qualification picture — staff, equipment, financials and litigation — for Bolpatra bid preparation.', tabs: [P('bidder-profile', 'Bidder profile', companyParam)] },
  { id: 'project.reporting', title: 'Overall Project Reporting', about: 'All projects at a glance.', tabs: [P('portfolio', 'Portfolio')] },
  { id: 'project.petty', title: 'Petty Contractor Management', about: 'Petty contractors, work orders and bills.', tabs: [E('project.petty'), E('project.workorder'), E('project.pettybill')] },
  { id: 'project.petty-inventory', title: 'Petty Contractor Inventory', about: 'Materials issued to petty contractors from the site warehouse.', tabs: [E('project.petty-issue'), P('petty-materials', 'Issued per contractor')] },
  { id: 'project.site-warehouse', title: 'Site Warehouse Management', about: 'The same warehouses and stock as Procurement & Inventory.', tabs: stockTabs },
  { id: 'project.norms', title: 'Norms Ratio Management', about: 'Material and labour norms per work item.', tabs: [E('project.norm')] },
  { id: 'bank.loans', title: 'Loan Management and Amortization', about: 'Loans, repayments and the amortization schedule.', tabs: [E('bank.loan'), P('amortization', 'Amortization schedule', [{ k: 'loan', label: 'Loan', ref: 'bank.loan', req: true }])] },
  { id: 'bank.lc', title: 'LC Management — at Sight, Discounted, Usance', about: 'Letters of credit with margin, expiry and payment due dates.', tabs: [E('bank.lc')] },
  { id: 'bank.finance', title: 'Finance Dashboard', about: 'Guarantees, loans, LCs, payables and assets at a glance.', tabs: [P('finance', 'Finance dashboard')] },
  { id: 'bank.bank-loan', title: 'Bank and Loan Management', about: 'Facilities used per bank: guarantees, loans and LCs.', tabs: [P('bank-loan', 'Facilities per bank')] },
  { id: 'bank.csv', title: 'CSV Export', about: 'Download any list as CSV (opens in Excel).', tabs: [{ kind: 'csv', title: 'CSV export' }] },
  { id: 'bank.assets', title: 'Fixed Assets — Land, Building, Land & Building', about: 'Fixed asset register.', tabs: [E('bank.asset')] },
];
export const menuDef = (id: string) => MENUS.find((m) => m.id === id);

const PREFIX_MODULE: Record<string, string> = { proc: 'procurement', fleet: 'fleet', hr: 'hr', project: 'project', bank: 'bank', bolpatra: 'bolpatra' };
/** 'proc.po' → 'procurement' */
export const moduleOf = (key: string) => PREFIX_MODULE[key.split('.')[0]] ?? null;
/** which module a report belongs to */
export const REPORT_MODULE: Record<string, string> = {
  stock: 'procurement', compare: 'procurement', payables: 'procurement',
  'fleet-expiry': 'fleet', 'fleet-where': 'fleet', 'fleet-earnings': 'fleet',
  'material-plan': 'project', scurve: 'project', progress: 'project', portfolio: 'project', 'petty-materials': 'project', 'doc-expiry': 'project',
  amortization: 'bank', finance: 'bank', 'bank-loan': 'bank',
  'bidder-profile': 'bolpatra',
};
/** documents that move stock */
export const STOCK_ENTITIES = ['proc.grn', 'proc.transfer', 'proc.dispatch', 'proc.return', 'project.petty-issue'];
export const CAN_DELETE_ERP = ['OWNER', 'SUPER_ADMIN', 'DIRECTOR'];
