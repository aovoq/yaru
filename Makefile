# Go 側の手順。TS 側 (移行前の版) は package.json の scripts を使う
DECLSCOPE_VERSION := v0.9.0
# 常駐の yaru serve (~/dotfiles/home/modules/yaru.nix) と CLI が使う実行ファイル
INSTALL_PATH := $(HOME)/.local/bin/yaru

.PHONY: go-tools go-gen go-check install

go-tools:       ## declscope を .bin に入れる (nix develop の中で動かす)
	go install github.com/mpyw/declscope/cmd/declscope@$(DECLSCOPE_VERSION)

go-gen:         ## proto から Go のコードを作る
	buf generate

go-check:       ## Go の整形・lint・境界・テストを全部通す
	test -z "$$(gofmt -l cmd internal)"
	go vet ./...
	golangci-lint run ./...
	declscope ./...
	go test ./...

install:        ## 画面をビルドして Go の yaru を INSTALL_PATH に置き、常駐の yaru serve を読み直す
	cd web && npm install --no-audit --no-fund && npm run build
	nix develop --command go build -o $(INSTALL_PATH).new ./cmd/yaru
	mv $(INSTALL_PATH).new $(INSTALL_PATH)
	launchctl kickstart -k gui/$$(id -u)/com.aovoq.yaru-serve
