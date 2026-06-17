import OpenAI from 'openai';
import fetch from 'node-fetch';

const openai        = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PDFCO_API_KEY = process.env.PDFCO_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const YIL_UUIDLERI = [
  { yil: '2026', uuid: '5a9b323d-2a6b-4cb8-b6e5-37c035ec18a8' },
  { yil: '2025', uuid: '9d49a89a-5701-40f4-8836-e902b88fc527' },
  { yil: '2024', uuid: '36bb2187-08b5-4151-9526-ac7a79d2eb49' },
  { yil: '2023', uuid: 'e84dc299-1678-42a2-b081-0a14427ad078' },
  { yil: '2022', uuid: 'a8d4fd5c-9420-422f-bb5c-0af2c53ea51c' },
  { yil: '2021', uuid: '593b1c15-b4c5-4db5-a0bc-b0b356a3632b' },
  { yil: '2020', uuid: '3c40228c-7cc2-46a5-97e2-efdd5720f24a' },
  { yil: '2019', uuid: '911b4c49-0a45-41e3-abe1-b4aa4d43fe48' },
  { yil: '2018', uuid: '46877bce-fd84-4e96-a1b3-8d13684f01a8' },
  { yil: '2017', uuid: '99c7f6b2-f439-4880-be8f-b0315665e445' },
];

async function yilSirkulerleriniCek(yil, yilUuid) {
  const linkler = [];

  for (let sayfa = 1; sayfa <= 30; sayfa++) {
    const url = `https://www.turmob.org.tr/ekutuphane/${yilUuid}/mevzuat-sirkuleri/${sayfa}`;
    console.log(`${yil} - Sayfa ${sayfa} çekiliyor...`);

    const res  = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
    });
    const html = await res.text();

    const uuidRegex = /\/ekutuphane\/detailPdf\/([a-f0-9-]{36})/g;
    let eslesme;
    let yeniVarMi = false;

    while ((eslesme = uuidRegex.exec(html)) !== null) {
      const uuid = eslesme[1];
      if (!linkler.includes(uuid)) {
        linkler.push(uuid);
        yeniVarMi = true;
      }
    }

    console.log(`${yil} - Sayfa ${sayfa}: ${linkler.length} sirküler bulundu`);

    if (!yeniVarMi) {
      console.log(`${yil} - Daha fazla sayfa yok.`);
      break;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return linkler;
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

async function supabaseKaydet(uuid, metin, embedding, yil) {
  const url = `https://www.turmob.org.tr/ekutuphane/detailPdf/${uuid}/sirkuler`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sirkuler`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      sirkuler_no: url,
      tarih: `${yil}-01-01`,
      metin,
      embedding,
    }),
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

  for (const { yil, uuid: yilUuid } of YIL_UUIDLERI) {
    console.log(`\n📅 ${yil} yılı işleniyor...`);

    const uuidler = await yilSirkulerleriniCek(yil, yilUuid);
    console.log(`${yil}: ${uuidler.length} sirküler bulundu`);

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
        await supabaseKaydet(uuid, metin, embedding, yil);
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
