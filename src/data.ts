import type {
  Bom,
  Employee,
  Grade,
  ProcessOrder,
  ProductionLine,
  RawMaterial,
  RawMaterialBatch,
  Resource,
  Shift,
  User,
  JumboRollType
} from "./types";

export const employees: Employee[] = [
  { nik: "100001", name: "Andi Pratama", status: "active" },
  { nik: "100002", name: "Bunga Lestari", status: "active" },
  { nik: "100003", name: "Citra Wijaya", status: "active" },
  { nik: "900001", name: "Dewa Supervisor", status: "active" },
  { nik: "900002", name: "Admin Produksi", status: "active" },
  { nik: "800001", name: "Inactive Employee", status: "inactive" }
];

export const users: User[] = [
  { id: "USR-OPR-01", username: "operator", password: "operator123", role: "operator", employeeNik: "100001" },
  { id: "USR-SPV-01", username: "supervisor", password: "supervisor123", role: "supervisor", employeeNik: "900001" },
  { id: "USR-ADM-01", username: "admin", password: "admin123", role: "admin", employeeNik: "900002" }
];

export const resources: Resource[] = [
  { code: "RES-COAT-01", name: "Coating Resource 01" },
  { code: "RES-LAM-02", name: "Lamination Resource 02" },
  { code: "RES-TRIAL-09", name: "Trial Resource 09" },
  { code: "RES-MAN-07", name: "Manual Resource 07" }
];

export const productionLines: ProductionLine[] = [
  { code: "L1", name: "Line 1 Coating", resourceCode: "RES-COAT-01" },
  { code: "A2", name: "Line 2 Lamination", resourceCode: "RES-LAM-02" },
  { code: "X9", name: "Trial Line X9", resourceCode: "RES-TRIAL-09" },
  { code: "7", name: "Manual Line 7", resourceCode: "RES-MAN-07" }
];

export const shifts: Shift[] = [
  { code: "S1", name: "Shift 1", startTime: "07:00", endTime: "15:00" },
  { code: "S2", name: "Shift 2", startTime: "15:00", endTime: "23:00" },
  { code: "S3", name: "Shift 3", startTime: "23:00", endTime: "07:00" }
];

export const jumboRollTypes: JumboRollType[] = [
  { code: "P12", type: "JR-PET12", description: "PET Film 12 Micron Jumbo Roll", status: "active" },
  { code: "B20", type: "JR-BOPP20", description: "BOPP Film 20 Micron Jumbo Roll", status: "active" },
  { code: "A07", type: "JR-ALU07", description: "Aluminium Foil 7 Micron Jumbo Roll", status: "active" },
  { code: "M15", type: "JR-MET15", description: "Metallized Film 15 Micron Jumbo Roll", status: "active" },
  { code: "Z99", type: "JR-OLD99", description: "Inactive legacy jumbo roll", status: "inactive" }
];

export const grades: Grade[] = [
  { code: "A1", name: "Prime Grade", description: "Produk normal sesuai standar kualitas", status: "active" },
  { code: "B1", name: "Minor Defect", description: "Produk good dengan defect minor", status: "active" },
  { code: "C1", name: "Rework Grade", description: "Produk perlu proses lanjutan/rework", status: "active" },
  { code: "R1", name: "Reject Grade", description: "Produk reject", status: "active" },
  { code: "T1", name: "Trial Grade", description: "Produk hasil trial", status: "active" },
  { code: "X0", name: "Inactive Grade", description: "Grade tidak digunakan", status: "inactive" }
];

export const rawMaterials: RawMaterial[] = [
  { code: "PET", description: "PET Film Base 12 Micron", unit: "KG" },
  { code: "BOP", description: "BOPP Film Base 20 Micron", unit: "KG" },
  { code: "ALU", description: "Aluminium Foil 7 Micron", unit: "KG" },
  { code: "MET", description: "Metallized Film Base 15 Micron", unit: "KG" },
  { code: "ADH", description: "Solventless Adhesive", unit: "KG" },
  { code: "SOL", description: "Process Solvent", unit: "KG" },
  { code: "RES", description: "Coating Resin", unit: "KG" }
];

