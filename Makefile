# Go 移行の間の Go 側の手順。TS 側は今までどおり package.json の scripts を使う
DECLSCOPE_VERSION := v0.9.0

.PHONY: go-tools go-gen go-check

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
