import { NextRequest, NextResponse } from "next/server";
import { diagnose } from "@/lib/siglo21";

// Cada llamada diagnostica UNA consulta (body = el mismo JSON que recibe
// POST /v1/get-price-v4). El frontend procesa varias en
// secuencia (Siglo 21 devuelve 500 ante requests concurrentes con el mismo token).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_REQUEST_BODY", reason: "El cuerpo del request no es JSON válido." },
      { status: 400 }
    );
  }

  const result = await diagnose(body, {
    clientId: process.env.SIGLO21_CLIENT_ID ?? "",
    clientSecret: process.env.SIGLO21_CLIENT_SECRET ?? "",
  });
  return NextResponse.json(result);
}
