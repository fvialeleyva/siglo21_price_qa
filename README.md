# Diagnóstico de precios — Siglo 21 (QA)

Herramienta interna de Conversia para que el equipo de CS pueda diagnosticar por qué
falló una consulta de precio del bot, sin depender de alguien técnico.

Replica el flujo `get-price-v5` del middleware `siglo21-price-proxy`:

```
Validación → Chequeo modalidad presencial → Token (client_credentials) → 1) Turnos → 2) Períodos → 3) Precios (por período, en secuencia)
```

y muestra, para cada paso: si funcionó, el status HTTP, la URL exacta llamada y la
respuesta cruda de la API de Siglo 21. El veredicto final usa la misma taxonomía de
errores que el middleware (`PRESENCIAL_MODALITY`, `AUTH_FAILED`, `NO_SCHEDULES_AVAILABLE`,
`NO_PERIODS_AVAILABLE`, `PRICE_FETCH_ERROR`) más `OK_PARTIAL` cuando algunos períodos
fallan y el middleware los omite en silencio.

## Uso

Pegar en el textarea el JSON de la consulta (el mismo formato que envía el frontend):

```json
{
  "cau_id": "C167",
  "modality_id": 1,
  "program_id": 1865
}
```

Para consultar **varias** a la vez, usar el botón **“➕ Agregar otra consulta”** (una caja
por consulta — no hace falta armar arrays). Igualmente, si se pega un array `[{...}, {...}]`
o varios JSON en una misma caja, la herramienta los separa sola.
Se procesan en secuencia (Siglo 21 devuelve 500 ante requests concurrentes con el mismo token).

Cada resultado tiene un botón **Copiar reporte** que genera un resumen en texto listo
para reenviar (por ejemplo, al equipo de Siglo 21).

## Desarrollo

```bash
npm install
cp .env.example .env.local   # y completar las credenciales
npm run dev
```

## Deploy en Vercel

1. Importar el repo en Vercel.
2. Configurar las variables de entorno `SIGLO21_CLIENT_ID` y `SIGLO21_CLIENT_SECRET`
   (las mismas que usa el lambda en producción).
3. Deploy. No requiere nada más.

## Notas

- El diagnóstico refleja el estado **actual** de la API de Siglo 21: una falla ocurrida
  durante una conversación pasada pudo haber sido temporal y ya no reproducirse.
- Igual que el lambda, la herramienta pide un token nuevo (client_credentials contra
  `auth.ues21.edu.ar`) en cada diagnóstico, así que también detecta fallas de autenticación
  (`AUTH_FAILED`). El token nunca se muestra en la UI (se oculta en la respuesta cruda).
- Timeout por request: 10 s (igual que el lambda).
