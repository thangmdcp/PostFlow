"use client";

export const GENDER_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "1", label: "Nam" },
  { value: "2", label: "Nữ" },
];

export interface AdParametersFormProps {
  ageMinFrom: string; ageMinTo: string;
  ageMaxFrom: string; ageMaxTo: string;
  onAgeMinFromChange: (v: string) => void; onAgeMinToChange: (v: string) => void;
  onAgeMaxFromChange: (v: string) => void; onAgeMaxToChange: (v: string) => void;
  gender: string; onGenderChange: (v: string) => void;
  budgetMin: string; budgetMax: string; budgetStep: string;
  onBudgetMinChange: (v: string) => void; onBudgetMaxChange: (v: string) => void; onBudgetStepChange: (v: string) => void;
  /** "blue" (BatchImportClient's AdsConfigPanel) or "violet" (AdSettingsClient) accent for the gender toggle buttons */
  accent?: "blue" | "violet";
  budgetLabel?: string;
  budgetStepLabel?: string;
}

export function AdParametersForm({
  ageMinFrom, ageMinTo, ageMaxFrom, ageMaxTo,
  onAgeMinFromChange, onAgeMinToChange, onAgeMaxFromChange, onAgeMaxToChange,
  gender, onGenderChange,
  budgetMin, budgetMax, budgetStep,
  onBudgetMinChange, onBudgetMaxChange, onBudgetStepChange,
  accent = "violet",
  budgetLabel = "Ngân sách",
  budgetStepLabel = "Bước",
}: AdParametersFormProps) {
  const ring = accent === "blue" ? "focus:ring-blue-500" : "focus:ring-violet-500";
  const inp = `rounded-lg border bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 ${ring}`;
  const activeGender = accent === "blue" ? "bg-blue-600 border-blue-600 text-white" : "bg-violet-600 border-violet-600 text-white";
  const inactiveGender = accent === "blue"
    ? "bg-white dark:bg-slate-800 text-slate-600 hover:border-blue-400"
    : "bg-white dark:bg-slate-800 text-slate-600 hover:border-violet-400";

  return (
    <div className="space-y-2.5">
      {/* Age */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[10px] text-slate-400 shrink-0 w-[60px]">Tuổi min</span>
          <input type="number" value={ageMinFrom} min={13} max={65} onChange={e => onAgeMinFromChange(e.target.value)} className={inp + " w-0 flex-1 text-center"} />
          <span className="text-slate-300 text-[10px] shrink-0">–</span>
          <input type="number" value={ageMinTo} min={13} max={65} onChange={e => onAgeMinToChange(e.target.value)} className={inp + " w-0 flex-1 text-center"} />
        </div>
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[10px] text-slate-400 shrink-0 w-[60px]">Tuổi max</span>
          <input type="number" value={ageMaxFrom} min={13} max={65} onChange={e => onAgeMaxFromChange(e.target.value)} className={inp + " w-0 flex-1 text-center"} />
          <span className="text-slate-300 text-[10px] shrink-0">–</span>
          <input type="number" value={ageMaxTo} min={13} max={65} onChange={e => onAgeMaxToChange(e.target.value)} className={inp + " w-0 flex-1 text-center"} />
        </div>
      </div>

      {/* Gender */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-400 shrink-0 w-[60px]">Giới tính</span>
        <div className="flex gap-1 flex-1 min-w-0">
          {GENDER_OPTIONS.map(o => (
            <button key={o.value} type="button" onClick={() => onGenderChange(o.value)}
              className={["flex-1 rounded-md border py-1 text-xs font-medium transition-all",
                gender === o.value ? activeGender : inactiveGender].join(" ")}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Budget */}
      <div className="flex items-start gap-1 min-w-0">
        {budgetLabel && <span className="text-[10px] text-slate-400 shrink-0 w-[60px] pt-2">{budgetLabel}</span>}
        <div className="grid grid-cols-3 gap-1 flex-1 min-w-0">
          <div>
            <p className="text-[9px] text-slate-400 mb-0.5 text-center">Min</p>
            <input type="number" value={budgetMin} onChange={e => onBudgetMinChange(e.target.value)} className={inp + " w-full text-center"} placeholder="100000" />
          </div>
          <div>
            <p className="text-[9px] text-slate-400 mb-0.5 text-center">Max</p>
            <input type="number" value={budgetMax} onChange={e => onBudgetMaxChange(e.target.value)} className={inp + " w-full text-center"} placeholder="200000" />
          </div>
          <div>
            <p className="text-[9px] text-slate-400 mb-0.5 text-center">{budgetStepLabel}</p>
            <input type="number" value={budgetStep} onChange={e => onBudgetStepChange(e.target.value)} className={inp + " w-full text-center"} placeholder="10000" />
          </div>
        </div>
      </div>
    </div>
  );
}
