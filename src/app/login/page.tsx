"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(false);

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.push("/");
    } else {
      setError(true);
      setPassword("");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form onSubmit={handleSubmit} className="w-72 space-y-4">
        <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-center">
          Pyaar Radio
        </h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full px-4 py-2 bg-[#111] border border-[#333] text-sm text-white placeholder-[#555] focus:outline-none focus:border-red-500 transition-colors"
        />
        {error && (
          <p className="text-red-500 text-[10px] uppercase tracking-wider text-center">
            Wrong password
          </p>
        )}
        <button
          type="submit"
          className="w-full py-2 text-[10px] uppercase tracking-wider bg-red-600 hover:bg-red-500 text-white transition-colors"
        >
          Enter
        </button>
      </form>
    </div>
  );
}
