import type {
  BatchInput,
  Bom,
  CorrectionHistory,
  Employee,
  Grade,
  MaterialConsumption,
  ProcessOrder,
  ProductionTransaction,
  RawMaterialBatch,
  StockMovement,
  User
} from "./types";

export const formatDateTimeLocal = (date = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const toIsoFromLocalInput = (value: string) => new Date(value).toISOString();

export const getMonthYearCode = (isoDate: string) => {
  const date = new Date(isoDate);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const yearLastDigit = String(date.getFullYear()).slice(-1);
  return `${month}${yearLastDigit}`;
};

export const getEmployeeName = (employees: Employee[], nik: string) =>
  employees.find((employee) => employee.nik === nik)?.name ?? "-";

export const getActiveEmployee = (employees: Employee[], nik: string) =>
  employees.find((employee) => employee.nik === nik && employee.status === "active");

export const getNextJumboBatchNumber = (transactions: ProductionTransaction[]) => {
  const max = transactions.reduce((highest, trx) => Math.max(highest, Number(trx.jumboBatchNumber)), 0);
  return String(max + 1).padStart(10, "0");
};

export const getNextRunningNumber = (
  transactions: ProductionTransaction[],
  productionLineCode: string,
  jumboRollCode: string,
  monthYearCode: string
) => {
  const prefix = `${productionLineCode} ${jumboRollCode} ${monthYearCode}`;
  const numbers = transactions
    .filter((trx) => trx.rollNumber.startsWith(prefix))
    .map((trx) => {
      const parts = trx.rollNumber.split(" ");
      return Number(parts[parts.length - 1]);
    })
    .filter((value) => Number.isFinite(value));
  return String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(3, "0");
};

export const generateRollNumber = (
  transactions: ProductionTransaction[],
  productionLineCode: string,
  jumboRollCode: string,
  gradeCode: string,
  productionDateTime: string
) => {
  const monthYearCode = getMonthYearCode(productionDateTime);
  const running = getNextRunningNumber(transactions, productionLineCode, jumboRollCode, monthYearCode);
  return `${productionLineCode} ${jumboRollCode} ${monthYearCode} ${gradeCode} ${running}`;
};

export const validateGrade = (grades: Grade[], gradeCode: string) => {
  const normalized = gradeCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{2}$/.test(normalized)) return "Grade harus 2 digit alphanumeric.";
  const grade = grades.find((item) => item.code === normalized && item.status === "active");
  if (!grade) return "Grade harus terdaftar dan aktif di master grade.";
  return "";
};

export const sumBatchQty = (batches: BatchInput[]) =>
  batches.reduce((total, item) => total + (Number.isFinite(item.quantity) ? item.quantity : 0), 0);

export const validateMaterialConsumptions = (
  consumptions: MaterialConsumption[],
  bom: Bom | undefined,
  batches: RawMaterialBatch[]
) => {
  const errors: string[] = [];
  if (!bom) return ["BOM belum dipilih."];

  bom.materials.forEach((bomMaterial) => {
    const consumption = consumptions.find((item) => item.materialCode === bomMaterial.materialCode);
    const materialLabel = bomMaterial.materialCode;
    if (!consumption) {
      errors.push(`${materialLabel}: material consumption belum terisi.`);
      return;
    }

    const totalActual = sumBatchQty(consumption.batches);
    const minQty = bomMaterial.planningQty * 0.95;
    const maxQty = bomMaterial.planningQty * 1.1;
    if (totalActual < minQty || totalActual > maxQty) {
      errors.push(
        `${materialLabel}: total aktual ${totalActual.toFixed(2)} KG harus antara ${minQty.toFixed(2)} - ${maxQty.toFixed(2)} KG.`
      );
    }

    if (!consumption.batches.length) errors.push(`${materialLabel}: minimal satu batch harus diisi.`);
    const duplicateBatch = consumption.batches.find(
      (item, index) => consumption.batches.findIndex((candidate) => candidate.batch === item.batch) !== index
    );
    if (duplicateBatch) errors.push(`${materialLabel}: batch ${duplicateBatch.batch} diinput lebih dari sekali.`);

    consumption.batches.forEach((input) => {
      if (!input.batch) {
        errors.push(`${materialLabel}: batch raw material wajib dipilih.`);
        return;
      }
      const masterBatch = batches.find((batch) => batch.batch === input.batch);
      if (!masterBatch) {
        errors.push(`${materialLabel}: batch ${input.batch} tidak ditemukan.`);
        return;
      }
      if (masterBatch.status !== "available") errors.push(`${materialLabel}: batch ${input.batch} tidak available.`);
      if (masterBatch.materialCode !== bomMaterial.materialCode) {
        errors.push(`${materialLabel}: batch ${input.batch} adalah material ${masterBatch.materialCode}, tidak sesuai.`);
      }
      if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
        errors.push(`${materialLabel}: quantity batch ${input.batch} harus lebih dari 0 KG.`);
      }
      if (input.quantity > masterBatch.availableQty) {
        errors.push(
          `${materialLabel}: quantity ${input.quantity} KG melebihi stok batch ${input.batch} (${masterBatch.availableQty} KG).`
        );
      }
    });
  });

  return errors;
};

