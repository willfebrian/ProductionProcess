export type Role = "operator" | "supervisor" | "admin";
export type BomStatus = "active" | "inactive";
export type TransactionStatus = "completed" | "voided";
export type OutputStatus = "GOOD" | "REJECT";
export type ProStatus = "created" | "released" | "in_progress" | "completed" | "closed" | "cancelled";
export type MovementType = "production_consumption" | "void_reversal" | "stock_adjustment" | "stock_receipt";

export interface Employee {
  nik: string;
  name: string;
  status: "active" | "inactive";
}

export interface User {
  id: string;
  username: string;
  password: string;
  role: Role;
  employeeNik: string;
}

export interface ProductionLine {
  code: string;
  name: string;
  resourceCode: string;
}

export interface Resource {
  code: string;
  name: string;
}

export interface Shift {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
}

export interface JumboRollType {
  code: string;
  type: string;
  description: string;
  status: "active" | "inactive";
}

export interface Grade {
  code: string;
  name: string;
  description: string;
  status: "active" | "inactive";
}

export interface RawMaterial {
  code: string;
  description: string;
  unit: "KG";
}

export interface RawMaterialBatch {
  batch: string;
  materialCode: string;
  availableQty: number;
  status: "available" | "blocked";
}

export interface BomMaterial {
  materialCode: string;
  planningQty: number;
  unit: "KG";
}

export interface Bom {
  bomCode: string;
  jumboRollCode: string;
  version: string;
  description: string;
  status: BomStatus;
  isDefault: boolean;
  materials: BomMaterial[];
}

export interface ProcessOrder {
  proNumber: string;
  status: ProStatus;
  jumboRollCode: string;
  plannedGoodQty: number;
  plannedUnit: "ROLL";
  plannedStartDate: string;
  plannedEndDate: string;
  defaultBomCode: string;
  productionLineCode: string;
}

export interface BatchInput {
  batch: string;
  quantity: number;
}

export interface MaterialConsumption {
  materialCode: string;
  planningQty: number;
  unit: "KG";
  batches: BatchInput[];
}

export interface CorrectionHistory {
  correctedAt: string;
  correctedByUserId: string;
  approvedEmployeeNik: string;
  reason: string;
  before: Partial<ProductionTransaction>;
  after: Partial<ProductionTransaction>;
}

export interface ProductionTransaction {
  id: string;
  status: TransactionStatus;
  outputStatus: OutputStatus;
  rollNumber: string;
  jumboBatchNumber: string;
  proNumber?: string;
  productionLineCode: string;
  resourceCode: string;
  shiftCode: string;
  operatorUserId: string;
  operatorEmployeeNik: string;
  jumboRollCode: string;
  bomCode: string;
  productionDateTime: string;
  createdAt: string;
  createdByUserId: string;
  confirmedEmployeeNik: string;
  actualLengthM: number;
  actualWidthMm: number;
  actualWeightKg: number;
  gradeCode: string;
  goodQty: number;
  rejectQty: number;
  outputUnit: "ROLL";
  notes?: string;
  rawMaterialConsumptions: MaterialConsumption[];
  revision: number;
  correctionHistory: CorrectionHistory[];
  voidReason?: string;
  voidedAt?: string;
  voidedByUserId?: string;
  voidApprovedEmployeeNik?: string;
  replacementOfTransactionId?: string;
  replacementOfRollNumber?: string;
  replacedByTransactionId?: string;
  replacedByRollNumber?: string;
}

export interface StockMovement {
  id: string;
  movementType: MovementType;
  transactionId: string;
  materialCode: string;
  materialBatch: string;
  quantity: number;
  unit: "KG";
  beforeQty: number;
  afterQty: number;
  referenceRollNumber: string;
  referenceJumboBatch: string;
  createdAt: string;
  createdByUserId: string;
}

export interface ActivityLog {
  id: string;
  eventType: string;
  userId?: string;
  employeeNik?: string;
  role?: Role;
  page?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  status: "success" | "failed" | "info";
  message?: string;
  metadata: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}
