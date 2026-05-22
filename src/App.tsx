import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Boxes,
  CheckCircle2,
  ClipboardList,
  FilePenLine,
  History,
  Eye,
  EyeOff,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { boms as seedBoms } from "./data";
import {
  calculateProProgress,
  formatDateTimeLocal,
  getActiveEmployee,
  getProWarning,
  toIsoFromLocalInput,
  validateGrade,
  validateMaterialConsumptions
} from "./business";
import type {
  ActivityLog,
  BatchInput,
  Bom,
  Employee,
  Grade,
  JumboRollType,
  MaterialConsumption,
  ProcessOrder,
  ProductionLine,
  ProductionTransaction,
  RawMaterialBatch,
  RawMaterial,
  Resource,
  Shift,
  StockMovement,
  User
} from "./types";

type Page = "dashboard" | "execution" | "transactions" | "reports" | "movements" | "activity" | "masters";

const STORAGE_KEYS = {
  currentUserId: "rps.currentUserId"
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/api";

interface MasterData {
  employees: Employee[];
  users: User[];
  resources: Resource[];
  productionLines: ProductionLine[];
  shifts: Shift[];
  jumboRollTypes: JumboRollType[];
  grades: Grade[];
  rawMaterials: RawMaterial[];
  rawMaterialBatches: RawMaterialBatch[];
  boms: Bom[];
  processOrders: ProcessOrder[];
}

interface PaginationState {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

interface ReportFilters {
  line: string;
  grade: string;
  status: string;
  rawMaterial: string;
  date: string;
}

interface MovementFilters {
  movementType: string;
  materialCode: string;
  materialBatch: string;
  rollNumber: string;
  date: string;
}

interface ActivityFilters {
  search: string;
  eventType: string;
  status: string;
  date: string;
}

type PerformancePeriod = "hour" | "day" | "week" | "month" | "year";

interface PerformancePoint {
  label: string;
  bucket: string;
  completed: number;
  voided: number;
  net: number;
  total: number;
}

interface PerformanceData {
  period: PerformancePeriod;
  year: number;
  totals: {
    completed: number;
    voided: number;
    net: number;
    total: number;
  };
  series: PerformancePoint[];
}

interface DashboardSummary {
  completed: number;
  voided: number;
  todaysRoll: number;
  stockMovements: number;
  activePros: number;
}

interface NotificationPayload {
  type: "success" | "error";
  title?: string;
  message: string;
  details?: Array<{ label: string; value: string }>;
}

const emptyDashboardSummary = (): DashboardSummary => ({
  completed: 0,
  voided: 0,
  todaysRoll: 0,
  stockMovements: 0,
  activePros: 0
});

const emptyPerformanceData = (): PerformanceData => ({
  period: "month",
  year: new Date().getFullYear(),
  totals: { completed: 0, voided: 0, net: 0, total: 0 },
  series: []
});

const defaultPagination = (pageSize = 25): PaginationState => ({
  page: 1,
  pageSize,
  totalRows: 0,
  totalPages: 1
});

const buildQueryString = (params: Record<string, string | number | undefined>) => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") searchParams.set(key, String(value));
  }
  return searchParams.toString();
};

const emptyMasterData: MasterData = {
  employees: [],
  users: [],
  resources: [],
  productionLines: [],
  shifts: [],
  jumboRollTypes: [],
  grades: [],
  rawMaterials: [],
  rawMaterialBatches: [],
  boms: [],
  processOrders: []
};

const MasterDataContext = createContext<MasterData>(emptyMasterData);
const useMasterData = () => useContext(MasterDataContext);

