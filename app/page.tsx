"use client";

import { useState } from "react";
import type { DiagnosisResult, PeriodPriceResult, StepResult } from "@/lib/siglo21";

// ── Parser tolerante: acepta un objeto, un array, o varios objetos pegados ────

function parseInputs(text: string): { inputs: Record<string, unknown>[]; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { inputs: [], error: "Pegá al menos un JSON." };

  // Intento directo: JSON válido (objeto o array)
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return { inputs: parsed };
    if (typeof parsed === "object" && parsed !== null) return { inputs: [parsed] };
  } catch {
    // sigue el parser tolerante
  }

  // Parser tolerante: extraer objetos {...} balanceados aunque estén pegados
  // uno tras otro, separados por comas, saltos de línea o texto suelto.
  const inputs: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          const obj = JSON.parse(candidate);
          if (typeof obj === "object" && obj !== null) inputs.push(obj);
        } catch {
          return { inputs: [], error: `Hay un bloque que no es JSON válido:\n${candidate.slice(0, 200)}` };
        }
        start = -1;
      }
    }
  }

  if (inputs.length === 0) {
    return { inputs: [], error: "No se encontró ningún JSON válido. Verificá el formato (llaves, comillas, comas)." };
  }
  return { inputs };
}

// ── Componentes de presentación ───────────────────────────────────────────────

const VERDICT_STYLES: Record<string, { badge: string; card: string; label: string }> = {
  OK: { badge: "bg-green-600", card: "border-green-300 bg-green-50", label: "✅ TODO OK" },
  OK_PARTIAL: { badge: "bg-amber-500", card: "border-amber-300 bg-amber-50", label: "⚠️ OK CON OMISIONES" },
  PRESENCIAL_MODALITY: { badge: "bg-sky-600", card: "border-sky-300 bg-sky-50", label: "ℹ️ MODALIDAD PRESENCIAL" },
  MISSING_REQUIRED_FIELD: { badge: "bg-orange-600", card: "border-orange-300 bg-orange-50", label: "✏️ DATOS INCOMPLETOS" },
  AUTH_FAILED: { badge: "bg-red-600", card: "border-red-300 bg-red-50", label: "🔒 FALLÓ AUTENTICACIÓN" },
  NO_SCHEDULES_AVAILABLE: { badge: "bg-red-600", card: "border-red-300 bg-red-50", label: "❌ SIN TURNOS" },
  NO_PERIODS_AVAILABLE: { badge: "bg-red-600", card: "border-red-300 bg-red-50", label: "❌ SIN PERÍODOS" },
  PRICE_FETCH_ERROR: { badge: "bg-red-600", card: "border-red-300 bg-red-50", label: "❌ FALLÓ PRECIO" },
};

const RESPONSIBLE_LABELS: Record<string, string> = {
  siglo21: "🏛️ Reportar a Siglo 21",
  config: "🛠️ Corregir datos / configuración",
  comportamiento_esperado: "✔️ Comportamiento esperado (no es una falla)",
  nadie: "✔️ Sin acción necesaria",
};

const STEP_ICONS: Record<string, string> = {
  ok: "✅",
  fail: "❌",
  warning: "⚠️",
  skipped: "⏭️",
};