export const calculateProProgress = (transactions: ProductionTransaction[], proNumber: string) => {
  const related = transactions.filter((trx) => trx.proNumber === proNumber && trx.status === "completed");
  return {
    goodQty: related.reduce((total, trx) => total + trx.goodQty, 0),
    rejectQty: related.reduce((total, trx) => total + trx.rejectQty, 0),
    executionQty: related.length
  };
};

export const getProWarning = (pro: ProcessOrder | undefined, transactions: ProductionTransaction[], goodQty: number) => {
  if (!pro) return "";
  const progress = calculateProProgress(transactions, pro.proNumber);
  if (progress.goodQty + goodQty > pro.plannedGoodQty) {
    return `Good progress PRO akan melebihi plan (${progress.goodQty + goodQty}/${pro.plannedGoodQty} ROLL).`;
  }
  return "";
};

export const buildStockMovements = (
  transaction: ProductionTransaction,
  currentBatches: RawMaterialBatch[],
  movementType: "production_consumption" | "void_reversal",
  currentUser: User
) => {
  const movements: StockMovement[] = [];
  const updatedBatches = currentBatches.map((batch) => ({ ...batch }));
  transaction.rawMaterialConsumptions.forEach((consumption) => {
    consumption.batches.forEach((input) => {
      const batch = updatedBatches.find((item) => item.batch === input.batch);
      if (!batch) return;
      const beforeQty = batch.availableQty;
      const quantity = movementType === "production_consumption" ? -input.quantity : input.quantity;
      batch.availableQty = Number((batch.availableQty + quantity).toFixed(3));
      movements.push({
        id: `MOV-${String(Date.now()).slice(-6)}-${movements.length + 1}`,
        movementType,
        transactionId: transaction.id,
        materialCode: consumption.materialCode,
        materialBatch: input.batch,
        quantity,
        unit: "KG",
        beforeQty,
        afterQty: batch.availableQty,
        referenceRollNumber: transaction.rollNumber,
        referenceJumboBatch: transaction.jumboBatchNumber,
        createdAt: new Date().toISOString(),
        createdByUserId: currentUser.id
      });
    });
  });
  return { movements, updatedBatches };
};

export const getCorrectablePatch = (source: ProductionTransaction) => ({
  productionDateTime: source.productionDateTime,
  shiftCode: source.shiftCode,
  actualLengthM: source.actualLengthM,
  actualWidthMm: source.actualWidthMm,
  actualWeightKg: source.actualWeightKg,
  gradeCode: source.gradeCode,
  goodQty: source.goodQty,
  rejectQty: source.rejectQty,
  proNumber: source.proNumber,
  notes: source.notes
});

export const buildCorrectionHistory = (
  before: ProductionTransaction,
  after: ProductionTransaction,
  currentUser: User,
  approvedEmployeeNik: string,
  reason: string
): CorrectionHistory => ({
  correctedAt: new Date().toISOString(),
  correctedByUserId: currentUser.id,
  approvedEmployeeNik,
  reason,
  before: getCorrectablePatch(before),
  after: getCorrectablePatch(after)
});