function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function removeStorage(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

interface FormState {
  proNumber: string;
  productionLineCode: string;
  shiftCode: string;
  jumboRollCode: string;
  bomCode: string;
  dateMode: "auto" | "manual";
  manualDateTime: string;
  actualLengthM: string;
  actualWidthMm: string;
  actualWeightKg: string;
  gradeCode: string;
  notes: string;
  confirmNik: string;
  rawMaterialConsumptions: MaterialConsumption[];
  replacementOfTransactionId?: string;
  replacementOfRollNumber?: string;
}

const emptyForm = (): FormState => ({
  proNumber: "",
  productionLineCode: "L1",
  shiftCode: "S1",
  jumboRollCode: "P12",
  bomCode: "BOM-P12-V01",
  dateMode: "auto",
  manualDateTime: formatDateTimeLocal(),
  actualLengthM: "6000",
  actualWidthMm: "1200",
  actualWeightKg: "500",
  gradeCode: "A1",
  notes: "",
  confirmNik: "",
  rawMaterialConsumptions: [],
  replacementOfTransactionId: undefined,
  replacementOfRollNumber: undefined
});

const createConsumptionsFromBom = (bom: Bom): MaterialConsumption[] =>
  bom.materials.map((material) => ({
    materialCode: material.materialCode,
    planningQty: material.planningQty,
    unit: "KG",
    batches: [{ batch: "", quantity: material.planningQty }]
  }));

export function App() {
  const [currentUser, setCurrentUserState] = useState<User | null>(() => {
    return null;
  });
  const [masterData, setMasterData] = useState<MasterData>(emptyMasterData);
  const [apiStatus, setApiStatus] = useState<"loading" | "connected" | "fallback">("loading");
  const [apiError, setApiError] = useState("");
  const [page, setPage] = useState<Page>("dashboard");
  const [pageHistory, setPageHistory] = useState<Page[]>([]);
  const [rawMaterialBatches, setRawMaterialBatchesState] = useState<RawMaterialBatch[]>([]);
  const [transactions, setTransactionsState] = useState<ProductionTransaction[]>([]);
  const [stockMovements, setStockMovementsState] = useState<StockMovement[]>([]);
  const [form, setForm] = useState<FormState>(() => {
    const initial = emptyForm();
    const bom = seedBoms.find((item) => item.bomCode === initial.bomCode)!;
    return { ...initial, rawMaterialConsumptions: createConsumptionsFromBom(bom) };
  });
  const [toast, setToast] = useState("");
  const [loadingMessage, setLoadingMessage] = useState("");
  const [notification, setNotification] = useState<NotificationPayload | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<ProductionTransaction | null>(null);
  const [correctTarget, setCorrectTarget] = useState<ProductionTransaction | null>(null);
  const [transactionSearch, setTransactionSearch] = useState("");
  const [transactionPagination, setTransactionPagination] = useState<PaginationState>(() => defaultPagination(25));
  const [transactionListLoading, setTransactionListLoading] = useState(false);
  const [reportTransactions, setReportTransactions] = useState<ProductionTransaction[]>([]);
  const [reportPagination, setReportPagination] = useState<PaginationState>(() => defaultPagination(25));
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSearch, setReportSearch] = useState("");
  const [filters, setFilters] = useState<ReportFilters>({ line: "", grade: "", status: "", rawMaterial: "", date: "" });
  const [movementFilters, setMovementFilters] = useState<MovementFilters>({ movementType: "", materialCode: "", materialBatch: "", rollNumber: "", date: "" });
  const [movementPagination, setMovementPagination] = useState<PaginationState>(() => defaultPagination(25));
  const [movementLoading, setMovementLoading] = useState(false);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [activityFilters, setActivityFilters] = useState<ActivityFilters>({ search: "", eventType: "", status: "", date: "" });
  const [activityPagination, setActivityPagination] = useState<PaginationState>(() => defaultPagination(25));
  const [activityLoading, setActivityLoading] = useState(false);
  const [performancePeriod, setPerformancePeriod] = useState<PerformancePeriod>("month");
  const [performanceYear, setPerformanceYear] = useState(String(new Date().getFullYear()));
  const [performanceDate, setPerformanceDate] = useState(new Date().toISOString().slice(0, 10));
  const [performanceMonth, setPerformanceMonth] = useState(new Date().toISOString().slice(0, 7));
  const [performanceData, setPerformanceData] = useState<PerformanceData>(() => emptyPerformanceData());
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary>(() => emptyDashboardSummary());

  const employees = masterData.employees;
  const users = masterData.users;
  const resources = masterData.resources;
  const productionLines = masterData.productionLines;
  const shifts = masterData.shifts;
  const jumboRollTypes = masterData.jumboRollTypes;
  const grades = masterData.grades;
  const rawMaterials = masterData.rawMaterials;
  const boms = masterData.boms;
  const processOrders = masterData.processOrders;

  const materialName = (code: string) => rawMaterials.find((item) => item.code === code)?.description ?? code;
  const resourceName = (code: string) => resources.find((item) => item.code === code)?.name ?? code;
  const jumboName = (code: string) => jumboRollTypes.find((item) => item.code === code)?.description ?? code;

  useEffect(() => {
    fetch(`${API_BASE_URL}/master/bootstrap`)
      .then((response) => {
        if (!response.ok) throw new Error("API bootstrap failed");
        return response.json();
      })
      .then((data: MasterData) => {
        setMasterData(data);
        setApiStatus("connected");
        setRawMaterialBatchesState(data.rawMaterialBatches);
        setCurrentUserState((current) => {
          const userId = readStorage<string | null>(STORAGE_KEYS.currentUserId, null);
          if (!userId) return current;
          const user = data.users.find((item) => item.id === userId);
          const employee = user ? data.employees.find((item) => item.nik === user.employeeNik && item.status === "active") : null;
          return user && employee ? user : null;
        });
      })
      .catch((error) => {
        setApiStatus("fallback");
        setApiError(`API tidak terkoneksi: ${error instanceof Error ? error.message : "unknown error"}`);
      });
  }, []);

  useEffect(() => {
    if (apiStatus !== "connected") return;
    refreshTransactionsFromApi({ page: 1 }).catch((error) =>
      showNotification("error", error instanceof Error ? error.message : "Gagal mengambil transaksi.")
    );
    refreshReportFromApi({ page: 1 }).catch((error) =>
      showNotification("error", error instanceof Error ? error.message : "Gagal mengambil report.")
    );
    refreshMovementsFromApi({ page: 1 }).catch((error) =>
      showNotification("error", error instanceof Error ? error.message : "Gagal mengambil movement.")
    );
    refreshActivityLogsFromApi({ page: 1 }).catch((error) =>
      showNotification("error", error instanceof Error ? error.message : "Gagal mengambil activity log.")
    );
    refreshPerformanceFromApi({ period: performancePeriod, year: performanceYear, date: performanceDate, month: performanceMonth }).catch((error) =>
      showNotification("error", error instanceof Error ? error.message : "Gagal mengambil performance chart.")
    );
    refreshDashboardSummaryFromApi().catch((error) =>
      showNotification("error", error instanceof Error ? error.message : "Gagal mengambil dashboard summary.")
    );
  }, [apiStatus]);

  useEffect(() => {
    if (apiStatus !== "connected") return;
    setTransactionListLoading(true);
    const timer = window.setTimeout(() => {
      refreshTransactionsFromApi({ search: transactionSearch, page: 1 }).catch((error) =>
        showNotification("error", error instanceof Error ? error.message : "Gagal mencari transaksi.")
      );
    }, 450);
    return () => {
      window.clearTimeout(timer);
    };
  }, [transactionSearch, apiStatus]);

  useEffect(() => {
    if (apiStatus !== "connected" || page !== "activity") return;
    refreshActivityLogsFromApi({ page: 1 }).catch((error) =>
      showNotification("error", error instanceof Error ? error.message : "Gagal mengambil activity log.")
    );
  }, [page, apiStatus]);

  const login = (user: User) => {
    writeStorage(STORAGE_KEYS.currentUserId, user.id);
    setPage("dashboard");
    setPageHistory([]);
    setCurrentUserState(user);
  };

  const showNotification = (
    type: "success" | "error",
    message: string,
    options: { title?: string; details?: Array<{ label: string; value: string }> } = {}
  ) => {
    setNotification({ type, message, title: options.title, details: options.details });
  };

  const writeActivityLog = async (payload: {
    eventType: string;
    page?: string;
    action: string;
    status: "success" | "failed" | "info";
    message?: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }) => {
    if (apiStatus !== "connected" || !currentUser) return;
    await fetch(`${API_BASE_URL}/activity-logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        userId: currentUser.id,
        employeeNik: currentUser.employeeNik,
        role: currentUser.role
      })
    }).catch(() => undefined);
  };

  const refreshTransactionsFromApi = async (options: { force?: boolean; search?: string; page?: number; pageSize?: number } = {}) => {
    if (!options.force && apiStatus !== "connected") return;
    setTransactionListLoading(true);
    try {
      const query = buildQueryString({
        page: options.page ?? transactionPagination.page,
        pageSize: options.pageSize ?? transactionPagination.pageSize,
        search: options.search ?? transactionSearch
      });
      const response = await fetch(`${API_BASE_URL}/transactions?${query}`);
      if (!response.ok) throw new Error("Gagal mengambil transaction list dari API.");
      const data = await response.json();
      setTransactionsState(data.transactions || []);
      setTransactionPagination(data.pagination || defaultPagination(25));
    } finally {
      setTransactionListLoading(false);
    }
  };

  const refreshReportFromApi = async (options: { force?: boolean; page?: number; pageSize?: number } = {}) => {
    if (!options.force && apiStatus !== "connected") return;
    setReportLoading(true);
    try {
      const query = buildQueryString({
        page: options.page ?? reportPagination.page,
        pageSize: options.pageSize ?? reportPagination.pageSize,
        search: reportSearch,
        productionLineCode: filters.line,
        gradeCode: filters.grade,
        status: filters.status,
        rawMaterialCode: filters.rawMaterial,
        dateFrom: filters.date,
        dateTo: filters.date
      });
      const response = await fetch(`${API_BASE_URL}/reports/jumbo-rolls?${query}`);
      if (!response.ok) throw new Error("Gagal mengambil jumbo roll report dari API.");
      const data = await response.json();
      setReportTransactions(data.transactions || []);
      setReportPagination(data.pagination || defaultPagination(25));
    } finally {
      setReportLoading(false);
    }
  };

  const refreshMovementsFromApi = async (options: { force?: boolean; page?: number; pageSize?: number } = {}) => {
    if (!options.force && apiStatus !== "connected") return;
    setMovementLoading(true);
    try {
      const query = buildQueryString({
        page: options.page ?? movementPagination.page,
        pageSize: options.pageSize ?? movementPagination.pageSize,
        movementType: movementFilters.movementType,
        materialCode: movementFilters.materialCode,
        materialBatch: movementFilters.materialBatch,
        rollNumber: movementFilters.rollNumber,
        dateFrom: movementFilters.date,
        dateTo: movementFilters.date
      });
      const response = await fetch(`${API_BASE_URL}/reports/raw-material-movements?${query}`);
      if (!response.ok) throw new Error("Gagal mengambil raw material movement dari API.");
      const data = await response.json();
      setStockMovementsState(data.movements || []);
      setMovementPagination(data.pagination || defaultPagination(25));
    } finally {
      setMovementLoading(false);
    }
  };

  const refreshActivityLogsFromApi = async (options: { force?: boolean; page?: number; pageSize?: number } = {}) => {
    if (!options.force && apiStatus !== "connected") return;
    setActivityLoading(true);
    try {
      const query = buildQueryString({
        page: options.page ?? activityPagination.page,
        pageSize: options.pageSize ?? activityPagination.pageSize,
        search: activityFilters.search,
        eventType: activityFilters.eventType,
        status: activityFilters.status,
        dateFrom: activityFilters.date,
        dateTo: activityFilters.date
      });
      const response = await fetch(`${API_BASE_URL}/activity-logs?${query}`);
      if (!response.ok) throw new Error("Gagal mengambil activity log dari API.");
      const data = await response.json();
      setActivityLogs(data.logs || []);
      setActivityPagination(data.pagination || defaultPagination(25));
    } finally {
      setActivityLoading(false);
    }
  };

  const refreshPerformanceFromApi = async (options: { period?: PerformancePeriod; year?: string; date?: string; month?: string; force?: boolean } = {}) => {
    if (!options.force && apiStatus !== "connected") return;
    setPerformanceLoading(true);
    try {
      const query = buildQueryString({
        period: options.period ?? performancePeriod,
        year: options.year ?? performanceYear,
        date: options.date ?? performanceDate,
        month: options.month ?? performanceMonth
      });
      const response = await fetch(`${API_BASE_URL}/dashboard/production-performance?${query}`);
      if (!response.ok) throw new Error("Gagal mengambil production performance dari API.");
      const data = await response.json();
      setPerformanceData(data);
    } finally {
      setPerformanceLoading(false);
    }
  };

  const refreshDashboardSummaryFromApi = async (force = false) => {
    if (!force && apiStatus !== "connected") return;
    const response = await fetch(`${API_BASE_URL}/dashboard/summary`);
    if (!response.ok) throw new Error("Gagal mengambil dashboard summary dari API.");
    const data = await response.json();
    setDashboardSummary(data);
  };

  const refreshBootstrapFromApi = async () => {
    if (apiStatus !== "connected") return;
    const response = await fetch(`${API_BASE_URL}/master/bootstrap`);
    if (!response.ok) throw new Error("Gagal mengambil master data dari API.");
    const data = await response.json();
    setMasterData(data);
    setRawMaterialBatchesState(data.rawMaterialBatches || []);
  };

  const checkApiConnection = async () => {
    try {
      setLoadingMessage("Mengecek koneksi API...");
      const response = await fetch(`${API_BASE_URL}/health`);
      const data = await response.json();
      if (!response.ok || data.status !== "ok" || data.database !== "ok") {
        throw new Error(data.message || "API/database tidak sehat.");
      }
      const bootstrap = await fetch(`${API_BASE_URL}/master/bootstrap`);
      if (!bootstrap.ok) throw new Error("API bootstrap gagal.");
      const master = await bootstrap.json();
      setMasterData(master);
      setApiStatus("connected");
      setApiError("");
      setRawMaterialBatchesState(master.rawMaterialBatches || []);
      await refreshTransactionsFromApi({ force: true, page: 1 });
      await refreshReportFromApi({ force: true, page: 1 });
      await refreshMovementsFromApi({ force: true, page: 1 });
      await refreshActivityLogsFromApi({ force: true, page: 1 });
      await refreshPerformanceFromApi({ force: true });
      await refreshDashboardSummaryFromApi(true);
      showNotification("success", `API connected ke database ${data.connection?.database ?? "DBWilliam"}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Koneksi API gagal.";
      setApiStatus("fallback");
      setApiError(`API tidak terkoneksi: ${message}`);
      showNotification("error", `Koneksi API/PostgreSQL bermasalah.\n${message}`);
    } finally {
      setLoadingMessage("");
    }
  };

  const logout = () => {
    writeActivityLog({
      eventType: "LOGOUT",
      page,
      action: "logout",
      status: "success",
      message: "User logout dari web."
    });
    removeStorage(STORAGE_KEYS.currentUserId);
    setCurrentUserState(null);
    setPage("dashboard");
    setPageHistory([]);
  };

  const navigateTo = (nextPage: Page) => {
    writeActivityLog({
      eventType: "OPEN_PAGE",
      page: nextPage,
      action: "open_page",
      status: "info",
      message: `Open page ${nextPage}.`
    });
    setLoadingMessage("Memuat halaman...");
    window.setTimeout(() => setLoadingMessage(""), 250);
    if (nextPage === "dashboard") {
      setPage("dashboard");
      setPageHistory([]);
      return;
    }
    setPage((current) => {
      if (current !== nextPage) setPageHistory((history) => [...history, current]);
      return nextPage;
    });
  };

  const goBack = () => {
    setPageHistory((history) => {
      const previous = history[history.length - 1] ?? "dashboard";
      setPage(previous);
      return history.slice(0, -1);
    });
  };

  const operatorEmployee = currentUser ? employees.find((employee) => employee.nik === currentUser.employeeNik) : null;

  const selectedLine = productionLines.find((line) => line.code === form.productionLineCode);
  const selectedResourceCode = selectedLine?.resourceCode ?? "";
  const selectedBom = boms.find((bom) => bom.bomCode === form.bomCode);
  const selectedPro = processOrders.find((pro) => pro.proNumber === form.proNumber);
  const productionDateTime =
    form.dateMode === "auto" ? new Date().toISOString() : toIsoFromLocalInput(form.manualDateTime);

  const validation = useMemo(() => {
    const errors: string[] = [];
    if (!currentUser) return errors;
    if (!operatorEmployee || operatorEmployee.status !== "active") errors.push("User login belum terhubung ke employee aktif.");
    if (!selectedLine) errors.push("Production line wajib valid.");
    if (!form.shiftCode) errors.push("Shift wajib dipilih.");
    if (!jumboRollTypes.find((item) => item.code === form.jumboRollCode && item.status === "active")) {
      errors.push("Tipe jumbo roll wajib valid dan aktif.");
    }
    if (!selectedBom || selectedBom.status !== "active") errors.push("BOM wajib aktif.");
    const gradeError = validateGrade(grades, form.gradeCode.toUpperCase());
    if (gradeError) errors.push(gradeError);
    if (Number(form.actualLengthM) <= 0) errors.push("Panjang aktual harus lebih dari 0 meter.");
    if (Number(form.actualWidthMm) <= 0) errors.push("Lebar aktual harus lebih dari 0 mm.");
    if (Number(form.actualWeightKg) <= 0) errors.push("Berat aktual harus lebih dari 0 KG.");
    if (form.dateMode === "manual" && !form.manualDateTime) errors.push("Tanggal produksi manual wajib diisi.");
    errors.push(...validateMaterialConsumptions(form.rawMaterialConsumptions, selectedBom, rawMaterialBatches));
    return errors;
  }, [currentUser, form, operatorEmployee, rawMaterialBatches, selectedBom, selectedLine]);

  const proWarning = getProWarning(selectedPro, transactions, 1);
  const activeBoms = boms.filter((bom) => bom.jumboRollCode === form.jumboRollCode && bom.status === "active");

  const resetForm = () => {
    const next = emptyForm();
    const bom = boms.find((item) => item.bomCode === next.bomCode) ?? seedBoms[0];
    setForm({ ...next, rawMaterialConsumptions: createConsumptionsFromBom(bom) });
  };

  const applyPro = (proNumber: string) => {
    const pro = processOrders.find((item) => item.proNumber === proNumber);
    if (!pro) {
      setForm((current) => ({ ...current, proNumber }));
      return;
    }
    const defaultBom = boms.find((bom) => bom.bomCode === pro.defaultBomCode && bom.status === "active");
    setForm((current) => ({
      ...current,
      proNumber,
      jumboRollCode: pro.jumboRollCode,
      productionLineCode: pro.productionLineCode,
      bomCode: defaultBom?.bomCode ?? current.bomCode,
      rawMaterialConsumptions: defaultBom ? createConsumptionsFromBom(defaultBom) : current.rawMaterialConsumptions
    }));
  };

  const changeJumboRoll = (code: string) => {
    const defaultBom = boms.find((bom) => bom.jumboRollCode === code && bom.status === "active" && bom.isDefault);
    setForm((current) => ({
      ...current,
      jumboRollCode: code,
      bomCode: defaultBom?.bomCode ?? "",
      rawMaterialConsumptions: defaultBom ? createConsumptionsFromBom(defaultBom) : []
    }));
  };

  const changeBom = (bomCode: string) => {
    const bom = boms.find((item) => item.bomCode === bomCode);
    setForm((current) => ({
      ...current,
      bomCode,
      rawMaterialConsumptions: bom ? createConsumptionsFromBom(bom) : []
    }));
  };

  const setBatch = (materialCode: string, index: number, patch: Partial<BatchInput>) => {
    setForm((current) => ({
      ...current,
      rawMaterialConsumptions: current.rawMaterialConsumptions.map((consumption) =>
        consumption.materialCode !== materialCode
          ? consumption
          : {
              ...consumption,
              batches: consumption.batches.map((batch, batchIndex) =>
                batchIndex === index ? { ...batch, ...patch } : batch
              )
            }
      )
    }));
  };

  const addBatch = (materialCode: string) => {
    setForm((current) => ({
      ...current,
      rawMaterialConsumptions: current.rawMaterialConsumptions.map((consumption) =>
        consumption.materialCode === materialCode
          ? { ...consumption, batches: [...consumption.batches, { batch: "", quantity: 0 }] }
          : consumption
      )
    }));
  };

  const removeBatch = (materialCode: string, index: number) => {
    setForm((current) => ({
      ...current,
      rawMaterialConsumptions: current.rawMaterialConsumptions.map((consumption) =>
        consumption.materialCode === materialCode
          ? { ...consumption, batches: consumption.batches.filter((_, batchIndex) => batchIndex !== index) }
          : consumption
      )
    }));
  };

  const executeTransaction = async () => {
    if (!currentUser || !operatorEmployee || !selectedBom || !selectedLine) return;
    const approver = getActiveEmployee(employees, form.confirmNik);
    if (!approver) {
      setToast("NIK konfirmasi tidak valid atau employee tidak aktif.");
      return;
    }
    if (apiStatus !== "connected") {
      showNotification(
        "error",
        `Transaksi tidak bisa dieksekusi ke PostgreSQL karena API tidak terkoneksi.\n${apiError || `Pastikan API aktif di ${API_BASE_URL}.`}`
      );
      return;
    }
    try {
      setLoadingMessage("Mengeksekusi transaksi...");
      const response = await fetch(`${API_BASE_URL}/executions/jumbo-roll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proNumber: form.proNumber || undefined,
          productionLineCode: form.productionLineCode,
          shiftCode: form.shiftCode,
          jumboRollCode: form.jumboRollCode,
          bomCode: selectedBom.bomCode,
          productionDateTime,
          actualLengthM: Number(form.actualLengthM),
          actualWidthMm: Number(form.actualWidthMm),
          actualWeightKg: Number(form.actualWeightKg),
          gradeCode: form.gradeCode.toUpperCase(),
          notes: form.notes,
          confirmedEmployeeNik: form.confirmNik,
          createdByUserId: currentUser.id,
          rawMaterialConsumptions: form.rawMaterialConsumptions,
          replacementOfTransactionId: form.replacementOfTransactionId,
          replacementOfRollNumber: form.replacementOfRollNumber
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.errors?.join("\n") || data.message || "Transaksi gagal.");
      }
      await refreshTransactionsFromApi({ page: 1 });
      await refreshReportFromApi({ page: 1 });
      await refreshMovementsFromApi({ page: 1 });
      await refreshDashboardSummaryFromApi();
      await refreshBootstrapFromApi();
      setConfirmOpen(false);
      showNotification("success", "Transaksi berhasil disimpan ke PostgreSQL.", {
        title: "Transaction Created",
        details: [
          { label: "Roll Number", value: data.transaction.rollNumber },
          { label: "Jumbo Batch", value: data.transaction.jumboBatchNumber },
          { label: "Production Time", value: new Date(data.transaction.productionDateTime).toLocaleString() }
        ]
      });
      resetForm();
      navigateTo("transactions");
    } catch (error) {
      showNotification("error", error instanceof Error ? error.message : "Transaksi gagal.");
    } finally {
      setLoadingMessage("");
    }
  };

  const createReplacement = (source: ProductionTransaction) => {
    const bom = boms.find((item) => item.bomCode === source.bomCode)!;
    setForm({
      proNumber: source.proNumber ?? "",
      productionLineCode: source.productionLineCode,
      shiftCode: source.shiftCode,
      jumboRollCode: source.jumboRollCode,
      bomCode: source.bomCode,
      dateMode: "auto",
      manualDateTime: formatDateTimeLocal(new Date(source.productionDateTime)),
      actualLengthM: String(source.actualLengthM),
      actualWidthMm: String(source.actualWidthMm),
      actualWeightKg: String(source.actualWeightKg),
      gradeCode: source.gradeCode,
      notes: `Replacement of ${source.rollNumber}`,
      confirmNik: "",
      rawMaterialConsumptions: createConsumptionsFromBom(bom).map((item) => {
        const old = source.rawMaterialConsumptions.find((candidate) => candidate.materialCode === item.materialCode);
        return old ? { ...old, batches: old.batches.map((batch) => ({ ...batch })) } : item;
      }),
      replacementOfTransactionId: source.id,
      replacementOfRollNumber: source.rollNumber
    });
    setToast(`Form replacement disiapkan untuk ${source.rollNumber}. Nomor roll baru akan dibuat saat submit.`);
    navigateTo("execution");
  };

  if (!currentUser) {
    return <Login onLogin={login} />;
  }

  return (
    <MasterDataContext.Provider value={masterData}>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">RP</div>
          <div>
            <h1>Roll Production System</h1>
            <p>Production Execution & Traceability</p>
          </div>
        </div>
        <nav>
          <SidebarButton active={page === "dashboard"} icon={<LayoutDashboard />} label="Dashboard" onClick={() => navigateTo("dashboard")} />
          <SidebarButton active={page === "execution"} icon={<PackageCheck />} label="Execution Jumbo Roll" onClick={() => navigateTo("execution")} />
          <SidebarButton active={page === "transactions"} icon={<ClipboardList />} label="Transaction List" onClick={() => navigateTo("transactions")} />
          <SidebarButton active={page === "reports"} icon={<BarChart3 />} label="Jumbo Roll Report" onClick={() => navigateTo("reports")} />
          <SidebarButton active={page === "movements"} icon={<History />} label="Raw Material Movement" onClick={() => navigateTo("movements")} />
          <SidebarButton active={page === "activity"} icon={<ShieldCheck />} label="Activity Log" onClick={() => navigateTo("activity")} />
          <SidebarButton active={page === "masters"} icon={<Boxes />} label="Master Data" onClick={() => navigateTo("masters")} />
        </nav>
        <div className="user-card">
          <strong>{operatorEmployee?.name}</strong>
          <span>{currentUser.role} · {currentUser.employeeNik}</span>
          <button className="ghost-button" onClick={logout}><LogOut size={16} /> Logout</button>
        </div>
      </aside>

      <main>
        {toast && <div className="toast"><CheckCircle2 size={18} /> {toast}<button onClick={() => setToast("")}>x</button></div>}
        {loadingMessage && <LoadingModal message={loadingMessage} />}
        {notification && <NotificationModal notification={notification} onClose={() => setNotification(null)} />}
        <ApiStatusBanner status={apiStatus} error={apiError} apiBaseUrl={API_BASE_URL} onRetry={checkApiConnection} />
        {page === "dashboard" && (
          <Dashboard
            navigateTo={navigateTo}
            transactions={transactions}
            movements={stockMovements}
            rawMaterialBatches={rawMaterialBatches}
            currentUser={currentUser}
            dashboardSummary={dashboardSummary}
            performanceData={performanceData}
            performancePeriod={performancePeriod}
            performanceYear={performanceYear}
            performanceDate={performanceDate}
            performanceMonth={performanceMonth}
            performanceLoading={performanceLoading}
            setPerformancePeriod={setPerformancePeriod}
            setPerformanceYear={setPerformanceYear}
            setPerformanceDate={setPerformanceDate}
            setPerformanceMonth={setPerformanceMonth}
            refreshPerformance={() => refreshPerformanceFromApi().catch((error) => showNotification("error", error instanceof Error ? error.message : "Gagal mengambil performance chart."))}
          />
        )}
        {page === "execution" && (
          <section>
            <PageTitle title="Execution Jumbo Roll" subtitle="Satu execution menghasilkan satu roll result dengan material traceability." onBack={goBack} />
            <ExecutionForm
              form={form}
              activeBoms={activeBoms}
              validation={validation}
              proWarning={proWarning}
              selectedResourceCode={selectedResourceCode}
              operatorName={operatorEmployee?.name ?? "-"}
              rawMaterialBatches={rawMaterialBatches}
              setForm={setForm}
              applyPro={applyPro}
              changeJumboRoll={changeJumboRoll}
              changeBom={changeBom}
              setBatch={setBatch}
              addBatch={addBatch}
              removeBatch={removeBatch}
              openConfirm={() => setConfirmOpen(true)}
            />
          </section>
        )}
        {page === "transactions" && (
          <section>
          <PageTitle title="Transaction List" subtitle="Correct, void, dan replacement execution jumbo roll." onBack={goBack} />
          <TransactionList
            transactions={transactions}
            search={transactionSearch}
            setSearch={setTransactionSearch}
            loading={transactionListLoading}
            pagination={transactionPagination}
            onPageChange={(nextPage) => refreshTransactionsFromApi({ page: nextPage }).catch((error) => showNotification("error", error instanceof Error ? error.message : "Gagal mengambil transaksi."))}
            onVoid={setVoidTarget}
            onCorrect={setCorrectTarget}
            onReplacement={createReplacement}
          />
          </section>
        )}
        {page === "reports" && (
          <section>
          <PageTitle title="Jumbo Roll Report" subtitle="Cari berdasarkan batch, nomor roll, tipe, dimensi, grade, dan raw material." onBack={goBack} />
          <JumboRollReport
            transactions={reportTransactions}
            search={reportSearch}
            setSearch={setReportSearch}
            filters={filters}
            setFilters={setFilters}
            loading={reportLoading}
            pagination={reportPagination}
            onSearch={() => refreshReportFromApi({ page: 1 }).catch((error) => showNotification("error", error instanceof Error ? error.message : "Gagal mengambil report."))}
            onPageChange={(nextPage) => refreshReportFromApi({ page: nextPage }).catch((error) => showNotification("error", error instanceof Error ? error.message : "Gagal mengambil report."))}
          />
          </section>
        )}
        {page === "movements" && (
          <MovementReport
            movements={stockMovements}
            filters={movementFilters}
            setFilters={setMovementFilters}
            loading={movementLoading}
            pagination={movementPagination}
            onSearch={() => refreshMovementsFromApi({ page: 1 }).catch((error) => showNotification("error", error instanceof Error ? error.message : "Gagal mengambil movement."))}
            onPageChange={(nextPage) => refreshMovementsFromApi({ page: nextPage }).catch((error) => showNotification("error", error instanceof Error ? error.message : "Gagal mengambil movement."))}
            onBack={goBack}
          />
        )}
        {page === "activity" && (
          <ActivityLogReport
            logs={activityLogs}
            filters={activityFilters}
            setFilters={setActivityFilters}
            loading={activityLoading}
            pagination={activityPagination}
            onSearch={() => refreshActivityLogsFromApi({ page: 1 }).catch((error) => showNotification("error", error instanceof Error ? error.message : "Gagal mengambil activity log."))}
            onPageChange={(nextPage) => refreshActivityLogsFromApi({ page: nextPage }).catch((error) => showNotification("error", error instanceof Error ? error.message : "Gagal mengambil activity log."))}
            onBack={goBack}
          />
        )}
        {page === "masters" && <MasterDataPreview rawMaterialBatches={rawMaterialBatches} transactions={transactions} onBack={goBack} />}
      </main>

      {confirmOpen && (
        <ConfirmModal
          form={form}
          validation={validation}
          selectedBom={selectedBom}
          selectedResourceCode={selectedResourceCode}
          productionDateTime={productionDateTime}
          proWarning={proWarning}
          setForm={setForm}
          onClose={() => setConfirmOpen(false)}
          onExecute={executeTransaction}
        />
      )}
      {voidTarget && (
        <VoidModal
          target={voidTarget}
          currentUser={currentUser}
          rawMaterialBatches={rawMaterialBatches}
          apiConnected={apiStatus === "connected"}
          setLoadingMessage={setLoadingMessage}
          showNotification={showNotification}
          refreshAfterApi={async () => {
            await refreshTransactionsFromApi();
            await refreshReportFromApi();
            await refreshMovementsFromApi();
            await refreshDashboardSummaryFromApi();
            await refreshBootstrapFromApi();
          }}
          onClose={() => setVoidTarget(null)}
        />
      )}
      {correctTarget && (
        <CorrectionModal
          target={correctTarget}
          currentUser={currentUser}
          apiConnected={apiStatus === "connected"}
          setLoadingMessage={setLoadingMessage}
          showNotification={showNotification}
          refreshAfterApi={async () => {
            await refreshTransactionsFromApi();
            await refreshReportFromApi();
            await refreshMovementsFromApi();
            await refreshDashboardSummaryFromApi();
          }}
          onClose={() => setCorrectTarget(null)}
        />
      )}
    </div>
    </MasterDataContext.Provider>
  );
}

function LoadingModal({ message }: { message: string }) {
  return (
    <div className="modal-backdrop subtle">
      <section className="loading-modal">
        <div className="spinner" />
        <strong>{message}</strong>
      </section>
    </div>
  );
}

function NotificationModal({ notification, onClose }: { notification: NotificationPayload; onClose: () => void }) {
  const lines = notification.message.split("\n").filter(Boolean);
  return (
    <div className="modal-backdrop subtle">
      <section className={`notification-modal ${notification.type}`}>
        <div className="notification-icon">
          {notification.type === "success" ? <CheckCircle2 size={26} /> : <AlertTriangle size={26} />}
        </div>
        <div className="notification-content">
          <h3>{notification.title ?? (notification.type === "success" ? "Sukses" : "Error")}</h3>
          {notification.type === "error" && lines.length > 1 ? (
            <ul className="notification-list">{lines.map((line) => <li key={line}>{line}</li>)}</ul>
          ) : (
            <p>{notification.message}</p>
          )}
          {!!notification.details?.length && (
            <div className="notification-details">
              {notification.details.map((detail) => (
                <div key={detail.label}>
                  <span>{detail.label}</span>
                  <strong>{detail.value}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="ghost-button" onClick={onClose}>OK</button>
      </section>
    </div>
  );
}

function ApiStatusBanner({
  status,
  error,
  apiBaseUrl,
  onRetry
}: {
  status: "loading" | "connected" | "fallback";
  error: string;
  apiBaseUrl: string;
  onRetry: () => void;
}) {
  if (status === "connected") return null;
  if (status === "loading") {
    return <div className="api-banner loading"><div className="mini-spinner" /> Checking API connection...</div>;
  }
  return (
    <div className="api-banner error">
      <AlertTriangle size={16} />
      <span>{error || `API tidak terkoneksi. Pastikan API aktif di ${apiBaseUrl}.`}</span>
      <button onClick={onRetry}>Retry</button>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<NotificationPayload | null>(null);

  const submit = async () => {
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (response.ok) {
        const data = await response.json();
        setLoading(false);
        setNotification({ type: "success", title: "Login Success", message: "Membuka dashboard..." });
        window.setTimeout(() => onLogin(data.user), 550);
        return;
      }
    } catch {
      // Fallback keeps the demo usable when the API server is not running.
    }

    const message = `Login gagal karena API/PostgreSQL tidak terkoneksi. Pastikan API aktif di ${API_BASE_URL}.`;
    setError(message);
    setNotification({ type: "error", title: "Login Failed", message });
    setLoading(false);
  };

  return (
    <div className="login-page">
      {loading && <LoadingModal message="Memproses login..." />}
      {notification && <NotificationModal notification={notification} onClose={() => setNotification(null)} />}
      <section
        className="login-panel"
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
      >
        <div className="brand-mark large">RP</div>
        <h1>Roll Production System</h1>
        <p>Production Transaction & Material Traceability</p>
        <label>Username</label>
        <input value={username} onChange={(event) => setUsername(event.target.value)} />
        <label>Password</label>
        <div className="password-field">
          <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} />
          <button type="button" title={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)}>
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <button className="primary-button" disabled={loading} onClick={submit}><ShieldCheck size={18} /> Login</button>
        <small>Dummy: operator/operator123, supervisor/supervisor123, admin/admin123</small>
      </section>
    </div>
  );
}

function SidebarButton(props: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`sidebar-button ${props.active ? "active" : ""}`} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function PageTitle({ title, subtitle, onBack }: { title: string; subtitle: string; onBack?: () => void }) {
  return (
    <header className="page-title">
      <div>
        {onBack && <button className="back-button" onClick={onBack}><ArrowLeft size={18} /> Back</button>}
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </header>
  );
}

function Dashboard({
  navigateTo,
  transactions,
  movements,
  rawMaterialBatches,
  currentUser,
  dashboardSummary,
  performanceData,
  performancePeriod,
  performanceYear,
  performanceDate,
  performanceMonth,
  performanceLoading,
  setPerformancePeriod,
  setPerformanceYear,
  setPerformanceDate,
  setPerformanceMonth,
  refreshPerformance
}: {
  navigateTo: (page: Page) => void;
  transactions: ProductionTransaction[];
  movements: StockMovement[];
  rawMaterialBatches: RawMaterialBatch[];
  currentUser: User;
  dashboardSummary: DashboardSummary;
  performanceData: PerformanceData;
  performancePeriod: PerformancePeriod;
  performanceYear: string;
  performanceDate: string;
  performanceMonth: string;
  performanceLoading: boolean;
  setPerformancePeriod: (period: PerformancePeriod) => void;
  setPerformanceYear: (year: string) => void;
  setPerformanceDate: (date: string) => void;
  setPerformanceMonth: (month: string) => void;
  refreshPerformance: () => void;
}) {
  const { employees } = useMasterData();
  const completed = dashboardSummary.completed;
  const voided = dashboardSummary.voided;
  const todaysRoll = dashboardSummary.todaysRoll;
  const activePros = dashboardSummary.activePros;
  const recent = transactions.slice(0, 5);
  const lowStock = rawMaterialBatches
    .filter((batch) => batch.status === "available" && batch.availableQty <= 200)
    .slice(0, 5);
  const blocked = rawMaterialBatches.filter((batch) => batch.status === "blocked").slice(0, 5);
  const userEmployee = employees.find((employee) => employee.nik === currentUser.employeeNik);
  return (
    <section>
      <div className="dashboard-hero">
        <div>
          <span className="eyebrow">Roll Production System</span>
          <h2>Dashboard Produksi</h2>
          <p>{userEmployee?.name ?? currentUser.username} · {currentUser.role} · {new Date().toLocaleDateString()}</p>
        </div>
        <div className="hero-status">
          <strong>{todaysRoll}</strong>
          <span>Roll hari ini</span>
        </div>
      </div>
      <SectionHeading title="Operational Summary" />
      <div className="metric-grid">
        <div className="metric-card"><span>Completed</span><strong>{completed}</strong></div>
        <div className="metric-card"><span>Voided</span><strong>{voided}</strong></div>
        <div className="metric-card"><span>Stock Movements</span><strong>{dashboardSummary.stockMovements}</strong></div>
        <div className="metric-card"><span>Active PRO</span><strong>{activePros}</strong></div>
      </div>
      <SectionHeading title="Production Performance" />
      <section className="panel performance-panel">
        <div className="chart-toolbar">
          <div>
            <h3>Transaction Trend</h3>
            <p>Completed, voided, dan net transaction berdasarkan periode produksi.</p>
          </div>
          <div className="chart-controls">
            <select value={performancePeriod} onChange={(event) => setPerformancePeriod(event.target.value as PerformancePeriod)}>
              <option value="hour">Hour</option>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
            {performancePeriod === "hour" && <input type="date" value={performanceDate} onChange={(event) => setPerformanceDate(event.target.value)} />}
            {performancePeriod === "day" && <input type="month" value={performanceMonth} onChange={(event) => setPerformanceMonth(event.target.value)} />}
            {["week", "month"].includes(performancePeriod) && <input value={performanceYear} onChange={(event) => setPerformanceYear(event.target.value)} inputMode="numeric" />}
            {performancePeriod === "year" && <input value="All years" readOnly />}
            <button className="primary-button" disabled={performanceLoading} onClick={refreshPerformance}>
              {performanceLoading && <span className="mini-spinner light-spinner" />} Apply
            </button>
          </div>
        </div>
        <p className="chart-context">
          {performancePeriod === "hour" && `Hourly trend for ${performanceDate}.`}
          {performancePeriod === "day" && `Daily trend for ${performanceMonth}.`}
          {performancePeriod === "week" && `Weekly trend for ${performanceYear}.`}
          {performancePeriod === "month" && `Monthly trend for ${performanceYear}.`}
          {performancePeriod === "year" && "Yearly trend for all available production data."}
        </p>
        <div className="chart-summary">
          <span>Completed <strong>{performanceData.totals.completed}</strong></span>
          <span>Voided <strong>{performanceData.totals.voided}</strong></span>
          <span>Net <strong>{performanceData.totals.net}</strong></span>
        </div>
        <LinePerformanceChart data={performanceData.series} loading={performanceLoading} />
      </section>
      <SectionHeading title="Production Monitoring" />
      <div className="dashboard-panels">
        <section className="panel">
          <h3>Recent Transactions</h3>
          <div className="compact-list">
            {recent.map((trx) => (
              <button key={trx.id} onClick={() => navigateTo("transactions")}>
                <strong>{trx.rollNumber}</strong>
                <span>{trx.jumboBatchNumber} · {trx.jumboRollCode} · {trx.status}</span>
              </button>
            ))}
            {!recent.length && <div className="empty-state">Belum ada transaksi.</div>}
          </div>
        </section>
        <section className="panel">
          <h3>Stock Attention</h3>
          <div className="compact-list">
            {[...lowStock, ...blocked].map((batch) => (
              <button key={batch.batch} onClick={() => navigateTo("masters")}>
                <strong>{batch.batch}</strong>
                <span>{batch.materialCode} · {batch.availableQty} KG · {batch.status}</span>
              </button>
            ))}
            {!lowStock.length && !blocked.length && <div className="empty-state">Tidak ada batch low stock atau blocked.</div>}
          </div>
        </section>
      </div>
      <SectionHeading title="Quick Actions" />
      <div className="quick-grid">
        <button className="action-card" onClick={() => navigateTo("execution")}><PackageCheck /><strong>Execution Jumbo Roll</strong><span>Buat transaksi produksi baru</span></button>
        <button className="action-card" onClick={() => navigateTo("transactions")}><ClipboardList /><strong>Transaction List</strong><span>Correct, void, dan replacement</span></button>
        <button className="action-card" onClick={() => navigateTo("reports")}><BarChart3 /><strong>Jumbo Roll Report</strong><span>Cari hasil produksi dan material</span></button>
        <button className="action-card" onClick={() => navigateTo("movements")}><History /><strong>Raw Material Movement</strong><span>Lihat ledger konsumsi material</span></button>
      </div>
    </section>
  );
}

function SectionHeading({ title }: { title: string }) {
  return <h3 className="section-heading">{title}</h3>;
}

function LinePerformanceChart({ data, loading }: { data: PerformancePoint[]; loading: boolean }) {
  const [hoveredPoint, setHoveredPoint] = useState<PerformancePoint | null>(null);
  const width = 920;
  const height = 280;
  const padding = { top: 24, right: 28, bottom: 44, left: 42 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...data.flatMap((point) => [point.completed, point.voided, point.net]));
  const x = (index: number) => padding.left + (data.length <= 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);
  const y = (value: number) => padding.top + plotHeight - (value / maxValue) * plotHeight;
  const pathFor = (key: "completed" | "voided" | "net") =>
    data.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${y(point[key]).toFixed(2)}`).join(" ");
  const labelModulo = data.length > 18 ? Math.ceil(data.length / 12) : 1;

  if (loading) {
    return <div className="chart-placeholder"><div className="mini-spinner" /> Loading chart...</div>;
  }
  if (!data.length) {
    return <div className="chart-placeholder">Belum ada data transaksi untuk filter ini.</div>;
  }
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Production performance line chart">
        <line className="chart-axis" x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} />
        <line className="chart-axis" x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} />
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = Math.round(maxValue * ratio);
          const yPos = y(value);
          return (
            <g key={ratio}>
              <line className="chart-grid-line" x1={padding.left} y1={yPos} x2={width - padding.right} y2={yPos} />
              <text className="chart-label" x={padding.left - 8} y={yPos + 4} textAnchor="end">{value}</text>
            </g>
          );
        })}
        <path className="line completed-line" d={pathFor("completed")} />
        <path className="line voided-line" d={pathFor("voided")} />
        <path className="line net-line" d={pathFor("net")} />
        {data.map((point, index) => (
          <g
            key={`${point.label}-${point.bucket}`}
            className="chart-point-group"
            tabIndex={0}
            onMouseEnter={() => setHoveredPoint(point)}
            onMouseLeave={() => setHoveredPoint(null)}
            onFocus={() => setHoveredPoint(point)}
            onBlur={() => setHoveredPoint(null)}
          >
            <rect
              className="chart-hitbox"
              x={x(index) - Math.max(8, plotWidth / Math.max(data.length, 1) / 2)}
              y={padding.top}
              width={Math.max(16, plotWidth / Math.max(data.length, 1))}
              height={plotHeight}
            />
            <circle className="dot completed-dot" cx={x(index)} cy={y(point.completed)} r="3" />
            <circle className="dot voided-dot" cx={x(index)} cy={y(point.voided)} r="3" />
            <circle className="dot net-dot" cx={x(index)} cy={y(point.net)} r="3" />
            {index % labelModulo === 0 && <text className="chart-label" x={x(index)} y={height - 18} textAnchor="middle">{point.label}</text>}
          </g>
        ))}
      </svg>
      {hoveredPoint && (
        <div className="chart-tooltip">
          <strong>{hoveredPoint.label}</strong>
          <span>Completed: {hoveredPoint.completed}</span>
          <span>Voided: {hoveredPoint.voided}</span>
          <span>Net: {hoveredPoint.net}</span>
          <span>Total: {hoveredPoint.total}</span>
        </div>
      )}
      <div className="chart-legend">
        <span><i className="legend-dot completed-dot" /> Completed</span>
        <span><i className="legend-dot voided-dot" /> Voided</span>
        <span><i className="legend-dot net-dot" /> Net</span>
      </div>
    </div>
  );
}

