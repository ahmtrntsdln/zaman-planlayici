# Senkron testleri

Bu belge, telefon–bilgisayar senkronunun (`src/sync.js`) nasıl test edildiğini ve alınan sonuçları kaydeder.
Araştırma notu: https://ahmtrntsdln.dev/notes/takvim-senkron.html

**Tarih:** 19 Kasım 2026 · **Kod:** senkronun eklendiği commit `65ce602` ve hemen öncesindeki çalışma kopyası.

## Ortam

- Firebase Local Emulator Suite (`npm run emulators`): Authentication `127.0.0.1:9099`, Firestore `127.0.0.1:8080`,
  güvenlik kuralları `firestore.rules`.
- Uygulama, `projectId`'si `demo-zaman` olan bir test yapılandırmasıyla yerel bir HTTP sunucusundan açıldı
  (`demo-` ile başlayan proje kimliğinde `sync.js` emülatöre bağlanır).
- "Cihazlar": aynı Electron sürecinde, birbirinden tamamen ayrı depolamaya (`partition`) sahip iki ya da üç pencere.
  Böylece her pencerenin kendi localStorage'ı, IndexedDB'si ve Firestore önbelleği oldu.
- Koşullar `executeJavaScript` ile arayüz üzerinden (düğmelere tıklayarak, formu göndererek) ya da
  `window.ZPSync` / `window.ZP` üzerinden sürüldü. Her bekleme 250 ms aralıkla yoklandı.

**Sınır:** Bunlar yerel test sunucusu ölçümleri; gerçek internet üzerindeki gecikmeyi ve gerçek iPhone/Safari
davranışını göstermez.

## 1. Temel senaryo (A ve B, aynı hesap)

| # | Adım | Sonuç |
|---|------|-------|
| 1 | A: arayüzdeki formla hesap oluştur | ✓ senkronize (≈250 ms) |
| 2 | A: iki etkinlik ekle | ✓ buluta yazıldı |
| 3 | B: aynı hesapla giriş | ✓ A'nın etkinlikleri geldi, B'nin örnek etkinlikleri kalktı; 5 kategori |
| 4 | B: bir etkinliğin başlığını değiştir ve tamamla | ✓ A'da göründü |
| 5 | B: "tamamlandı" düğmesine bas | ✓ A'da göründü |
| 6 | A: bir etkinliği sil | ✓ B'den de silindi |
| 7 | A ve B: aynı anda birer etkinlik ekle | ✓ iki cihazda da ikisi var |
| 8 | A: kategori adını ve hedefini değiştir | ✓ B'de göründü |
| 9 | B: sayfayı yeniden yükle | ✓ oturum ve veriler duruyor, "Senkronize ✓" |
| 10 | C: yanlış şifreyle giriş | "E-posta ya da şifre yanlış." |
| 11 | C: 3 karakterli şifreyle hesap | "Şifre en az 6 karakter olmalı." |
| 12 | C: başka bir hesap açar | ✓ A'nın etkinliklerini görmüyor |

Sonuç: testteki 11 başarı kontrolünün hepsi geçti (1–9 ve 12; 7. satır A ve B için iki ayrı kontroldür).
10 ve 11 numaralı satırlar kontrol değil, beklenen hata mesajlarının kaydıdır.

## 2. Çevrimdışı birleştirme

Bağlantı kesintisi Firestore'un kendi `disableNetwork()` / `enableNetwork()` çağrılarıyla canlandırıldı
(`ZPSync.setNetwork`). İlk denemede Electron'un `enableNetworkEmulation({offline:true})` özelliği kullanılmıştı;
bu, yerel test sunucusuyla bağlantıyı kesmediği için A'nın "çevrimdışı" değişikliği anında B'ye gitti ve deneme geçersiz sayıldı.

Başlangıç (iki cihazda): `A: Fizik çalışması✔ | A: Kütüphane | B: Market`

| Adım | Cihaz |
|------|-------|
| A çevrimdışı; etiket "Çevrimdışı · sonra eşitlenecek" | A |
| Yeni etkinlik: "A(çevrimdışı): Tren yolculuğu" | A |
| "A: Kütüphane" tamamlandı | A |
| "B: Market" → "A: Market (A'nın sürümü)" | A |
| Yeni etkinlik: "B: Diş hekimi" | B |
| Aynı Market, **daha sonra**: → "B: Market (B'nin sonraki sürümü)" | B |
| A yeniden çevrimiçi | A |

Son durum (A ve B aynı):
`A(çevrimdışı): Tren yolculuğu | A: Fizik çalışması✔ | A: Kütüphane✔ | B: Diş hekimi | B: Market (B'nin sonraki sürümü)`

Dört değişikliğin hepsi korundu; aynı öğede daha sonra yapılan değişiklik (B) kazandı. İki cihaz da "Senkronize ✓".

## 3. Güvenlik kuralları (doğrudan REST, emülatör)

| Deneme | HTTP |
|--------|------|
| C'nin oturumuyla A'nın `users/{A}/events` listesini okuma | 403 |
| Girişsiz okuma | 403 |
| C'nin oturumuyla A'nın hesabına belge yazma | 403 |
| C'nin kendi hesabında izin verilmeyen bir listeye (`users/{C}/baska`) yazma | 403 |

## 4. Masaüstü (Electron, `file://`)

Senkron modülü `file://` üzerinden yüklendi; test yapılandırmasıyla giriş yapılınca diğer cihazların verileri geldi.

## Bilinen sınırlar

- Birleştirme birimi öğedir, alan değil: aynı etkinliğin farklı alanları iki cihazda değişirse son kaydedilen öğe bütünüyle kazanır.
- "Son değişiklik" cihaz saatine göre belirlenir.
- Uzun süre çevrimdışı kalan cihazın kuyruktaki eski yazması bulutta kısa süre yeni sürümün üstüne geçebilir; yeni sürümü taşıyan cihaz açılınca yeniden yükler.
- Silinenlerin iz kayıtları (`deleted: true`) temizlenmiyor.
