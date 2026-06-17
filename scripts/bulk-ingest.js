import OpenAI from 'openai';
import fetch from 'node-fetch';

const openai      = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PDFCO_API_KEY    = process.env.PDFCO_API_KEY;
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
const SCRAPERAPI_KEY   = process.env.SCRAPERAPI_KEY;

async function tumSirkulerleriCek() {
  const linkler = [];

  // ScraperAPI ile JS render ederek TÜRMOB sirküler sayfasını çek
  // start parametresiyle sayfalama yapıyoruz
  for (let sayfa = 1; sayfa <= 10; sayfa++) {
    const turMobUrl = `https://www.turmob.org.tr/Sirkuler/Mevzuat`;
    const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(turMobUrl)}&render=true&wait=3000`;

    console.log(`Sayfa ${sayfa} çekiliyor...`);
    const res  = await fetch(scraperUrl);
    const html = await res.text();

    // detailPdf UUID'lerini çek
    const uuidRegex = /detailPdf\/([a-f0-9-]{36})/g;
    let eslesme;
    let yeniVarMi = false;

    while ((eslesme = uuidRegex.exec(html)) !== null) {
      const uuid = eslesme[1];
      const url  = `https://www.turmob.org.tr/sirkuler/detailPdf/${uuid}/sirkuler`;
      if (!linkler.some(l => l.includes(uuid))) {
        linkler.push(url);
        yeniVarMi = true;
      }
    }

    console.log(`Sayfa ${sayfa}: toplam ${linkler.length} sirküler`);

    if (!yeniVarMi) break;
    await new Promise(r => setTimeout(r, 2000));
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

async function pdfdenMetinCikar(sirkulerUrl) {
  const uuidRegex = /detailPdf\/([a-f0-9-]{36})/;
  const eslesme   = sirkulerUrl.match(uuidRegex);
  if (!eslesme) throw new Error(`UUID çıkarılamadı: ${sirkulerUrl}`);

  const uuid   = eslesme[1];
  const pdfUrl = `https://www.turmob.org.tr/ekutuphane/Read/${uuid}`;
  console.log(`PDF okunuyor: ${pdfUrl}`);

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

async function supabaseKaydet(url, metin, embedding) {
  const bugun = new Date().toISOString().split('T')[0];
  const res   = await fetch(`${SUPABASE_URL}/rest/v1/sirkuler`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ sirkuler_no: url, tarih: bugun, metin, embedding }),
  });
  if (!res.ok) {
    const hata = await res.text();
    throw new Error(`Supabase hatası: ${hata}`);
  }
  console.log(`✅ Kaydedildi: ${url}`);
}

async function main() {
  console.log('🚀 Toplu yükleme başladı:', new Date().toISOString());

  const sirkulerler = await tumSirkulerleriCek();
  console.log(`\nToplam ${sirkulerler.length} sirküler işlenecek\n`);

  let yeniSayisi   = 0;
  let mevcutSayisi = 0;
  let hataSayisi   = 0;

  for (const url of sirkulerler) {
    try {
      const uuid = url.match(/detailPdf\/([a-f0-9-]{36})/)[1];

      if (await zatenVarMi(uuid)) {
        console.log(`⏭️  Zaten mevcut: ${uuid}`);
        mevcutSayisi++;
        continue;
      }

      const metin = await pdfdenMetinCikar(url);
      if (!metin || metin.length < 50) {
        console.log(`⚠️  Metin çıkarılamadı: ${url}`);
        hataSayisi++;
        continue;
      }

      const embedding = await embeddingUret(metin);
      await supabaseKaydet(url, metin, embedding);
      yeniSayisi++;

      await new Promise(r => setTimeout(r, 3000));

    } catch (hata) {
      console.error(`❌ Hata:`, hata.message);
      hataSayisi++;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n📊 Sonuç:`);
  console.log(`   ✅ Yeni eklenen: ${yeniSayisi}`);
  console.log(`   ⏭️  Zaten mevcut: ${mevcutSayisi}`);
  console.log(`   ❌ Hata: ${hataSayisi}`);
}

main().catch(console.error);