function ExecutionForm(props: {
  form: FormState;
  activeBoms: Bom[];
  validation: string[];
  proWarning: string;
  selectedResourceCode: string;
  operatorName: string;
  rawMaterialBatches: RawMaterialBatch[];
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  applyPro: (proNumber: string) => void;
  changeJumboRoll: (code: string) => void;
  changeBom: (bomCode: string) => void;
  setBatch: (materialCode: string, index: number, patch: Partial<BatchInput>) => void;
  addBatch: (materialCode: string) => void;
  removeBatch: (materialCode: string, index: number) => void;
  openConfirm: () => void;
}) {
  const { processOrders, productionLines, shifts, jumboRollTypes, grades, rawMaterials, resources } = useMasterData();
  const materialName = (code: string) => rawMaterials.find((item) => item.code === code)?.description ?? code;
  const resourceName = (code: string) => resources.find((item) => item.code === code)?.name ?? code;
  const allowedPros = processOrders.filter((pro) => ["released", "in_progress"].includes(pro.status));
  return (
    <div className="form-grid">
      <section className="panel">
        <h3>Header Execution</h3>
        <div className="field-grid">
          <Field label="Process Order (PRO)">
            <select value={props.form.proNumber} onChange={(event) => props.applyPro(event.target.value)}>
              <option value="">Tanpa PRO</option>
              {allowedPros.map((pro) => <option key={pro.proNumber} value={pro.proNumber}>{pro.proNumber} · {pro.status}</option>)}
            </select>
          </Field>
          <Field label="Production Line">
            <select value={props.form.productionLineCode} onChange={(event) => props.setForm((current) => ({ ...current, productionLineCode: event.target.value }))}>
              {productionLines.map((line) => <option key={line.code} value={line.code}>{line.code} · {line.name}</option>)}
            </select>
          </Field>
          <Field label="Resource">
            <input value={`${props.selectedResourceCode} · ${resourceName(props.selectedResourceCode)}`} readOnly />
          </Field>
          <Field label="Shift">
            <select value={props.form.shiftCode} onChange={(event) => props.setForm((current) => ({ ...current, shiftCode: event.target.value }))}>
              {shifts.map((shift) => <option key={shift.code} value={shift.code}>{shift.code} · {shift.name} {shift.startTime}-{shift.endTime}</option>)}
            </select>
          </Field>
          <Field label="Operator">
            <input value={props.operatorName} readOnly />
          </Field>
          <Field label="Tanggal Produksi">
            <div className="inline-control">
              <select value={props.form.dateMode} onChange={(event) => props.setForm((current) => ({ ...current, dateMode: event.target.value as "auto" | "manual" }))}>
                <option value="auto">Otomatis</option>
                <option value="manual">Manual</option>
              </select>
              {props.form.dateMode === "manual" && <input type="datetime-local" value={props.form.manualDateTime} onChange={(event) => props.setForm((current) => ({ ...current, manualDateTime: event.target.value }))} />}
            </div>
          </Field>
        </div>
      </section>

      <section className="panel">
        <h3>Jumbo Roll Result</h3>
        <div className="field-grid">
          <Field label="Tipe Jumbo Roll">
            <select value={props.form.jumboRollCode} onChange={(event) => props.changeJumboRoll(event.target.value)}>
              {jumboRollTypes.filter((item) => item.status === "active").map((item) => <option key={item.code} value={item.code}>{item.code} · {item.description}</option>)}
            </select>
          </Field>
          <Field label="BOM Version">
            <select value={props.form.bomCode} onChange={(event) => props.changeBom(event.target.value)}>
              {props.activeBoms.map((bom) => <option key={bom.bomCode} value={bom.bomCode}>{bom.bomCode}{bom.isDefault ? " · Default" : ""}</option>)}
            </select>
          </Field>
          <Field label="Panjang Aktual (meter)"><input type="number" value={props.form.actualLengthM} onChange={(event) => props.setForm((current) => ({ ...current, actualLengthM: event.target.value }))} /></Field>
          <Field label="Lebar Aktual (mm)"><input type="number" value={props.form.actualWidthMm} onChange={(event) => props.setForm((current) => ({ ...current, actualWidthMm: event.target.value }))} /></Field>
          <Field label="Berat Aktual (KG)"><input type="number" value={props.form.actualWeightKg} onChange={(event) => props.setForm((current) => ({ ...current, actualWeightKg: event.target.value }))} /></Field>
          <Field label="Grade">
            <select value={props.form.gradeCode} onChange={(event) => props.setForm((current) => ({ ...current, gradeCode: event.target.value }))}>
              {grades.filter((grade) => grade.status === "active").map((grade) => <option key={grade.code} value={grade.code}>{grade.code} · {grade.name}</option>)}
            </select>
          </Field>
          <Field label="Notes"><textarea value={props.form.notes} onChange={(event) => props.setForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
        </div>
        {props.form.replacementOfRollNumber && <div className="info-banner">Replacement of {props.form.replacementOfRollNumber}</div>}
      </section>

      <section className="panel full">
        <h3>Raw Material Consumption</h3>
        <div className="material-list">
          {props.form.rawMaterialConsumptions.map((consumption) => (
            <div className="material-row" key={consumption.materialCode}>
              <div>
                <strong>{consumption.materialCode} · {materialName(consumption.materialCode)}</strong>
                <span>Planning {consumption.planningQty} KG · Toleransi {(consumption.planningQty * 0.95).toFixed(2)} - {(consumption.planningQty * 1.1).toFixed(2)} KG</span>
              </div>
              {consumption.batches.map((batch, index) => (
                <div className="batch-grid" key={`${consumption.materialCode}-${index}`}>
                  <select value={batch.batch} onChange={(event) => props.setBatch(consumption.materialCode, index, { batch: event.target.value })}>
                    <option value="">Pilih batch</option>
                    {props.rawMaterialBatches
                      .filter((item) => item.materialCode === consumption.materialCode && item.status === "available")
                      .map((item) => <option key={item.batch} value={item.batch}>{item.batch} · stok {item.availableQty} KG</option>)}
                  </select>
                  <input type="number" value={batch.quantity} onChange={(event) => props.setBatch(consumption.materialCode, index, { quantity: Number(event.target.value) })} />
                  <button className="icon-button" title="Remove batch" onClick={() => props.removeBatch(consumption.materialCode, index)}><Trash2 size={16} /></button>
                </div>
              ))}
              <button className="ghost-button fit" onClick={() => props.addBatch(consumption.materialCode)}>Tambah Batch</button>
            </div>
          ))}
        </div>
      </section>

      {(props.validation.length > 0 || props.proWarning) && (
        <div className="validation-box">
          {props.proWarning && <p className="warning"><AlertTriangle size={16} /> {props.proWarning}</p>}
          {props.validation.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}
      <button className="primary-button submit-button" disabled={props.validation.length > 0} onClick={props.openConfirm}>
        <CheckCircle2 size={18} /> Validate & Confirm
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function ConfirmModal(props: {
  form: FormState;
  validation: string[];
  selectedBom?: Bom;
  selectedResourceCode: string;
  productionDateTime: string;
  proWarning: string;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onClose: () => void;
  onExecute: () => void;
}) {
  const { employees, jumboRollTypes } = useMasterData();
  const jumboName = (code: string) => jumboRollTypes.find((item) => item.code === code)?.description ?? code;
  const employee = getActiveEmployee(employees, props.form.confirmNik);
  return (
    <div className="modal-backdrop">
      <section className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-execution-title">
        <div className="modal-title-row">
          <div>
            <h3 id="confirm-execution-title">Konfirmasi Execution</h3>
            <p>Review hasil produksi dan konsumsi material sebelum transaksi disimpan ke database.</p>
          </div>
        </div>
        <h4 className="modal-section-title">Production Result</h4>
        <div className="summary-grid">
          <span>Line</span><strong>{props.form.productionLineCode}</strong>
          <span>Resource</span><strong>{props.selectedResourceCode}</strong>
          <span>Jumbo Roll</span><strong>{props.form.jumboRollCode} · {jumboName(props.form.jumboRollCode)}</strong>
          <span>BOM</span><strong>{props.selectedBom?.bomCode}</strong>
          <span>Grade</span><strong>{props.form.gradeCode}</strong>
          <span>Production Time</span><strong>{new Date(props.productionDateTime).toLocaleString()}</strong>
        </div>
        <h4 className="modal-section-title">Material Consumption</h4>
        <div className="material-review">
          {props.form.rawMaterialConsumptions.map((item) => {
            const actualQty = item.batches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
            return (
              <div className="material-review-row" key={item.materialCode}>
                <strong>{item.materialCode}</strong>
                <span>Planning {item.planningQty} KG</span>
                <span>Actual {actualQty} KG</span>
                <small>{item.batches.map((batch) => `${batch.batch || "-"}: ${batch.quantity || 0} KG`).join(", ")}</small>
              </div>
            );
          })}
        </div>
        {props.proWarning && <div className="warning-banner"><AlertTriangle size={16} /> {props.proWarning}</div>}
        <Field label="NIK Confirmator">
          <input value={props.form.confirmNik} onChange={(event) => props.setForm((current) => ({ ...current, confirmNik: event.target.value }))} />
        </Field>
        <div className={employee ? "success-banner" : "error-banner"}>
          {employee ? `Employee valid: ${employee.name}` : "Masukkan NIK employee aktif untuk eksekusi."}
        </div>
        <div className="modal-actions">
          <button className="ghost-button" onClick={props.onClose}>Batal</button>
          <button className="primary-button" disabled={props.validation.length > 0 || !employee} onClick={props.onExecute}>Execute</button>
        </div>
      </section>
    </div>
  );
}

function TransactionList(props: {
  transactions: ProductionTransaction[];
  search: string;
  setSearch: (search: string) => void;
  loading: boolean;
  pagination: PaginationState;
  onPageChange: (page: number) => void;
  onVoid: (trx: ProductionTransaction) => void;
  onCorrect: (trx: ProductionTransaction) => void;
  onReplacement: (trx: ProductionTransaction) => void;
}) {
  return (
    <>
      <div className="list-toolbar">
        <div className="search-box search-box-loading">
          <Search size={16} />
          <input
            placeholder="Search roll, batch, PRO, grade, material..."
            value={props.search}
            onChange={(event) => props.setSearch(event.target.value)}
          />
          {props.loading && <span className="mini-spinner search-spinner" aria-label="Loading search" />}
        </div>
        <span className="result-count">{props.pagination.totalRows} transaksi</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Status</th><th>Created</th><th>Roll Number</th><th>Batch</th><th>PRO</th><th>Jumbo Roll</th><th>Output</th><th>Grade</th><th>Revision</th><th>Actions</th></tr></thead>
          <tbody>
            {props.transactions.map((trx) => (
              <tr key={trx.id}>
                <td><span className={`status ${trx.status}`}>{trx.status}</span></td>
                <td>{new Date(trx.createdAt).toLocaleString()}</td>
                <td><strong>{trx.rollNumber}</strong>{trx.replacementOfRollNumber && <small>Replacement of {trx.replacementOfRollNumber}</small>}{trx.replacedByRollNumber && <small>Replaced by {trx.replacedByRollNumber}</small>}</td>
                <td>{trx.jumboBatchNumber}</td>
                <td>{trx.proNumber ?? "-"}</td>
                <td>{trx.jumboRollCode}</td>
                <td>{trx.outputStatus}</td>
                <td>{trx.gradeCode}</td>
                <td>{trx.revision}</td>
                <td className="action-cell">
                  {trx.status === "completed" && <button className="ghost-button" onClick={() => props.onCorrect(trx)}><FilePenLine size={15} /> Correct</button>}
                  {trx.status === "completed" && <button className="ghost-button danger" onClick={() => props.onVoid(trx)}><RotateCcw size={15} /> Void</button>}
                  {trx.status === "voided" && <button className="ghost-button" onClick={() => props.onReplacement(trx)}><PackageCheck size={15} /> Replacement</button>}
                </td>
              </tr>
            ))}
            {!props.transactions.length && <tr><td colSpan={10} className="empty-state">Belum ada transaksi.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mobile-card-list">
        {props.transactions.map((trx) => (
          <article className="mobile-transaction-card" key={trx.id}>
            <header>
              <strong>{trx.rollNumber}</strong>
              <span className={`status ${trx.status}`}>{trx.status}</span>
            </header>
            <div className="summary-grid compact">
              <span>Batch</span><strong>{trx.jumboBatchNumber}</strong>
              <span>Created</span><strong>{new Date(trx.createdAt).toLocaleString()}</strong>
              <span>Jumbo Roll</span><strong>{trx.jumboRollCode}</strong>
              <span>Grade</span><strong>{trx.gradeCode}</strong>
              <span>Revision</span><strong>{trx.revision}</strong>
            </div>
            <div className="action-cell">
              {trx.status === "completed" && <button className="ghost-button" onClick={() => props.onCorrect(trx)}><FilePenLine size={15} /> Correct</button>}
              {trx.status === "completed" && <button className="ghost-button danger" onClick={() => props.onVoid(trx)}><RotateCcw size={15} /> Void</button>}
              {trx.status === "voided" && <button className="ghost-button" onClick={() => props.onReplacement(trx)}><PackageCheck size={15} /> Replacement</button>}
            </div>
          </article>
        ))}
        {!props.transactions.length && <div className="empty-state">Belum ada transaksi.</div>}
      </div>
      <PaginationControls pagination={props.pagination} loading={props.loading} onPageChange={props.onPageChange} />
    </>
  );
}

function PaginationControls(props: {
  pagination: PaginationState;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const { page, totalPages, pageSize, totalRows } = props.pagination;
  const start = totalRows ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, totalRows);
  return (
    <div className="pagination-bar">
      <span>{start}-{end} dari {totalRows}</span>
      <div>
        <button className="ghost-button" disabled={props.loading || page <= 1} onClick={() => props.onPageChange(page - 1)}>Prev</button>
        <strong>Page {page} / {totalPages}</strong>
        <button className="ghost-button" disabled={props.loading || page >= totalPages} onClick={() => props.onPageChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}

function VoidModal(props: {
  target: ProductionTransaction;
  currentUser: User;
  rawMaterialBatches: RawMaterialBatch[];
  apiConnected: boolean;
  setLoadingMessage: (message: string) => void;
  showNotification: (type: "success" | "error", message: string) => void;
  refreshAfterApi: () => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [nik, setNik] = useState("");
  const { employees } = useMasterData();
  const employee = getActiveEmployee(employees, nik);
  const submit = async () => {
    if (props.apiConnected) {
      try {
        props.setLoadingMessage("Memproses void transaction...");
        const response = await fetch(`${API_BASE_URL}/transactions/${props.target.id}/void`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason,
            approvedEmployeeNik: nik,
            voidedByUserId: props.currentUser.id
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.errors?.join("\n") || data.message || "Void gagal.");
        await props.refreshAfterApi();
        props.showNotification("success", `Void berhasil untuk ${data.transaction.rollNumber}.`);
        props.onClose();
        return;
      } catch (error) {
        props.showNotification("error", error instanceof Error ? error.message : "Void gagal.");
        return;
      } finally {
        props.setLoadingMessage("");
      }
    }
    props.showNotification("error", "Void lokal dinonaktifkan. Pastikan API/PostgreSQL connected.");
  };
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="void-title">
        <div className="modal-title-row">
          <div>
            <h3 id="void-title">Void Transaction</h3>
            <p>Nomor roll <strong>{props.target.rollNumber}</strong> akan berstatus voided.</p>
          </div>
        </div>
        <div className="warning-banner strong-warning">
          <AlertTriangle size={18} />
          Void akan membuat stock movement reversal dan mengembalikan quantity raw material ke batch terkait.
        </div>
        <Field label="Reason"><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        <Field label="NIK Approval Void"><input value={nik} onChange={(event) => setNik(event.target.value)} /></Field>
        <div className={employee ? "success-banner" : "error-banner"}>{employee ? `Employee valid: ${employee.name}` : "NIK employee aktif wajib diisi."}</div>
        <div className="modal-actions">
          <button className="ghost-button" onClick={props.onClose}>Batal</button>
          <button className="primary-button danger-solid" disabled={!reason || !employee} onClick={submit}>Void</button>
        </div>
      </section>
    </div>
  );
}

function CorrectionModal(props: {
  target: ProductionTransaction;
  currentUser: User;
  apiConnected: boolean;
  setLoadingMessage: (message: string) => void;
  showNotification: (type: "success" | "error", message: string) => void;
  refreshAfterApi: () => Promise<void>;
  onClose: () => void;
}) {
  const { employees, grades, shifts, processOrders } = useMasterData();
  const [draft, setDraft] = useState({
    productionDateTime: formatDateTimeLocal(new Date(props.target.productionDateTime)),
    shiftCode: props.target.shiftCode,
    actualLengthM: String(props.target.actualLengthM),
    actualWidthMm: String(props.target.actualWidthMm),
    actualWeightKg: String(props.target.actualWeightKg),
    gradeCode: props.target.gradeCode,
    proNumber: props.target.proNumber ?? "",
    notes: props.target.notes ?? "",
    reason: "",
    nik: ""
  });
  const employee = getActiveEmployee(employees, draft.nik);
  const gradeError = validateGrade(grades, draft.gradeCode);
  const canSave = employee && !gradeError && draft.reason;
  const changePreview = [
    { label: "Production Date", before: new Date(props.target.productionDateTime).toLocaleString(), after: new Date(toIsoFromLocalInput(draft.productionDateTime)).toLocaleString() },
    { label: "Shift", before: props.target.shiftCode, after: draft.shiftCode },
    { label: "Panjang", before: `${props.target.actualLengthM} m`, after: `${draft.actualLengthM} m` },
    { label: "Lebar", before: `${props.target.actualWidthMm} mm`, after: `${draft.actualWidthMm} mm` },
    { label: "Berat", before: `${props.target.actualWeightKg} KG`, after: `${draft.actualWeightKg} KG` },
    { label: "Grade", before: props.target.gradeCode, after: draft.gradeCode },
    { label: "PRO", before: props.target.proNumber ?? "-", after: draft.proNumber || "-" }
  ].filter((item) => item.before !== item.after);
  const save = async () => {
    if (props.apiConnected) {
      try {
        props.setLoadingMessage("Menyimpan correction...");
        const response = await fetch(`${API_BASE_URL}/transactions/${props.target.id}/correction`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productionDateTime: toIsoFromLocalInput(draft.productionDateTime),
            shiftCode: draft.shiftCode,
            actualLengthM: Number(draft.actualLengthM),
            actualWidthMm: Number(draft.actualWidthMm),
            actualWeightKg: Number(draft.actualWeightKg),
            gradeCode: draft.gradeCode,
            proNumber: draft.proNumber || undefined,
            notes: draft.notes,
            reason: draft.reason,
            approvedEmployeeNik: draft.nik,
            correctedByUserId: props.currentUser.id
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.errors?.join("\n") || data.message || "Correction gagal.");
        await props.refreshAfterApi();
        props.showNotification("success", `Correction berhasil untuk ${data.transaction.rollNumber}.`);
        props.onClose();
        return;
      } catch (error) {
        props.showNotification("error", error instanceof Error ? error.message : "Correction gagal.");
        return;
      } finally {
        props.setLoadingMessage("");
      }
    }
    props.showNotification("error", "Correction lokal dinonaktifkan. Pastikan API/PostgreSQL connected.");
  };
  return (
    <div className="modal-backdrop">
      <section className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="correction-title">
        <div className="modal-title-row">
          <div>
            <h3 id="correction-title">Correct Transaction</h3>
            <p>Correction mempertahankan nomor roll <strong>{props.target.rollNumber}</strong>. Material, BOM, line, nomor roll, dan batch jumbo roll tidak bisa dikoreksi di sini.</p>
          </div>
        </div>
        <div className="change-preview">
          <strong>Changed Fields</strong>
          {changePreview.length ? changePreview.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <small>{item.before} {"->"} {item.after}</small>
            </div>
          )) : <p>Belum ada perubahan field.</p>}
        </div>
        <div className="field-grid">
          <Field label="Production Date"><input type="datetime-local" value={draft.productionDateTime} onChange={(event) => setDraft({ ...draft, productionDateTime: event.target.value })} /></Field>
          <Field label="Shift"><select value={draft.shiftCode} onChange={(event) => setDraft({ ...draft, shiftCode: event.target.value })}>{shifts.map((shift) => <option key={shift.code} value={shift.code}>{shift.code}</option>)}</select></Field>
          <Field label="Panjang (m)"><input type="number" value={draft.actualLengthM} onChange={(event) => setDraft({ ...draft, actualLengthM: event.target.value })} /></Field>
          <Field label="Lebar (mm)"><input type="number" value={draft.actualWidthMm} onChange={(event) => setDraft({ ...draft, actualWidthMm: event.target.value })} /></Field>
          <Field label="Berat (KG)"><input type="number" value={draft.actualWeightKg} onChange={(event) => setDraft({ ...draft, actualWeightKg: event.target.value })} /></Field>
          <Field label="Grade"><select value={draft.gradeCode} onChange={(event) => setDraft({ ...draft, gradeCode: event.target.value })}>{grades.filter((grade) => grade.status === "active").map((grade) => <option key={grade.code} value={grade.code}>{grade.code}</option>)}</select></Field>
          <Field label="PRO"><select value={draft.proNumber} onChange={(event) => setDraft({ ...draft, proNumber: event.target.value })}><option value="">Tanpa PRO</option>{processOrders.map((pro) => <option key={pro.proNumber} value={pro.proNumber}>{pro.proNumber}</option>)}</select></Field>
          <Field label="Notes"><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field>
        </div>
        <Field label="Correction Reason"><textarea value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></Field>
        <Field label="NIK Approval"><input value={draft.nik} onChange={(event) => setDraft({ ...draft, nik: event.target.value })} /></Field>
        {gradeError && <div className="error-banner">{gradeError}</div>}
        <div className={employee ? "success-banner" : "error-banner"}>{employee ? `Employee valid: ${employee.name}` : "NIK employee aktif wajib diisi."}</div>
        <div className="modal-actions"><button className="ghost-button" onClick={props.onClose}>Batal</button><button className="primary-button" disabled={!canSave} onClick={save}>Save Correction</button></div>
      </section>
    </div>
  );
}

function JumboRollReport(props: {
  transactions: ProductionTransaction[];
  search: string;
  setSearch: (search: string) => void;
  filters: ReportFilters;
  setFilters: (filters: ReportFilters) => void;
  loading: boolean;
  pagination: PaginationState;
  onSearch: () => void;
  onPageChange: (page: number) => void;
}) {
  const { productionLines, grades, rawMaterials, jumboRollTypes } = useMasterData();
  const jumboName = (code: string) => jumboRollTypes.find((item) => item.code === code)?.description ?? code;
  return (
    <>
      <div className="filter-bar">
        <div className="search-box"><Search size={16} /><input placeholder="Global search" value={props.search} onChange={(event) => props.setSearch(event.target.value)} /></div>
        <select value={props.filters.line} onChange={(event) => props.setFilters({ ...props.filters, line: event.target.value })}><option value="">All line</option>{productionLines.map((line) => <option key={line.code} value={line.code}>{line.code}</option>)}</select>
        <select value={props.filters.grade} onChange={(event) => props.setFilters({ ...props.filters, grade: event.target.value })}><option value="">All grade</option>{grades.filter((grade) => grade.status === "active").map((grade) => <option key={grade.code} value={grade.code}>{grade.code}</option>)}</select>
        <select value={props.filters.status} onChange={(event) => props.setFilters({ ...props.filters, status: event.target.value })}><option value="">All status</option><option value="completed">completed</option><option value="voided">voided</option></select>
        <select value={props.filters.rawMaterial} onChange={(event) => props.setFilters({ ...props.filters, rawMaterial: event.target.value })}><option value="">All material</option>{rawMaterials.map((material) => <option key={material.code} value={material.code}>{material.code}</option>)}</select>
        <input type="date" value={props.filters.date} onChange={(event) => props.setFilters({ ...props.filters, date: event.target.value })} />
        <button className="primary-button" disabled={props.loading} onClick={props.onSearch}>{props.loading && <span className="mini-spinner light-spinner" />} Search</button>
        <button className="ghost-button" disabled={props.loading} onClick={() => { props.setSearch(""); props.setFilters({ line: "", grade: "", status: "", rawMaterial: "", date: "" }); }}>Reset</button>
      </div>
      <div className="report-list">
        {props.transactions.map((trx) => (
          <article className="report-item" key={trx.id}>
            <header><strong>{trx.rollNumber}</strong><span className={`status ${trx.status}`}>{trx.status}</span></header>
            <div className="summary-grid compact">
              <span>Batch</span><strong>{trx.jumboBatchNumber}</strong>
              <span>Tipe</span><strong>{trx.jumboRollCode} · {jumboName(trx.jumboRollCode)}</strong>
              <span>Dimensi</span><strong>{trx.actualLengthM} m · {trx.actualWidthMm} mm · {trx.actualWeightKg} KG</strong>
              <span>Grade</span><strong>{trx.gradeCode}</strong>
              <span>Output</span><strong>{trx.outputStatus}</strong>
              <span>PRO</span><strong>{trx.proNumber ?? "-"}</strong>
            </div>
            <div className="material-tags">
              {trx.rawMaterialConsumptions.map((item) => <span key={item.materialCode}>{item.materialCode}: {item.batches.map((batch) => `${batch.batch} ${batch.quantity} KG`).join(", ")}</span>)}
            </div>
          </article>
        ))}
        {!props.transactions.length && <div className="empty-state">Tidak ada data report sesuai filter.</div>}
      </div>
      <PaginationControls pagination={props.pagination} loading={props.loading} onPageChange={props.onPageChange} />
    </>
  );
}

function MovementReport(props: {
  movements: StockMovement[];
  filters: MovementFilters;
  setFilters: (filters: MovementFilters) => void;
  loading: boolean;
  pagination: PaginationState;
  onSearch: () => void;
  onPageChange: (page: number) => void;
  onBack: () => void;
}) {
  const { rawMaterials } = useMasterData();
  return (
    <section>
      <PageTitle title="Raw Material Movement" subtitle="Ledger mutasi stok material dari consumption dan void reversal." onBack={props.onBack} />
      <div className="filter-bar movement-filter-bar">
        <select value={props.filters.movementType} onChange={(event) => props.setFilters({ ...props.filters, movementType: event.target.value })}>
          <option value="">All movement</option>
          <option value="production_consumption">production_consumption</option>
          <option value="void_reversal">void_reversal</option>
          <option value="stock_receipt">stock_receipt</option>
          <option value="stock_adjustment">stock_adjustment</option>
        </select>
        <select value={props.filters.materialCode} onChange={(event) => props.setFilters({ ...props.filters, materialCode: event.target.value })}>
          <option value="">All material</option>
          {rawMaterials.map((material) => <option key={material.code} value={material.code}>{material.code}</option>)}
        </select>
        <input placeholder="Batch material" value={props.filters.materialBatch} onChange={(event) => props.setFilters({ ...props.filters, materialBatch: event.target.value })} />
        <input placeholder="Roll number" value={props.filters.rollNumber} onChange={(event) => props.setFilters({ ...props.filters, rollNumber: event.target.value })} />
        <input type="date" value={props.filters.date} onChange={(event) => props.setFilters({ ...props.filters, date: event.target.value })} />
        <button className="primary-button" disabled={props.loading} onClick={props.onSearch}>{props.loading && <span className="mini-spinner light-spinner" />} Search</button>
        <button className="ghost-button" disabled={props.loading} onClick={() => props.setFilters({ movementType: "", materialCode: "", materialBatch: "", rollNumber: "", date: "" })}>Reset</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Type</th><th>Material</th><th>Batch</th><th>Qty</th><th>Before</th><th>After</th><th>Reference</th></tr></thead>
          <tbody>
            {props.movements.map((movement) => (
              <tr key={movement.id}>
                <td>{new Date(movement.createdAt).toLocaleString()}</td>
                <td>{movement.movementType}</td>
                <td>{movement.materialCode}</td>
                <td>{movement.materialBatch}</td>
                <td className={movement.quantity < 0 ? "qty-out" : "qty-in"}>{movement.quantity} KG</td>
                <td>{movement.beforeQty}</td>
                <td>{movement.afterQty}</td>
                <td>{movement.referenceRollNumber}</td>
              </tr>
            ))}
            {!props.movements.length && <tr><td colSpan={8} className="empty-state">Belum ada stock movement.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mobile-card-list">
        {props.movements.map((movement) => (
          <article className="mobile-transaction-card" key={movement.id}>
            <header>
              <strong>{movement.materialCode}</strong>
              <span className={movement.quantity < 0 ? "qty-out" : "qty-in"}>{movement.quantity} KG</span>
            </header>
            <div className="summary-grid compact">
              <span>Time</span><strong>{new Date(movement.createdAt).toLocaleString()}</strong>
              <span>Type</span><strong>{movement.movementType}</strong>
              <span>Batch</span><strong>{movement.materialBatch}</strong>
              <span>Reference</span><strong>{movement.referenceRollNumber ?? "-"}</strong>
            </div>
          </article>
        ))}
        {!props.movements.length && <div className="empty-state">Belum ada stock movement.</div>}
      </div>
      <PaginationControls pagination={props.pagination} loading={props.loading} onPageChange={props.onPageChange} />
    </section>
  );
}

function ActivityLogReport(props: {
  logs: ActivityLog[];
  filters: ActivityFilters;
  setFilters: (filters: ActivityFilters) => void;
  loading: boolean;
  pagination: PaginationState;
  onSearch: () => void;
  onPageChange: (page: number) => void;
  onBack: () => void;
}) {
  return (
    <section>
      <PageTitle title="Activity Log" subtitle="Audit aktivitas web dari login, buka menu, transaksi, correction, dan void." onBack={props.onBack} />
      <div className="filter-bar activity-filter-bar">
        <div className="search-box">
          <Search size={16} />
          <input placeholder="Search user, event, action, entity, message" value={props.filters.search} onChange={(event) => props.setFilters({ ...props.filters, search: event.target.value })} />
        </div>
        <select value={props.filters.eventType} onChange={(event) => props.setFilters({ ...props.filters, eventType: event.target.value })}>
          <option value="">All event</option>
          <option value="LOGIN_SUCCESS">LOGIN_SUCCESS</option>
          <option value="LOGIN_FAILED">LOGIN_FAILED</option>
          <option value="LOGOUT">LOGOUT</option>
          <option value="OPEN_PAGE">OPEN_PAGE</option>
          <option value="EXECUTE_TRANSACTION_SUCCESS">EXECUTE_TRANSACTION_SUCCESS</option>
          <option value="EXECUTE_TRANSACTION_FAILED">EXECUTE_TRANSACTION_FAILED</option>
          <option value="CORRECT_TRANSACTION_SUCCESS">CORRECT_TRANSACTION_SUCCESS</option>
          <option value="CORRECT_TRANSACTION_FAILED">CORRECT_TRANSACTION_FAILED</option>
          <option value="VOID_TRANSACTION_SUCCESS">VOID_TRANSACTION_SUCCESS</option>
          <option value="VOID_TRANSACTION_FAILED">VOID_TRANSACTION_FAILED</option>
        </select>
        <select value={props.filters.status} onChange={(event) => props.setFilters({ ...props.filters, status: event.target.value })}>
          <option value="">All status</option>
          <option value="success">success</option>
          <option value="failed">failed</option>
          <option value="info">info</option>
        </select>
        <input type="date" value={props.filters.date} onChange={(event) => props.setFilters({ ...props.filters, date: event.target.value })} />
        <button className="primary-button" disabled={props.loading} onClick={props.onSearch}>{props.loading && <span className="mini-spinner light-spinner" />} Search</button>
        <button className="ghost-button" disabled={props.loading} onClick={() => props.setFilters({ search: "", eventType: "", status: "", date: "" })}>Reset</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Status</th><th>Event</th><th>User</th><th>Page</th><th>Entity</th><th>Message</th></tr></thead>
          <tbody>
            {props.logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.createdAt).toLocaleString()}</td>
                <td><span className={`status ${log.status}`}>{log.status}</span></td>
                <td><strong>{log.eventType}</strong><small>{log.action}</small></td>
                <td>{log.userId ?? "-"}<small>{log.employeeNik ?? ""} {log.role ? `· ${log.role}` : ""}</small></td>
                <td>{log.page ?? "-"}</td>
                <td>{log.entityType ?? "-"}<small>{log.entityId ?? ""}</small></td>
                <td>{log.message ?? "-"}</td>
              </tr>
            ))}
            {!props.logs.length && <tr><td colSpan={7} className="empty-state">Belum ada activity log sesuai filter.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mobile-card-list">
        {props.logs.map((log) => (
          <article className="mobile-transaction-card" key={log.id}>
            <header>
              <strong>{log.eventType}</strong>
              <span className={`status ${log.status}`}>{log.status}</span>
            </header>
            <div className="summary-grid compact">
              <span>Time</span><strong>{new Date(log.createdAt).toLocaleString()}</strong>
              <span>User</span><strong>{log.userId ?? "-"} {log.employeeNik ? `· ${log.employeeNik}` : ""}</strong>
              <span>Page</span><strong>{log.page ?? "-"}</strong>
              <span>Entity</span><strong>{log.entityId ?? "-"}</strong>
              <span>Message</span><strong>{log.message ?? "-"}</strong>
            </div>
          </article>
        ))}
        {!props.logs.length && <div className="empty-state">Belum ada activity log sesuai filter.</div>}
      </div>
      <PaginationControls pagination={props.pagination} loading={props.loading} onPageChange={props.onPageChange} />
    </section>
  );
}

function MasterDataPreview({ rawMaterialBatches, transactions, onBack }: { rawMaterialBatches: RawMaterialBatch[]; transactions: ProductionTransaction[]; onBack: () => void }) {
  const { productionLines, jumboRollTypes, boms, grades, processOrders } = useMasterData();
  return (
    <section>
      <PageTitle title="Master Data" subtitle="Preview dummy data untuk validasi prototype." onBack={onBack} />
      <div className="master-grid">
        <MasterBlock title="Production Line" rows={productionLines.map((line) => `${line.code} · ${line.name} · ${line.resourceCode}`)} />
        <MasterBlock title="Jumbo Roll Type" rows={jumboRollTypes.map((item) => `${item.code} · ${item.description} · ${item.status}`)} />
        <MasterBlock title="Active BOM" rows={boms.filter((bom) => bom.status === "active").map((bom) => `${bom.bomCode} · ${bom.jumboRollCode} · ${bom.isDefault ? "default" : "alternative"}`)} />
        <MasterBlock title="Grade" rows={grades.map((grade) => `${grade.code} · ${grade.name} · ${grade.status}`)} />
        <MasterBlock title="Raw Material Batch" rows={rawMaterialBatches.map((batch) => `${batch.batch} · ${batch.materialCode} · ${batch.availableQty} KG · ${batch.status}`)} />
        <MasterBlock title="PRO Progress" rows={processOrders.map((pro) => {
          const progress = calculateProProgress(transactions, pro.proNumber);
          return `${pro.proNumber} · ${pro.status} · good ${progress.goodQty}/${pro.plannedGoodQty} ROLL · reject ${progress.rejectQty}`;
        })} />
      </div>
    </section>
  );
}

function MasterBlock({ title, rows }: { title: string; rows: string[] }) {
  return <div className="panel"><h3>{title}</h3><ul className="plain-list">{rows.map((row) => <li key={row}>{row}</li>)}</ul></div>;
}
