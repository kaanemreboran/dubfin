import OpenAI from 'openai';
import fetch from 'node-fetch';

const openai        = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PDFCO_API_KEY = process.env.PDFCO_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const AYLAR = [
  { ad: '2026-Ocak',    uuid: '3e673e93-218c-4181-af6f-2a9b0cfb67f6', yil: '2026', ay: '01' },
  { ad: '2026-Şubat',   uuid: '829099d6-4725-4340-9726-6660912ce627', yil: '2026', ay: '02' },
  { ad: '2026-Mart',    uuid: 'f62aeaff-e172-4dc4-a076-2df107513c4b', yil: '2026', ay: '03' },
  { ad: '2026-Nisan',   uuid: '331f421b-a44f-4d7d-ad0e-e4fdf0337808', yil: '2026', ay: '04' },
  { ad: '2026-Mayıs',   uuid: '9004b7c8-e648-4577-9158-b0a643a1119d', yil: '2026', ay: '05' },
  { ad: '2026-Haziran', uuid: '302b3a2e-b95b-49c5-81ab-a5c5ac57a9ed', yil: '2026', ay: '06' },
];

async function aySirkulerleriniCek(ay) {
  const uuidler = [];

  for (let sayfa = 1; sayfa <= 20; sayfa++) {
    const url = `https://www.turmob.org.tr/ekutuphane/${ay.uuid}/${ay.yil}/${sayfa}`;
    console.log(`${ay.ad} - Sayfa ${sayfa} çekiliyor...`);

    const res  = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
    });
    const html = await res.text();

    const uuidRegex = /\/ekutuphane\/detailPdf\/([a-f0-9-]{36})/g;
    let eslesme;
    let yeniVarMi = false;

    while ((eslesme = uuidRegex.exec(html)) !== null) {
      const uuid = eslesme[1];
      if (!uuidler.includes(uuid)) {
        uuidler.push(uuid);
        yeniVarMi = true;
      }
    }

    console.log(`${ay.ad} - Sayfa ${sayfa}: ${uuidler.length} sirküler`);

    if (!yeniVarMi) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  return uuidler;
}

async function zatenVarMi(uuid) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sirkuler?sirkuler_no=like.*${uuid}*&select=id`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  return Array.isArray(data) && data.length > 0;
}

async function pdfdenMetinCikar(uuid) {
  const pdfUrl = `https://www.turmob.org.tr/ekutuphane/Read/${uuid}`;
  const res = await fetch('https://api.pdf.co/v1/pdf/convert/to/text', {
    method: 'POST',
    headers: { 'x-api-key': PDFCO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: pdfUrl, inline: true, async: false }),
  });
  const veri = await res.json();
  if (veri.error) throw new Error(`PDF.co hatası: ${veri.message}`);
  return veri.body || '';
}

async function embeddingUret(metin) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: metin.substring(0, 8000),
  });
  return res.data[0].embedding;
}

async function supabaseKaydet(uuid, metin, embedding, ay) {
  const tarih = `${ay.yil}-${ay.ay}-01`;
  const url   = `https://www.turmob.org.tr/ekutuphane/detailPdf/${uuid}/sirkuler`;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/sirkuler`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ sirkuler_no: url, tarih, metin, embedding }),
  });

  if (!res.ok) {
    const hata = await res.text();
    throw new Error(`Supabase hatası: ${hata}`);
  }
  console.log(`✅ Kaydedildi: ${uuid}`);
}

async function main() {
  console.log('🚀 Toplu yükleme başladı:', new Date().toISOString());

  let toplamYeni   = 0;
  let toplamMevcut = 0;
  let toplamHata   = 0;

  for (const ay of AYLAR) {
    console.log(`\n📅 ${ay.ad} işleniyor...`);
    const uuidler = await aySirkulerleriniCek(ay);
    console.log(`${ay.ad}: ${uuidler.length} sirküler bulundu`);

    for (const uuid of uuidler) {
      try {
        if (await zatenVarMi(uuid)) {
          console.log(`⏭️  Zaten mevcut: ${uuid}`);
          toplamMevcut++;
          continue;
        }

        const metin = await pdfdenMetinCikar(uuid);
        if (!metin || metin.length < 50) {
          console.log(`⚠️  Metin çıkarılamadı: ${uuid}`);
          toplamHata++;
          continue;
        }

        const embedding = await embeddingUret(metin);
        await supabaseKaydet(uuid, metin, embedding, ay);
        toplamYeni++;

        await new Promise(r => setTimeout(r, 2000));

      } catch (hata) {
        console.error(`❌ Hata (${uuid}):`, hata.message);
        toplamHata++;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  console.log(`\n📊 GENEL SONUÇ:`);
  console.log(`   ✅ Yeni eklenen: ${toplamYeni}`);
  console.log(`   ⏭️  Zaten mevcut: ${toplamMevcut}`);
  console.log(`   ❌ Hata: ${toplamHata}`);
}

main().catch(console.error);
