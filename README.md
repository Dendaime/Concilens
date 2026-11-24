# Concilens

Aplicación web para conciliar automáticamente **minutas diarias de caja en `.docx`** (con fotos y escaneos de múltiples comprobantes por hoja) contra el **Anexo de Gastos del sistema (`.xlsx` / `.csv`)**.

## Características principales

- **Extracción local de `.docx` en lote**: descomprime `/word/media/` en el navegador con `JSZip`, lee la fecha desde el nombre de archivo (`DD-MM-YYYY.docx`) y calcula el hash **SHA-256** de cada imagen para detectar hojas duplicadas al instante.
- **Lector automático del Anexo de Gastos**: soporta `.xlsx`, `.xls` y `.csv`, detecta la fila de encabezados aunque haya filas de título previas y permite filtrar por `Cajero` (ej. `CCHOQUET`).
- **Visión multimodal con Gemini (Google AI Studio)**: extrae **múltiples comprobantes por hoja escaneada** (boletas bancarias, tiques factura térmicos rotados, recibos manuscritos `RECIBO N°`), con caché local por hash SHA-256 para no repetir llamadas.
- **Motor de cruce con semáforo**:
  - 🟢 **Conciliado**: coincide importe + fecha (dentro de tolerancia configurable) y/o N° de comprobante.
  - 🟡 **Revisar**: importe coincide con fecha fuera de tolerancia, suma de 2 comprobantes = 1 movimiento, comprobante poco legible o alerta de duplicado.
  - 🔴 **Sin respaldo**: egreso en sistema sin comprobante en las minutas.
  - 🔵 **No registrado**: comprobante en minuta ausente en el sistema.
- **Visor Split-View**: zoom, **rotación 90°**, indicador de posición en la hoja (`arriba`/`medio`/`abajo`), decisión manual (`Aprobar` / `Observar` / `Rechazar`), notas de auditoría y **exportación a Excel**.

## Desarrollo local

```bash
npm install
npm run dev
```

## Build de producción

```bash
npm run build
```
