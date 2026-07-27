"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Sparkles } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không thể đăng nhập");
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể đăng nhập");
    } finally {
      setLoading(false);
    }
  }

  return <main className="min-h-screen bg-slate-950 p-3 sm:p-5">
    <section className="relative min-h-[calc(100vh-1.5rem)] overflow-hidden rounded-[28px] bg-indigo-950 shadow-2xl shadow-indigo-950/40 sm:min-h-[calc(100vh-2.5rem)]">
      {/* This asset stays public because the login route is public. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/login/postflow-login-illustration.png" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover object-center" />
      <div className="absolute inset-0 bg-gradient-to-r from-indigo-950/42 via-indigo-950/5 to-indigo-950/28" />

      <div className="absolute bottom-8 left-7 hidden max-w-[520px] text-white sm:bottom-12 sm:left-12">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium backdrop-blur"><Sparkles size={14} /> Nhanh hơn. Đồng bộ hơn.</div>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">Quản lý nội dung Facebook theo nhịp làm việc của bạn.</h1>
        <p className="mt-4 max-w-md text-sm leading-7 text-indigo-100 sm:text-base">Lên lịch, tối ưu nội dung và theo dõi quảng cáo trong một không gian gọn gàng.</p>
      </div>

      <form onSubmit={submit} className="relative z-10 mx-auto flex min-h-[calc(100vh-1.5rem)] w-full max-w-md flex-col justify-center space-y-7 border border-white/35 bg-white/[0.14] px-7 py-20 text-white shadow-[0_24px_70px_rgba(5,8,45,.42),inset_0_1px_0_rgba(255,255,255,.35)] backdrop-blur-2xl sm:absolute sm:left-14 sm:top-28 sm:mx-0 sm:min-h-0 sm:w-[400px] sm:rounded-[28px] sm:px-10 lg:left-16 lg:top-20 lg:w-[410px]">
            <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl border border-white/30 bg-gradient-to-br from-white/30 to-white/5 text-white shadow-lg shadow-indigo-950/30"><LockKeyhole size={19} /></div><span className="text-xl font-bold tracking-tight">PostFlow</span></div>
            <div><p className="text-sm font-semibold text-blue-100">Chào mừng trở lại</p><h2 className="mt-2 text-3xl font-bold tracking-tight text-white">Đăng nhập tài khoản</h2><p className="mt-2 text-sm leading-6 text-indigo-100">Dùng email quản trị đã được cấp để vào PostFlow.</p></div>
            <div className="space-y-4">
              <label className="block space-y-1.5"><span className="text-sm font-medium text-indigo-50">Email</span><div className="relative"><Mail size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-indigo-100/75" /><input autoFocus required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" className="h-12 w-full rounded-xl border border-white/25 bg-slate-950/15 pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-indigo-100/60 focus:border-white/65 focus:bg-white/10 focus:ring-4 focus:ring-white/10" /></div></label>
              <label className="block space-y-1.5"><span className="text-sm font-medium text-indigo-50">Mật khẩu</span><div className="relative"><LockKeyhole size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-indigo-100/75" /><input required type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nhập mật khẩu" className="h-12 w-full rounded-xl border border-white/25 bg-slate-950/15 pl-10 pr-11 text-sm text-white outline-none transition placeholder:text-indigo-100/60 focus:border-white/65 focus:bg-white/10 focus:ring-4 focus:ring-white/10" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-indigo-100/75 hover:text-white" aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
            </div>
            {error && <p className="rounded-xl border border-red-200/35 bg-red-950/25 px-3 py-2.5 text-sm text-red-100">{error}</p>}
            <button disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/25 bg-gradient-to-r from-blue-500 to-indigo-500 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(23,47,180,.45),inset_0_1px_0_rgba(255,255,255,.4)] transition hover:from-blue-400 hover:to-indigo-400 disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Đang đăng nhập..." : <>Đăng nhập <ArrowRight size={17} /></>}</button>
            <p className="text-center text-xs leading-5 text-indigo-100/75">Khu vực quản trị riêng tư · Phiên đăng nhập được bảo vệ</p>
      </form>
    </section>
  </main>;
}
