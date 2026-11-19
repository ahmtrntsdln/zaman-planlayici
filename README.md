# Zaman Planlayıcı

Kategorili zaman planlayıcı ve takvim. Tek bir web uygulaması (`src/`) iki şekilde çalışır:

- **iPhone / tarayıcı (PWA):** https://ahmtrntsdln.github.io/zaman-planlayici/
  Safari'de açıp Paylaş → **Ana Ekrana Ekle**. İnternetsiz de çalışır.
- **Linux masaüstü (Electron, AppImage):** sistem tepsisinde çalışır, kapalı pencerede de hatırlatır.

Veriler yalnızca kullanıldığı cihazda (localStorage) saklanır. Cihazlar arası taşımak için uygulamadaki **Yedek al / Yedeği geri yükle**.

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
