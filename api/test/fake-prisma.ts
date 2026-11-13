// In-memory stand-in for PrismaService, used only by the API tests.
// Supports the subset of Prisma calls used by Company / Certificate / Tender /
// Qualification / Auth code. Never used in production.
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/client';

// Columns that are Decimal in schema.prisma. Real Prisma returns them as Decimal objects
// (sent to the browser as strings), so the fake does the same.
const DECIMAL_FIELDS = new Set([
  'contractAmount', 'finalAmount', 'priceAdjustment', 'jvShare', 'outstandingAmount',
  'boqAmount', 'reqTurnover', 'reqMinProduction', 'reqBidCapacity', 'reqSimilarValue',
  'turnoverAact', 'turnoverRequired', 'amount',
  'bidAmount', 'bidSecurityAmount', 'contractAmount', 'performanceSecurityAmount',
  'total', 'quantity', 'rate', 'advancePct', 'retentionPct',
  'bgLimit', 'defaultMarginPct', 'defaultCommissionPct', 'marginPct', 'marginAmount', 'commissionPct', 'commissionAmount',
]);
function decimals(row: Row): Row {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (DECIMAL_FIELDS.has(k) && v !== null && v !== undefined && !(v instanceof Decimal)) row[k] = new Decimal(v);
  }
  return row;
}

type Row = Record<string, any>;

const COMPOSITE: Record<string, string[]> = {
  tenantId_ifbNumber: ['tenantId', 'ifbNumber'],
  tenantId_slug: ['tenantId', 'slug'],
  tenderId_companyId: ['tenderId', 'companyId'],
  companyId_fiscalYear: ['companyId', 'fiscalYear'],
  tenantId_flagKey: ['tenantId', 'flagKey'],
};

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (COMPOSITE[k]) return COMPOSITE[k].every((f) => row[f] === v[f]);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      if ('startsWith' in v) return typeof row[k] === 'string' && row[k].startsWith(v.startsWith);
      if ('lt' in v) return row[k] < v.lt;
    }
    return row[k] === v;
  });
}

const DEFAULTS: Record<string, () => Row> = {
  company: () => ({ isActive: true, createdAt: new Date() }),
  certificate: () => ({
    activities: [], verificationStatus: 'unverified', completionStatus: 'in_progress',
    jvShare: 100, priceAdjustment: 0, isOpenBid: true, createdAt: new Date(), updatedAt: new Date(),
  }),
  tender: () => ({ reqProjectTypes: [], status: 'active', source: 'manual', isComplexWork: false, createdAt: new Date(), updatedAt: new Date() }),
  qualificationResult: () => ({ calculatedAt: new Date() }),
  annualTurnover: () => ({ source: 'audited', createdAt: new Date(), updatedAt: new Date() }),
  user: () => ({ isActive: true, modules: [], role: 'VIEWER', createdAt: new Date(), status: 'ACTIVE', activationToken: null, activationExpires: null, customTitle: null }),
  loginSession: () => ({ loginAt: new Date(), logoutAt: null }),
  externalRef: () => ({ fetchedAt: new Date(), changed: false }),
  tenantFeatureFlag: () => ({ enabled: false, createdAt: new Date() }),
  bid: () => ({ bidderType: 'SINGLE', decision: 'UNDECIDED', status: 'PREPARING', createdAt: new Date(), updatedAt: new Date() }),
  tenant: () => ({ isActive: true }),
  bank: () => ({ isActive: true, createdAt: new Date(), updatedAt: new Date() }),
  project: () => ({ status: 'ONGOING', source: 'MANUAL', bidderType: 'SINGLE', tenderId: null, bidId: null, createdAt: new Date(), updatedAt: new Date() }),
  boqItem: () => ({ isHeading: false, createdAt: new Date() }),
  erpRecord: () => ({ createdAt: new Date(), updatedAt: new Date() }),
  bankGuarantee: () => ({ status: 'ACTIVE', source: 'MANUAL', bankId: null, bidId: null, tenderId: null, projectId: null, createdAt: new Date(), updatedAt: new Date() }),
};

export class FakePrisma {
  db: Record<string, Row[]> = {
    company: [], certificate: [], tender: [], qualificationResult: [],
    annualTurnover: [], user: [], tenant: [], tenantFeatureFlag: [], bid: [],
    bank: [], bankGuarantee: [], project: [], boqItem: [], erpRecord: [],
    loginSession: [], externalRef: [],
  };

  private include(model: string, row: Row, include?: Row): Row {
    if (!row) return row;
    const out = { ...row };
    if (include?.certificates) out.certificates = this.db.certificate.filter((c) => c.companyId === row.id);
    if (include?.turnovers) out.turnovers = this.db.annualTurnover.filter((t) => t.companyId === row.id);
    if (include?.company) out.company = this.db.company.find((c) => c.id === row.companyId);
    if (include?.tender) out.tender = this.db.tender.find((t) => t.id === row.tenderId);
    if (include?.tenant) out.tenant = this.db.tenant.find((t) => t.id === row.tenantId);
    if (include?.bank) out.bank = row.bankId ? this.db.bank.find((b) => b.id === row.bankId) ?? null : null;
    if (include?.bid) out.bid = row.bidId ? this.db.bid.find((b) => b.id === row.bidId) ?? null : null;
    if (include?.project) out.project = row.projectId ? this.db.project.find((p) => p.id === row.projectId) ?? null : null;
    return out;
  }

  private select(row: Row, select?: Row) {
    if (!row || !select) return row;
    return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
  }

