# Zaman Planlayıcı

Kategorili zaman planlayıcı ve takvim: etkinlikler, görevler (checklist), notlar ve kategorilere göre
zaman dağılımı. Biten her etkinlik için ne yapıldığı, gerçekte ne kadar zaman ayrıldığı ve verim
(Kötü / İyi / Verimli) sorulur; bunlardan günlük ve haftalık verim skalası (0–100) oluşur.
Tek bir web uygulaması (`src/`) iki şekilde çalışır:

- **iPhone / tarayıcı (PWA):** https://ahmtrntsdln.github.io/zaman-planlayici/
  Safari'de açıp Paylaş → **Ana Ekrana Ekle**. İnternetsiz de çalışır.
- **Linux masaüstü (Electron, AppImage):** sistem tepsisinde çalışır, kapalı pencerede de hatırlatır.

Veriler önce cihazda (localStorage) saklanır. Uygulamada e-posta/şifreyle giriş yapılırsa
**Firebase (Firestore)** üzerinden telefon ve bilgisayar arasında anlık eşitlenir; internetsizken
yapılan değişiklikler bağlantı gelince gönderilir. Senkron olmadan taşımak için **Yedek al / Yedeği geri yükle**.

## Bulut senkronu (Firebase)

- `src/firebase-config.js`: Firebase konsolundaki web uygulaması yapılandırması (`null` ise senkron kapalı).
- `src/sync.js`: eşitleme mantığı. Veri `users/{uid}/{events|categories|tasks|notes}/{id}` belgelerinde;
  her öğe `updatedAt` taşır, silinenler `deleted: true` iz kaydı olarak kalır, çakışmada öğe bazında son değişiklik kazanır.
- `firestore.rules`: her kullanıcı yalnızca kendi verisine erişir. Firebase konsolu → Firestore → Kurallar'a yapıştırılır.
  Kurallar `tasks`/`notes` türlerine izin vermiyorsa görevler ve notlar cihazda kalır (etkinlik senkronu etkilenmez);
  kurallar güncellenince uygulamanın bir sonraki açılışında buluta gönderilir.
- Etkinlik değerlendirmesi düz alanlarda: `rv` (1 Kötü, 2 İyi, 3 Verimli, 0 yapılmadı), `rvMin` (gerçek dk),
  `rvText`, `rvAt`. Verim puanı süreyle ağırlıklı ortalamadır (Kötü 0, İyi 50, Verimli 100).
- `src/vendor/firebase.js`: `npm run build:firebase` ile `sync/firebase-entry.js`'ten üretilir.
- Yerel test: `npm run emulators` (auth + firestore emülatörü) ve `projectId`'si `demo-` ile başlayan bir yapılandırma.

## Geliştirme

```bash
npm install
npm start                    # masaüstü sürümünü geliştirme modunda aç
npm run dist && ./install.sh # AppImage üret ve uygulama menüsüne kur
```

VS Code terminalinde `npm start` öncesinde `unset ELECTRON_RUN_AS_NODE` gerekir.

Web sürümü `main` dalına gönderilince GitHub Actions ile otomatik yayınlanır.
`src/` içindeki dosyaları değiştirdiğinde `src/sw.js` içindeki `VERSION` değerini artır ki
telefonlar yeni sürümü alsın.
