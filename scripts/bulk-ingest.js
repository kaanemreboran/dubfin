import OpenAI from 'openai';
import fetch from 'node-fetch';

const openai        = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PDFCO_API_KEY = process.env.PDFCO_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// Mevzuat Sirküleri kategori UUID'si
const KATEGORI_UUID = 'e2f9f8fd-af81-456b-8626-2e938f66dd45';

async function tumSirkulerleriCek() {
  const linkler = [];

  for (let sayfa = 1; sayfa <= 20; sayfa++) {
    const url = `https://www.turmob.org.tr/ekutuphane/${KATEGORI_UUID}/mevzuat-sirkuleri/${sayfa}`;
    console.log(`Sayfa ${sayfa} çekiliyor: ${url}`);

    const res  = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
    });
    const html = await res.text();

    // ekutuphane/detailPdf UUID'lerini çek
    const uuidRegex = /\/detailPdf\/([a-f0-9-]{36})/g;
    let eslesme;
    let yeniVarMi = false;

    while ((eslesme = uuidRegex.exec(html)) !== null) {
      const uuid = eslesme[1];
      if (!linkler.includes(uuid)) {
        linkler.push(uuid);
        yeniVarMi = true;
      }
    }

    console.log(`Sayfa ${sayfa}: ${linkler.length} sirküler bulundu`);

    // 2026 öncesine geçtik mi kontrol et
    if (html.includes('2025') && !html.includes('2026')) {
      console.log('2025 sirkülerine geçildi, duruyoruz.');
      break;
    }

    if (!yeniVarMi) {
      console.log('Yeni sirküler yok, duruyoruz.');
      break;
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\nToplam ${linkler.length} UUID bulundu`);
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

async function supabaseKaydet(uuid, metin, embedding) {
  const bugun = new Date().toISOString().split('T')[0];
  const url   = `https://www.turmob.org.tr/ekutuphane/detailPdf/${uuid}/sirkuler`;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/sirkuler`, {
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
  console.log(`✅ Kaydedildi: ${uuid}`);
}

async function main() {
  console.log('🚀 Toplu yükleme başladı:', new Date().toISOString());

  const uuidler = await tumSirkulerleriCek();

  let yeniSayisi   = 0;
  let mevcutSayisi = 0;
  let hataSayisi   = 0;

  for (const uuid of uuidler) {
    try {
      if (await zatenVarMi(uuid)) {
        console.log(`⏭️  Zaten mevcut: ${uuid}`);
        mevcutSayisi++;
        continue;
      }

      const metin = await pdfdenMetinCikar(uuid);
      if (!metin || metin.length < 50) {
        console.log(`⚠️  Metin çıkarılamadı: ${uuid}`);
        hataSayisi++;
        continue;
      }

      const embedding = await embeddingUret(metin);
      await supabaseKaydet(uuid, metin, embedding);
      yeniSayisi++;

      await new Promise(r => setTimeout(r, 3000));

    } catch (hata) {
      console.error(`❌ Hata (${uuid}):`, hata.message);
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
