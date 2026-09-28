// 画面のアイコンと欧文フォント。中身は TS 版が配っているファイルそのもの。
// PNG は src/icon-images.ts、フォントは src/font-file.ts。
package assets

import "embed"

//go:embed icons/apple-touch-icon.png icons/icon-192.png icons/icon-512.png icons/icon-maskable-512.png fonts/InterVariable.woff2
var Files embed.FS
