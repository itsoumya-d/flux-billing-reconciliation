import { createServer } from "node:http";
import { reconcile, type InvoiceLine, type IntervalRead, type Tariff } from "./engine.js";

const tariff: Tariff = {
  dailyFixed: 2.5,
  demandRatePerKw: 1.2,
  exportRatePerKwh: 0.08,
  periods: [
    { period: "peak", startHour: 7, endHour: 11, ratePerKwh: 0.32 },
    { period: "shoulder", startHour: 11, endHour: 17, ratePerKwh: 0.24 },
    { period: "offpeak", startHour: 21, endHour: 7, ratePerKwh: 0.16 },
  ],
};

const reads: IntervalRead[] = [];
for (let hour = 7; hour < 22; hour += 1) {
  for (const minute of ["00", "30"]) {
    if (hour === 20 && minute === "30") continue;
    const kwh = hour >= 7 && hour < 11 ? 2.0 : hour >= 11 && hour < 17 ? 1.6 : 1.1;
    reads.push({ start: `${String(hour).padStart(2, "0")}:${minute}`, kwh });
  }
}
const invoice: InvoiceLine[] = [{ description: "Energy", amount: 8.2 }, { description: "Demand", amount: 4.8 }, { description: "Fixed", amount: 2.5 }];
const result = reconcile(reads, tariff, invoice);
const money = (value: number) => `NZ$${value.toFixed(2)}`;
const rows = reads.slice(0, 8).map((read) => `<tr><td>${read.start}</td><td>${read.kwh.toFixed(1)} kWh</td></tr>`).join("");
const flags = result.flags.map((flag) => `<li>${flag}</li>`).join("") || "<li>none</li>";
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flux billing reconciliation</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
:root{--navy:#050c2f;--blue:#0b30b0;--purple:#0f1372;--white:#fff;--light:#f3f3f5;--muted:#9b9eac}
*{box-sizing:border-box}body{margin:0;background:var(--navy);color:var(--white);font-family:Inter,sans-serif;font-size:16px;line-height:1.65;letter-spacing:.3px}
.shell{max-width:1160px;margin:0 auto;padding:34px 28px}header{border-bottom:1px solid rgba(255,255,255,.18);padding-bottom:24px;display:flex;justify-content:space-between;gap:24px}
.eyebrow{color:#aeb7ff;font-size:11px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;margin:0 0 8px}h1{font-family:'IBM Plex Sans',sans-serif;font-size:clamp(40px,5vw,64px);font-weight:500;line-height:1.02;margin:0;letter-spacing:-.03em;max-width:850px}
.lede{max-width:700px;color:#c7cbe0;margin:14px 0 0}.tag{border:1px solid rgba(255,255,255,.25);border-radius:25px;padding:11px 20px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.metric{background:#0b123a;border:1px solid rgba(255,255,255,.14);padding:16px;border-radius:8px}.metric span{display:block;color:var(--muted);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em}.metric strong{display:block;margin-top:8px;font-family:'IBM Plex Sans',sans-serif;font-size:28px;font-weight:500}.metric.blue strong{color:#9facff}.metric.purple strong{color:#c5b8ff}
.grid{display:grid;grid-template-columns:1.6fr 1fr;gap:16px}.panel{background:#0b123a;border:1px solid rgba(255,255,255,.14);border-radius:8px;overflow:hidden}.panel h2{font-family:'IBM Plex Sans',sans-serif;font-size:20px;font-weight:500;margin:0;padding:15px 18px;border-bottom:1px solid rgba(255,255,255,.14)}.panel .body{padding:18px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:12px}th{color:var(--muted);text-transform:uppercase;font-size:9px;letter-spacing:.08em}.right{text-align:right}
.amount{font-size:26px;font-family:'IBM Plex Sans',sans-serif;font-weight:500}.variance{color:#ff9a8a}.ok{color:#7ef0b5}.flags{list-style:none;padding:0;margin:0}.flags li{border-top:1px solid rgba(255,255,255,.1);padding:9px 0;font-size:12px;color:#ffc2b7}
footer{display:flex;justify-content:space-between;gap:16px;margin-top:24px;padding-top:14px;border-top:1px solid rgba(255,255,255,.14);color:var(--muted);font-size:11px}@media(max-width:900px){.metrics{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}header{flex-direction:column}}
</style></head><body><div class="shell"><header><div><p class="eyebrow">Flux Federation · Billing reconciliation</p><h1>You can’t sell what you can’t bill.</h1><p class="lede">Interval data, tariff periods, demand and export — reconciled into one explainable invoice variance before the customer sees it.</p></div><div class="tag">TypeScript<br>AWS events<br>OpenAPI</div></header>
<section class="metrics"><div class="metric"><span>Expected</span><strong>${money(result.expectedTotal)}</strong></div><div class="metric blue"><span>Invoiced</span><strong>${money(result.invoicedTotal)}</strong></div><div class="metric purple"><span>Variance</span><strong>${money(result.variance)}</strong></div><div class="metric"><span>Max demand</span><strong>${result.maxDemandKw} kW</strong></div></section>
<main class="grid"><section class="panel"><h2>Interval evidence</h2><div class="body"><table><thead><tr><th>Interval</th><th class="right">Usage</th></tr></thead><tbody>${rows}</tbody></table></div></section><aside class="panel"><h2>Reconciliation</h2><div class="body"><p class="amount ${result.variance === 0 ? "ok" : "variance"}">${result.variance >= 0 ? "+" : ""}${money(result.variance)}</p><p>${result.variancePercent.toFixed(1)}% versus expected</p><ul class="flags">${flags}</ul><p><strong>Peak:</strong> ${result.peakKwh} kWh · <strong>Shoulder:</strong> ${result.shoulderKwh} kWh · <strong>Off-peak:</strong> ${result.offpeakKwh} kWh</p></div></aside></main>
<footer><span>IBM Plex Sans · Inter · #050C2F · #0B30B0 · 25px buttons</span><span>Reference implementation for Flux Federation</span></footer></div></body></html>`;

createServer((request, response) => {
  if (request.url === "/api/reconciliation") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end(html);
}).listen(5184, "127.0.0.1", () => console.log("Flux billing reconciliation on http://127.0.0.1:5184"));
