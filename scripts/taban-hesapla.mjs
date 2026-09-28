#!/usr/bin/env node
// reference/ içindeki sistem promptlarını reference/bolumler.json'daki kurallara göre
// gruplara ayırır, her grubun token sayısını count_tokens ile bir kez hesaplar ve
// sonucu extension/baseline.js dosyasına sabit olarak yazar.
// Prompt metni eklentiye girmez, yalnızca sayılar ve grup etiketleri girer.
//
// Dosya adı model kimliğini belirler: claude-opus-5.5.md -> claude-opus-5-5
//
// Kullanım: ANTHROPIC_API_KEY=... node scripts/taban-hesapla.mjs

import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const referenceDir = join(root, "reference");
const outFile = join(root, "extension", "baseline.js");

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY tanımlı değil.");
  process.exit(1);
}

const config = JSON.parse(await readFile(join(referenceDir, "bolumler.json"), "utf8"));
const rules = config.kurallar.map((k) => ({ re: new RegExp(k.desen), group: k.grup }));
for (const r of rules) {
  if (!config.gruplar[r.group]) throw new Error(`bolumler.json: bilinmeyen grup "${r.group}"`);
}

function groupOf(unit) {
  const rule = rules.find((r) => r.re.test(unit));
  return rule ? rule.group : config.varsayilan;
}

// Promptu birimlere böler: her '# başlık' bir birim; 'parcala' içindeki üst
// başlıklar '## başlık' düzeyinde bölünür.
function splitUnits(text) {
  const units = [];
  let top = null;
  let current = null;
  for (const line of text.split("\n")) {
    const h1 = line.match(/^# (.+)$/);
    const h2 = line.match(/^## (.+)$/);
    if (h1) {
      top = h1[1].trim();
      current = { name: top, lines: [] };
      units.push(current);
    } else if (h2 && config.parcala.includes(top)) {
      current = { name: h2[1].trim(), lines: [] };
      units.push(current);
    }
    if (!current) {
      current = { name: "(başlıksız)", lines: [] };
      units.push(current);
    }
    current.lines.push(line);
  }
  return units;
}

async function countTokens(model, system) {
  const body = { model, messages: [{ role: "user", content: "." }] };
  if (system) body.system = system;
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${model}: ${res.status} ${await res.text()}`);
  return (await res.json()).input_tokens;
}

const files = (await readdir(referenceDir)).filter((f) => f.endsWith(".md"));
if (!files.length) {
  console.error("reference/ içinde .md dosyası yok.");
  process.exit(1);
}

const models = {};
for (const file of files) {
  const model = basename(file, ".md").replaceAll(".", "-");
  const text = await readFile(join(referenceDir, file), "utf8");

  const texts = {};
  const sections = {};
  for (const unit of splitUnits(text)) {
    const g = groupOf(unit.name);
    (texts[g] ??= []).push(unit.lines.join("\n"));
    (sections[g] ??= []).push(unit.name);
  }

  // Promptlu ve promptsuz sayımın farkı = yalnızca o metnin token'ı.
  const empty = await countTokens(model, null);
  const groups = {};
  for (const [g, parts] of Object.entries(texts)) {
    const def = config.gruplar[g];
    const tokens = (await countTokens(model, parts.join("\n"))) - empty;
    groups[g] = {
      etiket: def.etiket,
      bayrak: def.bayrak || null,
      tur: def.tur || null,
      tokens,
      bolumler: sections[g].length,
    };
  }
  const total = (await countTokens(model, text)) - empty;
  models[model] = { file, total, groups };

  console.log(`${model} (${file}): toplam ${total} token`);
  for (const [g, v] of Object.entries(groups)) {
    const tag = v.bayrak ? `bayrak: ${v.bayrak}` : v.tur || "her zaman";
    console.log(`  ${String(v.tokens).padStart(7)}  ${v.etiket} [${tag}] — ${v.bolumler} bölüm`);
  }
}

const baseline = { countedAt: new Date().toISOString().slice(0, 10), models };
await writeFile(
  outFile,
  "// scripts/taban-hesapla.mjs tarafından üretildi — elle düzenleme.\n" +
    `globalThis.CTS_BASELINE = ${JSON.stringify(baseline, null, 2)};\n`
);
console.log(`Yazıldı: ${outFile}`);