  private model(name: string) {
    const rows = () => this.db[name];
    const self = this;
    return {
      findFirst: async (a: Row = {}) => {
        const r = rows().find((x) => matches(x, a.where));
        return r ? self.select(self.include(name, r, a.include), a.select) : null;
      },
      findUnique: async (a: Row = {}) => {
        const r = rows().find((x) => matches(x, a.where));
        return r ? self.select(self.include(name, r, a.include), a.select) : null;
      },
      findMany: async (a: Row = {}) =>
        rows()
          .filter((x) => matches(x, a.where))
          .map((r) => self.select(self.include(name, r, a.include), a.select)),
      create: async (a: Row) => {
        const r = decimals({ id: randomUUID(), ...DEFAULTS[name](), ...a.data });
        rows().push(r);
        return self.select(self.include(name, { ...r }, a.include), a.select);
      },
      createMany: async (a: Row) => {
        for (const d of a.data) rows().push(decimals({ id: randomUUID(), ...DEFAULTS[name](), ...d }));
        return { count: a.data.length };
      },
      update: async (a: Row) => {
        const r = rows().find((x) => matches(x, a.where));
        if (!r) throw new Error('Record to update not found');
        Object.assign(r, a.data, 'updatedAt' in r ? { updatedAt: new Date() } : {});
        decimals(r);
        return self.select(self.include(name, { ...r }, a.include), a.select);
      },
      upsert: async (a: Row) => {
        const r = rows().find((x) => matches(x, a.where));
        if (r) {
          Object.assign(r, a.update);
          decimals(r);
          return { ...r };
        }
        const n = decimals({ id: randomUUID(), ...DEFAULTS[name](), ...a.create });
        rows().push(n);
        return { ...n };
      },
      delete: async (a: Row) => {
        const i = rows().findIndex((x) => matches(x, a.where));
        if (i < 0) throw new Error('Record to delete not found');
        const [r] = rows().splice(i, 1);
        if (name === 'company') {
          // onDelete: Cascade for AnnualTurnover / Certificate
          self.db.annualTurnover = self.db.annualTurnover.filter((t) => t.companyId !== r.id);
          self.db.certificate = self.db.certificate.filter((t) => t.companyId !== r.id);
          self.db.bid = self.db.bid.filter((t) => t.companyId !== r.id);
          self.db.bank = self.db.bank.filter((t) => t.companyId !== r.id);
          self.db.bankGuarantee = self.db.bankGuarantee.filter((t) => t.companyId !== r.id);
          const gone = self.db.project.filter((p) => p.companyId === r.id).map((p) => p.id);
          self.db.project = self.db.project.filter((p) => p.companyId !== r.id);
          self.db.boqItem = self.db.boqItem.filter((b) => !gone.includes(b.projectId));
        }
        if (name === 'tender') {
          const gone = self.db.bid.filter((b) => b.tenderId === r.id).map((b) => b.id);
          self.db.bid = self.db.bid.filter((b) => b.tenderId !== r.id); // onDelete: Cascade
          for (const g of self.db.bankGuarantee) { // onDelete: SetNull
            if (g.tenderId === r.id) g.tenderId = null;
            if (gone.includes(g.bidId)) g.bidId = null;
          }
          for (const p of self.db.project) { // onDelete: SetNull
            if (p.tenderId === r.id) p.tenderId = null;
            if (gone.includes(p.bidId)) p.bidId = null;
          }
        }
        if (name === 'bid') {
          for (const g of self.db.bankGuarantee) if (g.bidId === r.id) g.bidId = null; // SetNull
          for (const p of self.db.project) if (p.bidId === r.id) p.bidId = null;
        }
        if (name === 'project') {
          self.db.boqItem = self.db.boqItem.filter((b) => b.projectId !== r.id); // Cascade
          for (const g of self.db.bankGuarantee) if (g.projectId === r.id) g.projectId = null; // SetNull
        }
        if (name === 'bank') for (const g of self.db.bankGuarantee) if (g.bankId === r.id) g.bankId = null; // SetNull
        return r;
      },
      updateMany: async (a: Row) => {
        const list = rows().filter((x) => matches(x, a.where));
        for (const r of list) { Object.assign(r, a.data, 'updatedAt' in r ? { updatedAt: new Date() } : {}); decimals(r); }
        return { count: list.length };
      },
      count: async (a: Row = {}) => rows().filter((x) => matches(x, a.where)).length,
      deleteMany: async (a: Row = {}) => {
        const before = rows().length;
        self.db[name] = rows().filter((x) => !matches(x, a.where));
        return { count: before - self.db[name].length };
      },
    };
  }

  company = this.model('company');
  certificate = this.model('certificate');
  tender = this.model('tender');
  qualificationResult = this.model('qualificationResult');
  annualTurnover = this.model('annualTurnover');
  user = this.model('user');
  tenant = this.model('tenant');
  tenantFeatureFlag = this.model('tenantFeatureFlag');
  bid = this.model('bid');
  bank = this.model('bank');
  bankGuarantee = this.model('bankGuarantee');
  project = this.model('project');
  boqItem = this.model('boqItem');
  erpRecord = this.model('erpRecord');
  loginSession = this.model('loginSession');
  externalRef = this.model('externalRef');

  async $transaction(ops: Promise<any>[]) {
    const out: any[] = [];
    for (const op of ops) out.push(await op); // sequential, like Prisma's batch
    return out;
  }
  async $connect() {}
  async $disconnect() {}
  async onModuleInit() {}
  async onModuleDestroy() {}
}
