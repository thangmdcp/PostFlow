"use client";

import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { CustomSelect } from "@/components/ui/CustomSelect";

export interface AutoAdsAccountRowLike {
  accountId: string;
  weight: number;
  budgetMin: string;
  budgetMax: string;
  budgetStep: string;
  assignedCount?: number;
  dirty?: boolean;
}

export interface AdAccountLike { accountId: string; name: string; }

interface EditableProps {
  readOnly?: false;
  rows: AutoAdsAccountRowLike[];
  adAccounts: AdAccountLike[];
  loading?: boolean;
  onPatchRow: (idx: number, patch: Partial<AutoAdsAccountRowLike>) => void;
  onDeleteRow: (idx: number) => void;
  onAddRow: () => void;
  onResetCounts?: () => void;
}

interface ReadOnlyProps {
  readOnly: true;
  rows: AutoAdsAccountRowLike[];
  adAccounts: AdAccountLike[];
}

export type AutoAdsAccountEditorProps = EditableProps | ReadOnlyProps;

export function AutoAdsAccountEditor(props: AutoAdsAccountEditorProps) {
  const inp = "rounded-lg border bg-white dark:bg-slate-800 px-2.5 py-[5px] text-xs focus:outline-none focus:ring-2 focus:ring-violet-500";
  const { rows, adAccounts } = props;

  if (props.readOnly) {
    if (rows.length === 0) return null;
    return (
      <div className="rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5 space-y-2">
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Phân bổ TKQC</p>
        {rows.map((row, i) => {
          const acc = adAccounts.find(a => a.accountId === row.accountId);
          return (
            <div key={i} className="space-y-0.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-700 dark:text-slate-200 font-medium truncate">{acc?.name ?? row.accountId}</span>
                <span className="text-violet-600 font-semibold shrink-0 ml-2">{row.weight}%</span>
              </div>
              <p className="text-[10px] text-slate-400">
                {Number(row.budgetMin).toLocaleString("vi-VN")}–{Number(row.budgetMax).toLocaleString("vi-VN")} /{Number(row.budgetStep).toLocaleString("vi-VN")}
              </p>
            </div>
          );
        })}
      </div>
    );
  }

  const { loading, onPatchRow, onDeleteRow, onAddRow, onResetCounts } = props;
  const totalWeight = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const weightOk = totalWeight === 100;

  return (
    <div className="pt-2 border-t border-violet-100 dark:border-violet-900/30 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Phân bổ TKQC</p>
        <div className="flex items-center gap-2">
          {totalWeight > 0 && (
            <span className={["text-[10px] font-medium px-2 py-0.5 rounded-full",
              weightOk ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                       : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
            ].join(" ")}>
              {weightOk ? "100% ✓" : `${totalWeight}%`}
            </span>
          )}
          {onResetCounts && rows.some(r => (r.assignedCount || 0) > 0) && (
            <button onClick={onResetCounts} className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-700 border rounded px-1.5 py-0.5 hover:border-slate-400 transition-colors">
              <RefreshCw size={10} /> Reset
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-1"><Loader2 size={12} className="animate-spin" /> Đang tải...</div>
      ) : (
        <>
          {rows.map((row, idx) => (
            <div key={idx} className={["rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5 space-y-2", row.dirty ? "border-violet-300" : ""].join(" ")}>
              <div className="flex items-center gap-2">
                <CustomSelect className="flex-1 min-w-0" value={row.accountId} onChange={v => onPatchRow(idx, { accountId: v })}
                  options={adAccounts.map(a => ({ value: a.accountId, label: a.name }))} />
                <div className="flex items-center gap-1 shrink-0">
                  <input type="number" min={1} max={100} value={row.weight} onChange={e => onPatchRow(idx, { weight: Number(e.target.value) })}
                    className={inp + " w-14 text-center"} />
                  <span className="text-[10px] text-slate-400">%</span>
                </div>
                <button onClick={() => onDeleteRow(idx)} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500 transition-colors shrink-0">
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="space-y-1">
                <div className="grid grid-cols-3 gap-1">
                  <div>
                    <p className="text-[9px] text-slate-400 mb-0.5 text-center">Min</p>
                    <input type="number" value={row.budgetMin} onChange={e => onPatchRow(idx, { budgetMin: e.target.value })} className={inp + " w-full text-center"} />
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-400 mb-0.5 text-center">Max</p>
                    <input type="number" value={row.budgetMax} onChange={e => onPatchRow(idx, { budgetMax: e.target.value })} className={inp + " w-full text-center"} />
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-400 mb-0.5 text-center">Bước nhảy</p>
                    <input type="number" value={row.budgetStep} onChange={e => onPatchRow(idx, { budgetStep: e.target.value })} className={inp + " w-full text-center"} />
                  </div>
                </div>
              </div>
            </div>
          ))}

          {adAccounts.length === 0 ? (
            <p className="text-xs text-slate-500">Chưa có TKQC — vào Kết nối FB để thêm.</p>
          ) : (
            <button onClick={onAddRow}
              className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 border border-dashed border-violet-300 hover:border-violet-500 rounded-xl px-3 py-2 w-full justify-center transition-colors">
              <Plus size={13} /> Thêm tài khoản
            </button>
          )}
        </>
      )}
    </div>
  );
}