function money(n?: number): string {
  if (typeof n !== "number") return "—";
  return "$" + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StepRow({ step }: { step: StepResult }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(step.url || step.rawResponse);
  return (
    <div className="border-b border-gray-100 last:border-0 py-2">
      <div className="flex items-start gap-2">
        <span className="shrink-0">{STEP_ICONS[step.status]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-gray-900">{step.title}</span>
            {step.httpStatus !== undefined && (
              <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${step.httpStatus < 400 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                HTTP {step.httpStatus}
              </span>
            )}
            {step.durationMs !== undefined && (
              <span className="text-xs text-gray-400">{step.durationMs} ms</span>
            )}
          </div>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{step.detail}</p>
          {hasDetail && (
            <button
              onClick={() => setOpen(!open)}
              className="text-xs text-blue-600 hover:underline mt-1"
            >
              {open ? "Ocultar detalle técnico ▲" : "Ver detalle técnico ▼"}
            </button>
          )}
          {open && (
            <div className="mt-2 text-xs bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto space-y-2">
              {step.url && (
                <div>
                  <span className="text-gray-400">URL:</span>{" "}
                  <span className="font-mono break-all">{step.method} {step.url}</span>
                </div>
              )}
              {step.rawResponse && (
                <div>
                  <span className="text-gray-400">Respuesta cruda de Siglo 21:</span>
                  <pre className="font-mono whitespace-pre-wrap break-all mt-1">{step.rawResponse}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PeriodRow({ p }: { p: PeriodPriceResult }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={p.ok ? "" : "bg-red-50"}>
        <td className="px-3 py-2 whitespace-nowrap">{p.ok ? "✅" : "❌"}</td>
        <td className="px-3 py-2 font-mono whitespace-nowrap">{p.periodName}-{p.subPeriod}</td>
        <td className="px-3 py-2 whitespace-nowrap">{p.ok ? money(p.total) : "—"}</td>
        <td className="px-3 py-2">
          {p.ok ? (
            <span className="text-gray-500 text-xs">HTTP {p.httpStatus} · {p.durationMs} ms</span>
          ) : (
            <span className="text-red-700 text-xs">{p.errorDetail}</span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <button onClick={() => setOpen(!open)} className="text-xs text-blue-600 hover:underline whitespace-nowrap">
            {open ? "ocultar ▲" : "detalle ▼"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="px-3 pb-3">
            <div className="text-xs bg-gray-900 text-gray-100 rounded p-3 overflow-x-auto space-y-2">
              <div>
                <span className="text-gray-400">URL:</span>{" "}
                <span className="font-mono break-all">GET {p.url}</span>
              </div>
              {p.rawResponse && (
                <div>
                  <span className="text-gray-400">Respuesta cruda:</span>
                  <pre className="font-mono whitespace-pre-wrap break-all mt-1">{p.rawResponse}</pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function buildReport(r: DiagnosisResult): string {
  const lines: string[] = [];
  lines.push(`DIAGNÓSTICO SIGLO 21 — carrera ${r.input.program_id} / modalidad ${r.input.modality_id} (${r.modalityName}) / CAU ${r.input.cau_id}`);
  lines.push(`Resultado: ${r.verdict.code} (equivale a HTTP ${r.verdict.httpEquivalent} del middleware)`);
  lines.push(`${r.verdict.title}: ${r.verdict.explanation}`);
  if (r.turnoCode) lines.push(`Turno usado: ${r.turnoName} (código ${r.turnoCode})`);
  lines.push("");
  lines.push("Pasos:");
  for (const s of r.steps) {
    lines.push(`  [${s.status.toUpperCase()}] ${s.title}${s.httpStatus ? ` (HTTP ${s.httpStatus})` : ""} — ${s.detail}`);
    if (s.url) lines.push(`    URL: ${s.method} ${s.url}`);
    if (s.status === "fail" && s.rawResponse) lines.push(`    Respuesta: ${s.rawResponse.slice(0, 500)}`);
  }
  if (r.periodPrices.length > 0) {
    lines.push("");
    lines.push("Precios por período:");
    for (const p of r.periodPrices) {
      if (p.ok) {
        lines.push(`  [OK] ${p.periodName}-${p.subPeriod}: total ${p.total}`);
      } else {
        lines.push(`  [FALLÓ] ${p.periodName}-${p.subPeriod}: ${p.errorDetail}`);
        lines.push(`    URL: GET ${p.url}`);
        if (p.rawResponse) lines.push(`    Respuesta: ${p.rawResponse.slice(0, 500)}`);
      }
    }
  }
  return lines.join("\n");
}

function ResultCard({ result, index }: { result: DiagnosisResult; index: number }) {
  const [copied, setCopied] = useState(false);
  const style = VERDICT_STYLES[result.verdict.code] ?? VERDICT_STYLES.PRICE_FETCH_ERROR;

  const copy = async () => {
    await navigator.clipboard.writeText(buildReport(result));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`border rounded-xl p-5 ${style.card}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-white text-sm font-bold px-3 py-1 rounded-full ${style.badge}`}>
            {style.label}
          </span>
          <span className="text-sm text-gray-600 font-mono">
            #{index + 1} · carrera {result.input.program_id} · modalidad {result.input.modality_id} · CAU {result.input.cau_id}
          </span>
        </div>
        <button
          onClick={copy}
          className="text-xs bg-white border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50 font-medium"
        >
          {copied ? "¡Copiado! ✓" : "📋 Copiar reporte"}
        </button>
      </div>

      <p className="text-xs text-gray-500 mb-1">{result.modalityName}</p>
      <h3 className="font-semibold text-gray-900">{result.verdict.title}</h3>
      <p className="text-sm text-gray-700 mt-1">{result.verdict.explanation}</p>
      <p className="text-sm font-medium mt-2">
        {RESPONSIBLE_LABELS[result.verdict.responsible]}
        <span className="text-gray-400 font-normal"> · el middleware respondería HTTP {result.verdict.httpEquivalent}</span>
      </p>

      <div className="mt-4 bg-white rounded-lg border border-gray-200 px-4 py-2">
        {result.steps.map((s) => (
          <StepRow key={s.id} step={s} />
        ))}
      </div>

      {result.periodPrices.length > 0 && (
        <div className="mt-3 bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2">Período</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {result.periodPrices.map((p, i) => (
                <PeriodRow key={i} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-2 text-right">
        Diagnóstico completo en {(result.totalDurationMs / 1000).toFixed(1)} s
      </p>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

const EXAMPLE = `{
  "cau_id": "C167",
  "modality_id": 1,
  "program_id": 1865
}`;

type PendingItem =
  | { status: "pending"; input: Record<string, unknown> }
  | { status: "running"; input: Record<string, unknown> }
  | { status: "done"; input: Record<string, unknown>; result: DiagnosisResult }
  | { status: "error"; input: Record<string, unknown>; message: string };

export default function Home() {
  const [texts, setTexts] = useState<string[]>([""]);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [running, setRunning] = useState(false);
  const [parseErrors, setParseErrors] = useState<Record<number, string>>({});

  const setTextAt = (i: number, value: string) => {
    setTexts((prev) => prev.map((t, j) => (j === i ? value : t)));
    setParseErrors((prev) => {
      if (!(i in prev)) return prev;
      const next = { ...prev };
      delete next[i];
      return next;
    });
  };

  const addBox = () => setTexts((prev) => [...prev, ""]);

  const removeBox = (i: number) => {
    setTexts((prev) => prev.filter((_, j) => j !== i));
    setParseErrors({});
  };

  const hasContent = texts.some((t) => t.trim());

  const run = async () => {
    // Parsear cada caja por separado; si en una caja pegaron varios JSON
    // igual los separamos internamente.
    const inputs: Record<string, unknown>[] = [];
    const errors: Record<number, string> = {};
    texts.forEach((t, i) => {
      if (!t.trim()) return; // cajas vacías se ignoran
      const parsed = parseInputs(t);
      if (parsed.error) errors[i] = parsed.error;
      else inputs.push(...parsed.inputs);
    });

    if (Object.keys(errors).length > 0 || inputs.length === 0) {
      if (inputs.length === 0 && Object.keys(errors).length === 0) {
        errors[0] = "Pegá al menos un JSON.";
      }
      setParseErrors(errors);
      return;
    }
    setParseErrors({});
    setRunning(true);

    const initial: PendingItem[] = inputs.map((input) => ({ status: "pending", input }));
    setItems(initial);

    // Secuencial a propósito: Siglo 21 tira 500 con requests concurrentes.
    for (let i = 0; i < inputs.length; i++) {
      setItems((prev) => prev.map((it, j) => (j === i ? { ...it, status: "running" } : it)) as PendingItem[]);
      try {
        const res = await fetch("/api/diagnose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(inputs[i]),
        });
        if (!res.ok) throw new Error(`El servidor de la herramienta respondió HTTP ${res.status}`);
        const result: DiagnosisResult = await res.json();
        setItems((prev) =>
          prev.map((it, j) => (j === i ? { status: "done", input: inputs[i], result } : it))
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((it, j) =>
            j === i
              ? { status: "error", input: inputs[i], message: err instanceof Error ? err.message : String(err) }
              : it
          )
        );
      }
    }
    setRunning(false);
  };

  const doneCount = items.filter((i) => i.status === "done" || i.status === "error").length;

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">🔍 Diagnóstico de precios — Siglo 21</h1>
        <p className="text-gray-600 mt-1">
          Pegá el JSON de la consulta (o varios) y la herramienta ejecuta el mismo flujo que el bot
          — turnos → períodos → precios — contra la API real de Siglo 21, y te dice en qué paso falló y por qué.
        </p>
      </header>

      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Pegá el JSON de la consulta. Si tenés más de una, usá el botón{" "}
          <span className="font-semibold">“Agregar otra consulta”</span>:
        </label>

        <div className="space-y-3">
          {texts.map((t, i) => (
            <div key={i} className="relative">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-400">Consulta #{i + 1}</span>
                {texts.length > 1 && (
                  <button
                    onClick={() => removeBox(i)}
                    disabled={running}
                    className="text-xs text-red-500 hover:text-red-700 hover:underline disabled:opacity-40"
                    title="Quitar esta consulta"
                  >
                    ✕ Quitar
                  </button>
                )}
              </div>
              <textarea
                value={t}
                onChange={(e) => setTextAt(i, e.target.value)}
                placeholder={EXAMPLE}
                rows={6}
                spellCheck={false}
                className={`w-full font-mono text-sm border rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-300 ${
                  parseErrors[i] ? "border-red-400 bg-red-50" : "border-gray-300"
                }`}
              />
              {parseErrors[i] && (
                <p className="text-sm text-red-600 mt-1 whitespace-pre-wrap">⚠️ {parseErrors[i]}</p>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button
            onClick={addBox}
            disabled={running}
            className="border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            ➕ Agregar otra consulta
          </button>
          <button
            onClick={run}
            disabled={running || !hasContent}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold px-5 py-2.5 rounded-lg transition-colors"
          >
            {running ? `Diagnosticando… (${doneCount}/${items.length})` : "▶ Diagnosticar"}
          </button>
          {running && (
            <span className="text-sm text-gray-500">
              Las consultas se procesan de a una (Siglo 21 no acepta consultas simultáneas).
            </span>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {items.map((item, i) => {
          if (item.status === "done") return <ResultCard key={i} result={item.result} index={i} />;
          if (item.status === "error")
            return (
              <div key={i} className="border border-red-300 bg-red-50 rounded-xl p-5">
                <p className="font-semibold text-red-800">
                  #{i + 1} — Error de la herramienta (no de Siglo 21)
                </p>
                <p className="text-sm text-red-700">{item.message}</p>
              </div>
            );
          return (
            <div key={i} className="border border-gray-200 bg-gray-50 rounded-xl p-5 flex items-center gap-3">
              {item.status === "running" ? (
                <span className="inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="text-gray-400">⏳</span>
              )}
              <span className="text-sm text-gray-600 font-mono">
                #{i + 1} · carrera {String(item.input.program_id ?? "?")} · modalidad {String(item.input.modality_id ?? "?")} · CAU {String(item.input.cau_id ?? "?")}
              </span>
              <span className="text-sm text-gray-400">
                {item.status === "running" ? "consultando Siglo 21…" : "en cola"}
              </span>
            </div>
          );
        })}
      </div>

      <footer className="mt-10 text-xs text-gray-400 border-t border-gray-100 pt-4">
        Réplica del flujo <span className="font-mono">get-price-v5</span> del middleware siglo21-price-proxy ·
        Herramienta interna de Conversia · Los resultados reflejan el estado de la API de Siglo 21 en este momento
        (una falla ocurrida durante una conversación pasada pudo haber sido temporal).
      </footer>
    </main>
  );
}
