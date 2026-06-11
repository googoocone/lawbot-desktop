import { useState, useRef, useEffect } from "react";
import {
  FilePlus, ArrowLeft, Loader2, Upload, Download, FileSpreadsheet,
  CheckCircle2, XCircle, MapPin, ChevronDown, Check, Search, ChevronRight, FolderOpen,
} from "lucide-react";
import { createCase, bulkCreateCases, getFirmMembers } from "@/lib/actions/local";
import { crawlSingleCase, crawlCases } from "@/lib/crawler";
import { COURT_REGIONS, COURT_MAPPING } from "@/lib/caseflow/constants/court-mapping";
import type { CaseType } from "@/lib/caseflow/types";

interface Props {
  onBack: () => void;
  onCreated: () => void; // 등록 후 부모 reload
}

// 지역명 또는 법원명 → 지역명 정규화
function normalizeCourtRegion(input: string): string {
  const trimmed = input.trim();
  if (COURT_MAPPING[trimmed]) return trimmed;
  const entry = Object.entries(COURT_MAPPING).find(([, courtName]) => courtName === trimmed);
  if (entry) return entry[0];
  const partial = Object.entries(COURT_MAPPING).find(
    ([region, courtName]) => trimmed.includes(region) || courtName.includes(trimmed),
  );
  if (partial) return partial[0];
  return trimmed;
}

function normalizeCaseType(input: string): string {
  const v = input.replace(/\s+/g, "");
  if (["회", "회생", "개인회생"].includes(v)) return "회";
  if (["파", "파산", "개인파산"].includes(v)) return "파";
  return v;
}

function CourtSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) inputRef.current.focus();
  }, [isOpen]);

  const courtName = value ? COURT_MAPPING[value] : null;
  const filtered = COURT_REGIONS.filter(
    (r) => r.includes(search) || COURT_MAPPING[r].includes(search),
  );

  return (
    <div className="space-y-1.5 relative" ref={ref}>
      <label className="block text-sm font-semibold text-slate-700">
        법원명(지역) <span className="text-red-500">*</span>
      </label>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center gap-2 px-3 py-2.5 bg-white border rounded-xl text-left transition-all ${
          isOpen ? "border-blue-400 ring-2 ring-blue-500/30" : "border-gray-200 hover:border-gray-300"
        }`}
      >
        <MapPin className={`w-4 h-4 shrink-0 ${value ? "text-blue-500" : "text-gray-400"}`} />
        <span className={`flex-1 text-sm ${value ? "text-gray-900" : "text-gray-400"}`}>
          {value || "지역을 선택해주세요"}
        </span>
        {courtName && (
          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-lg text-[11px] font-medium shrink-0">
            {courtName}
          </span>
        )}
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="지역 또는 법원명 검색..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-300"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.map((region) => (
              <button
                key={region}
                type="button"
                onClick={() => { onChange(region); setIsOpen(false); setSearch(""); }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all ${
                  value === region ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span className="flex items-center gap-2">
                  <MapPin className={`w-3.5 h-3.5 ${value === region ? "text-blue-500" : "text-gray-300"}`} />
                  {region}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] text-gray-400">{COURT_MAPPING[region]}</span>
                  {value === region && <Check className="w-3.5 h-3.5 text-blue-500" />}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-4">검색 결과가 없습니다</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface BulkRow {
  seq_number?: number;
  case_type?: string;
  court_region: string;
  case_number: string;
  applicant_name: string;
  applicant_spouse?: string;
  counselor_name?: string;
  staff_name?: string;
  judge_info?: string;
  applicant_ssn?: string;
  applicant_phone?: string;
  income_type?: string;
  fee?: number;
  notes?: string;
  status: "pending" | "success" | "error";
  message?: string;
  assigned_to?: string;
  assign_match?: "matched" | "unmatched" | "empty";
}

interface FirmMember {
  id: string;
  name: string | null;
  role: string | null;
}

const CSV_HEADER_MAP: Record<string, keyof BulkRow> = {
  "번호": "seq_number",
  "구분": "case_type",
  "신청인": "applicant_name",
  "이름": "applicant_name",
  "배우자": "applicant_spouse",
  "상담": "counselor_name",
  "서류": "staff_name",
  "담당자": "staff_name",
  "법원": "court_region",
  "진행상황": "case_number",
  "사건번호": "case_number",
  "재판부": "judge_info",
  "재판부/위원": "judge_info",
  "주민번호": "applicant_ssn",
  "연락처": "applicant_phone",
  "소득구분": "income_type",
  "수임료": "fee",
  "기타": "notes",
};

export function RegisterPage({ onBack, onCreated }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"single" | "bulk">("single");

  // 단건
  const [courtRegion, setCourtRegion] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [caseType, setCaseType] = useState<"" | CaseType>("");
  const [applicantSpouse, setApplicantSpouse] = useState("");
  const [applicantSsn, setApplicantSsn] = useState("");
  const [applicantPhone, setApplicantPhone] = useState("");
  const [counselorName, setCounselorName] = useState("");
  const [staffName, setStaffName] = useState("");
  const [judgeInfo, setJudgeInfo] = useState("");
  const [incomeType, setIncomeType] = useState("");
  const [fee, setFee] = useState("");
  const [docReceivedAt, setDocReceivedAt] = useState("");
  const [distributionDate, setDistributionDate] = useState("");
  const [creditorMeeting, setCreditorMeeting] = useState("");
  const [notes, setNotes] = useState("");

  // 엑셀
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [templateDownloaded, setTemplateDownloaded] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkDone, setBulkDone] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [firmMembers, setFirmMembers] = useState<FirmMember[]>([]);
  const [canDistribute, setCanDistribute] = useState(false);

  useEffect(() => {
    getFirmMembers().then((res) => {
      setFirmMembers(res.data);
      setCanDistribute(res.canDistribute);
    }).catch(() => {});
  }, []);

  const matchStaff = (name: string | undefined): { id?: string; match: "matched" | "unmatched" | "empty" } => {
    if (!name || !name.trim()) return { match: "empty" };
    const trimmed = name.trim();
    const found = firmMembers.find((m) => m.name === trimmed);
    if (found) return { id: found.id, match: "matched" };
    return { match: "unmatched" };
  };

  const applyStaffMatching = (rows: BulkRow[]): BulkRow[] => {
    if (!canDistribute) return rows;
    return rows.map((r) => {
      const { id, match } = matchStaff(r.staff_name);
      return { ...r, assigned_to: id, assign_match: match };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courtRegion || !applicantName) {
      setError("법원명과 이름은 필수입니다.");
      return;
    }
    setError("");
    setLoading(true);
    const feeNum = fee.trim() ? parseFloat(fee.replace(/,/g, "")) : undefined;
    const res = await createCase({
      court_region: courtRegion,
      case_number: caseNumber || undefined,
      applicant_name: applicantName,
      case_type: caseType || undefined,
      applicant_spouse: applicantSpouse || undefined,
      applicant_ssn: applicantSsn || undefined,
      applicant_phone: applicantPhone || undefined,
      counselor_name: counselorName || undefined,
      staff_name: staffName || undefined,
      judge_info: judgeInfo || undefined,
      income_type: incomeType || undefined,
      fee: !isNaN(feeNum as number) ? feeNum : undefined,
      doc_received_at: docReceivedAt || undefined,
      distribution_date: distributionDate || undefined,
      creditor_meeting: creditorMeeting || undefined,
      notes: notes || undefined,
    });
    setLoading(false);
    if (res.error) { setError(res.error); return; }

    // 사건번호 있으면 백그라운드로 크롤링 트리거 (fire-and-forget)
    if (res.id && caseNumber.trim()) {
      crawlSingleCase(res.id).then((r) => {
        if (!r.ok) console.warn("[crawl] single failed:", r.stderr);
      }).catch((e) => console.error("[crawl] error:", e));
    }

    onCreated();
    onBack();
  };

  const downloadTemplate = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("사건등록");
    const headers = [
      { name: "번호", required: false },
      { name: "법원", required: true },
      { name: "사건번호", required: true },
      { name: "신청인", required: true },
      { name: "배우자", required: false },
      { name: "상담", required: false },
      { name: "담당자", required: false },
      { name: "재판부/위원", required: false },
      { name: "주민번호", required: false },
      { name: "연락처", required: false },
      { name: "소득구분", required: false },
      { name: "수임료", required: false },
      { name: "기타", required: false },
    ];
    const headerRow = ws.addRow(headers.map((h) => (h.required ? `${h.name}*` : h.name)));
    headerRow.eachCell((cell, colNum) => {
      const isRequired = headers[colNum - 1].required;
      cell.fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: isRequired ? "FFFF6B6B" : "FFFFEC99" },
      };
      cell.font = { bold: true, size: 11 };
      cell.alignment = { horizontal: "center" };
      cell.border = { bottom: { style: "thin", color: { argb: "FFD0D0D0" } } };
    });
    headerRow.getCell(1).note =
      "빨간색 제목 = 필수 입력\n노란색 제목 = 선택 입력\n\n사건 유형(개인회생/개인파산)은 등록 후 크롤링이 자동 판별하므로 입력하지 않습니다.";
    ws.addRow([1, "서울", "2025개회12345", "홍길동", "미혼", "박지현", "김채린", "352 권근일", "900101-1234567", "010-1234-5678", "급여", 300, ""]);
    ws.addRow([2, "부산", "2025하단67890", "김철수", "", "박지현", "", "", "", "", "", "", ""]);
    ws.addRow([3, "수원", "2025개회54321", "이영희", "", "", "", "", "", "", "", "", "빨간색 제목은 필수, 노란색은 선택 입력"]);
    ws.columns.forEach((col) => { col.width = 16; });
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "사건등록_양식.xlsx";
    a.click();
    URL.revokeObjectURL(url);
    setTemplateDownloaded(true);
  };

  const openDownloadsFolder = async () => {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    const { downloadDir } = await import("@tauri-apps/api/path");
    await openPath(await downloadDir());
  };

  const processFile = async (file: File) => {
    setError("");
    setBulkDone(false);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();

      if (file.name.endsWith(".csv")) {
        const text = await file.text();
        const lines = text.split("\n").filter((l) => l.trim());
        if (lines.length < 2) { setError("데이터가 없습니다."); return; }
        const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").replace(/\*$/, "").replace(/\(선택\)$/, "").trim());
        const colMap: Record<number, keyof BulkRow> = {};
        headers.forEach((h, i) => {
          const cleaned = h.replace(/[\r\n]+/g, "");
          const mapped = CSV_HEADER_MAP[cleaned] || CSV_HEADER_MAP[h];
          if (mapped) colMap[i] = mapped;
        });
        const rows: BulkRow[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
          const nameIdx = Object.entries(colMap).find(([, v]) => v === "applicant_name")?.[0];
          const name = nameIdx !== undefined ? cols[Number(nameIdx)] : cols[2];
          if (!name) continue;
          const row: BulkRow = { court_region: "", case_number: "", applicant_name: "", status: "pending" };
          Object.entries(colMap).forEach(([idx, field]) => {
            const val = cols[Number(idx)]?.trim();
            if (!val) return;
            if (field === "court_region") row.court_region = normalizeCourtRegion(val);
            else if (field === "case_type") row.case_type = normalizeCaseType(val);
            else if (field === "fee") { const n = parseFloat(val); if (!isNaN(n)) row.fee = n; }
            else if (field === "seq_number") { const n = parseInt(val); if (!isNaN(n)) row.seq_number = n; }
            else (row as unknown as Record<string, unknown>)[field] = val;
          });
          rows.push(row);
        }
        setBulkRows(applyStaffMatching(rows));
      } else {
        const buffer = await file.arrayBuffer();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.worksheets[0];
        if (!sheet) { setError("시트를 찾을 수 없습니다."); return; }
        const xlColMap: Record<number, keyof BulkRow> = {};
        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell, colNum) => {
          const h = String(cell.value || "").replace(/[\r\n]+/g, "").replace(/\*$/, "").replace(/\(선택\)$/, "").trim();
          const mapped = CSV_HEADER_MAP[h];
          if (mapped) xlColMap[colNum] = mapped;
        });
        const rows: BulkRow[] = [];
        sheet.eachRow((row, rowNum) => {
          if (rowNum === 1) return;
          const bulkRow: BulkRow = { court_region: "", case_number: "", applicant_name: "", status: "pending" };
          Object.entries(xlColMap).forEach(([colStr, field]) => {
            const val = String(row.getCell(Number(colStr)).value || "").trim();
            if (!val) return;
            if (field === "court_region") bulkRow.court_region = normalizeCourtRegion(val);
            else if (field === "case_type") bulkRow.case_type = normalizeCaseType(val);
            else if (field === "fee") { const n = parseFloat(val); if (!isNaN(n)) bulkRow.fee = n; }
            else if (field === "seq_number") { const n = parseInt(val); if (!isNaN(n)) bulkRow.seq_number = n; }
            else (bulkRow as unknown as Record<string, unknown>)[field] = val;
          });
          if (bulkRow.applicant_name) rows.push(bulkRow);
        });
        setBulkRows(applyStaffMatching(rows));
      }
    } catch {
      setError("파일을 읽을 수 없습니다. CSV 또는 Excel 파일을 업로드하세요.");
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  };

  const handleBulkRegister = async () => {
    setBulkLoading(true);
    setError("");
    const inputs = bulkRows.map((row) => ({
      court_region: row.court_region,
      case_number: row.case_number || undefined,
      case_type: (row.case_type as CaseType) || undefined,
      seq_number: row.seq_number,
      applicant_name: row.applicant_name,
      applicant_spouse: row.applicant_spouse,
      applicant_ssn: row.applicant_ssn,
      applicant_phone: row.applicant_phone,
      counselor_name: row.counselor_name,
      staff_name: row.staff_name,
      judge_info: row.judge_info,
      income_type: row.income_type,
      fee: row.fee,
      notes: row.notes,
      assigned_to: row.assigned_to,
    }));
    const CHUNK = 50;
    let totalSuccess = 0;
    let totalFailed = 0;
    const allCrawlIds: string[] = [];
    for (let i = 0; i < inputs.length; i += CHUNK) {
      const batch = inputs.slice(i, i + CHUNK);
      const res = await bulkCreateCases(batch);
      if (res.error) totalFailed += batch.length - (res.count ?? 0);
      totalSuccess += res.count ?? 0;
      // 사건번호 있는 것만 크롤 대상으로 수집
      for (const c of res.createdIds ?? []) {
        if (c.hasNumber) allCrawlIds.push(c.id);
      }
      // 각 행 상태 업데이트
      setBulkRows((prev) => prev.map((r, idx) => {
        if (idx < i) return r;
        if (idx >= i + batch.length) return r;
        const succeeded = !res.error || (res.count ?? 0) > 0;
        return { ...r, status: succeeded ? "success" : "error", message: res.error };
      }));
    }
    setBulkLoading(false);
    setBulkDone(true);
    if (totalFailed > 0) setError(`${totalFailed}건 실패`);
    if (totalSuccess > 0) onCreated();

    // 백그라운드 크롤 — 사건번호 있는 건만
    if (allCrawlIds.length > 0) {
      crawlCases(allCrawlIds).then((r) => {
        if (!r.ok) console.warn("[crawl] bulk failed:", r.stderr);
      }).catch((e) => console.error("[crawl] error:", e));
    }
  };

  const successCount = bulkRows.filter((r) => r.status === "success").length;
  const errorCount = bulkRows.filter((r) => r.status === "error").length;

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto w-full">
      <div className="mb-8">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-all mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          뒤로
        </button>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center">
          <FilePlus className="w-6 h-6 mr-3 text-blue-600" />
          사건 등록
        </h1>
        <p className="text-slate-500 mt-1">새로운 사건을 등록합니다.</p>
      </div>

      <div className="flex gap-3 mb-5">
        <button
          onClick={() => setMode("single")}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold transition-all border ${
            mode === "single"
              ? "bg-blue-50 text-blue-700 border-blue-200 shadow-sm"
              : "bg-white text-slate-400 border-slate-200 hover:border-blue-200 hover:text-blue-600"
          }`}
        >
          <FilePlus className="w-4 h-4" />
          개별 등록
        </button>
        <button
          onClick={() => setMode("bulk")}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold transition-all border ${
            mode === "bulk"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm"
              : "bg-white text-slate-400 border-slate-200 hover:border-emerald-200 hover:text-emerald-600"
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          엑셀 일괄 등록
        </button>
      </div>

      {mode === "single" && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
          <CourtSelect value={courtRegion} onChange={setCourtRegion} />

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">사건번호</label>
            <input
              type="text"
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
              placeholder="예: 2024개회1234"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              신청인 이름 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={applicantName}
              onChange={(e) => setApplicantName(e.target.value)}
              placeholder="이름을 입력하세요"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
            />
          </div>

          <div className="border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setShowOptional(!showOptional)}
              className="w-full flex items-center justify-between text-sm font-semibold text-slate-600 hover:text-blue-600 transition-colors"
            >
              <span className="flex items-center gap-2">
                <ChevronRight className={`w-4 h-4 transition-transform ${showOptional ? "rotate-90" : ""}`} />
                추가 정보 입력
              </span>
              <span className="text-xs text-slate-400 font-normal">{showOptional ? "접기" : "선택사항"}</span>
            </button>
            {showOptional && (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">구분</label>
                    <select
                      value={caseType}
                      onChange={(e) => setCaseType(e.target.value as typeof caseType)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                    >
                      <option value="">선택</option>
                      <option value="회">회 (개인회생)</option>
                      <option value="파">파 (개인파산)</option>
                      <option value="항">항 (항고)</option>
                      <option value="일회">일회 (일반회생)</option>
                      <option value="일">일 (일반)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">배우자</label>
                    <input
                      type="text"
                      value={applicantSpouse}
                      onChange={(e) => setApplicantSpouse(e.target.value)}
                      placeholder="배우자 이름"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">주민번호</label>
                    <input
                      type="text"
                      value={applicantSsn}
                      onChange={(e) => setApplicantSsn(e.target.value)}
                      placeholder="000000-0000000"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">연락처</label>
                    <input
                      type="text"
                      value={applicantPhone}
                      onChange={(e) => setApplicantPhone(e.target.value)}
                      placeholder="010-0000-0000"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">상담자</label>
                    <input
                      type="text"
                      value={counselorName}
                      onChange={(e) => setCounselorName(e.target.value)}
                      placeholder="상담자명"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">담당자</label>
                    <input
                      type="text"
                      value={staffName}
                      onChange={(e) => setStaffName(e.target.value)}
                      placeholder="담당자명"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">재판부 / 위원</label>
                  <input
                    type="text"
                    value={judgeInfo}
                    onChange={(e) => setJudgeInfo(e.target.value)}
                    placeholder="예: 제333단독 김동영"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">소득구분</label>
                    <input
                      type="text"
                      value={incomeType}
                      onChange={(e) => setIncomeType(e.target.value)}
                      placeholder="예: 급여, 사업, 영업"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">수임료 (만원)</label>
                    <input
                      type="text"
                      value={fee}
                      onChange={(e) => setFee(e.target.value)}
                      placeholder="예: 300"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">서류수신일</label>
                    <input
                      type="date"
                      value={docReceivedAt}
                      onChange={(e) => setDocReceivedAt(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">배당일</label>
                    <input
                      type="date"
                      value={distributionDate}
                      onChange={(e) => setDistributionDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">채권자집회</label>
                  <input
                    type="text"
                    value={creditorMeeting}
                    onChange={(e) => setCreditorMeeting(e.target.value)}
                    placeholder="예: 2026-04-15 또는 자유 텍스트"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">메모</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="추가 메모를 입력하세요"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-100 hover:bg-blue-200 disabled:bg-gray-100 text-blue-700 font-bold py-3 rounded-xl transition-all"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus className="w-4 h-4" />}
            {loading ? "등록 중..." : "사건 등록"}
          </button>
        </form>
      )}

      {mode === "bulk" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between gap-3 bg-emerald-50 rounded-xl p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-800">엑셀 양식 다운로드</p>
              <p className="text-xs text-emerald-600 mt-0.5">양식을 받아 작성한 뒤 아래에 업로드하세요</p>
              {templateDownloaded && (
                <p className="flex items-center gap-1 text-xs text-emerald-700 mt-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  다운로드 폴더에 저장됨 (사건등록_양식.xlsx)
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {templateDownloaded && (
                <button
                  onClick={openDownloadsFolder}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-700 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
                >
                  <FolderOpen className="w-4 h-4" />
                  폴더 열기
                </button>
              )}
              <button
                onClick={downloadTemplate}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                Excel 양식 받기
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            <span className="w-3.5 h-3.5 rounded-sm bg-[#FF6B6B]" />
            <span>빨간색은 <b>필수</b></span>
            <span className="w-3.5 h-3.5 rounded-sm bg-[#FFEC99] ml-3" />
            <span>노란색은 <b>선택</b></span>
          </div>

          {bulkRows.length === 0 && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragOver ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileSelect}
              />
              <Upload className="w-8 h-8 mx-auto text-slate-300 mb-3" />
              <p className="text-sm text-slate-500">엑셀 파일을 드래그하거나 클릭하여 업로드</p>
              <p className="text-xs text-slate-400 mt-1">CSV, XLSX 지원</p>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          {bulkRows.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">
                  {bulkRows.length}건 확인됨
                  {bulkDone && (
                    <span className="ml-2 text-xs font-normal">
                      (<span className="text-emerald-600">{successCount}건 성공</span>
                      {errorCount > 0 && <span className="text-red-500 ml-1">{errorCount}건 실패</span>})
                    </span>
                  )}
                </p>
                {!bulkDone && (
                  <button
                    onClick={() => { setBulkRows([]); setError(""); }}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    다시 선택
                  </button>
                )}
              </div>

              {canDistribute && bulkRows.some((r) => r.assign_match === "unmatched") && !bulkDone && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                  ⚠ 담당자 이름이 일치하지 않는 건이 있습니다. 아래 드롭다운에서 직접 선택해주세요.
                </div>
              )}

              <div className="overflow-auto max-h-[400px] border border-slate-100 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-500 sticky top-0">
                      <th className="py-2 px-3 text-left">#</th>
                      <th className="py-2 px-3 text-left">법원명</th>
                      <th className="py-2 px-3 text-left">사건번호</th>
                      <th className="py-2 px-3 text-left">이름</th>
                      {canDistribute && <th className="py-2 px-3 text-left">담당자</th>}
                      <th className="py-2 px-3 text-center">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map((row, i) => (
                      <tr key={i} className="border-t border-slate-50">
                        <td className="py-2 px-3 text-slate-400">{i + 1}</td>
                        <td className="py-2 px-3">{row.court_region}</td>
                        <td className="py-2 px-3 font-mono text-xs">{row.case_number || "-"}</td>
                        <td className="py-2 px-3">{row.applicant_name}</td>
                        {canDistribute && (
                          <td className="py-2 px-3">
                            {bulkDone ? (
                              <span className="text-xs text-slate-600">{row.staff_name || "-"}</span>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                {row.assign_match === "matched" && <span className="text-emerald-500 text-xs">✓</span>}
                                {row.assign_match === "unmatched" && (
                                  <span className="text-amber-500 text-xs" title={`"${row.staff_name}" 미매칭`}>⚠</span>
                                )}
                                <select
                                  value={row.assigned_to || ""}
                                  onChange={(e) => {
                                    const id = e.target.value;
                                    const member = firmMembers.find((m) => m.id === id);
                                    setBulkRows((prev) => prev.map((r, idx) => idx === i
                                      ? {
                                          ...r,
                                          assigned_to: id || undefined,
                                          staff_name: member?.name || r.staff_name,
                                          assign_match: id ? "matched" : "empty",
                                        }
                                      : r,
                                    ));
                                  }}
                                  className={`text-xs border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                                    row.assign_match === "unmatched" ? "border-amber-300 bg-amber-50"
                                      : row.assign_match === "matched" ? "border-emerald-200 bg-emerald-50"
                                        : "border-gray-200"
                                  }`}
                                >
                                  <option value="">미지정 (본인)</option>
                                  {firmMembers.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name}{m.role === "firm_admin" ? " (관리자)" : ""}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </td>
                        )}
                        <td className="py-2 px-3 text-center">
                          {row.status === "pending" && <span className="text-slate-400">-</span>}
                          {row.status === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />}
                          {row.status === "error" && (
                            <span className="flex items-center justify-center gap-1">
                              <XCircle className="w-4 h-4 text-red-500" />
                              <span className="text-xs text-red-500">{row.message}</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!bulkDone ? (
                <button
                  onClick={handleBulkRegister}
                  disabled={bulkLoading}
                  className={`w-full flex items-center justify-center gap-2 font-bold py-3 rounded-xl transition-all ${
                    bulkLoading
                      ? "bg-emerald-600 text-white"
                      : "bg-blue-100 hover:bg-blue-200 text-blue-700"
                  } disabled:opacity-70`}
                >
                  {bulkLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {bulkLoading ? `등록 중...` : `${bulkRows.length}건 일괄 등록`}
                </button>
              ) : (
                <button
                  onClick={onBack}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  내 사건 보기
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
