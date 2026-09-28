// SPA のビルド成果物。Vite が web/dist に出すファイルをサーバが埋め込む。
// ディレクトリが空 (印だけ) の間も、サーバはビルドできて起動する。
// docs/spec/routes.md の「静的配信に残すもの」
package web

import "embed"

//go:embed all:dist
var Dist embed.FS
