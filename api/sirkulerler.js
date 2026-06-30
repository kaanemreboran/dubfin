export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/sirkuler?select=id,sirkuler_no,tarih,metin&order=tarih.desc&limit=200`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const data = await response.json();

    const sirkulerler = data.map(row => {
      // Metinden başlık çıkar (genelde ilk büyük harfli satır)
      const satirlar = row.metin.split('\n').map(s => s.trim()).filter(Boolean);
      let baslik = satirlar.find(s => s.length > 15 && s.length < 200 && s === s.toUpperCase()) 
                || satirlar.find(s => s.length > 15 && s.length < 200) 
                || 'Sirküler';

      // Başlığı normal cümle haline getir (çok büyük harfse)
      if (baslik === baslik.toUpperCase() && baslik.length > 10) {
        baslik = baslik.charAt(0) + baslik.slice(1).toLowerCase();
      }

      // Özet: ilk 2-3 cümle
      const ozetKaynak = row.metin.replace(/\s+/g, ' ').trim();
      const ozet = ozetKaynak.substring(0, 280) + (ozetKaynak.length > 280 ? '...' : '');

      // Kategori tahmini
      const metinKucuk = row.metin.toLowerCase();
      let kat = 'Genel';
      if (metinKucuk.includes('sgk') || metinKucuk.includes('sosyal güvenlik') || metinKucuk.includes('sigorta')) kat = 'SGK';
      else if (metinKucuk.includes('kdv') || metinKucuk.includes('katma değer')) kat = 'KDV';
      else if (metinKucuk.includes('muhtasar')) kat = 'Muhtasar';
      else if (metinKucuk.includes('fatura') || metinKucuk.includes('e-arşiv')) kat = 'Fatura';

      // Tarihi GG.AA.YYYY formatına çevir
      const tarihObj = new Date(row.tarih);
      const tarihStr = String(tarihObj.getDate()).padStart(2,'0') + '.' +
                        String(tarihObj.getMonth()+1).padStart(2,'0') + '.' +
                        tarihObj.getFullYear();

      // Sirküler numarasını metinden çıkarmaya çalış (örn: "15.06.2026/85")
      const noEslesme = row.metin.match(/(\d{2}\.\d{2}\.\d{4}\/\d+)/);
      const no = noEslesme ? noEslesme[1] : tarihStr + '/' + row.id;

      return {
        id: row.id,
        no,
        baslik: baslik.substring(0, 150),
        tarih: tarihStr,
        tarihRaw: row.tarih,
        kat,
        ozet,
        metin: row.metin,
        yeni: false,
      };
    });

    // En son eklenen 3 tanesini "yeni" işaretle
    sirkulerler.sort((a, b) => new Date(b.tarihRaw) - new Date(a.tarihRaw));
    for (let i = 0; i < Math.min(3, sirkulerler.length); i++) {
      sirkulerler[i].yeni = true;
    }

    res.status(200).json(sirkulerler);
  } catch (hata) {
    res.status(500).json({ error: hata.message });
  }
}