export const rawMaterialBatches: RawMaterialBatch[] = [
  { batch: "PET-A2401", materialCode: "PET", availableQty: 520, status: "available" },
  { batch: "PET-A2402", materialCode: "PET", availableQty: 430, status: "available" },
  { batch: "BOP-B2401", materialCode: "BOP", availableQty: 610, status: "available" },
  { batch: "ALU-C2401", materialCode: "ALU", availableQty: 380, status: "available" },
  { batch: "MET-D2401", materialCode: "MET", availableQty: 460, status: "available" },
  { batch: "ADH-E2401", materialCode: "ADH", availableQty: 240, status: "available" },
  { batch: "ADH-E2402", materialCode: "ADH", availableQty: 180, status: "available" },
  { batch: "SOL-F2401", materialCode: "SOL", availableQty: 150, status: "available" },
  { batch: "RES-G2401", materialCode: "RES", availableQty: 260, status: "available" },
  { batch: "PET-BLOCK", materialCode: "PET", availableQty: 100, status: "blocked" }
];

export const boms: Bom[] = [
  {
    bomCode: "BOM-P12-V01",
    jumboRollCode: "P12",
    version: "V01",
    description: "Standard PET 12 composition",
    status: "active",
    isDefault: true,
    materials: [
      { materialCode: "PET", planningQty: 100, unit: "KG" },
      { materialCode: "ADH", planningQty: 22, unit: "KG" },
      { materialCode: "SOL", planningQty: 8, unit: "KG" }
    ]
  },
  {
    bomCode: "BOM-P12-V02",
    jumboRollCode: "P12",
    version: "V02",
    description: "Alternative PET 12 high adhesion",
    status: "active",
    isDefault: false,
    materials: [
      { materialCode: "PET", planningQty: 100, unit: "KG" },
      { materialCode: "ADH", planningQty: 28, unit: "KG" },
      { materialCode: "RES", planningQty: 12, unit: "KG" }
    ]
  },
  {
    bomCode: "BOM-P12-V99",
    jumboRollCode: "P12",
    version: "V99",
    description: "Inactive experimental PET BOM",
    status: "inactive",
    isDefault: false,
    materials: [{ materialCode: "PET", planningQty: 90, unit: "KG" }]
  },
  {
    bomCode: "BOM-B20-V01",
    jumboRollCode: "B20",
    version: "V01",
    description: "Standard BOPP 20 composition",
    status: "active",
    isDefault: true,
    materials: [
      { materialCode: "BOP", planningQty: 115, unit: "KG" },
      { materialCode: "ADH", planningQty: 18, unit: "KG" }
    ]
  },
  {
    bomCode: "BOM-A07-V01",
    jumboRollCode: "A07",
    version: "V01",
    description: "Standard aluminium foil composition",
    status: "active",
    isDefault: true,
    materials: [
      { materialCode: "ALU", planningQty: 95, unit: "KG" },
      { materialCode: "SOL", planningQty: 7, unit: "KG" }
    ]
  },
  {
    bomCode: "BOM-M15-V01",
    jumboRollCode: "M15",
    version: "V01",
    description: "Standard metallized film composition",
    status: "active",
    isDefault: true,
    materials: [
      { materialCode: "MET", planningQty: 108, unit: "KG" },
      { materialCode: "RES", planningQty: 16, unit: "KG" }
    ]
  }
];

export const processOrders: ProcessOrder[] = [
  {
    proNumber: "PRO-20260518-001",
    status: "released",
    jumboRollCode: "P12",
    plannedGoodQty: 3,
    plannedUnit: "ROLL",
    plannedStartDate: "2026-05-18",
    plannedEndDate: "2026-05-19",
    defaultBomCode: "BOM-P12-V01",
    productionLineCode: "L1"
  },
  {
    proNumber: "PRO-20260518-002",
    status: "in_progress",
    jumboRollCode: "B20",
    plannedGoodQty: 2,
    plannedUnit: "ROLL",
    plannedStartDate: "2026-05-18",
    plannedEndDate: "2026-05-18",
    defaultBomCode: "BOM-B20-V01",
    productionLineCode: "A2"
  },
  {
    proNumber: "PRO-20260517-009",
    status: "closed",
    jumboRollCode: "A07",
    plannedGoodQty: 1,
    plannedUnit: "ROLL",
    plannedStartDate: "2026-05-17",
    plannedEndDate: "2026-05-17",
    defaultBomCode: "BOM-A07-V01",
    productionLineCode: "7"
  }
];
